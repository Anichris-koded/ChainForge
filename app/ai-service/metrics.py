import logging
import psutil
from prometheus_client import Counter, Histogram, Gauge

logger = logging.getLogger(__name__)

# System metrics
MEMORY_USAGE_PERCENT = Gauge('system_memory_usage_percent', 'System memory usage percentage')
VRAM_USAGE_PERCENT = Gauge('system_vram_usage_percent', 'System VRAM usage percentage')

# API metrics
REQUEST_COUNT = Counter('api_request_count', 'Total API request count', ['method', 'endpoint', 'http_status'])
REQUEST_LATENCY = Histogram('api_request_latency_seconds', 'API request latency', ['method', 'endpoint'])

# AI Model metrics
MODEL_LOAD_TIME = Histogram('model_load_time_seconds', 'Model load time in seconds', ['model_name'])
INFERENCE_LATENCY = Histogram('inference_latency_seconds', 'Inference latency in seconds', ['task_type'])
PIPELINE_STEP_LATENCY = Histogram('pipeline_step_latency_seconds', 'Pipeline step latency in seconds', ['step_name'])
PII_MODEL_VERSION = Gauge('pii_model_version', 'PII scrubber model version', ['version'])

# Circuit breaker metrics
# State is encoded numerically so it can be plotted over time:
#   0 = CLOSED (healthy), 1 = HALF_OPEN (probing), 2 = OPEN (failing fast).
CIRCUIT_STATE = Gauge(
    'circuit_breaker_state',
    'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
    ['breaker_name'],
)
CIRCUIT_FAILURE_COUNT = Counter(
    'circuit_breaker_failure_count_total',
    'Total failures recorded by the circuit breaker',
    ['breaker_name'],
)
CIRCUIT_RECOVERY_TIME = Histogram(
    'circuit_breaker_recovery_time_seconds',
    'Time spent in the OPEN state before transitioning to HALF_OPEN',
    ['breaker_name'],
)

# Circuit-breaker state constants. Exported so callers (and tests) can
# compare against the numeric gauge value without hard-coding literals.
CIRCUIT_STATE_CLOSED = 0
CIRCUIT_STATE_HALF_OPEN = 1
CIRCUIT_STATE_OPEN = 2

# Human-readable labels for the encoded gauge values. This keeps the metric
# values and the Grafana/operational mapping aligned with the same constants.
CIRCUIT_STATE_LABELS = {
    CIRCUIT_STATE_CLOSED: 'CLOSED',
    CIRCUIT_STATE_HALF_OPEN: 'HALF_OPEN',
    CIRCUIT_STATE_OPEN: 'OPEN',
}


def set_circuit_state(breaker_name: str, state_value: int) -> None:
    """Helper to update the circuit-state gauge from anywhere."""
    CIRCUIT_STATE.labels(breaker_name=breaker_name).set(state_value)


def check_system_resources(memory_threshold_percent: float = 90.0) -> bool:
    """
    Check if system RAM or VRAM is above threshold.
    Returns True if resources are healthy, False if exhausted.
    """
    # RAM check
    ram = psutil.virtual_memory()
    MEMORY_USAGE_PERCENT.set(ram.percent)
   
    # Try VRAM check if torch is available
    vram_percent = 0.0
    try:
        import torch
        if torch.cuda.is_available():
            vram_used = torch.cuda.memory_allocated()
            vram_total = torch.cuda.get_device_properties(0).total_memory
            if vram_total > 0:
                vram_percent = (vram_used / vram_total) * 100
                VRAM_USAGE_PERCENT.set(vram_percent)
    except ImportError:
        pass

    if ram.percent > memory_threshold_percent or (vram_percent and vram_percent > memory_threshold_percent):
        logger.warning(f"Resource exhaustion detected! RAM: {ram.percent}%, VRAM: {vram_percent}%")
        return False
       
    return True
