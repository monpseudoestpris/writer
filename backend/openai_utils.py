import os
from typing import AsyncGenerator

from openai import AsyncOpenAI

from backend.ai_models import OPENAI_BEST_MODEL


def get_openai_client() -> AsyncOpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not found in environment variables.")
    return AsyncOpenAI(api_key=api_key)


async def stream_critique_from_openai(text: str, prompt: str, model: str = OPENAI_BEST_MODEL) -> AsyncGenerator[str, None]:
    client = get_openai_client()
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
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_content},
        ],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def stream_from_openai(system_prompt: str, user_content: str, model: str = OPENAI_BEST_MODEL) -> AsyncGenerator[str, None]:
    """Generic streaming call (no [DÉBUT/FIN DU TEXTE] wrapping), for non-critique generations."""
    client = get_openai_client()
    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
