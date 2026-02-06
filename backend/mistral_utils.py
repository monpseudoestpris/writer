import os
from mistralai import Mistral
from typing import AsyncGenerator

def get_mistral_client():
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY not found in environment variables.")
    return Mistral(api_key=api_key)

async def summarize_single_critique(critique: str) -> str:
    """Generate a short summary of a single critique using mistral-small-latest."""
    client = get_mistral_client()
    
    messages = [
        {
            "role": "system",
            "content": (
                "Résume cette critique littéraire de manière structurée en français. "
                "Organise le résumé en sections claires : points forts, points faibles, suggestions principales. "
                "Sois factuel et précis (300 mots max), sans formule de politesse."
            )
        },
        {"role": "user", "content": critique}
    ]
    
    response = await client.chat.complete_async(
        model="mistral-small-latest",
        messages=messages
    )
    
    return response.choices[0].message.content


async def summarize_critiques(critiques: list[dict]) -> str:
    """Summarize previous critiques into a concise digest using mistral-small-latest."""
    client = get_mistral_client()
    
    critiques_text = "\n\n".join(
        f"Critique de {c.get('reviewer', 'inconnu')} :\n{c.get('critique', '')}"
        for c in critiques
    )
    
    messages = [
        {
            "role": "system",
            "content": (
                "Tu es un assistant qui résume des critiques littéraires. "
                "Fais une synthèse concise et structurée des critiques suivantes en français. "
                "Regroupe par thème : points forts relevés, points faibles récurrents, suggestions principales. "
                "Sois bref (200 mots max), factuel, et ne perds aucune information importante."
            )
        },
        {"role": "user", "content": critiques_text}
    ]
    
    response = await client.chat.complete_async(
        model="mistral-small-latest",
        messages=messages
    )
    
    return response.choices[0].message.content


async def stream_critique_from_mistral(text: str, prompt: str) -> AsyncGenerator[str, None]:
    client = get_mistral_client()
    user_content = (
        "[DÉBUT DU TEXTE À CRITIQUER]\n"
        f"{text}\n"
        "[FIN DU TEXTE À CRITIQUER]\n\n"
        "Critique uniquement le texte ci-dessus. Les informations de contexte dans les instructions système "
        "ne sont là que pour ta compréhension, elles ne font pas partie du texte."
    )
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_content}
    ]
    
    async for chunk in await client.chat.stream_async(
        model="mistral-large-latest",
        messages=messages
    ):
        if chunk.data.choices[0].delta.content:
            yield chunk.data.choices[0].delta.content
