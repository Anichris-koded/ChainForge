from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class HumanitarianVerificationDetailsV2(BaseModel):
    verdict: Literal["credible", "partially_credible", "inconclusive", "not_credible"] = Field(description="The verification verdict")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score between 0.0 and 1.0")
    summary: str = Field(description="Neutral summary of the claim verification")
    criteria_assessment: Optional[List[Dict[str, Any]]] = Field(default=None, description="Detailed assessment mapping to Sphere criteria")
    risk_flags: Optional[List[str]] = Field(default=None, description="Identified risk flags")
    missing_information: Optional[List[str]] = Field(default=None, description="List of missing information needed")
    recommended_next_steps: Optional[List[str]] = Field(default=None, description="Recommended next steps")


class HumanitarianVerificationResponseV2(BaseModel):
    success: bool
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt_variant: Optional[str] = None
    verification: Optional[HumanitarianVerificationDetailsV2] = None
    error: Optional[str] = None
    model_version: Optional[str] = None
    stamp: Optional[Dict[str, str]] = None

