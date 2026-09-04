import os
from typing import AsyncGenerator

from mistralai.client import Mistral

from backend.ai_models import MISTRAL_BEST_MODEL


def get_mistral_client():
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY not found in environment variables.")
    return Mistral(api_key=api_key)

async def summarize_single_critique(critique: str) -> str:
    """Generate a short summary of a single critique with Mistral's best model."""
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
        model=MISTRAL_BEST_MODEL,
        messages=messages
    )
    
    return response.choices[0].message.content


async def summarize_text(text: str) -> str:
    """Generate a factual 5-10 line summary with Mistral's best model."""
    client = get_mistral_client()
    
    messages = [
        {
            "role": "system",
            "content": (
                "Tu es un assistant qui résume des textes littéraires de manière factuelle et concise. "
                "Produis un résumé en 5 à 10 lignes qui capture les informations essentielles : "
                "personnages présents, lieux, actions principales, enjeux narratifs, éléments de world building. "
                "Sois strictement factuel : ne juge pas, ne commente pas la qualité, ne donne aucun avis. "
                "Résume uniquement ce qui est écrit. Écris en français."
            )
        },
        {"role": "user", "content": text}
    ]
    
    response = await client.chat.complete_async(
        model=MISTRAL_BEST_MODEL,
        messages=messages
    )
    
    return response.choices[0].message.content


async def summarize_critiques(critiques: list[dict]) -> str:
    """Summarize previous critiques into a concise digest with Mistral's best model."""
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
        model=MISTRAL_BEST_MODEL,
        messages=messages
    )
    
    return response.choices[0].message.content


async def stream_critique_from_mistral(text: str, prompt: str, model: str = MISTRAL_BEST_MODEL) -> AsyncGenerator[str, None]:
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
        model=model,
        messages=messages
    ):
        if chunk.data.choices[0].delta.content:
            yield chunk.data.choices[0].delta.content


async def stream_from_mistral_small(system_prompt: str, user_content: str) -> AsyncGenerator[str, None]:
    """Stream an auto-fill response with Mistral's best model."""
    client = get_mistral_client()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content}
    ]
    
    async for chunk in await client.chat.stream_async(
        model=MISTRAL_BEST_MODEL,
        messages=messages
    ):
        if chunk.data.choices[0].delta.content:
            yield chunk.data.choices[0].delta.content


async def summarize_chat_messages(messages: list[dict]) -> str:
    """Summarize a batch of chat messages with Mistral's best model."""
    client = get_mistral_client()
    formatted = "\n".join(
        f"{'Auteur' if m['role']=='user' else 'Critique'}: {m['content']}"
        for m in messages
    )
    prompt = (
        "Résume cette conversation entre un auteur et son critique/conseiller littéraire. "
        "Conserve TOUS les points clés :\n"
        "- Les suggestions de réécriture proposées (cite les passages importants)\n"
        "- Les décisions prises par l'auteur (accepté/refusé)\n"
        "- Les points de discussion importants\n"
        "- Les demandes spécifiques de l'auteur\n"
        "Sois concis mais exhaustif. Réponds en français, 150-250 mots maximum."
    )
    response = await client.chat.complete_async(
        model=MISTRAL_BEST_MODEL,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": formatted}
        ]
    )
    return response.choices[0].message.content


async def stream_chat_from_mistral(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Stream a multi-turn chat response with Mistral's best model.
    
    Messages should include system prompt and full conversation history.
    Mistral automatically applies prefix caching on the shared prefix.
    """
    client = get_mistral_client()
    
    async for chunk in await client.chat.stream_async(
        model=MISTRAL_BEST_MODEL,
        messages=messages
    ):
        if chunk.data.choices[0].delta.content:
            yield chunk.data.choices[0].delta.content


async def get_structured_comments(text: str, system_prompt: str) -> str:
    """Appel au meilleur modèle Mistral pour obtenir des commentaires JSON structurés."""
    client = get_mistral_client()
    user_content = (
        "[DÉBUT DU DOCUMENT]\n"
        f"{text}\n"
        "[FIN DU DOCUMENT]\n\n"
        "Analyse ce document et produis tes commentaires au format JSON demandé."
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content}
    ]
    response = await client.chat.complete_async(
        model=MISTRAL_BEST_MODEL,
        messages=messages
    )
    return response.choices[0].message.content


async def generate_text_from_mistral(system_prompt: str, user_content: str) -> str:
    """Appel non-streaming au meilleur modèle Mistral, pour générer un contenu texte libre."""
    client = get_mistral_client()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content}
    ]
    response = await client.chat.complete_async(
        model=MISTRAL_BEST_MODEL,
        messages=messages
    )
    return response.choices[0].message.content
