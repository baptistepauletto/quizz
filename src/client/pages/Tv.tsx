import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { TvGrid } from '../components/MemoryGrid';
import { PhotoReveal } from '../components/PhotoReveal';
import { Scoreboard } from '../components/Scoreboard';
import { ConnectionPill, DifficultyChip, nameOf, useNow } from '../components/ui';
import { fetchInfo, lanOrigin } from '../lib/api';
import type { LanInfo } from '../lib/api';
import { playSfx } from '../lib/sfx';
import { useGame } from '../lib/useGame';
import type { GameView } from '../../shared/types';

const HELLO = { t: 'hello', role: 'tv' } as const;

export function Tv() {
  const { state, connection } = useGame({ hello: HELLO, onEvent: playSfx });
  const [info, setInfo] = useState<LanInfo | null>(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
  }, []);

  // If the PC has several networks and the QR code points at the wrong one, press "i" to try the next.
  const [ipIndex, setIpIndex] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key.toLowerCase() === 'i' && setIpIndex((i) => i + 1);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const joinUrl = `${lanOrigin(info, ipIndex)}/play`;

  return (
    <div className="tv">
      <header className="tv-head">
        <div className="brand">
          <span className="brand-q">Quizz</span>
          <span className="brand-in">In</span>
        </div>
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
        <Lobby state={state} joinUrl={joinUrl} />
      ) : state.phase === 'results' ? (
        <Results state={state} />
      ) : (
        <div className="tv-body">
          <div className="tv-main">
            {state.phase === 'sprint' && <Sprint state={state} />}
            {state.phase === 'memory' && <Memory state={state} />}
            {state.phase === 'climax' && <Climax state={state} />}
          </div>
          <Scoreboard
            players={state.players}
            turnPlayerId={state.phase === 'memory' ? state.memory.turnPlayerId : null}
            buzzPlayerId={state.phase === 'sprint' ? state.sprint.buzzPlayerId : null}
          />
        </div>
      )}
      <ConnectionPill connection={connection} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Lobby({ state, joinUrl }: { state: GameView; joinUrl: string }) {
  const [qr, setQr] = useState('');
  const shortUrl = `${joinUrl}?code=${state.joinCode}`;
  useEffect(() => {
    QRCode.toDataURL(shortUrl, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setQr);
  }, [shortUrl]);

  return (
    <div className="tv-body full">
      <div className="lobby-grid">
        <div className="qr">{qr && <img src={qr} alt={`Scanne pour rejoindre ${state.joinCode}`} />}</div>
        <div>
          <div className="big-code">{state.joinCode}</div>
          <div className="tv-sub">Scanne pour rejoindre</div>
          <div className="tv-sub" style={{ fontSize: '0.85em' }}>
            {joinUrl.replace(/^https?:\/\//, '')}
          </div>
          <div className="player-chips">
            {state.players.length === 0 && <span className="tv-sub">En attente des joueurs…</span>}
            {state.players.map((p) => (
              <span key={p.id} className="chip" style={{ opacity: p.connected ? 1 : 0.5 }}>
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

function Sprint({ state }: { state: GameView }) {
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

function Memory({ state }: { state: GameView }) {
  const m = state.memory;
  const now = useNow(250);
  const seconds = m.previewUntil ? Math.max(0, Math.ceil((m.previewUntil - now) / 1000)) : 0;

  if (m.status === 'finished' && m.tiles.length === 0) {
    return (
      <div className="tv-center">
        <div className="tv-title">Aucune question dans la grille</div>
      </div>
    );
  }

  return (
    <>
      <div className="turn-banner">
        {m.status === 'preview' ? (
          <>
            Mémorisez les thèmes ! <span className="countdown">{seconds}s</span>
          </>
        ) : m.status === 'finished' ? (
          'Grille terminée !'
        ) : (
          <>
            <b>{nameOf(state.players, m.turnPlayerId)}</b>, annonce une case
            <span className="muted"> · {m.remaining} restantes</span>
          </>
        )}
      </div>
      <TvGrid memory={m} />
      {m.asking && m.askingCoord && (
        <div className="modal">
          <div className="modal-card" key={m.askingCoord}>
            <div className="modal-coord">{m.askingCoord}</div>
            <div className="tv-badges">
              <span className="chip">{m.asking.theme}</span>
              <DifficultyChip difficulty={m.asking.difficulty} />
            </div>
            <div className="tv-prompt">{m.asking.prompt}</div>
            <div className="tv-sub">Pour {nameOf(state.players, m.turnPlayerId)}</div>
          </div>
        </div>
      )}
    </>
  );
}

// --- Phase 3 -----------------------------------------------------------------

function Climax({ state }: { state: GameView }) {
  const c = state.climax;
  const bettors = state.players.filter((p) => !p.sitOut);
  const placed = bettors.filter((p) => p.hasBet).length;

  if (c.status === 'idle') {
    return (
      <div className="tv-center">
        <div className="tv-sub">Phase 3</div>
        <div className="tv-title">Quitte ou double</div>
        <div className="tv-sub">Bonne réponse : ta mise est triplée. Mauvaise : tu la perds.</div>
      </div>
    );
  }

  return (
    <div className="tv-center">
      <div className="tv-sub">Quitte ou double</div>
      <div className="tv-badges">
        <span className="chip" style={{ fontSize: '2em' }}>
          {c.theme}
        </span>
        {c.difficulty && <DifficultyChip difficulty={c.difficulty} />}
      </div>

      {c.status === 'announce' && <div className="tv-title">Préparez vos mises…</div>}

      {c.status === 'betting' && (
        <>
          <div className="tv-title">Placez vos paris !</div>
          <div className="tv-sub">
            {placed} mise{placed > 1 ? 's' : ''} sur {bettors.length}
          </div>
          <div className="player-chips">
            {state.players.map((p) => (
              <span key={p.id} className={`chip ${p.sitOut ? '' : p.hasBet ? 'ok' : ''}`}>
                {p.name} {p.sitOut ? '· passe' : p.hasBet ? '· misé' : '· réfléchit…'}
              </span>
            ))}
          </div>
        </>
      )}

      {(c.status === 'asking' || c.status === 'resolved') && c.question && (
        <>
          <div className="tv-prompt">{c.question.prompt}</div>
          {c.status === 'asking' && <div className="tv-sub">Les paris sont verrouillés.</div>}
          {c.status === 'resolved' && c.question.answer && <div className="tv-answer">{c.question.answer}</div>}
        </>
      )}

      {c.status === 'resolved' && c.results.length > 0 && (
        <div className="player-chips">
          {c.results.map((r) => (
            <span key={r.playerId} className={`chip ${r.correct ? 'ok' : 'bad'}`}>
              {nameOf(state.players, r.playerId)} {r.correct ? `+${2 * r.wager}` : `-${r.wager}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Results -------------------------------------------------------------------

function Results({ state }: { state: GameView }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  return (
    <div className="tv-body">
      <div className="tv-main">
        <div className="tv-center">
          <div className="tv-title">Classement final</div>
          <div className="podium">
            {podium.map((p) => {
              const place = ranked.indexOf(p) + 1;
              return (
                <div key={p.id} className={`step p${place}`}>
                  <span className="pl">{place}</span>
                  <span className="nm">{p.name}</span>
                  <span className="sc">{p.score} pts</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Scoreboard players={state.players} />
    </div>
  );
}
