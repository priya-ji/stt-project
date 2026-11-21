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
  let useHttp = false;
  let chunks = [];
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
  let sentSamples = 0;
  let peakLevel = 0;

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
    const inRate = audioCtx.sampleRate;

    source = audioCtx.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(audioCtx, "microphone-pcm");
    mute = audioCtx.createGain();
    mute.gain.value = 0; // keeps the processor running without playing the mic back

    processor.port.onmessage = (event) => {
      if (!recording) return;
      if (!useHttp && (!ws || ws.readyState !== WebSocket.OPEN)) return;
      const input = event.data;
      for (const sample of input) peakLevel = Math.max(peakLevel, Math.abs(sample));
      let samples = inRate === TARGET_RATE ? input : downsample(input, inRate, TARGET_RATE);
      if (useHttp) samples = samples.subarray(0, TARGET_RATE * 60 - sentSamples);
      if (useHttp) chunks.push(floatTo16BitPCM(samples));
      else ws.send(floatTo16BitPCM(samples));
      sentSamples += samples.length;
      if (useHttp && sentSamples >= TARGET_RATE * 60) stop();
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
  }

  function teardownAudio() {
    if (processor) {
      processor.port.onmessage = null;
      processor.port.close();
      processor.disconnect();
    }
    if (source) source.disconnect();
    if (mute) mute.disconnect();
    if (audioCtx) audioCtx.close().catch(() => {});
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
    sentSamples = 0;
    peakLevel = 0;
    chunks = [];
    micBtn.disabled = true;
    setStatus("Starting microphone…");
    try {
      // Resume during the click gesture, before microphone/network awaits.
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_RATE });
      await audioCtx.resume();
      const health = await fetch("/api/health", { signal: AbortSignal.timeout(10000) });
      if (!health.ok) throw new Error("The transcription server is unavailable");
      const config = await health.json();
      useHttp = config.transport === "http";
      if (useHttp && !config.hosted_configured) {
        throw new Error("Set HF_TOKEN in Vercel for this environment and redeploy");
      }
      await audioCtx.audioWorklet.addModule("/js/pcm-worklet.js");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (audioCtx.state !== "running") throw new Error("Audio is suspended");
    } catch (error) {
      teardownAudio();
      busy = false;
      micBtn.disabled = false;
      setStatus(`Could not start microphone: ${error.message}. Check microphone permissions and try again.`);
      return;
    }

    confirmedText = "";
    pendingText = "";
    renderTranscript();
    timerEl.textContent = "00:00";

    if (useHttp) {
      try {
        setupAudioGraph();
        micBtn.disabled = false;
        setRecording(true);
        startTimer();
        setStatus("Recording… press Stop to transcribe (maximum 60 seconds; language detected automatically).");
      } catch (error) {
        teardownAudio();
        busy = false;
        micBtn.disabled = false;
        setStatus(`Could not capture audio: ${error.message}`);
      }
      return;
    }

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${location.host}/ws/transcribe?lang=${encodeURIComponent(langSel.value)}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      try {
        setupAudioGraph();
      } catch (error) {
        finished = true;
        setStatus(`Could not capture microphone audio: ${error.message}`);
        ws.close();
        return;
      }
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
    if (useHttp) {
      uploadRecording();
      return;
    }
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

  async function uploadRecording() {
    try {
      const response = await fetch(`/api/audio?lang=${encodeURIComponent(langSel.value)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Blob(chunks, { type: "application/octet-stream" }),
        signal: AbortSignal.timeout(60000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : `Transcription failed (${response.status}).`);
      if (typeof result.text !== "string") throw new Error("The server returned an invalid transcript.");
      confirmedText = result.text;
      pendingText = "";
      renderTranscript();
      setStatus(result.warning || (result.id
        ? `Saved as transcription #${result.id}. Open the Dashboard to edit or delete it.`
        : "No speech was recognized. Check your microphone and try again."));
    } catch (error) {
      setStatus(error.name === "TimeoutError" ? "Transcription timed out. Please try a shorter recording." : error.message);
    } finally {
      chunks = [];
      busy = false;
      micBtn.disabled = false;
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
          : sentSamples === 0
            ? "No microphone audio was captured. Check your microphone input and permissions."
            : sentSamples < TARGET_RATE / 2
              ? "Recording was too short. Speak for a few seconds before pressing Stop."
              : peakLevel < 0.001
                ? "Your microphone is silent. Check that it is unmuted and the correct input is selected."
                : "Audio received, but no speech was recognized. Try speaking clearly and selecting Hindi or English."
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
