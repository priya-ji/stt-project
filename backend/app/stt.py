"""Speech-to-text engine: open-source Whisper (faster-whisper / CTranslate2), self-hosted.

Whisper is multilingual and auto-detects the spoken language, so it handles
Hindi, English and mixed Hinglish speech without any paid API.
"""

import logging
import os
import tempfile
import threading
from pathlib import Path

import numpy as np

from .config import settings

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
MIN_SAMPLES = SAMPLE_RATE // 2  # ignore clips shorter than 0.5s (Whisper hallucinates on them)

_model = None
_load_lock = threading.Lock()
_infer_lock = threading.Lock()  # a single model instance must not run two inferences at once


def get_model():
    global _model
    with _load_lock:
        if _model is None:
            download_root = settings.whisper_download_root
            if os.environ.get("VERCEL") == "1":
                # Serverless deployments cannot write to the normal home cache.
                cache_root = Path(tempfile.gettempdir()) / "stt-model-cache"
                download_root = download_root or str(cache_root / "hub")
                os.environ.setdefault("HF_XET_CACHE", str(cache_root / "xet"))
            from faster_whisper import WhisperModel  # imported lazily so tests run without it

            log.info("Loading Whisper model '%s' (first run downloads it)...", settings.whisper_model)
            _model = WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
                download_root=download_root,
            )
            log.info("Whisper model loaded.")
    return _model


class TranscriptionError(RuntimeError):
    def __init__(self, stage: str, cause: Exception):
        self.stage = stage
        self.failure_type = type(cause).__name__
        super().__init__(f"{stage} failed")


def transcribe(audio: np.ndarray, language: str | None) -> tuple[str, str | None]:
    """Transcribe mono float32 audio sampled at 16 kHz.

    Returns (text, detected_language). language=None means auto-detect.
    """
    if audio.size < MIN_SAMPLES:
        return "", None

    try:
        model = get_model()
    except Exception as exc:
        raise TranscriptionError("MODEL_LOAD", exc) from exc
    try:
        return _transcribe_audio(model, audio, language)
    except Exception as exc:
        raise TranscriptionError("AUDIO_INFERENCE", exc) from exc


def _transcribe_audio(model, audio, language):
    with _infer_lock:
        from faster_whisper.vad import collect_chunks, get_speech_timestamps

        # faster-whisper 1.0.3 crashes during auto language detection when
        # its VAD removes the entire window. Filter once and handle silence.
        speech = get_speech_timestamps(audio)
        if not speech:
            return "", None
        audio = collect_chunks(audio, speech)
        if audio.size == 0:
            return "", None
        segments, info = model.transcribe(
            audio,
            language=language or None,
            task="transcribe",
            beam_size=1,            # greedy decoding: fastest, good enough for live text
            vad_filter=False,       # already filtered above
            initial_prompt=settings.initial_prompt,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, info.language
