"""Speech-to-text engine: open-source Whisper (faster-whisper / CTranslate2), self-hosted.

Whisper is multilingual and auto-detects the spoken language, so it handles
Hindi, English and mixed Hinglish speech without any paid API.
"""

import logging
import threading

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
            from faster_whisper import WhisperModel  # imported lazily so tests run without it

            log.info("Loading Whisper model '%s' (first run downloads it)...", settings.whisper_model)
            _model = WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
            )
            log.info("Whisper model loaded.")
    return _model


def transcribe(audio: np.ndarray, language: str | None) -> tuple[str, str | None]:
    """Transcribe mono float32 audio sampled at 16 kHz.

    Returns (text, detected_language). language=None means auto-detect.
    """
    if audio.size < MIN_SAMPLES:
        return "", None

    model = get_model()
    with _infer_lock:
        segments, info = model.transcribe(
            audio,
            language=language or None,
            task="transcribe",
            beam_size=1,            # greedy decoding: fastest, good enough for live text
            vad_filter=True,        # skip silence
            initial_prompt=settings.initial_prompt,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, info.language
