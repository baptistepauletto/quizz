// Renders the sound bank into public/audio.
//   npm run sounds                 everything
//   npm run sounds -- sfx noir     one palette (or several)
//   npm run sounds -- music        just the score
import os from 'node:os';
import path from 'node:path';
import { CUES, MUSIC, PALETTES, STEMS, type PaletteId } from '../../src/shared/soundbank';
import { SR, Track, loudness, master, peak, reseed, trim, writeMp3 } from './dsp';
import { padLoop, renderStems } from './music';
import { CUE_LEVELS, CUE_MAX, DESIGNS } from './palettes';
import { writeSpectrogram } from './spectro';

const OUT = path.resolve('public/audio');
const args = process.argv.slice(2);
/** `--png` also writes spectrograms to a temp folder for a visual check. */
const PNG = args.includes('--png') ? path.join(os.tmpdir(), 'quizzin-spectro') : null;
const all = !args.includes('sfx') && !args.includes('music');
const doSfx = all || args.includes('sfx');
const doMusic = all || args.includes('music');
const only = PALETTES.map((p) => p.id).filter((id) => args.includes(id));
const palettes: PaletteId[] = only.length ? only : PALETTES.map((p) => p.id);

function extend(t: Track, sec: number) {
  const out = new Track(t.length / SR + sec);
  out.L.set(t.L);
  out.R.set(t.R);
  return out;
}

/** Cuts the track at `max` seconds with a half-second fade. */
function cap(t: Track, max: number) {
  const n = Math.round(max * SR);
  if (t.length <= n) return;
  const f = Math.round(0.5 * SR);
  t.map((ch) => {
    const out = ch.slice(0, n);
    for (let i = 0; i < f; i++) out[n - 1 - i] *= (i / f) ** 2;
    return out;
  });
}

const fmt = (x: number) => x.toFixed(1).padStart(6);

if (doSfx) {
  for (const id of palettes) {
    const design = DESIGNS[id];
    console.log(`\n${id}`);
    CUES.forEach((cue, i) => {
      const started = Date.now();
      reseed(id.length * 1000 + i * 31 + 7);
      let t = new Track(8);
      design.cues[cue.id](t);
      t = design.post(extend(trim(t, 60), design.tail));
      trim(t, 48);
      cap(t, CUE_MAX[cue.id]);
      master(t, CUE_LEVELS[cue.id]);
      writeMp3(path.join(OUT, 'sfx', id, `${cue.id}.mp3`), t, 160);
      if (PNG) writeSpectrogram(path.join(PNG, id, `${cue.id}.png`), t);
      console.log(`  ${cue.id.padEnd(9)} ${(t.length / SR).toFixed(2)}s  loud ${fmt(loudness(t))} dB  peak ${fmt(peak(t))} dB  (${Date.now() - started} ms)`);
    });
  }
}

if (doMusic) {
  console.log(`\nmusic: ${MUSIC.title}, ${MUSIC.bars} bars at ${MUSIC.bpm} bpm (${MUSIC.loop.toFixed(1)}s loop)`);
  const started = Date.now();
  const stems = renderStems();
  for (const { id } of STEMS) {
    const t = padLoop(stems[id], MUSIC.pad);
    writeMp3(path.join(OUT, 'music', `${id}.mp3`), t, 192);
    console.log(`  ${id.padEnd(8)} loud ${fmt(loudness(stems[id]))} dB  peak ${fmt(peak(stems[id]))} dB`);
  }
  console.log(`  rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (PNG) {
    const lobby = new Track(MUSIC.loop);
    for (const id of ['bass', 'drums', 'piano', 'lead'] as const) lobby.addTrack(stems[id]);
    writeSpectrogram(path.join(PNG, 'music-lobby.png'), lobby, 24);
    writeSpectrogram(path.join(PNG, 'music-tension.png'), stems.tension, 24);
  }
}
