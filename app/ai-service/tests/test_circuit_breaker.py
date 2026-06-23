import pytest
import time
import httpx
from unittest.mock import patch, MagicMock

from services.circuit_breaker import CircuitBreaker
from services.humanitarian_verification import HumanitarianVerificationService
from exceptions import AIServiceError
from config import settings
import metrics
from prometheus_client import REGISTRY


def test_circuit_breaker_basic_transitions():
    # Set a short recovery timeout for fast testing
    breaker = CircuitBreaker("test-provider", failure_threshold=2, recovery_timeout=0.1)

    # 1. Starts CLOSED
    assert breaker.state == "CLOSED"
    assert breaker.allow_request() is True

    # 2. First failure
    breaker.record_failure()
    assert breaker.state == "CLOSED"  # Not tripped yet
    assert breaker.allow_request() is True

    # 3. Second failure (reaches threshold)
    breaker.record_failure()
    assert breaker.state == "OPEN"
    assert breaker.allow_request() is False  # Tripped

    # 4. Wait for recovery timeout
    time.sleep(0.12)

    # 5. Transitions to HALF_OPEN on allow_request check
    assert breaker.allow_request() is True
    assert breaker.state == "HALF_OPEN"

    # 6. Success closes the circuit
    breaker.record_success()
    assert breaker.state == "CLOSED"
    assert breaker.failure_count == 0

def test_circuit_breaker_half_open_failure():
    breaker = CircuitBreaker("test-provider", failure_threshold=2, recovery_timeout=0.1)
   
    # Trip the breaker
    breaker.record_failure()
    breaker.record_failure()
    assert breaker.state == "OPEN"
   
    # Wait for recovery timeout
    time.sleep(0.12)
    assert breaker.allow_request() is True
    assert breaker.state == "HALF_OPEN"
   
    # Failure in HALF_OPEN trips it immediately to OPEN
    breaker.record_failure()
    assert breaker.state == "OPEN"
    assert breaker.allow_request() is False


class TestHumanitarianVerificationServiceCircuitBreaker:
    def setup_method(self):
        self.service = HumanitarianVerificationService()
        # Set short recovery timeout and threshold for testing
        for breaker in self.service.breakers.values():
            breaker.failure_threshold = 2
            breaker.recovery_timeout = 0.1

    def test_verify_claim_skips_provider_when_circuit_open(self, monkeypatch):
        # Configure service to use both openai and groq
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(settings, "groq_api_key", "test-key")
       
        # Mock provider attempt order to try openai first, then groq
        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda pref: ["openai", "groq"])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")
       
        # Trip the openai breaker
        openai_breaker = self.service.breakers["openai"]
        openai_breaker.record_failure()
        openai_breaker.record_failure()
        assert openai_breaker.state == "OPEN"
       
        # Mock _call_provider for both
        calls = []
        def fake_call_provider(provider, model, system_prompt, user_prompt, timeout=None):
            calls.append(provider)
            return '{"verdict": "credible", "confidence": 0.8, "summary": "test"}'
           
        monkeypatch.setattr(self.service, "_call_provider", fake_call_provider)
       
        # Execute verification
        result = self.service.verify_claim(
            aid_claim="Food aid reached target demographic.",
            supporting_evidence=[],
            context_factors={},
            provider_preference="auto"
        )
       
        # openai should have been skipped entirely (no call made to openai)
        assert "openai" not in calls
        assert "groq" in calls
        assert result["provider"] == "groq"

    @patch("httpx.Client.post")
    def test_request_timeout_raises_ai_timeout(self, mock_post, monkeypatch):
        # Configure key to enable openai
        monkeypatch.setattr(settings, "openai_api_key", "test-key")
        monkeypatch.setattr(self.service, "_provider_attempt_order", lambda pref: ["openai"])
        monkeypatch.setattr(self.service, "_get_model_for_provider", lambda p: "test-model")
       
        # Mock httpx.Client.post to raise a timeout
        mock_post.side_effect = httpx.TimeoutException("Connection timed out")
       
        with pytest.raises(RuntimeError) as exc_info:
            self.service.verify_claim(
                aid_claim="Food aid reached target demographic.",
                supporting_evidence=[],
                context_factors={},
                provider_preference="openai",
                timeout=1.5
            )
           
        # The exception raised inside verify_claim loop should be caught, recorded as failure,
        # and since all providers fail, a RuntimeError is raised containing the error.
        assert "AI_TIMEOUT" in str(exc_info.value)
        assert "LLM request timed out after 1.5s" in str(exc_info.value)
       
        # The breaker for openai should have recorded the failure
        assert self.service.breakers["openai"].failure_count == 2  # Primary & fallback attempts both failed


def _sample(name: str, labels: dict) -> float:
    """Read a sample value directly from the Prometheus registry."""
    return REGISTRY.get_sample_value(name, labels)


class TestCircuitBreakerMetrics:
    """Verify that CircuitBreaker publishes the metrics defined in metrics.py."""

    def test_initial_state_is_published(self):
        # Using a fresh breaker name ensures labels don't collide with other tests.
        CircuitBreaker("metrics-initial", failure_threshold=1, recovery_timeout=0.1)
        assert (
            _sample("circuit_breaker_state", {"breaker_name": "metrics-initial"}) == 0
        )

    def test_failure_increments_counter_and_trips_state(self):
        breaker = CircuitBreaker(
            "metrics-failures", failure_threshold=2, recovery_timeout=0.1
        )
        before = _sample(
            "circuit_breaker_failure_count_total", {"breaker_name": "metrics-failures"}
        ) or 0.0

        breaker.record_failure()
        after_one = _sample(
            "circuit_breaker_failure_count_total", {"breaker_name": "metrics-failures"}
        )
        assert after_one == before + 1
        # State stays CLOSED below threshold
        assert _sample("circuit_breaker_state", {"breaker_name": "metrics-failures"}) == 0

        breaker.record_failure()
        # Threshold reached -> gauge flips to OPEN (2)
        assert _sample("circuit_breaker_state", {"breaker_name": "metrics-failures"}) == 2

    def test_recovery_updates_histogram_and_state_gauge(self):
        breaker = CircuitBreaker(
            "metrics-recovery", failure_threshold=1, recovery_timeout=0.05
        )
        breaker.record_failure()  # trips immediately
        assert _sample("circuit_breaker_state", {"breaker_name": "metrics-recovery"}) == 2

        time.sleep(0.07)
        # allow_request triggers the OPEN -> HALF_OPEN transition
        assert breaker.allow_request() is True

        assert _sample("circuit_breaker_state", {"breaker_name": "metrics-recovery"}) == 1

        sum_value = _sample(
            "circuit_breaker_recovery_time_seconds_sum",
            {"breaker_name": "metrics-recovery"},
        )
        count_value = _sample(
            "circuit_breaker_recovery_time_seconds_count",
            {"breaker_name": "metrics-recovery"},
        )
        assert count_value is not None and count_value >= 1
        assert sum_value is not None and sum_value >= 0.05

    def test_success_closes_circuit_and_resets_state_gauge(self):
        breaker = CircuitBreaker(
            "metrics-success", failure_threshold=1, recovery_timeout=0.05
        )
        breaker.record_failure()
        time.sleep(0.07)
        breaker.allow_request()  # -> HALF_OPEN
        breaker.record_success()

        assert _sample("circuit_breaker_state", {"breaker_name": "metrics-success"}) == 0

    def test_half_open_failure_increments_counter_and_reopens(self):
        """A failure during the HALF_OPEN probe must be counted and reopen the
        circuit. Without this, callers would never see the breaker come back
        online after a successful probe that subsequently fails."""
        breaker = CircuitBreaker(
            "metrics-half-open-failure",
            failure_threshold=1,
            recovery_timeout=0.05,
        )
        breaker.record_failure()  # CLOSED -> OPEN
        time.sleep(0.07)
        breaker.allow_request()  # OPEN -> HALF_OPEN

        counter_before_probe = _sample(
            "circuit_breaker_failure_count_total",
            {"breaker_name": "metrics-half-open-failure"},
        )
        assert (
            _sample("circuit_breaker_state", {"breaker_name": "metrics-half-open-failure"})
            == 1
        )

        breaker.record_failure()  # HALF_OPEN -> OPEN
        counter_after_probe = _sample(
            "circuit_breaker_failure_count_total",
            {"breaker_name": "metrics-half-open-failure"},
        )
        assert counter_after_probe is not None
        assert counter_before_probe is not None
        assert counter_after_probe == counter_before_probe + 1
        assert (
            _sample("circuit_breaker_state", {"breaker_name": "metrics-half-open-failure"})
            == 2
        )
        # request rejected because we just re-opened
        assert breaker.allow_request() is False
