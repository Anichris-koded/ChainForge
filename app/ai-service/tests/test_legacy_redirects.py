import os
import yaml
import pytest
from fastapi.routing import APIRoute
from main import app, _legacy_yaml_path, _LEGACY_TO_V1, _LEGACY_PREFIX_MAP

def test_yaml_file_exists_and_loads():
    assert os.path.exists(_legacy_yaml_path)
    with open(_legacy_yaml_path, "r") as f:
        data = yaml.safe_load(f)
    assert "legacy_to_v1" in data
    assert "legacy_prefix_map" in data

def test_code_matches_yaml_exactly():
    # Verify the code parsed it correctly
    with open(_legacy_yaml_path, "r") as f:
        data = yaml.safe_load(f)
        
    assert _LEGACY_TO_V1 == data["legacy_to_v1"]
    
    yaml_prefixes = [(item["legacy_prefix"], item["v1_prefix"]) for item in data["legacy_prefix_map"]]
    assert _LEGACY_PREFIX_MAP == yaml_prefixes

def test_legacy_routes_are_covered_by_yaml():
    """
    Ensure that all legacy /ai/ routes (except metrics, ocr, and /v1) defined in code
    are either directly mapped in legacy_to_v1 or covered by legacy_prefix_map.
    """
    # Find all legacy routes defined in main.py or its included routers
    legacy_routes = set()
    for route in app.routes:
        if isinstance(route, APIRoute):
            path = route.path
            # We are looking for legacy routes: they start with /ai/ but not /v1/ai/
            if path.startswith("/ai/") and not path.startswith("/v1/ai/"):
                # Exclude metrics and ocr which are intentionally not redirected
                if path not in ("/ai/metrics", "/ai/ocr", "/ai/ocr/process"):
                    legacy_routes.add(path)

    # Routes covered by exact match
    exact_matches = set(_LEGACY_TO_V1.keys())
    
    for route_path in legacy_routes:
        if route_path in exact_matches:
            continue
            
        # Check prefix match
        matched_prefix = False
        for legacy_prefix, _ in _LEGACY_PREFIX_MAP:
            # e.g. /ai/status/{task_id} starts with /ai/status/
            # In FastAPI, the parameterized route looks like /ai/status/{task_id}
            # We strip the parameter part to see if it starts with the prefix
            if route_path.startswith(legacy_prefix):
                matched_prefix = True
                break
                
        assert matched_prefix, f"Legacy route {route_path} exists in code but is not covered by legacy_redirects.yaml"

def test_no_extra_yaml_entries():
    """
    Ensure we don't have dangling entries in YAML that no longer map to any legacy route.
    """
    legacy_routes = set()
    for route in app.routes:
        if isinstance(route, APIRoute):
            path = route.path
            if path.startswith("/ai/") and not path.startswith("/v1/ai/"):
                if path not in ("/ai/metrics", "/ai/ocr", "/ai/ocr/process"):
                    legacy_routes.add(path)

    # Check that every exact match in YAML actually corresponds to a defined legacy route
    for legacy_path in _LEGACY_TO_V1.keys():
        assert legacy_path in legacy_routes, f"YAML contains exact redirect for {legacy_path} but it is not defined in code"

    # For prefix matches, ensure at least one legacy route matches it
    for legacy_prefix, _ in _LEGACY_PREFIX_MAP:
        matches = [r for r in legacy_routes if r.startswith(legacy_prefix)]
        assert len(matches) > 0, f"YAML contains prefix redirect for {legacy_prefix} but no code route matches it"
