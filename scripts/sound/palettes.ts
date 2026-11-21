// The five sound palettes. Each designs the same 13 game moments, from a faithful casino
// table (variance 1) to a gramophone fever dream (variance 5).
import type { CueId, PaletteId } from '../../src/shared/soundbank';
import {
  SR,
  Track,
  bp,
  buf,
  crackle,
  curve,
  echo,
  expCurve,
  fade,
  gramophone,
  hp,
  jit,
  lp,
  mix,
  modal,
  mtof,
  mulEnv,
  noise,
  perc,
  pluck,
  rand,
  reverb,
  reverse,
  rr,
  scale,
} from './dsp';
import * as I from './instruments';

type Cue = (t: Track) => void;

export interface Palette {
  /** Seconds of tail added after the dry sound for reverb and echoes. */
  tail: number;
  post: (t: Track) => Track;
  cues: Record<CueId, Cue>;
}

/** Loudest-400ms targets in dBFS, so cues sit at sensible levels against each other. */
export const CUE_LEVELS: Record<CueId, number> = {
  join: -21,
  phase: -17,
  question: -19,
  buzz: -15,
  tick: -26,
  correct: -17,
  wrong: -19,
  flip: -22,
  chip: -22,
  lock: -19,
  drumroll: -18,
  reveal: -19,
  jackpot: -15,
};

/** Longest a cue may ring (seconds) before it is faded out, so cues never pile up in play. */
export const CUE_MAX: Record<CueId, number> = {
  join: 2.2,
  phase: 4.5,
  question: 2.5,
  buzz: 2,
  tick: 1,
  correct: 3,
  wrong: 3,
  flip: 1.5,
  chip: 1.5,
  lock: 2.5,
  drumroll: 5,
  reveal: 3.5,
  jackpot: 6,
};

// --- 1. Salon Privé ---------------------------------------------------------------------

const salon: Palette = {
  tail: 1.2,
  post: (t) => reverb(t, { room: 0.55, damp: 0.55, wet: 0.16, predelay: 0.012, width: 0.9 }),
  cues: {
    join: (t) => {
      t.add(I.feltSlide(0.16, 0.35), 0, 1, -0.2);
      t.add(I.chipStack(3, { spread: 0.05 }), 0.13, 1, 0.1);
    },
    phase: (t) => {
      t.add(I.bell(2350, { vel: 0.9 }), 0, 1, 0.25);
      t.add(I.chord([50, 57, 64, 66, 73], 1.8, { vel: 0.5, roll: 0.035 }), 0.06, 1, -0.1);
    },
    question: (t) => {
      t.add(I.cardDeal(0.8), 0, 1, -0.3);
      t.add(I.cardDeal(0.7), 0.17, 1, 0.3);
    },
    buzz: (t) => {
      t.add(I.woodKnock(1, 470), 0, 1);
      t.add(I.bell(2900, { vel: 0.6, tau: 0.9 }), 0.012, 1, 0.2);
    },
    tick: (t) => t.add(I.ballTick(0.7), 0),
    correct: (t) => {
      t.add(I.bell(2350, { vel: 0.85 }), 0, 1, 0.3);
      t.add(I.bell(2350, { vel: 0.6 }), 0.17, 1, 0.3);
      t.add(I.feltSlide(0.5, 0.25), 0.15, 1, -0.2);
      for (let i = 0; i < 14; i++) t.add(I.chipClack(jit(0.6 - i * 0.025, 0.2)), 0.18 + i * rr(0.03, 0.06), 1, rr(-0.5, 0.5));
    },
    wrong: (t) => {
      t.add(I.piano(33, 1.0, { vel: 0.45 }), 0, 0.8);
      const sweep = mulEnv(bp(noise(0.5, 'pink'), expCurve([[0, 1100], [0.5, 500]]), 0.9), (x) => Math.sin((Math.PI * x) / 0.5) ** 0.8);
      t.add(sweep, 0.02, 2.2, -0.2);
      for (let i = 0; i < 4; i++) t.add(I.chipClack(0.35, 1), 0.1 + i * 0.07, 1, 0.1 * i);
      t.add(I.feltThud(0.8), 0.48);
    },
    flip: (t) => t.add(I.cardFlip(0.8), 0),
    chip: (t) => t.add(I.chipStack(3, { spread: 0.045, vel: 0.75 }), 0, 1, 0.15),
    lock: (t) => {
      t.add(I.woodKnock(0.9, 450), 0);
      t.add(I.woodKnock(1, 430), 0.16);
      t.add(I.chipStack(2, { vel: 0.3, dull: 1 }), 0.3, 1, 0.3);
    },
    drumroll: (t) => t.add(I.roulette(2.1), 0, 1.2),
    reveal: (t) => {
      t.add(I.cardFlip(0.9), 0);
      t.add(I.chord([81, 85, 88, 93], 1.2, { vel: 0.35, roll: 0.04, bright: 1.3 }), 0.04, 1, 0.2);
    },
    jackpot: (t) => {
      [0, 0.14, 0.28].forEach((at, i) => t.add(I.bell(2350 * [1, 1.26, 1.5][i], { vel: 0.8 }), at, 1, 0.3));
      [62, 66, 69, 74, 78, 81, 86].forEach((n, i) => t.add(I.piano(n, i === 6 ? 1.6 : 0.4, { vel: 0.6 }), 0.1 + i * 0.07, 0.6, -0.2));
      for (let i = 0; i < 40; i++) t.add(I.chipClack(jit(0.55, 0.3)), 0.15 + rand() ** 0.7 * 1.4, 1, rr(-0.7, 0.7));
    },
  },
};

// --- 2. Orchestre 1925 ---------------------------------------------------------------------

const C69 = [60, 64, 67, 69, 74];

const jazz: Palette = {
  tail: 1.4,
  post: (t) => reverb(t, { room: 0.7, damp: 0.45, wet: 0.2, predelay: 0.018 }),
  cues: {
    join: (t) => {
      [[67, 0, 0.09], [69, 0.09, 0.09], [72, 0.18, 0.32]].forEach(([n, at, d]) => t.add(I.clarinet(n, d, { vel: 0.7 }), at, 1, 0.2));
      t.add(I.brushSlap(0.5), 0.18, 1, -0.3);
    },
    phase: (t) => {
      t.add(I.snare(0.4), 0, 1, -0.1);
      t.add(I.snare(0.6), 0.05, 1, -0.1);
      t.add(I.brassChord(C69, 0.6, { vel: 0.95, shake: 0.006 }), 0.1, 1.1);
      t.add(I.crash(0.6), 0.1, 1, 0.4);
      t.add(I.kick(0.8), 0.1);
      t.add(I.upright(36, 0.5, 0.9), 0.1, 1);
    },
    question: (t) => {
      [67, 69, 71].forEach((n, i) => {
        t.add(I.piano(n, 0.1, { vel: 0.6, detune: 4 }), i * 0.12, 0.7, 0.2);
        t.add(I.rim(0.4), i * 0.12, 1, -0.3);
      });
      t.add(I.chord([60, 64, 67, 72], 0.45, { vel: 0.65, detune: 4 }), 0.36, 1, 0.1);
      t.add(I.upright(36, 0.4), 0.36);
    },
    buzz: (t) => {
      t.add(I.brassChord([58, 62, 65, 68, 72], 0.18, { vel: 1, scoop: 0.05 }), 0, 1.3);
      t.add(I.snare(0.9), 0, 1, -0.1);
      t.add(I.rim(0.6), 0, 1, -0.2);
      t.add(I.kick(0.9), 0);
    },
    tick: (t) => t.add(I.woodblock(880, 0.7), 0),
    correct: (t) => {
      [72, 74, 76, 79, 81, 84].forEach((n, i) => t.add(I.clarinet(n, i === 5 ? 0.45 : 0.05, { vel: 0.7 }), i * 0.045, 0.9, 0.3));
      t.add(I.brassChord(C69.map((n) => n + 12), 0.65, { vel: 0.85, shake: 0.008 }), 0.3, 0.9, -0.1);
      t.add(I.crash(0.35), 0.3, 1, 0.4);
      t.add(I.upright(36, 0.5), 0.3);
    },
    wrong: (t) => {
      const notes: Array<[number, number, number]> = [[65, 0, 0.3], [64, 0.36, 0.3], [63, 0.72, 0.3], [62, 1.08, 0.95]];
      for (const [n, at, d] of notes) {
        const wah = curve([[0, 500], [0.08, 1500], [d * 0.8, 1300], [d, 600]]);
        const last = at > 1;
        t.add(I.brass(n, d, { vel: 0.8, mute: true, wah: last ? (x) => 900 + 600 * Math.sin(6.28 * 3.2 * x) : wah, shake: last ? 0.012 : 0 }), at, 1.2);
      }
    },
    flip: (t) => {
      t.add(I.brushSweep(0.16, 0.6), 0, 1, -0.2);
      t.add(I.xylophone(88, 0.5), 0.1, 1, 0.3);
    },
    chip: (t) => {
      t.add(I.banjo(62, 0.7), 0, 1, -0.2);
      t.add(I.banjo(69, 0.6), 0.008, 1, 0.2);
      t.add(I.brushSlap(0.4), 0);
    },
    lock: (t) => {
      const d7 = [54, 60, 62, 66, 69];
      t.add(I.brassChord(d7, 0.12, { vel: 0.9 }), 0, 1.1);
      t.add(I.brassChord(d7, 0.14, { vel: 1 }), 0.2, 1.1);
      t.add(I.kick(0.8), 0.2);
      t.add(I.crash(0.5, 0.12), 0.2, 1, 0.4);
    },
    drumroll: (t) => {
      t.add(I.snareRoll(2.4), 0, 1, -0.1);
      t.add(I.tom(45, 0.6), 2.25, 1, 0.2);
      t.add(I.kick(1), 2.45);
      t.add(I.crash(0.8), 2.45, 1, 0.4);
      t.add(I.brassChord([50, 57, 62, 64, 66, 71], 0.5, { vel: 0.9 }), 2.45, 1);
    },
    reveal: (t) => {
      [72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89, 91, 93, 96].forEach((n, i) => t.add(I.xylophone(n, 0.45 + i * 0.02), i * 0.025, 1, -0.4 + i * 0.06));
      t.add(I.reverseCymbal(0.35, 0.5), 0, 1, 0.3);
      t.add(I.xylophone(96, 0.8), 0.36, 1, 0.4);
    },
    jackpot: (t) => {
      const c6 = [64, 67, 69, 72];
      t.add(I.brassChord(c6, 0.14, { vel: 0.95 }), 0, 1);
      t.add(I.brassChord(c6, 0.14, { vel: 0.95 }), 0.2, 1);
      t.add(I.brassChord(c6.map((n) => n + 1), 0.14, { vel: 0.95 }), 0.45, 1);
      [0.45, 0.51, 0.57, 0.63].forEach((at) => t.add(I.snare(0.6), at, 1, -0.1));
      t.add(I.brassChord([60, 64, 67, 69, 74, 79], 1.4, { vel: 1, shake: 0.01 }), 0.7, 1.2);
      t.add(I.crash(0.9), 0.7, 1, 0.4);
      t.add(I.kick(1), 0.7);
      t.add(I.upright(36, 1.2), 0.7);
      for (let i = 0; i < 12; i++) t.add(I.clarinet(i % 2 ? 86 : 84, 0.07, { vel: 0.5 }), 0.8 + i * 0.075, 0.6, 0.3);
    },
  },
};

// --- 3. La Machine ----------------------------------------------------------------------------

const ratchet = () => I.metalClick(jit(0.5, 0.2), rr(3000, 3600));

function reelSpin(t: Track, at: number, dur: number, stops: number[]) {
  t.add(I.clickTrain(dur, () => 28, () => I.metalClick(jit(0.25, 0.3), rr(2500, 3200)), (x) => Math.min(1, x / 0.08)), at, 1, -0.1);
  t.add(I.motor(dur, () => 58, 0.15), at, 1);
  stops.forEach((s, i) => t.add(I.thunk(0.7, 150 - i * 12), at + s, 1, -0.4 + i * 0.4));
}

const machine: Palette = {
  tail: 0.8,
  post: (t) => reverb(t, { room: 0.42, damp: 0.25, wet: 0.14, predelay: 0.006 }),
  cues: {
    join: (t) => {
      t.add(mulEnv(bp(noise(0.12), expCurve([[0, 4000], [0.12, 6500]]), 3), (x) => Math.sin((Math.PI * x) / 0.12)), 0, 0.8, 0.2);
      t.add(I.coin(0.8), 0.13, 1, 0.2);
      t.add(I.coin(0.4), 0.2, 1, -0.1);
      t.add(I.thunk(0.25, 220), 0.26);
      t.add(I.bell(3800, { vel: 0.35, tau: 0.7 }), 0.32, 1, 0.3);
    },
    phase: (t) => {
      t.add(I.clickTrain(0.36, (x) => 12 + x * 40, ratchet), 0, 1, 0.3);
      t.add(I.thunk(1, 90), 0.38);
      reelSpin(t, 0.4, 0.7, [0.7, 0.9, 1.1]);
      t.add(I.bell(3300, { vel: 0.7 }), 1.55, 1, 0.3);
    },
    question: (t) => {
      reelSpin(t, 0, 0.45, [0.45, 0.55, 0.65]);
      t.add(I.bell(3300, { vel: 0.4, tau: 0.6 }), 0.72, 1, 0.3);
    },
    buzz: (t) => t.add(I.alarmBell(0.45, { vel: 0.9 }), 0, 1),
    tick: (t) => {
      t.add(I.metalClick(0.7, 3400), 0);
      t.add(modal([{ f: 1180, a: 1, tau: 0.05 }]), 0, 0.15);
    },
    correct: (t) => {
      t.add(I.bell(3300, { vel: 0.8 }), 0, 1, 0.3);
      t.add(I.bell(3300, { vel: 0.6 }), 0.1, 1, 0.3);
      t.add(I.coinPour(1.0, 22, 0.6), 0.12, 1, -0.1);
    },
    wrong: (t) => {
      t.add(I.motor(0.55, expCurve([[0, 95], [0.55, 35]]), 0.5), 0, 1);
      t.add(mulEnv(bp(noise(0.5), 700, 1.5), (x) => 0.5 + 0.5 * Math.sin(6.28 * 31 * x)), 0, 0.3);
      t.add(I.thunk(1, 75), 0.52);
      t.add(I.sproing(0.6, 420, 120, 0.4), 0.55, 1, 0.3);
    },
    flip: (t) => t.add(I.splitFlap(12, 0.42, 0.7), 0, 1, 0.1),
    chip: (t) => {
      t.add(I.metalClick(0.8, 2400), 0, 1, -0.2);
      t.add(I.thunk(0.3, 260), 0.005);
      t.add(I.metalClick(0.7, 2600), 0.08, 1, 0.2);
      t.add(I.thunk(0.3, 250), 0.085);
    },
    lock: (t) => {
      t.add(mulEnv(lp(noise(0.26), expCurve([[0, 300], [0.26, 1200]])), (x) => Math.min(1, x / 0.05)), 0, 0.6);
      t.add(I.thunk(1, 65), 0.26);
      t.add(modal([{ f: 900, a: 0.6, tau: 0.3 }, { f: 1370, a: 0.4, tau: 0.25 }, { f: 2210, a: 0.2, tau: 0.15 }]), 0.26, 0.4);
      t.add(I.metalClick(0.8, 3800), 0.38, 1, 0.3);
    },
    drumroll: (t) => {
      const dur = 3;
      t.add(I.clickTrain(dur, (x) => 22 * (1 - x / dur) ** 1.4 + 2.5, () => I.metalClick(jit(0.55, 0.2), rr(2100, 2500))), 0, 1, 0.1);
      t.add(scale(lp(noise(dur, 'pink'), expCurve([[0, 900], [dur, 200]])), 0.25), 0);
      t.add(I.thunk(0.6, 120), dur + 0.1);
    },
    reveal: (t) => {
      t.add(I.clickTrain(0.18, () => 18, ratchet), 0, 1, -0.2);
      t.add(I.bell(3300, { vel: 1, tau: 1.8 }), 0.2, 1, 0.3);
      t.add(mulEnv(lp(noise(0.25, 'brown'), 800), (x) => Math.sin((Math.PI * x) / 0.25)), 0.22, 1.2);
      t.add(I.thunk(0.8, 140), 0.47);
    },
    jackpot: (t) => {
      t.add(I.alarmBell(1.8, { vel: 0.55, rate: 22 }), 0, 1, -0.3);
      t.add(I.alarmBell(1.8, { vel: 0.45, rate: 19, f: 1580 }), 0.05, 1, 0.3);
      [72, 76, 79, 84].forEach((n, i) => t.add(I.bell(mtof(n) * 2, { vel: 0.6 }), i * 0.12, 1, 0.2));
      t.add(I.coinPour(2.2, 60, 0.55), 0.1, 1);
    },
  },
};

// --- 4. Néon Noir ---------------------------------------------------------------------------

const noir: Palette = {
  tail: 2.4,
  post: (t) => reverb(echo(t, 0.375, 0.3, 0.14, 2400), { room: 0.86, damp: 0.6, wet: 0.3, predelay: 0.03, lowcut: 220 }),
  cues: {
    join: (t) => {
      t.add(I.neonOn([[0, 0.04], [0.1, 0.13], [0.21, 0.24]], 0.3, 0.35), 0, 1, -0.3);
      t.add(I.vibraphone(69, { vel: 0.6 }), 0.24, 1, 0.3);
    },
    phase: (t) => {
      t.add(I.reverseCymbal(1, 0.6), 0, 1, 0.2);
      t.add(I.sub(1.6, 58, 32, 0.9), 1);
      t.add(I.braam([26, 38, 45], 0.9, 0.5), 1);
      t.add(I.rhodes(50, 1.6, 0.5), 1.02, 0.7, -0.3);
      [53, 57, 60, 64].forEach((n, i) => t.add(I.rhodes(n, 1.6 - i * 0.03, 0.45), 1.02 + i * 0.03, 0.6, -0.1 + i * 0.15));
      t.add(I.neonOn([[0.95, 0.98], [1.0, 1.02]], 1.05, 0.25), 0, 1, 0.5);
    },
    question: (t) => {
      t.add(I.sub(0.8, 73, 70, 0.4), 0);
      t.add(I.vibraphone(69, { vel: 0.6 }), 0, 1, -0.2);
      t.add(I.vibraphone(72, { vel: 0.65 }), 0.22, 1, 0.25);
    },
    buzz: (t) => {
      t.add(I.zap(0.9), 0, 1);
      t.add(I.sub(0.4, 90, 40, 0.9), 0);
      t.add(I.neonOn([[0, 0.25]], 0.25, 0.4), 0, 1, 0.3);
    },
    tick: (t) => t.add(lp(I.metalClick(0.6, 2600), 3500), 0, 1, -0.2),
    correct: (t) => {
      t.add(I.glass(2600, 0.9), 0, 1, -0.25);
      t.add(I.glass(2740, 0.7), 0.012, 1, 0.25);
      [53, 57, 60, 64, 67].forEach((n, i) => t.add(I.rhodes(n, 1.4, 0.4), 0.06 + i * 0.02, 0.5, -0.3 + i * 0.15));
    },
    wrong: (t) => {
      t.add(I.chord([38, 39, 45, 46], 1.2, { vel: 0.6, detune: 15 }), 0, 1.1);
      t.add(I.sub(0.9, 60, 30, 0.6), 0);
      t.add(I.neonOn([[0, 0.12], [0.18, 0.22], [0.3, 0.32]], null, 0.4), 0, 1, 0.4);
    },
    flip: (t) => t.add(I.lighter(0.8), 0, 1, 0.15),
    chip: (t) => {
      t.add(I.chipStack(2, { spread: 0.05, vel: 0.6 }), 0, 1, 0.2);
      t.add(lp(pluck(mtof(38), 0.8, { t60: 0.6, tone: 0.5, bright: 0.3 }), 600), 0, 0.8);
    },
    lock: (t) => {
      t.add(I.sub(1, 80, 30, 0.9), 0);
      t.add(modal([{ f: 110, a: 1, tau: 0.35 }, { f: 343, a: 0.5, tau: 0.2 }, { f: 721, a: 0.3, tau: 0.12 }, { f: 1490, a: 0.15, tau: 0.08 }]), 0, 0.6);
      t.add(mulEnv(lp(noise(0.08), 2000), perc(0.0005, 0.02)), 0, 0.5);
      t.add(I.neonOn([[0, 0.03]], null, 0.4), 0.02, 1, 0.4);
    },
    drumroll: (t) => {
      const dur = 3;
      let at = 0;
      while (at < dur - 0.2) {
        const bpm = 70 + 80 * (at / dur) ** 1.3;
        t.add(I.heartbeat(0.9), at);
        at += 60 / bpm;
      }
      t.add(fade(I.riser(dur, 0.6), 0, 0.006), 0, 1);
    },
    reveal: (t) => {
      const swell = buf(0.6);
      [74, 77, 81, 88].forEach((n) => mix(swell, I.vibraphone(n, { vel: 0.5, motor: 0 }), 0));
      t.add(I_reverseFrom(swell, 0.6), 0, 0.8, -0.2);
      [74, 77, 81, 88].forEach((n, i) => t.add(I.vibraphone(n, { vel: 0.55 }), 0.6 + i * 0.015, 1, -0.3 + i * 0.2));
      t.add(I.glass(3100, 0.4), 0.6, 1, 0.4);
    },
    jackpot: (t) => {
      [0, 0.12, 0.25, 0.4].forEach((at, i) => t.add(I.neonOn([[at, at + 0.03], [at + 0.06, at + 0.08]], at + 0.1, 0.18), 0, 1, -0.6 + i * 0.4));
      t.add(I.sub(1.5, 60, 36, 0.9), 0.45);
      const chordPad = I.pad([50, 57, 64, 66, 73], 2.4, { vel: 0.5, cutoff: 2200, attack: 0.05 });
      mulEnv(chordPad, (x) => (x < 0.45 ? 0 : 0.35 + 0.65 * ((x - 0.45) % 0.5) / 0.5));
      t.add(chordPad, 0, 1);
      [62, 66, 69, 73, 74, 78].forEach((n, i) => t.add(I.rhodes(n, 0.3, 0.5), 0.45 + i * 0.12, 0.6, -0.4 + i * 0.16));
      [0.5, 0.9, 1.3].forEach((at, i) => t.add(I.glass(2500 + i * 180, 0.6), at, 1, i - 1));
    },
  },
};

function I_reverseFrom(x: Float32Array, dur: number) {
  return reverse(x.subarray(0, Math.min(x.length, Math.round(dur * SR))));
}

// --- 5. Fièvre 78 tours ----------------------------------------------------------------------

const fievre: Palette = {
  tail: 0.6,
  post: (t) => reverb(gramophone(t, { wow: 0.006, crackleLevel: 0.9 }), { room: 0.5, damp: 0.5, wet: 0.12 }),
  cues: {
    join: (t) => {
      t.add(I.needleDrop(0.8), 0);
      t.add(crackle(0.6, 25, 1.4), 0, 0.6);
      [88, 91, 96].forEach((n, i) => t.add(I.musicBox(n, 0.7), 0.12 + i * 0.15));
    },
    phase: (t) => {
      t.add(I.clickTrain(0.4, () => 14, () => I.metalClick(0.5, 2200)), 0);
      const lick = I.ragtimeLick(0.75);
      t.add(I.scratch(lick, [[0, 0.12], [0.75, 1], [1.8, 1]], 1.9), 0.35, 1.2);
    },
    question: (t) => t.add(I.theremin([[0, 62], [0.35, 69], [0.55, 67], [0.95, 74]], 1.2, { vel: 0.7 }), 0),
    buzz: (t) => {
      const src = I.brassChord([58, 62, 65, 68], 0.6, { vel: 1 });
      t.add(I.scratch(src, [[0, 2.6], [0.06, 2.6], [0.065, -2.6], [0.13, -2.6], [0.135, 3], [0.22, 3], [0.23, 0]], 0.3), 0, 1.4);
    },
    tick: (t) => {
      t.add(I.needleDrop(0.5), 0);
      t.add(crackle(0.1, 60, 1.2), 0, 0.6);
    },
    correct: (t) => {
      const lick = I.ragtimeLick(0.75);
      t.add(I.scratch(lick, [[0, 1.7], [1, 1.7]], 0.7), 0, 1.1);
      t.add(I.kazoo(72, 0.1), 0.62, 0.8);
      t.add(I.kazoo(79, 0.35), 0.75, 0.8);
    },
    wrong: (t) => {
      const src = buf(1.4);
      [60, 64, 67, 72].forEach((n) => mix(src, I.calliope(n, 1.2, 0.6), 0, 0.5));
      t.add(I.tapeStop(src, 1.0, 0.0), 0, 1.3);
    },
    flip: (t) => {
      const note = I.piano(72, 0.5, { vel: 0.7 });
      t.add(I_reverseFrom(note, 0.45), 0, 1);
      t.add(crackle(0.1, 80, 1.5), 0.42, 0.7);
    },
    chip: (t) => {
      t.add(I.musicBox(93, 0.7), 0);
      t.add(I.musicBox(88, 0.5), 0.07);
    },
    lock: (t) => {
      const src = I.ragtimeLick(0.7);
      t.add(I.scratch(src, [[0, 1], [0.04, -3], [0.1, -3], [0.11, 0]], 0.14), 0, 1.2);
      t.add(I.needleDrop(1), 0.18);
      t.add(I.thunk(0.6, 120), 0.2);
    },
    drumroll: (t) => {
      const dur = 2.8;
      t.add(I.clickTrain(dur, (x) => 4 + 22 * (x / dur) ** 1.5, () => I.metalClick(0.4, 2000)), 0, 1);
      t.add(I.theremin([[0, 62], [dur, 86]], dur, { vel: 0.5, vibrato: 0.02 }), 0, 1);
      for (let i = 0; i < 18; i++) t.add(I.musicBox(84 + (i % 6) * 2, 0.25), (dur * i) / 18, 1);
      t.add(I.sproing(0.8, 700, 160, 0.6), dur);
    },
    reveal: (t) => {
      t.add(I.choir([62, 66, 69, 74], 1.3, 0.8), 0, 1);
      t.add(I.theremin([[0, 74], [0.4, 81], [1.3, 81]], 1.5, { vel: 0.4 }), 0.15, 1);
    },
    jackpot: (t) => {
      const fan: Array<[number, number, number]> = [[72, 0, 0.1], [76, 0.11, 0.1], [79, 0.22, 0.1], [84, 0.33, 0.1], [79, 0.44, 0.1], [84, 0.55, 0.1], [88, 0.66, 0.8]];
      for (const [n, at, d] of fan) {
        t.add(I.calliope(n, d, 0.8), at, 1);
        t.add(I.calliope(n - 12, d, 0.4), at, 1);
      }
      [60, 64, 67].forEach((n) => t.add(I.calliope(n, 0.8, 0.5), 0.66, 0.8));
      t.add(I.slideWhistle(0.5, 72, 96, 0.5), 1.1, 1);
      t.add(I.kick(0.8), 0.66);
      t.add(hp(I.crash(0.7), 1500), 0.66, 1);
    },
  },
};

export const DESIGNS: Record<PaletteId, Palette> = { salon, jazz, machine, noir, fievre };
