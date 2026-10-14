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
import random
import re
import threading
import time
from email.utils import parsedate_to_datetime

import httpx

from app.core.config import settings

logger = logging.getLogger("studyai.llm")

# A message is a standard chat turn: {"role": "system"|"user"|"assistant", ...}.
Message = dict[str, str]

# What the user sees once every retry and fallback model has been exhausted by a
# *transient* failure (HTTP 429/5xx, timeout, network drop). It is deliberately
# provider-agnostic and free of internals: the request really was refused, and
# the honest answer is that the service is busy — never a fabricated result.
BUSY_MESSAGE = "The AI service is temporarily busy. Please try again shortly."

# HTTP statuses that are worth trying again. 408/429 and the "server is
# overloaded" 5xx codes normally clear up on their own; 501 (not implemented)
# and 505 (version unsupported) describe the *endpoint* and will never fix
# themselves, so they are treated as permanent instead.
_RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504, 529})
_PERMANENT_5XX_STATUS = frozenset({501, 505})

# Providers put their own "wait this long" hint in the response body when they do
# not send a Retry-After header. Google Gemini is one of them: a free-tier quota
# refusal reads "…Please retry in 7h40m36.256585088s." and the structured
# ``retryDelay`` field (``"277236s"``) says the same. Reading it is what lets us
# tell an *exhausted quota* (hours away — do not spin retries) apart from a
# short per-minute rate limit (seconds away — worth retrying).
_RETRY_DELAY_FIELD = re.compile(r'"retryDelay"\s*:\s*"([0-9.]+)s"')
_RETRY_DELAY_HINT = re.compile(
    r"retry in\s+(?:(\d+)h)?(?:(\d+)m)?([0-9.]+)s", re.IGNORECASE
)

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

    ``retry_after`` carries the provider's own guidance (the ``Retry-After``
    header) so the retry waits as long as the provider asked instead of
    guessing.
    """

    def __init__(
        self,
        message: str,
        *,
        retry_same_model: bool = True,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.retry_same_model = retry_same_model
        self.retry_after = retry_after


class _QuotaLLMError(LLMError):
    """HTTP 429 where the provider asked us to wait far longer than a request can.

    A free-tier *daily* quota resets in hours, so retrying the same model inside
    this web request only wastes attempts and then reports a vague "busy". This
    is kept separate from :class:`_TransientLLMError` so the retry loop skips the
    same-model retries, still moves on to the next fallback model (each model has
    its own quota), and — if every model is exhausted — surfaces the real reason
    instead of :data:`BUSY_MESSAGE`.
    """

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


def _is_retryable_status(status: int) -> bool:
    """True when an HTTP status is a temporary condition worth another attempt."""
    if status in _RETRYABLE_STATUS:
        return True
    if 500 <= status < 600:
        return status not in _PERMANENT_5XX_STATUS
    return False


def _retry_after_seconds(response: object) -> float | None:
    """Read ``Retry-After`` from a response, in seconds, if it is usable.

    Both forms in RFC 9110 are handled: a delay in seconds (``Retry-After: 5``)
    and an HTTP-date (``Retry-After: Wed, 21 Oct 2026 07:28:00 GMT``). Anything
    malformed or absent returns ``None`` so the exponential backoff is used
    instead. The response object is duck-typed because tests replace it with a
    simple stub.
    """
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    raw = None
    try:
        # Header names are case-insensitive in HTTP (and in httpx.Headers);
        # comparing lower-cased keys keeps plain dicts honest too.
        for key, value in headers.items():
            if str(key).strip().lower() == "retry-after":
                raw = value
                break
    except (AttributeError, TypeError):
        return None
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return max(0.0, float(text))
    except ValueError:
        pass
    try:  # HTTP-date form
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    return max(0.0, when.timestamp() - time.time())


def _retry_delay_from_body(body: str) -> float | None:
    """Read the provider's suggested wait from a response body, in seconds.

    Used when there is no ``Retry-After`` header. Handles the structured
    ``"retryDelay": "277236s"`` field and the human wording
    "Please retry in 7h40m36.25s" that Gemini puts in quota refusals. Returns
    ``None`` when neither is present so the caller falls back to backoff.
    """
    if not body:
        return None
    field = _RETRY_DELAY_FIELD.search(body)
    if field:
        try:
            return max(0.0, float(field.group(1)))
        except ValueError:
            pass
    hint = _RETRY_DELAY_HINT.search(body)
    if hint:
        hours = int(hint.group(1) or 0)
        minutes = int(hint.group(2) or 0)
        return max(0.0, hours * 3600 + minutes * 60 + float(hint.group(3)))
    return None


def _retry_delay_seconds(response: object) -> float | None:
    """The provider's suggested wait: ``Retry-After`` header, else body hint."""
    delay = _retry_after_seconds(response)
    if delay is not None:
        return delay
    return _retry_delay_from_body(getattr(response, "text", "") or "")


def _humanize_seconds(seconds: float) -> str:
    """A short "7h 40m" / "2m 30s" / "45s" rendering for user-facing messages."""
    total = int(max(0.0, seconds))
    if total >= 3600:
        hours, rest = divmod(total, 3600)
        return f"{hours}h {rest // 60}m"
    if total >= 60:
        return f"{total // 60}m {total % 60}s"
    return f"{total}s"


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


def _quota_message(model: str, body: str, delay: float | None) -> str:
    """A specific message for an *exhausted* quota (not a transient rate limit).

    Retrying now cannot help, so this says so plainly and tells the user what to
    change (plan/model) instead of the generic "busy, try again shortly".
    """
    detail = (body or "").strip()
    if len(detail) > 400:
        detail = detail[:400] + "…"
    wait = (
        f" The provider asked to retry in about {_humanize_seconds(delay)}."
        if delay
        else ""
    )
    suffix = f" Provider said: {detail}" if detail else ""
    return (
        f"The quota for the language model {_provider_label(model)} is exhausted "
        f"(HTTP 429).{wait} Wait for it to reset, upgrade the plan, or set LLM_MODEL "
        f"to a model with available quota — retrying now will not help.{suffix}"
    )


def _model_candidates() -> list[str]:
    """The primary model followed by any configured fallbacks (de-duplicated)."""
    names = [settings.LLM_MODEL, *settings.LLM_FALLBACK_MODELS.split(",")]
    candidates: list[str] = []
    for name in names:
        name = (name or "").strip()
        if name and name not in candidates:
            candidates.append(name)
    return candidates


def chat(
    messages: list[Message],
    *,
    max_tokens: int = 1200,
    temperature: float = 0.2,
    json_mode: bool = False,
) -> str:
    """Run a (possibly multi-turn) chat completion and return the assistant text.

    When ``json_mode`` is set, the request asks the provider for a JSON object
    (OpenAI-compatible ``response_format``). Providers that do not support it are
    handled transparently: the request is retried once without the parameter, so
    the call never fails just because JSON mode is unavailable.
    """
    return _chat_with_failover(
        messages, max_tokens=max_tokens, temperature=temperature, json_mode=json_mode
    )


def _chat_with_failover(
    messages: list[Message], *, max_tokens: int, temperature: float, json_mode: bool = False
) -> str:
    """Retry transient provider failures, then fall back through the model list.

    Transient failures (HTTP 429 rate limits, 5xx, timeouts, network drops) are
    retried a small number of times per model — waiting a little longer after
    each attempt (exponential backoff, with jitter so parallel batches never
    hammer the provider in lockstep, or the exact ``Retry-After`` the provider
    sent when it gave one) — then the next model in ``LLM_FALLBACK_MODELS`` is
    tried, so a "high demand" spell on one model does not block notes, topics,
    quizzes or the tutor. Permanent failures (bad key, unknown model) fail fast
    with a clear reason and are never retried. An *exhausted quota* (a 429 whose
    retry hint is far beyond the retry cap) is not retried on the same model but
    still falls through to the next model, and if nothing is left it reports the
    quota instead of the generic busy note. Nothing is ever silently substituted
    for a real answer.

    When every retry and every fallback model is exhausted by transient
    failures, the raised :class:`LLMError` leads with :data:`BUSY_MESSAGE` so
    the UI can show one clear, honest sentence and offer a Retry action.
    """
    if not is_configured():
        raise LLMError(not_configured_message())

    candidates = _model_candidates()
    attempts = max(1, settings.LLM_MAX_ATTEMPTS)
    backoff = max(0.0, settings.LLM_RETRY_BACKOFF_SECONDS)
    last_error: LLMError | None = None
    quota_error: _QuotaLLMError | None = None

    for position, model in enumerate(candidates):
        for attempt in range(attempts):
            try:
                return _chat_once(model, messages, max_tokens, temperature, json_mode)
            except _QuotaLLMError as exc:
                # Out of quota for this model. Waiting hours inside a web request
                # is not an option, but every model has its own quota, so skip the
                # same-model retries and try the next fallback instead.
                quota_error = exc
                last_error = exc
                logger.warning("llm: %s is out of quota: %s", model, exc.message)
                break
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
                if attempt + 1 < attempts:
                    _sleep_before_retry(
                        base=backoff * (2**attempt), retry_after=exc.retry_after
                    )
        if position + 1 < len(candidates):
            logger.warning("llm: %s is failing; trying fallback model", model)

    if last_error is None:
        raise LLMError("The language model could not produce a response.")
    if quota_error is not None:
        # An exhausted quota is the more actionable cause: it will not clear in
        # seconds, so the generic "busy" wording would mislead. The Retry action
        # still repeats the exact request once quota/model is fixed.
        logger.warning("llm: giving up — quota exhausted: %s", quota_error.message)
        raise LLMError(quota_error.message) from quota_error
    if isinstance(last_error, _TransientLLMError):
        # Every model is genuinely busy. Log the provider detail for diagnosis,
        # but surface one clear, actionable sentence to the user (the API maps
        # this to HTTP 502), and never pretend a real answer was produced.
        logger.warning("llm: giving up after retries: %s", last_error.message)
        raise LLMError(BUSY_MESSAGE) from last_error
    raise last_error


def _sleep_before_retry(*, base: float, retry_after: float | None) -> None:
    """Wait before the next attempt.

    The provider's own ``Retry-After`` wins when present — Google sends it on
    429/503 "high demand" responses and ignoring it only earns another refusal.
    Otherwise the wait grows exponentially from the configured base and is
    multiplied by a random factor in [0.5, 1.5) so a burst of parallel
    generations (notes run in batches) does not retry at the same instant. Both
    are capped so a single web request can never hang indefinitely.
    """
    ceiling = max(0.0, settings.LLM_RETRY_MAX_BACKOFF_SECONDS)
    if retry_after is not None:
        delay = min(max(0.0, retry_after), ceiling)
    else:
        delay = min(max(0.0, base) * random.uniform(0.5, 1.5), ceiling)
    if delay > 0:
        time.sleep(delay)


def _chat_once(
    model: str,
    messages: list[Message],
    max_tokens: int,
    temperature: float,
    json_mode: bool = False,
) -> str:
    """One request against one model. Raises LLMError (or its transient form)."""
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        # Ask the provider for a single JSON object. This is what makes the
        # topic/knowledge-map responses machine-readable instead of prose.
        payload["response_format"] = {"type": "json_object"}

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

    # Not every OpenAI-compatible server knows ``response_format``. If this exact
    # request is rejected for that reason, retry the same model once without it
    # rather than failing a feature that would otherwise work.
    if response.status_code == 400 and "response_format" in payload:
        if "response_format" in (response.text or "").lower():
            logger.info(
                "llm: %s rejected response_format; retrying without JSON mode", model
            )
            payload.pop("response_format", None)
            try:
                response = _http_client().post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                logger.warning("llm: %s unreachable on JSON-mode retry (%s)", model, exc)
                raise _TransientLLMError(
                    f"Could not reach the language model provider "
                    f"{_provider_label(model)} ({exc}).",
                    retry_same_model=False,
                ) from exc

    if response.status_code >= 400:
        message = _status_message(response.status_code, response.text, model)
        logger.warning("llm: %s -> HTTP %s in %.2fs", model, response.status_code, elapsed)
        if response.status_code == 429:
            # A 429 is ambiguous: a per-minute rate limit clears in seconds, but
            # an exhausted daily quota is hours away. The provider's own hint
            # tells them apart — if it asks us to wait longer than we are ever
            # willing to wait inside one request, retrying this model is pointless.
            delay = _retry_delay_seconds(response)
            ceiling = max(0.0, settings.LLM_RETRY_MAX_BACKOFF_SECONDS)
            if delay is not None and delay > ceiling:
                raise _QuotaLLMError(
                    _quota_message(model, response.text, delay), retry_after=delay
                )
            raise _TransientLLMError(message, retry_after=delay)
        if _is_retryable_status(response.status_code):
            # Temporary (overloaded 5xx / 408): hand the provider's own
            # Retry-After, when it sent one, to the retry loop.
            raise _TransientLLMError(
                message, retry_after=_retry_after_seconds(response)
            )
        # 400/401/403/404/… will not fix themselves: fail immediately instead
        # of burning the retry budget on a request that is bound to fail again.
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


def complete(
    system: str, user: str, *, max_tokens: int = 1200, json_mode: bool = False
) -> str:
    """Single-turn convenience wrapper around :func:`chat`."""
    return chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        json_mode=json_mode,
    )
