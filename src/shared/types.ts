// Types shared by the server and the browser clients.
// The server is authoritative: clients only ever receive a *view* of the game,
// projected for their role (tv / host / play), and never write scores themselves.

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Bank = 'sprint' | 'memory' | 'climax';
export type Phase = 'lobby' | 'predictions' | 'sprint' | 'memory' | 'climax' | 'reveal' | 'results';
export type Role = 'tv' | 'host' | 'play';

/** Points awarded for a correct answer in the Sprint (phase 1). */
export const POINTS: Record<Difficulty, number> = { easy: 1, medium: 3, hard: 5 };

/** Base points for a correct active answer on the Grid (phase 2), before hints/leeches. */
export const MEMORY_POINTS: Record<Difficulty, number> = { easy: 2, medium: 4, hard: 6 };

/** Minimum payout the active player keeps when correct, even if leeches drain the card. */
export const MEMORY_FLOOR: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** Silent phone window for spectators to lock a leech answer. */
export const MEMORY_LEECH_MS = 15_000;

export function memoryMaxHints(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 0;
  if (difficulty === 'medium') return 1;
  return 2;
}

/** Point cost of applying hint number `n` (1-based). */
export function memoryHintCost(difficulty: Difficulty, n: number): number {
  if (difficulty === 'medium' && n === 1) return 2;
  if (difficulty === 'hard' && n === 1) return 1;
  if (difficulty === 'hard' && n === 2) return 2;
  return 0;
}

export function memoryHintsCostTotal(difficulty: Difficulty, hintsUsed: number): number {
  let total = 0;
  for (let i = 1; i <= hintsUsed; i++) total += memoryHintCost(difficulty, i);
  return total;
}

/** Card value after hints, before leech steals. */
export function memoryCurrentValue(difficulty: Difficulty, hintsUsed: number): number {
  return MEMORY_POINTS[difficulty] - memoryHintsCostTotal(difficulty, hintsUsed);
}

/** Active-player payout for a resolved grid card. */
export function memoryActivePayout(
  difficulty: Difficulty,
  hintsUsed: number,
  correctLeechCount: number,
  correct: boolean,
): number {
  if (!correct) return 0;
  return Math.max(MEMORY_FLOOR[difficulty], memoryCurrentValue(difficulty, hintsUsed) - correctLeechCount);
}

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
   * Memory choices: up to four (two after a 50/50 hint).
   * Shown on TV from the start only when `isMcq`; otherwise revealed by a format-drop hint.
   * The correct one is `answer` (host-only until you judge).
   */
  options?: string[];
  /** Memory: true when the four options are shown as soon as the card opens. */
  isMcq?: boolean;
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

/** `open` = available on the always-face-up grid; `asking` = live question; `consumed` = done. */
export type TileFace = 'open' | 'asking' | 'consumed';

export interface TileView {
  coord: string;
  face: TileFace;
  result?: 'hit' | 'miss';
  theme?: string;
  difficulty?: Difficulty;
  /** Who brought the theme, when known — used to tint tiles with a matching player color. */
  contributor?: string;
}

export type MemoryStatus = 'idle' | 'playing' | 'finished';

/** Phase of the currently opened grid card (null when none is open). */
export type MemoryAskStatus = 'leeching' | 'answering';

/** Spectator phone answer shown on the host dashboard after the leech window. */
export interface MemoryLeechSubmission {
  playerId: string;
  name: string;
  text: string;
}

export interface MemoryView {
  status: MemoryStatus;
  cols: number;
  rows: number;
  tiles: TileView[];
  turnPlayerId: string | null;
  askingCoord: string | null;
  asking: QuestionView | null;
  remaining: number;
  /** null when no card is open. */
  askStatus: MemoryAskStatus | null;
  /** Wall-clock end of the silent leech window (leeching only). */
  leechUntil: number | null;
  /** How many host hints have been applied on the open card. */
  hintsUsed: number;
  maxHints: number;
  /** Context clue on TV once Hard hint 1 is used (host always has notes on `asking`). */
  clue: string | null;
  /** /play: your locked leech text (null if none / you are active). */
  myLeech: string | null;
  /** /host once leeching ends: non-empty spectator answers to validate. */
  leeches: MemoryLeechSubmission[];
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
  | 'memory.started'
  | 'memory.flipped'
  | 'memory.asking'
  | 'memory.leech'
  | 'memory.leech_locked'
  | 'memory.hint'
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
  /** Memory: JSON-serialized 4 strings in DB; parsed in DTOs. */
  options: [string, string, string, string] | null;
  /**
   * Memory: when true, options are shown on TV as soon as the card opens.
   * When false, options (if any) are reserved for a format-drop hint.
   */
  isMcq: boolean;
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
  /**
   * Memory only: exactly four choices; `answer` must match one.
   * Use with `is_mcq: true` to show them immediately, or `is_mcq: false` to keep them for a hint.
   */
  options?: [string, string, string, string];
  /**
   * Memory only. JSON field name is `is_mcq`.
   * Defaults to true when `options` are present and the flag is omitted (legacy drafts).
   */
  is_mcq?: boolean;
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

/** Tonight's guests, as typed on /prep. Empty = anyone can type a name. */
export interface GuestsDto {
  names: string[];
}

/** What a phone sees before joining: the names it may pick for this room. */
export interface JoinOptionsDto {
  guests: Array<{
    name: string;
    /** Someone with this name is in the room and connected right now. */
    taken: boolean;
  }>;
}

export interface SyncResult {
  added: number;
  updated: number;
  rejected: number;
  unchanged: number;
  reviewCount: number;
  problems: { file: string; problems: string[] }[];
}
