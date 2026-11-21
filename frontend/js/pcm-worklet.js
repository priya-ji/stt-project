// Capture mono audio on the audio rendering thread, without playing it back.
class MicrophoneProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor("microphone-pcm", MicrophoneProcessor);
