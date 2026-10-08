// Types shared by the server and the browser clients.
// The server is authoritative: clients only ever receive a *view* of the game,
// projected for their role (tv / host / play), and never write scores themselves.

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Bank = 'sprint' | 'memory' | 'climax';
export type Phase = 'lobby' | 'sprint' | 'memory' | 'climax' | 'results';
export type Role = 'tv' | 'host' | 'play';

/** Points awarded for a correct answer in phases 1 and 2. */
export const POINTS: Record<Difficulty, number> = { easy: 1, medium: 3, hard: 5 };

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const BANKS: Bank[] = ['sprint', 'memory', 'climax'];

// ---------------------------------------------------------------------------
// Views (what clients receive)
// ---------------------------------------------------------------------------

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  /** Climax only: this player has placed a bet (amount is never shown publicly). */
  hasBet: boolean;
  /** Climax only: this player cannot take part in the current round. */
  sitOut: boolean;
}

export interface QuestionView {
  id: number;
  theme: string;
  difficulty: Difficulty;
  points: number;
  prompt: string;
  /** Sprint picture, TV and host only. Phones never receive it. */
  image?: string;
  /** Only sent to /host, or to /tv once the question is resolved. */
  answer?: string;
  /** Host cheat-sheet, /host only. */
  notes?: string;
}

export type SprintStatus = 'idle' | 'asking' | 'locked' | 'resolved';

export interface SprintView {
  index: number;
  total: number;
  status: SprintStatus;
  question: QuestionView | null;
  buzzPlayerId: string | null;
  lockedOut: string[];
}

export type TileFace = 'preview' | 'hidden' | 'asking' | 'consumed';

export interface TileView {
  coord: string;
  face: TileFace;
  result?: 'hit' | 'miss';
  /** Only present when the tile is face-up (preview / asking / consumed). */
  theme?: string;
  difficulty?: Difficulty;
}

export type MemoryStatus = 'idle' | 'preview' | 'playing' | 'finished';

export interface MemoryView {
  status: MemoryStatus;
  cols: number;
  rows: number;
  previewUntil: number | null;
  tiles: TileView[];
  turnPlayerId: string | null;
  askingCoord: string | null;
  asking: QuestionView | null;
  remaining: number;
}

export type ClimaxStatus = 'idle' | 'announce' | 'betting' | 'asking' | 'resolved';

export interface ClimaxCandidate {
  id: number;
  theme: string;
  difficulty: Difficulty;
  prompt: string;
  answer: string;
}

export interface ClimaxResult {
  playerId: string;
  wager: number;
  correct: boolean;
}

export interface ClimaxView {
  status: ClimaxStatus;
  /** Theme + difficulty are announced before the question is revealed. */
  theme: string | null;
  difficulty: Difficulty | null;
  /** Revealed from `asking` onwards (always visible to the host). */
  question: QuestionView | null;
  /** /host only: questions that can still be picked. */
  candidates: ClimaxCandidate[];
  /** /host only: wagers by player id. */
  bets: Record<string, number>;
  /** /host only: players that still need to be judged. */
  pendingJudge: string[];
  /** /play only: your own current bet. */
  myBet: number | null;
  results: ClimaxResult[];
}

export interface GameView {
  joinCode: string;
  packTitle: string;
  seq: number;
  phase: Phase;
  players: PlayerView[];
  sprint: SprintView;
  memory: MemoryView;
  climax: ClimaxView;
  /** /play only. */
  you: { playerId: string } | null;
}

// ---------------------------------------------------------------------------
// Events (SFX-ready, silent for now): every mutation can emit one or more.
// ---------------------------------------------------------------------------

export type GameEventType =
  | 'player.joined'
  | 'player.reconnected'
  | 'player.disconnected'
  | 'phase.changed'
  | 'sprint.question'
  | 'sprint.buzz_won'
  | 'sprint.pass'
  | 'sprint.resolved'
  | 'memory.preview'
  | 'memory.hidden'
  | 'memory.flipped'
  | 'memory.asking'
  | 'memory.consumed'
  | 'memory.turn'
  | 'climax.announce'
  | 'climax.betting_open'
  | 'climax.bet'
  | 'climax.betting_locked'
  | 'climax.revealed'
  | 'climax.judged'
  | 'climax.resolved'
  | 'score.updated';

export interface GameEvent {
  seq: number;
  type: GameEventType;
  at: number;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// /prep API shapes
// ---------------------------------------------------------------------------

export type QuestionStatus = 'draft' | 'approved' | 'rejected';
export type PackStatus = 'draft' | 'ready';

export interface PackSummary {
  id: number;
  title: string;
  status: PackStatus;
  createdAt: number;
  counts: Record<Bank, { draft: number; approved: number; rejected: number }>;
}

export interface QuestionDto {
  id: number;
  themeId: number;
  bank: Bank;
  theme: string;
  contributor: string | null;
  prompt: string;
  answer: string;
  notes: string | null;
  difficulty: Difficulty;
  status: QuestionStatus;
  source: 'llm' | 'manual';
  /** Path relative to the pictures folder, sprint questions only. */
  image: string | null;
}

export interface PackDetail extends PackSummary {
  questions: QuestionDto[];
}

/** JSON draft file format, written by the Cursor agent and imported in /prep. */
export interface DraftQuestion {
  prompt: string;
  answer: string;
  difficulty: Difficulty;
  notes?: string;
  /** Sprint only. Path relative to the pictures folder, e.g. "friends/corentin.jpg". */
  image?: string;
}

/** Approved questions waiting in the pile, and how many a night will draw. */
export interface PileSummary {
  approved: Record<Bank, number>;
  tonight: Record<Bank, number>;
}

export interface DraftGroup {
  theme: string;
  contributor?: string;
  questions: DraftQuestion[];
}

export interface DraftFile {
  title: string;
  sprint: DraftGroup[];
  memory: DraftGroup[];
  climax: DraftGroup[];
}
