"""Single transport for every AI request in Writer."""
import logging
import os
import time
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.ai_models import OPENROUTER_MODEL_IDS
from backend.prompts import with_human_style

logger = logging.getLogger(__name__)
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class _VisibleTextFilter:
    """Keep visible content while dropping inline <think> blocks across chunks."""

    _OPEN = "<think>"
    _CLOSE = "</think>"

    def __init__(self) -> None:
        self._pending = ""
        self._thinking = False

    @staticmethod
    def _partial_tag_length(text: str, tag: str) -> int:
        return next(
            (size for size in range(min(len(text), len(tag) - 1), 0, -1)
             if text.endswith(tag[:size])),
            0,
        )

    def push(self, text: str) -> str:
        self._pending += text
        visible = []
        while self._pending:
            if self._thinking:
                end = self._pending.find(self._CLOSE)
                if end < 0:
                    keep = self._partial_tag_length(self._pending, self._CLOSE)
                    self._pending = self._pending[-keep:] if keep else ""
                    break
                self._pending = self._pending[end + len(self._CLOSE):]
                self._thinking = False
            else:
                start = self._pending.find(self._OPEN)
                if start < 0:
                    keep = self._partial_tag_length(self._pending, self._OPEN)
                    visible.append(self._pending[:-keep] if keep else self._pending)
                    self._pending = self._pending[-keep:] if keep else ""
                    break
                visible.append(self._pending[:start])
                self._pending = self._pending[start + len(self._OPEN):]
                self._thinking = True
        return "".join(visible)

    def finish(self) -> str:
        tail = self._pending if not self._thinking else ""
        self._pending = ""
        return tail


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
    # UI/agent identifiers use "provider:native-id"; OpenRouter expects "provider/model-id".
    if ":" in model:
        provider, native_model = model.split(":", 1)
        slug = OPENROUTER_MODEL_IDS.get(native_model)
        openrouter_provider = "mistralai" if provider == "mistral" else provider
        if slug and slug.split("/", 1)[0] == openrouter_provider:
            return slug
        raise ValueError(f"Modèle sans identifiant OpenRouter configuré : {model}")
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
        content = response.choices[0].message.content if response.choices else None
        visible_filter = _VisibleTextFilter()
        text = visible_filter.push(content) + visible_filter.finish() if isinstance(content, str) else None
        if not text:
            raise RuntimeError("OpenRouter n’a renvoyé aucun texte.")
        return text


async def stream_text(
    messages: list[dict],
    model: str,
) -> AsyncGenerator[str, None]:
    model = resolve_model(model)
    started_at = time.perf_counter()
    first_text_at = None
    text_chars = 0
    reasoning_chars = 0
    chunk_count = 0
    finish_reason = None
    visible_filter = _VisibleTextFilter()
    logger.info("[AI] request_started provider=openrouter model=%s stream=true", model)
    async with get_openrouter_client() as client:
        stream = await client.chat.completions.create(
            model=model, messages=messages, stream=True,
            **generation_kwargs(model),
        )
        received_text = False
        async with stream:
            async for chunk in stream:
                chunk_count += 1
                _check_response(chunk)
                if chunk.choices:
                    choice = chunk.choices[0]
                    if choice.finish_reason:
                        finish_reason = choice.finish_reason
                    reasoning = getattr(choice.delta, "reasoning", None)
                    if reasoning:
                        reasoning_chars += len(reasoning)
                    # Ignore usage-only chunks and reasoning; return only visible text.
                    content = choice.delta.content
                    delta = visible_filter.push(content) if isinstance(content, str) else None
                else:
                    delta = None
                if delta:
                    if first_text_at is None:
                        first_text_at = time.perf_counter()
                        logger.info(
                            "[AI] first_text provider=openrouter model=%s ttft_ms=%.0f",
                            model,
                            (first_text_at - started_at) * 1000,
                        )
                    received_text = True
                    text_chars += len(delta)
                    yield delta
        tail = visible_filter.finish()
        if tail:
            received_text = True
            text_chars += len(tail)
            yield tail
        logger.info(
            "[AI] stream_completed provider=openrouter model=%s duration_ms=%.0f ttft_ms=%.0f chars=%d reasoning_chars=%d chunks=%d finish_reason=%s",
            model,
            (time.perf_counter() - started_at) * 1000,
            (first_text_at - started_at) * 1000 if first_text_at else -1,
            text_chars,
            reasoning_chars,
            chunk_count,
            finish_reason,
        )
        if not received_text:
            raise RuntimeError(
                "OpenRouter n’a renvoyé aucun texte "
                f"(finish_reason={finish_reason or 'inconnu'}, reasoning_chars={reasoning_chars})."
            )


async def stream_prompt(
    system_prompt: str,
    user_content: str,
    model: str,
) -> AsyncGenerator[str, None]:
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
