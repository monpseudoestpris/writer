import os
import logging
from typing import AsyncGenerator

from anthropic import AsyncAnthropic

from backend.ai_models import ANTHROPIC_BEST_MODEL

logger = logging.getLogger(__name__)


def get_anthropic_client() -> AsyncAnthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not found in environment variables.")
    return AsyncAnthropic(api_key=api_key)


async def stream_critique_from_anthropic(text: str, prompt: str, model: str = ANTHROPIC_BEST_MODEL) -> AsyncGenerator[str, None]:
    logger.info("[AI] request_started provider=anthropic model=%s", model)
    response_parts: list[str] = []
    client = get_anthropic_client()
    user_content = (
        "[DÉBUT DU TEXTE À CRITIQUER]\n"
        f"{text}\n"
        "[FIN DU TEXTE À CRITIQUER]\n\n"
        "Critique uniquement le texte ci-dessus. Les informations de contexte dans les instructions système "
        "ne sont là que pour ta compréhension, elles ne font pas partie du texte."
    )
    async with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=prompt,
        messages=[{"role": "user", "content": user_content}],
    ) as stream:
        async for chunk in stream.text_stream:
            response_parts.append(chunk)
            yield chunk
    logger.info("[AI] response_received provider=anthropic model=%s chars=%d preview=%r", model, len(''.join(response_parts)), ''.join(response_parts)[:500])


async def stream_from_anthropic(system_prompt: str, user_content: str, model: str = ANTHROPIC_BEST_MODEL) -> AsyncGenerator[str, None]:
    """Generic streaming call (no [DÉBUT/FIN DU TEXTE] wrapping), for non-critique generations."""
    logger.info("[AI] request_started provider=anthropic model=%s", model)
    response_parts: list[str] = []
    client = get_anthropic_client()
    async with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    ) as stream:
        async for chunk in stream.text_stream:
            response_parts.append(chunk)
            yield chunk
    logger.info("[AI] response_received provider=anthropic model=%s chars=%d preview=%r", model, len(''.join(response_parts)), ''.join(response_parts)[:500])
