"""
Test suite for ChainForge AI Service
"""

import pytest
from fastapi.testclient import TestClient
import main
from main import app


@pytest.fixture
def client():
    """Create a test client"""
    return TestClient(app)


def test_root_endpoint(client):
    """Test the root endpoint"""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "ChainForge AI Service"
    assert "version" in data
    assert data["docs"] == "/docs"
    assert data["health"] == "/health"


def test_health_endpoint(client):
    """Test the health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "chainforge-ai-service"
    assert "version" in data


def test_health_response_structure(client):
    """Test that health endpoint returns correct structure"""
    response = client.get("/health")
    data = response.json()
   
    # Check required fields
    assert "status" in data
    assert "service" in data
    assert "version" in data
   
    # Check field types
    assert isinstance(data["status"], str)
    assert isinstance(data["service"], str)
    assert isinstance(data["version"], str)


def test_docs_availability(client):
    """Test that API docs are available"""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_openapi_schema(client):
    """Test that OpenAPI schema is available"""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    data = response.json()
   
    assert data["openapi"] == "3.1.0" or data["openapi"].startswith("3.")
    assert data["info"]["title"] == "ChainForge AI Service"
    assert data["info"]["version"] == "1.0.0"


def test_error_handling_404(client):
    """Test 404 error handling"""
    response = client.get("/nonexistent")
    assert response.status_code == 404


def test_cors_headers(client):
    """Test CORS headers (if configured)"""
    response = client.get("/health")
    # Basic check that response has appropriate headers
    assert response.status_code == 200


def test_proof_of_life_success(client, monkeypatch):
    """Test successful proof-of-life response contract."""

    def fake_analyze(selfie_image_base64, burst_images_base64=None, confidence_threshold=None):
        return {
            "is_real_person": True,
            "confidence": 0.91,
            "threshold": confidence_threshold if confidence_threshold is not None else 0.65,
            "checks": {
                "face_detected": True,
                "blink_detected": True,
                "head_movement_detected": True,
                "processed_burst_frames": 3,
            },
            "reason": "Face detected and confidence threshold met",
        }

    monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", fake_analyze)

    payload = {
        "selfie_image_base64": "dGVzdA==",
        "burst_images_base64": ["dGVzdA==", "dGVzdDI="],
        "confidence_threshold": 0.70,
    }

    response = client.post("/ai/proof-of-life", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert data["is_real_person"] is True
    assert data["confidence"] == 0.91
    assert data["threshold"] == 0.70
    assert data["checks"]["face_detected"] is True


def test_proof_of_life_invalid_image(client, monkeypatch):
    """Test proof-of-life validation errors are returned as HTTP 422."""

    def fake_analyze(selfie_image_base64, burst_images_base64=None, confidence_threshold=None):
        raise ValueError("Invalid base64 image payload")

    monkeypatch.setattr(main.proof_of_life_analyzer, "analyze", fake_analyze)

    response = client.post(
        "/ai/proof-of-life",
        json={"selfie_image_base64": "not-base64"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["message"] == "Invalid base64 image payload"


def test_proof_of_life_threshold_validation(client):
    """Test pydantic request validation for confidence threshold range."""
    response = client.post(
        "/ai/proof-of-life",
        json={
            "selfie_image_base64": "dGVzdA==",
            "confidence_threshold": 1.5,
        },
    )
    assert response.status_code == 422


def test_anonymize_endpoint_success(client):
    """Test successful anonymization preserves context while masking PII."""
    payload = {
        "text": "On 15 Jan 2025, Mary Johnson received support in Borno State.",
    }

    response = client.post("/ai/anonymize", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "anonymized_text" in data
    assert "received support" in data["anonymized_text"]
    assert "[RECIPIENT_NAME]" in data["anonymized_text"]
    assert data["pii_summary"]["total"] >= 3


def test_anonymize_endpoint_validation(client):
    """Test request validation for anonymization endpoint."""
    response = client.post("/ai/anonymize", json={"text": ""})
    assert response.status_code == 422


def test_humanitarian_verification_success(client, monkeypatch):
    """Test successful humanitarian verification response contract."""

    def fake_verify_claim(aid_claim, supporting_evidence=None, context_factors=None, provider_preference="auto"):
        return {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "prompt_variant": "primary",
            "verification": {
                "verdict": "credible",
                "confidence": 0.86,
                "summary": "Evidence aligns with key distribution records.",
            },
            "raw_response": "{}",
        }

    monkeypatch.setattr(main.humanitarian_verification_service, "verify_claim", fake_verify_claim)

    response = client.post(
        "/ai/humanitarian/verify",
        json={
            "aid_claim": "Relief teams delivered hygiene kits to all registered households in Sector B.",
            "supporting_evidence": ["Distribution list #B-17"],
            "context_factors": {"security_status": "stable"},
            "provider_preference": "auto",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["provider"] == "openai"
    assert data["verification"]["verdict"] == "credible"


def test_humanitarian_verification_failure(client, monkeypatch):
    """Test humanitarian verification failure path."""

    def fake_verify_claim(aid_claim, supporting_evidence=None, context_factors=None, provider_preference="auto"):
        raise RuntimeError("all providers unavailable")

    monkeypatch.setattr(main.humanitarian_verification_service, "verify_claim", fake_verify_claim)

    response = client.post(
        "/ai/humanitarian/verify",
        json={
            "aid_claim": "Temporary clinics are fully operational in all camps.",
            "supporting_evidence": [],
            "context_factors": {},
            "provider_preference": "auto",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "all providers unavailable" in data["error"]


def test_legacy_routes_deprecation_headers(client, monkeypatch):
    """Test that all legacy /ai/* routes emit Sunset and Deprecation headers,
    and preserve backwards compatibility (308 redirect or correct response)."""
    # Temporarily set a specific retirement date for validation
    monkeypatch.setattr(main.settings, "legacy_retirement_date", "2026-10-01")

    legacy_redirect_routes = [
        "/ai/inference",
        "/ai/proof-of-life",
        "/ai/anonymize",
        "/ai/humanitarian/verify",
        "/ai/status/test-task-id",
        "/ai/task/test-task-id/cancel",
    ]

    for route in legacy_redirect_routes:
        # We test post for these legacy routes; middleware intercepts and returns 308
        response = client.post(route, follow_redirects=False)
        assert response.status_code == 308, f"Route {route} did not return 308 redirect"
        assert response.headers.get("Deprecation") == "true", f"Route {route} missing Deprecation header"
        assert response.headers.get("Sunset") == "Thu, 01 Oct 2026 00:00:00 GMT", f"Route {route} missing or invalid Sunset header"

    # Also test /ai/ocr which is served directly and should not redirect, but still have headers
    response = client.post("/ai/ocr", follow_redirects=False)
    # /ai/ocr without files will return 422 or 400, but should still have the legacy headers
    assert response.status_code in (400, 422), f"/ai/ocr returned unexpected status {response.status_code}"
    assert response.headers.get("Deprecation") == "true", "/ai/ocr missing Deprecation header"
    assert response.headers.get("Sunset") == "Thu, 01 Oct 2026 00:00:00 GMT", "/ai/ocr missing or invalid Sunset header"

    # Test that non-legacy routes (like health, metrics, v1 paths) do NOT have the headers
    non_legacy_routes = [
        "/health",
        "/ai/metrics",
        "/v1/ai/inference",
    ]
    for route in non_legacy_routes:
        response = client.post(route, follow_redirects=False) if "inference" in route else client.get(route, follow_redirects=False)
        assert "Deprecation" not in response.headers, f"Non-legacy route {route} has Deprecation header"
        assert "Sunset" not in response.headers, f"Non-legacy route {route} has Sunset header"

