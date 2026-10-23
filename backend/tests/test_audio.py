import io
import wave
from types import SimpleNamespace
from unittest.mock import Mock

from app import routes_audio
from app.config import settings


def test_missing_token(client, monkeypatch):
    monkeypatch.setattr(settings, "hf_token", None)
    response = client.post("/api/audio", content=b"\0" * 32000)
    assert response.status_code == 503
    assert "HF_TOKEN" in response.json()["detail"]


def test_hosted_audio_saved(client, monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "test-token")
    inference = Mock()
    inference.automatic_speech_recognition.return_value = SimpleNamespace(text="Hello नमस्ते")
    monkeypatch.setattr(routes_audio, "InferenceClient", Mock(return_value=inference))
    response = client.post("/api/audio", content=b"\0" * 32000)
    assert response.status_code == 200
    result = response.json()
    assert result["text"] == "Hello नमस्ते"
    assert result["id"]
    assert client.get(f'/api/transcriptions/{result["id"]}').json()["text"] == result["text"]
    wav_bytes = inference.automatic_speech_recognition.call_args.args[0]
    with wave.open(io.BytesIO(wav_bytes)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()) == (1, 2, 16000, 16000)


def test_invalid_and_oversize_audio(client, monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "test-token")
    inference = Mock()
    monkeypatch.setattr(routes_audio, "recognize", inference)
    for body, status in [(b"x", 400), (b"x" * 16001, 400), (b"x" * (routes_audio.MAX_BYTES + 1), 413)]:
        assert client.post("/api/audio", content=body).status_code == status
    inference.assert_not_called()


def test_provider_failure_does_not_leak_token(client, monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "private-token")
    inference = Mock()
    error = RuntimeError("private-token")
    error.response = SimpleNamespace(status_code=401)
    inference.automatic_speech_recognition.side_effect = error
    monkeypatch.setattr(routes_audio, "InferenceClient", Mock(return_value=inference))
    response = client.post("/api/audio", content=b"\0" * 32000)
    assert response.status_code == 502
    assert "permissions" in response.text
    assert "private-token" not in response.text


def test_save_failure_preserves_transcript(client, monkeypatch):
    monkeypatch.setattr(settings, "hf_token", "test-token")
    monkeypatch.setattr(routes_audio, "recognize", lambda audio: "Keep this text")
    monkeypatch.setattr(routes_audio, "_save", Mock(side_effect=RuntimeError("database failed")))
    result = client.post("/api/audio", content=b"\0" * 32000).json()
    assert result["text"] == "Keep this text"
    assert result["id"] is None
    assert "could not save" in result["warning"]


def test_vercel_selects_http_without_token(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(settings, "hf_token", None)
    result = client.get("/api/health").json()
    assert result["transport"] == "http"
    assert result["hosted_configured"] is False
