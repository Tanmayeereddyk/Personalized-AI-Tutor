"""Unit tests for the LLM client: HTTP error mapping, retry and model fallback.

No network and no API key: the shared HTTP client and the per-model call are
replaced with fakes, so we exercise the real retry/fallback logic in isolation.
"""

import pytest

from app.services import llm_service


class _FakeResponse:
    def __init__(self, status: int, body: str = "{}", content: str = "hello") -> None:
        self.status_code = status
        self.text = body
        self._content = content

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


class _FakeClient:
    """Returns the queued responses in order (last one repeats)."""

    def __init__(self, *responses: _FakeResponse) -> None:
        self._responses = list(responses)
        self.calls = 0

    def post(self, *args, **kwargs) -> _FakeResponse:
        self.calls += 1
        if len(self._responses) > 1:
            return self._responses.pop(0)
        return self._responses[0]


def _use(monkeypatch, *responses: _FakeResponse) -> _FakeClient:
    client = _FakeClient(*responses)
    monkeypatch.setattr(llm_service, "_http_client", lambda: client)
    return client


# ----------------------------------------------------------------------
# HTTP status -> transient vs permanent
# ----------------------------------------------------------------------

def test_chat_once_maps_429_and_5xx_to_transient(monkeypatch) -> None:
    for status in (429, 500, 503):
        _use(monkeypatch, _FakeResponse(status, '{"error": {"message": "busy"}}'))
        with pytest.raises(llm_service._TransientLLMError):
            llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)


def test_chat_once_maps_404_and_401_to_permanent(monkeypatch) -> None:
    for status in (401, 404):
        _use(monkeypatch, _FakeResponse(status, "nope"))
        with pytest.raises(llm_service.LLMError) as exc:
            llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)
        assert not isinstance(exc.value, llm_service._TransientLLMError)
        assert str(status) in str(exc.value)


def test_chat_once_returns_content_on_success(monkeypatch) -> None:
    _use(monkeypatch, _FakeResponse(200, content="  the answer  "))
    out = llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)
    assert out == "  the answer  "


def test_extract_content_treats_missing_content_as_empty() -> None:
    # What a "thinking" model returns when it exhausts the token budget on
    # internal reasoning: finish_reason "length" and no visible content at all.
    data = {"choices": [{"finish_reason": "length", "message": {"role": "assistant"}}]}
    assert llm_service._extract_content(data) == ""


def test_extract_content_rejects_a_shape_without_choices() -> None:
    with pytest.raises(llm_service.LLMError):
        llm_service._extract_content({"error": "nope"})


def test_extract_content_joins_list_parts() -> None:
    data = {"choices": [{"message": {"content": [{"text": "a"}, {"text": "b"}]}}]}
    assert llm_service._extract_content(data) == "ab"


# ----------------------------------------------------------------------
# Retry + fallback over the model list
# ----------------------------------------------------------------------

def _configure(monkeypatch, *, model="primary", fallbacks="backup-a, backup-b", attempts=1):
    monkeypatch.setattr(llm_service.settings, "LLM_MODEL", model)
    monkeypatch.setattr(llm_service.settings, "LLM_FALLBACK_MODELS", fallbacks)
    monkeypatch.setattr(llm_service.settings, "LLM_MAX_ATTEMPTS", attempts)
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_BACKOFF_SECONDS", 0.0)


def test_model_candidates_are_ordered_and_deduplicated(monkeypatch) -> None:
    _configure(monkeypatch, model="primary", fallbacks=" backup-a , primary ,backup-b,,")
    assert llm_service._model_candidates() == ["primary", "backup-a", "backup-b"]


def test_falls_back_to_next_model_when_primary_is_overloaded(monkeypatch) -> None:
    _configure(monkeypatch)
    tried: list[str] = []

    def fake_once(model, messages, max_tokens, temperature):
        tried.append(model)
        if model == "primary":
            raise llm_service._TransientLLMError("503 high demand")
        return f"answer from {model}"

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    out = llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )
    assert out == "answer from backup-a"
    assert tried == ["primary", "backup-a"]


def test_retries_same_model_before_falling_back(monkeypatch) -> None:
    _configure(monkeypatch, attempts=3)
    tried: list[str] = []

    def fake_once(model, messages, max_tokens, temperature):
        tried.append(model)
        if model == "primary":
            raise llm_service._TransientLLMError("503 busy")
        return "ok"

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )
    assert tried == ["primary", "primary", "primary", "backup-a"]


def test_timeout_skips_retry_and_moves_to_fallback(monkeypatch) -> None:
    _configure(monkeypatch, attempts=3)
    tried: list[str] = []

    def fake_once(model, messages, max_tokens, temperature):
        tried.append(model)
        if model == "primary":
            raise llm_service._TransientLLMError("timed out", retry_same_model=False)
        return "ok"

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )
    # A hung primary is not retried; the next model is tried immediately.
    assert tried == ["primary", "backup-a"]


def test_permanent_error_does_not_try_fallbacks(monkeypatch) -> None:
    _configure(monkeypatch)
    tried: list[str] = []

    def fake_once(model, messages, max_tokens, temperature):
        tried.append(model)
        raise llm_service.LLMError("The API key was rejected (HTTP 401).")

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    with pytest.raises(llm_service.LLMError):
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )
    assert tried == ["primary"]


def test_all_models_failing_raises_the_last_error(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="backup-a")

    def fake_once(model, messages, max_tokens, temperature):
        raise llm_service._TransientLLMError(f"{model} is busy")

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    with pytest.raises(llm_service.LLMError) as exc:
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )
    assert "backup-a is busy" in str(exc.value)
