"""Openai model entry points, served exclusively through OpenRouter."""
from typing import AsyncGenerator

from backend.ai_models import OPENAI_BEST_MODEL
from backend.openrouter_utils import generation_kwargs, stream_critique, stream_prompt


def get_openai_generation_kwargs(model: str = OPENAI_BEST_MODEL) -> dict:
    return generation_kwargs(model)


async def stream_critique_from_openai(text: str, prompt: str, model: str = OPENAI_BEST_MODEL) -> AsyncGenerator[str, None]:
    async for chunk in stream_critique(text, prompt, model):
        yield chunk


async def stream_from_openai(system_prompt: str, user_content: str, model: str = OPENAI_BEST_MODEL) -> AsyncGenerator[str, None]:
    async for chunk in stream_prompt(system_prompt, user_content, model):
        yield chunk
