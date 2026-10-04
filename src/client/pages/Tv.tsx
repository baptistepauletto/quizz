import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { TvGrid } from '../components/MemoryGrid';
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
          Quizz <span>In</span>
        </div>
        {state && state.phase !== 'lobby' && (
          <div className="tv-code">
            <small>join</small>
            {state.joinCode}
          </div>
        )}
      </header>
      {!state ? (
        <div className="tv-center">
          <div className="tv-title">Waiting for the host…</div>
          <div className="tv-sub">Start a game from the /host screen on your phone.</div>
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
        <div className="qr">{qr && <img src={qr} alt={`Scan to join ${state.joinCode}`} />}</div>
        <div>
          <div className="tv-sub">Scan the code, or go to {joinUrl.replace(/^https?:\/\//, '')} and enter</div>
          <div className="big-code">{state.joinCode}</div>
          <div className="player-chips">
            {state.players.length === 0 && <span className="tv-sub">Waiting for players…</span>}
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
        Phase 1 · The Sprint{s.total > 0 && s.index >= 0 ? ` · question ${s.index + 1} of ${s.total}` : ''}
      </div>
      {!q ? (
        <div className="tv-title">Fingers on the buzzers!</div>
      ) : (
        <>
          <div className="tv-badges">
            <span className="chip">{q.theme}</span>
            <DifficultyChip difficulty={q.difficulty} />
          </div>
          <div className="tv-prompt">{q.prompt}</div>
          {s.status === 'locked' && s.buzzPlayerId && (
            <div className="buzz-banner" key={s.buzzPlayerId}>
              {nameOf(state.players, s.buzzPlayerId)} buzzed!
            </div>
          )}
          {s.status === 'asking' && <div className="tv-sub">Buzz in on your phone…</div>}
          {s.status === 'resolved' && q.answer && <div className="tv-answer">{q.answer}</div>}
        </>
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
        <div className="tv-title">No questions in the grid</div>
      </div>
    );
  }

  return (
    <>
      <div className="turn-banner">
        {m.status === 'preview' ? (
          <>
            Memorise the themes! <span className="countdown">{seconds}s</span>
          </>
        ) : m.status === 'finished' ? (
          'Grid cleared!'
        ) : (
          <>
            <b>{nameOf(state.players, m.turnPlayerId)}</b>, call a coordinate
            <span className="muted"> · {m.remaining} tiles left</span>
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
            <div className="tv-sub">For {nameOf(state.players, m.turnPlayerId)}</div>
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
        <div className="tv-title">Double or Nothing</div>
        <div className="tv-sub">Correct answer: your wager is tripled. Wrong: it is gone.</div>
      </div>
    );
  }

  return (
    <div className="tv-center">
      <div className="tv-sub">Double or Nothing</div>
      <div className="tv-badges">
        <span className="chip" style={{ fontSize: '2em' }}>
          {c.theme}
        </span>
        {c.difficulty && <DifficultyChip difficulty={c.difficulty} />}
      </div>

      {c.status === 'announce' && <div className="tv-title">Get ready to bet…</div>}

      {c.status === 'betting' && (
        <>
          <div className="tv-title">Place your bets!</div>
          <div className="tv-sub">
            {placed} of {bettors.length} bets placed
          </div>
          <div className="player-chips">
            {state.players.map((p) => (
              <span key={p.id} className={`chip ${p.sitOut ? '' : p.hasBet ? 'ok' : ''}`}>
                {p.name} {p.sitOut ? '· sitting out' : p.hasBet ? '· locked in' : '· thinking…'}
              </span>
            ))}
          </div>
        </>
      )}

      {(c.status === 'asking' || c.status === 'resolved') && c.question && (
        <>
          <div className="tv-prompt">{c.question.prompt}</div>
          {c.status === 'asking' && <div className="tv-sub">Bets are locked.</div>}
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
          <div className="tv-title">Final results</div>
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
