const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup({supported = true, failSave = false, synthesis = null} = {}) {
  const elements = {}, calls = [], timers = new Map();
  let recognition, next = 0;
  class Recognition {
    constructor() { recognition = this; }
    start() { this.onstart(); }
    stop() {}
    abort() {}
  }
  const context = {
    document: { getElementById(id) { return elements[id] ||= { value:'hi', textContent:'', classList:{ toggle() {} }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } }; } },
    window: { ...(supported ? { webkitSpeechRecognition: Recognition } : {}), ...(synthesis ? { speechSynthesis: synthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } } : {}) },
    API: { async request(path, options) { calls.push({path, body:JSON.parse(options.body)}); if (failSave) throw Error('offline'); return {id:3}; } },
    AbortSignal, Date, String, Boolean, Object,
    setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval() { return 1; }, clearInterval() {},
  };
  vm.runInNewContext(fs.readFileSync('frontend/js/browser-record.js', 'utf8'), context);
  return { elements, calls, timers, get recognition() { return recognition; } };
}
function result(text, isFinal) { return Object.assign([{transcript:text}], {isFinal}); }
const flush = () => new Promise(resolve => setImmediate(resolve));
test('recognition results replace interim text, save final text once without paid API', async () => {
 const app = setup(); app.elements.micBtn.click();
 assert.equal(app.recognition.lang, 'hi-IN');
 app.recognition.onresult({results:[result('नमस्ते',false)]});
 app.recognition.onresult({results:[result('नमस्ते',true), result('hello',false)]});
 app.elements.micBtn.click();
 app.recognition.onresult({results:[result('नमस्ते',true), result('hello',true)]});
 const end = app.recognition.onend; end(); end(); await flush();
 assert.equal(app.calls.length,1); assert.equal(app.calls[0].path,'/transcriptions');
 assert.equal(app.calls[0].body.text,'नमस्ते hello'); assert.equal(app.elements.micBtn.disabled,false);
});
test('denied microphone restores controls and does not save empty text', async () => {
 const app=setup(); app.elements.micBtn.click(); app.recognition.onerror({error:'not-allowed'}); await flush();
 assert.match(app.elements.status.textContent,/denied/); assert.equal(app.calls.length,0); assert.equal(app.elements.lang.disabled,false);
});
test('save failures preserve transcript', async () => {
 const app=setup({failSave:true}); app.elements.micBtn.click(); app.recognition.onresult({results:[result('keep me',true)]}); app.recognition.onend(); await flush();
 assert.equal(app.elements.transcript.textContent,'keep me'); assert.match(app.elements.status.textContent,/Could not save/);
});
test('unsupported browsers disable recording', () => {
 const app=setup({supported:false}); assert.equal(app.elements.micBtn.disabled,true); assert.match(app.elements.status.textContent,/Chrome/);
});
test('stop timeout releases recording and saves confirmed text', async () => {
 const app=setup(); app.elements.micBtn.click(); app.recognition.onresult({results:[result('done',true)]}); app.elements.micBtn.click();
 for(const callback of [...app.timers.values()]) callback(); await flush();
 assert.equal(app.calls.length,1); assert.equal(app.elements.micBtn.disabled,false);
});

test('no audio capture has an actionable microphone diagnosis', () => {
 const app=setup(); app.elements.micBtn.click(); app.recognition.onend();
 assert.match(app.elements.status.textContent,/did not start capturing audio/);
});
test('sound without a result is distinguished from silence', () => {
 const app=setup(); app.elements.micBtn.click(); app.recognition.onaudiostart(); app.recognition.onsoundstart(); app.recognition.onend();
 assert.match(app.elements.status.textContent,/Sound was detected/);
});
test('unfinished draft remains visible and is not called no speech', () => {
 const app=setup(); app.elements.micBtn.click(); app.recognition.onresult({results:[result('draft words',false)]}); app.recognition.onend();
 assert.equal(app.elements.transcript.textContent,'draft words'); assert.match(app.elements.status.textContent,/only a draft/); assert.equal(app.calls.length,0);
});
test('late final result remains accepted after stop until the 20-second deadline', async () => {
 const app=setup(); app.elements.micBtn.click(); app.elements.micBtn.click();
 app.recognition.onresult({results:[result('delayed words',true)]}); app.recognition.onend(); await flush();
 assert.equal(app.calls[0].body.text,'delayed words'); assert.equal(app.timers.size,0);
});

function fakeSynth(voices = [{lang:'hi-IN'}]) {
 return { utterance:null, resumed:false, getVoices:()=>voices, cancel(){}, resume(){this.resumed=true;}, speak(u){this.utterance=u;} };
}
async function withTranscript(synthesis) {
 const app=setup({synthesis}); app.elements.micBtn.click();
 app.recognition.onresult({results:[result('हेलो',true)]}); app.recognition.onend(); await flush(); return app;
}
test('Speak selects Hindi voice, resumes playback and resets after completion', async () => {
 const synth=fakeSynth(); const app=await withTranscript(synth); app.elements.speakBtn.click();
 assert.equal(synth.utterance.text,'हेलो'); assert.equal(synth.utterance.voice.lang,'hi-IN'); assert.equal(synth.resumed,true);
 synth.utterance.onstart(); assert.match(app.elements.status.textContent,/Reading/);
 synth.utterance.onend(); assert.equal(app.elements.speakBtn.textContent,'🔊 Speak');
});
test('missing Hindi voice is explained instead of silently failing', async () => {
 const synth=fakeSynth([{lang:'en-US'}]); const app=await withTranscript(synth); app.elements.speakBtn.click();
 assert.match(app.elements.status.textContent,/No Hindi playback voice/); assert.equal(synth.utterance,null);
});
test('Speak surfaces synthesis errors and can stop active audio', async () => {
 const synth=fakeSynth(); const app=await withTranscript(synth); app.elements.speakBtn.click();
 synth.utterance.onerror({error:'audio-hardware'}); assert.match(app.elements.status.textContent,/audio-hardware/);
 app.elements.speakBtn.click(); app.elements.speakBtn.click(); assert.equal(app.elements.status.textContent,'Playback stopped.');
});


test('empty Speak cannot overwrite the recognition failure', () => {
 const app=setup(); app.elements.micBtn.click(); app.recognition.onerror({error:'network'});
 const error=app.elements.status.textContent;
 assert.equal(app.elements.speakBtn.disabled,true);
 app.elements.speakBtn.click(); assert.equal(app.elements.status.textContent,error);
});
test('playback is unavailable during capture and enabled after a transcript completes', async () => {
 const app=setup(); assert.equal(app.elements.speakBtn.disabled,true);
 app.elements.micBtn.click(); app.recognition.onresult({results:[result('hello',true)]});
 assert.equal(app.elements.speakBtn.disabled,true);
 app.recognition.onend(); await flush(); assert.equal(app.elements.speakBtn.disabled,false);
});
test('starting recognition does not cancel an idle speech engine', () => {
 const synth=fakeSynth(); let cancelled=0; synth.cancel=()=>cancelled++;
 const app=setup({synthesis:synth}); app.elements.micBtn.click(); assert.equal(cancelled,0);
});
