// Types shared by the server and the browser clients.
// The server is authoritative: clients only ever receive a *view* of the game,
// projected for their role (tv / host / play), and never write scores themselves.

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Bank = 'sprint' | 'memory' | 'climax';
export type Phase = 'lobby' | 'predictions' | 'sprint' | 'memory' | 'climax' | 'reveal' | 'results';
export type Role = 'tv' | 'host' | 'play';

/** Points awarded for a correct answer in phases 1 and 2. */
export const POINTS: Record<Difficulty, number> = { easy: 1, medium: 3, hard: 5 };

/**
 * Net points gained on a correct climax wager (stake stays in the score).
 * Easy ≈ 1.5× total, medium 2×, hard 3×. Wrong answers always lose the full wager.
 */
export function climaxWinDelta(wager: number, difficulty: Difficulty): number {
  const w = Math.max(0, Math.floor(wager));
  if (difficulty === 'easy') return Math.round(w / 2);
  if (difficulty === 'medium') return w;
  return 2 * w;
}

/** Chip-stack amount shown after a climax judgment (won stack = stake + net). */
export function climaxStackAmount(wager: number, correct: boolean, difficulty: Difficulty): number {
  const w = Math.max(0, Math.floor(wager));
  return correct ? w + climaxWinDelta(w, difficulty) : w;
}

/** Bonus for correctly predicting the night's winner (after climax, before podium). */
export const PREDICTION_BONUS = 5;

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const BANKS: Bank[] = ['sprint', 'memory', 'climax'];

/** Questions per round in one night. Memory 49 fills a 7×7 grid. */
export const NIGHT_SIZE: Record<Bank, number> = { sprint: 25, memory: 49, climax: 10 };

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
  /** Opening prediction: this player has picked a winner (target is secret until reveal). */
  hasPick: boolean;
  /** Climax only: this player cannot take part in the current round. */
  sitOut: boolean;
}

export interface QuestionView {
  id: number;
  theme: string;
  /** Who brought this theme to the night, if known. */
  contributor?: string;
  difficulty: Difficulty;
  points: number;
  prompt: string;
  /** Optional picture, TV and host only on ask. */
  image?: string;
  /**
   * Memory MCQ only: exactly four choices shown on TV/host after flip.
   * The correct one is `answer` (host-only until you judge).
   */
  options?: [string, string, string, string];
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

export type ClimaxStatus = 'idle' | 'announce' | 'betting' | 'answering' | 'asking' | 'resolved';

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

/** Locked player submissions shown on TV/host after the answer timer. */
export interface ClimaxSubmission {
  playerId: string;
  name: string;
  text: string;
  /** Points wagered — safe to show after lock (not during betting). */
  wager: number;
}

export interface ClimaxView {
  status: ClimaxStatus;
  /** Theme + difficulty are announced before the question is revealed. */
  theme: string | null;
  difficulty: Difficulty | null;
  /**
   * Host: always once picked.
   * TV/play: from answering onwards (prompt only for play; official answer only when resolved).
   */
  question: QuestionView | null;
  /** /host only: questions that can still be picked. */
  candidates: ClimaxCandidate[];
  /** /host only: wagers by player id. */
  bets: Record<string, number>;
  /** /host only: players that still need to be judged. */
  pendingJudge: string[];
  /** /play only: your own current bet. */
  myBet: number | null;
  /** /play only: your typed answer while answering (and after lock). */
  myAnswer: string | null;
  /** When status is answering: wall-clock end of the typing window. */
  answerUntil: number | null;
  /** TV + host after lock: every bettor's name + answer + wager. */
  submissions: ClimaxSubmission[];
  results: ClimaxResult[];
}

export type PredictionStatus = 'idle' | 'open' | 'locked';

/** One opening prediction, revealed (or about to be) on the TV. */
export interface PredictionPick {
  voterId: string;
  targetId: string;
  /** Set once winners are frozen at the start of reveal. */
  correct: boolean | null;
}

export interface PredictionsView {
  status: PredictionStatus;
  /** /play only: who you picked (null if none yet). */
  myPick: string | null;
  /**
   * Host: always once someone has picked.
   * TV/play: only during reveal, truncated to `revealIndex + 1` (empty while teaser).
   */
  picks: PredictionPick[];
  /** Frozen at reveal start: everyone tied for #1 after climax. */
  winnerIds: string[];
  /**
   * Reveal cursor: -1 = teaser, 0..n-1 = last revealed pick index (all shown at n-1).
   * With zero picks, 0 means the empty reveal is done.
   */
  revealIndex: number;
  /** Whether the +PREDICTION_BONUS scores have been applied. */
  awarded: boolean;
  bonus: number;
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
  predictions: PredictionsView;
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
  | 'climax.answer'
  | 'climax.answers_locked'
  | 'climax.judged'
  | 'climax.resolved'
  | 'predictions.open'
  | 'predictions.pick'
  | 'predictions.locked'
  | 'reveal.next'
  | 'reveal.awarded'
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

export interface QuestionDto {
  id: number;
  sourceId: string;
  bank: Bank;
  theme: string;
  contributor: string | null;
  prompt: string;
  answer: string;
  notes: string | null;
  difficulty: Difficulty;
  status: QuestionStatus;
  /** Path relative to the pictures folder. */
  image: string | null;
  /** Memory MCQ: JSON-serialized 4 strings in DB; parsed in DTOs. */
  options: [string, string, string, string] | null;
}

/** One question in drafts/{bank}.json */
export interface BankDraftQuestion {
  id: string;
  theme: string;
  prompt: string;
  answer: string;
  difficulty: Difficulty;
  notes?: string;
  image?: string;
  /** Memory only: exactly four choices; `answer` must match one. */
  options?: [string, string, string, string];
  contributor?: string;
}

export interface BankDraftFile {
  questions: BankDraftQuestion[];
}

export interface PileSummary {
  approved: Record<Bank, number>;
  /** Questions picked by hand for the next night (0 = that round is drawn automatically). */
  prepared: Record<Bank, number>;
  tonight: Record<Bank, number>;
  /** Waiting for swipe (new or content-changed). */
  draft: number;
  rejected: number;
}

/** The prepared night: approved question ids per round, in play order. */
export interface NightPlanDto {
  selected: Record<Bank, number[]>;
  /** Question id → last time it was asked on the TV (ms). Missing = never asked. */
  asked: Record<number, number>;
}

export interface SyncResult {
  added: number;
  updated: number;
  rejected: number;
  unchanged: number;
  reviewCount: number;
  problems: { file: string; problems: string[] }[];
}
