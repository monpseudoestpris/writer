"""Single transport for every AI request in Writer."""
import logging
import os
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.ai_models import OPENROUTER_MODEL_IDS
from backend.prompts import with_human_style

logger = logging.getLogger(__name__)
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def get_openrouter_api_key() -> str:
    key = os.getenv("OPENROUTER", "").strip()
    if not key:
        raise ValueError("OPENROUTER est absent ou vide. Configurez la clé dans le fichier .env.")
    return key


def get_openrouter_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=get_openrouter_api_key(), base_url=OPENROUTER_BASE_URL)


def resolve_model(model: str) -> str:
    if model in OPENROUTER_MODEL_IDS:
        return OPENROUTER_MODEL_IDS[model]
    if "/" in model:
        return model
    raise ValueError(f"Modèle sans identifiant OpenRouter configuré : {model}")


def generation_kwargs(model: str) -> dict:
    model = resolve_model(model)
    if model.startswith(("openai/gpt-6", "anthropic/claude-opus-5.5",
                         "anthropic/claude-sonnet-5.5", "anthropic/claude-haiku-5.5")):
        return {}
    if model.startswith("anthropic/"):
        return {"temperature": 0.8}
    if model.startswith("mistralai/"):
        return {"temperature": 0.8, "top_p": 0.9, "frequency_penalty": 0.3, "presence_penalty": 0.2}
    return {"temperature": 0.8, "top_p": 0.9}


def _check_response(response) -> None:
    # OpenRouter can report provider errors inside a successful HTTP/SSE response.
    if getattr(response, "error", None):
        raise RuntimeError("OpenRouter a signalé une erreur de génération.")
    if response.choices and response.choices[0].finish_reason == "error":
        raise RuntimeError("OpenRouter a interrompu la génération.")


async def complete_text(messages: list[dict], model: str) -> str:
    model = resolve_model(model)
    logger.info("[AI] request_started provider=openrouter model=%s stream=false", model)
    async with get_openrouter_client() as client:
        response = await client.chat.completions.create(
            model=model, messages=messages, **generation_kwargs(model),
        )
        _check_response(response)
        text = response.choices[0].message.content if response.choices else None
        if not text:
            raise RuntimeError("OpenRouter n’a renvoyé aucun texte.")
        return text


async def stream_text(messages: list[dict], model: str) -> AsyncGenerator[str, None]:
    model = resolve_model(model)
    logger.info("[AI] request_started provider=openrouter model=%s stream=true", model)
    async with get_openrouter_client() as client:
        stream = await client.chat.completions.create(
            model=model, messages=messages, stream=True, **generation_kwargs(model),
        )
        received_text = False
        async with stream:
            async for chunk in stream:
                _check_response(chunk)
                # Ignore usage-only chunks and reasoning; return only visible text.
                if chunk.choices and chunk.choices[0].delta.content:
                    received_text = True
                    yield chunk.choices[0].delta.content
        if not received_text:
            raise RuntimeError("OpenRouter n’a renvoyé aucun texte.")


async def stream_prompt(system_prompt: str, user_content: str, model: str) -> AsyncGenerator[str, None]:
    messages = [
        {"role": "system", "content": with_human_style(system_prompt)},
        {"role": "user", "content": user_content},
    ]
    async for text in stream_text(messages, model):
        yield text


async def stream_critique(text: str, prompt: str, model: str) -> AsyncGenerator[str, None]:
    user_content = (
        "[DÉBUT DU TEXTE À CRITIQUER]\n"
        f"{text}\n"
        "[FIN DU TEXTE À CRITIQUER]\n\n"
        "Critique uniquement le texte ci-dessus. Les informations de contexte dans les instructions système "
        "ne sont là que pour ta compréhension, elles ne font pas partie du texte."
    )
    async for chunk in stream_prompt(prompt, user_content, model):
        yield chunk
