// Offline DSP toolkit for `npm run sounds`. Everything is plain Float32Array math so the
// renders are deterministic (seeded) and need no native audio tooling.
import fs from 'node:fs';
import path from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';

export const SR = 44100;
export const TAU = Math.PI * 2;
export const mtof = (n: number) => 440 * 2 ** ((n - 69) / 12);
export const db = (d: number) => 10 ** (d / 20);
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// --- randomness ---------------------------------------------------------------

let seed = 1;
export function reseed(s: number) {
  seed = s >>> 0 || 1;
}
export function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rr = (a: number, b: number) => a + (b - a) * rand();
export const jit = (x: number, pct: number) => x * (1 + (rand() * 2 - 1) * pct);
export const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

// --- buffers --------------------------------------------------------------------

export const samples = (sec: number) => Math.max(1, Math.round(sec * SR));
export const buf = (sec: number) => new Float32Array(samples(sec));

export type Param = number | ((t: number) => number);
const val = (p: Param, t: number) => (typeof p === 'number' ? p : p(t));

/** Piecewise-linear curve through [time, value] points. */
export function curve(points: Array<[number, number]>): (t: number) => number {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [t1, v1] = points[i];
      if (t <= t1) {
        const [t0, v0] = points[i - 1];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
      }
    }
    return points[points.length - 1][1];
  };
}

/** Same as `curve` but interpolates exponentially (for frequencies). */
export function expCurve(points: Array<[number, number]>): (t: number) => number {
  const lin = curve(points.map(([t, v]) => [t, Math.log(v)] as [number, number]));
  return (t) => Math.exp(lin(t));
}

export function mix(into: Float32Array, x: Float32Array, at = 0, gain = 1) {
  const o = Math.round(at * SR);
  const n = Math.min(x.length, into.length - o);
  for (let i = Math.max(0, -o); i < n; i++) into[o + i] += x[i] * gain;
  return into;
}

export function scale(x: Float32Array, g: number) {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function mulEnv(x: Float32Array, env: (t: number) => number) {
  for (let i = 0; i < x.length; i++) x[i] *= env(i / SR);
  return x;
}

export function fade(x: Float32Array, inSec = 0.002, outSec = 0.01) {
  const a = samples(inSec);
  const b = samples(outSec);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}

export function reverse(x: Float32Array) {
  return Float32Array.from(x).reverse();
}

export function concat(...xs: Float32Array[]) {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

// --- envelopes --------------------------------------------------------------------

/** Linear attack then exponential decay with time constant `tau`. */
export const perc = (attack: number, tau: number) => (t: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));

/** Attack, hold until `hold`, exponential release with time constant `rel`. */
export const ahr = (attack: number, hold: number, rel: number) => (t: number) =>
  t < attack ? t / attack : t < hold ? 1 : Math.exp(-(t - hold) / rel);

// --- sources --------------------------------------------------------------------

function blep(t: number, dt: number) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export type Wave = 'sine' | 'tri' | 'saw' | 'square';

export function osc(dur: number, freq: Param, type: Wave = 'sine', amp: Param = 1, phase = 0) {
  const out = buf(dur);
  let ph = phase;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const dt = Math.min(0.49, val(freq, t) / SR);
    let v: number;
    if (type === 'sine') v = Math.sin(TAU * ph);
    else if (type === 'tri') v = 1 - 4 * Math.abs(ph - 0.5);
    else if (type === 'saw') v = 2 * ph - 1 - blep(ph, dt);
    else v = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt);
    out[i] = v * val(amp, t);
    ph += dt;
    ph -= Math.floor(ph);
  }
  return out;
}

/** Several detuned saws, for pads, strings and low brass. */
export function supersaw(dur: number, freq: Param, voices = 3, cents = 9) {
  const out = buf(dur);
  for (let v = 0; v < voices; v++) {
    const d = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
    const r = 2 ** ((d * cents) / 1200);
    mix(out, osc(dur, typeof freq === 'number' ? freq * r : (t) => freq(t) * r, 'saw', 1 / voices, rand()));
  }
  return out;
}

export type Noise = 'white' | 'pink' | 'brown';

export function noise(dur: number, color: Noise = 'white') {
  const out = buf(dur);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rand() * 2 - 1;
    if (color === 'white') out[i] = w;
    else if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      br = (br + 0.02 * w) / 1.02;
      out[i] = br * 3.5;
    }
  }
  return out;
}

export interface Mode {
  f: number;
  a: number;
  /** Exponential decay time constant in seconds. */
  tau: number;
}

/** Sum of exponentially decaying sines: bells, bars, glass, chips, coins. */
export function modal(modes: Mode[], dur?: number, attack = 0.0008) {
  const longest = Math.max(...modes.map((m) => m.tau));
  const out = buf(dur ?? Math.min(6, longest * 6 + 0.01));
  const att = Math.max(1, samples(attack));
  for (const m of modes) {
    if (m.f >= SR * 0.47 || m.a === 0) continue;
    const w = (TAU * m.f) / SR;
    const c = 2 * Math.cos(w);
    const ph = rand() * TAU;
    let y1 = Math.sin(ph - w);
    let y2 = Math.sin(ph - 2 * w);
    const k = Math.exp(-1 / (m.tau * SR));
    let e = m.a;
    const n = Math.min(out.length, samples(m.tau * 7));
    for (let i = 0; i < n; i++) {
      const y = c * y1 - y2;
      y2 = y1;
      y1 = y;
      out[i] += y * e * (i < att ? i / att : 1);
      e *= k;
    }
  }
  return out;
}

/** Bank of two-pole resonators driven by an excitation signal. */
export function resonate(x: Float32Array, modes: Mode[], tail = 1) {
  const out = new Float32Array(x.length + samples(tail));
  for (const m of modes) {
    if (m.f >= SR * 0.47) continue;
    const w = (TAU * m.f) / SR;
    const r = Math.exp(-1 / (m.tau * SR));
    const a1 = 2 * r * Math.cos(w);
    const a2 = -r * r;
    const g = m.a * Math.sin(w);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const y = (i < x.length ? x[i] : 0) * g + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      out[i] += y;
    }
  }
  return out;
}

/** Karplus-Strong plucked string. `tone` 0.5 = dark, 0.99 = bright and ringing. */
export function pluck(freq: number, dur: number, { t60 = 1.5, tone = 0.5, bright = 0.5 } = {}) {
  const out = buf(dur);
  const D = Math.max(2, Math.round(SR / freq - tone));
  const line = new Float32Array(D);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < D; i++) {
    lp += (rand() * 2 - 1 - lp) * bright;
    line[i] = lp;
    mean += lp / D;
  }
  for (let i = 0; i < D; i++) line[i] -= mean;
  const loss = 10 ** (-3 / (t60 * freq));
  let idx = 0;
  for (let n = 0; n < out.length; n++) {
    const i1 = idx + 1 === D ? 0 : idx + 1;
    const v = line[idx];
    out[n] = v;
    line[idx] = loss * (tone * v + (1 - tone) * line[i1]);
    idx = i1;
  }
  return out;
}

/** Two-operator FM (sine carrier, sine modulator). */
export function fm(dur: number, freq: Param, ratio: number, index: Param, amp: Param = 1) {
  const out = buf(dur);
  let pc = 0, pm = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = val(freq, t);
    const m = Math.sin(TAU * pm);
    out[i] = Math.sin(TAU * pc + val(index, t) * m) * val(amp, t);
    pc += f / SR;
    pm += (f * ratio) / SR;
    pc -= Math.floor(pc);
    pm -= Math.floor(pm);
  }
  return out;
}

/** Harmonic additive voice with a time-varying fundamental and per-harmonic gain. */
export function additive(dur: number, freq: Param, harmonic: (k: number, t: number) => number, maxK = 40, amp: Param = 1) {
  const out = buf(dur);
  const ph = new Float64Array(maxK + 1);
  const gains = new Float64Array(maxK + 1);
  for (let k = 1; k <= maxK; k++) ph[k] = rand();
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = val(freq, t);
    if ((i & 31) === 0) for (let k = 1; k <= maxK; k++) gains[k] = k * f < SR * 0.45 ? harmonic(k, t) : 0;
    let s = 0;
    for (let k = 1; k <= maxK; k++) {
      if (gains[k] !== 0) s += Math.sin(TAU * ph[k]) * gains[k];
      ph[k] += (k * f) / SR;
      ph[k] -= Math.floor(ph[k]);
    }
    out[i] = s * val(amp, t);
  }
  return out;
}

// --- filters ----------------------------------------------------------------------

export type FilterType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'lowshelf' | 'highshelf';

function coeffs(type: FilterType, f: number, q: number, gainDb: number) {
  const w = (TAU * clamp(f, 10, SR * 0.49)) / SR;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case 'lp':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'hp':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'bp':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
      break;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Biquad filter (RBJ cookbook). `freq` may be a function of time for sweeps. Returns a new array. */
export function filter(x: Float32Array, type: FilterType, freq: Param, q = 0.707, gainDb = 0) {
  const out = new Float32Array(x.length);
  let [b0, b1, b2, a1, a2] = coeffs(type, val(freq, 0), q, gainDb);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const moving = typeof freq !== 'number';
  for (let i = 0; i < x.length; i++) {
    if (moving && (i & 15) === 0) [b0, b1, b2, a1, a2] = coeffs(type, val(freq, i / SR), q, gainDb);
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

export const lp = (x: Float32Array, f: Param, q = 0.707) => filter(x, 'lp', f, q);
export const hp = (x: Float32Array, f: Param, q = 0.707) => filter(x, 'hp', f, q);
export const bp = (x: Float32Array, f: Param, q = 1) => filter(x, 'bp', f, q);

// --- nonlinear and time effects -------------------------------------------------------

export function drive(x: Float32Array, amount: number) {
  const n = Math.tanh(amount);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * amount) / n;
  return x;
}

/** Reads `src` at a varying speed (1 = normal, 0 = stopped, negative = backwards). */
export function varispeed(src: Float32Array, rate: Param, dur: number, startSec = 0) {
  const out = buf(dur);
  let p = startSec * SR;
  for (let i = 0; i < out.length; i++) {
    const i0 = Math.floor(p);
    if (i0 >= 0 && i0 + 1 < src.length) {
      const f = p - i0;
      out[i] = src[i0] * (1 - f) + src[i0 + 1] * f;
    }
    p += val(rate, i / SR);
  }
  return out;
}

/** Vinyl surface noise: hiss plus random pops and ticks. */
export function crackle(dur: number, density = 12, level = 1) {
  const out = scale(lp(hp(noise(dur, 'pink'), 1500), 6000), 0.05 * level);
  const n = Math.round(dur * density);
  for (let i = 0; i < n; i++) {
    const at = rand() * dur;
    const pop = modal([{ f: rr(1500, 6000), a: rr(0.2, 1) * level, tau: rr(0.0004, 0.0016) }], 0.01, 0.0001);
    mix(out, pop, at, rand() < 0.5 ? 1 : -1);
  }
  return out;
}

// --- stereo track -----------------------------------------------------------------------

export class Track {
  L: Float32Array;
  R: Float32Array;
  constructor(sec: number) {
    this.L = buf(sec);
    this.R = buf(sec);
  }
  static from(L: Float32Array, R: Float32Array = L) {
    const t = new Track(0);
    t.L = L;
    t.R = R === L ? Float32Array.from(L) : R;
    return t;
  }
  get length() {
    return this.L.length;
  }
  /** Mixes a mono voice in at `at` seconds, panned -1 (left) … 1 (right) with equal power. */
  add(x: Float32Array, at = 0, gain = 1, pan = 0) {
    const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
    mix(this.L, x, at, gain * Math.cos(a) * Math.SQRT2);
    mix(this.R, x, at, gain * Math.sin(a) * Math.SQRT2);
    return this;
  }
  addTrack(t: Track, at = 0, gain = 1) {
    mix(this.L, t.L, at, gain);
    mix(this.R, t.R, at, gain);
    return this;
  }
  map(fn: (ch: Float32Array) => Float32Array) {
    this.L = fn(this.L);
    this.R = fn(this.R);
    return this;
  }
  mono() {
    const m = new Float32Array(this.length);
    for (let i = 0; i < m.length; i++) m[i] = (this.L[i] + this.R[i]) * 0.5;
    return m;
  }
}

// --- reverb and delay ----------------------------------------------------------------------

class Comb {
  buf: Float32Array;
  idx = 0;
  store = 0;
  constructor(n: number) {
    this.buf = new Float32Array(n);
  }
  run(x: number, fb: number, damp: number) {
    const out = this.buf[this.idx];
    this.store = out * (1 - damp) + this.store * damp;
    this.buf[this.idx] = x + this.store * fb;
    if (++this.idx === this.buf.length) this.idx = 0;
    return out;
  }
}

class Allpass {
  buf: Float32Array;
  idx = 0;
  constructor(n: number) {
    this.buf = new Float32Array(n);
  }
  run(x: number) {
    const b = this.buf[this.idx];
    this.buf[this.idx] = x + b * 0.5;
    if (++this.idx === this.buf.length) this.idx = 0;
    return b - x;
  }
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

export interface ReverbOpts {
  room?: number;
  damp?: number;
  wet?: number;
  dry?: number;
  width?: number;
  predelay?: number;
  lowcut?: number;
  highcut?: number;
}

/** Freeverb (Jezar's Schroeder–Moorer design). Mixes into the track in place. */
export function reverb(t: Track, { room = 0.6, damp = 0.4, wet = 0.25, dry = 1, width = 1, predelay = 0.01, lowcut = 180, highcut = 9000 }: ReverbOpts = {}) {
  const k = SR / 44100;
  const combsL = COMBS.map((n) => new Comb(Math.round(n * k)));
  const combsR = COMBS.map((n) => new Comb(Math.round((n + 23) * k)));
  const apL = ALLPASSES.map((n) => new Allpass(Math.round(n * k)));
  const apR = ALLPASSES.map((n) => new Allpass(Math.round((n + 23) * k)));
  const fb = room * 0.28 + 0.7;
  const dmp = damp * 0.4;
  const w1 = wet * 3 * (width / 2 + 0.5);
  const w2 = wet * 3 * ((1 - width) / 2);
  let input = t.mono();
  input = lp(hp(input, lowcut), highcut);
  const pd = samples(predelay);
  for (let i = 0; i < t.length; i++) {
    const x = (i >= pd ? input[i - pd] : 0) * 0.015 * 2;
    let l = 0, r = 0;
    for (let c = 0; c < 8; c++) {
      l += combsL[c].run(x, fb, dmp);
      r += combsR[c].run(x, fb, dmp);
    }
    for (let a = 0; a < 4; a++) {
      l = apL[a].run(l);
      r = apR[a].run(r);
    }
    t.L[i] = t.L[i] * dry + l * w1 + r * w2;
    t.R[i] = t.R[i] * dry + r * w1 + l * w2;
  }
  return t;
}

/** Ping-pong echo with a darkening feedback path. */
export function echo(t: Track, time: number, feedback = 0.35, wet = 0.2, tone = 3000) {
  const d = samples(time);
  const L = Float32Array.from(t.L);
  const R = Float32Array.from(t.R);
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  let idx = 0, sl = 0, sr = 0;
  const c = Math.exp((-TAU * tone) / SR);
  for (let i = 0; i < t.length; i++) {
    const outL = bl[idx];
    const outR = br[idx];
    sl = outR * (1 - c) + sl * c;
    sr = outL * (1 - c) + sr * c;
    bl[idx] = (L[i] + R[i]) * 0.5 + sl * feedback;
    br[idx] = sr * feedback;
    if (++idx === d) idx = 0;
    t.L[i] += outL * wet;
    t.R[i] += outR * wet;
  }
  return t;
}

/** A 1920s gramophone: mono, horn band-pass, wow and flutter, saturation and surface noise. */
export function gramophone(t: Track, { wow = 0.005, crackleLevel = 1, tail = 0 } = {}) {
  let m = t.mono();
  if (tail > 0) m = concat(m, new Float32Array(samples(tail)));
  const wowRate = rr(0.45, 0.65);
  const ph = rand() * TAU;
  m = varispeed(m, (s) => 1 + wow * Math.sin(TAU * wowRate * s + ph) + 0.0012 * Math.sin(TAU * 7.3 * s), m.length / SR);
  m = filter(hp(hp(m, 260), 200), 'lp', 3600, 0.9);
  m = filter(m, 'peak', 1400, 1.2, 5);
  m = filter(m, 'lp', 4200, 0.7);
  drive(scale(m, 2.2), 1.6);
  // Surface noise follows the sound's envelope so the cue can still end.
  const surface = crackle(m.length / SR, 14, crackleLevel);
  const att = Math.exp(-1 / (0.005 * SR));
  const rel = Math.exp(-1 / (0.35 * SR));
  let env = 0;
  let top = 1e-9;
  for (let i = 0; i < m.length; i++) top = Math.max(top, Math.abs(m[i]));
  for (let i = 0; i < m.length; i++) {
    const a = Math.abs(m[i]) / top;
    env = a > env ? a * (1 - att) + env * att : a * (1 - rel) + env * rel;
    m[i] += surface[i] * 0.5 * Math.min(1, 0.15 + env * 6);
  }
  return Track.from(m);
}

// --- mastering --------------------------------------------------------------------------

/** Loudest 400 ms RMS of the track, in dBFS (low end discounted). */
export function loudness(t: Track) {
  const m = hp(t.mono(), 120);
  const win = samples(0.4);
  const hop = samples(0.05);
  let best = 0;
  for (let s = 0; s + win <= Math.max(win, m.length); s += hop) {
    let sum = 0;
    for (let i = s; i < s + win && i < m.length; i++) sum += m[i] * m[i];
    best = Math.max(best, sum / win);
  }
  return 10 * Math.log10(best + 1e-12);
}

export function peak(t: Track) {
  let p = 0;
  for (let i = 0; i < t.length; i++) p = Math.max(p, Math.abs(t.L[i]), Math.abs(t.R[i]));
  return 20 * Math.log10(p + 1e-12);
}

/** Lookahead peak limiter. */
export function limit(t: Track, ceilingDb = -1, release = 0.08) {
  const ceil = db(ceilingDb);
  const look = samples(0.004);
  const n = t.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(t.L[i]), Math.abs(t.R[i]));
    need[i] = p > ceil ? ceil / p : 1;
  }
  const gain = new Float32Array(n);
  const rel = Math.exp(-1 / (release * SR));
  let g = 1;
  for (let i = 0; i < n; i++) {
    let target = 1;
    for (let j = i; j < Math.min(n, i + look); j++) if (need[j] < target) target = need[j];
    g = target < g ? target : g * rel + target * (1 - rel);
    gain[i] = g;
  }
  for (let i = 0; i < n; i++) {
    t.L[i] *= gain[i];
    t.R[i] *= gain[i];
  }
  return t;
}

/** Cuts the tail once it stays `belowPeakDb` under the track's peak, and fades the last 40 ms. */
export function trim(t: Track, belowPeakDb = 54) {
  const th = db(peak(t) - belowPeakDb);
  let end = t.length - 1;
  while (end > 0 && Math.abs(t.L[end]) < th && Math.abs(t.R[end]) < th) end--;
  const n = Math.min(t.length, end + samples(0.04));
  t.L = fade(t.L.slice(0, n), 0, 0.04);
  t.R = fade(t.R.slice(0, n), 0, 0.04);
  return t;
}

/** Scales the track so its loudness hits `targetDb`, then limits peaks. */
export function master(t: Track, targetDb: number, ceilingDb = -1) {
  const g = db(targetDb - loudness(t));
  t.map((ch) => scale(ch, g));
  return limit(t, ceilingDb);
}

// --- output ------------------------------------------------------------------------------

export function writeMp3(file: string, t: Track, kbps = 160) {
  const toPcm = (ch: Float32Array) => {
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = Math.round(clamp(ch[i], -1, 1) * 32767);
    return out;
  };
  const L = toPcm(t.L);
  const R = toPcm(t.R);
  const enc = new Mp3Encoder(2, SR, kbps);
  const chunks: Uint8Array[] = [];
  const step = 1152 * 8;
  for (let i = 0; i < L.length; i += step) {
    const c = enc.encodeBuffer(L.subarray(i, i + step), R.subarray(i, i + step));
    if (c.length) chunks.push(new Uint8Array(c));
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat(chunks));
}
