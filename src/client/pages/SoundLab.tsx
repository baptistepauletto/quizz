import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { MusicPlayer, loadBuffer, playSample, resumeAudio, setDuckDepth, setVolume } from '../lib/audioEngine';
import { CUES, MUSIC, PALETTES, PHASE_LABELS, PHASE_MIX, STEMS, sfxUrl, type CueId, type PaletteId } from '../../shared/soundbank';
import type { Phase } from '../../shared/types';

interface Step {
  at: number;
  caption: string;
  cue?: CueId;
  phase?: Phase;
}

interface Scene {
  id: string;
  title: string;
  steps: Step[];
  length: number;
}

const SCENES: Scene[] = [
  {
    id: 'lobby',
    title: 'Le salon ouvre',
    length: 8,
    steps: [
      { at: 0, phase: 'lobby', caption: 'La TV affiche le QR code, la musique du salon tourne.' },
      { at: 2.5, cue: 'join', caption: 'Alice rejoint depuis son téléphone.' },
      { at: 4.2, cue: 'join', caption: 'Bob rejoint.' },
      { at: 5.6, cue: 'join', caption: 'Chloé rejoint.' },
    ],
  },
  {
    id: 'predictions',
    title: 'Pronostics',
    length: 9,
    steps: [
      { at: 0, phase: 'predictions', cue: 'phase', caption: 'Carte « Pronostics » : chacun parie sur le gagnant de la soirée.' },
      { at: 3.8, cue: 'chip', caption: 'Alice valide son pronostic.' },
      { at: 4.7, cue: 'chip', caption: 'Bob aussi.' },
      { at: 5.4, cue: 'chip', caption: 'Chloé aussi.' },
      { at: 7, cue: 'lock', caption: 'Pronostics verrouillés.' },
    ],
  },
  {
    id: 'sprint',
    title: 'Sprint au buzzer',
    length: 22,
    steps: [
      { at: 0, phase: 'sprint', cue: 'phase', caption: 'Carte « Sprint ».' },
      { at: 3.8, cue: 'question', caption: 'Question 1 : « Dans quelle ville se court le Grand Prix le plus lent du calendrier ? »' },
      { at: 6.6, cue: 'buzz', caption: 'Bob buzze le premier.' },
      { at: 8.1, cue: 'tick', caption: 'Son temps de réponse file…' },
      { at: 9.1, cue: 'tick', caption: 'Son temps de réponse file…' },
      { at: 10.1, cue: 'tick', caption: 'Son temps de réponse file…' },
      { at: 10.9, cue: 'correct', caption: '« Monaco ! » Validé, les points tombent.' },
      { at: 14, cue: 'question', caption: 'Question 2.' },
      { at: 16, cue: 'buzz', caption: 'Chloé buzze.' },
      { at: 17.6, cue: 'wrong', caption: 'Raté : elle passe.' },
      { at: 19.8, cue: 'reveal', caption: 'Personne ne trouve : la réponse est dévoilée.' },
    ],
  },
  {
    id: 'memory',
    title: 'Mémoire',
    length: 17,
    steps: [
      { at: 0, phase: 'memory', cue: 'phase', caption: 'Carte « Mémoire » : le plateau s’ouvre.' },
      { at: 3.8, cue: 'tick', caption: 'Au tour d’Alice.' },
      { at: 5, cue: 'flip', caption: 'Elle ouvre une case « Cinéma ».' },
      { at: 8.4, cue: 'correct', caption: 'Bonne réponse.' },
      { at: 11, cue: 'tick', caption: 'Au tour de Bob.' },
      { at: 12.1, cue: 'flip', caption: 'Il ouvre une case « Maison ».' },
      { at: 14.8, cue: 'wrong', caption: 'Raté.' },
    ],
  },
  {
    id: 'climax',
    title: 'Climax : tout miser',
    length: 27,
    steps: [
      { at: 0, phase: 'climax', cue: 'phase', caption: 'Carte « Climax » : thème annoncé.' },
      { at: 3.8, cue: 'chip', caption: 'Les mises sont ouvertes.' },
      { at: 4.6, cue: 'chip', caption: 'Alice mise gros.' },
      { at: 5.2, cue: 'chip', caption: 'Bob suit.' },
      { at: 5.9, cue: 'chip', caption: 'Chloé fait tapis.' },
      { at: 7.4, cue: 'lock', caption: 'Rien ne va plus : mises verrouillées, la question apparaît.' },
      { at: 9.5, cue: 'tick', caption: 'Les réponses arrivent…' },
      { at: 10.5, cue: 'tick', caption: 'Les réponses arrivent…' },
      { at: 11.5, cue: 'tick', caption: 'Les réponses arrivent…' },
      { at: 12.5, cue: 'drumroll', caption: 'Réponses verrouillées. Suspense…' },
      { at: 17.8, cue: 'reveal', caption: 'La bonne réponse est dévoilée.' },
      { at: 19.8, cue: 'correct', caption: 'Alice avait raison : sa mise est multipliée.' },
      { at: 21.8, cue: 'wrong', caption: 'Bob s’est trompé : il perd sa mise.' },
      { at: 23.8, cue: 'jackpot', caption: 'Les gains sont versés.' },
    ],
  },
  {
    id: 'results',
    title: 'Révélations & podium',
    length: 15,
    steps: [
      { at: 0, phase: 'reveal', cue: 'phase', caption: 'On révèle les pronostics du début de soirée.' },
      { at: 3.6, cue: 'reveal', caption: 'Alice avait parié sur… Chloé.' },
      { at: 6, cue: 'reveal', caption: 'Bob avait parié sur… Bob !' },
      { at: 8.6, phase: 'results', cue: 'jackpot', caption: 'Bonus versé, podium final.' },
    ],
  },
];

const FULL_NIGHT: Scene = (() => {
  const steps: Step[] = [];
  let offset = 0;
  for (const s of SCENES) {
    for (const st of s.steps) steps.push({ ...st, at: st.at + offset, caption: `${s.title} · ${st.caption}` });
    offset += s.length + 1;
  }
  return { id: 'night', title: 'Soirée complète en accéléré', steps, length: offset };
})();

const PHASES = Object.keys(PHASE_MIX) as Phase[];
const cueInfo = (id: CueId) => CUES.find((c) => c.id === id)!;

function useRerender(subscribe: (fn: () => void) => () => void) {
  const [, set] = useState(0);
  useEffect(() => subscribe(() => set((n) => n + 1)), [subscribe]);
}

export function SoundLab() {
  const [palette, setPalette] = useState<PaletteId>('salon');
  const [playing, setPlaying] = useState<string | null>(null);
  const [scene, setScene] = useState<{ scene: Scene; step: number; started: number } | null>(null);
  const [withMusic, setWithMusic] = useState(true);
  const [musicVol, setMusicVol] = useState(0.15);
  const [sfxVol, setSfxVol] = useState(0.9);
  const [duck, setDuck] = useState(true);
  const [, tick] = useState(0);
  const music = useMemo(() => new MusicPlayer(), []);
  const timers = useRef<number[]>([]);
  const timeline = useRef<HTMLOListElement>(null);
  useRerender(useMemo(() => (fn: () => void) => music.onChange(fn), [music]));

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => {
      clearInterval(id);
      music.stop(0.3);
      timers.current.forEach(clearTimeout);
    };
  }, [music]);

  useEffect(() => setVolume('music', musicVol), [musicVol]);
  useEffect(() => setVolume('sfx', sfxVol), [sfxVol]);
  useEffect(() => setDuckDepth(duck ? 0.5 : 1), [duck]);
  useEffect(() => {
    for (const c of CUES) void loadBuffer(sfxUrl(palette, c.id));
  }, [palette]);
  useEffect(() => {
    const list = timeline.current;
    const now = list?.querySelector<HTMLElement>('li.now');
    if (list && now) list.scrollTo({ top: now.offsetTop - list.clientHeight / 2, behavior: 'smooth' });
  }, [scene?.step]);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const clearSchedule = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setScene(null);
    setPlaying(null);
  };

  async function play(p: PaletteId, c: CueId) {
    await resumeAudio();
    const key = `${p}:${c}`;
    setPlaying(key);
    const d = await playSample(sfxUrl(p, c));
    later(d * 1000, () => setPlaying((k) => (k === key ? null : k)));
  }

  /** Plays a list of (palette, cue) one after another, each given up to `max` seconds. */
  async function sequence(items: Array<[PaletteId, CueId]>, max = 3, gap = 0.45) {
    clearSchedule();
    await resumeAudio();
    const durations = await Promise.all(items.map(([p, c]) => loadBuffer(sfxUrl(p, c)).then((b) => b.duration)));
    let at = 0;
    items.forEach(([p, c], i) => {
      later(at * 1000, () => void play(p, c));
      at += Math.min(max, durations[i]) + gap;
    });
  }

  async function runScene(s: Scene) {
    clearSchedule();
    await resumeAudio();
    await Promise.all(s.steps.filter((st) => st.cue).map((st) => loadBuffer(sfxUrl(palette, st.cue!))));
    if (withMusic) await music.preload();
    const started = performance.now();
    setScene({ scene: s, step: -1, started });
    s.steps.forEach((st, i) => {
      later(st.at * 1000, () => {
        setScene((cur) => (cur && cur.scene === s ? { ...cur, step: i } : cur));
        if (st.phase && withMusic) {
          if (music.playing) music.setPhase(st.phase);
          else void music.start(st.phase);
        }
        if (st.cue) void play(palette, st.cue);
      });
    });
    later(s.length * 1000, () => setScene((cur) => (cur && cur.scene === s ? null : cur)));
  }

  const active = PALETTES.find((p) => p.id === palette)!;
  const elapsed = scene ? (performance.now() - scene.started) / 1000 : 0;

  return (
    <div className="lab">
      <header className="lab-head">
        <Link to="/" className="lab-logo">
          <Logo autoSpin={false} />
        </Link>
        <div>
          <h1>Salon d’écoute</h1>
          <p className="muted">
            Cinq palettes sonores pour les mêmes moments du jeu, de la plus fidèle au casino (1) à la plus libre (5), et la musique de fond adaptative « {MUSIC.title} ». Tout est rendu hors ligne (
            <code>npm run sounds</code>) en fichiers audio.
          </p>
        </div>
      </header>

      <section className="lab-section">
        <h2>1 · Les palettes</h2>
        <div className="lab-palettes">
          {PALETTES.map((p) => (
            <button key={p.id} className={`lab-palette ${p.id === palette ? 'on' : ''}`} onClick={() => setPalette(p.id)}>
              <span className="lab-variance" aria-label={`écart ${p.variance} sur 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <i key={n} className={n <= p.variance ? 'lit' : ''} />
                ))}
                <small>écart {p.variance}/5</small>
              </span>
              <strong>{p.name}</strong>
              <span className="lab-pitch">{p.pitch}</span>
              <span className="lab-instr">{p.instruments}</span>
            </button>
          ))}
        </div>
        <div className="lab-row">
          <button className="btn primary" onClick={() => void sequence(CUES.map((c) => [palette, c.id]), 3.2, 0.55)}>
            ▶ Écouter toute la palette « {active.name} »
          </button>
          <button className="btn ghost" onClick={clearSchedule}>
            ■ Stop
          </button>
        </div>
      </section>

      <section className="lab-section">
        <h2>2 · Les moments du jeu</h2>
        <p className="muted">Chaque ligne est un moment de la partie. « Comparer » joue ce moment dans les cinq palettes, de 1 à 5.</p>
        <div className="lab-table" role="table">
          <div className="lab-tr lab-th" role="row">
            <span>Moment</span>
            {PALETTES.map((p) => (
              <button key={p.id} className={`lab-colhead ${p.id === palette ? 'on' : ''}`} onClick={() => setPalette(p.id)}>
                {p.variance}. {p.name}
              </button>
            ))}
            <span />
          </div>
          {CUES.map((c) => (
            <div key={c.id} className="lab-tr" role="row">
              <span className="lab-cue">
                <strong>{c.label}</strong>
                <span className="muted">{c.when}</span>
                <code>{c.events.join(' · ')}</code>
              </span>
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  className={`lab-play ${p.id === palette ? 'col' : ''} ${playing === `${p.id}:${c.id}` ? 'now' : ''}`}
                  onClick={() => void play(p.id, c.id)}
                  aria-label={`${c.label}, ${p.name}`}
                >
                  ▶
                </button>
              ))}
              <button className="btn small ghost" onClick={() => void sequence(PALETTES.map((p) => [p.id, c.id]))}>
                Comparer
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="lab-section">
        <h2>3 · En situation</h2>
        <p className="muted">
          Des scènes de partie jouées avec la palette « {active.name} »
          {withMusic ? ', musique comprise : elle change de mix à chaque manche.' : '.'}
        </p>
        <div className="lab-row">
          <label className="lab-check">
            <input type="checkbox" checked={withMusic} onChange={(e) => setWithMusic(e.target.checked)} /> avec la musique
          </label>
        </div>
        <div className="lab-scenes">
          <div className="lab-scene-list">
            {[...SCENES, FULL_NIGHT].map((s) => (
              <button key={s.id} className={`btn ${s.id === 'night' ? 'primary' : ''} ${scene?.scene.id === s.id ? 'on' : ''}`} onClick={() => void runScene(s)}>
                ▶ {s.title} <small className="muted">{Math.round(s.length)} s</small>
              </button>
            ))}
            <button className="btn ghost" onClick={() => { clearSchedule(); music.stop(); }}>
              ■ Tout arrêter
            </button>
          </div>
          <ol className="lab-timeline" ref={timeline}>
            {!scene && <li className="muted">Choisis une scène.</li>}
            {scene?.scene.steps.map((st, i) => (
              <li key={i} className={i === scene.step ? 'now' : i < scene.step ? 'done' : ''}>
                <span className="lab-time">{st.at.toFixed(1)} s</span>
                <span>
                  {st.caption}
                  {st.cue && <span className="chip">{cueInfo(st.cue).label}</span>}
                  {st.phase && <span className="chip ok">musique : {PHASE_LABELS[st.phase]}</span>}
                </span>
              </li>
            ))}
            {scene && <li className="lab-progress" style={{ ['--p' as string]: Math.min(1, elapsed / scene.scene.length) }} />}
          </ol>
        </div>
      </section>

      <section className="lab-section">
        <h2>4 · Musique « {MUSIC.title} »</h2>
        <p className="muted">
          Swing manouche en ré mineur, {MUSIC.bpm} BPM, {MUSIC.bars} mesures (AABA) qui bouclent sans couture. Cinq pistes calées au même tempo : chaque manche
          choisit son mix, et le passage de l’une à l’autre se fait en fondu, sans jamais casser le rythme. La musique baisse d’elle-même sous chaque effet.
        </p>
        <div className="lab-row">
          {music.playing ? (
            <button className="btn" onClick={() => music.stop()}>
              ■ Couper la musique
            </button>
          ) : (
            <button className="btn primary" onClick={() => void resumeAudio().then(() => music.start(music.currentPhase))}>
              ▶ Lancer la musique
            </button>
          )}
          {music.playing && (
            <span className="muted">
              mesure {Math.floor(music.position() / ((60 / MUSIC.bpm) * 4)) + 1} / {MUSIC.bars}
            </span>
          )}
        </div>
        <div className="lab-phases">
          {PHASES.map((ph) => (
            <button key={ph} className={`btn small ${music.currentPhase === ph ? 'primary' : ''}`} onClick={() => void resumeAudio().then(() => (music.playing ? music.setPhase(ph) : music.start(ph)))}>
              {PHASE_LABELS[ph]}
            </button>
          ))}
        </div>
        <div className="lab-stems">
          {STEMS.map((s) => (
            <label key={s.id} className={`lab-stem ${music.isMuted(s.id) ? 'off' : ''}`}>
              <input type="checkbox" checked={!music.isMuted(s.id)} onChange={(e) => music.setMuted(s.id, !e.target.checked)} />
              <span>{s.label}</span>
              <span className="lab-meter">
                <i style={{ width: `${music.level(s.id) * 100}%` }} />
              </span>
            </label>
          ))}
        </div>
        <div className="lab-sliders">
          <label>
            Musique <input type="range" min={0} max={1} step={0.01} value={musicVol} onChange={(e) => setMusicVol(Number(e.target.value))} />
          </label>
          <label>
            Effets <input type="range" min={0} max={1} step={0.01} value={sfxVol} onChange={(e) => setSfxVol(Number(e.target.value))} />
          </label>
          <label className="lab-check">
            <input type="checkbox" checked={duck} onChange={(e) => setDuck(e.target.checked)} /> la musique s’efface sous les effets
          </label>
        </div>
      </section>
    </div>
  );
}
