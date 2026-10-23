(() => {
  const micBtn = document.getElementById("micBtn");
  const langSel = document.getElementById("lang");
  const statusEl = document.getElementById("status");
  const timerEl = document.getElementById("timer");
  const transcriptEl = document.getElementById("transcript");
  const copyBtn = document.getElementById("copyBtn");
  const speakBtn = document.getElementById("speakBtn");
  const clearBtn = document.getElementById("clearBtn");

  const TARGET_RATE = 16000; // the server expects 16 kHz audio
  let ws = null;
  let stream = null;
  let audioCtx = null;
  let source = null;
  let processor = null;
  let mute = null;
  let recording = false;
  let busy = false;
  let finished = false;
  let finalTimeout = null;
  let timerId = null;
  let startedAt = 0;
  let confirmedText = "";
  let pendingText = "";

  // ---------- UI helpers ----------
  function setStatus(message) {
    statusEl.textContent = message;
  }

  function setRecording(on) {
    recording = on;
    micBtn.classList.toggle("live", on);
    micBtn.textContent = on ? "⏹" : "🎤";
    micBtn.setAttribute("aria-label", on ? "Stop recording" : "Start recording");
    langSel.disabled = on;
  }

  function renderTranscript() {
    transcriptEl.textContent = "";
    if (!confirmedText && !pendingText) {
      const hint = document.createElement("span");
      hint.className = "placeholder";
      hint.textContent = "Your words will appear here…";
      transcriptEl.append(hint);
      return;
    }
    const confirmed = document.createElement("span");
    confirmed.textContent = confirmedText;
    const pending = document.createElement("span");
    pending.className = "pending";
    pending.textContent = pendingText ? (confirmedText ? " " : "") + pendingText : "";
    transcriptEl.append(confirmed, pending);
  }

  function startTimer() {
    startedAt = Date.now();
    timerId = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      timerEl.textContent = `${mm}:${ss}`;
    }, 250);
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  // ---------- Audio helpers ----------
  // Average neighbouring samples to convert e.g. 48 kHz -> 16 kHz.
  function downsample(buffer, inRate, outRate) {
    const ratio = inRate / outRate;
    const length = Math.round(buffer.length / ratio);
    const result = new Float32Array(length);
    let offset = 0;
    for (let i = 0; i < length; i++) {
      const nextOffset = Math.round((i + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let j = offset; j < nextOffset && j < buffer.length; j++) {
        sum += buffer[j];
        count++;
      }
      result[i] = count ? sum / count : 0;
      offset = nextOffset;
    }
    return result;
  }

  // Float samples in [-1, 1] -> 16-bit PCM bytes.
  function floatTo16BitPCM(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out.buffer;
  }

  function setupAudioGraph() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    const inRate = audioCtx.sampleRate;

    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    mute = audioCtx.createGain();
    mute.gain.value = 0; // keeps the processor running without playing the mic back

    processor.onaudioprocess = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const samples = inRate === TARGET_RATE ? input : downsample(input, inRate, TARGET_RATE);
      ws.send(floatTo16BitPCM(samples));
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
  }

  function teardownAudio() {
    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
    }
    if (source) source.disconnect();
    if (mute) mute.disconnect();
    if (audioCtx) audioCtx.close();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    processor = source = mute = audioCtx = stream = null;
  }

  // ---------- Recording flow ----------
  async function start() {
    if (busy) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Microphone needs HTTPS (or localhost).");
      return;
    }
    busy = true;
    finished = false;
    micBtn.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      busy = false;
      micBtn.disabled = false;
      setStatus("Microphone access was denied or is unavailable.");
      return;
    }

    confirmedText = "";
    pendingText = "";
    renderTranscript();
    timerEl.textContent = "00:00";

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${location.host}/ws/transcribe?lang=${encodeURIComponent(langSel.value)}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setupAudioGraph();
      micBtn.disabled = false;
      setRecording(true);
      startTimer();
      setStatus("Listening… speak in Hindi, English, or both.");
    };
    ws.onmessage = onMessage;
    ws.onerror = () => setStatus("Could not reach the transcription server.");
    ws.onclose = () => {
      clearTimeout(finalTimeout);
      teardownAudio();
      stopTimer();
      setRecording(false);
      busy = false;
      micBtn.disabled = false;
      if (!finished) setStatus("Connection closed before transcription finished. Please try again.");
    };
  }

  function stop() {
    teardownAudio();
    stopTimer();
    setRecording(false);
    micBtn.disabled = true;
    setStatus("Processing the last words…");
    finalTimeout = setTimeout(() => {
      finished = true;
      setStatus("Transcription timed out. Please try again.");
      if (ws) ws.close();
    }, 120000);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    } else if (ws) {
      ws.close();
    }
  }

  function onMessage(event) {
    const msg = JSON.parse(event.data);

    if (msg.type === "partial") {
      confirmedText = msg.confirmed;
      pendingText = msg.pending;
      renderTranscript();
    } else if (msg.type === "final") {
      finished = true;
      clearTimeout(finalTimeout);
      confirmedText = msg.text;
      pendingText = "";
      renderTranscript();
      setStatus(
        msg.id
          ? `Saved as transcription #${msg.id}. Open the Dashboard to edit or delete it.`
          : "No speech was detected."
      );
      ws.close();
    } else if (msg.type === "error") {
      finished = true;
      clearTimeout(finalTimeout);
      setStatus(msg.message || "Transcription failed. Please try again.");
      ws.close();
    }
  }

  micBtn.addEventListener("click", () => (recording ? stop() : start()));

  // ---------- Extra tools ----------
  copyBtn.addEventListener("click", async () => {
    const text = (confirmedText + " " + pendingText).trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus("Copied to clipboard.");
  });

  // Text-to-speech using the browser's built-in (free) speech synthesis.
  speakBtn.addEventListener("click", () => {
    const text = (confirmedText + " " + pendingText).trim();
    if (!text || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[ऀ-ॿ]/.test(text) ? "hi-IN" : "en-IN";
    speechSynthesis.speak(utterance);
  });

  clearBtn.addEventListener("click", () => {
    if (busy) return;
    confirmedText = "";
    pendingText = "";
    renderTranscript();
    setStatus("Cleared.");
  });

  renderTranscript();
})();
