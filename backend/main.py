from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import os
from backend.models import ReviewRequest
from backend.mistral_utils import stream_critique_from_mistral
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
    
    # Build full prompt: general + writer profile + reviewer personality
    parts = [GENERAL_PROMPT]
    if request.writer_profile:
        parts.append(
            f"\n\nProfil de l'auteur que tu critiques (adapte tes conseils en conséquence) : {request.writer_profile}"
        )
    parts.append(f"\n\n{reviewer_prompt}")
    full_prompt = "".join(parts)
    
    return StreamingResponse(
        stream_critique_from_mistral(request.text, full_prompt),
        media_type="text/plain"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)