export const CONFIG = {
  BASE: "https://huggingface.co/onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4/resolve/main/",
  SR: 16000,
  N_FFT: 512,
  HOP: 160,
  WIN: 400,
  N_MELS: 128,
  FMIN: 0,
  FMAX: 8000,
  PREEMPH: 0.97,
  LOG_GUARD: 1e-10,
  NEW_FRAMES: 56,
  CACHE_FRAMES: 9,
  get ENC_IN() {
    return this.NEW_FRAMES + this.CACHE_FRAMES;
  },
  LAYERS: 24,
  D_MODEL: 1024,
  DEC_HID: 640,
  DEC_LAYERS: 2,
  VOCAB: 13088,
  BLANK: 13087,
  MAX_SYM: 10,
};

const { N_FFT, HOP, WIN, N_MELS, SR, FMIN, FMAX, PREEMPH, LOG_GUARD } =
  CONFIG;

function hzToMel(hz) {
  const fsp = 200 / 3;
  let mel = hz / fsp;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fsp;
  const logstep = Math.log(6.4) / 27;
  if (hz >= minLogHz)
    mel = minLogMel + Math.log(hz / minLogHz) / logstep;
  return mel;
}

function melToHz(mel) {
  const fsp = 200 / 3;
  let hz = fsp * mel;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fsp;
  const logstep = Math.log(6.4) / 27;
  if (mel >= minLogMel)
    hz = minLogHz * Math.exp(logstep * (mel - minLogMel));
  return hz;
}

export function buildMelFB() {
  const nBins = N_FFT / 2 + 1;
  const fft = new Float32Array(nBins);
  for (let i = 0; i < nBins; i++) fft[i] = (i * SR) / N_FFT;
  const mlo = hzToMel(FMIN);
  const mhi = hzToMel(FMAX);
  const pts = new Float32Array(N_MELS + 2);
  for (let i = 0; i < N_MELS + 2; i++)
    pts[i] = melToHz(mlo + ((mhi - mlo) * i) / (N_MELS + 1));
  const fb = [];
  for (let m = 0; m < N_MELS; m++) {
    const row = new Float32Array(nBins);
    const lo = pts[m];
    const ce = pts[m + 1];
    const hi = pts[m + 2];
    const enorm = 2 / (hi - lo);
    for (let k = 0; k < nBins; k++) {
      const f = fft[k];
      let w = Math.min((f - lo) / (ce - lo), (hi - f) / (hi - ce));
      if (w < 0) w = 0;
      row[k] = w * enorm;
    }
    fb.push(row);
  }
  return fb;
}

export function buildWindow() {
  const w = new Float32Array(N_FFT);
  const off = (N_FFT - WIN) >> 1;
  for (let n = 0; n < WIN; n++)
    w[off + n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / WIN);
  return w;
}

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k;
        const b = a + h;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function reflect(x, i) {
  const N = x.length;
  if (N === 1) return x[0];
  while (i < 0 || i >= N) {
    if (i < 0) i = -i;
    if (i >= N) i = 2 * N - 2 - i;
  }
  return x[i];
}

function frameToMel(seg, off, melFB, win, re, im) {
  for (let k = 0; k < N_FFT; k++) {
    re[k] = seg[off + k] * win[k];
    im[k] = 0;
  }
  fft(re, im);
  const nBins = N_FFT / 2 + 1;
  const mel = new Float32Array(N_MELS);
  for (let m = 0; m < N_MELS; m++) {
    const row = melFB[m];
    let acc = 0;
    for (let b = 0; b < nBins; b++)
      acc += row[b] * (re[b] * re[b] + im[b] * im[b]);
    mel[m] = Math.log(acc + LOG_GUARD);
  }
  return mel;
}

export function computeMelOffline(x, melFB, win) {
  const y = new Float32Array(x.length);
  y[0] = x[0];
  for (let n = 1; n < x.length; n++) y[n] = x[n] - PREEMPH * x[n - 1];
  const pad = N_FFT >> 1;
  const P = y.length + N_FFT;
  const padded = new Float32Array(P);
  for (let i = 0; i < P; i++) padded[i] = reflect(y, i - pad);
  const nFrames = 1 + Math.floor(y.length / HOP);
  const frames = [];
  const re = new Float32Array(N_FFT);
  const im = new Float32Array(N_FFT);
  for (let f = 0; f < nFrames; f++)
    frames.push(frameToMel(padded, f * HOP, melFB, win, re, im));
  return frames;
}

export class StreamingMel {
  constructor(melFB, win) {
    this.melFB = melFB;
    this.win = win;
    this.prev = 0;
    this.buf = new Float32Array(0);
    this.started = false;
    this.re = new Float32Array(N_FFT);
    this.im = new Float32Array(N_FFT);
    this.featureTail = new Float32Array(0);
    this.samplesReceived = 0;
    this.framesEmitted = 0;
    this.finished = false;
  }
  drain(maxFrames = Infinity) {
    const frames = [];
    let off = 0;
    while (
      this.buf.length - off >= N_FFT &&
      frames.length < maxFrames
    ) {
      frames.push(
        frameToMel(this.buf, off, this.melFB, this.win, this.re, this.im)
      );
      off += HOP;
      this.framesEmitted++;
    }
    if (off > 0) this.buf = this.buf.slice(off);
    return frames;
  }
  push(x) {
    if (this.finished) throw new Error("streaming mel is already finalized");
    if (!x.length) return [];
    this.samplesReceived += x.length;
    const y = new Float32Array(x.length);
    y[0] = x[0] - PREEMPH * this.prev;
    for (let i = 1; i < x.length; i++) y[i] = x[i] - PREEMPH * x[i - 1];
    this.prev = x[x.length - 1];

    const keep = Math.min(N_FFT, this.featureTail.length + y.length);
    const tail = new Float32Array(keep);
    if (y.length >= keep) {
      tail.set(y.subarray(y.length - keep));
    } else {
      const previousCount = keep - y.length;
      if (previousCount) {
        tail.set(
          this.featureTail.subarray(this.featureTail.length - previousCount),
          0,
        );
      }
      tail.set(y, previousCount);
    }
    this.featureTail = tail;

    const pending = new Float32Array(this.buf.length + y.length);
    pending.set(this.buf, 0);
    pending.set(y, this.buf.length);

    if (!this.started) {
      const pad = N_FFT >> 1;
      if (pending.length <= pad) {
        this.buf = pending;
        return [];
      }
      const head = new Float32Array(pad);
      for (let j = 0; j < pad; j++) head[j] = reflect(pending, j - pad);
      this.buf = new Float32Array(head.length + pending.length);
      this.buf.set(head, 0);
      this.buf.set(pending, head.length);
      this.started = true;
    } else {
      this.buf = pending;
    }

    return this.drain();
  }
  flush() {
    if (this.finished) return [];
    this.finished = true;
    if (!this.samplesReceived) return [];

    const expectedFrames = 1 + Math.floor(this.samplesReceived / HOP);
    const missingFrames = Math.max(0, expectedFrames - this.framesEmitted);
    if (!missingFrames) return [];

    const reflectIndex = (index) => {
      const length = this.samplesReceived;
      if (length === 1) return 0;
      while (index < 0 || index >= length) {
        if (index < 0) index = -index;
        if (index >= length) index = 2 * length - 2 - index;
      }
      return index;
    };
    const featureAt = (index) => {
      const reflected = reflectIndex(index);
      const tailStart = this.samplesReceived - this.featureTail.length;
      return this.featureTail[reflected - tailStart];
    };

    const pad = N_FFT >> 1;
    if (!this.started) {
      const source = this.featureTail;
      const padded = new Float32Array(source.length + N_FFT);
      for (let i = 0; i < padded.length; i++) {
        padded[i] = reflect(source, i - pad);
      }
      this.buf = padded;
      this.started = true;
    } else {
      const right = new Float32Array(pad);
      for (let i = 0; i < pad; i++) {
        right[i] = featureAt(this.samplesReceived + i);
      }
      const merged = new Float32Array(this.buf.length + right.length);
      merged.set(this.buf, 0);
      merged.set(right, this.buf.length);
      this.buf = merged;
    }
    this.featureTail = new Float32Array(0);
    return this.drain(missingFrames);
  }
}

export function detok(ids, vocab) {
  let s = "";
  for (const id of ids) s += vocab[id] ?? "";
  s = s.replace(/\u2581/g, " ");
  let lang = null;
  const m = s.match(/\s*<([a-z]{2}-[A-Za-z]{2,3})>\s*$/);
  if (m) {
    lang = m[1];
    s = s.slice(0, m.index);
  }
  return { text: s.trim(), lang };
}