const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(upload) {
  const elements = {};
  const node = () => ({ textContent: '', value: 'auto', disabled: false,
    classList: { toggle() {} }, setAttribute() {}, append() {},
    addEventListener(name, fn) { this[name] = fn; } });
  let processor;
  let submitted;
  const context = {
    document: { getElementById(id) { return elements[id] ||= node(); }, createElement: node },
    navigator: { mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() {} }] }; } } },
    window: { AudioContext: class {
      sampleRate = 16000; state = 'running'; audioWorklet = { async addModule() {} };
      async resume() {} async close() {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    } },
    AudioWorkletNode: class { constructor() { processor = this; this.port = { close() {} }; } connect() {} disconnect() {} },
    async fetch(path, options) {
      if (path === '/api/health') return { ok: true, json: async () => ({ transport: 'http', hosted_configured: true }) };
      submitted = options.body;
      return upload();
    },
    Float32Array, Int16Array, Blob, AbortSignal, Date, Math, JSON,
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync('frontend/js/record.js', 'utf8'), context);
  return { elements, get processor() { return processor; }, get submitted() { return submitted; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('HTTP recording displays transcript and resets the button', async () => {
  const app = setup(async () => ({ ok: true, json: async () => ({ text: 'Hello', id: 1 }) }));
  await app.elements.micBtn.click();
  app.processor.port.onmessage({ data: new Float32Array(16000).fill(0.2) });
  app.elements.micBtn.click();
  await flush();
  assert.equal(app.submitted.size, 32000);
  assert.match(app.elements.status.textContent, /Saved as transcription #1/);
  assert.equal(app.elements.micBtn.disabled, false);
});

test('HTTP errors restore the button and show the server message', async () => {
  const app = setup(async () => ({ ok: false, json: async () => ({ detail: 'Check token permissions' }) }));
  await app.elements.micBtn.click();
  app.processor.port.onmessage({ data: new Float32Array(16000) });
  app.elements.micBtn.click();
  await flush();
  assert.equal(app.elements.status.textContent, 'Check token permissions');
  assert.equal(app.elements.micBtn.disabled, false);
});

test('automatic stop caps audio exactly at 60 seconds', async () => {
  const app = setup(async () => ({ ok: true, json: async () => ({ text: '', id: null }) }));
  await app.elements.micBtn.click();
  app.processor.port.onmessage({ data: new Float32Array(16000 * 60 + 128) });
  await flush();
  assert.equal(app.submitted.size, 16000 * 60 * 2);
  assert.equal(app.elements.micBtn.disabled, false);
});

test('timeout restores the button', async () => {
  const app = setup(async () => { const error = new Error(); error.name = 'TimeoutError'; throw error; });
  await app.elements.micBtn.click();
  app.processor.port.onmessage({ data: new Float32Array(16000) });
  app.elements.micBtn.click();
  await flush();
  assert.match(app.elements.status.textContent, /timed out/);
  assert.equal(app.elements.micBtn.disabled, false);
});
