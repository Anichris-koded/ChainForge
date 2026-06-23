import time
import logging
from threading import Lock

from metrics import (
    CIRCUIT_STATE_CLOSED,
    CIRCUIT_STATE_HALF_OPEN,
    CIRCUIT_STATE_OPEN,
    CIRCUIT_FAILURE_COUNT,
    CIRCUIT_RECOVERY_TIME,
    set_circuit_state,
)

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """
    A thread-safe implementation of the Circuit Breaker pattern.

    States:
    - CLOSED: Normal operation. Requests flow through.
    - OPEN: Service is failing. Requests fail-fast (return False/raise error).
    - HALF_OPEN: Recovery window elapsed. Allow a request to test downstream health.

    The breaker publishes Prometheus metrics on every state change:
      - CIRCUIT_STATE (Gauge): current state, encoded as 0/1/2.
      - CIRCUIT_FAILURE_COUNT (Counter): cumulative failure count.
      - CIRCUIT_RECOVERY_TIME (Histogram): time spent OPEN before HALF_OPEN.
    Metric updates happen inside the same lock that guards state, so the
    exported values can never diverge from the underlying state.
    """

    def __init__(self, name: str, failure_threshold: int = 3, recovery_timeout: float = 30.0):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout

        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self.failure_count = 0
        self.last_state_change = time.time()
        self._lock = Lock()

        # Publish the initial state so the gauge is always defined for
        # every instantiated breaker, even before any traffic flows.
        set_circuit_state(self.name, CIRCUIT_STATE_CLOSED)

    def allow_request(self) -> bool:
        """
        Check if a request is allowed to proceed.
        If in OPEN state and recovery timeout has elapsed, transitions to HALF_OPEN.
        """
        with self._lock:
            now = time.time()
            if self.state == "OPEN":
                if now - self.last_state_change >= self.recovery_timeout:
                    # Capture recovery time BEFORE updating last_state_change,
                    # so the histogram reflects how long we were actually OPEN.
                    recovery_seconds = now - self.last_state_change
                    logger.info(
                        "Circuit breaker for provider '%s' transitioning from OPEN to HALF_OPEN "
                        "(recovery timeout %ss elapsed)",
                        self.name,
                        self.recovery_timeout,
                    )
                    self.state = "HALF_OPEN"
                    self.last_state_change = now
                    set_circuit_state(self.name, CIRCUIT_STATE_HALF_OPEN)
                    CIRCUIT_RECOVERY_TIME.labels(breaker_name=self.name).observe(recovery_seconds)
                    return True
                return False
            return True

    def record_success(self) -> None:
        """
        Record a successful request.
        If in HALF_OPEN, transitions back to CLOSED and resets failure count.
        """
        with self._lock:
            now = time.time()
            if self.state == "HALF_OPEN":
                logger.info(
                    "Circuit breaker for provider '%s' transitioning from HALF_OPEN to CLOSED "
                    "(successful probe request)",
                    self.name,
                )
                self.state = "CLOSED"
                self.failure_count = 0
                self.last_state_change = now
                set_circuit_state(self.name, CIRCUIT_STATE_CLOSED)
            elif self.state == "CLOSED":
                self.failure_count = 0

    def record_failure(self) -> None:
        """
        Record a failed request.
        If in CLOSED and threshold is reached, or if in HALF_OPEN, transitions to OPEN.
        """
        with self._lock:
            now = time.time()
            self.failure_count += 1
            CIRCUIT_FAILURE_COUNT.labels(breaker_name=self.name).inc()
            if self.state == "HALF_OPEN" or self.failure_count >= self.failure_threshold:
                logger.warning(
                    "Circuit breaker for provider '%s' transitioning from %s to OPEN "
                    "(failures: %s, threshold: %s)",
                    self.name,
                    self.state,
                    self.failure_count,
                    self.failure_threshold,
                )
                self.state = "OPEN"
                self.last_state_change = now
                set_circuit_state(self.name, CIRCUIT_STATE_OPEN)
