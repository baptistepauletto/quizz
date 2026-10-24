import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Logo } from '../components/Logo';
import { TvGrid } from '../components/MemoryGrid';
import { PhotoReveal } from '../components/PhotoReveal';
import { Scoreboard } from '../components/Scoreboard';
import { ChipStack, Confetti, CountUp, CountdownRing, Marquee, Token, useFlash } from '../components/stage';
import type { StackMode } from '../components/stage';
import { ConnectionPill, DifficultyChip, OptionsList, nameOf } from '../components/ui';
import { fetchInfo, lanOrigin } from '../lib/api';
import type { LanInfo } from '../lib/api';
import { PLAYER_COLORS, playerColors } from '../lib/colors';
import { audioReady, isMuted, onAudioChange, playSfx, toggleMute, unlockAudio } from '../lib/sfx';
import { useGame } from '../lib/useGame';
import { climaxStackAmount, climaxWinDelta } from '../../shared/types';
import type { GameEvent, GameView, Phase, PlayerView } from '../../shared/types';

const HELLO = { t: 'hello', role: 'tv' } as const;

interface Fx {
  kind: 'ok' | 'bad';
  playerId: string | null;
  key: number;
}

function fxFor(event: GameEvent): Omit<Fx, 'key'> | null {
  const p = event.payload;
  const playerId = typeof p.playerId === 'string' ? p.playerId : null;
  switch (event.type) {
    case 'sprint.resolved':
      return p.correct ? { kind: 'ok', playerId } : null;
    case 'sprint.pass':
      return { kind: 'bad', playerId };
    case 'memory.consumed':
      return { kind: p.result === 'hit' ? 'ok' : 'bad', playerId };
    case 'climax.judged':
      return { kind: p.correct ? 'ok' : 'bad', playerId };
    default:
      return null;
  }
}

export function Tv() {
  const [fx, setFx] = useState<Fx | null>(null);
  const onEvent = useCallback((event: GameEvent) => {
    playSfx(event);
    const f = fxFor(event);
    if (f) setFx({ ...f, key: event.seq * 100 + Math.random() });
  }, []);
  const { state, connection } = useGame({ hello: HELLO, onEvent });
  const [info, setInfo] = useState<LanInfo | null>(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
  }, []);

  // If the PC has several networks and the QR code points at the wrong one, press "i" to try the next.
  const [ipIndex, setIpIndex] = useState(0);
  const sound = useSoundControls();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'i') setIpIndex((i) => i + 1);
      if (k === 'm') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const phaseCard = usePhaseCard(state?.phase ?? null);
  const fxOn = useFlash(fx?.key ?? null, 1400);
  const colors = playerColors(state?.players ?? []);

  const joinUrl = `${lanOrigin(info, ipIndex)}/play`;
  const flood =
    state?.phase === 'sprint' && state.sprint.status === 'locked' && state.sprint.buzzPlayerId
      ? colors.get(state.sprint.buzzPlayerId)
      : undefined;

  return (
    <div
      className={`tv ${fxOn && fx?.kind === 'bad' ? 'shake' : ''}`}
      data-phase={state?.phase ?? 'none'}
      data-flood={flood ? 'on' : undefined}
      style={{ '--flood': flood } as CSSProperties}
    >
      <div className="stage-lights" aria-hidden="true" />
      <header className="tv-head">
        <Logo />
        {state && state.phase !== 'lobby' && (
          <div className="tv-code">
            <small>code</small>
            {state.joinCode}
          </div>
        )}
      </header>
      {!state ? (
        <div className="tv-center">
          <div className="tv-title">En attente de l’hôte…</div>
          <div className="tv-sub">Lance une partie depuis /host sur ton téléphone.</div>
        </div>
      ) : state.phase === 'lobby' ? (
        <Lobby state={state} joinUrl={joinUrl} colors={colors} />
      ) : state.phase === 'results' ? (
        <Results state={state} colors={colors} />
      ) : (
        <div className="tv-body">
          <div className="tv-main">
            {state.phase === 'predictions' && <PredictionsBoard state={state} colors={colors} />}
            {state.phase === 'sprint' && <Sprint state={state} colors={colors} />}
            {state.phase === 'memory' && <Memory state={state} colors={colors} />}
            {state.phase === 'climax' && <Climax state={state} colors={colors} />}
            {state.phase === 'reveal' && <RevealBoard state={state} colors={colors} />}
          </div>
          <Scoreboard
            players={state.players}
            chips
            turnPlayerId={state.phase === 'memory' ? state.memory.turnPlayerId : null}
            buzzPlayerId={state.phase === 'sprint' ? state.sprint.buzzPlayerId : null}
          />
        </div>
      )}

      {state?.phase === 'sprint' && <BuzzSlam state={state} colors={colors} />}
      {fxOn && fx && (
        <div className={`fx fx-${fx.kind}`} style={{ '--pc': fx.playerId ? colors.get(fx.playerId) : undefined } as CSSProperties}>
          {fx.kind === 'ok' && (
            <Confetti
              key={fx.key}
              colors={[fx.playerId ? (colors.get(fx.playerId) ?? '#ffd27a') : '#ffd27a', '#ffd27a', '#f4efe4']}
              count={70}
              duration={2.2}
            />
          )}
        </div>
      )}
      {phaseCard && <PhaseCard phase={phaseCard.phase} key={phaseCard.key} />}

      {sound.hint && <div className="sound-pill">{sound.hint}</div>}
      <ConnectionPill connection={connection} />
    </div>
  );
}

function useSoundControls(): { hint: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const off = onAudioChange(() => force((n) => n + 1));
    const unlock = () => unlockAudio();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    return () => {
      off();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
  }, []);
  if (!audioReady()) return { hint: 'Appuie sur une touche pour activer le son' };
  if (isMuted()) return { hint: 'Son coupé · M pour le remettre' };
  return { hint: null };
}

/** A full-screen title card each time the host moves to another phase (not on a TV refresh). */
function usePhaseCard(phase: Phase | null): { phase: Phase; key: number } | null {
  const prev = useRef<Phase | null>(null);
  const [card, setCard] = useState<{ phase: Phase; key: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = phase;
    if (!phase || !before || before === phase || phase === 'lobby') return;
    setCard({ phase, key: Date.now() });
    const id = setTimeout(() => setCard(null), 2600);
    return () => clearTimeout(id);
  }, [phase]);
  return card;
}

const PHASE_CARDS: Partial<Record<Phase, { kicker: string; title: string; sub: string }>> = {
  predictions: {
    kicker: 'Avant le jeu',
    title: 'Le Pari du soir',
    sub: 'Qui va gagner ? Voyez juste pour gagner des points !',
  },
  sprint: { kicker: 'Phase 1', title: 'Le Sprint', sub: 'Le plus rapide au buzzer répond' },
  memory: { kicker: 'Phase 2', title: 'La Grille', sub: 'Mémorisez les thèmes, choisissez votre case' },
  climax: { kicker: 'Phase 3', title: 'La Finale', sub: 'Misez selon la difficulté · 1,5× / 2× / 3×' },
  reveal: { kicker: 'Avant le podium', title: 'Révélation', sub: 'Qui avait parié sur qui ?' },
  results: { kicker: 'Fin de partie', title: 'Le Classement', sub: 'Qui monte sur le podium ?' },
};

function PhaseCard({ phase }: { phase: Phase }) {
  const c = PHASE_CARDS[phase];
  if (!c) return null;
  return (
    <div className="phase-card" data-phase={phase}>
      <div className="phase-card-kicker">{c.kicker}</div>
      <div className="phase-card-title">{c.title}</div>
      <div className="phase-card-sub">{c.sub}</div>
    </div>
  );
}

/** The name slams in over the whole screen for a moment, then the question comes back. */
function BuzzSlam({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const s = state.sprint;
  const key = s.status === 'locked' && s.buzzPlayerId ? `${s.question?.id}-${s.buzzPlayerId}-${s.lockedOut.length}` : null;
  const on = useFlash(key, 1700);
  if (!on || !s.buzzPlayerId) return null;
  const name = nameOf(state.players, s.buzzPlayerId);
  return (
    <div className="buzz-slam" style={{ '--pc': colors.get(s.buzzPlayerId) } as CSSProperties}>
      <div className="buzz-slam-name" style={{ '--len': [...name].length } as CSSProperties}>
        {name}
      </div>
      <div className="buzz-slam-sub">a buzzé !</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Lobby({ state, joinUrl, colors }: { state: GameView; joinUrl: string; colors: Map<string, string> }) {
  const [qr, setQr] = useState('');
  const shortUrl = `${joinUrl}?code=${state.joinCode}`;
  useEffect(() => {
    QRCode.toDataURL(shortUrl, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setQr);
  }, [shortUrl]);

  return (
    <div className="tv-body full">
      <div className="lobby-grid">
        <Marquee>
          <div className="qr">{qr && <img src={qr} alt={`Scanne pour rejoindre ${state.joinCode}`} />}</div>
        </Marquee>
        <div>
          <div className="big-code">{state.joinCode}</div>
          <div className="tv-sub">Scanne pour monter sur le plateau</div>
          <div className="tv-sub" style={{ fontSize: '0.85em' }}>
            {joinUrl.replace(/^https?:\/\//, '')}
          </div>
          <div className="player-chips">
            {state.players.length === 0 && <span className="tv-sub">En attente des joueurs…</span>}
            {state.players.map((p) => (
              <span key={p.id} className="player-chip" style={{ opacity: p.connected ? 1 : 0.5 }}>
                <Token name={p.name} color={colors.get(p.id)} />
                {p.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Phase 1 -----------------------------------------------------------------

function Sprint({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const s = state.sprint;
  const q = s.question;
  return (
    <div className="tv-center">
      <div className="tv-sub">
        Phase 1 · Le Sprint
        {s.total > 0 && s.index >= 0 ? ` · question ${s.index + 1} sur ${s.total}` : ''}
      </div>
      {!q ? (
        <div className="tv-title">Doigts sur les buzzers !</div>
      ) : (
        <div className={q.image ? 'tv-center has-photo' : 'tv-center'} style={{ flex: 1, width: '100%' }}>
          <div className="tv-badges">
            {/* Photo rounds: hide the theme until resolved, or “Musique” / “Les potes” gives it away. */}
            <span className="chip">{q.image && s.status !== 'resolved' ? 'Photo' : q.theme}</span>
            <DifficultyChip difficulty={q.difficulty} />
          </div>
          {q.image && (
            <PhotoReveal
              src={q.image}
              questionId={q.id}
              phase={s.status === 'resolved' ? 'resolved' : s.status === 'locked' ? 'locked' : 'asking'}
            />
          )}
          <div className="tv-prompt">{q.prompt}</div>
          {s.status === 'locked' && s.buzzPlayerId && (
            <div className="buzz-banner" key={s.buzzPlayerId}>
              <Token name={nameOf(state.players, s.buzzPlayerId)} color={colors.get(s.buzzPlayerId)} />
              {nameOf(state.players, s.buzzPlayerId)} a buzzé !
            </div>
          )}
          {s.status === 'asking' && <div className="tv-sub">Buzz sur votre téléphone…</div>}
          {s.status === 'resolved' && q.answer && <div className="tv-answer">{q.answer}</div>}
        </div>
      )}
    </div>
  );
}

// --- Phase 2 -----------------------------------------------------------------

function Memory({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const m = state.memory;

  if (m.status === 'finished' && m.tiles.length === 0) {
    return (
      <div className="tv-center">
        <div className="tv-title">Aucune question dans la grille</div>
      </div>
    );
  }

  const turnName = nameOf(state.players, m.turnPlayerId);
  return (
    <>
      <div className="turn-banner">
        {m.status === 'preview' ? (
          <>
            <span>Mémorisez les thèmes !</span>
            <CountdownRing until={m.previewUntil} className="inline" />
          </>
        ) : m.status === 'finished' ? (
          'Grille terminée !'
        ) : (
          <>
            {m.turnPlayerId && <Token name={turnName} color={colors.get(m.turnPlayerId)} />}
            <span>
              <b style={{ color: m.turnPlayerId ? colors.get(m.turnPlayerId) : undefined }}>{turnName}</b>, annonce une case
            </span>
            <span className="muted">· {m.remaining} restantes</span>
          </>
        )}
      </div>
      <TvGrid memory={m} />
      {m.asking && m.askingCoord && (
        <div className="modal">
          <Marquee className="modal-marquee" key={m.askingCoord}>
            <div className="modal-card">
              <div className="modal-coord">{m.askingCoord}</div>
              <div className="tv-badges">
                <span className="chip">{m.asking.theme}</span>
                <DifficultyChip difficulty={m.asking.difficulty} />
              </div>
              {m.asking.image && <img className="tv-photo" src={m.asking.image} alt="" />}
              <div className="tv-prompt">{m.asking.prompt}</div>
              {m.asking.options && <OptionsList options={m.asking.options} />}
              <div className="tv-sub">
                Pour{' '}
                <b style={{ '--pc': m.turnPlayerId ? colors.get(m.turnPlayerId) : undefined } as CSSProperties} className="modal-for">
                  {turnName}
                </b>
              </div>
            </div>
          </Marquee>
        </div>
      )}
    </>
  );
}

// --- Phase 3 -----------------------------------------------------------------

function Climax({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const c = state.climax;
  const bettors = state.players.filter((p) => !p.sitOut);
  const placed = bettors.filter((p) => p.hasBet).length;

  if (c.status === 'idle') {
    return (
      <div className="tv-center">
        <div className="tv-sub">Phase 3</div>
        <Marquee>
          <div className="climax-sign">Quitte ou double</div>
        </Marquee>
        <div className="tv-sub">Bonne réponse : ta mise est multipliée. Mauvaise : tu la perds.</div>
      </div>
    );
  }

  const compact = c.status === 'asking' || c.status === 'resolved';
  return (
    <div className={`tv-center climax ${compact ? 'compact' : ''}`}>
      {!compact && <div className="climax-title">Quitte ou double</div>}
      <div className="tv-badges">
        <span className="chip theme-chip">{c.theme}</span>
        {c.difficulty && <DifficultyChip difficulty={c.difficulty} />}
      </div>

      {c.status === 'announce' && (
        <>
          <div className="tv-title">Préparez vos mises…</div>
          <Table players={state.players} colors={colors} mode={() => 'empty'} />
        </>
      )}

      {c.status === 'betting' && (
        <>
          <div className="tv-sub">
            Placez vos jetons · {placed} mise{placed > 1 ? 's' : ''} sur {bettors.length}
          </div>
          <Table
            players={state.players}
            colors={colors}
            mode={(p) => (p.hasBet ? 'secret' : 'empty')}
            caption={(p) => (p.hasBet ? 'misé' : 'réfléchit…')}
          />
        </>
      )}

      {c.status === 'answering' && c.question && (
        <>
          {c.question.image && <img className="tv-photo" src={c.question.image} alt="" />}
          <div className="tv-prompt">{c.question.prompt}</div>
          <CountdownRing until={c.answerUntil} className="big" />
          <div className="tv-sub">Répondez sur votre téléphone</div>
        </>
      )}

      {(c.status === 'asking' || c.status === 'resolved') && c.question && (
        <>
          {c.question.image && <img className="tv-photo" src={c.question.image} alt="" />}
          <div className="tv-prompt small">{c.question.prompt}</div>
          {c.status === 'resolved' && c.question.answer && <div className="tv-answer">{c.question.answer}</div>}
          <Table
            players={state.players.filter((p) => c.submissions.some((s) => s.playerId === p.id))}
            colors={colors}
            mode={(p) => {
              const r = c.results.find((x) => x.playerId === p.id);
              if (r) return r.correct ? 'won' : 'lost';
              return 'shown';
            }}
            amount={(p) => {
              const s = c.submissions.find((x) => x.playerId === p.id);
              const r = c.results.find((x) => x.playerId === p.id);
              const wager = s?.wager ?? 0;
              const diff = c.difficulty ?? 'hard';
              return r ? climaxStackAmount(wager, r.correct, diff) : wager;
            }}
            caption={(p) => {
              const r = c.results.find((x) => x.playerId === p.id);
              if (!r) return null;
              const diff = c.difficulty ?? 'hard';
              return r.correct ? `+${climaxWinDelta(r.wager, diff)}` : `-${r.wager}`;
            }}
            answer={(p) => c.submissions.find((x) => x.playerId === p.id)?.text || '—'}
          />
        </>
      )}
    </div>
  );
}

/** The betting table: one seat per player with their chip stack. */
function Table({
  players,
  colors,
  mode,
  amount,
  caption,
  answer,
}: {
  players: PlayerView[];
  colors: Map<string, string>;
  mode: (p: PlayerView) => StackMode;
  amount?: (p: PlayerView) => number;
  caption?: (p: PlayerView) => string | null;
  answer?: (p: PlayerView) => string;
}) {
  return (
    <div className="felt">
      {players.map((p) => {
        const m: StackMode = p.sitOut ? 'empty' : mode(p);
        const cap = p.sitOut ? 'passe' : caption?.(p);
        return (
          <div key={p.id} className={`seat ${m} ${p.sitOut ? 'sit' : ''}`} style={{ '--pc': colors.get(p.id) } as CSSProperties}>
            <ChipStack mode={m} amount={amount?.(p) ?? 0} color={colors.get(p.id)} name={p.name} />
            <div className="seat-who">
              <Token name={p.name} color={colors.get(p.id)} />
              <span>{p.name}</span>
            </div>
            {answer && <div className="seat-answer">{answer(p)}</div>}
            {cap && <div className={`seat-cap ${m}`}>{cap}</div>}
          </div>
        );
      })}
    </div>
  );
}

// --- Predictions (opening) -----------------------------------------------------

function PredictionsBoard({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const picked = state.players.filter((p) => p.hasPick).length;
  const locked = state.predictions.status === 'locked';
  return (
    <div className="tv-center">
      <div className="tv-title">{locked ? 'Paris verrouillés' : 'Qui va gagner ce soir ?'}</div>
      <div className="tv-sub">
        {locked
          ? `Révélation après la finale · +${state.predictions.bonus} pts si vous avez vu juste`
          : `Choisissez sur votre téléphone · ${picked} / ${state.players.length}`}
      </div>
      <div className="predict-grid">
        {state.players.map((p) => (
          <div
            key={p.id}
            className={`predict-seat ${p.hasPick ? 'ready' : ''}`}
            style={{ '--pc': colors.get(p.id) } as CSSProperties}
          >
            <Token name={p.name} color={colors.get(p.id)} />
            <span>{p.name}</span>
            <small>{p.hasPick ? 'paré' : '…'}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Reveal (post-climax) ------------------------------------------------------

function RevealBoard({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const pred = state.predictions;
  const totalPicks = state.players.filter((p) => p.hasPick).length;
  const last = pred.picks[pred.picks.length - 1];
  const allShown = pred.revealIndex >= 0 && (totalPicks === 0 || pred.revealIndex >= totalPicks - 1);

  if (pred.revealIndex < 0) {
    return (
      <div className="tv-center">
        <div className="tv-title">Les paris du soir…</div>
        <div className="tv-sub">Qui avait vu juste ?</div>
      </div>
    );
  }

  if (totalPicks === 0) {
    return (
      <div className="tv-center">
        <div className="tv-title">Personne n’avait parié</div>
        <div className="tv-sub">Direction le podium</div>
      </div>
    );
  }

  return (
    <div className="tv-center reveal-board">
      <div className="tv-sub">
        En tête après la finale :{' '}
        {pred.winnerIds.map((id) => nameOf(state.players, id)).filter(Boolean).join(' · ') || '—'}
      </div>
      <div className="reveal-list">
        {pred.picks.map((pick) => {
          const isLast = last?.voterId === pick.voterId;
          const ok = pick.correct === true;
          return (
            <div
              key={pick.voterId}
              className={`reveal-row ${isLast ? 'focus' : ''} ${ok ? 'ok' : 'bad'}`}
              style={
                {
                  '--vc': colors.get(pick.voterId),
                  '--tc': colors.get(pick.targetId),
                } as CSSProperties
              }
            >
              <Token name={nameOf(state.players, pick.voterId)} color={colors.get(pick.voterId)} />
              <span className="reveal-voter">{nameOf(state.players, pick.voterId)}</span>
              <span className="reveal-arrow">→</span>
              <Token name={nameOf(state.players, pick.targetId)} color={colors.get(pick.targetId)} />
              <span className="reveal-target">{nameOf(state.players, pick.targetId)}</span>
              <span className={`reveal-tag ${ok ? 'ok' : 'bad'}`}>{ok ? `+${pred.bonus}` : 'raté'}</span>
            </div>
          );
        })}
      </div>
      {pred.awarded && <div className="tv-sub">Bonus appliqués · place au podium</div>}
      {allShown && !pred.awarded && <div className="tv-sub">En attente des bonus…</div>}
    </div>
  );
}

// --- Results -------------------------------------------------------------------

function Results({ state, colors }: { state: GameView; colors: Map<string, string> }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  const confettiColors = ranked.length > 0 ? ranked.slice(0, 3).map((p) => colors.get(p.id)!).concat('#ffd27a') : PLAYER_COLORS;
  return (
    <div className="tv-body">
      <div className="tv-main">
        <div className="tv-center">
          <div className="tv-title">Classement final</div>
          <div className="podium">
            {podium.map((p) => {
              const place = ranked.indexOf(p) + 1;
              return (
                <div key={p.id} className={`step p${place}`} style={{ '--pc': colors.get(p.id) } as CSSProperties}>
                  <span className="beam" aria-hidden="true" />
                  <Token name={p.name} color={colors.get(p.id)} className="podium-token" />
                  <span className="nm">{p.name}</span>
                  <div className="blk">
                    <span className="pl">{place}</span>
                    <span className="sc">
                      <CountUpFromZero value={p.score} delay={place === 1 ? 1400 : place === 2 ? 900 : 500} /> pt
                      {p.score > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Scoreboard players={state.players} chips />
      <Confetti colors={confettiColors} count={160} duration={4.5} />
    </div>
  );
}

function CountUpFromZero({ value, delay }: { value: number; delay: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setTarget(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return <CountUp value={target} ms={1400} />;
}
