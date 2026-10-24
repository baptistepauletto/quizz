import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ChipButton, ChipStack, Confetti, CountUp, CountdownRing, Token, useCountUp } from '../components/stage';
import { ConnectionPill, DifficultyChip, nameOf } from '../components/ui';
import { api } from '../lib/api';
import { playerColors } from '../lib/colors';
import { useGame } from '../lib/useGame';
import { climaxStackAmount, climaxWinDelta } from '../../shared/types';
import type { GameView, JoinOptionsDto, PlayerView } from '../../shared/types';
import type { UseGame } from '../lib/useGame';

const STORAGE_KEY = 'quizzin.play';

interface Session {
  code: string;
  name: string;
  playerId?: string;
}

function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(STORAGE_KEY);
}

export function Play() {
  const [params] = useSearchParams();
  const urlCode = (params.get('code') ?? '').toUpperCase();
  const stored = useMemo(loadSession, []);

  // Refreshing the page (or reopening the tab) silently rejoins the same seat.
  const [session, setSession] = useState<Session | null>(() =>
    stored && (!urlCode || urlCode === stored.code) ? stored : null,
  );
  const [notice, setNotice] = useState('');

  const game = useGame({
    hello: session ? { t: 'hello', role: 'play', code: session.code, name: session.name, playerId: session.playerId } : null,
  });
  const { state, synced, playerId, error, connection } = game;

  // Remember the seat id the server gave us, so a refresh can take it back.
  useEffect(() => {
    if (session && playerId && session.playerId !== playerId) {
      const next = { ...session, playerId };
      saveSession(next);
      setSession(next);
    }
  }, [session, playerId]);

  // Join refused (wrong code, name taken...): back to the form with the message.
  useEffect(() => {
    if (error?.code === 'join') {
      setNotice(error.message);
      setSession(null);
    } else if (error?.code === 'replaced') {
      setNotice(error.message);
      setSession(null);
    }
  }, [error]);

  // The host ended the game.
  useEffect(() => {
    if (session && connection === 'open' && synced && playerId && state === null) {
      saveSession(null);
      setSession(null);
      setNotice('La partie est terminée. Merci d’avoir joué !');
    }
  }, [session, connection, synced, playerId, state]);

  if (!session) {
    return (
      <JoinForm
        initialCode={urlCode || stored?.code || ''}
        initialName={stored?.name ?? ''}
        notice={notice}
        onJoin={(code, name) => {
          const sameSeat = stored && stored.code === code && stored.name.toLowerCase() === name.toLowerCase();
          const next: Session = { code, name, playerId: sameSeat ? stored?.playerId : undefined };
          saveSession(next);
          setNotice('');
          setSession(next);
        }}
      />
    );
  }

  const me = state?.players.find((p) => p.id === playerId);
  const myColor = me && state ? playerColors(state.players).get(me.id) : undefined;
  return (
    <div className="play" data-phase={state?.phase} style={{ '--me': myColor } as CSSProperties}>
      <div className="play-head">
        <div className="row">
          <Token name={me?.name ?? session.name} color={myColor} />
          <div>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {state ? `Salle ${state.joinCode}` : 'Connexion…'}
            </div>
            <b>{me?.name ?? session.name}</b>
          </div>
        </div>
        <PlayScore score={me?.score ?? 0} />
      </div>
      {state && me ? (
        <Body state={state} me={me} game={game} />
      ) : (
        <div className="play-body muted">Connexion…</div>
      )}
      <ConnectionPill connection={connection} />
    </div>
  );
}

function PlayScore({ score }: { score: number }) {
  const shown = useCountUp(score, 900);
  return (
    <div className="score">
      <CountUp value={score} />
      <ChipStack mode={shown > 0 ? 'shown' : 'empty'} amount={shown} showLabel={false} className="play-score-chips" />
    </div>
  );
}

/** Tonight's names for this room code, refreshed while the form is open; null when there is no list. */
function useGuestChoices(code: string): JoinOptionsDto['guests'] | null {
  const [guests, setGuests] = useState<JoinOptionsDto['guests'] | null>(null);
  const clean = code.trim().toUpperCase();
  useEffect(() => {
    setGuests(null);
    if (clean.length < 4) return;
    let live = true;
    const load = () =>
      api<JoinOptionsDto>('GET', `/api/join/${encodeURIComponent(clean)}`)
        .then((res) => live && setGuests(res.guests.length > 0 ? res.guests : null))
        .catch(() => live && setGuests(null));
    load();
    const id = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [clean]);
  return guests;
}

function JoinForm(props: {
  initialCode: string;
  initialName: string;
  notice: string;
  onJoin: (code: string, name: string) => void;
}) {
  const [code, setCode] = useState(props.initialCode);
  const [name, setName] = useState(props.initialName);
  const guests = useGuestChoices(code);
  const sorted = guests && [...guests].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return (
    <form
      className="home"
      onSubmit={(e) => {
        e.preventDefault();
        props.onJoin(code.trim().toUpperCase(), name.trim());
      }}
    >
      <h1 style={{ fontSize: '2.2rem' }}>
        <Logo />
      </h1>
      {props.notice && <p className="error">{props.notice}</p>}
      <div className="field">
        <label htmlFor="code">Code de la salle</label>
        <input
          id="code"
          className="input"
          value={code}
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
          style={{ fontSize: '2rem', letterSpacing: '0.3em', textAlign: 'center', textTransform: 'uppercase' }}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </div>
      {sorted ? (
        <div className="field">
          <label>Qui es-tu ?</label>
          <div className="guest-grid">
            {sorted.map((g) => (
              <button
                key={g.name}
                type="button"
                className="btn guest"
                disabled={g.taken}
                onClick={() => props.onJoin(code.trim().toUpperCase(), g.name)}
              >
                {g.name}
                {g.taken && <small>déjà là</small>}
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Ton prénom n’est pas là ? Demande à l’hôte de t’ajouter.
          </span>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="name">Ton prénom</label>
            <input
              id="name"
              className="input"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
            />
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Page rafraîchie par accident ? Retape le même prénom pour récupérer tes points.
            </span>
          </div>
          <button className="btn primary big" disabled={code.trim().length < 4 || !name.trim()}>
            Rejoindre
          </button>
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

function Body({ state, me, game }: { state: GameView; me: PlayerView; game: UseGame }) {
  const colors = playerColors(state.players);
  switch (state.phase) {
    case 'lobby':
      return (
        <div className="play-body">
          <Token name={me.name} color={colors.get(me.id)} className="hero" />
          <h2>Tu es dans la partie !</h2>
          <p className="muted">C’est ta couleur ce soir. Regarde la TV, l’hôte va bientôt lancer le jeu.</p>
        </div>
      );
    case 'predictions':
      return <PredictWinner state={state} me={me} game={game} colors={colors} />;
    case 'sprint':
      return <Buzzer state={state} me={me} game={game} />;
    case 'memory':
      return <MemoryInfo state={state} me={me} colors={colors} />;
    case 'climax':
      return <ClimaxPlayer state={state} me={me} game={game} />;
    case 'reveal':
      return (
        <div className="play-body">
          <h2>Révélation</h2>
          <p className="muted">Les paris s’affichent sur la TV. +{state.predictions.bonus} pts si tu as vu juste.</p>
          {state.predictions.myPick && (
            <p>
              Tu avais choisi <b>{nameOf(state.players, state.predictions.myPick)}</b>
            </p>
          )}
        </div>
      );
    case 'results': {
      const rank = [...state.players].sort((a, b) => b.score - a.score).findIndex((p) => p.id === me.id) + 1;
      return (
        <div className="play-body">
          <p className="muted">Résultat final</p>
          <div className="rank-big">#{rank}</div>
          <p>{me.score} points</p>
          {rank <= 3 && <Confetti colors={[colors.get(me.id) ?? '#ffd27a', '#ffd27a', '#f4efe4']} count={70} duration={3.5} />}
        </div>
      );
    }
  }
}

function PredictWinner({
  state,
  me,
  game,
  colors,
}: {
  state: GameView;
  me: PlayerView;
  game: UseGame;
  colors: Map<string, string>;
}) {
  const pred = state.predictions;
  const locked = pred.status === 'locked';
  const myPick = pred.myPick;
  return (
    <div className="play-body">
      <h2>Qui va gagner ?</h2>
      <p className="muted">
        {locked
          ? 'Paris verrouillés — on verra après la finale.'
          : `Tape un prénom. Tu peux changer jusqu’au verrouillage. +${pred.bonus} pts si tu as raison (peut changer le podium).`}
      </p>
      <div className="predict-pick-grid">
        {state.players.map((p) => {
          const selected = myPick === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`predict-pick ${selected ? 'selected' : ''}`}
              style={{ '--pc': colors.get(p.id) } as CSSProperties}
              disabled={locked}
              onClick={() => game.send({ t: 'predict', playerId: p.id })}
            >
              <Token name={p.name} color={colors.get(p.id)} />
              <span>{p.name}</span>
              {p.id === me.id && <small>toi</small>}
            </button>
          );
        })}
      </div>
      {myPick && !locked && <p className="muted">Choix enregistré — tu peux encore changer.</p>}
    </div>
  );
}

// --- Phase 1 -----------------------------------------------------------------

function Buzzer({ state, me, game }: { state: GameView; me: PlayerView; game: UseGame }) {
  const s = state.sprint;
  const lockedOut = s.lockedOut.includes(me.id);
  const iWon = s.status === 'locked' && s.buzzPlayerId === me.id;
  const canBuzz = s.status === 'asking' && !lockedOut;
  const [pressed, setPressed] = useState(false);

  let label = 'BUZZ';
  let hint = 'Attends la question…';
  if (s.status === 'asking') hint = lockedOut ? 'Tu es exclu de cette question' : 'Tape le plus vite possible !';
  else if (iWon) {
    label = 'TOI !';
    hint = 'Réponds à voix haute';
  } else if (s.status === 'locked') {
    label = nameOf(state.players, s.buzzPlayerId);
    hint = 'a buzzé en premier';
  } else if (s.status === 'resolved') hint = 'Question terminée';

  // pointerdown (not click): fires the instant the finger lands, no 300ms or release delay.
  const buzz = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!canBuzz) return;
    setPressed(true);
    game.send({ t: 'buzz' });
    navigator.vibrate?.(40);
  };

  return (
    <div className="play-body">
      <button
        className={`buzzer ${iWon ? 'won' : ''} ${pressed && canBuzz ? 'pressed' : ''}`}
        disabled={!canBuzz && !iWon}
        onPointerDown={buzz}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>
      <p className="muted">{hint}</p>
    </div>
  );
}

// --- Phase 2 -----------------------------------------------------------------

function MemoryInfo({ state, me, colors }: { state: GameView; me: PlayerView; colors: Map<string, string> }) {
  const m = state.memory;
  const myTurn = m.turnPlayerId === me.id;
  const asking = m.askingCoord ? m.tiles.find((t) => t.coord === m.askingCoord) : undefined;

  if (m.status === 'preview') {
    return (
      <div className="play-body">
        <h2>Mémorise !</h2>
        <p className="muted">Les thèmes sont sur la TV. Ils vont bientôt se retourner.</p>
      </div>
    );
  }
  if (asking) {
    return (
      <div className="play-body">
        <p className="muted">Case {asking.coord}</p>
        <h2>{asking.theme}</h2>
        {asking.difficulty && (
          <div>
            <DifficultyChip difficulty={asking.difficulty} />
          </div>
        )}
        <p className="muted">{myTurn ? 'C’est ta question, écoute !' : `${nameOf(state.players, m.turnPlayerId)} répond`}</p>
      </div>
    );
  }
  if (m.status === 'finished') {
    return (
      <div className="play-body">
        <h2>Grille terminée</h2>
        <p className="muted">En attente de la prochaine phase…</p>
      </div>
    );
  }
  return (
    <div className="play-body">
      {myTurn ? (
        <>
          <Token name={me.name} color={colors.get(me.id)} className="hero pulse" />
          <h2>À toi !</h2>
          <p>Annonce une case, par exemple B3.</p>
        </>
      ) : (
        <>
          <p className="muted">Au tour de</p>
          {m.turnPlayerId && (
            <Token name={nameOf(state.players, m.turnPlayerId)} color={colors.get(m.turnPlayerId)} className="hero" />
          )}
          <h2 style={{ color: m.turnPlayerId ? colors.get(m.turnPlayerId) : undefined }}>
            {nameOf(state.players, m.turnPlayerId)}
          </h2>
        </>
      )}
    </div>
  );
}

// --- Phase 3 -----------------------------------------------------------------

function ClimaxPlayer({ state, me, game }: { state: GameView; me: PlayerView; game: UseGame }) {
  const c = state.climax;
  const [amount, setAmount] = useState(0);

  // Start the slider at the bet already placed (e.g. after a refresh).
  useEffect(() => {
    if (c.myBet !== null) setAmount(c.myBet);
  }, [c.myBet]);
  useEffect(() => {
    if (c.status === 'announce') setAmount(0);
  }, [c.status]);

  if (c.status === 'idle') {
    return (
      <div className="play-body">
        <h2>Quitte ou double</h2>
        <p className="muted">Prépare-toi pour la finale…</p>
      </div>
    );
  }

  const header = (
    <>
      <p className="muted">Quitte ou double</p>
      <h2>{c.theme}</h2>
      {c.difficulty && (
        <div>
          <DifficultyChip difficulty={c.difficulty} withPoints={false} />
        </div>
      )}
    </>
  );

  if (me.sitOut) {
    return (
      <div className="play-body">
        {header}
        <p className="muted">Tu n’as plus de points à miser, tu passes ce tour.</p>
      </div>
    );
  }

  if (c.status === 'announce') {
    return (
      <div className="play-body">
        {header}
        <p className="muted">Réfléchis à combien tu veux risquer…</p>
      </div>
    );
  }

  if (c.status === 'betting') {
    const max = me.score;
    const placed = c.myBet !== null && c.myBet === amount;
    return (
      <div className="play-body">
        {header}
        <div className="bet-pile">
          <ChipStack mode="shown" amount={amount} />
          <div className="bet-amount">{amount}</div>
        </div>
        <div className="chip-row">
          {[1, 5, 10, 25].map((v) => (
            <ChipButton key={v} value={v} disabled={amount >= max} onClick={() => setAmount((a) => Math.min(max, a + v))} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(amount, max)}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Mise"
        />
        <div className="row">
          <button className="btn grow" onClick={() => setAmount(0)}>
            Reprendre
          </button>
          <button className="btn grow" onClick={() => setAmount(Math.floor(max / 2))}>
            Moitié
          </button>
          <button className="btn grow" onClick={() => setAmount(max)}>
            Tapis
          </button>
        </div>
        <button className="btn primary big" disabled={placed} onClick={() => game.send({ t: 'bet', amount })}>
          {placed ? 'Mise enregistrée' : 'Valider la mise'}
        </button>
        <p className="muted">
          {c.myBet === null ? 'Personne ne voit ta mise.' : 'Tu peux encore changer jusqu’au verrouillage.'}
        </p>
      </div>
    );
  }

  const result = c.results.find((r) => r.playerId === me.id);
  const wager = c.myBet ?? 0;

  if (c.status === 'answering') {
    return (
      <ClimaxAnswering
        header={header}
        wager={wager}
        question={c.question}
        answerUntil={c.answerUntil}
        myAnswer={c.myAnswer}
        game={game}
      />
    );
  }

  return (
    <div className="play-body">
      {header}
      {c.status === 'asking' && (
        <>
          <p className="muted">Réponses verrouillées · mise {wager}</p>
          {c.question?.prompt && <div className="prompt">{c.question.prompt}</div>}
          {wager > 0 ? (
            <p>
              Ta réponse : <b>{(c.myAnswer ?? '').trim() || '(vide — mise perdue)'}</b>
            </p>
          ) : (
            <p className="muted">Tu n’as pas misé.</p>
          )}
          <p className="muted">L’écran affiche toutes les réponses. L’hôte juge.</p>
        </>
      )}
      {c.status === 'resolved' &&
        (result ? (
          <>
            <div className={`bet-pile ${result.correct ? 'won' : 'lost'}`}>
              <ChipStack
                mode={result.correct ? 'won' : 'lost'}
                amount={climaxStackAmount(result.wager, result.correct, c.difficulty ?? 'hard')}
              />
            </div>
            <div className="bet-amount" style={{ color: result.correct ? 'var(--ok)' : 'var(--bad)' }}>
              {result.correct
                ? `+${climaxWinDelta(result.wager, c.difficulty ?? 'hard')}`
                : `-${result.wager}`}
            </div>
            <p>{result.correct ? 'Bien joué !' : 'Ta mise est perdue.'}</p>
          </>
        ) : (
          <p className="muted">Tu n’as pas misé ce tour.</p>
        ))}
    </div>
  );
}

function ClimaxAnswering({
  header,
  wager,
  question,
  answerUntil,
  myAnswer,
  game,
}: {
  header: React.ReactNode;
  wager: number;
  question: GameView['climax']['question'];
  answerUntil: number | null;
  myAnswer: string | null;
  game: UseGame;
}) {
  const [text, setText] = useState(myAnswer ?? '');

  useEffect(() => {
    setText(myAnswer ?? '');
  }, [myAnswer, question?.id]);

  useEffect(() => {
    if (wager <= 0) return;
    const t = setTimeout(() => {
      game.send({ t: 'answer', text });
    }, 280);
    return () => clearTimeout(t);
  }, [text, wager, game]);

  return (
    <div className="play-body">
      {header}
      <CountdownRing until={answerUntil} className="phone-ring" />
      {question?.image && <img className="q-photo" src={question.image} alt="" />}
      {question?.prompt && <div className="prompt">{question.prompt}</div>}
      <div className="muted">Mise en jeu : {wager}</div>
      {wager <= 0 ? (
        <p className="muted">Tu n’as pas misé — tu regardes seulement.</p>
      ) : (
        <>
          <textarea
            className="input"
            rows={3}
            maxLength={200}
            placeholder="Ta réponse…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <p className="muted">Tu peux modifier jusqu’à 0. Sans réponse = mise perdue.</p>
        </>
      )}
    </div>
  );
}
