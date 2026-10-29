import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinGate } from '../components/PinGate';
import { ConnectionPill, DifficultyChip, OptionsList, nameOf, useNow } from '../components/ui';
import { api, getToken, setToken } from '../lib/api';
import { useGame } from '../lib/useGame';
import type { UseGame } from '../lib/useGame';
import { parseCoord } from '../../shared/grid';
import type { HostCommand } from '../../shared/protocol';
import { MEMORY_FLOOR, PREDICTION_BONUS, climaxWinDelta, memoryHintCost } from '../../shared/types';
import type { Difficulty, GameView, Phase, PileSummary, QuestionView } from '../../shared/types';

const PHASES: Phase[] = ['lobby', 'predictions', 'sprint', 'memory', 'climax', 'reveal', 'results'];

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'salon',
  predictions: 'pari',
  sprint: 'sprint',
  memory: 'grille',
  climax: 'finale',
  reveal: 'révélation',
  results: 'classement',
};

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
    api<PileSummary>('GET', '/api/pile').then(setPile).catch(() =>
      setPile({
        approved: { sprint: 0, memory: 0, climax: 0 },
        prepared: { sprint: 0, memory: 0, climax: 0 },
        tonight: { sprint: 0, memory: 0, climax: 0 },
        draft: 0,
        rejected: 0,
        archived: 0,
      }),
    );
  }, []);
  const ready = pile !== null && pile.tonight.sprint > 0 && pile.tonight.memory > 0 && pile.tonight.climax > 0;
  const prepared = pile !== null && (pile.prepared.sprint > 0 || pile.prepared.memory > 0 || pile.prepared.climax > 0);

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
              Ce soir : {pile.tonight.sprint} sprint, {pile.tonight.memory} grille et {pile.tonight.climax} finale.{' '}
              {prepared
                ? 'Soirée préparée sur /prep (les manches sans sélection sont tirées au hasard).'
                : 'Tirage au hasard, les questions déjà posées restent en bas.'}
            </p>
          ) : (
            <p>Valide au moins une question sprint, une grille et une finale.</p>
          )}
          {ready ? (
            <button className="btn primary" onClick={() => game.send({ t: 'game.create' })}>
              {prepared ? 'Lancer la soirée' : 'Tirer la soirée'}
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
        <div className="row" style={{ gap: '0.4rem' }}>
          <button
            className="btn small ghost"
            onClick={() =>
              window.confirm('Fermer sans archiver ? Les questions restent dans le tas (test).') &&
              send({ t: 'game.end' })
            }
          >
            Fermer
          </button>
          <button
            className="btn small"
            onClick={() =>
              window.confirm(
                'Archiver la soirée ? Les questions posées quittent le tas et sont rangées dans drafts/archive/.',
              ) && send({ t: 'game.end', archive: true })
            }
          >
            Archiver
          </button>
        </div>
      </div>

      <div className="phase-tabs">
        {PHASES.map((p) => (
          <button key={p} className={state.phase === p ? 'active' : ''} onClick={() => send({ t: 'phase.set', phase: p })}>
            {PHASE_LABEL[p]}
          </button>
        ))}
      </div>

      {state.phase === 'lobby' && <LobbyPanel state={state} send={send} />}
      {state.phase === 'predictions' && <PredictionsPanel state={state} send={send} />}
      {state.phase === 'sprint' && <SprintPanel state={state} send={send} />}
      {state.phase === 'memory' && <MemoryPanel state={state} send={send} />}
      {state.phase === 'climax' && <ClimaxPanel state={state} send={send} />}
      {state.phase === 'reveal' && <RevealPanel state={state} send={send} />}
      {state.phase === 'results' && (
        <div className="card center stack">
          <h2>Partie terminée</h2>
          <p className="muted">Le podium est sur la TV.</p>
          <div className="row wrap" style={{ justifyContent: 'center', gap: '0.5rem' }}>
            <button
              className="btn ghost"
              onClick={() =>
                window.confirm('Fermer sans archiver ? Les questions restent dans le tas (test).') &&
                send({ t: 'game.end' })
              }
            >
              Fermer (test)
            </button>
            <button
              className="btn primary"
              onClick={() =>
                window.confirm(
                  'Archiver la soirée ? Les questions posées quittent le tas et sont rangées dans drafts/archive/.',
                ) && send({ t: 'game.end', archive: true })
              }
            >
              Archiver la soirée
            </button>
          </div>
        </div>
      )}

      <PlayersPanel state={state} send={send} />
    </>
  );
}

type Send = (cmd: HostCommand) => void;

function QuestionCard({
  q,
  label,
  clue,
}: {
  q: QuestionView;
  label?: string;
  /** Extra clue line already revealed on TV (Hard hint 1). */
  clue?: string | null;
}) {
  return (
    <div className="qcard">
      <div className="row wrap">
        {label && <span className="chip">{label}</span>}
        <span className="chip">{q.theme}</span>
        <DifficultyChip difficulty={q.difficulty} points={q.points} />
      </div>
      {q.image && <img className="q-photo" src={q.image} alt="" />}
      <div className="prompt">{q.prompt}</div>
      {q.options && <OptionsList options={q.options} correct={q.answer} />}
      {clue && (
        <div className="chip" style={{ alignSelf: 'flex-start' }}>
          Indice TV : {clue}
        </div>
      )}
      {q.answer && (
        <div className="answer">
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Réponse
          </div>
          <b>{q.answer}</b>
        </div>
      )}
      {q.contextHint && !clue && (
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          Indice TV (pas encore révélé) : {q.contextHint}
        </div>
      )}
      {q.notes && (
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          Notes hôte : {q.notes}
        </div>
      )}
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
      <p className="muted" style={{ fontSize: '0.9rem' }}>
        Avant le sprint : chacun parie en secret sur le vainqueur (+{PREDICTION_BONUS} pts à la révélation — ça peut encore
        changer le classement).
      </p>
      <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'predictions' })}>
        Pari du soir
      </button>
      <button className="btn ghost" onClick={() => send({ t: 'phase.set', phase: 'sprint' })}>
        Passer · lancer le Sprint
      </button>
    </div>
  );
}

function PredictionsPanel({ state, send }: { state: GameView; send: Send }) {
  const pred = state.predictions;
  const picked = state.players.filter((p) => p.hasPick).length;
  const locked = pred.status === 'locked';
  return (
    <div className="card stack">
      <h2>Pari du soir</h2>
      <p className="muted">
        Chaque joueur choisit qui va gagner. Secret jusqu’à après la finale. Bonne pioche = +{PREDICTION_BONUS} pts (peut
        bousculer le podium).
      </p>
      <div className="card stack">
        <b>
          Paris ({picked}/{state.players.length}){locked ? ' · verrouillés' : ''}
        </b>
        {state.players.map((p) => {
          const target = pred.picks.find((x) => x.voterId === p.id)?.targetId;
          return (
            <div key={p.id} className="player-row">
              <span className="name">{p.name}</span>
              <span className={`chip ${p.hasPick ? 'ok' : ''}`}>
                {p.hasPick ? `→ ${nameOf(state.players, target)}` : '…'}
              </span>
            </div>
          );
        })}
      </div>
      {!locked && (
        <button className="btn primary big" onClick={() => send({ t: 'predictions.lock' })}>
          Verrouiller les paris
        </button>
      )}
      <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'sprint' })}>
        Lancer la phase 1 : Le Sprint
      </button>
    </div>
  );
}

function RevealPanel({ state, send }: { state: GameView; send: Send }) {
  const pred = state.predictions;
  const total = pred.picks.length;
  const allShown = pred.revealIndex >= 0 && (total === 0 || pred.revealIndex >= total - 1);
  return (
    <div className="card stack">
      <h2>Révélation des paris</h2>
      <p className="muted">
        En tête après la finale :{' '}
        <b>{pred.winnerIds.map((id) => nameOf(state.players, id)).filter(Boolean).join(', ') || '—'}</b>
      </p>
      {pred.revealIndex < 0 && (
        <button className="btn primary big" onClick={() => send({ t: 'reveal.next' })}>
          Commencer la révélation
        </button>
      )}
      {pred.revealIndex >= 0 && !allShown && (
        <div className="row">
          <button className="btn primary big grow" onClick={() => send({ t: 'reveal.next' })}>
            Suivant ({Math.min(pred.revealIndex + 1, total)}/{total})
          </button>
          <button className="btn" onClick={() => send({ t: 'reveal.all' })}>
            Tout révéler
          </button>
        </div>
      )}
      {allShown && !pred.awarded && (
        <button className="btn ok big" onClick={() => send({ t: 'reveal.award' })}>
          Appliquer les +{PREDICTION_BONUS}
        </button>
      )}
      {pred.awarded && (
        <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'results' })}>
          Afficher le podium
        </button>
      )}
      {allShown && (
        <div className="card stack">
          {pred.picks.map((pick) => (
            <div key={pick.voterId} className="player-row">
              <span className="name">
                {nameOf(state.players, pick.voterId)} → {nameOf(state.players, pick.targetId)}
              </span>
              <span className={`chip ${pick.correct ? 'ok' : 'bad'}`}>
                {pick.correct ? `+${pred.bonus}` : 'raté'}
              </span>
            </div>
          ))}
        </div>
      )}
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
          Continuer vers la phase 2 : La Grille
        </button>
      )}
    </div>
  );
}

// --- Phase 2 -----------------------------------------------------------------

function hintButtonLabel(
  difficulty: Difficulty,
  hintsUsed: number,
  hasOptions: boolean,
  hasContextHint: boolean,
  isMcq: boolean,
): string {
  const next = hintsUsed + 1;
  const cost = memoryHintCost(difficulty, next);
  // Native QCM → 50/50; open-ended with bank options → reveal the four choices.
  const formatLabel = isMcq ? `50-50 (−${cost})` : `révéler QCM (−${cost})`;
  if (difficulty === 'medium' && next === 1) {
    return hasOptions ? `Indice · ${formatLabel}` : 'Indice indisponible (pas d’options)';
  }
  if (difficulty === 'hard' && next === 1) {
    return hasContextHint ? `Indice · contexte (−${cost})` : 'Indice indisponible (pas de context_hint)';
  }
  if (difficulty === 'hard' && next === 2) {
    return hasOptions ? `Indice · ${formatLabel}` : 'Indice indisponible (pas d’options)';
  }
  return `Indice (−${cost})`;
}

function MemoryPanel({ state, send }: { state: GameView; send: Send }) {
  const m = state.memory;
  const [selected, setSelected] = useState<string | null>(null);
  const [leechOk, setLeechOk] = useState<Record<string, boolean>>({});
  const now = useNow(250);
  const leechSeconds = m.leechUntil ? Math.max(0, Math.ceil((m.leechUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (selected && m.tiles.find((t) => t.coord === selected)?.face !== 'open') setSelected(null);
  }, [m.tiles, selected]);

  useEffect(() => {
    setLeechOk({});
  }, [m.askingCoord]);

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

  const asking = m.asking;
  const hasBankOptions = !!(asking?.options && asking.options.length >= 4);
  const hintLabel = asking
    ? hintButtonLabel(
        asking.difficulty,
        m.hintsUsed,
        hasBankOptions,
        !!asking.contextHint?.trim(),
        !!asking.isMcq,
      )
    : '';
  const nextHint = asking ? m.hintsUsed + 1 : 0;
  const hintDisabled =
    !asking ||
    m.askStatus !== 'answering' ||
    asking.difficulty === 'easy' ||
    m.hintsUsed >= m.maxHints ||
    (asking.difficulty === 'hard' && nextHint === 1 && !asking.contextHint?.trim()) ||
    ((asking.difficulty === 'medium' || (asking.difficulty === 'hard' && nextHint === 2)) && !hasBankOptions);

  const checkedLeechIds = Object.entries(leechOk)
    .filter(([, ok]) => ok)
    .map(([id]) => id);
  const floor = asking ? MEMORY_FLOOR[asking.difficulty] : 0;
  const correctPayout = asking
    ? Math.max(floor, asking.points - checkedLeechIds.length)
    : 0;

  return (
    <div className="stack">
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
              disabled={!!m.askingCoord}
              onChange={(e) => e.target.value && send({ t: 'memory.setTurn', playerId: e.target.value })}
            >
              <option value="">Changer…</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn small" disabled={!!m.askingCoord} onClick={() => send({ t: 'memory.skipTurn' })}>
              Passer
            </button>
          </div>
        </div>
      )}

      {asking && (
        <>
          <QuestionCard q={asking} label={m.askingCoord ?? undefined} clue={m.clue} />

          {m.askStatus === 'leeching' && (
            <div className="card stack">
              <div className="row">
                <b className="grow">Leech silencieux</b>
                <b className="countdown">{leechSeconds}s</b>
              </div>
              <div className="leech-bar">
                <div
                  className="leech-bar-fill"
                  style={{
                    width: m.leechUntil
                      ? `${Math.max(0, Math.min(100, ((m.leechUntil - now) / 15_000) * 100))}%`
                      : '0%',
                  }}
                />
              </div>
              {m.leeches.length > 0 && (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    Reçues ({m.leeches.length})
                  </span>
                  {m.leeches.map((l) => (
                    <div key={l.playerId} className="row">
                      <b>{l.name}</b>
                      <span className="muted grow">· {l.text}</span>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn" onClick={() => send({ t: 'memory.endLeech' })}>
                Couper le timer / passer aux réponses
              </button>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Les indices restent bloqués jusqu’à la fin du leech.
              </p>
            </div>
          )}

          {m.askStatus === 'answering' && (
            <>
              <div className="card stack">
                <div className="row wrap">
                  <button className="btn" disabled={hintDisabled} onClick={() => send({ t: 'memory.hint' })}>
                    {asking.difficulty === 'easy'
                      ? 'Pas d’indice (facile)'
                      : m.hintsUsed >= m.maxHints
                        ? 'Indices épuisés'
                        : hintLabel}
                  </button>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    Valeur actuelle : {asking.points} pt{asking.points > 1 ? 's' : ''}
                    {m.hintsUsed > 0 ? ` · ${m.hintsUsed} indice${m.hintsUsed > 1 ? 's' : ''}` : ''}
                  </span>
                </div>
              </div>

              {m.leeches.length > 0 ? (
                <div className="card stack">
                  <b>Réponses leech ({m.leeches.length})</b>
                  {m.leeches.map((l) => (
                    <label key={l.playerId} className="row leech-row">
                      <input
                        type="checkbox"
                        checked={!!leechOk[l.playerId]}
                        onChange={(e) => setLeechOk((prev) => ({ ...prev, [l.playerId]: e.target.checked }))}
                      />
                      <span className="grow">
                        <b>{l.name}</b>
                        <span className="muted"> · {l.text}</span>
                      </span>
                      <span className="chip">+1</span>
                    </label>
                  ))}
                  <p className="muted" style={{ fontSize: '0.8rem' }}>
                    Coche les bonnes réponses leech. Elles prennent 1 pt chacune (plancher actif{' '}
                    {floor} pt).
                  </p>
                </div>
              ) : (
                <p className="muted center" style={{ fontSize: '0.85rem' }}>
                  Aucun leech soumis.
                </p>
              )}

              <div className="row">
                <button
                  className="btn ok big grow"
                  onClick={() => send({ t: 'memory.resolve', correct: true, leechIds: checkedLeechIds })}
                >
                  Correct +{correctPayout}
                  {checkedLeechIds.length > 0 ? ` · ${checkedLeechIds.length} leech` : ''}
                </button>
                <button
                  className="btn bad big grow"
                  onClick={() => send({ t: 'memory.resolve', correct: false, leechIds: checkedLeechIds })}
                >
                  Raté
                  {checkedLeechIds.length > 0 ? ` · ${checkedLeechIds.length} leech` : ''}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {!m.askingCoord && m.status === 'playing' && (
        <button
          className="btn primary big"
          disabled={!selected}
          onClick={() => selected && send({ t: 'memory.flip', coord: selected })}
        >
          {selected ? `Ouvrir ${selected}` : 'Touche la case annoncée'}
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
  const diffShort: Record<string, string> = { easy: 'F', medium: 'M', hard: 'D' };
  return (
    <div className="host-grid" style={{ gridTemplateColumns: `repeat(${m.cols}, minmax(0, 1fr))` }}>
      {cells.map((t, i) =>
        t ? (
          <button
            key={t.coord}
            className={['host-tile', t.face, t.difficulty ?? '', t.result ?? '', selected === t.coord ? 'selected' : ''].join(' ')}
            disabled={t.face !== 'open' || m.status !== 'playing' || !!m.askingCoord}
            onClick={() => onSelect(t.coord)}
          >
            <span className="host-tile-coord">{t.coord}</span>
            <span className="host-tile-theme">{t.theme}</span>
            {t.difficulty && <span className={`host-tile-diff ${t.difficulty}`}>{diffShort[t.difficulty]}</span>}
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
                <span className={`chip ${r.correct ? 'ok' : 'bad'}`}>
                  {r.correct ? `+${climaxWinDelta(r.wager, c.difficulty ?? 'hard')}` : `-${r.wager}`}
                </span>
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
          <button className="btn primary big" onClick={() => send({ t: 'phase.set', phase: 'reveal' })}>
            Révéler les paris du soir
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
            Verrouiller · 30 s pour répondre
          </button>
        </>
      )}

      {c.status === 'answering' && (
        <>
          <p className="muted">Les joueurs tapent sur leur téléphone. Réponse vide = mise perdue.</p>
          <ClimaxCountdown until={c.answerUntil} />
          <button className="btn" onClick={() => send({ t: 'climax.lockAnswers' })}>
            Clôturer les réponses maintenant
          </button>
        </>
      )}

      {c.status === 'asking' && (
        <>
          <div className="card stack">
            <b>Réponses</b>
            {c.submissions.map((s) => (
              <div key={s.playerId} className="row">
                <span className="grow">
                  <b>{s.name}</b>
                  <span className="muted"> · {s.text || '(vide)'}</span>
                </span>
                <span className="chip hard">{s.wager} pts</span>
              </div>
            ))}
          </div>
          {c.pendingJudge.length === 0 && <p className="muted">Plus personne à juger (vides déjà perdus).</p>}
          {c.pendingJudge.map((id) => {
            const sub = c.submissions.find((s) => s.playerId === id);
            return (
              <div key={id} className="card stack">
                <div className="row">
                  <b className="grow">{nameOf(state.players, id)}</b>
                  <span className="chip hard">{c.bets[id]} en jeu</span>
                </div>
                <div>
                  Réponse : <b>{sub?.text ?? ''}</b>
                </div>
                <div className="row">
                  <button className="btn ok grow" onClick={() => send({ t: 'climax.judge', playerId: id, correct: true })}>
                    Correct (+{climaxWinDelta(c.bets[id], c.difficulty ?? 'hard')})
                  </button>
                  <button className="btn bad grow" onClick={() => send({ t: 'climax.judge', playerId: id, correct: false })}>
                    Faux (-{c.bets[id]})
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function ClimaxCountdown({ until }: { until: number | null }) {
  const now = useNow(250);
  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
  return <div className="bet-amount">{left}s</div>;
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
