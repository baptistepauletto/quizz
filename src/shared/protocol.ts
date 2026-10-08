import type { GameEvent, GameView, Phase, Role } from './types';

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export type HelloMessage =
  | { t: 'hello'; role: 'tv' }
  | { t: 'hello'; role: 'host'; token: string }
  | { t: 'hello'; role: 'play'; code: string; name: string; playerId?: string };

export type PlayerMessage = { t: 'buzz' } | { t: 'bet'; amount: number };

/** Everything the host can do. Players can never send these. */
export type HostCommand =
  | { t: 'game.create' }
  | { t: 'game.end' }
  | { t: 'phase.set'; phase: Phase }
  | { t: 'score.adjust'; playerId: string; delta: number }
  | { t: 'player.kick'; playerId: string }
  // Phase 1
  | { t: 'sprint.next' }
  | { t: 'sprint.award' }
  | { t: 'sprint.pass' }
  | { t: 'sprint.skip' }
  // Phase 2
  | { t: 'memory.hide' }
  | { t: 'memory.flip'; coord: string }
  | { t: 'memory.resolve'; correct: boolean }
  | { t: 'memory.setTurn'; playerId: string }
  | { t: 'memory.skipTurn' }
  // Phase 3
  | { t: 'climax.pick'; questionId: number }
  | { t: 'climax.openBetting' }
  | { t: 'climax.lockBets' }
  | { t: 'climax.judge'; playerId: string; correct: boolean }
  | { t: 'climax.reset' };

export type ClientMessage = HelloMessage | PlayerMessage | HostCommand;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { t: 'hello.ok'; role: Role; playerId?: string }
  | { t: 'state'; state: GameView | null }
  | { t: 'event'; event: GameEvent }
  | { t: 'error'; code: 'auth' | 'join' | 'command' | 'bad'; message: string };
