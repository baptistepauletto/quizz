// Instruments and foley built on dsp.ts. Every function returns a mono voice.
import {
  SR,
  TAU,
  additive,
  ahr,
  bp,
  buf,
  clamp,
  curve,
  drive,
  expCurve,
  filter,
  fm,
  hp,
  jit,
  lp,
  mix,
  modal,
  mtof,
  mulEnv,
  noise,
  osc,
  perc,
  pluck,
  rand,
  resonate,
  reverse,
  rr,
  samples,
  scale,
  supersaw,
  varispeed,
  type Mode,
} from './dsp';

// --- keys ----------------------------------------------------------------------------

/** Additive piano: inharmonic partials, two strings per note, hammer noise and damper. */
export function piano(note: number, hold: number, { vel = 0.7, detune = 0.8, bright = 1 } = {}) {
  const f0 = mtof(note);
  const out = buf(hold + 0.7);
  const B = 0.00032;
  const T1 = clamp(4.2 * (110 / f0) ** 0.55, 0.35, 6);
  const nMax = Math.min(24, Math.floor(9000 / f0));
  const holdN = samples(hold);
  const relK = Math.exp(-1 / (0.075 * SR));
  for (let n = 1; n <= nMax; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    const a = (1 / n ** 0.85) * Math.exp(-(n - 1) * ((0.42 - 0.3 * vel) / bright)) * (Math.abs(Math.sin(Math.PI * n * 0.13)) + 0.15);
    const kF = Math.exp(-1 / (((T1 * 0.22) / (1 + 0.55 * (n - 1))) * SR));
    const kS = Math.exp(-1 / ((T1 / (1 + 0.22 * (n - 1))) * SR));
    for (const s of [-1, 1]) {
      const f = fn * 2 ** ((s * detune + rr(-0.3, 0.3)) / 1200);
      const w = (TAU * f) / SR;
      const c = 2 * Math.cos(w);
      const ph = rand() * TAU;
      let y1 = Math.sin(ph - w), y2 = Math.sin(ph - 2 * w);
      let eF = 0.65, eS = 0.35, rel = 1;
      for (let i = 0; i < out.length; i++) {
        const y = c * y1 - y2;
        y2 = y1;
        y1 = y;
        out[i] += y * (eF + eS) * rel * a * 0.5 * (i < 90 ? i / 90 : 1);
        eF *= kF;
        eS *= kS;
        if (i > holdN) rel *= relK;
      }
    }
  }
  const hammer = mulEnv(lp(noise(0.02), Math.min(9000, f0 * 7)), perc(0.0005, 0.004));
  mix(out, hammer, 0, 0.12 * vel);
  return scale(out, vel);
}

export function chord(notes: number[], hold: number, { vel = 0.6, roll = 0, detune = 0.8, bright = 1 } = {}) {
  const out = buf(hold + 0.8 + roll * notes.length);
  notes.forEach((n, i) => mix(out, piano(n, Math.max(0.05, hold - i * roll), { vel: jit(vel, 0.06), detune, bright }), i * roll, 0.55));
  return out;
}

/** FM electric piano (Rhodes-like): soft bark plus a short tine. */
export function rhodes(note: number, hold: number, vel = 0.6) {
  const f = mtof(note);
  const dur = hold + 1.2;
  const body = fm(dur, f, 1, (t) => 0.4 + 1.6 * vel * Math.exp(-t / 0.35), ahr(0.003, hold, 0.25));
  const tine = fm(dur, f, 14, (t) => 0.5 * Math.exp(-t / 0.04), (t) => Math.exp(-t / 0.05));
  const out = buf(dur);
  mix(out, body, 0, 1);
  mix(out, tine, 0, 0.12);
  mulEnv(out, (t) => Math.exp(-t / (2.2 * (220 / f) ** 0.3)) * (1 + 0.12 * Math.sin(TAU * 4.6 * t)));
  return scale(out, vel);
}

// --- tuned percussion ----------------------------------------------------------------------

export function vibraphone(note: number, { vel = 0.6, motor = 5.4, tau = 2.4 } = {}) {
  const f = mtof(note);
  const out = modal([
    { f, a: 1, tau },
    { f: f * 3.99, a: 0.25, tau: tau * 0.25 },
    { f: f * 9.9, a: 0.06, tau: tau * 0.08 },
  ]);
  mix(out, mulEnv(bp(noise(0.02), 3000, 1), perc(0.0005, 0.003)), 0, 0.05);
  if (motor > 0) mulEnv(out, (t) => 1 - 0.35 * (0.5 + 0.5 * Math.sin(TAU * motor * t)));
  return scale(out, vel);
}

export function xylophone(note: number, vel = 0.7) {
  const f = mtof(note);
  const out = modal([
    { f, a: 1, tau: 0.18 },
    { f: f * 3.93, a: 0.35, tau: 0.05 },
    { f: f * 9.0, a: 0.1, tau: 0.02 },
  ]);
  mix(out, mulEnv(bp(noise(0.01), 2500, 0.8), perc(0.0003, 0.002)), 0, 0.15);
  return scale(out, vel);
}

/** Music-box comb tine (clamped-free bar ratios). */
export function musicBox(note: number, vel = 0.6) {
  const f = mtof(note);
  return scale(
    modal([
      { f, a: 1, tau: 1.1 },
      { f: f * 2.0, a: 0.08, tau: 0.6 },
      { f: f * 6.27, a: 0.25, tau: 0.2 },
      { f: f * 17.55, a: 0.06, tau: 0.04 },
    ]),
    vel,
  );
}

export function bell(f: number, { vel = 0.8, tau = 1.1 } = {}) {
  const modes: Mode[] = [];
  for (const [r, a, k] of [
    [1, 1, 1],
    [2.71, 0.45, 0.55],
    [5.18, 0.25, 0.3],
    [8.4, 0.1, 0.16],
  ] as const) {
    modes.push({ f: f * r, a, tau: tau * k });
    modes.push({ f: f * r * 1.0017, a: a * 0.7, tau: tau * k });
  }
  const out = modal(modes);
  mix(out, mulEnv(hp(noise(0.01), 4000), perc(0.0002, 0.0015)), 0, 0.3);
  return scale(out, vel * 0.5);
}

export function glass(f: number, vel = 0.7) {
  const modes: Mode[] = [];
  for (const [r, a, k] of [
    [1, 1, 1],
    [2.61, 0.5, 0.6],
    [4.78, 0.25, 0.35],
    [7.42, 0.1, 0.2],
  ] as const) {
    modes.push({ f: f * r, a, tau: 1.3 * k });
    modes.push({ f: f * r + 1.3, a: a * 0.8, tau: 1.3 * k });
  }
  const out = modal(modes);
  mix(out, mulEnv(hp(noise(0.005), 5000), perc(0.0001, 0.0008)), 0, 0.4);
  return scale(out, vel * 0.4);
}

// --- plucked and blown -----------------------------------------------------------------------

export function upright(note: number, dur: number, vel = 0.8) {
  const f = mtof(note);
  let s = pluck(f, dur + 0.3, { t60: 1.6, tone: 0.5, bright: 0.35 });
  s = lp(s, 1100);
  mulEnv(s, ahr(0.004, dur, 0.06));
  const thump = osc(0.12, f, 'sine', perc(0.002, 0.03));
  mix(s, thump, 0, 0.5);
  mix(s, lp(mulEnv(noise(0.03), perc(0.001, 0.008)), 400), 0, 0.3);
  return drive(scale(s, vel * 1.6), 1.2);
}

export function banjo(note: number, vel = 0.7) {
  const s = pluck(mtof(note), 0.9, { t60: 0.5, tone: 0.55, bright: 0.9 });
  return scale(filter(hp(s, 200), 'peak', 1200, 1.5, 6), vel * 0.8);
}

export function clarinet(note: number, dur: number, { vel = 0.7, vibrato = 0.004 } = {}) {
  const f = mtof(note);
  const amps = [0, 1, 0.08, 0.55, 0.06, 0.32, 0.04, 0.18, 0.02, 0.1, 0.01, 0.05];
  const freq = (t: number) => f * (1 + vibrato * Math.min(1, Math.max(0, t - 0.18) * 3) * Math.sin(TAU * 5.2 * t));
  const tone = additive(dur + 0.15, freq, (k) => (amps[k] ?? 0) * (k <= 3 ? 1 : 0.6 + 0.6 * vel), 11, ahr(0.04, dur, 0.06));
  const breath = mulEnv(bp(noise(dur + 0.15), 2200, 1.5), ahr(0.03, dur, 0.05));
  mix(tone, breath, 0, 0.025);
  return scale(lp(tone, 5000), vel * 0.6);
}

/** Additive brass with a brightness swell, a scoop into pitch and optional mute/wah band-pass. */
export function brass(note: number, dur: number, { vel = 0.8, mute = false, wah, scoop = 0.03, shake = 0 }: { vel?: number; mute?: boolean; wah?: (t: number) => number; scoop?: number; shake?: number } = {}) {
  const f = mtof(note);
  const bright = (t: number) => vel * (t < 0.04 ? t / 0.04 : 1) * (0.75 + 0.25 * Math.exp(-(t - 0.04) / 0.2));
  const freq = (t: number) =>
    f * (1 - scoop * Math.exp(-t / 0.035)) * (1 + 0.004 * Math.min(1, Math.max(0, t - 0.25) * 2) * Math.sin(TAU * 5.5 * t) + shake * Math.sin(TAU * 7 * t));
  let s = additive(dur + 0.12, freq, (k, t) => Math.exp(-(k - 1) / (0.6 + 9 * bright(t))) / k ** 0.6, 30, ahr(0.025, dur, 0.06));
  if (mute) s = filter(hp(s, 500), 'peak', 1800, 2, 9);
  if (wah) s = filter(s, 'bp', wah, 2.2);
  return drive(scale(s, vel * 0.5), 1.4);
}

export function brassChord(notes: number[], dur: number, opts: Parameters<typeof brass>[2] = {}) {
  const out = buf(dur + 0.3);
  for (const n of notes) mix(out, brass(n, dur, { ...opts, vel: jit(opts.vel ?? 0.8, 0.05) }), rr(0, 0.012), 0.45);
  return out;
}

/** Steam calliope pipe: near-sine with a breathy chiff and a wobbly vibrato. */
export function calliope(note: number, dur: number, vel = 0.7) {
  const f = mtof(note);
  const amps = [0, 1, 0.5, 0.25, 0.1, 0.05];
  const out = buf(dur + 0.1);
  for (const det of [0, 9]) {
    const fr = (t: number) => f * 2 ** (det / 1200) * (1 + 0.012 * Math.sin(TAU * 6.3 * t + det));
    mix(out, additive(dur + 0.1, fr, (k) => amps[k] ?? 0, 5, ahr(0.02, dur, 0.04)), 0, 0.5);
  }
  mix(out, mulEnv(bp(noise(0.08), f * 3, 2), perc(0.002, 0.02)), 0, 0.3);
  return scale(out, vel * 0.6);
}

export function kazoo(note: number, dur: number, vel = 0.7) {
  const f = mtof(note);
  let s: Float32Array = osc(dur + 0.05, (t) => f * (1 + 0.01 * Math.sin(TAU * 6 * t)), 'saw', ahr(0.02, dur, 0.03));
  s = drive(scale(s, 2), 2.5);
  const a = bp(s, 1100, 3);
  const b = bp(s, 2600, 4);
  mix(a, b, 0, 0.6);
  return scale(a, vel * 1.2);
}

/** Theremin: sine with portamento between target notes and wide vibrato. */
export function theremin(targets: Array<[number, number]>, dur: number, { vel = 0.6, vibrato = 0.012 } = {}) {
  const pitch = curve(targets);
  let f = mtof(targets[0][1]);
  const out = buf(dur);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    f += (mtof(pitch(t)) - f) * 0.0012;
    const fr = f * (1 + vibrato * Math.sin(TAU * 6.2 * t));
    out[i] = (Math.sin(TAU * ph) + 0.15 * Math.sin(2 * TAU * ph)) * ahr(0.12, dur - 0.25, 0.08)(t);
    ph += fr / SR;
    ph -= Math.floor(ph);
  }
  return scale(out, vel);
}

/** Wordless "aah" choir: detuned saws through three vowel formants. */
export function choir(notes: number[], dur: number, vel = 0.6) {
  const out = buf(dur + 0.5);
  for (const n of notes) {
    for (let v = 0; v < 3; v++) {
      const f = mtof(n) * 2 ** (rr(-12, 12) / 1200);
      const vib = rr(4.5, 5.8);
      const s = osc(dur + 0.5, (t) => f * (1 + 0.006 * Math.sin(TAU * vib * t)), 'saw', ahr(0.35, dur, 0.35));
      const fm1 = bp(s, 800, 6);
      mix(fm1, bp(s, 1150, 8), 0, 0.6);
      mix(fm1, bp(s, 2900, 10), 0, 0.25);
      mix(out, fm1, 0, 0.5 / notes.length);
    }
  }
  return scale(out, vel * 2.4);
}

export function pad(notes: number[], dur: number, { vel = 0.5, cutoff = 1600, attack = 0.4 } = {}) {
  const out = buf(dur + 0.8);
  for (const n of notes) mix(out, supersaw(dur + 0.8, mtof(n), 3, 11), 0, 1 / notes.length);
  return scale(mulEnv(lp(lp(out, cutoff), cutoff * 1.4), ahr(attack, dur, 0.4)), vel);
}

export function tremoloStrings(notes: number[], dur: number, { vel = 0.5, rate = 8, cutoff = 2400 } = {}) {
  const out = pad(notes, dur, { vel, cutoff, attack: 0.08 });
  return mulEnv(out, (t) => 0.55 + 0.45 * Math.max(0, Math.sin(TAU * rate * t)));
}

// --- drums ------------------------------------------------------------------------------

export function kick(vel = 0.8, { f0 = 120, f1 = 46, tau = 0.2 } = {}) {
  const body = osc(0.6, (t) => f1 + (f0 - f1) * Math.exp(-t / 0.03), 'sine', perc(0.001, tau));
  mix(body, mulEnv(lp(noise(0.01), 3000), perc(0.0002, 0.002)), 0, 0.3);
  return scale(body, vel);
}

export function snare(vel = 0.8, tone = 190) {
  const n = mulEnv(bp(noise(0.4), 3500, 0.6), perc(0.001, 0.09));
  const body = osc(0.2, tone, 'tri', perc(0.001, 0.04));
  mix(n, body, 0, 0.5);
  return scale(n, vel);
}

export function brushSlap(vel = 0.6) {
  const n = mulEnv(bp(noise(0.3, 'pink'), rr(2400, 3200), 0.6), perc(0.004, 0.07));
  return scale(n, vel * 1.4);
}

export function brushSweep(dur: number, vel = 0.3) {
  return scale(bp(noise(dur, 'pink'), 2600, 0.5), vel);
}

export function ride(vel = 0.5) {
  const modes: Mode[] = [];
  for (let i = 0; i < 12; i++) modes.push({ f: rr(2800, 9500), a: rr(0.2, 1), tau: rr(0.5, 1.6) });
  const shimmer = modal(modes, 2);
  const wash = mulEnv(hp(noise(2), 6000), perc(0.001, 0.35));
  const ping = modal([{ f: 4900, a: 1, tau: 0.06 }], 0.4);
  const out = scale(shimmer, 0.06);
  mix(out, wash, 0, 0.12);
  mix(out, ping, 0, 0.2);
  return scale(hp(out, 1500), vel);
}

export function crash(vel = 0.8, tau = 1.1) {
  const modes: Mode[] = [];
  for (let i = 0; i < 20; i++) modes.push({ f: rr(2000, 11000), a: rr(0.2, 1), tau: rr(0.3, tau) });
  const out = scale(modal(modes, tau * 4), 0.04);
  mix(out, mulEnv(hp(noise(tau * 4), 3500), perc(0.002, tau * 0.6)), 0, 0.35);
  return scale(hp(out, 1200), vel);
}

export function hat(vel = 0.4, tau = 0.03) {
  return scale(mulEnv(hp(bp(noise(0.3), 9000, 0.7), 6000), perc(0.0005, tau)), vel);
}

export function rim(vel = 0.6) {
  const out = modal([
    { f: 1700, a: 1, tau: 0.012 },
    { f: 2750, a: 0.6, tau: 0.008 },
  ]);
  mix(out, mulEnv(hp(noise(0.01), 3000), perc(0.0002, 0.002)), 0, 0.6);
  return scale(out, vel);
}

export function woodblock(f = 900, vel = 0.6) {
  return scale(
    modal([
      { f, a: 1, tau: 0.045 },
      { f: f * 2.73, a: 0.35, tau: 0.02 },
      { f: f * 4.5, a: 0.1, tau: 0.008 },
    ]),
    vel,
  );
}

export function snareRoll(dur: number, { from = 0.15, to = 0.8, rate = 34 } = {}) {
  const out = buf(dur + 0.3);
  const strokes = Math.round(dur * rate);
  for (let i = 0; i < strokes; i++) {
    const x = i / strokes;
    mix(out, snare(jit(from + (to - from) * x ** 1.6, 0.15), 200), (i / rate) + rr(-0.003, 0.003), 0.5);
  }
  return out;
}

export function tom(note: number, vel = 0.7) {
  const f = mtof(note);
  const body = osc(0.5, (t) => f * (1 + 0.5 * Math.exp(-t / 0.02)), 'sine', perc(0.001, 0.18));
  mix(body, mulEnv(lp(noise(0.1), 2000), perc(0.001, 0.02)), 0, 0.3);
  return scale(body, vel);
}

// --- casino foley ------------------------------------------------------------------------

/** One clay chip striking another. */
export function chipClack(vel = 0.7, dull = 0) {
  const k = 1 - dull * 0.35;
  const out = modal([
    { f: rr(2300, 3000) * k, a: 1, tau: rr(0.012, 0.022) },
    { f: rr(3900, 4700) * k, a: 0.7, tau: rr(0.008, 0.016) },
    { f: rr(5600, 6600) * k, a: 0.45, tau: rr(0.005, 0.01) },
    { f: rr(7800, 9000) * k, a: 0.25, tau: rr(0.003, 0.006) },
  ]);
  mix(out, mulEnv(hp(noise(0.006), 2500), perc(0.0002, 0.0012)), 0, 0.8);
  return scale(dull ? lp(out, 3000) : out, vel);
}

/** Several chips dropped onto a stack. */
export function chipStack(count: number, { spread = 0.045, vel = 0.7, dull = 0 } = {}) {
  const out = buf(count * spread + 0.3);
  let at = 0;
  for (let i = 0; i < count; i++) {
    mix(out, chipClack(jit(vel * (1 - i * 0.05), 0.15), dull), at);
    at += spread * rr(0.6, 1.3);
  }
  return out;
}

export function feltThud(vel = 0.6) {
  const out = mulEnv(lp(noise(0.15, 'pink'), 280), perc(0.002, 0.025));
  mix(out, osc(0.12, 85, 'sine', perc(0.002, 0.03)), 0, 0.4);
  return scale(out, vel * 2);
}

export function feltSlide(dur: number, vel = 0.4) {
  const out = mulEnv(bp(noise(dur, 'pink'), expCurve([[0, 700], [dur, 1100]]), 0.8), (t) => Math.sin((Math.PI * t) / dur) ** 0.7);
  return scale(out, vel * 2.5);
}

/** A card flicked across felt: a band-passed "fwip" plus a soft landing. */
export function cardDeal(vel = 0.7) {
  const d = 0.09;
  const fwip = mulEnv(bp(noise(d), expCurve([[0, 1800], [d, 4800]]), 1.4), (t) => Math.sin((Math.PI * t) / d) ** 1.5);
  const out = buf(0.3);
  mix(out, fwip, 0, 1.4);
  mix(out, feltThud(0.5), d * 0.9, 0.6);
  mix(out, mulEnv(hp(noise(0.01), 3000), perc(0.0003, 0.002)), d * 0.9, 0.3);
  return scale(out, vel);
}

export function cardFlip(vel = 0.7) {
  const out = buf(0.25);
  mix(out, mulEnv(hp(noise(0.01), 3500), perc(0.0002, 0.0018)), 0, 0.9);
  const d = 0.05;
  mix(out, mulEnv(bp(noise(d), expCurve([[0, 4200], [d, 2200]]), 1.2), (t) => Math.sin((Math.PI * t) / d)), 0.005, 1.2);
  mix(out, feltThud(0.4), 0.06, 0.5);
  return scale(out, vel);
}

/** A wooden croupier's rake knocking the table. */
export function woodKnock(vel = 0.8, f = 480) {
  const out = modal([
    { f, a: 1, tau: 0.05 },
    { f: f * 2.57, a: 0.5, tau: 0.025 },
    { f: f * 4.1, a: 0.25, tau: 0.012 },
  ]);
  mix(out, feltThud(0.8), 0, 0.5);
  mix(out, mulEnv(bp(noise(0.02), 2500, 0.8), perc(0.0003, 0.003)), 0, 0.4);
  return scale(out, vel);
}

/** Ivory ball ticking off a roulette fret. */
export function ballTick(vel = 0.6) {
  const out = modal([
    { f: rr(3000, 3600), a: 1, tau: 0.012 },
    { f: rr(5000, 5600), a: 0.5, tau: 0.007 },
    { f: rr(7200, 8000), a: 0.3, tau: 0.004 },
  ]);
  mix(out, mulEnv(hp(noise(0.004), 4000), perc(0.0001, 0.0008)), 0, 0.5);
  return scale(out, vel);
}

/** Roulette: the ball rolls, slows, bounces across the frets and drops into a pocket. */
export function roulette(rollDur = 2.1) {
  const out = buf(rollDur + 1.4);
  const roll = bp(noise(rollDur, 'pink'), 2600, 1.6);
  let ph = 0;
  for (let i = 0; i < roll.length; i++) {
    const t = i / SR;
    const rate = 4.2 - 2.6 * (t / rollDur);
    ph += rate / SR;
    roll[i] *= (0.55 + 0.45 * Math.sin(TAU * ph)) * Math.min(1, t / 0.15) * (1 - 0.4 * (t / rollDur));
  }
  mix(out, roll, 0, 1.2);
  mix(out, scale(lp(noise(rollDur + 0.8, 'brown'), 140), 0.12), 0);
  const bounces = [0, 0.11, 0.19, 0.33, 0.4, 0.52, 0.6, 0.67, 0.74, 0.79];
  bounces.forEach((b, i) => mix(out, ballTick(jit(0.9 - i * 0.05, 0.1)), rollDur + b));
  mix(out, ballTick(0.5), rollDur + 0.92);
  mix(out, ballTick(0.3), rollDur + 0.97);
  mix(out, feltThud(0.3), rollDur + 0.97);
  return out;
}

export function coin(vel = 0.6) {
  const out = modal([
    { f: rr(3800, 4600), a: 1, tau: rr(0.15, 0.35) },
    { f: rr(6200, 7400), a: 0.7, tau: rr(0.1, 0.25) },
    { f: rr(9000, 10400), a: 0.45, tau: rr(0.06, 0.15) },
    { f: rr(11500, 12800), a: 0.25, tau: rr(0.04, 0.08) },
  ]);
  mix(out, mulEnv(hp(noise(0.004), 5000), perc(0.0001, 0.001)), 0, 0.6);
  return scale(out, vel * 0.6);
}

/** A coin dropping and bouncing a couple of times. */
export function coinDrop(vel = 0.6) {
  const out = buf(1.2);
  let at = 0;
  let gap = rr(0.05, 0.09);
  for (let i = 0; i < 3; i++) {
    mix(out, coin(vel * 0.55 ** i), at);
    at += gap;
    gap *= 0.6;
  }
  return out;
}

export function coinPour(dur: number, count: number, vel = 0.6) {
  const out = buf(dur + 1.2);
  for (let i = 0; i < count; i++) mix(out, coinDrop(jit(vel, 0.3)), rand() ** 0.8 * dur, rr(0.5, 1));
  return out;
}

// --- machines ------------------------------------------------------------------------------

export function metalClick(vel = 0.6, f = 3500) {
  const out = modal([
    { f, a: 1, tau: 0.01 },
    { f: f * 1.66, a: 0.6, tau: 0.007 },
    { f: f * 0.34, a: 0.4, tau: 0.04 },
  ]);
  mix(out, mulEnv(hp(noise(0.004), 3000), perc(0.0001, 0.001)), 0, 0.6);
  return scale(out, vel);
}

/** Train of clicks whose rate follows `rate(t)` (clicks per second). */
export function clickTrain(dur: number, rate: (t: number) => number, click: () => Float32Array, gain: (t: number) => number = () => 1) {
  const out = buf(dur + 0.3);
  let t = 0;
  while (t < dur) {
    mix(out, click(), t, gain(t));
    t += 1 / Math.max(0.5, rate(t));
  }
  return out;
}

export function thunk(vel = 0.8, f = 110) {
  const out = modal([
    { f, a: 1, tau: 0.08 },
    { f: f * 3.2, a: 0.4, tau: 0.04 },
    { f: f * 7.9, a: 0.25, tau: 0.02 },
    { f: f * 12.3, a: 0.12, tau: 0.012 },
  ]);
  mix(out, mulEnv(lp(noise(0.05), 1500), perc(0.0005, 0.01)), 0, 0.6);
  return scale(drive(scale(out, 1.5), 1.3), vel);
}

/** Electric alarm bell: a hammer striking a gong at `rate` Hz. */
export function alarmBell(dur: number, { f = 1250, rate = 24, vel = 0.7 } = {}) {
  const exc = buf(dur);
  for (let t = 0; t < dur; t += 1 / rate) mix(exc, mulEnv(noise(0.003), perc(0.0001, 0.0008)), t, jit(1, 0.15));
  const out = resonate(exc, [
    { f, a: 1, tau: 0.5 },
    { f: f * 2.76, a: 0.5, tau: 0.3 },
    { f: f * 5.4, a: 0.3, tau: 0.15 },
    { f: f * 1.003, a: 0.7, tau: 0.5 },
  ], 0.8);
  return scale(out, vel * 0.08);
}

/** Split-flap (Solari) board: flaps clattering and slowing to a stop. */
export function splitFlap(count = 12, dur = 0.42, vel = 0.6) {
  const out = buf(dur + 0.2);
  for (let i = 0; i < count; i++) {
    const at = dur * (i / count) ** 1.6;
    const flap = modal([
      { f: rr(1800, 2400), a: 1, tau: 0.006 },
      { f: rr(4000, 5000), a: 0.5, tau: 0.004 },
    ]);
    mix(flap, mulEnv(bp(noise(0.01), 3000, 0.8), perc(0.0002, 0.0015)), 0, 0.7);
    mix(out, flap, at, jit(vel, 0.15) * (i === count - 1 ? 1.4 : 1));
  }
  return out;
}

export function motor(dur: number, freq: (t: number) => number, vel = 0.4) {
  return scale(lp(drive(osc(dur, freq, 'saw', 1), 2), 900), vel);
}

/** Spring "sproing": a wobbling, falling tone. */
export function sproing(dur = 0.7, f0 = 520, f1 = 180, vel = 0.6) {
  const s = osc(dur, (t) => (f0 * Math.exp((-t / dur) * Math.log(f0 / f1))) * (1 + 0.18 * Math.exp(-t / 0.25) * Math.sin(TAU * 24 * t)), 'tri', perc(0.002, dur * 0.35));
  return scale(s, vel);
}

// --- noir and electric ----------------------------------------------------------------------

/** Neon tube hum: harmonics of 100 Hz with a crackly arc. */
export function neonHum(dur: number, vel = 0.4) {
  let s = additive(dur, 100, (k) => (k % 2 === 0 ? 1 : 0.5) / k ** 0.75, 36);
  s = filter(bp(s, 900, 0.5), 'peak', 3200, 2, 6);
  const arc = mulEnv(hp(noise(dur), 3000), () => (rand() < 0.002 ? 1 : 0.04));
  mix(s, arc, 0, 0.08);
  return scale(s, vel);
}

/** Neon flickering: bursts of hum and arcs at given on/off times, then (unless `holdFrom` is null) dying away from `holdFrom`. */
export function neonOn(pattern: Array<[number, number]>, holdFrom: number | null, vel = 0.5) {
  const end = holdFrom ?? Math.max(...pattern.map(([, b]) => b));
  const hum = neonHum(end + 0.4, vel);
  const gate = (t: number) => {
    for (const [a, b] of pattern) if (t >= a && t < b) return 1;
    return holdFrom !== null && t >= holdFrom ? Math.exp(-(t - holdFrom) / 0.12) : 0;
  };
  const out = mulEnv(hum, gate);
  for (const [a] of pattern) mix(out, mulEnv(hp(noise(0.02), 2500), perc(0.0002, 0.004)), a, vel * 0.8);
  return lp(out, 7000);
}

export function zap(vel = 0.8) {
  const out = osc(0.25, expCurve([[0, 3200], [0.18, 140]]), 'saw', perc(0.001, 0.07));
  mix(out, mulEnv(hp(noise(0.12), 1800), perc(0.0005, 0.03)), 0, 0.7);
  return scale(drive(out, 2), vel * 0.7);
}

export function sub(dur: number, f0 = 55, f1 = 32, vel = 0.8) {
  const s = osc(dur, expCurve([[0, f0], [dur, f1]]), 'sine', perc(0.005, dur * 0.35));
  return scale(drive(scale(s, 1.4), 1.5), vel);
}

export function heartbeat(vel = 0.8) {
  const out = buf(0.6);
  mix(out, kick(1, { f0: 75, f1: 40, tau: 0.11 }), 0, 1);
  mix(out, kick(0.7, { f0: 70, f1: 38, tau: 0.09 }), 0.2, 0.7);
  return scale(lp(out, 300), vel);
}

export function riser(dur: number, vel = 0.5) {
  const n = mulEnv(bp(noise(dur, 'pink'), expCurve([[0, 300], [dur, 6000]]), 2), (t) => (t / dur) ** 1.8);
  const tone = osc(dur, expCurve([[0, mtof(50)], [dur, mtof(74)]]), 'saw', (t) => 0.15 * (t / dur) ** 2);
  mix(n, lp(tone, 2500), 0, 1);
  return scale(n, vel * 1.6);
}

export function braam(notes: number[], dur: number, vel = 0.8) {
  const out = buf(dur + 0.5);
  for (const n of notes) mix(out, supersaw(dur + 0.5, mtof(n), 4, 14), 0, 1 / notes.length);
  const opened = filter(out, 'lp', expCurve([[0, 180], [0.15, 1400], [dur, 400]]), 1.2);
  return scale(drive(mulEnv(opened, ahr(0.03, dur, 0.25)), 2), vel);
}

export function lighter(vel = 0.7) {
  const out = buf(0.7);
  mix(out, metalClick(0.8, 4200), 0, 0.8);
  mix(out, modal([{ f: 2900, a: 1, tau: 0.06 }, { f: 6100, a: 0.5, tau: 0.03 }]), 0.002, 0.3);
  const scratch = mulEnv(bp(noise(0.05), 3500, 1.2), (t) => (rand() < 0.3 ? 1 : 0.2) * Math.sin((Math.PI * t) / 0.05));
  mix(out, scratch, 0.14, 1.2);
  const whoosh = mulEnv(lp(noise(0.45, 'pink'), expCurve([[0, 300], [0.15, 1500], [0.45, 600]])), (t) => Math.sin((Math.PI * t) / 0.45) ** 1.5);
  mix(out, whoosh, 0.16, 1.5);
  return scale(out, vel);
}

export function reverseCymbal(dur: number, vel = 0.6) {
  return scale(reverse(crash(1, dur * 0.7).subarray(0, samples(dur))), vel);
}

// --- gramophone tricks ------------------------------------------------------------------------

export function needleDrop(vel = 0.7) {
  const out = buf(0.3);
  mix(out, lp(mulEnv(noise(0.08), perc(0.001, 0.015)), 500), 0, 1.4);
  mix(out, osc(0.1, 60, 'sine', perc(0.001, 0.03)), 0, 0.8);
  mix(out, mulEnv(hp(noise(0.02), 2000), perc(0.0002, 0.003)), 0.01, 0.5);
  return scale(out, vel);
}

/** Record scratch: rubs a source back and forth under the needle. */
export function scratch(src: Float32Array, moves: Array<[number, number]>, dur: number) {
  return varispeed(src, curve(moves), dur, 0.05);
}

/** Record/tape slowing to a stop over `stop` seconds. */
export function tapeStop(src: Float32Array, stop: number, startAt = 0) {
  return varispeed(src, (t) => Math.max(0, 1 - t / stop) ** 1.4, stop + 0.05, startAt);
}

/** Ragtime piano phrase used as raw material for varispeed tricks. */
export function ragtimeLick(vel = 0.7) {
  const out = buf(2.2);
  const step = 0.14;
  const melody = [76, 79, 81, 84, 81, 79, 76, 72];
  melody.forEach((n, i) => mix(out, piano(n, step * 0.9, { vel, detune: 9 }), i * step, 0.6));
  [[48, 0], [64, 1], [55, 2], [64, 3], [48, 4], [64, 5], [55, 6], [64, 7]].forEach(([n, i]) => {
    const notes = n < 60 ? [n] : [n - 12 + 4, n - 12 + 7, n];
    for (const m of notes) mix(out, piano(m, step * 0.7, { vel: vel * 0.6, detune: 9 }), i * step, 0.4);
  });
  return out;
}

export function slideWhistle(dur: number, from: number, to: number, vel = 0.5) {
  const s = osc(dur, expCurve([[0, mtof(from)], [dur, mtof(to)]]), 'sine', ahr(0.03, dur - 0.05, 0.04));
  mix(s, mulEnv(bp(noise(dur), 2000, 1), ahr(0.03, dur - 0.05, 0.04)), 0, 0.05);
  return scale(s, vel);
}