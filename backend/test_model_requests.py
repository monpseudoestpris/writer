"""Exercise the real SDK serialization against a mock OpenRouter HTTP server."""
import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI, AuthenticationError

from backend import ai_models as models
from backend import openrouter_utils as router
from backend import openai_utils, anthropic_utils, deepseek_utils, mistral_utils


@pytest.fixture
def requests(monkeypatch):
    monkeypatch.setenv("OPENROUTER", "test-router-key")
    captured = []

    def respond(request):
        assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-router-key"
        body = json.loads(request.content)
        captured.append(body)
        if body.get("stream"):
            chunks = [
                {"choices": []},
                {"choices": [{"delta": {"reasoning": "hidden", "content": None}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": "Bonjour"}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": " !"}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"total_tokens": 10}},
            ]
            data = ': OPENROUTER PROCESSING\n\n' + ''.join('data: '+json.dumps(c)+'\n\n' for c in chunks) + 'data: [DONE]\n\n'
            return httpx.Response(200, text=data, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "Bonjour !"}, "finish_reason": "stop"}]})

    def client(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))

    monkeypatch.setattr(router, "AsyncOpenAI", client)
    return captured


STREAMS = [
    (openai_utils.stream_critique_from_openai, models.OPENAI_BEST_MODEL),
    (openai_utils.stream_from_openai, models.OPENAI_MEDIUM_MODEL),
    (anthropic_utils.stream_critique_from_anthropic, models.ANTHROPIC_BEST_MODEL),
    (anthropic_utils.stream_from_anthropic, models.ANTHROPIC_MEDIUM_MODEL),
    (deepseek_utils.stream_critique_from_deepseek, models.DEEPSEEK_BEST_MODEL),
    (deepseek_utils.stream_from_deepseek, models.DEEPSEEK_BEST_MODEL),
    (mistral_utils.stream_critique_from_mistral, models.MISTRAL_BEST_MODEL),
]


@pytest.mark.parametrize("function,model", STREAMS)
def test_all_model_families_stream_through_openrouter(requests, function, model):
    async def collect():
        return ''.join([part async for part in function("Texte", "Consigne", model=model)])
    assert asyncio.run(collect()) == "Bonjour !"
    assert requests[0]["model"] == models.OPENROUTER_MODEL_IDS[model]
    assert requests[0]["messages"][0]["role"] == "system"
    if model.startswith(("gpt-6", "claude-")):
        assert not {"temperature", "top_p", "frequency_penalty", "presence_penalty"} & requests[0].keys()


@pytest.mark.parametrize("function,args", [
    (mistral_utils.summarize_single_critique, ("Critique",)),
    (mistral_utils.summarize_text, ("Texte",)),
    (mistral_utils.summarize_critiques, ([{"reviewer": "A", "critique": "Avis"}],)),
    (mistral_utils.summarize_chat_messages, ([{"role": "user", "content": "Texte"}],)),
    (mistral_utils.get_structured_comments, ("Document", "Renvoyer du JSON")),
    (mistral_utils.generate_text_from_mistral, ("Consigne", "Texte", models.MISTRAL_FAST_MODEL)),
])
def test_nonstreaming_features_use_openrouter(requests, function, args):
    assert asyncio.run(function(*args)) == "Bonjour !"
    assert requests[0]["model"].startswith("mistralai/")
    assert not requests[0].get("stream")


@pytest.mark.parametrize("function,args", [
    (mistral_utils.stream_from_mistral_small, ("Consigne", "Texte")),
    (mistral_utils.stream_chat_from_mistral, ([{"role": "user", "content": "Texte"}],)),
])
def test_mistral_chat_and_autofill_stream(requests, function, args):
    async def collect():
        return ''.join([part async for part in function(*args)])
    assert asyncio.run(collect()) == "Bonjour !"
    assert requests[0]["model"] == models.OPENROUTER_MODEL_IDS[models.MISTRAL_BEST_MODEL]


@pytest.mark.parametrize("key", ["", "   "])
def test_missing_router_key_never_uses_provider_keys(monkeypatch, key):
    monkeypatch.setenv("OPENROUTER", key)
    for provider in ["OPENAI", "MISTRAL", "ANTHROPIC", "DEEPSEEK"]:
        monkeypatch.setenv(provider + "_API_KEY", "old-direct-key")
    with pytest.raises(ValueError, match="OPENROUTER"):
        router.get_openrouter_client()


def test_unknown_native_model_fails_explicitly():
    with pytest.raises(ValueError, match="OpenRouter"):
        router.resolve_model("unknown-model")
    assert router.resolve_model("vendor/model") == "vendor/model"


@pytest.mark.parametrize("status,payload,expected", [
    (401, {"error": {"message": "Invalid key"}}, AuthenticationError),
    (200, {"error": {"message": "Provider failed"}, "choices": []}, RuntimeError),
    (200, {"choices": []}, RuntimeError),
])
def test_api_errors_are_not_treated_as_empty_success(monkeypatch, status, payload, expected):
    monkeypatch.setenv("OPENROUTER", "test-key")
    monkeypatch.setattr(router, "AsyncOpenAI", lambda **kwargs: AsyncOpenAI(
        **kwargs, max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(status, json=payload))),
    ))
    with pytest.raises(expected):
        asyncio.run(router.complete_text([{"role": "user", "content": "Test"}], models.MISTRAL_BEST_MODEL))


def test_stream_error_is_propagated(monkeypatch):
    monkeypatch.setenv("OPENROUTER", "test-key")
    data = 'data: {"choices": [{"delta": {"content": "partial"}, "finish_reason": null}]}\n\n'
    data += 'data: {"error": {"message": "Provider failed"}, "choices": []}\n\n'
    monkeypatch.setattr(router, "AsyncOpenAI", lambda **kwargs: AsyncOpenAI(
        **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(
            lambda req: httpx.Response(200, text=data, headers={"content-type": "text/event-stream"}))),
    ))
    async def collect():
        return [part async for part in router.stream_text([], models.MISTRAL_BEST_MODEL)]
    with pytest.raises((RuntimeError, __import__('openai').APIError)):
        asyncio.run(collect())
