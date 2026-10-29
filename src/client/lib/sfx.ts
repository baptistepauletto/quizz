import type { GameEvent } from '../../shared/types';

// Every sound is synthesized with Web Audio, so there are no files to ship.
// Browsers keep audio locked until the page gets a key press or a tap: the TV
// shows a hint until `unlockAudio()` has run once.

export type SfxName =
  | 'join'
  | 'question'
  | 'buzz'
  | 'correct'
  | 'wrong'
  | 'tick'
  | 'flip'
  | 'reveal'
  | 'chip'
  | 'lock'
  | 'drumroll'
  | 'fanfare';

const MUTE_KEY = 'quizzin.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem(MUTE_KEY) === '1';
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    ctx.onstatechange = notify;
  }
  return ctx;
}

export function unlockAudio(): void {
  const c = audio();
  if (c && c.state !== 'running') void c.resume().then(notify);
}

export function audioReady(): boolean {
  return ctx?.state === 'running';
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): void {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : 0.6;
  notify();
}

export function onAudioChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- building blocks ---------------------------------------------------------

interface Tone {
  freq: number;
  to?: number;
  type?: OscillatorType;
  at?: number;
  dur: number;
  gain?: number;
}

function tone(c: AudioContext, { freq, to, type = 'sine', at = 0, dur, gain = 0.3 }: Tone) {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;

interface Noise {
  at?: number;
  dur: number;
  gain?: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
}

function noise(c: AudioContext, { at = 0, dur, gain = 0.3, freq = 2000, q = 1, type = 'bandpass' }: Noise) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = c.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(master!);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);

const SOUNDS: Record<SfxName, (c: AudioContext) => void> = {
  join: (c) => {
    tone(c, { freq: NOTE(76), dur: 0.12, type: 'triangle' });
    tone(c, { freq: NOTE(83), at: 0.08, dur: 0.18, type: 'triangle' });
  },
  question: (c) => {
    [67, 71, 74, 79].forEach((n, i) => tone(c, { freq: NOTE(n), at: i * 0.07, dur: 0.22, type: 'triangle', gain: 0.22 }));
  },
  buzz: (c) => {
    tone(c, { freq: 110, dur: 0.45, type: 'square', gain: 0.22 });
    tone(c, { freq: 116, dur: 0.45, type: 'sawtooth', gain: 0.14 });
  },
  correct: (c) => {
    [72, 76, 79, 84].forEach((n, i) => tone(c, { freq: NOTE(n), at: i * 0.08, dur: 0.5, type: 'triangle', gain: 0.25 }));
    tone(c, { freq: NOTE(96), at: 0.32, dur: 0.6, gain: 0.08 });
  },
  wrong: (c) => {
    tone(c, { freq: NOTE(58), to: NOTE(55), dur: 0.28, type: 'sawtooth', gain: 0.2 });
    tone(c, { freq: NOTE(53), to: NOTE(46), at: 0.26, dur: 0.5, type: 'sawtooth', gain: 0.2 });
  },
  tick: (c) => tone(c, { freq: 1800, dur: 0.04, type: 'square', gain: 0.06 }),
  flip: (c) => noise(c, { dur: 0.18, freq: 3000, q: 0.7, gain: 0.25 }),
  reveal: (c) => {
    [84, 88, 91].forEach((n, i) => tone(c, { freq: NOTE(n), at: i * 0.05, dur: 0.7, gain: 0.09 }));
    noise(c, { dur: 0.4, freq: 8000, q: 0.5, gain: 0.08, type: 'highpass' });
  },
  chip: (c) => {
    [0, 0.06, 0.1].forEach((at) => {
      noise(c, { at, dur: 0.05, freq: 4200, q: 4, gain: 0.35 });
      tone(c, { freq: 2600, at, dur: 0.04, type: 'triangle', gain: 0.08 });
    });
  },
  lock: (c) => {
    tone(c, { freq: 160, to: 60, dur: 0.25, type: 'sine', gain: 0.5 });
    noise(c, { dur: 0.08, freq: 900, gain: 0.3 });
  },
  drumroll: (c) => {
    for (let i = 0; i < 36; i++) noise(c, { at: i * 0.045, dur: 0.06, freq: 260, q: 0.8, gain: 0.08 + (i / 36) * 0.25 });
    noise(c, { at: 1.65, dur: 0.6, freq: 6000, q: 0.4, gain: 0.3, type: 'highpass' });
    tone(c, { freq: 70, at: 1.65, dur: 0.5, gain: 0.5 });
  },
  fanfare: (c) => {
    const seq: Array<[number, number, number]> = [
      [67, 0, 0.14],
      [67, 0.15, 0.14],
      [67, 0.3, 0.14],
      [72, 0.45, 0.7],
    ];
    for (const [n, at, dur] of seq) {
      tone(c, { freq: NOTE(n), at, dur, type: 'sawtooth', gain: 0.12 });
      tone(c, { freq: NOTE(n + 7), at, dur, type: 'triangle', gain: 0.1 });
    }
  },
};

export function play(name: SfxName): void {
  const c = audio();
  if (!c || c.state !== 'running' || muted) return;
  SOUNDS[name](c);
}

/** Which sound a game event makes. Some depend on the payload (right vs wrong). */
export function sfxFor(event: GameEvent): SfxName | null {
  const p = event.payload;
  switch (event.type) {
    case 'player.joined':
      return 'join';
    case 'phase.changed':
    case 'climax.announce':
    case 'climax.resolved':
      return 'fanfare';
    case 'sprint.question':
      return 'question';
    case 'sprint.buzz_won':
      return 'buzz';
    case 'sprint.pass':
      return 'wrong';
    case 'sprint.resolved':
      return p.correct ? 'correct' : 'reveal';
    case 'memory.started':
      return 'reveal';
    case 'memory.flipped':
      return 'flip';
    case 'memory.leech_locked':
      return 'lock';
    case 'memory.hint':
      return 'tick';
    case 'memory.consumed':
      return p.result === 'hit' ? 'correct' : 'wrong';
    case 'memory.turn':
      return 'tick';
    case 'climax.betting_open':
    case 'climax.bet':
    case 'predictions.open':
    case 'predictions.pick':
      return 'chip';
    case 'climax.betting_locked':
    case 'predictions.locked':
      return 'lock';
    case 'climax.answers_locked':
      return 'drumroll';
    case 'climax.judged':
      return p.correct ? 'correct' : 'wrong';
    case 'reveal.next':
      return 'reveal';
    case 'reveal.awarded':
      return 'fanfare';
    default:
      return null;
  }
}

/** Subscribe this to useGame's onEvent on the TV. */
export function playSfx(event: GameEvent): void {
  const name = sfxFor(event);
  if (name) play(name);
}
