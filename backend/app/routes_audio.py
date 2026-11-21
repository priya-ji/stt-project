"""Bounded HTTP transcription for hosted deployments."""
import io
import logging
import wave

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from huggingface_hub import InferenceClient

from .config import settings
from .routes_ws import _save

router = APIRouter()
MAX_BYTES = 16000 * 2 * 60  # one minute of mono 16-bit PCM


def recognize(pcm: bytes) -> str:
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm)
    try:
        client = InferenceClient(token=settings.hf_token, timeout=45)
        return client.automatic_speech_recognition(
            audio.getvalue(), model=settings.hf_asr_model
        ).text.strip()
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (401, 403):
            detail = "Hugging Face rejected the token. Check HF_TOKEN and its inference permissions."
        elif status == 402:
            detail = "Hugging Face inference credits are required. Check your Hugging Face billing."
        elif status == 429:
            detail = "Hugging Face is rate limiting requests. Please try again shortly."
        else:
            detail = "Hosted transcription failed or timed out. Check the model's provider availability and try again."
        # Never return provider exception text: it may contain credentials.
        raise HTTPException(status_code=502, detail=detail) from None


@router.post("/api/audio")
async def transcribe_audio(request: Request, lang: str = Query("auto")):
    if not settings.hf_token:
        raise HTTPException(503, "Set HF_TOKEN on this deployment and redeploy to enable hosted transcription.")
    if lang not in ("auto", "en", "hi"):
        raise HTTPException(422, "Unsupported language.")
    pcm = bytearray()
    async for chunk in request.stream():
        pcm.extend(chunk)
        if len(pcm) > MAX_BYTES:
            raise HTTPException(413, "Recordings must be no longer than 60 seconds.")
    if len(pcm) < 16000 or len(pcm) % 2:
        raise HTTPException(400, "Record at least half a second of mono 16 kHz PCM audio.")
    text = await run_in_threadpool(recognize, bytes(pcm))
    duration = len(pcm) / 32000
    saved_id = None
    warning = None
    try:
        # Hosted ASR detects language automatically; do not label it with a guess.
        saved_id = await run_in_threadpool(_save, text, None, duration)
    except Exception:
        logging.getLogger(__name__).warning("Transcript persistence failed")
        warning = "Transcribed, but could not save to the dashboard. Copy your text and check DATABASE_URL."
    return {"type": "final", "id": saved_id, "text": text,
            "language": None, "duration_seconds": duration, "warning": warning}
