(() => {
  const el = Object.fromEntries(['micBtn', 'lang', 'status', 'timer', 'transcript', 'copyBtn', 'speakBtn', 'testAudioBtn', 'clearBtn'].map(id => [id, document.getElementById(id)]));
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let session = null;
  let saving = false;
  let text = '';
  let interim = '';
  let playback = null;
  let playbackTimer = null;
  const synth = window.speechSynthesis;
  // Start loading the browser's asynchronously populated voice list.
  if (synth) synth.getVoices();
  function stopPlayback() {
    const wasPlaying = Boolean(playback);
    playback = null;
    clearTimeout(playbackTimer);
    el.speakBtn.textContent = '🔊 Speak';
    if (synth && wasPlaying) synth.cancel();
  }

  function updateTranscriptActions() {
    const empty = !text.trim() && !interim.trim();
    el.speakBtn.disabled = Boolean(session) || saving || empty;
    el.testAudioBtn.disabled = Boolean(session) || saving;
    el.copyBtn.disabled = empty;
  }

  function render() {
    el.transcript.textContent = text + (interim ? `${text ? ' ' : ''}${interim}` : '');
    if (!text && !interim) el.transcript.textContent = 'Your words will appear here…';
    updateTranscriptActions();
  }
  function controls(active) {
    el.micBtn.classList.toggle('live', active);
    el.micBtn.textContent = active ? '⏹' : '🎤';
    el.micBtn.setAttribute('aria-label', active ? 'Stop recording' : 'Start recording');
    el.lang.disabled = active || saving;
    el.clearBtn.disabled = active || saving;
    el.micBtn.disabled = saving || !Recognition;
    updateTranscriptActions();
  }
  async function finish(current) {
    if (session !== current) return;
    session = null;
    clearTimeout(current.deadline);
    clearInterval(current.timer);
    current.recognition.onend = current.recognition.onresult = current.recognition.onerror = current.recognition.onstart = null;
    current.recognition.onaudiostart = current.recognition.onsoundstart = current.recognition.onspeechstart = null;
    try { current.recognition.abort(); } catch (_) {}
    // Interim hypotheses are not reliable final transcripts. Keep them visible for copying.
    const duration = current.started ? ((current.stoppedAt || Date.now()) - current.started) / 1000 : 0;
    saving = Boolean(text.trim());
    controls(false);
    if (!saving) {
      el.status.textContent = current.error || (interim
        ? 'The browser returned only a draft. Copy the text below before trying again; it has not been saved.'
        : !current.audioStarted
          ? 'The browser did not start capturing audio. Check Chrome microphone permission and your selected input in System Settings → Sound → Input.'
          : !current.soundDetected
            ? 'No sound was detected. Check that your microphone is unmuted and that the input level moves in System Settings → Sound → Input.'
            : 'Sound was detected, but the browser returned no transcript. Check your internet connection, then try a short sentence in the selected language.');
      return;
    }
    el.status.textContent = 'Saving transcript…';
    try {
      const saved = await API.request('/transcriptions', {
        method: 'POST',
        body: JSON.stringify({ title: `Live recording ${new Date().toLocaleString()}`, text: text.trim(), language: current.language, source: 'live', duration_seconds: duration }),
        signal: AbortSignal.timeout(15000),
      });
      el.status.textContent = `${current.error ? current.error + ' ' : ''}Saved as transcription #${saved.id}. Open the Dashboard to edit it.`;
    } catch (_) {
      el.status.textContent = 'Could not save to the dashboard. Your transcript is still here—copy it before leaving.';
    } finally {
      saving = false;
      controls(false);
    }
  }
  function stop() {
    const current = session;
    if (!current || current.stopping) return;
    current.stopping = true;
    current.stoppedAt = Date.now();
    clearInterval(current.timer);
    clearTimeout(current.deadline);
    el.status.textContent = 'Finishing transcription…';
    el.micBtn.disabled = true;
    current.deadline = setTimeout(() => {
      current.error = text.trim()
        ? 'The browser timed out while finishing; the last words may be missing.'
        : interim
          ? 'The browser timed out. Your draft is still visible below—copy it before trying again.'
          : 'The browser speech service did not return a result within 20 seconds. Check your internet connection and microphone input, then try again.';
      finish(current);
    }, 20000);
    try { current.recognition.stop(); } catch (_) { finish(current); }
  }
  function start() {
    if (saving || session || !Recognition) return;
    stopPlayback();
    const recognition = new Recognition();
    const current = { recognition, language: el.lang.value, started: 0, error: '', stopping: false, audioStarted: false, soundDetected: false };
    recognition.lang = current.language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;
    session = current;
    text = interim = '';
    render();
    controls(true);
    el.timer.textContent = '00:00';
    el.status.textContent = 'Starting… allow microphone access if prompted.';
    current.deadline = setTimeout(() => {
      current.error = 'Speech recognition did not start. Check microphone permission and try again.';
      finish(current);
    }, 20000);
    recognition.onstart = () => {
      if (session !== current || current.stopping) return;
      clearTimeout(current.deadline);
      current.started = Date.now();
      el.status.textContent = 'Listening… press Stop when finished.';
      current.timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - current.started) / 1000);
        el.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }, 250);
    };
    recognition.onaudiostart = () => {
      if (session !== current) return;
      current.audioStarted = true;
      if (!current.stopping) el.status.textContent = 'Microphone connected. Speak a short sentence, then press Stop.';
    };
    recognition.onsoundstart = () => {
      if (session !== current) return;
      current.soundDetected = true;
      if (!current.stopping) el.status.textContent = 'Sound detected… listening for words.';
    };
    recognition.onspeechstart = () => {
      if (session !== current) return;
      current.soundDetected = true;
      if (!current.stopping) el.status.textContent = 'Speech detected… transcribing.';
    };
    recognition.onresult = event => {
      if (session !== current) return;
      const finalParts = [], pendingParts = [];
      for (let i = 0; i < event.results.length; i++) {
        (event.results[i].isFinal ? finalParts : pendingParts).push(event.results[i][0].transcript.trim());
      }
      text = finalParts.join(' ');
      interim = pendingParts.join(' ');
      render();
    };
    recognition.onerror = event => {
      if (session !== current) return;
      const messages = {
        'not-allowed': 'Microphone access was denied. Allow it in your browser site settings.',
        'service-not-allowed': 'The browser speech service is unavailable. Try Chrome.',
        'audio-capture': 'No microphone was found. Check your microphone connection.',
        'network': 'The browser speech service could not connect. Check your internet connection.',
        'no-speech': 'No speech was detected. Speak clearly and try again.',
        'language-not-supported': 'This browser does not support the selected speech language.',
      };
      current.error = messages[event.error] || 'Speech recognition stopped. Please try again.';
      finish(current);
    };
    recognition.onend = () => finish(current);
    try { recognition.start(); } catch (_) {
      current.error = 'Could not start speech recognition. Try Chrome and check microphone permissions.';
      finish(current);
    }
  }
  el.micBtn.addEventListener('click', () => session ? stop() : start());
  el.copyBtn.addEventListener('click', async () => {
    if (!text && !interim) return;
    try {
      await navigator.clipboard.writeText([text, interim].filter(Boolean).join(' '));
      if (!session && !saving) el.status.textContent = 'Copied to clipboard.';
    } catch (_) { el.status.textContent = 'Could not copy automatically. Select the transcript and copy it.'; }
  });
  function playText(sample = null) {
    if (session || saving) return;
    if (playback) { stopPlayback(); el.status.textContent = 'Playback stopped.'; return; }
    const spokenText = sample || [text, interim].filter(Boolean).join(' ').trim();
    if (!spokenText) return; // Preserve the recording error when no transcript exists.
    if (!synth || !window.SpeechSynthesisUtterance) {
      el.status.textContent = 'Speech playback is unavailable in this browser. Try Chrome or Safari.';
      return;
    }
    const lang = /[ऀ-ॿ]/.test(spokenText) ? 'hi-IN' : 'en-IN';
    const voices = synth.getVoices();
    const voice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase())
      || voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    if (voices.length && !voice) {
      el.status.textContent = `No ${lang === 'hi-IN' ? 'Hindi' : 'English'} playback voice is available. Add a voice for this language in your device’s speech settings, then reopen this page.`;
      return;
    }
    stopPlayback();
    const utterance = new window.SpeechSynthesisUtterance(spokenText);
    playback = utterance; // Keep a reference until playback ends.
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.volume = 1;
    utterance.rate = 1;
    utterance.pitch = 1;
    el.speakBtn.textContent = '⏹ Stop audio';
    el.status.textContent = 'Starting playback…';
    utterance.onstart = () => {
      if (playback !== utterance) return;
      clearTimeout(playbackTimer);
      el.status.textContent = 'Reading your transcript aloud…';
    };
    utterance.onend = () => {
      if (playback !== utterance) return;
      stopPlayback();
      el.status.textContent = 'Playback finished.';
    };
    utterance.onerror = event => {
      if (playback !== utterance) return;
      stopPlayback();
      el.status.textContent = ['language-unavailable', 'voice-unavailable'].includes(event.error)
        ? 'The playback voice is unavailable. Add a voice for this language in your device’s speech settings and try again.'
        : `Playback failed (${event.error || 'unknown'}). Check your sound output and try again.`;
    };
    playbackTimer = setTimeout(() => {
      if (playback !== utterance) return;
      stopPlayback();
      el.status.textContent = 'Playback did not start. Check your device’s speech voices and sound output, then press Speak again.';
    }, 10000);
    try {
      synth.resume();
      synth.speak(utterance);
    } catch (_) {
      stopPlayback();
      el.status.textContent = 'Could not start playback. Check your browser’s speech voices and try again.';
    }
  }
  el.speakBtn.addEventListener('click', () => playText());
  el.testAudioBtn.addEventListener('click', () => playText(el.lang.value === 'hi' ? 'नमस्ते। यह आवाज़ की जाँच है।' : 'Hello. This is an audio playback test.'));
  el.clearBtn.addEventListener('click', () => {
    if (session || saving) return;
    stopPlayback();
    text = interim = '';
    render();
    el.status.textContent = 'Cleared. Press the mic to start again.';
  });
  controls(false);
  if (!Recognition) el.status.textContent = 'Speech recognition is unavailable in this browser. Open this site in Chrome.';
})();
