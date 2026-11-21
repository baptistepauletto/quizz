// "Riviera 1925": a 32-bar minor swing (AABA) rendered as five stems that share tempo and
// key, so the game can fade layers in and out per phase without ever losing the beat.
import { MUSIC, type StemId } from '../../src/shared/soundbank';
import { SR, Track, db, jit, mulEnv, rand, reseed, reverb, rr, samples, scale, type ReverbOpts } from './dsp';
import * as I from './instruments';

const BEAT = 60 / MUSIC.bpm;
const LOOP = MUSIC.loop;

/** Beat positions use .5 for a swung off-beat (played at the triplet's last third). */
const swing = (b: number) => {
  const whole = Math.floor(b);
  const frac = b - whole;
  return whole + (Math.abs(frac - 0.5) < 1e-6 ? 2 / 3 : frac);
};
const time = (bar: number, beat: number) => (bar * 4 + swing(beat)) * BEAT;

interface Chord {
  root: number;
  tones: number[];
  voicing: number[];
}

const CHORDS: Record<string, Chord> = {
  Dm6: { root: 2, tones: [2, 5, 9, 11], voicing: [53, 57, 59, 62] },
  Gm6: { root: 7, tones: [7, 10, 2, 4], voicing: [58, 62, 64, 67] },
  A7: { root: 9, tones: [9, 1, 4, 7], voicing: [55, 61, 64, 69] },
  Bb7: { root: 10, tones: [10, 2, 5, 8], voicing: [56, 62, 65, 70] },
  F6: { root: 5, tones: [5, 9, 0, 2], voicing: [57, 60, 62, 65] },
  C7: { root: 0, tones: [0, 4, 7, 10], voicing: [58, 60, 64, 67] },
  D7: { root: 2, tones: [2, 6, 9, 0], voicing: [54, 60, 62, 66] },
};

const A_SECTION = [['Dm6'], ['Dm6'], ['Gm6'], ['A7'], ['Dm6'], ['Bb7'], ['A7'], ['Dm6', 'A7']];
const B_SECTION = [['F6'], ['F6'], ['C7'], ['C7'], ['F6'], ['D7'], ['Gm6'], ['A7']];
const FORM = [...A_SECTION, ...A_SECTION, ...B_SECTION, ...A_SECTION];

interface Segment {
  chord: Chord;
  bar: number;
  beat: number;
  beats: number;
}

const SEGMENTS: Segment[] = FORM.flatMap((names, bar) =>
  names.map((name, i) => ({ chord: CHORDS[name], bar, beat: (i * 4) / names.length, beats: 4 / names.length })),
);

function chordAt(bar: number, beat: number): Chord {
  const segs = SEGMENTS.filter((s) => s.bar === bar);
  return [...segs].reverse().find((s) => beat >= s.beat)!.chord;
}

// [midi, beat, beats] within an 8-bar section (beats 0–31).
const MELODY_A: Array<[number, number, number]> = [
  [69, 0, 1], [71, 1, 0.5], [69, 1.5, 0.5], [65, 2, 1], [62, 3, 1],
  [64, 4, 0.5], [65, 4.5, 0.5], [69, 5, 1.5], [74, 7, 1],
  [74, 8, 1], [70, 9, 0.5], [67, 9.5, 0.5], [64, 10, 1.5], [67, 11.5, 0.5],
  [73, 12, 1], [70, 13, 0.5], [69, 13.5, 0.5], [67, 14, 1], [64, 15, 1],
  [65, 16, 0.5], [64, 16.5, 0.5], [62, 17, 0.5], [65, 17.5, 0.5], [69, 18, 1], [74, 19, 1],
  [77, 20, 1.5], [74, 21.5, 0.5], [68, 22, 1], [65, 23, 1],
  [64, 24, 0.5], [67, 24.5, 0.5], [70, 25, 0.5], [73, 25.5, 0.5], [76, 26, 1], [73, 27, 0.5], [69, 27.5, 0.5],
  [74, 28, 2.5],
];

const MELODY_B: Array<[number, number, number]> = [
  [72, 0, 1], [69, 1, 0.5], [72, 1.5, 0.5], [74, 2, 1.5], [72, 3.5, 0.5],
  [69, 4, 2], [65, 6, 0.5], [67, 6.5, 0.5], [69, 7, 1],
  [70, 8, 1], [67, 9, 0.5], [64, 9.5, 0.5], [60, 10, 1], [64, 11, 1],
  [67, 12, 0.5], [70, 12.5, 0.5], [74, 13, 0.5], [76, 13.5, 0.5], [72, 14, 2],
  [69, 16, 1], [72, 17, 0.5], [77, 17.5, 1.5], [76, 19, 0.5], [74, 19.5, 0.5],
  [66, 20, 1], [69, 21, 0.5], [72, 21.5, 0.5], [74, 22, 1], [72, 23, 1],
  [70, 24, 1], [67, 25, 0.5], [70, 25.5, 0.5], [74, 26, 1], [76, 27, 1],
  [73, 28, 0.5], [76, 28.5, 0.5], [79, 29, 0.5], [76, 29.5, 0.5], [73, 30, 1], [69, 31, 1],
];

// --- stems -----------------------------------------------------------------------------

function nearest(pcs: number[], ref: number, avoid?: number, lo = 31, hi = 50) {
  let best = lo;
  let bestD = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (!pcs.includes(m % 12) || m === avoid) continue;
    const d = Math.abs(m - ref);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

function bass(t: Track) {
  const first = nearest([SEGMENTS[0].chord.root], 38);
  let prev = first;
  SEGMENTS.forEach((seg, i) => {
    const last = i === SEGMENTS.length - 1;
    const next = SEGMENTS[(i + 1) % SEGMENTS.length];
    const root = nearest([seg.chord.root], prev);
    const target = last ? first : nearest([next.chord.root], root);
    const dir = Math.sign(target - root) || (rand() < 0.5 ? 1 : -1);
    const others = seg.chord.tones.filter((pc) => pc !== seg.chord.root);
    const approach = (from: number) => target + (from < target ? -1 : 1);
    let line: number[];
    if (seg.beats === 4) {
      const b1 = nearest(others, root + dir * 4, root);
      const b2 = nearest(seg.chord.tones, b1 + dir * 3, b1);
      line = [root, b1, b2, approach(b2)];
    } else line = [root, approach(root)];
    line.forEach((n, k) => {
      const at = time(seg.bar, seg.beat + k);
      t.add(I.upright(n, BEAT * 0.92, jit(0.85, 0.08)), at + rr(-0.004, 0.004));
      if (seg.beats === 4 && k === 3 && rand() < 0.22) t.add(I.upright(n, BEAT * 0.2, 0.25), time(seg.bar, seg.beat + 2.5));
    });
    prev = line[line.length - 1];
  });
}

function drums(t: Track) {
  const rides = [I.ride(1), I.ride(1), I.ride(1)];
  const slaps = [I.brushSlap(1), I.brushSlap(1), I.brushSlap(1)];
  const chick = I.hat(1, 0.02);
  const feather = I.kick(1, { f0: 90, f1: 45, tau: 0.12 });
  const sweepLen = LOOP + 4;
  const sweep = I.brushSweep(sweepLen, 1);
  mulEnv(sweep, (s) => {
    const beat = (s / BEAT) % 1;
    return 0.25 + 0.75 * Math.sin(Math.PI * beat) ** 2;
  });
  t.add(sweep, 0, 0.1, -0.2);
  for (let bar = 0; bar < MUSIC.bars; bar++) {
    const rideHits: Array<[number, number]> = [[0, 0.65], [1, 0.85], [1.5, 0.45], [2, 0.65], [3, 0.85], [3.5, 0.45]];
    for (const [b, v] of rideHits) t.add(rides[Math.floor(rand() * 3)], time(bar, b) + rr(-0.004, 0.004), jit(v, 0.1) * 0.55, 0.35);
    for (const b of [1, 3]) {
      t.add(slaps[Math.floor(rand() * 3)], time(bar, b) + rr(-0.005, 0.005), jit(0.5, 0.1), -0.15);
      t.add(chick, time(bar, b), 0.22, 0.25);
    }
    for (let b = 0; b < 4; b++) t.add(feather, time(bar, b), 0.22);
    if (bar % 8 === 7) [3, 3 + 1 / 3, 3 + 2 / 3].forEach((b, i) => t.add(slaps[i], bar * 4 * BEAT + b * BEAT, 0.35 + i * 0.12, -0.15));
  }
  t.add(I.crash(1, 1.4), time(16, 0), 0.25, 0.4);
}

function piano(t: Track) {
  const patterns: Array<Array<[number, number]>> = [
    [[1, 0.18], [3, 0.18]],
    [[0, 0.32], [1.5, 0.16]],
    [[1, 0.18], [2.5, 0.42]],
    [[1, 0.18], [3, 0.16], [3.5, 0.3]],
  ];
  for (let bar = 0; bar < MUSIC.bars; bar++) {
    const split = FORM[bar].length > 1;
    const pattern = split ? [[1, 0.18], [3, 0.18]] as Array<[number, number]> : patterns[Math.floor(rand() * patterns.length)];
    for (const [b, hold] of pattern) {
      const pushed = b >= 3.5;
      const chord = pushed ? chordAt((bar + 1) % MUSIC.bars, 0) : chordAt(bar, b);
      const notes = rand() < 0.3 ? [...chord.voicing.slice(1), chord.voicing[0] + 12] : chord.voicing;
      t.add(I.chord(notes, hold, { vel: jit(0.5, 0.08), roll: 0.006, detune: 3 }), time(bar, b) + rr(-0.006, 0.006), 0.9, 0.1);
    }
  }
}

function lead(t: Track) {
  const sections = [MELODY_A, MELODY_A, MELODY_B, MELODY_A];
  sections.forEach((melody, s) => {
    for (const [n, b, d] of melody) {
      const bar = s * 8 + Math.floor(b / 4);
      const start = time(bar, b % 4);
      const end = (s * 32 + swing(b + d)) * BEAT;
      t.add(I.clarinet(n, Math.max(0.08, end - start - 0.03), { vel: jit(0.65, 0.06) }), start, 1, -0.1);
    }
  });
}

function tension(t: Track) {
  for (const seg of SEGMENTS) {
    const at = time(seg.bar, seg.beat);
    const dur = seg.beats * BEAT;
    const top = seg.chord.voicing.slice(1).map((n) => n + 12);
    t.add(I.tremoloStrings(top, dur - 0.02, { vel: 0.4, rate: 8, cutoff: 2600 }), at, 1, 0.2);
    const low = nearest([seg.chord.root], 38);
    t.add(I.chord([low - 12, low], dur * 0.9, { vel: 0.5 }), at, 0.9, -0.2);
  }
  const ticks = [I.metalClick(1, 2600), I.metalClick(1, 2150)];
  for (let bar = 0; bar < MUSIC.bars; bar++) {
    for (const b of [0, 2]) t.add(I.heartbeat(1), time(bar, b), 0.7);
    for (let b = 0; b < 4; b++) t.add(ticks[b % 2], time(bar, b), 0.12, 0.4);
    if (bar % 8 === 7) t.add(I.reverseCymbal(2, 1), time(bar + 1, 0) - 2, 0.25, 0.3);
  }
}

// --- render ------------------------------------------------------------------------------

const STEM_DESIGN: Record<StemId, { render: (t: Track) => void; gain: number; verb: ReverbOpts }> = {
  bass: { render: bass, gain: 1, verb: { room: 0.4, wet: 0.06, damp: 0.6, lowcut: 80 } },
  drums: { render: drums, gain: 1.3, verb: { room: 0.55, wet: 0.12, damp: 0.5 } },
  piano: { render: piano, gain: 1.05, verb: { room: 0.65, wet: 0.18, damp: 0.5 } },
  lead: { render: lead, gain: 0.33, verb: { room: 0.75, wet: 0.24, damp: 0.45, predelay: 0.02 } },
  tension: { render: tension, gain: 1.1, verb: { room: 0.8, wet: 0.26, damp: 0.55 } },
};

/** Folds everything rendered past the loop end back onto its start, so the loop is seamless. */
function wrap(t: Track) {
  const n = samples(LOOP);
  const out = new Track(LOOP);
  out.L.set(t.L.subarray(0, n));
  out.R.set(t.R.subarray(0, n));
  for (let i = n; i < t.length; i++) {
    out.L[(i - n) % n] += t.L[i];
    out.R[(i - n) % n] += t.R[i];
  }
  return out;
}

export function renderStems(): Record<StemId, Track> {
  const stems = {} as Record<StemId, Track>;
  (Object.keys(STEM_DESIGN) as StemId[]).forEach((id, i) => {
    reseed(1925 + i * 77);
    const design = STEM_DESIGN[id];
    const t = new Track(LOOP + 5);
    design.render(t);
    reverb(t, design.verb);
    stems[id] = wrap(t).map((ch) => scale(ch, design.gain));
  });
  const sum = new Track(LOOP);
  for (const s of Object.values(stems)) sum.addTrack(s);
  let p = 0;
  for (let i = 0; i < sum.length; i++) p = Math.max(p, Math.abs(sum.L[i]), Math.abs(sum.R[i]));
  const g = db(-2) / p;
  for (const s of Object.values(stems)) s.map((ch) => scale(ch, g));
  return stems;
}

/** The loop with `pad` seconds of its own end before it and its own start after it. */
export function padLoop(t: Track, pad: number) {
  const n = t.length;
  const p = samples(pad);
  const out = new Track((n + 2 * p) / SR);
  for (let i = 0; i < out.length; i++) {
    const src = (((i - p) % n) + n) % n;
    out.L[i] = t.L[src];
    out.R[i] = t.R[src];
  }
  return out;
}