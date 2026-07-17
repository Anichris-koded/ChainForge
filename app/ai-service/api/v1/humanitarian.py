"""
v1 humanitarian verification endpoint.
"""

import logging

from fastapi import APIRouter

from schemas.humanitarian import (
    HumanitarianVerificationRequest,
    HumanitarianVerificationResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["humanitarian"])


@router.post("/ai/humanitarian/verify", response_model=HumanitarianVerificationResponse)
async def verify_humanitarian_claim(request: HumanitarianVerificationRequest):
    """Verify an aid claim against standardised humanitarian criteria."""
    # Delegate to the singleton owned by main.py so that monkeypatching in
    # tests (and any future dependency-injection wiring) works transparently.
    import main as _main

    logger.info("Processing humanitarian verification request")

    try:
        try:
            result = _main.humanitarian_verification_service.verify_claim(
                aid_claim=request.aid_claim,
                supporting_evidence=request.supporting_evidence,
                context_factors=request.context_factors,
                provider_preference=request.provider_preference,
                timeout=request.timeout,
            )
        except TypeError as exc:
            if "timeout" in str(exc):
                result = _main.humanitarian_verification_service.verify_claim(
                    aid_claim=request.aid_claim,
                    supporting_evidence=request.supporting_evidence,
                    context_factors=request.context_factors,
                    provider_preference=request.provider_preference,
                )
            else:
                raise exc
        from config import settings
        provider = result.get("provider")
        if provider == "openai":
            model_version = settings.openai_model
        elif provider == "groq":
            model_version = settings.groq_model
        else:
            # Default fallback to active provider model or settings.openai_model
            active_p = settings.get_active_provider()
            model_version = settings.groq_model if active_p == "groq" else settings.openai_model

        return HumanitarianVerificationResponse(success=True, model_version=model_version, **result)
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        from config import settings
        active_p = settings.get_active_provider()
        model_version = settings.groq_model if active_p == "groq" else settings.openai_model
        return HumanitarianVerificationResponse(success=False, error=str(e), model_version=model_version)

