import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConnectionPill, DifficultyChip, nameOf } from '../components/ui';
import { useGame } from '../lib/useGame';
import type { GameView, PlayerView } from '../../shared/types';
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
      setNotice('The game has ended. Thanks for playing!');
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
  return (
    <div className="play">
      <div className="play-head">
        <div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {state ? `Room ${state.joinCode}` : 'Joining…'}
          </div>
          <b>{me?.name ?? session.name}</b>
        </div>
        <div className="score" key={me?.score}>
          {me?.score ?? 0} <span className="muted" style={{ fontSize: '0.9rem' }}>pts</span>
        </div>
      </div>
      {state && me ? (
        <Body state={state} me={me} game={game} />
      ) : (
        <div className="play-body muted">Connecting…</div>
      )}
      <ConnectionPill connection={connection} />
    </div>
  );
}

function JoinForm(props: {
  initialCode: string;
  initialName: string;
  notice: string;
  onJoin: (code: string, name: string) => void;
}) {
  const [code, setCode] = useState(props.initialCode);
  const [name, setName] = useState(props.initialName);
  return (
    <form
      className="home"
      onSubmit={(e) => {
        e.preventDefault();
        props.onJoin(code.trim().toUpperCase(), name.trim());
      }}
    >
      <h1 className="brand" style={{ fontSize: '2.2rem' }}>
        Quizz <span>In</span>
      </h1>
      {props.notice && <p className="error">{props.notice}</p>}
      <div className="field">
        <label htmlFor="code">Room code</label>
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
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          className="input"
          value={name}
          maxLength={20}
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Refreshed by accident? Type the same name again to get your score back.
        </span>
      </div>
      <button className="btn primary big" disabled={code.trim().length < 4 || !name.trim()}>
        Join
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function Body({ state, me, game }: { state: GameView; me: PlayerView; game: UseGame }) {
  switch (state.phase) {
    case 'lobby':
      return (
        <div className="play-body">
          <h2>You&apos;re in!</h2>
          <p className="muted">Watch the TV. The host will start the game soon.</p>
        </div>
      );
    case 'sprint':
      return <Buzzer state={state} me={me} game={game} />;
    case 'memory':
      return <MemoryInfo state={state} me={me} />;
    case 'climax':
      return <ClimaxPlayer state={state} me={me} game={game} />;
    case 'results': {
      const rank = [...state.players].sort((a, b) => b.score - a.score).findIndex((p) => p.id === me.id) + 1;
      return (
        <div className="play-body">
          <p className="muted">Final result</p>
          <h2 style={{ fontSize: '4rem' }}>#{rank}</h2>
          <p>{me.score} points</p>
        </div>
      );
    }
  }
}

// --- Phase 1 -----------------------------------------------------------------

function Buzzer({ state, me, game }: { state: GameView; me: PlayerView; game: UseGame }) {
  const s = state.sprint;
  const lockedOut = s.lockedOut.includes(me.id);
  const iWon = s.status === 'locked' && s.buzzPlayerId === me.id;
  const canBuzz = s.status === 'asking' && !lockedOut;
  const [pressed, setPressed] = useState(false);

  let label = 'BUZZ';
  let hint = 'Wait for the question…';
  if (s.status === 'asking') hint = lockedOut ? 'You are locked out of this question' : 'Tap as fast as you can!';
  else if (iWon) {
    label = 'YOU!';
    hint = 'Answer out loud';
  } else if (s.status === 'locked') {
    label = nameOf(state.players, s.buzzPlayerId);
    hint = 'buzzed first';
  } else if (s.status === 'resolved') hint = 'Question over';

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

function MemoryInfo({ state, me }: { state: GameView; me: PlayerView }) {
  const m = state.memory;
  const myTurn = m.turnPlayerId === me.id;
  const asking = m.askingCoord ? m.tiles.find((t) => t.coord === m.askingCoord) : undefined;

  if (m.status === 'preview') {
    return (
      <div className="play-body">
        <h2>Memorise!</h2>
        <p className="muted">The themes are on the TV. They are about to flip face-down.</p>
      </div>
    );
  }
  if (asking) {
    return (
      <div className="play-body">
        <p className="muted">Tile {asking.coord}</p>
        <h2>{asking.theme}</h2>
        {asking.difficulty && (
          <div>
            <DifficultyChip difficulty={asking.difficulty} />
          </div>
        )}
        <p className="muted">{myTurn ? 'Your question, listen up!' : `${nameOf(state.players, m.turnPlayerId)} is answering`}</p>
      </div>
    );
  }
  if (m.status === 'finished') {
    return (
      <div className="play-body">
        <h2>Grid cleared</h2>
        <p className="muted">Waiting for the next phase…</p>
      </div>
    );
  }
  return (
    <div className="play-body">
      {myTurn ? (
        <>
          <h2>Your turn!</h2>
          <p>Call out a coordinate, like B3.</p>
        </>
      ) : (
        <>
          <p className="muted">Up now</p>
          <h2>{nameOf(state.players, m.turnPlayerId)}</h2>
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
        <h2>Double or Nothing</h2>
        <p className="muted">Get ready for the finale…</p>
      </div>
    );
  }

  const header = (
    <>
      <p className="muted">Double or Nothing</p>
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
        <p className="muted">You have no points to bet, so you sit this round out.</p>
      </div>
    );
  }

  if (c.status === 'announce') {
    return (
      <div className="play-body">
        {header}
        <p className="muted">Think about how much you want to risk…</p>
      </div>
    );
  }

  if (c.status === 'betting') {
    const max = me.score;
    const placed = c.myBet !== null && c.myBet === amount;
    return (
      <div className="play-body">
        {header}
        <div className="bet-amount">{amount}</div>
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(amount, max)}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Bet amount"
        />
        <div className="row">
          {[0.25, 0.5].map((f) => (
            <button key={f} className="btn grow" onClick={() => setAmount(Math.floor(max * f))}>
              {f * 100}%
            </button>
          ))}
          <button className="btn grow" onClick={() => setAmount(max)}>
            All in
          </button>
        </div>
        <button className="btn primary big" disabled={placed} onClick={() => game.send({ t: 'bet', amount })}>
          {placed ? 'Bet placed' : 'Place bet'}
        </button>
        <p className="muted">
          {c.myBet === null ? 'Nobody sees your bet.' : `You can change it until the host locks bets.`}
        </p>
      </div>
    );
  }

  // asking / resolved
  const result = c.results.find((r) => r.playerId === me.id);
  const wager = c.myBet ?? 0;
  return (
    <div className="play-body">
      {header}
      {c.status === 'asking' && (
        <>
          <p className="muted">Bets are locked</p>
          <div className="bet-amount">{wager}</div>
          <p className="muted">{wager === 0 ? 'You did not bet.' : 'at stake. Answer out loud!'}</p>
        </>
      )}
      {c.status === 'resolved' &&
        (result ? (
          <>
            <div className="bet-amount" style={{ color: result.correct ? 'var(--ok)' : 'var(--bad)' }}>
              {result.correct ? `+${2 * result.wager}` : `-${result.wager}`}
            </div>
            <p>{result.correct ? 'Your wager is tripled!' : 'Your wager is gone.'}</p>
          </>
        ) : (
          <p className="muted">You did not bet this round.</p>
        ))}
    </div>
  );
}
