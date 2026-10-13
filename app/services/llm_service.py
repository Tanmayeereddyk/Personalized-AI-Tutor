"""The one LLM client used by both notes generation and the tutor.

The provider is OpenAI-compatible (``/chat/completions``): Google Gemini via its
OpenAI-compatible endpoint, OpenAI, OpenRouter, Groq, Together, or a local
Ollama server. The key and model come from configuration — see
:mod:`app.core.config`. Notes generation and tutoring share this client but keep
separate prompts and services, because their inputs and outputs are different.

There is deliberately **no** extractive fallback here: if the provider is not
configured or the request fails, callers get a typed :class:`LLMError` with a
human-readable reason, and the feature returns a clear error instead of quietly
producing template text.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

from app.core.config import settings

logger = logging.getLogger("studyai.llm")

# A message is a standard chat turn: {"role": "system"|"user"|"assistant", ...}.
Message = dict[str, str]

# One shared, keep-alive HTTP client for the whole process. Reusing it means the
# TLS handshake to the provider happens once instead of on every request, which
# matters a lot when notes generation fires several calls in parallel.
# ``httpx.Client`` is safe to share across threads.
_client_lock = threading.Lock()
_client: httpx.Client | None = None


def _http_client() -> httpx.Client:
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                pool = max(1, settings.LLM_MAX_CONNECTIONS)
                _client = httpx.Client(
                    timeout=settings.LLM_TIMEOUT_SECONDS,
                    limits=httpx.Limits(
                        max_connections=pool,
                        max_keepalive_connections=pool,
                    ),
                )
    return _client


class LLMError(RuntimeError):
    """Raised when the language model cannot produce a response.

    The message is always safe to show a user: it never contains the API key.
    """


class _TransientLLMError(LLMError):
    """A failure worth retrying: rate limit, provider 5xx, timeout or network.

    ``retry_same_model`` is False for a hung/unreachable request: retrying the
    same overloaded host just wastes another full timeout, so the caller moves
    straight to the next model instead.
    """

    def __init__(self, message: str, *, retry_same_model: bool = True) -> None:
        super().__init__(message)
        self.message = message
        self.retry_same_model = retry_same_model


def _provider_label(model: str | None = None) -> str:
    """A safe, key-free description of the configured provider for errors."""
    provider = (settings.LLM_PROVIDER or "llm").strip().lower()
    return f"{provider} ({model or settings.LLM_MODEL or 'unknown-model'})"


def is_configured() -> bool:
    """True only when an API key *and* a model name are set."""
    return settings.llm_configured


def not_configured_message() -> str:
    """A clear, actionable message for the "no key/model" case."""
    return (
        "The language model is not configured, so notes and tutor answers cannot be "
        "generated. Set GEMINI_API_KEY (or LLM_API_KEY) and LLM_MODEL in .env and "
        "restart the backend."
    )


def _status_message(status: int, body: str, model: str | None = None) -> str:
    """Turn an HTTP failure into a specific, actionable message."""
    detail = (body or "").strip()
    if len(detail) > 400:
        detail = detail[:400] + "…"
    suffix = f" Provider said: {detail}" if detail else ""
    provider = _provider_label(model)
    if status in (401, 403):
        return (
            f"The language model rejected the API key for {provider} "
            f"(HTTP {status}). Check the key in .env.{suffix}"
        )
    if status == 404:
        return (
            f"The language model or model name was not found for {provider} "
            f"(HTTP 404). Check LLM_MODEL.{suffix}"
        )
    if status == 429:
        return (
            f"The language model quota is exhausted or you are being rate limited for "
            f"{provider} (HTTP 429). Try again later or check your plan.{suffix}"
        )
    if status >= 500:
        return (
            f"The language model provider {provider} had a server error "
            f"(HTTP {status}). Try again shortly.{suffix}"
        )
    return f"The language model request to {provider} failed (HTTP {status}).{suffix}"


def _model_candidates() -> list[str]:
    """The primary model followed by any configured fallbacks (de-duplicated)."""
    names = [settings.LLM_MODEL, *settings.LLM_FALLBACK_MODELS.split(",")]
    candidates: list[str] = []
    for name in names:
        name = (name or "").strip()
        if name and name not in candidates:
            candidates.append(name)
    return candidates


def chat(messages: list[Message], *, max_tokens: int = 1200, temperature: float = 0.2) -> str:
    """Run a (possibly multi-turn) chat completion and return the assistant text."""
    return _chat_with_failover(messages, max_tokens=max_tokens, temperature=temperature)


def _chat_with_failover(
    messages: list[Message], *, max_tokens: int, temperature: float
) -> str:
    """Retry transient provider failures, then fall back through the model list.

    Transient failures (HTTP 429, 5xx, timeouts, network drops) are retried a
    couple of times, then the next model in ``LLM_FALLBACK_MODELS`` is tried, so a
    "high demand" spell on one model does not block notes or the tutor. Permanent
    failures (bad key, unknown model) fail fast with a clear reason. Nothing is
    ever silently substituted for a real answer.
    """
    if not is_configured():
        raise LLMError(not_configured_message())

    candidates = _model_candidates()
    attempts = max(1, settings.LLM_MAX_ATTEMPTS)
    backoff = max(0.0, settings.LLM_RETRY_BACKOFF_SECONDS)
    last_error: LLMError | None = None

    for position, model in enumerate(candidates):
        for attempt in range(attempts):
            try:
                return _chat_once(model, messages, max_tokens, temperature)
            except _TransientLLMError as exc:
                last_error = exc
                logger.info(
                    "llm: %s transient failure (attempt %d/%d): %s",
                    model,
                    attempt + 1,
                    attempts,
                    exc.message,
                )
                if not exc.retry_same_model:
                    # Hung/unreachable host: retrying it just burns another full
                    # timeout, so move straight on to the next model.
                    break
                if attempt + 1 < attempts and backoff:
                    time.sleep(backoff * (2**attempt))
        if position + 1 < len(candidates):
            logger.warning("llm: %s is failing; trying fallback model", model)

    raise last_error or LLMError("The language model could not produce a response.")


def _chat_once(
    model: str, messages: list[Message], max_tokens: int, temperature: float
) -> str:
    """One request against one model. Raises LLMError (or its transient form)."""
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        started = time.perf_counter()
        response = _http_client().post(url, json=payload, headers=headers)
        elapsed = time.perf_counter() - started
    except httpx.TimeoutException as exc:
        logger.warning("llm: %s timed out after %ss", model, settings.LLM_TIMEOUT_SECONDS)
        raise _TransientLLMError(
            f"The language model request to {_provider_label(model)} timed out. Try again.",
            retry_same_model=False,
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("llm: %s unreachable (%s)", model, exc)
        raise _TransientLLMError(
            f"Could not reach the language model provider {_provider_label(model)} ({exc}).",
            retry_same_model=False,
        ) from exc

    if response.status_code >= 400:
        message = _status_message(response.status_code, response.text, model)
        logger.warning("llm: %s -> HTTP %s in %.2fs", model, response.status_code, elapsed)
        if response.status_code == 429 or response.status_code >= 500:
            raise _TransientLLMError(message)
        raise LLMError(message)

    logger.info(
        "llm: %s -> HTTP %s in %.2fs (%d msg, max_tokens=%d)",
        model,
        response.status_code,
        elapsed,
        len(messages),
        max_tokens,
    )

    try:
        data = response.json()
    except ValueError as exc:  # non-JSON body
        raise _TransientLLMError(
            "The language model returned an unreadable (non-JSON) response."
        ) from exc

    return _extract_content(data)


def _extract_content(data: object) -> str:
    """Pull the assistant text out of an OpenAI-compatible response body."""
    try:
        message = data["choices"][0]["message"]  # type: ignore[index]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("The language model returned an unexpected response shape.") from exc

    content = message.get("content") if isinstance(message, dict) else None
    if content is None:
        # "Thinking" models (e.g. Gemini 3) can spend the whole token budget on
        # internal reasoning and return finish_reason "length" with no visible
        # text at all. Return empty so the caller reports it clearly (and, for the
        # tutor, can fall back / retry a larger budget) rather than as a malformed
        # response.
        return ""

    # Some providers return content as a list of parts; join the text parts.
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content
        )
    if not isinstance(content, str):
        raise LLMError("The language model returned an unexpected response shape.")
    return content


def complete(system: str, user: str, *, max_tokens: int = 1200) -> str:
    """Single-turn convenience wrapper around :func:`chat`."""
    return chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
    )
