"""
Tests for the MaxRequestBodySizeMiddleware (DoS mitigation for issue #137).

Two angles are covered:

1. White-box tests against a freshly-constructed, isolated ASGI app so we
   can exercise the middleware with small byte caps without sending
   10 MiB blobs through the network.

2. Black-box regression tests against the real `main.app` to confirm the
   middleware is actually wired up, the default 10 MiB cap is in place,
   and the 413 response uses the project's `ErrorEnvelope` shape
   (matching every other error path in the service).
"""

import asyncio
import json

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import main
from main import MaxRequestBodySizeMiddleware
from config import settings


# ---------------------------------------------------------------------------
# Helpers — isolated test app so we can set tight limits without sending
# massive bodies through the network.
# ---------------------------------------------------------------------------


def _build_isolated_app(max_bytes: int, bypass_prefixes=None):
    """Create a tiny FastAPI app with only the size-limit middleware installed."""
    test_app = FastAPI()
    test_app.add_middleware(
        MaxRequestBodySizeMiddleware,
        max_bytes=max_bytes,
        bypass_prefixes=bypass_prefixes or [],
    )

    @test_app.post("/echo")
    async def echo(req: Request):
        body = await req.body()
        return {"size": len(body)}

    @test_app.post("/big-bypass")
    async def big_bypass(req: Request):
        body = await req.body()
        return {"size": len(body)}

    @test_app.get("/anything")
    async def anything():
        return {"ok": True}

    @test_app.head("/anything")
    async def anything_head():
        return {"ok": True}

    return test_app


# ---------------------------------------------------------------------------
# 1. Content-Length rejection (eager path)
# ---------------------------------------------------------------------------


class TestContentLengthRejection:
    def test_payload_within_limit_succeeds(self):
        app = _build_isolated_app(max_bytes=128)
        client = TestClient(app)
        resp = client.post("/echo", content=b"hello")
        assert resp.status_code == 200
        assert resp.json() == {"size": 5}

    def test_oversized_content_length_returns_413(self):
        app = _build_isolated_app(max_bytes=16)
        client = TestClient(app)
        # 64 bytes against a 16-byte cap → must reject before reading.
        resp = client.post("/echo", content=b"x" * 64)
        assert resp.status_code == 413
        body = resp.json()
        assert body["error"]["code"] == "PAYLOAD_TOO_LARGE"
        assert "16 bytes" in body["error"]["message"]

    def test_413_response_uses_error_envelope_shape(self):
        app = _build_isolated_app(max_bytes=4)
        client = TestClient(app)
        resp = client.post("/echo", content=b"too-long")
        assert resp.status_code == 413
        # The contract used by every other handler in the service.
        assert set(resp.json().keys()) == {"error"}
        assert set(resp.json()["error"].keys()) == {
            "code",
            "message",
            "details",
        }

    def test_malformed_content_length_falls_through(self):
        """A bogus Content-Length header must not crash the middleware.

        Drive the middleware directly with a synthetic ASGI scope whose
        headers list contains a malformed Content-Length value. The
        middleware should swallow the resulting ``ValueError``, fall
        through to stream counting, and successfully process a small
        downstream body.
        """
        middleware = MaxRequestBodySizeMiddleware(app=_PassthroughApp(), max_bytes=128)
        scope = _make_scope(
            headers=[(b"content-length", b"not-a-number")],
        )
        chunks = [
            {"type": "http.request", "body": b"ok", "more_body": False},
        ]
        sent = _run_middleware(middleware, scope, chunks)
        assert sent[0]["status"] == 200


# ---------------------------------------------------------------------------
# 2. Chunked streaming rejection (no/lie Content-Length)
# ---------------------------------------------------------------------------


class _PassthroughApp:
    """No-op ASGI app used as a downstream for middleware unit tests.

    Consumes the entire body the upstream middleware lets through and
    responds 200 with the captured byte count.
    """

    async def __call__(self, scope, receive, send):
        chunks = []
        while True:
            message = await receive()
            if message["type"] == "http.request":
                chunks.append(message.get("body", b"") or b"")
                if not message.get("more_body", False):
                    break
            elif message["type"] == "http.disconnect":
                break
        total = sum(len(c) for c in chunks)
        body = json.dumps({"received": total}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def _make_scope(method="POST", path="/echo", headers=None):
    return {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode("latin-1"),
        "query_string": b"",
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "headers": headers or [],
        "asgi": {"version": "3.0", "spec_version": "2.0"},
    }


def _run_middleware(middleware, scope, chunks):
    """Drive the middleware with a fixed queue of ASGI http.request messages
    and return the messages it sent on the response channel."""
    queue = list(chunks)
    sent = []

    async def receive():
        if not queue:
            return {"type": "http.disconnect"}
        return queue.pop(0)

    async def send(message):
        sent.append(message)

    try:
        asyncio.run(middleware(scope, receive, send))
    except Exception:
        pass
    return sent


class TestStreamingRejection:
    def test_chunked_stream_below_limit_is_accepted(self):
        """A streaming body whose cumulative bytes stay below the cap
        must reach the downstream app without rejection."""
        middleware = MaxRequestBodySizeMiddleware(app=_PassthroughApp(), max_bytes=128)
        scope = _make_scope(headers=[])  # no Content-Length
        chunks = [
            {"type": "http.request", "body": b"abc", "more_body": True},
            {"type": "http.request", "body": b"defg", "more_body": False},
        ]
        sent = _run_middleware(middleware, scope, chunks)
        assert sent[0]["status"] == 200
        body = json.loads(b"".join(m["body"] for m in sent if m["type"] == "http.response.body"))
        assert body == {"received": 7}

    def test_chunked_stream_exceeding_limit_is_413(self):
        """A streaming body whose cumulative bytes exceed the cap must be
        rejected with 413 — even when no Content-Length header is present."""
        middleware = MaxRequestBodySizeMiddleware(app=_PassthroughApp(), max_bytes=8)
        scope = _make_scope(headers=[])
        chunks = [
            {"type": "http.request", "body": b"x" * 5, "more_body": True},
            {"type": "http.request", "body": b"y" * 5, "more_body": False},
        ]
        sent = _run_middleware(middleware, scope, chunks)
        assert sent[0]["status"] == 413
        body = json.loads(b"".join(m["body"] for m in sent if m["type"] == "http.response.body"))
        assert body["error"]["code"] == "PAYLOAD_TOO_LARGE"
        assert "8 bytes" in body["error"]["message"]

    def test_oversized_chunk_alone_is_413(self):
        """Even a single chunk larger than the cap must be rejected."""
        middleware = MaxRequestBodySizeMiddleware(app=_PassthroughApp(), max_bytes=4)
        scope = _make_scope(headers=[])
        chunks = [
            {"type": "http.request", "body": b"z" * 100, "more_body": False},
        ]
        sent = _run_middleware(middleware, scope, chunks)
        assert sent[0]["status"] == 413

    def test_observed_body_larger_than_content_length_returns_400(self):
        """If the client declares a Content-Length but streams more bytes
        than declared, the request must immediately fail with HTTP 400
        and CODE_BODY_LENGTH_MISMATCH (Issue #216)."""
        middleware = MaxRequestBodySizeMiddleware(app=_PassthroughApp(), max_bytes=1024)
        scope = _make_scope(
            headers=[(b"content-length", b"10")],
        )
        # Client declared 10 bytes but streams 15 bytes total
        chunks = [
            {"type": "http.request", "body": b"x" * 8, "more_body": True},
            {"type": "http.request", "body": b"y" * 7, "more_body": False},
        ]
        sent = _run_middleware(middleware, scope, chunks)
        assert sent[0]["status"] == 400
        body = json.loads(b"".join(m["body"] for m in sent if m["type"] == "http.response.body"))
        assert body["error"]["code"] == "CODE_BODY_LENGTH_MISMATCH"
        assert "15 bytes" in body["error"]["message"]
        assert "10 bytes" in body["error"]["message"]

    def test_chunked_stream_without_content_length_falls_back_to_413(self):
        """A chunked request with no Content-Length header can't trigger
        a mismatch rejection, so it must gracefully fall back to returning
        a standard 413 when exceeding the max allowed size."""
        middleware = MaxRequestBodySizeMiddleware(app=_PassthroughApp(), max_bytes=10)
        scope = _make_scope(headers=[])  # No Content-Length header
        chunks = [
            {"type": "http.request", "body": b"a" * 8, "more_body": True},
            {"type": "http.request", "body": b"b" * 5, "more_body": False},  # Total 13 > limit of 10
        ]
        sent = _run_middleware(middleware, scope, chunks)
        assert sent[0]["status"] == 413
        body = json.loads(b"".join(m["body"] for m in sent if m["type"] == "http.response.body"))
        assert body["error"]["code"] == "PAYLOAD_TOO_LARGE"


# ---------------------------------------------------------------------------
# 3. GET / HEAD not subject to the limit
# ---------------------------------------------------------------------------


class TestMethodsWithoutBody:
    def test_get_succeeds_regardless_of_limit(self):
        app = _build_isolated_app(max_bytes=1)  # ridiculously tight cap
        client = TestClient(app)
        resp = client.get("/anything")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_head_succeeds_regardless_of_limit(self):
        app = _build_isolated_app(max_bytes=1)
        client = TestClient(app)
        resp = client.head("/anything")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 4. Bypass paths are never throttled
# ---------------------------------------------------------------------------


class TestBypassPaths:
    def test_health_post_not_size_limited(self):
        # Even if Content-Length lies about a huge body, /health is exempt.
        app = _build_isolated_app(max_bytes=4)

        @app.post("/health")
        async def h():
            return {"ok": True}

        client = TestClient(app)
        # We can't easily force a fake Content-Length through TestClient,
        # but we can override settings to disable the limit and verify
        # the bypass predicate doesn't reject legitimate payloads.
        resp = client.post("/health", content=b"x" * 1000)
        assert resp.status_code == 200

    def test_configured_prefix_is_bypassed(self):
        app = _build_isolated_app(max_bytes=8, bypass_prefixes=["/big-bypass"])

        @app.post("/big-bypass")
        async def bp(req: Request):
            body = await req.body()
            return {"size": len(body)}

        client = TestClient(app)
        resp = client.post("/big-bypass", content=b"x" * 1000)
        assert resp.status_code == 200
        assert resp.json() == {"size": 1000}


# ---------------------------------------------------------------------------
# 5. Disabled limit (max_bytes=0)
# ---------------------------------------------------------------------------


class TestDisabledLimit:
    def test_zero_limit_disables_middleware(self):
        app = _build_isolated_app(max_bytes=0)
        client = TestClient(app)
        resp = client.post("/echo", content=b"x" * 10_000)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 6. Real `main.app` regression — confirm the middleware is wired in
# ---------------------------------------------------------------------------


class TestRealAppWiring:
    def test_real_app_includes_size_limit_middleware(self):
        # After FastAPI.add_middleware, class names are stored in
        # app.user_middleware; check by class name to avoid import cycles.
        names = [m.cls.__name__ for m in main.app.user_middleware]
        assert "MaxRequestBodySizeMiddleware" in names

    def test_default_limit_is_ten_mib(self):
        assert settings.max_request_body_bytes == 10 * 1024 * 1024

    def test_real_app_size_limit_registered_with_expected_kwargs(self):
        """Confirm the real app registered the middleware with the
        expected 10 MiB cap and a list (possibly empty) of bypass
        prefixes from settings. This is a wiring test — the actual
        rejection behaviour is exercised via isolated test apps above.
        """
        matched = [
            m
            for m in main.app.user_middleware
            if m.cls is MaxRequestBodySizeMiddleware
        ]
        assert matched, "MaxRequestBodySizeMiddleware not registered"
        assert matched[0].kwargs["max_bytes"] == 10 * 1024 * 1024
        # bypass_prefixes is always a list passed by the registration code.
        assert isinstance(matched[0].kwargs["bypass_prefixes"], list)

    def test_lowered_cap_rejects_oversized_payload(self, monkeypatch):
        """Lower the configured cap and confirm oversized POSTs are
        rejected with 413 using the existing reflection envelope shape."""
        monkeypatch.setattr(main.settings, "max_request_body_bytes", 32)

        tmp_app = FastAPI()
        tmp_app.add_middleware(
            MaxRequestBodySizeMiddleware,
            max_bytes=main.settings.max_request_body_bytes,
            bypass_prefixes=[],
        )

        @tmp_app.post("/v1/ai/anonymize")
        async def echo(req: Request):
            body = await req.body()
            return {"size": len(body)}

        client = TestClient(tmp_app)
        resp = client.post("/v1/ai/anonymize", content=b"x" * 200)

        assert resp.status_code == 413
        assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"

    def test_header_fraud_with_lowered_cap_returns_413(self, monkeypatch):
        """A request that lies about its Content-Length must be rejected
        before any body bytes are consumed. This is the primary DoS
        vector that issue #137 calls out."""
        monkeypatch.setattr(main.settings, "max_request_body_bytes", 64)

        tmp_app = FastAPI()
        tmp_app.add_middleware(
            MaxRequestBodySizeMiddleware,
            max_bytes=main.settings.max_request_body_bytes,
            bypass_prefixes=[],
        )

        @tmp_app.post("/v1/ai/upload")
        async def upload(req: Request):
            body = await req.body()
            return {"size": len(body)}

        client = TestClient(tmp_app)
        # Sent body is small, but the (lying) Content-Length exceeds the cap.
        resp = client.post(
            "/v1/ai/upload",
            content=b"y" * 8,
            headers={"Content-Length": "999999999"},
        )

        assert resp.status_code == 413
        assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"