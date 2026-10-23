import json

import numpy as np

from app import routes_ws


def test_stream_sends_partial_then_saves_final(client, monkeypatch):
    """Runs the WebSocket protocol with a fake transcriber (no model download needed)."""
    calls = []

    def fake_transcribe(audio, language):
        calls.append(len(audio))
        return f"chunk{len(calls)}", "hi"

    monkeypatch.setattr(routes_ws, "transcribe", fake_transcribe)

    two_seconds_of_silence = np.zeros(16_000 * 2, dtype=np.int16).tobytes()

    with client.websocket_connect("/ws/transcribe?lang=auto") as ws:
        ws.send_bytes(two_seconds_of_silence)
        partial = ws.receive_json()
        assert partial["type"] == "partial"
        assert partial["pending"] == "chunk1"
        assert partial["language"] == "hi"

        ws.send_text(json.dumps({"type": "stop"}))
        final = ws.receive_json()

    assert final["type"] == "final"
    assert final["text"] == "chunk1"
    assert final["id"] is not None
    assert final["duration_seconds"] == 2.0

    saved = client.get("/api/transcriptions").json()
    assert saved["total"] == 1
    assert saved["items"][0]["source"] == "live"
    assert saved["items"][0]["text"] == "chunk1"


def test_empty_session_saves_nothing(client, monkeypatch):
    monkeypatch.setattr(routes_ws, "transcribe", lambda audio, lang: ("", None))
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_text(json.dumps({"type": "stop"}))
        final = ws.receive_json()
    assert final["id"] is None
    assert client.get("/api/transcriptions").json()["total"] == 0
