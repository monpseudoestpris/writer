import os
import logging
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.ai_models import DEEPSEEK_BEST_MODEL
from backend.prompts import with_human_style

logger = logging.getLogger(__name__)


def get_deepseek_generation_kwargs() -> dict:
    return {
        "temperature": 0.8,
        "top_p": 0.9,
    }


def get_deepseek_client() -> AsyncOpenAI:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY not found in environment variables.")
    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.deepseek.com/v1",
    )


async def stream_critique_from_deepseek(text: str, prompt: str, model: str = DEEPSEEK_BEST_MODEL) -> AsyncGenerator[str, None]:
    logger.info("[AI] request_started provider=deepseek model=%s", model)
    response_parts: list[str] = []
    client = get_deepseek_client()
    user_content = (
        "[DÉBUT DU TEXTE À CRITIQUER]\n"
        f"{text}\n"
        "[FIN DU TEXTE À CRITIQUER]\n\n"
        "Critique uniquement le texte ci-dessus. Les informations de contexte dans les instructions système "
        "ne sont là que pour ta compréhension, elles ne font pas partie du texte."
    )
    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": with_human_style(prompt)},
            {"role": "user", "content": user_content},
        ],
        stream=True,
        **get_deepseek_generation_kwargs(),
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            response_parts.append(delta)
            yield delta
    logger.info("[AI] response_received provider=deepseek model=%s chars=%d preview=%r", model, len(''.join(response_parts)), ''.join(response_parts)[:500])


async def stream_from_deepseek(system_prompt: str, user_content: str, model: str = DEEPSEEK_BEST_MODEL) -> AsyncGenerator[str, None]:
    logger.info("[AI] request_started provider=deepseek model=%s", model)
    response_parts: list[str] = []
    client = get_deepseek_client()
    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": with_human_style(system_prompt)},
            {"role": "user", "content": user_content},
        ],
        stream=True,
        **get_deepseek_generation_kwargs(),
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            response_parts.append(delta)
            yield delta
    logger.info("[AI] response_received provider=deepseek model=%s chars=%d preview=%r", model, len(''.join(response_parts)), ''.join(response_parts)[:500])
