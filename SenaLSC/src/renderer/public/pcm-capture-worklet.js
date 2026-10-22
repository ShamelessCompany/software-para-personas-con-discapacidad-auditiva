class SenaLscPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.targetSamples = Math.max(1, Math.round(sampleRate * 0.02));
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let index = 0; index < channel.length; index += 1) this.samples.push(channel[index]);
    while (this.samples.length >= this.targetSamples) {
      const block = Float32Array.from(this.samples.splice(0, this.targetSamples));
      this.port.postMessage(block, [block.buffer]);
    }
    return true;
  }
}

registerProcessor("senalsc-pcm-capture", SenaLscPcmCaptureProcessor);
