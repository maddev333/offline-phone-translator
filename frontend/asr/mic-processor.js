class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate || 16000;
    this.step = sampleRate / this.targetSampleRate;
    this.nextPosition = 0;
    this.inputOffset = 0;
    this.previousSample = 0;
    this.hasPreviousSample = false;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;

    if (sampleRate === this.targetSampleRate) {
      const frame = channel.slice();
      this.port.postMessage(frame, [frame.buffer]);
      return true;
    }

    const start = this.inputOffset;
    const end = start + channel.length - 1;
    const output = [];

    while (this.nextPosition <= end) {
      const leftIndex = Math.floor(this.nextPosition);
      const fraction = this.nextPosition - leftIndex;
      const left = leftIndex < start
        ? (this.hasPreviousSample ? this.previousSample : channel[0])
        : channel[leftIndex - start];
      const rightIndex = Math.min(leftIndex + 1, end);
      const right = channel[rightIndex - start];
      output.push(left + (right - left) * fraction);
      this.nextPosition += this.step;
    }

    this.previousSample = channel[channel.length - 1];
    this.hasPreviousSample = true;
    this.inputOffset += channel.length;

    if (output.length) {
      const frame = Float32Array.from(output);
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);