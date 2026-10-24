const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup({supported = true, failSave = false} = {}) {
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
    window: supported ? { webkitSpeechRecognition: Recognition } : {},
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
