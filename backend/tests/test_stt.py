from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

from app import stt


def test_silent_audio_skips_language_detection(monkeypatch):
    model = Mock()
    monkeypatch.setattr(stt, 'get_model', lambda: model)
    assert stt.transcribe(np.zeros(32000, dtype=np.float32), None) == ('', None)
    model.transcribe.assert_not_called()


def test_speech_is_transcribed_after_filtering(monkeypatch):
    from faster_whisper import vad

    model = Mock()
    model.transcribe.return_value = ([SimpleNamespace(text=' Hello ')], SimpleNamespace(language='en'))
    monkeypatch.setattr(stt, 'get_model', lambda: model)
    monkeypatch.setattr(vad, 'get_speech_timestamps', lambda audio: [{'start': 1000, 'end': 16000}])
    assert stt.transcribe(np.ones(32000, dtype=np.float32), 'en') == ('Hello', 'en')
    assert model.transcribe.call_args.args[0].size == 15000
    assert model.transcribe.call_args.kwargs['vad_filter'] is False


def test_vercel_model_uses_writable_cache(monkeypatch, tmp_path):
    import faster_whisper

    factory = Mock()
    monkeypatch.setattr(faster_whisper, 'WhisperModel', factory)
    monkeypatch.setattr(stt, '_model', None)
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.delenv('HF_XET_CACHE', raising=False)
    monkeypatch.setattr(stt.tempfile, 'gettempdir', lambda: str(tmp_path))
    monkeypatch.setattr(stt.settings, 'whisper_download_root', None)
    stt.get_model()
    assert factory.call_args.kwargs['download_root'] == str(tmp_path / 'stt-model-cache' / 'hub')
    assert stt.os.environ['HF_XET_CACHE'] == str(tmp_path / 'stt-model-cache' / 'xet')


def test_local_model_preserves_default_cache(monkeypatch):
    import faster_whisper

    factory = Mock()
    monkeypatch.setattr(faster_whisper, 'WhisperModel', factory)
    monkeypatch.setattr(stt, '_model', None)
    monkeypatch.delenv('VERCEL', raising=False)
    monkeypatch.setattr(stt.settings, 'whisper_download_root', None)
    stt.get_model()
    assert factory.call_args.kwargs['download_root'] is None
