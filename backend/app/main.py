import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routes_audio import router as audio_router
from .config import settings
from .database import init_db
from .routes_transcriptions import router as transcriptions_router
from .routes_ws import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# project/frontend  (this file is project/backend/app/main.py)
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Speech to Text", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "whisper_model": settings.whisper_model,
            "transport": "http" if settings.hf_token or os.getenv("VERCEL") else "websocket",
            "hosted_configured": bool(settings.hf_token)}


app.include_router(transcriptions_router)
app.include_router(ws_router)
app.include_router(audio_router)

# Serve the frontend from the same server (mounted last so /api and /ws routes win).
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
