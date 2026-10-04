import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { ConnectionPill, DifficultyChip, nameOf, useNow } from '../components/ui';
import { api, getToken, setToken } from '../lib/api';
import { useGame } from '../lib/useGame';
import type { UseGame } from '../lib/useGame';
import { parseCoord } from '../../shared/grid';
import type { HostCommand } from '../../shared/protocol';
import type { GameView, PackSummary, Phase, QuestionView } from '../../shared/types';

const PHASES: Phase[] = ['lobby', 'sprint', 'memory', 'climax', 'results'];

export function Host() {
  return (
    <PinGate>
      <HostApp />
    </PinGate>
  );
}

function HostApp() {
  const token = getToken();
  const game = useGame({ hello: token ? { t: 'hello', role: 'host', token } : null });
  const { state, error, clearError, connection } = game;

  useEffect(() => {
    if (error?.code === 'auth') {
      setToken(null);
      location.reload();
    }
  }, [error]);

  // Show command errors (e.g. "Finish the current question first.") for a few seconds.
  useEffect(() => {
    if (error?.code !== 'command') return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  return (
    <div className="page">
      {error?.code === 'command' && (
        <div className="card error" role="alert" onClick={clearError}>
          {error.message}
        </div>
      )}
      {state ? <GamePanel state={state} game={game} /> : <NoGame game={game} />}
      <ConnectionPill connection={connection} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function NoGame({ game }: { game: UseGame }) {
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  useEffect(() => {
    api<PackSummary[]>('GET', '/api/packs').then(setPacks).catch(() => setPacks([]));
  }, []);
  const ready = packs?.filter((p) => p.status === 'ready') ?? [];

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          Host <span>remote</span>
        </h1>
        <Link to="/" className="muted">
          home
        </Link>
      </div>
      <h2>Start a game</h2>
      {packs === null && <p className="muted">Loading packs…</p>}
      {packs && ready.length === 0 && (
        <div className="card stack">
          <p>No pack is ready to play yet.</p>
          <Link className="btn primary" to="/prep" style={{ textAlign: 'center', textDecoration: 'none' }}>
            Go to /prep
          </Link>
        </div>
      )}
      {ready.map((p) => (
        <div key={p.id} className="card row">
          <div className="grow">
            <b>{p.title}</b>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {p.counts.sprint.approved} sprint · {p.counts.memory.approved} grid · {p.counts.climax.approved} finale
            </div>
          </div>
          <button className="btn primary" onClick={() => game.send({ t: 'game.create', packId: p.id })}>
            Start
          </button>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

function GamePanel({ state, game }: { state: GameView; game: UseGame }) {
  const send = (cmd: HostCommand) => game.send(cmd);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {state.packTitle}
          </div>
          <b style={{ letterSpacing: '0.2em', fontSize: '1.3rem' }}>{state.joinCode}</b>
        </div>
        <button
          className="btn small ghost"
          onClick={() => window.confirm('End this game for everyone?') && send({ t: 'game.end' })}
        >
          End game
        </button>
      </div>

      <div className="phase-tabs">
        {PHASES.map((p) => (
          <button key={p} className={state.phase === p ? 'active' : ''} onClick={() => send({ t: 'phase.set', phase: p })}>
            {p}
          </button>
        ))}
      </div>

      {state.phase === 'lobby' && <LobbyPanel state={state} send={send} />}
      {state.phase === 'sprint' && <SprintPanel state={state} send={send} />}
      {state.phase === 'memory' && <MemoryPanel state={state} send={send} />}
      {state.phase === 'climax' && <ClimaxPanel state={state} send={send} />}
      {state.phase === 'results' && (
        <div className="card center">
          <h2>Game over</h2>
          <p className="muted">The podium is on the TV.</p>
        </div>
      )}

      <Players state={state} send={send} />
    </>
  );
}

type Send = (cmd: HostCommand) => void;

function QuestionCard({ q, label }: { q: QuestionView; label?: string }) {
  return (
    <div className="qcard">
      <div className="row wrap">
        {label && <span className="chip">{label}</span>}
        <span className="chip">{q.theme}</span>
        <DifficultyChip difficulty={q.difficulty} />
      </div>
      <div className="prompt">{q.prompt}</div>
      {q.answer && (
        <div className="answer">
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Answer
          </div>
          <b>{q.answer}</b>
        </div>
      )}
      {q.notes && <div className="muted">{q.notes}</div>}
    </div>
  );
}

// --- Lobby -------------------------------------------------------------------

function LobbyPanel({ state, send }: { state: GameView; send: Send }) {
  return (
    <div className="card stack">
      <p>
        Players join with the code <b>{state.joinCode}</b> (QR on the TV). {state.players.length} in the room.
      </p>
      <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'sprint' })}>
        Start Phase 1: The Sprint
      </button>
    </div>
  );
}

// --- Phase 1 -----------------------------------------------------------------

function SprintPanel({ state, send }: { state: GameView; send: Send }) {
  const s = state.sprint;
  const q = s.question;
  const buzzer = nameOf(state.players, s.buzzPlayerId);
  const done = s.index + 1 >= s.total;

  return (
    <div className="stack">
      <div className="muted">
        Question {Math.max(0, s.index + 1)} of {s.total}
      </div>
      {q ? <QuestionCard q={q} /> : <div className="card muted">Press next to ask the first question.</div>}

      {s.status === 'asking' && <div className="card center muted">Buzzers are open… {s.lockedOut.length > 0 && `(${s.lockedOut.length} locked out)`}</div>}
      {s.status === 'locked' && (
        <>
          <div className="card center">
            <div className="muted">First to buzz</div>
            <h2 style={{ fontSize: '2rem' }}>{buzzer}</h2>
          </div>
          <div className="row">
            <button className="btn ok big grow" onClick={() => send({ t: 'sprint.award' })}>
              Correct{q ? ` +${q.points}` : ''}
            </button>
            <button className="btn bad big grow" onClick={() => send({ t: 'sprint.pass' })}>
              Wrong / reopen
            </button>
          </div>
        </>
      )}
      {(s.status === 'asking' || s.status === 'locked') && (
        <button className="btn ghost" onClick={() => send({ t: 'sprint.skip' })}>
          Skip question (no points)
        </button>
      )}
      {(s.status === 'idle' || s.status === 'resolved') && (
        <button className="btn primary big" disabled={done && s.status === 'resolved'} onClick={() => send({ t: 'sprint.next' })}>
          {done && s.status === 'resolved' ? 'No more questions' : 'Next question'}
        </button>
      )}
      {done && s.status === 'resolved' && (
        <button className="btn" onClick={() => send({ t: 'phase.set', phase: 'memory' })}>
          Continue to Phase 2: Memory Grid
        </button>
      )}
    </div>
  );
}

// --- Phase 2 -----------------------------------------------------------------

function MemoryPanel({ state, send }: { state: GameView; send: Send }) {
  const m = state.memory;
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(500);
  const seconds = m.previewUntil ? Math.max(0, Math.ceil((m.previewUntil - now) / 1000)) : 0;

  // Drop the selection once that tile has been played.
  useEffect(() => {
    if (selected && m.tiles.find((t) => t.coord === selected)?.face !== 'hidden') setSelected(null);
  }, [m.tiles, selected]);

  if (m.status === 'idle') {
    return (
      <div className="card stack">
        <p>Ready to build the grid from the approved questions.</p>
        <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'memory' })}>
          Show the grid
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {m.status === 'preview' && (
        <div className="card stack">
          <p>
            Themes are face-up on the TV. They flip in <b className="countdown">{seconds}s</b>.
          </p>
          <button className="btn primary" onClick={() => send({ t: 'memory.hide' })}>
            Flip them face-down now
          </button>
        </div>
      )}

      {m.status === 'playing' && (
        <div className="card">
          <div className="row">
            <div className="grow">
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                On turn
              </div>
              <b style={{ fontSize: '1.3rem' }}>{nameOf(state.players, m.turnPlayerId) || '—'}</b>
            </div>
            <select
              className="input"
              style={{ width: 'auto' }}
              value=""
              onChange={(e) => e.target.value && send({ t: 'memory.setTurn', playerId: e.target.value })}
            >
              <option value="">Change…</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => send({ t: 'memory.skipTurn' })}>
              Skip
            </button>
          </div>
        </div>
      )}

      {m.asking && (
        <>
          <QuestionCard q={m.asking} label={m.askingCoord ?? undefined} />
          <div className="row">
            <button className="btn ok big grow" onClick={() => send({ t: 'memory.resolve', correct: true })}>
              Correct +{m.asking.points}
            </button>
            <button className="btn bad big grow" onClick={() => send({ t: 'memory.resolve', correct: false })}>
              Miss
            </button>
          </div>
          <p className="muted center" style={{ fontSize: '0.85rem' }}>
            Hit or miss, this tile is used up for good.
          </p>
        </>
      )}

      {!m.asking && m.status === 'playing' && (
        <button
          className="btn primary big"
          disabled={!selected}
          onClick={() => selected && send({ t: 'memory.flip', coord: selected })}
        >
          {selected ? `Flip ${selected}` : 'Tap the coordinate they called'}
        </button>
      )}

      {m.status === 'finished' && (
        <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'climax' })}>
          Grid cleared: continue to Phase 3
        </button>
      )}

      <HostGrid state={state} selected={selected} onSelect={setSelected} />
    </div>
  );
}

function HostGrid({ state, selected, onSelect }: { state: GameView; selected: string | null; onSelect: (c: string) => void }) {
  const m = state.memory;
  const cells = Array.from({ length: m.cols * m.rows }, () => null as (typeof m.tiles)[number] | null);
  for (const t of m.tiles) {
    const pos = parseCoord(t.coord);
    if (pos) cells[pos.row * m.cols + pos.col] = t;
  }
  return (
    <div className="host-grid" style={{ gridTemplateColumns: `repeat(${m.cols}, minmax(0, 1fr))` }}>
      {cells.map((t, i) =>
        t ? (
          <button
            key={t.coord}
            className={['host-tile', t.face, t.result ?? '', selected === t.coord ? 'selected' : ''].join(' ')}
            disabled={t.face !== 'hidden' || m.status !== 'playing' || !!m.asking}
            onClick={() => onSelect(t.coord)}
          >
            {t.coord}
            {t.face === 'consumed' && <div style={{ fontSize: '0.6rem' }}>{t.theme}</div>}
          </button>
        ) : (
          <div key={`e${i}`} />
        ),
      )}
    </div>
  );
}

// --- Phase 3 -----------------------------------------------------------------

function ClimaxPanel({ state, send }: { state: GameView; send: Send }) {
  const c = state.climax;

  if (c.status === 'idle' || c.status === 'resolved') {
    return (
      <div className="stack">
        {c.status === 'resolved' && c.question && (
          <>
            <QuestionCard q={c.question} label="Round over" />
            {c.results.map((r) => (
              <div key={r.playerId} className="card row">
                <b className="grow">{nameOf(state.players, r.playerId)}</b>
                <span className={`chip ${r.correct ? 'ok' : 'bad'}`}>{r.correct ? `+${2 * r.wager}` : `-${r.wager}`}</span>
              </div>
            ))}
          </>
        )}
        <h2>{c.candidates.length > 0 ? 'Pick the question' : 'No question left'}</h2>
        {c.candidates.map((q) => (
          <div key={q.id} className="qcard">
            <div className="row wrap">
              <span className="chip">{q.theme}</span>
              <DifficultyChip difficulty={q.difficulty} withPoints={false} />
            </div>
            <div>{q.prompt}</div>
            <div className="muted">
              Answer: <b style={{ color: 'var(--text)' }}>{q.answer}</b>
            </div>
            <button className="btn primary" onClick={() => send({ t: 'climax.pick', questionId: q.id })}>
              Announce this one
            </button>
          </div>
        ))}
        {c.status === 'resolved' && (
          <button className="btn" onClick={() => send({ t: 'phase.set', phase: 'results' })}>
            Finish: show the results
          </button>
        )}
      </div>
    );
  }

  const eligible = state.players.filter((p) => !p.sitOut);
  return (
    <div className="stack">
      {c.question && <QuestionCard q={c.question} label={c.status === 'asking' ? 'Revealed' : 'Hidden from players'} />}

      {c.status === 'announce' && (
        <>
          <p className="muted">The TV shows the theme and difficulty only.</p>
          <button className="btn primary big" onClick={() => send({ t: 'climax.openBetting' })}>
            Open betting
          </button>
        </>
      )}

      {c.status === 'betting' && (
        <>
          <div className="card stack">
            <b>
              Bets ({eligible.filter((p) => p.hasBet).length}/{eligible.length})
            </b>
            {state.players.map((p) => (
              <div key={p.id} className="player-row">
                <span className="name">{p.name}</span>
                {p.sitOut ? (
                  <span className="chip">sits out</span>
                ) : (
                  <span className={`chip ${p.hasBet ? 'ok' : ''}`}>{p.hasBet ? `${c.bets[p.id]} of ${p.score}` : 'thinking…'}</span>
                )}
              </div>
            ))}
          </div>
          <button className="btn primary big" onClick={() => send({ t: 'climax.lockBets' })}>
            Lock bets and reveal the question
          </button>
        </>
      )}

      {c.status === 'asking' && (
        <>
          {c.pendingJudge.length === 0 && <p className="muted">Nobody left to judge.</p>}
          {c.pendingJudge.map((id) => (
            <div key={id} className="card stack">
              <div className="row">
                <b className="grow">{nameOf(state.players, id)}</b>
                <span className="chip hard">{c.bets[id]} at stake</span>
              </div>
              <div className="row">
                <button className="btn ok grow" onClick={() => send({ t: 'climax.judge', playerId: id, correct: true })}>
                  Correct (+{2 * c.bets[id]})
                </button>
                <button className="btn bad grow" onClick={() => send({ t: 'climax.judge', playerId: id, correct: false })}>
                  Wrong (-{c.bets[id]})
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// --- Players --------------------------------------------------------------------

function Players({ state, send }: { state: GameView; send: Send }) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <details className="card">
      <summary>
        <b>Players</b> <span className="muted">({state.players.length})</span>
      </summary>
      <div style={{ marginTop: 8 }}>
        {sorted.map((p) => (
          <div key={p.id} className="player-row">
            <span className={`dot ${p.connected ? 'on' : ''}`} />
            <span className="name">{p.name}</span>
            <b style={{ minWidth: 28, textAlign: 'right' }}>{p.score}</b>
            {[-1, 1].map((d) => (
              <button
                key={d}
                className="btn small"
                disabled={d < 0 && p.score === 0}
                onClick={() => send({ t: 'score.adjust', playerId: p.id, delta: d })}
              >
                {d > 0 ? '+1' : '−1'}
              </button>
            ))}
            <button
              className="btn small ghost"
              aria-label={`Remove ${p.name}`}
              onClick={() => window.confirm(`Remove ${p.name} from the game?`) && send({ t: 'player.kick', playerId: p.id })}
            >
              ✕
            </button>
          </div>
        ))}
        {state.players.length === 0 && <p className="muted">Nobody yet.</p>}
      </div>
    </details>
  );
}
