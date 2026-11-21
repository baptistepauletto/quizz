import { MUSIC, PHASE_MIX, STEMS, stemUrl, type StemId } from '../../shared/soundbank';
import type { Phase } from '../../shared/types';

// Plays the rendered sound bank (public/audio) through Web Audio:
//   master ─┬─ sfx bus
//           └─ duck ── music bus ── one gain per stem
// Stems start together and loop over the same window, so any phase mix stays on the beat.

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  duck: GainNode;
}

let graph: Graph | null = null;

export function audio(): Graph {
  if (!graph) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    const duck = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 4;
    sfx.connect(master);
    music.connect(duck).connect(master);
    master.connect(comp).connect(ctx.destination);
    sfx.gain.value = 0.9;
    music.gain.value = 0.15;
    graph = { ctx, master, sfx, music, duck };
  }
  return graph;
}

export async function resumeAudio() {
  const { ctx } = audio();
  if (ctx.state !== 'running') await ctx.resume();
}

const buffers = new Map<string, Promise<AudioBuffer>>();

export function loadBuffer(url: string): Promise<AudioBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => audio().ctx.decodeAudioData(b));
    buffers.set(url, p);
  }
  return p;
}

export function setVolume(bus: 'sfx' | 'music', v: number) {
  const g = audio()[bus].gain;
  g.setTargetAtTime(v, audio().ctx.currentTime, 0.05);
}

let duckDepth = 0.5;
export function setDuckDepth(v: number) {
  duckDepth = v;
}

/** Lowers the music while a sound effect plays, then lets it back up. */
function duckFor(seconds: number) {
  if (duckDepth >= 1) return;
  const { ctx, duck } = audio();
  const now = ctx.currentTime;
  duck.gain.cancelScheduledValues(now);
  duck.gain.setTargetAtTime(duckDepth, now, 0.03);
  duck.gain.setTargetAtTime(1, now + Math.min(seconds, 1.5), 0.35);
}

export async function playSample(url: string, { gain = 1, duck = true } = {}): Promise<number> {
  const buffer = await loadBuffer(url);
  const { ctx, sfx } = audio();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(sfx);
  src.start();
  if (duck) duckFor(buffer.duration);
  return buffer.duration;
}

// --- adaptive music -------------------------------------------------------------------------

export class MusicPlayer {
  private voices = new Map<StemId, { src: AudioBufferSourceNode; gain: GainNode }>();
  private startedAt = 0;
  private phase: Phase = 'lobby';
  private muted = new Set<StemId>();
  private listeners = new Set<() => void>();

  get playing() {
    return this.voices.size > 0;
  }
  get currentPhase() {
    return this.phase;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  preload() {
    return Promise.all(STEMS.map((s) => loadBuffer(stemUrl(s.id))));
  }

  async start(phase: Phase = this.phase, fadeIn = 1.5) {
    if (this.playing) return this.setPhase(phase);
    const decoded = await this.preload();
    if (this.playing) return this.setPhase(phase);
    const { ctx, music } = audio();
    const at = ctx.currentTime + 0.08;
    this.phase = phase;
    STEMS.forEach((stem, i) => {
      const src = ctx.createBufferSource();
      src.buffer = decoded[i];
      src.loop = true;
      src.loopStart = MUSIC.pad;
      src.loopEnd = MUSIC.pad + MUSIC.loop;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(this.target(stem.id), at + fadeIn);
      src.connect(gain).connect(music);
      src.start(at, MUSIC.pad);
      this.voices.set(stem.id, { src, gain });
    });
    this.startedAt = at;
    this.emit();
  }

  private target(stem: StemId) {
    return this.muted.has(stem) ? 0 : PHASE_MIX[this.phase][stem];
  }

  /** Crossfades to the phase's mix. Stems never stop, so the groove carries across. */
  setPhase(phase: Phase, fade = 2.2) {
    this.phase = phase;
    this.apply(fade);
    this.emit();
  }

  setMuted(stem: StemId, muted: boolean) {
    if (muted) this.muted.add(stem);
    else this.muted.delete(stem);
    this.apply(0.3);
    this.emit();
  }
  isMuted(stem: StemId) {
    return this.muted.has(stem);
  }
  level(stem: StemId) {
    return this.target(stem);
  }

  private apply(fade: number) {
    const { ctx } = audio();
    for (const [id, v] of this.voices) {
      v.gain.gain.cancelScheduledValues(ctx.currentTime);
      v.gain.gain.setTargetAtTime(this.target(id), ctx.currentTime, fade / 3);
    }
  }

  stop(fade = 1.2) {
    const { ctx } = audio();
    for (const v of this.voices.values()) {
      v.gain.gain.cancelScheduledValues(ctx.currentTime);
      v.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      v.src.stop(ctx.currentTime + fade + 0.2);
    }
    this.voices.clear();
    this.emit();
  }

  /** Seconds into the loop, for display. */
  position() {
    if (!this.playing) return 0;
    const t = audio().ctx.currentTime - this.startedAt;
    return ((t % MUSIC.loop) + MUSIC.loop) % MUSIC.loop;
  }
}
