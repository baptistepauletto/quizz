import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { ConnectionPill, DifficultyChip, nameOf, useNow } from '../components/ui';
import { api, getToken, setToken } from '../lib/api';
import { useGame } from '../lib/useGame';
import type { UseGame } from '../lib/useGame';
import { parseCoord } from '../../shared/grid';
import type { HostCommand } from '../../shared/protocol';
import type { GameView, Phase, PileSummary, QuestionView } from '../../shared/types';

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
  const [pile, setPile] = useState<PileSummary | null>(null);
  useEffect(() => {
    api<PileSummary>('GET', '/api/pile').then(setPile).catch(() => setPile({ approved: { sprint: 0, memory: 0, climax: 0 }, tonight: { sprint: 0, memory: 0, climax: 0 } }));
  }, []);
  const ready = pile !== null && pile.tonight.sprint > 0 && pile.tonight.memory > 0 && pile.tonight.climax > 0;

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          Télécommande <span>hôte</span>
        </h1>
        <Link to="/" className="muted">
          accueil
        </Link>
      </div>
      <h2>Lancer une soirée</h2>
      {pile === null && <p className="muted">Chargement du tas…</p>}
      {pile && (
        <div className="card stack">
          <p>
            Le tas contient {pile.approved.sprint} sprint, {pile.approved.memory} grille et {pile.approved.climax} finale.
          </p>
          {ready ? (
            <p className="muted">
              Ce soir : {pile.tonight.sprint} sprint, {pile.tonight.memory} grille et {pile.tonight.climax} finale. Les questions déjà posées restent en bas.
            </p>
          ) : (
            <p>Valide au moins une question sprint, une grille et une finale.</p>
          )}
          {ready ? (
            <button className="btn primary" onClick={() => game.send({ t: 'game.create' })}>
              Tirer la soirée
            </button>
          ) : (
            <Link className="btn primary" to="/prep" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Aller à /prep
            </Link>
          )}
        </div>
      )}
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
          onClick={() => window.confirm('Terminer la partie pour tout le monde ?') && send({ t: 'game.end' })}
        >
          Fin de partie
        </button>
      </div>

      <div className="phase-tabs">
        {PHASES.map((p) => (
          <button key={p} className={state.phase === p ? 'active' : ''} onClick={() => send({ t: 'phase.set', phase: p })}>
            {{ lobby: 'salon', sprint: 'sprint', memory: 'mémoire', climax: 'finale', results: 'classement' }[p]}
          </button>
        ))}
      </div>

      {state.phase === 'lobby' && <LobbyPanel state={state} send={send} />}
      {state.phase === 'sprint' && <SprintPanel state={state} send={send} />}
      {state.phase === 'memory' && <MemoryPanel state={state} send={send} />}
      {state.phase === 'climax' && <ClimaxPanel state={state} send={send} />}
      {state.phase === 'results' && (
        <div className="card center">
          <h2>Partie terminée</h2>
          <p className="muted">Le podium est sur la TV.</p>
        </div>
      )}

      <PlayersPanel state={state} send={send} />
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
      {q.image && <img className="q-photo" src={q.image} alt="" />}
      <div className="prompt">{q.prompt}</div>
      {q.answer && (
        <div className="answer">
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Réponse
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
        Les joueurs rejoignent avec le code <b>{state.joinCode}</b> (QR sur la TV). {state.players.length} dans la salle.
      </p>
      <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'sprint' })}>
        Lancer la phase 1 : Le Sprint
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
        Question {Math.max(0, s.index + 1)} sur {s.total}
      </div>
      {q ? <QuestionCard q={q} /> : <div className="card muted">Appuie sur suivant pour la première question.</div>}

      {s.status === 'asking' && <div className="card center muted">Buzzers ouverts… {s.lockedOut.length > 0 && `(${s.lockedOut.length} exclus)`}</div>}
      {s.status === 'locked' && (
        <>
          <div className="card center">
            <div className="muted">Premier à buzzer</div>
            <h2 style={{ fontSize: '2rem' }}>{buzzer}</h2>
          </div>
          <div className="row">
            <button className="btn ok big grow" onClick={() => send({ t: 'sprint.award' })}>
              Correct{q ? ` +${q.points}` : ''}
            </button>
            <button className="btn bad big grow" onClick={() => send({ t: 'sprint.pass' })}>
              Faux / rouvrir
            </button>
          </div>
        </>
      )}
      {(s.status === 'asking' || s.status === 'locked') && (
        <button className="btn ghost" onClick={() => send({ t: 'sprint.skip' })}>
          Passer (sans points)
        </button>
      )}
      {(s.status === 'idle' || s.status === 'resolved') && (
        <button className="btn primary big" disabled={done && s.status === 'resolved'} onClick={() => send({ t: 'sprint.next' })}>
          {done && s.status === 'resolved' ? 'Plus de questions' : 'Question suivante'}
        </button>
      )}
      {done && s.status === 'resolved' && (
        <button className="btn" onClick={() => send({ t: 'phase.set', phase: 'memory' })}>
          Continuer vers la phase 2 : Grille mémoire
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
        <p>Prêt à monter la grille avec les questions validées.</p>
        <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'memory' })}>
          Afficher la grille
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {m.status === 'preview' && (
        <div className="card stack">
          <p>
            Les thèmes sont visibles sur la TV. Ils se retournent dans <b className="countdown">{seconds}s</b>.
          </p>
          <button className="btn primary" onClick={() => send({ t: 'memory.hide' })}>
            Les retourner maintenant
          </button>
        </div>
      )}

      {m.status === 'playing' && (
        <div className="card">
          <div className="row">
            <div className="grow">
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Au tour de
              </div>
              <b style={{ fontSize: '1.3rem' }}>{nameOf(state.players, m.turnPlayerId) || '—'}</b>
            </div>
            <select
              className="input"
              style={{ width: 'auto' }}
              value=""
              onChange={(e) => e.target.value && send({ t: 'memory.setTurn', playerId: e.target.value })}
            >
              <option value="">Changer…</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => send({ t: 'memory.skipTurn' })}>
              Passer
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
              Raté
            </button>
          </div>
          <p className="muted center" style={{ fontSize: '0.85rem' }}>
            Bon ou mauvais, cette case est définitivement jouée.
          </p>
        </>
      )}

      {!m.asking && m.status === 'playing' && (
        <button
          className="btn primary big"
          disabled={!selected}
          onClick={() => selected && send({ t: 'memory.flip', coord: selected })}
        >
          {selected ? `Retourner ${selected}` : 'Touche la case annoncée'}
        </button>
      )}

      {m.status === 'finished' && (
        <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'climax' })}>
          Grille terminée : phase 3
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
            <QuestionCard q={c.question} label="Manche terminée" />
            {c.results.map((r) => (
              <div key={r.playerId} className="card row">
                <b className="grow">{nameOf(state.players, r.playerId)}</b>
                <span className={`chip ${r.correct ? 'ok' : 'bad'}`}>{r.correct ? `+${2 * r.wager}` : `-${r.wager}`}</span>
              </div>
            ))}
          </>
        )}
        <h2>{c.candidates.length > 0 ? 'Choisir la question' : 'Plus de question'}</h2>
        {c.candidates.map((q) => (
          <div key={q.id} className="qcard">
            <div className="row wrap">
              <span className="chip">{q.theme}</span>
              <DifficultyChip difficulty={q.difficulty} withPoints={false} />
            </div>
            <div>{q.prompt}</div>
            <div className="muted">
              Réponse: <b style={{ color: 'var(--text)' }}>{q.answer}</b>
            </div>
            <button className="btn primary" onClick={() => send({ t: 'climax.pick', questionId: q.id })}>
              Annoncer celle-ci
            </button>
          </div>
        ))}
        {c.status === 'resolved' && (
          <button className="btn" onClick={() => send({ t: 'phase.set', phase: 'results' })}>
            Finir : afficher le classement
          </button>
        )}
      </div>
    );
  }

  const eligible = state.players.filter((p) => !p.sitOut);
  return (
    <div className="stack">
      {c.question && <QuestionCard q={c.question} label={c.status === 'asking' ? 'Révélée' : 'Cachée aux joueurs'} />}

      {c.status === 'announce' && (
        <>
          <p className="muted">La TV n’affiche que le thème et la difficulté.</p>
          <button className="btn primary big" onClick={() => send({ t: 'climax.openBetting' })}>
            Ouvrir les paris
          </button>
        </>
      )}

      {c.status === 'betting' && (
        <>
          <div className="card stack">
            <b>
              Mises ({eligible.filter((p) => p.hasBet).length}/{eligible.length})
            </b>
            {state.players.map((p) => (
              <div key={p.id} className="player-row">
                <span className="name">{p.name}</span>
                {p.sitOut ? (
                  <span className="chip">passe</span>
                ) : (
                  <span className={`chip ${p.hasBet ? 'ok' : ''}`}>{p.hasBet ? `${c.bets[p.id]} sur ${p.score}` : 'réfléchit…'}</span>
                )}
              </div>
            ))}
          </div>
          <button className="btn primary big" onClick={() => send({ t: 'climax.lockBets' })}>
            Verrouiller et révéler la question
          </button>
        </>
      )}

      {c.status === 'asking' && (
        <>
          {c.pendingJudge.length === 0 && <p className="muted">Plus personne à juger.</p>}
          {c.pendingJudge.map((id) => (
            <div key={id} className="card stack">
              <div className="row">
                <b className="grow">{nameOf(state.players, id)}</b>
                <span className="chip hard">{c.bets[id]} en jeu</span>
              </div>
              <div className="row">
                <button className="btn ok grow" onClick={() => send({ t: 'climax.judge', playerId: id, correct: true })}>
                  Correct (+{2 * c.bets[id]})
                </button>
                <button className="btn bad grow" onClick={() => send({ t: 'climax.judge', playerId: id, correct: false })}>
                  Faux (-{c.bets[id]})
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// --- Joueurs --------------------------------------------------------------------

function PlayersPanel({ state, send }: { state: GameView; send: Send }) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <details className="card">
      <summary>
        <b>Joueurs</b> <span className="muted">({state.players.length})</span>
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
              aria-label={`Retirer ${p.name}`}
              onClick={() => window.confirm(`Retirer ${p.name} de la partie ?`) && send({ t: 'player.kick', playerId: p.id })}
            >
              ✕
            </button>
          </div>
        ))}
        {state.players.length === 0 && <p className="muted">Personne pour l’instant.</p>}
      </div>
    </details>
  );
}
