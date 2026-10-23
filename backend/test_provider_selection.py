import asyncio
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import backend.main as main
from backend.prompts import HUMAN_STYLE_PREFIX, with_human_style
from backend.mistral_utils import get_mistral_generation_kwargs


def test_human_style_prefix_is_added_once():
    assert with_human_style(with_human_style("Consigne")).count(HUMAN_STYLE_PREFIX) == 1


def test_mistral_sampling_is_preserved():
    assert get_mistral_generation_kwargs() == {
        "temperature": 0.8, "top_p": 0.9, "frequency_penalty": 0.3, "presence_penalty": 0.2,
    }


def test_random_choice_includes_all_families_with_only_openrouter(monkeypatch):
    monkeypatch.setattr(main.os, "getenv", lambda key, default=None: "router-key" if key == "OPENROUTER" else default)
    candidates = [(name, object(), name + "-model") for name in ["anthropic", "deepseek", "mistral", "openai"]]
    def choice(items):
        assert items == candidates
        return items[2]
    monkeypatch.setattr(main.random, "choice", choice)
    assert main._pick_random_provider(candidates) == (candidates[2][1], "mistral-model", "openrouter")
    assert main._pick_provider(candidates) == (candidates[0][1], "anthropic-model", "openrouter")


def test_missing_key_fails_without_direct_fallback(monkeypatch):
    monkeypatch.delenv("OPENROUTER", raising=False)
    for choose in [main._pick_provider, main._pick_random_provider]:
        with pytest.raises(HTTPException) as error:
            choose([("mistral", object(), "mistral-large-4")])
        assert error.value.status_code == 503


def test_config_never_exposes_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER", "secret-test-value")
    assert asyncio.run(main.get_config()) == {"openrouter_api_key_set": True}


def test_missing_key_blocks_ai_but_not_document_import(monkeypatch):
    monkeypatch.delenv("OPENROUTER", raising=False)
    with TestClient(main.app) as client:
        assert client.get("/ping").status_code == 200
        assert client.post("/review", json={}).status_code == 503
        assert client.post("/import-document").status_code == 422
