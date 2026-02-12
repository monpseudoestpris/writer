from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import os
from backend.models import ReviewRequest, SummarizeRequest, DialogueRequest, WorldBuildingFeedbackRequest, WorldBuildingAutoFillRequest
from backend.mistral_utils import stream_critique_from_mistral, summarize_critiques, summarize_single_critique, stream_from_mistral_small
from backend.prompts import REVIEWER_PROMPTS, REVIEWER_NAMES, GENERAL_PROMPT, DIALOGUE_PROMPT, REVIEWER_FIRST_NAMES, WORLD_BUILDING_FEEDBACK_PROMPT, WB_AUTOFILL_PROMPTS

load_dotenv()

app = FastAPI()

# CORS middleware pour permettre les requêtes depuis le frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "FastAPI backend is running!"}

@app.get("/ping")
async def ping():
    return {"status": "ok"}

@app.get("/config")
async def get_config():
    mistral_api_key = os.getenv("MISTRAL_API_KEY")
    return {"mistral_api_key_set": bool(mistral_api_key)}

@app.get("/reviewers")
async def get_reviewers():
    return [{"id": k, "name": REVIEWER_NAMES.get(k, k)} for k in REVIEWER_PROMPTS.keys()]

@app.post("/review")
async def review_text(request: ReviewRequest):
    if request.reviewer not in REVIEWER_PROMPTS:
        async def error_stream():
            yield "Critique inconnu. Veuillez choisir parmi les critiques disponibles."
        return StreamingResponse(error_stream(), media_type="text/plain")

    reviewer_prompt = REVIEWER_PROMPTS[request.reviewer]
    
    # Build full prompt: general + context + writer profile + previous critiques + reviewer personality
    parts = [GENERAL_PROMPT]
    
    if request.book_summary:
        parts.append(
            f"\n\nRÉSUMÉ DE L'OUVRAGE (pour que tu comprennes le contexte global) : {request.book_summary}"
        )
    
    if request.chapter_summary:
        parts.append(
            f"\n\nRÉSUMÉ DU CHAPITRE (ce que l'auteur veut écrire dans ce chapitre) : {request.chapter_summary}"
        )
    
    if request.writer_profile:
        parts.append(
            f"\n\nProfil de l'auteur que tu critiques (adapte tes conseils en conséquence) : {request.writer_profile}"
        )
    
    if request.previous_critiques:
        # Summarize past critiques via mistral-small-latest to save context
        try:
            summary = await summarize_critiques(request.previous_critiques)
        except Exception:
            summary = "\n".join(f"- {pc.get('reviewer', '?')}: {pc.get('critique', '')[:200]}" for pc in request.previous_critiques)
        
        if request.text_changed:
            parts.append(
                f"\n\nSYNTHÈSE DES CRITIQUES PRÉCÉDENTES (l'auteur a modifié son texte depuis, évalue sa progression) :\n{summary}\n"
                "\nCompare le texte actuel avec ces retours précédents. Note les améliorations et ce qui reste à travailler.\n"
            )
        else:
            parts.append(
                f"\n\nSYNTHÈSE DES CRITIQUES PRÉCÉDENTES (le texte n'a pas changé, l'auteur demande un regard différent) :\n{summary}\n"
                "\nNe répète pas les mêmes remarques. Apporte un regard neuf, complémentaire, en évitant de redire ce qui a déjà été dit.\n"
            )
    
    parts.append(f"\n\n{reviewer_prompt}")
    full_prompt = "".join(parts)
    
    return StreamingResponse(
        stream_critique_from_mistral(request.text, full_prompt),
        media_type="text/plain"
    )


@app.post("/summarize-critique")
async def summarize_critique_endpoint(request: SummarizeRequest):
    try:
        summary = await summarize_single_critique(request.critique)
        return {"summary": summary}
    except Exception as e:
        return {"summary": "", "error": str(e)}


@app.post("/review-dialogue")
async def review_dialogue(request: DialogueRequest):
    import random
    
    # Pick N random reviewers
    all_ids = list(REVIEWER_PROMPTS.keys())
    n = min(request.num_authors, len(all_ids))
    chosen = random.sample(all_ids, n)
    
    # Build authors list and personalities
    authors_list = "\n".join(
        f"- {REVIEWER_FIRST_NAMES.get(rid, rid)} ({REVIEWER_NAMES.get(rid, rid)})"
        for rid in chosen
    )
    authors_personalities = "\n\n".join(
        f"{REVIEWER_FIRST_NAMES.get(rid, rid)} :\n{REVIEWER_PROMPTS[rid]}"
        for rid in chosen
    )
    
    # Build the dialogue prompt
    dialogue_system = DIALOGUE_PROMPT.format(
        nb_authors=n,
        authors_list=authors_list,
        authors_personalities=authors_personalities
    )
    
    # Add context
    parts = [dialogue_system]
    
    if request.book_summary:
        parts.append(f"\n\nRÉSUMÉ DE L'OUVRAGE : {request.book_summary}")
    if request.chapter_summary:
        parts.append(f"\n\nRÉSUMÉ DU CHAPITRE : {request.chapter_summary}")
    if request.writer_profile:
        parts.append(f"\n\nProfil de l'auteur : {request.writer_profile}")
    
    full_prompt = "".join(parts)
    chosen_names = [REVIEWER_FIRST_NAMES.get(rid, rid) for rid in chosen]
    
    async def stream_with_header():
        yield f"*{', '.join(chosen_names)} s'installent autour de votre texte…*\n\n---\n\n"
        async for chunk in stream_critique_from_mistral(request.text, full_prompt):
            yield chunk
    
    return StreamingResponse(
        stream_with_header(),
        media_type="text/plain",
        headers={"X-Dialogue-Authors": ",".join(chosen)}
    )


@app.post("/world-building/feedback")
async def world_building_feedback(request: WorldBuildingFeedbackRequest):
    prompt_text = WORLD_BUILDING_FEEDBACK_PROMPT.format(
        category=request.category,
        title=request.entry_title,
    )
    
    parts = [prompt_text]
    
    # Add reviewer personality if specified
    if request.reviewer and request.reviewer in REVIEWER_PROMPTS:
        reviewer_name = REVIEWER_NAMES.get(request.reviewer, request.reviewer)
        parts.append(
            f"\n\nATTENTION — Tu ne parles pas en tant que consultant générique. "
            f"Tu es {reviewer_name}. Adopte complètement sa personnalité, son style, sa voix, ses tics de langage. "
            f"Voici ta personnalité :\n{REVIEWER_PROMPTS[request.reviewer]}\n\n"
            f"Critique cet élément de world building COMME {reviewer_name} le ferait. "
            f"Garde la structure demandée (Ce qui fonctionne bien / Points à améliorer / Suggestions / Cohérence) "
            f"mais écris avec ta voix de {reviewer_name}."
        )
    
    if request.book_summary:
        parts.append(
            f"\n\nRÉSUMÉ DE L'OUVRAGE (contexte global) : {request.book_summary}"
        )
    
    if request.all_entries_context:
        parts.append(
            f"\n\nTOUT LE WORLD BUILDING DE L'UNIVERS (utilise TOUT pour ton analyse de cohérence) :\n{request.all_entries_context}"
        )
    
    full_prompt = "".join(parts)
    
    return StreamingResponse(
        stream_critique_from_mistral(request.entry_content, full_prompt),
        media_type="text/plain"
    )


@app.post("/world-building/autofill")
async def world_building_autofill(request: WorldBuildingAutoFillRequest):
    # Find the right prompt for this category
    category_key = request.category.lower()
    # Try to match category key from the prompts dict
    prompt = WB_AUTOFILL_PROMPTS.get(category_key, WB_AUTOFILL_PROMPTS["autre"])
    
    # Build user content
    user_parts = [f"Titre de l'élément : « {request.entry_title} »\n"]
    user_parts.append(f"Catégorie : {request.category}\n")
    
    if request.entry_content and request.entry_content.strip():
        user_parts.append(
            f"\nCONTENU EXISTANT (à développer et enrichir, ne pas remplacer) :\n"
            f"{request.entry_content}\n\n"
            "Développe, enrichis et complète ce qui est écrit ci-dessus. "
            "Garde le ton et le style de l'auteur. Ajoute des détails, de la profondeur, des nuances."
        )
    else:
        user_parts.append(
            "\nAucun contenu existant. Invente tout à partir du titre et du contexte de l'univers."
        )
    
    if request.book_summary:
        user_parts.append(f"\n\nRÉSUMÉ DE L'OUVRAGE : {request.book_summary}")
    
    if request.all_entries_context:
        user_parts.append(
            f"\n\nAUTRES ÉLÉMENTS DE L'UNIVERS (reste cohérent avec eux) :\n{request.all_entries_context}"
        )
    
    user_content = "".join(user_parts)
    
    return StreamingResponse(
        stream_from_mistral_small(prompt, user_content),
        media_type="text/plain"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)