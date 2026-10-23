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
