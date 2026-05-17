export class RingBuffer {
  private buffer: Float32Array;
  private writePos = 0;
  private readPos = 0;
  private count = 0;

  constructor(capacitySamples: number) {
    this.buffer = new Float32Array(capacitySamples);
  }

  get capacity(): number {
    return this.buffer.length;
  }

  get available(): number {
    return this.count;
  }

  push(samples: Float32Array): number {
    const toWrite = Math.min(samples.length, this.capacity - this.count);
    for (let i = 0; i < toWrite; i++) {
      this.buffer[this.writePos] = samples[i]!;
      this.writePos = (this.writePos + 1) % this.capacity;
    }
    this.count += toWrite;
    return toWrite;
  }

  pop(count: number): Float32Array {
    const toRead = Math.min(count, this.count);
    const out = new Float32Array(toRead);
    for (let i = 0; i < toRead; i++) {
      out[i] = this.buffer[this.readPos]!;
      this.readPos = (this.readPos + 1) % this.capacity;
    }
    this.count -= toRead;
    return out;
  }

  peek(count: number): Float32Array {
    const toRead = Math.min(count, this.count);
    const out = new Float32Array(toRead);
    let pos = this.readPos;
    for (let i = 0; i < toRead; i++) {
      out[i] = this.buffer[pos]!;
      pos = (pos + 1) % this.capacity;
    }
    return out;
  }

  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this.count = 0;
  }
}
