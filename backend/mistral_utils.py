"""Writer text helpers via OpenRouter (module path kept for compatibility)."""
import logging
from typing import AsyncGenerator

from backend.openrouter_utils import complete_text, stream_text, generation_kwargs

from backend.ai_models import MISTRAL_BEST_MODEL, OPENAI_FAST_MODEL, ANTHROPIC_MEDIUM_MODEL
from backend.prompts import with_human_style

logger = logging.getLogger(__name__)


def get_mistral_generation_kwargs() -> dict:
    return generation_kwargs(MISTRAL_BEST_MODEL)


def _log_ai_response(model: str, response: str) -> None:
    logger.info("[AI] response_received provider=openrouter model=%s chars=%d preview=%r", model, len(response), response[:500])


async def summarize_single_critique(critique: str) -> str:
    """Generate a short summary of a single critique with the fast model."""
    logger.info("[AI] request_started provider=openrouter model=%s operation=summarize_single_critique", OPENAI_FAST_MODEL)
    
    messages = [
        {
            "role": "system",
            "content": with_human_style(
                "Résume cette critique littéraire de manière structurée en français. "
                "Organise le résumé en sections claires : points forts, points faibles, suggestions principales. "
                "Sois factuel et précis (300 mots max), sans formule de politesse."
            )
        },
        {"role": "user", "content": critique}
    ]
    
    result = await complete_text(
        model=OPENAI_FAST_MODEL,
        messages=messages,
    )
    
    _log_ai_response(OPENAI_FAST_MODEL, result)
    return result


async def summarize_text(text: str) -> str:
    """Generate a factual 5-10 line summary with the fast model."""
    logger.info("[AI] request_started provider=openrouter model=%s operation=summarize_text", OPENAI_FAST_MODEL)
    
    messages = [
        {
            "role": "system",
            "content": with_human_style(
                "Tu es un assistant qui résume des textes littéraires de manière factuelle et concise. "
                "Produis un résumé en 5 à 10 lignes qui capture les informations essentielles : "
                "personnages présents, lieux, actions principales, enjeux narratifs, éléments de world building. "
                "Sois strictement factuel : ne juge pas, ne commente pas la qualité, ne donne aucun avis. "
                "Résume uniquement ce qui est écrit. Écris en français."
            )
        },
        {"role": "user", "content": text}
    ]
    
    result = await complete_text(
        model=OPENAI_FAST_MODEL,
        messages=messages,
    )
    
    _log_ai_response(OPENAI_FAST_MODEL, result)
    return result


async def summarize_critiques(critiques: list[dict]) -> str:
    """Summarize previous critiques into a concise digest with the fast model."""
    logger.info("[AI] request_started provider=openrouter model=%s operation=summarize_critiques", OPENAI_FAST_MODEL)
    
    critiques_text = "\n\n".join(
        f"Critique de {c.get('reviewer', 'inconnu')} :\n{c.get('critique', '')}"
        for c in critiques
    )
    
    messages = [
        {
            "role": "system",
            "content": with_human_style(
                "Tu es un assistant qui résume des critiques littéraires. "
                "Fais une synthèse concise et structurée des critiques suivantes en français. "
                "Regroupe par thème : points forts relevés, points faibles récurrents, suggestions principales. "
                "Sois bref (200 mots max), factuel, et ne perds aucune information importante."
            )
        },
        {"role": "user", "content": critiques_text}
    ]
    
    result = await complete_text(
        model=OPENAI_FAST_MODEL,
        messages=messages,
    )
    
    _log_ai_response(OPENAI_FAST_MODEL, result)
    return result


async def stream_writing_critique(text: str, prompt: str, model: str = OPENAI_FAST_MODEL) -> AsyncGenerator[str, None]:
    logger.info("[AI] request_started provider=openrouter model=%s", model)
    response_parts: list[str] = []
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
    
    async for delta in stream_text(
        model=model,
        messages=messages,
    ):
        response_parts.append(delta)
        yield delta
    logger.info("[AI] response_received provider=openrouter model=%s chars=%d preview=%r", model, len(''.join(response_parts)), ''.join(response_parts)[:500])


async def stream_writing_text(
    system_prompt: str,
    user_content: str,
    model: str = OPENAI_FAST_MODEL,
) -> AsyncGenerator[str, None]:
    """Stream an auto-fill response through OpenRouter."""
    logger.info("[AI] request_started provider=openrouter model=%s", model)
    response_parts: list[str] = []
    messages = [
        {"role": "system", "content": with_human_style(system_prompt)},
        {"role": "user", "content": user_content}
    ]
    
    async for delta in stream_text(
        model=model,
        messages=messages,
    ):
        response_parts.append(delta)
        yield delta
    _log_ai_response(model, ''.join(response_parts))


async def summarize_chat_messages(messages: list[dict]) -> str:
    """Summarize a batch of chat messages with the fast model."""
    logger.info("[AI] request_started provider=openrouter model=%s operation=summarize_chat_messages", OPENAI_FAST_MODEL)
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
    result = await complete_text(
        model=OPENAI_FAST_MODEL,
        messages=[
            {"role": "system", "content": with_human_style(prompt)},
            {"role": "user", "content": formatted}
        ],
    )
    _log_ai_response(OPENAI_FAST_MODEL, result)
    return result


async def stream_writing_chat(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Stream a multi-turn chat response with the fast writing model.
    
    Messages should include system prompt and full conversation history.
    Requests are sent through OpenRouter with the full conversation history.
    """
    logger.info("[AI] request_started provider=openrouter model=%s", OPENAI_FAST_MODEL)
    response_parts: list[str] = []
    
    async for delta in stream_text(
        model=OPENAI_FAST_MODEL,
        messages=messages,
    ):
        response_parts.append(delta)
        yield delta
    _log_ai_response(OPENAI_FAST_MODEL, ''.join(response_parts))


async def get_structured_comments(text: str, system_prompt: str) -> str:
    """Produit des commentaires JSON structurés avec le modèle premium."""
    logger.info("[AI] request_started provider=openrouter model=%s operation=get_structured_comments", ANTHROPIC_MEDIUM_MODEL)
    user_content = (
        "[DÉBUT DU DOCUMENT]\n"
        f"{text}\n"
        "[FIN DU DOCUMENT]\n\n"
        "Analyse ce document et produis tes commentaires au format JSON demandé."
    )
    messages = [
        {"role": "system", "content": with_human_style(system_prompt)},
        {"role": "user", "content": user_content}
    ]
    result = await complete_text(
        model=ANTHROPIC_MEDIUM_MODEL,
        messages=messages,
    )
    _log_ai_response(ANTHROPIC_MEDIUM_MODEL, result)
    return result


async def generate_writing_text(system_prompt: str, user_content: str, model: str = OPENAI_FAST_MODEL) -> str:
    """Génère un texte avec le modèle demandé via OpenRouter."""
    logger.info("[AI] request_started provider=openrouter model=%s operation=generate_text", model)
    messages = [
        {"role": "system", "content": with_human_style(system_prompt)},
        {"role": "user", "content": user_content}
    ]
    result = await complete_text(
        model=model,
        messages=messages,
    )
    _log_ai_response(model, result)
    return result


# Compatibility imports for older callers; active routes use the neutral names.
stream_critique_from_mistral = stream_writing_critique
stream_from_mistral_small = stream_writing_text
stream_chat_from_mistral = stream_writing_chat
generate_text_from_mistral = generate_writing_text
