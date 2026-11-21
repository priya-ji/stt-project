"""WebSocket endpoint for live transcription.

Protocol
--------
Client -> server
  * binary frames: raw PCM, 16-bit signed little-endian, mono, 16 kHz
  * text frame  : {"type": "stop"} when the user stops speaking

Server -> client
  * {"type": "partial", "confirmed": "...", "pending": "...", "language": "hi"}
      sent every `partial_interval_sec` seconds while audio arrives
  * {"type": "final", "id": 12, "text": "...", "language": "hi", "duration_seconds": 14.2}
      sent after "stop"; the transcript has already been saved to the database
"""

import asyncio
import json
import logging
from contextlib import suppress
from datetime import datetime

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .config import settings
from .database import SessionLocal
from .models import Transcription
from .stt import SAMPLE_RATE, TranscriptionError, transcribe

router = APIRouter()


def _save(text: str, language: str | None, duration: float) -> int | None:
    if not text.strip():
        return None
    with SessionLocal() as db:
        row = Transcription(
            title=f"Live recording {datetime.now():%d %b %Y, %H:%M}",
            text=text.strip(),
            language=language,
            source="live",
            duration_seconds=round(duration, 2),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id


@router.websocket("/ws/transcribe")
async def transcribe_ws(ws: WebSocket, lang: str | None = None):
    await ws.accept()
    try:
        await _transcribe_session(ws, lang)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        code = exc.stage if isinstance(exc, TranscriptionError) else "SESSION"
        failure_type = exc.failure_type if isinstance(exc, TranscriptionError) else type(exc).__name__
        # Class names and fixed stage codes contain no credentials or server paths.
        diagnostic = f"{code}/{failure_type}"
        logging.getLogger(__name__).exception("Transcription session failed [%s]", diagnostic)
        with suppress(Exception):
            await ws.send_json({
                "type": "error",
                "code": diagnostic,
                "message": f"Transcription failed ({diagnostic}). Please share this code to diagnose the server issue.",
            })
            await ws.close(code=1011)


async def _transcribe_session(ws: WebSocket, lang: str | None):
    language = None if lang in (None, "", "auto") else lang

    tick = int(settings.partial_interval_sec * SAMPLE_RATE)
    max_window = int(settings.max_window_sec * SAMPLE_RATE)

    committed: list[str] = []           # text locked in from earlier windows
    buffer = np.zeros(0, dtype=np.float32)  # audio of the current, not-yet-locked window
    pending = ""                        # latest transcript of `buffer`
    detected: str | None = None
    total_samples = 0
    new_samples = 0                     # audio received since the last transcription
    stopped_by_client = False

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break

            if message.get("text"):
                if json.loads(message["text"]).get("type") == "stop":
                    stopped_by_client = True
                    break
                continue

            data = message.get("bytes")
            if not data:
                continue

            pcm = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            buffer = np.concatenate([buffer, pcm])
            total_samples += pcm.size
            new_samples += pcm.size

            if new_samples < tick:
                continue
            new_samples = 0

            # Re-transcribe the current window so the live text keeps improving.
            pending, lang_found = await asyncio.to_thread(transcribe, buffer, language)
            detected = lang_found or detected

            if len(buffer) >= max_window:
                # Window is full: lock its text in and start a new window.
                if pending:
                    committed.append(pending)
                buffer = np.zeros(0, dtype=np.float32)
                pending = ""

            await ws.send_json({
                "type": "partial",
                "confirmed": " ".join(committed),
                "pending": pending,
                "language": detected,
            })
    except WebSocketDisconnect:
        pass  # browser closed the tab: keep what we have and save it below

    # If the user pressed stop, transcribe any audio that has not been processed yet.
    if stopped_by_client and new_samples > 0 and len(buffer) > 0:
        pending, lang_found = await asyncio.to_thread(transcribe, buffer, language)
        detected = lang_found or detected

    final_text = " ".join(committed + ([pending] if pending else [])).strip()
    duration = total_samples / SAMPLE_RATE
    saved_id = await asyncio.to_thread(_save, final_text, detected, duration)

    with suppress(Exception):  # the client may already be gone
        await ws.send_json({
            "type": "final",
            "id": saved_id,
            "text": final_text,
            "language": detected,
            "duration_seconds": round(duration, 2),
        })
        await ws.close()
