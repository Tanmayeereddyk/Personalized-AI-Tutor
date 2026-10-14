"""Unit tests for the LLM client: HTTP error mapping, retry and model fallback.

No network and no API key: the shared HTTP client and the per-model call are
replaced with fakes, so we exercise the real retry/fallback logic in isolation.
"""

import time

import pytest

from app.services import llm_service


class _FakeResponse:
    def __init__(
        self,
        status: int,
        body: str = "{}",
        content: str = "hello",
        headers: dict | None = None,
    ) -> None:
        self.status_code = status
        self.text = body
        self._content = content
        # Real httpx responses always expose .headers; the fake mirrors it so
        # Retry-After handling is exercised without a network call.
        self.headers = dict(headers or {})

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

    def fake_once(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
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

    def fake_once(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
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

    def fake_once(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
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

    def fake_once(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
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

    def fake_once(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        raise llm_service._TransientLLMError(f"{model} is busy")

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    with pytest.raises(llm_service.LLMError) as exc:
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )
    # The user sees one clear sentence; the last provider detail is kept as the
    # chained cause for the logs, never shown as if it were the answer.
    assert str(exc.value) == llm_service.BUSY_MESSAGE
    assert "backup-a is busy" in str(exc.value.__cause__)


# ----------------------------------------------------------------------
# Retry policy: 503/429 handling, jitter, Retry-After, busy message
# ----------------------------------------------------------------------

def _record_sleeps(monkeypatch) -> list[float]:
    """Capture every retry wait instead of actually sleeping."""
    slept: list[float] = []
    monkeypatch.setattr(llm_service.time, "sleep", lambda seconds: slept.append(seconds))
    return slept


def test_retryable_statuses_are_429_408_and_server_errors() -> None:
    for status in (408, 429, 500, 502, 503, 504, 529, 599):
        assert llm_service._is_retryable_status(status), status


def test_permanent_statuses_are_never_retried() -> None:
    for status in (400, 401, 403, 404, 422, 501, 505):
        assert not llm_service._is_retryable_status(status), status


def test_chat_once_raises_a_permanent_error_for_auth_and_request_failures(
    monkeypatch,
) -> None:
    for status in (400, 401, 403, 404):
        _use(monkeypatch, _FakeResponse(status, "nope"))
        with pytest.raises(llm_service.LLMError) as exc:
            llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)
        # A permanent failure must not be presented as retryable.
        assert not isinstance(exc.value, llm_service._TransientLLMError)
        assert str(status) in str(exc.value)


def test_chat_once_raises_a_transient_error_for_503_and_429(monkeypatch) -> None:
    for status in (429, 503):
        _use(monkeypatch, _FakeResponse(status, "high demand"))
        with pytest.raises(llm_service._TransientLLMError):
            llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)


def test_transient_error_carries_retry_after_from_the_response(monkeypatch) -> None:
    _use(monkeypatch, _FakeResponse(503, headers={"Retry-After": "7"}))
    with pytest.raises(llm_service._TransientLLMError) as exc:
        llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)
    assert exc.value.retry_after == 7.0


def test_retry_after_parsing_handles_seconds_dates_and_rubbish() -> None:
    from email.utils import formatdate

    assert llm_service._retry_after_seconds(
        _FakeResponse(429, headers={"retry-after": "5"})
    ) == 5.0

    http_date = formatdate(time.time() + 30, usegmt=True)
    remaining = llm_service._retry_after_seconds(
        _FakeResponse(429, headers={"retry-after": http_date})
    )
    assert remaining is not None and 0 < remaining <= 30

    # Malformed or missing headers fall back to exponential backoff.
    assert llm_service._retry_after_seconds(
        _FakeResponse(429, headers={"retry-after": "soon"})
    ) is None
    assert llm_service._retry_after_seconds(_FakeResponse(429)) is None
    assert llm_service._retry_after_seconds(object()) is None


def test_backoff_grows_exponentially_and_sleeps(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="", attempts=3)
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_BACKOFF_SECONDS", 1.0)
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_MAX_BACKOFF_SECONDS", 60.0)
    # Deterministic "jitter" so the exponential growth is exact.
    monkeypatch.setattr(llm_service.random, "uniform", lambda low, high: 1.0)
    slept = _record_sleeps(monkeypatch)

    calls: list[str] = []

    def flaky(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        calls.append(model)
        if len(calls) < 3:
            raise llm_service._TransientLLMError("503 high demand")
        return "recovered"

    monkeypatch.setattr(llm_service, "_chat_once", flaky)

    out = llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )
    assert out == "recovered"
    assert len(calls) == 3
    # 1s before the second attempt, 2s before the third.
    assert slept == [1.0, 2.0]


def test_backoff_wait_is_randomised_so_retries_do_not_hammer(monkeypatch) -> None:
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_MAX_BACKOFF_SECONDS", 60.0)
    slept = _record_sleeps(monkeypatch)

    monkeypatch.setattr(llm_service.random, "uniform", lambda low, high: low)
    llm_service._sleep_before_retry(base=2.0, retry_after=None)
    monkeypatch.setattr(llm_service.random, "uniform", lambda low, high: high)
    llm_service._sleep_before_retry(base=2.0, retry_after=None)

    # 0.5x and 1.5x of the same base: the delay is jittered, never identical.
    assert slept == [1.0, 3.0]


def test_retry_after_from_the_provider_is_honoured(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="", attempts=2)
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_MAX_BACKOFF_SECONDS", 30.0)
    slept = _record_sleeps(monkeypatch)

    calls: list[int] = []

    def flaky(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise llm_service._TransientLLMError("429 rate limited", retry_after=5.0)
        return "ok"

    monkeypatch.setattr(llm_service, "_chat_once", flaky)

    assert (
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )
        == "ok"
    )
    # Waited exactly as long as the provider asked, not a guessed backoff.
    assert slept == [5.0]


def test_retry_after_is_capped_so_a_request_cannot_hang(monkeypatch) -> None:
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_MAX_BACKOFF_SECONDS", 3.0)
    slept = _record_sleeps(monkeypatch)

    llm_service._sleep_before_retry(base=0.1, retry_after=600.0)

    assert slept == [3.0]


def test_a_503_is_retried_then_succeeds(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="", attempts=3)
    _use(
        monkeypatch,
        _FakeResponse(503, '{"error": "high demand"}', headers={"Retry-After": "2"}),
        _FakeResponse(200, content="generated"),
    )
    slept = _record_sleeps(monkeypatch)

    out = llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )

    assert out == "generated"
    assert slept == [2.0]


def test_a_429_is_retried_then_succeeds(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="", attempts=3)
    _use(monkeypatch, _FakeResponse(429, "quota"), _FakeResponse(200, content="generated"))
    _record_sleeps(monkeypatch)

    out = llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )

    assert out == "generated"


def test_exhausted_retries_report_one_clear_busy_message(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="backup-a", attempts=2)
    _record_sleeps(monkeypatch)

    def busy(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        raise llm_service._TransientLLMError(
            f"The language model provider gemini ({model}) had a server error "
            f"(HTTP 503). This model is currently experiencing high demand."
        )

    monkeypatch.setattr(llm_service, "_chat_once", busy)

    with pytest.raises(llm_service.LLMError) as exc:
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )

    message = str(exc.value)
    assert message == llm_service.BUSY_MESSAGE
    assert llm_service.BUSY_MESSAGE == (
        "The AI service is temporarily busy. Please try again shortly."
    )
    # The last provider detail is kept for diagnosis (chained), and the error
    # never pretends to be a successful answer.
    assert "HTTP 503" in str(exc.value.__cause__)
    assert not isinstance(exc.value, llm_service._TransientLLMError)


def test_a_permanent_failure_is_not_retried_or_switched(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="backup-a", attempts=3)
    slept = _record_sleeps(monkeypatch)
    calls: list[str] = []

    def rejected(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        calls.append(model)
        raise llm_service.LLMError("The API key was rejected (HTTP 401).")

    monkeypatch.setattr(llm_service, "_chat_once", rejected)

    with pytest.raises(llm_service.LLMError) as exc:
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )

    # No retry, no fallback model, no waiting around.
    assert calls == ["primary"]
    assert slept == []
    assert "HTTP 401" in str(exc.value)


# ----------------------------------------------------------------------
# Exhausted quota (429 with a long retry hint) vs a short rate limit
# ----------------------------------------------------------------------

# The exact wording Google returns for a free-tier daily quota refusal.
_QUOTA_BODY = (
    '[{"error": {"code": 429, "message": "You exceeded your current quota, '
    'please check your plan and billing details. ... * Quota exceeded for metric: '
    'generativelanguage.googleapis.com/generate_content_free_tier_requests, '
    'limit: 20, model: gemini-3-flash. Please retry in 7h40m36.256585088s.", '
    '"status": "RESOURCE_EXHAUSTED", "details": [{"retryDelay": "27636s"}]}}]'
)


def test_retry_delay_is_read_from_the_gemini_quota_body() -> None:
    # The structured field and the human wording both parse to seconds.
    assert llm_service._retry_delay_from_body(_QUOTA_BODY) == 27636.0
    assert (
        llm_service._retry_delay_from_body("... Please retry in 7h40m36.25s.") == 27636.25
    )
    assert llm_service._retry_delay_from_body("Please retry in 1m30s.") == 90.0
    assert llm_service._retry_delay_from_body("Please retry in 45s.") == 45.0


def test_retry_delay_from_body_is_none_when_absent_or_unparseable() -> None:
    assert llm_service._retry_delay_from_body("") is None
    assert llm_service._retry_delay_from_body("high demand") is None
    assert llm_service._retry_delay_from_body('{"error": "rate limited"}') is None


def test_retry_delay_seconds_prefers_the_header_over_the_body() -> None:
    response = _FakeResponse(429, "Please retry in 3600s.", headers={"Retry-After": "5"})
    assert llm_service._retry_delay_seconds(response) == 5.0
    # Without a header the body hint is used.
    assert llm_service._retry_delay_seconds(_FakeResponse(429, "Please retry in 3600s.")) == 3600.0
    assert llm_service._retry_delay_seconds(_FakeResponse(429, "no hint")) is None


def test_humanize_seconds_reads_naturally() -> None:
    assert llm_service._humanize_seconds(45) == "45s"
    assert llm_service._humanize_seconds(150) == "2m 30s"
    assert llm_service._humanize_seconds(27636) == "7h 40m"


def test_a_429_quoting_a_long_wait_is_an_exhausted_quota(monkeypatch) -> None:
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_MAX_BACKOFF_SECONDS", 10.0)
    _use(monkeypatch, _FakeResponse(429, _QUOTA_BODY))

    with pytest.raises(llm_service._QuotaLLMError) as exc:
        llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)

    message = str(exc.value)
    assert "quota" in message.lower()
    assert "7h 40m" in message  # the provider's own wait, humanised
    assert message != llm_service.BUSY_MESSAGE
    assert exc.value.retry_after == 27636.0


def test_a_429_quoting_a_short_wait_is_still_a_transient_retry(monkeypatch) -> None:
    monkeypatch.setattr(llm_service.settings, "LLM_RETRY_MAX_BACKOFF_SECONDS", 10.0)
    # A per-minute rate limit ("retry in 3s") must stay retryable.
    _use(monkeypatch, _FakeResponse(429, "Rate limited. Please retry in 3s."))

    with pytest.raises(llm_service._TransientLLMError) as exc:
        llm_service._chat_once("m", [{"role": "user", "content": "x"}], 10, 0.0)
    assert not isinstance(exc.value, llm_service._QuotaLLMError)


def test_quota_error_skips_same_model_but_tries_the_next_model(monkeypatch) -> None:
    _configure(monkeypatch, attempts=3)
    tried: list[str] = []

    def fake_once(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        tried.append(model)
        if model == "primary":
            raise llm_service._QuotaLLMError(
                "quota exhausted for primary", retry_after=27636.0
            )
        return f"answer from {model}"

    monkeypatch.setattr(llm_service, "_chat_once", fake_once)

    out = llm_service._chat_with_failover(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
    )
    # The quota-limited model is never retried, but the fallback still runs.
    assert out == "answer from backup-a"
    assert tried == ["primary", "backup-a"]


def test_quota_exhaustion_on_every_model_reports_quota_not_busy(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="backup-a", attempts=3)
    slept = _record_sleeps(monkeypatch)

    def exhausted(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        raise llm_service._QuotaLLMError(
            f"The quota for the language model gemini ({model}) is exhausted (HTTP 429).",
            retry_after=27636.0,
        )

    monkeypatch.setattr(llm_service, "_chat_once", exhausted)

    with pytest.raises(llm_service.LLMError) as exc:
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )

    # The user gets the actionable reason, not "temporarily busy", and no
    # pointless waiting happened.
    assert "quota" in str(exc.value).lower()
    assert str(exc.value) != llm_service.BUSY_MESSAGE
    assert slept == []


def test_quota_and_busy_mixed_reports_the_quota(monkeypatch) -> None:
    _configure(monkeypatch, fallbacks="backup-a", attempts=1)

    def mixed(model, messages, max_tokens, temperature, json_mode=False, **kwargs):
        if model == "primary":
            raise llm_service._QuotaLLMError("quota exhausted", retry_after=27636.0)
        raise llm_service._TransientLLMError("503 high demand")

    monkeypatch.setattr(llm_service, "_chat_once", mixed)

    with pytest.raises(llm_service.LLMError) as exc:
        llm_service._chat_with_failover(
            [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.0
        )
    # The exhausted quota is the more actionable cause — it will not clear in
    # seconds — so it wins over the generic busy wording.
    assert "quota" in str(exc.value).lower()
