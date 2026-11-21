import { CUES, sfxUrl, type CueId, type PaletteId } from '../../shared/soundbank';
import type { GameEvent, Phase } from '../../shared/types';
import { MusicPlayer, audio, loadBuffer, playSample } from './audioEngine';

// The TV's sound: Orchestre 1925 cues and the "Riviera 1925" score, both rendered into
// public/audio by `npm run sounds`. Browsers keep audio locked until the page gets a key
// press or a tap: the TV shows a hint until `unlockAudio()` has run once.

const PALETTE: PaletteId = 'jazz';
const MUTE_KEY = 'quizzin.muted';
const MUSIC_KEY = 'quizzin.music';

let muted = localStorage.getItem(MUTE_KEY) === '1';
let musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
let phase: Phase = 'lobby';
let preloaded = false;
const music = new MusicPlayer();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function graph() {
  const g = audio();
  if (!g.ctx.onstatechange) {
    g.ctx.onstatechange = notify;
    g.master.gain.value = muted ? 0 : 1;
  }
  return g;
}

function preload() {
  if (preloaded) return;
  preloaded = true;
  for (const c of CUES) void loadBuffer(sfxUrl(PALETTE, c.id)).catch(() => undefined);
  void music.preload().catch(() => undefined);
}

export function unlockAudio(): void {
  const { ctx } = graph();
  preload();
  if (ctx.state !== 'running') {
    void ctx.resume().then(() => {
      if (musicOn) void music.start(phase);
      notify();
    });
  }
}

export function audioReady(): boolean {
  return graph().ctx.state === 'running';
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): void {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  const { ctx, master } = graph();
  master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  notify();
}

export function isMusicOn(): boolean {
  return musicOn;
}

/** Background music on/off, independent of the sound effects. */
export function toggleMusic(): void {
  musicOn = !musicOn;
  localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0');
  if (!musicOn) music.stop();
  else if (audioReady()) void music.start(phase);
  notify();
}

/** Follow the game phase: the score crossfades to that phase's mix. */
export function setMusicPhase(next: Phase): void {
  preload();
  if (next === phase) return;
  phase = next;
  if (music.playing) music.setPhase(next);
}

export function onAudioChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- cues -----------------------------------------------------------------------------

/** A cue is dropped if a higher-priority one started within this window (events often arrive together). */
const COVER_MS = 400;
const PRIORITY: Record<CueId, number> = {
  phase: 3,
  jackpot: 3,
  drumroll: 2,
  buzz: 2,
  correct: 2,
  wrong: 2,
  reveal: 2,
  lock: 2,
  question: 1,
  join: 1,
  flip: 1,
  chip: 1,
  tick: 0,
};
const lastPlayed = new Map<CueId, number>();

export function play(cue: CueId): void {
  if (muted || !audioReady()) return;
  const now = performance.now();
  for (const [other, at] of lastPlayed) {
    if (now - at > COVER_MS) continue;
    if (other === cue || PRIORITY[other] > PRIORITY[cue]) return;
  }
  lastPlayed.set(cue, now);
  void playSample(sfxUrl(PALETTE, cue)).catch(() => undefined);
}

/** Which cue a game event plays. Some depend on the payload (right vs wrong). */
export function sfxFor(event: GameEvent): CueId | null {
  const p = event.payload;
  switch (event.type) {
    case 'player.joined':
      return 'join';
    case 'phase.changed':
      return 'phase';
    case 'climax.announce':
    case 'sprint.question':
      return 'question';
    case 'sprint.buzz_won':
      return 'buzz';
    case 'sprint.answer_timeout':
    case 'memory.turn':
    case 'memory.hint':
      return 'tick';
    case 'sprint.pass':
      return 'wrong';
    case 'sprint.resolved':
      return p.correct ? 'correct' : 'reveal';
    case 'memory.flipped':
      return 'flip';
    case 'memory.leech_locked':
    case 'climax.betting_locked':
    case 'predictions.locked':
      return 'lock';
    case 'memory.consumed':
      return p.result === 'hit' ? 'correct' : 'wrong';
    case 'climax.betting_open':
    case 'climax.bet':
    case 'predictions.open':
    case 'predictions.pick':
      return 'chip';
    case 'climax.answers_locked':
      return 'drumroll';
    case 'climax.estimate_revealed':
      return p.closest ? 'correct' : 'reveal';
    case 'climax.judged':
      return p.correct ? 'correct' : 'wrong';
    case 'reveal.next':
      return 'reveal';
    case 'reveal.awarded':
    case 'climax.resolved':
      return 'jackpot';
    default:
      return null;
  }
}

/** Subscribe this to useGame's onEvent on the TV. */
export function playSfx(event: GameEvent): void {
  const cue = sfxFor(event);
  if (cue) play(cue);
}
