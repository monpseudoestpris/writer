from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import os
from backend.models import ReviewRequest, SummarizeRequest
from backend.mistral_utils import stream_critique_from_mistral, summarize_critiques, summarize_single_critique
from backend.prompts import REVIEWER_PROMPTS, REVIEWER_NAMES, GENERAL_PROMPT

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)