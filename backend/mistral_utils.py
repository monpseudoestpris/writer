import os
from mistralai import Mistral
from typing import AsyncGenerator

def get_mistral_client():
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY not found in environment variables.")
    return Mistral(api_key=api_key)

async def stream_critique_from_mistral(text: str, prompt: str) -> AsyncGenerator[str, None]:
    client = get_mistral_client()
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": text}
    ]
    
    async for chunk in await client.chat.stream_async(
        model="mistral-large-latest",
        messages=messages
    ):
        if chunk.data.choices[0].delta.content:
            yield chunk.data.choices[0].delta.content
