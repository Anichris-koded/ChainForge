"""
ChainForge AI Service - FastAPI Application
Main entry point for the AI service layer.

"""

from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import json
import logging

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import JSONResponse, RedirectResponse, Response
from exceptions import AIServiceError
from schemas.errors import ErrorDetail, ErrorEnvelope
import time
import metrics
import email.utils
from datetime import datetime, timezone

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


from api.routes import router as ocr_router

# New versioned router
from api.v1.router import v1_router

from config import settings
import tasks
from proof_of_life import ProofOfLifeAnalyzer, ProofOfLifeConfig
from schemas.anonymization import AnonymizeRequest, AnonymizeResponse
from services.pii_scrubber import PIIScrubberService
from schemas.humanitarian import (
    HumanitarianVerificationRequest,
    HumanitarianVerificationResponse,
)
from services.humanitarian_verification import HumanitarianVerificationService

class HTTPBodyTooLarge(Exception):
    """Internal signal raised when an incoming request body exceeds the
    configured `max_request_body_bytes` limit. Caught and converted to a
    413 response by :class:`MaxRequestBodySizeMiddleware`."""

    def __init__(self, limit: int, observed: int):
        super().__init__(
            f"Request body of {observed} bytes exceeds limit of {limit} bytes"
        )
        self.limit = limit
        self.observed = observed


class HTTPBodyLengthMismatch(Exception):
    """Internal signal raised when an incoming request body exceeds the
    declared Content-Length header value. Caught and converted to a
    400 response by :class:`MaxRequestBodySizeMiddleware`."""

    def __init__(self, declared: int, observed: int):
        super().__init__(
            f"Observed body size of {observed} bytes exceeds declared Content-Length of {declared} bytes"
        )
        self.declared = declared
        self.observed = observed


class MaxRequestBodySizeMiddleware:
    """Reject HTTP requests whose body would exceed ``max_bytes``.

    The middleware sits at the outer edge of the ASGI stack so that oversized
    requests are rejected *before* any other middleware (redirects,
    observability, rate limiting) or the application itself buffers the body.
    It is DoS-grade protection: clients can trip the limit either by sending a
    ``Content-Length`` header that exceeds the cap, or by streaming more bytes
    than the cap via chunked transfer encoding.

    The middleware intentionally wraps the raw ASGI ``receive`` callable rather
    than using Starlette's ``BaseHTTPMiddleware`` — ``BaseHTTPMiddleware``
    buffers the body in-memory which defeats the point of the limit.
    """

    METHODS_WITH_BODY = ("POST", "PUT", "PATCH")

    def __init__(self, app, max_bytes: int, bypass_prefixes: Optional[List[str]] = None):
        self.app = app
        # Treat non-positive values as "disabled" — useful for tests that
        # don't want the limit to interfere.
        self.max_bytes = max_bytes if max_bytes and max_bytes > 0 else None
        # Always skip health/metrics/docs endpoints to match the pattern used
        # by monitor_requests. Allow additional prefixes via settings.
        default_bypass = [
            "/health",
            "/",
            "/ai/metrics",
            "/docs",
            "/redoc",
            "/openapi.json",
        ]
        self.bypass_prefixes = tuple({*(default_bypass), *(bypass_prefixes or [])})

    def _is_bypassed(self, path: str) -> bool:
        if path in self.bypass_prefixes:
            return True
        # Prefix matching only applies to entries that explicitly opt in
        # via a trailing '/'.  The root '/' is intentionally excluded:
        # otherwise every HTTP path (which all begin with '/') would be
        # bypassed.
        return any(
            path.startswith(p)
            for p in self.bypass_prefixes
            if p.endswith("/") and p != "/"
        )

    async def __call__(self, scope, receive, send):
        # Only operate on HTTP requests; pass through WebSocket / lifespan.
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        # No limit configured or no body expected — no-op.
        if self.max_bytes is None or scope["method"] not in self.METHODS_WITH_BODY:
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        if self._is_bypassed(path):
            return await self.app(scope, receive, send)

        declared_content_length = None

        # Eager check on Content-Length. If the client declared a body
        # larger than the limit, reject immediately without consuming any
        # bytes off the wire.
        try:
            content_length_hdr = None
            for name, value in scope.get("headers", []):
                if name == b"content-length":
                    content_length_hdr = value.decode("latin-1")
                    break
            if content_length_hdr is not None:
                declared_content_length = int(content_length_hdr)
                if declared_content_length > self.max_bytes:
                    await self._log_rejection(
                        scope,
                        declared_or_observed=declared_content_length,
                        reason="declared_size",
                    )
                    return await self._send_413(
                        send,
                        observed=declared_content_length,
                        reason="declared_size",
                    )
        except (ValueError, TypeError):
            # Malformed Content-Length — fall through to stream counting.
            pass

        total = 0

        async def wrapped_receive():
            nonlocal total
            message = await receive()
            mtype = message.get("type")
            if mtype == "http.request":
                chunk = message.get("body", b"")
                total += len(chunk)

                # Check if the streamed bytes exceed the client's declared Content-Length
                if declared_content_length is not None and total > declared_content_length:
                    raise HTTPBodyLengthMismatch(declared_content_length, total)

                # Check if the streamed bytes exceed the maximum allowed size limit
                if total > self.max_bytes:
                    # Signal the exception so that the outer __call__ can
                    # emit a 413 even if the application has already started
                    # producing a response.
                    raise HTTPBodyTooLarge(self.max_bytes, total)
            return message

        try:
            await self.app(scope, wrapped_receive, send)
        except HTTPBodyTooLarge as exc:
            await self._log_rejection(
                scope,
                declared_or_observed=exc.observed,
                reason="streamed_size",
            )
            await self._send_413(
                send,
                observed=exc.observed,
                reason="streamed_size",
            )
        except HTTPBodyLengthMismatch as exc:
            await self._log_rejection(
                scope,
                declared_or_observed=exc.observed,
                reason="length_mismatch",
            )
            await self._send_400_mismatch(
                send,
                declared=exc.declared,
                observed=exc.observed,
            )

    async def _send_413(self, send, observed: int, reason: str):
        """Emit a JSON 413 response using the project's ErrorEnvelope shape.

        ``reason`` distinguishes eager (Content-Length) rejection from
        streamed rejection; the message is worded accordingly so the
        response is precise and not misleading.
        """
        if reason == "declared_size":
            msg = (
                f"Declared request body of {observed} bytes exceeds the "
                f"maximum allowed size of {self.max_bytes} bytes."
            )
        else:
            msg = (
                f"Request body streamed so far ({observed} bytes) exceeds "
                f"the maximum allowed size of {self.max_bytes} bytes."
            )

        envelope = ErrorEnvelope(
            error=ErrorDetail(
                code="PAYLOAD_TOO_LARGE",
                message=msg,
            )
        ).model_dump()
        body = json.dumps(envelope).encode("utf-8")

        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def _send_400_mismatch(self, send, declared: int, observed: int):
        """Emit a JSON 400 Bad Request response when streamed body size
        exceeds the declared Content-Length header.
        """
        msg = (
            f"Request body size of {observed} bytes exceeds the declared "
            f"Content-Length of {declared} bytes."
        )
        envelope = ErrorEnvelope(
            error=ErrorDetail(
                code="CODE_BODY_LENGTH_MISMATCH",
                message=msg,
            )
        ).model_dump()
        body = json.dumps(envelope).encode("utf-8")

        await send(
            {
                "type": "http.response.start",
                "status": 400,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def _log_rejection(
        self,
        scope,
        declared_or_observed: int,
        reason: str,
    ) -> None:
        """Emit a structured warning so operators can correlate DoS attempts.

        ``reason`` is either ``"declared_size"`` (Content-Length spoofing)
        or ``"streamed_size"`` (chunked transfer smuggling), or ``"length_mismatch"``,
        so logs differentiate between attack classes.
        """
        client = scope.get("client")
        client_str = f"{client[0]}:{client[1]}" if client else "unknown"
        logger.warning(
            "request body rejected: method=%s path=%s bytes=%d limit=%d "
            "client=%s reason=%s",
            scope.get("method"),
            scope.get("path"),
            declared_or_observed,
            self.max_bytes,
            client_str,
            reason,
        )


limiter = Limiter(key_func=get_remote_address)

log_level_name = settings.log_level.upper() if hasattr(settings, "log_level") else "INFO"
log_level = getattr(logging, log_level_name, logging.INFO)
logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Legacy -> v1 redirect map
# Only routes that were previously registered directly on the app (not via
# the ocr_router) need an explicit redirect entry here.  The OCR route is
# still served by the legacy router above so no redirect is needed for it.
# ---------------------------------------------------------------------------
import os
from typing import Dict, List, Tuple, Type
from pydantic import BaseModel
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

class LegacyPrefixMapItem(BaseModel):
    legacy_prefix: str
    v1_prefix: str

class LegacyRedirectsConfig(BaseSettings):
    legacy_to_v1: Dict[str, str]
    legacy_prefix_map: List[LegacyPrefixMapItem]

    model_config = SettingsConfigDict(
        yaml_file=os.path.join(os.path.dirname(__file__), "config", "legacy_redirects.yaml"),
        yaml_file_encoding='utf-8'
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: Type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        return (YamlConfigSettingsSource(settings_cls),)

_legacy_yaml_path = os.path.join(os.path.dirname(__file__), "config", "legacy_redirects.yaml")
if not os.path.exists(_legacy_yaml_path):
    raise RuntimeError(f"Required configuration file not found: {_legacy_yaml_path}")

_legacy_config = LegacyRedirectsConfig()

_LEGACY_TO_V1: dict = _legacy_config.legacy_to_v1
_LEGACY_PREFIX_MAP: list = [
    (item.legacy_prefix, item.v1_prefix) for item in _legacy_config.legacy_prefix_map
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up ChainForge AI Service...")
    if not settings.validate_api_keys():
        logger.warning("No API keys configured. AI features will be unavailable.")
    else:
        provider = settings.get_active_provider()
        logger.info(f"AI provider configured: {provider}")

    logger.info(f"Redis configured: {settings.redis_url}")
    logger.info(f"Backend webhook URL: {settings.backend_webhook_url}")

    yield
    logger.info("Shutting down ChainForge AI Service...")


app = FastAPI(
    title="ChainForge AI Service",
    description="AI service layer for the ChainForge platform using FastAPI",
    version="1.0.0",
    lifespan=lifespan,
)

# Register the body-size limit at the outermost layer so it short-circuits
# before legacy redirects, observability middleware, or any handler buffers
# the request body.
_bypass_paths = [
    p.strip()
    for p in (settings.request_body_bypass_paths or "").split(",")
    if p.strip()
]
app.add_middleware(
    MaxRequestBodySizeMiddleware,
    max_bytes=settings.max_request_body_bytes,
    bypass_prefixes=_bypass_paths,
)

proof_of_life_analyzer = ProofOfLifeAnalyzer(
    config=ProofOfLifeConfig(
        confidence_threshold=settings.proof_of_life_confidence_threshold,
        min_face_size=settings.proof_of_life_min_face_size,
    )
)
pii_scrubber_service = PIIScrubberService()
humanitarian_verification_service = HumanitarianVerificationService()


class InferenceRequest(BaseModel):
    """Request model for AI inference endpoints"""

    type: str = "inference"
    data: Optional[Dict[str, Any]] = None
    priority: Optional[str] = "normal"


class TaskStatusResponse(BaseModel):
    """Response model for task status"""

    task_id: str
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None


class ProofOfLifeRequest(BaseModel):
    """Request model for proof-of-life selfie and optional burst frames."""

    selfie_image_base64: str
    burst_images_base64: Optional[List[str]] = None
    confidence_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ProofOfLifeResponse(BaseModel):
    """Response model for proof-of-life analysis."""

    is_real_person: bool
    confidence: float
    threshold: float
    checks: Dict[str, Any]
    reason: str


# Middleware

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def get_sunset_header_value() -> str:
    val = settings.legacy_retirement_date
    if not val:
        return ""
    val = val.strip()
    # Try parsing various date formats to normalize to RFC 1123
    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%a, %d %b %Y %H:%M:%S",
    ):
        try:
            dt = datetime.strptime(val, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return email.utils.format_datetime(dt, usegmt=True)
        except ValueError:
            continue
    try:
        dt = email.utils.parsedate_to_datetime(val)
        return email.utils.format_datetime(dt, usegmt=True)
    except Exception:
        pass
    return val


@app.middleware("http")
async def legacy_redirect_middleware(request: Request, call_next):
    """
    Transparently redirect un-versioned /ai/* paths to their /v1
    equivalents with a 308 Permanent Redirect so that HTTP clients
    preserve the original request method and body.

    The /ai/ocr route is intentionally excluded because it is still
    served directly by the legacy router; the redirect would send clients
    to a /v1/ai/ocr path that also works, but the legacy path remains
    fully functional during the transition period.

    The /ai/metrics path is also excluded - it has no v1 equivalent.
    """
    path = request.url.path
    is_legacy = path.startswith("/ai/") and path != "/ai/metrics"

    response = None
    if is_legacy:
        # Exact-match redirects
        if path in _LEGACY_TO_V1:
            target = _LEGACY_TO_V1[path]
            if request.url.query:
                target = f"{target}?{request.url.query}"
            logger.debug(f"Legacy redirect: {path} -> {target}")
            response = RedirectResponse(url=target, status_code=308)
        else:
            # Prefix-based redirects (parameterised routes)
            for legacy_prefix, v1_prefix in _LEGACY_PREFIX_MAP:
                if path.startswith(legacy_prefix):
                    target = v1_prefix + path[len(legacy_prefix) :]
                    if request.url.query:
                        target = f"{target}?{request.url.query}"
                    logger.debug(f"Legacy prefix redirect: {path} -> {target}")
                    response = RedirectResponse(url=target, status_code=308)
                    break

    if response is None:
        response = await call_next(request)

    if is_legacy:
        sunset_val = get_sunset_header_value()
        if sunset_val:
            response.headers["Sunset"] = sunset_val
        response.headers["Deprecation"] = "true"

    return response


@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    path = request.url.path

    # Paths that must NEVER be throttled:
    #   /health        – load-balancer probes must always succeed
    #   /              – root discovery endpoint
    #   /docs, /redoc, /openapi.json – API docs
    #   /ai/metrics    – Prometheus scrape (also avoids infinite loop)
    #   Any path in _LEGACY_TO_V1 or matching _LEGACY_PREFIX_MAP – these are
    #     cheap 308 redirects issued by legacy_redirect_middleware; the actual
    #     work happens on the /v1/* destination, which IS subject to throttling.
    _NEVER_THROTTLE = {
        "/health",
        "/",
        "/ai/metrics",
        "/docs",
        "/redoc",
        "/openapi.json",
    }

    is_redirect_path = path in _LEGACY_TO_V1 or any(
        path.startswith(pfx) for pfx, _ in _LEGACY_PREFIX_MAP
    )

    if path in _NEVER_THROTTLE or is_redirect_path:
        return await call_next(request)

    # Gracefully throttle if memory pressure is critical.
    if not metrics.check_system_resources(memory_threshold_percent=90.0):
        metrics.REQUEST_COUNT.labels(
            method=request.method,
            endpoint=path,
            http_status=503,
        ).inc()
        return JSONResponse(
            status_code=503,
            content={
                "detail": (
                    "Service unavailable: System resources (RAM/VRAM) exhausted, "
                    "gracefully throttling."
                )
            },
        )

    start_time = time.time()
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception as e:
        status_code = 500
        raise e
    finally:
        latency = time.time() - start_time
        metrics.REQUEST_COUNT.labels(
            method=request.method,
            endpoint=path,
            http_status=status_code,
        ).inc()
        metrics.REQUEST_LATENCY.labels(method=request.method, endpoint=path).observe(
            latency
        )

        monitored_prefixes = ("/ai/", "/v1/ai/")
        if any(path.startswith(p) for p in monitored_prefixes):
            metrics.logger.info(f"API route {path} latency: {latency:.4f}s")

    return response


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

# Legacy OCR router - still live for backward compatibility (no redirect).
app.include_router(ocr_router)

# Versioned router - canonical home for all routes going forward.
app.include_router(v1_router)


@app.get("/ai/metrics")
async def get_metrics():
    """Endpoint for Prometheus metrics."""
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "chainforge-ai-service", "version": "1.0.0"}


@app.get("/health/dependencies")
async def health_dependencies():
    """Lightweight dependency probe for staging and CI.

    Checks Redis connectivity, provider configuration readiness, and
    filesystem/temp access.  Never exposes secrets or PII.
    """
    import tempfile
    import os

    checks: Dict[str, Any] = {}

    # --- Redis ---
    try:
        import redis as redis_lib

        r = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        checks["redis"] = {"ok": True}
    except Exception as exc:
        checks["redis"] = {"ok": False, "error": type(exc).__name__}

    # --- Provider config ---
    provider = settings.get_active_provider()
    checks["provider_config"] = {
        "ok": provider is not None,
        "provider": provider or "none",
    }

    # --- Filesystem / temp ---
    try:
        with tempfile.NamedTemporaryFile(delete=True) as tmp:
            tmp.write(b"probe")
        checks["filesystem"] = {"ok": True}
    except Exception as exc:
        checks["filesystem"] = {"ok": False, "error": type(exc).__name__}

    overall_ok = all(v["ok"] for v in checks.values())
    return {
        "status": "ok" if overall_ok else "degraded",
        "checks": checks,
    }


@app.get("/")
async def root():
    return {
        "service": "ChainForge AI Service",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "api_v1": "/v1",
    }


# Legacy inline handlers


@app.post("/ai/inference", include_in_schema=False, deprecated=True)
async def _legacy_create_inference_task(
    request: InferenceRequest, background_tasks: BackgroundTasks
):
    """Deprecated - use /v1/ai/inference instead."""
    logger.info(f"[legacy] Creating inference task of type: {request.type}")

    try:
        task_id = tasks.create_task(
            task_type=request.type,
            payload={
                "data": request.data or {},
                "priority": request.priority or "normal",
            },
        )
        return {
            "success": True,
            "task_id": task_id,
            "status": "pending",
            "message": "Task queued for processing",
            "status_url": f"/v1/ai/status/{task_id}",
        }
    except Exception as e:
        logger.error(f"Failed to create inference task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")


@app.post(
    "/ai/proof-of-life",
    response_model=ProofOfLifeResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_analyze_proof_of_life(request: ProofOfLifeRequest):
    """Deprecated - use /v1/ai/proof-of-life instead."""
    logger.info("[legacy] Processing proof-of-life verification request")

    try:
        result = proof_of_life_analyzer.analyze(
            selfie_image_base64=request.selfie_image_base64,
            burst_images_base64=request.burst_images_base64,
            confidence_threshold=request.confidence_threshold,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Proof-of-life processing failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="Failed to process proof-of-life request"
        )


@app.post(
    "/ai/anonymize",
    response_model=AnonymizeResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_anonymize_text(request: AnonymizeRequest):
    """Deprecated - use /v1/ai/anonymize instead."""
    logger.info("[legacy] Processing privacy-preserving anonymization request")

    try:
        result = pii_scrubber_service.anonymize(request.text)
        return AnonymizeResponse(success=True, **result)
    except Exception as e:
        logger.error(f"Anonymization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to anonymize text")


@app.post(
    "/ai/humanitarian/verify",
    response_model=HumanitarianVerificationResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_verify_humanitarian_claim(request: HumanitarianVerificationRequest):
    """Deprecated - use /v1/ai/humanitarian/verify instead."""
    logger.info("[legacy] Processing humanitarian verification request")

    try:
        try:
            result = humanitarian_verification_service.verify_claim(
                aid_claim=request.aid_claim,
                supporting_evidence=request.supporting_evidence,
                context_factors=request.context_factors,
                provider_preference=request.provider_preference,
                timeout=request.timeout,
            )
        except TypeError as exc:
            if "timeout" in str(exc):
                result = humanitarian_verification_service.verify_claim(
                    aid_claim=request.aid_claim,
                    supporting_evidence=request.supporting_evidence,
                    context_factors=request.context_factors,
                    provider_preference=request.provider_preference,
                )
            else:
                raise exc
        return HumanitarianVerificationResponse(success=True, **result)
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        return HumanitarianVerificationResponse(success=False, error=str(e))


@app.get(
    "/ai/status/{task_id}",
    response_model=TaskStatusResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_get_task_status(task_id: str):
    """Deprecated - use /v1/ai/status/{task_id} instead."""
    logger.info(f"[legacy] Checking status for task: {task_id}")

    try:
        status_info = tasks.get_task_status(task_id)

        if status_info.get("status") == "not_found":
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

        return status_info

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get task status: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get task status: {str(e)}"
        )


@app.post("/ai/task/{task_id}/cancel", include_in_schema=False, deprecated=True)
async def _legacy_cancel_task(task_id: str):
    """Deprecated - use /v1/ai/task/{task_id}/cancel instead."""
    logger.info(f"[legacy] Attempting to cancel task: {task_id}")

    try:
        from celery.result import AsyncResult

        result = AsyncResult(task_id, app=tasks.get_celery_app())
        result.revoke(terminate=True)

        tasks.update_task_status(task_id, "cancelled")

        return {
            "success": True,
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task has been cancelled",
        }

    except Exception as e:
        logger.error(f"Failed to cancel task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel task: {str(e)}")


# ---------------------------------------------------------------------------
# Global error handlers
# ---------------------------------------------------------------------------


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    logger.error(f"HTTP Exception: {exc.status_code} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorEnvelope(
            error=ErrorDetail(code=f"HTTP_{exc.status_code}", message=str(exc.detail))
        ).model_dump(),
    )


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request, exc: StarletteHTTPException):
    return await http_exception_handler(request, exc)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    logger.error(f"Validation error: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="VALIDATION_ERROR",
                message="Request validation failed",
                details=exc.errors(),
            )
        ).model_dump(),
    )


@app.exception_handler(AIServiceError)
async def ai_service_exception_handler(request, exc: AIServiceError):
    logger.error(f"AI service error: {exc.message}", exc_info=True)
    return JSONResponse(
        status_code=502,
        content=ErrorEnvelope(
            error=ErrorDetail(code=exc.code, message=exc.message, details=exc.details)
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled Exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content=ErrorEnvelope(
            error=ErrorDetail(code="INTERNAL_SERVER_ERROR", message="Internal server error")
        ).model_dump(),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")