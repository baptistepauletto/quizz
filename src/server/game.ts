import { randomInt, randomUUID } from 'node:crypto';
import { computeGrid, coordsFor } from '../shared/grid';
import { mediaUrl } from './pictures';
import type { HostCommand, PlayerMessage } from '../shared/protocol';
import {
  MEMORY_LEECH_MS,
  MEMORY_POINTS,
  POINTS,
  PREDICTION_BONUS,
  climaxWinDelta,
  memoryActivePayout,
  memoryCurrentValue,
  memoryMaxHints,
} from '../shared/types';
import type {
  Bank,
  ClimaxCandidate,
  ClimaxResult,
  ClimaxStatus,
  ClimaxView,
  Difficulty,
  GameEventType,
  GameView,
  MemoryAskStatus,
  MemoryStatus,
  MemoryView,
  Phase,
  PlayerView,
  PredictionPick,
  PredictionStatus,
  PredictionsView,
  QuestionView,
  Role,
  SprintStatus,
  SprintView,
  TileFace,
  TileView,
} from '../shared/types';

/** How long climax bettors have to type after the question is revealed. */
export const CLIMAX_ANSWER_MS = Number(process.env.CLIMAX_ANSWER_MS ?? 30_000);
export const MAX_PLAYERS = 16;
const MAX_NAME_LENGTH = 20;
const MAX_ANSWER_LENGTH = 200;

// ---------------------------------------------------------------------------
// Server-side state (JSON-serialisable so it can be snapshotted to SQLite)
// ---------------------------------------------------------------------------

export interface QuestionRec {
  id: number;
  bank: Bank;
  theme: string;
  contributor: string | null;
  difficulty: Difficulty;
  prompt: string;
  answer: string;
  notes: string | null;
  /** Memory Hard hint 1 — short clue for the TV (null = no context hint). */
  contextHint: string | null;
  /** Relative path inside the pictures folder. */
  image: string | null;
  /** Memory: four choices; `answer` is the correct text. */
  options: [string, string, string, string] | null;
  /** When true, options are shown on open; when false they wait for a format-drop hint. */
  isMcq: boolean;
}

export interface PlayerRec {
  id: string;
  name: string;
  nameKey: string;
  score: number;
  connected: boolean;
}

export interface TileRec {
  coord: string;
  questionId: number;
  face: TileFace;
  result?: 'hit' | 'miss';
}

export interface Game {
  joinCode: string;
  packId: number;
  packTitle: string;
  createdAt: number;
  seq: number;
  phase: Phase;
  players: PlayerRec[];
  questions: Record<number, QuestionRec>;
  sprint: {
    order: number[];
    index: number;
    status: SprintStatus;
    buzzPlayerId: string | null;
    /** Server arrival time of the winning buzz (hrtime, nanoseconds, as a string). */
    buzzNs: string | null;
    lockedOut: string[];
  };
  memory: {
    status: MemoryStatus;
    cols: number;
    rows: number;
    tiles: TileRec[];
    turnPlayerId: string | null;
    askingCoord: string | null;
    askStatus: MemoryAskStatus | null;
    leechUntil: number | null;
    /** Locked non-empty leech answers by player id. */
    leeches: Record<string, string>;
    hintsUsed: number;
    /** Options currently shown on TV (native MCQ or after a format-drop hint). */
    displayOptions: string[] | null;
    clueRevealed: boolean;
  };
  climax: {
    candidates: number[];
    used: number[];
    status: ClimaxStatus;
    questionId: number | null;
    eligible: string[];
    bets: Record<string, number>;
    /** Typed answers while status is answering (and frozen after lock). */
    answers: Record<string, string>;
    answerUntil: number | null;
    results: ClimaxResult[];
  };
  predictions: {
    status: PredictionStatus;
    /** voterId → targetPlayerId */
    picks: Record<string, string>;
    /** Frozen when entering reveal: everyone tied for #1 after climax. */
    winnerIds: string[];
    /** Join-order of voters who made a pick (stable reveal sequence). */
    revealOrder: string[];
    /** -1 teaser; 0..n-1 last revealed index; >= n all shown. */
    revealIndex: number;
    awarded: boolean;
  };
}

export class GameError extends Error {}

export type Emit = (type: GameEventType, payload?: Record<string, unknown>) => void;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O (easy to misread)

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame(packId: number, packTitle: string, questions: QuestionRec[]): Game {
  const byBank = (bank: Bank) => questions.filter((q) => q.bank === bank);
  const sprint = byBank('sprint');
  const climax = byBank('climax');
  return {
    joinCode: generateJoinCode(),
    packId,
    packTitle,
    createdAt: Date.now(),
    seq: 0,
    phase: 'lobby',
    players: [],
    questions: Object.fromEntries(questions.map((q) => [q.id, q])),
    sprint: {
      order: sprint.map((q) => q.id),
      index: -1,
      status: 'idle',
      buzzPlayerId: null,
      buzzNs: null,
      lockedOut: [],
    },
    memory: emptyMemory(),
    climax: {
      candidates: climax.map((q) => q.id),
      used: [],
      status: 'idle',
      questionId: null,
      eligible: [],
      bets: {},
      answers: {},
      answerUntil: null,
      results: [],
    },
    predictions: emptyPredictions(),
  };
}

function emptyPredictions(): Game['predictions'] {
  return {
    status: 'idle',
    picks: {},
    winnerIds: [],
    revealOrder: [],
    revealIndex: -1,
    awarded: false,
  };
}

function emptyMemory(): Game['memory'] {
  return {
    status: 'idle',
    cols: 0,
    rows: 0,
    tiles: [],
    turnPlayerId: null,
    askingCoord: null,
    askStatus: null,
    leechUntil: null,
    leeches: {},
    hintsUsed: 0,
    displayOptions: null,
    clueRevealed: false,
  };
}

function clearAsk(m: Game['memory']) {
  m.askingCoord = null;
  m.askStatus = null;
  m.leechUntil = null;
  m.leeches = {};
  m.hintsUsed = 0;
  m.displayOptions = null;
  m.clueRevealed = false;
}

/** Fill fields missing from older snapshots so a mid-game restart still loads. */
export function hydrateGame(g: Game): Game {
  if (!g.predictions) g.predictions = emptyPredictions();
  if (!g.memory) g.memory = emptyMemory();
  for (const q of Object.values(g.questions)) {
    if (q.isMcq === undefined) q.isMcq = q.options !== null;
    if (q.contextHint === undefined) q.contextHint = null;
  }
  const m = g.memory as Game['memory'] & { previewUntil?: number | null };
  if (m.askStatus === undefined) m.askStatus = m.askingCoord ? 'answering' : null;
  if (m.leechUntil === undefined) m.leechUntil = null;
  if (!m.leeches) m.leeches = {};
  if (m.hintsUsed === undefined) m.hintsUsed = 0;
  if (m.displayOptions === undefined) m.displayOptions = null;
  if (m.clueRevealed === undefined) m.clueRevealed = false;
  if ('previewUntil' in m) delete m.previewUntil;
  if ((m.status as string) === 'preview') m.status = 'playing';
  for (const t of m.tiles) {
    const face = t.face as string;
    if (face === 'preview' || face === 'hidden') t.face = 'open';
  }
  return g;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function nameKeyOf(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function cleanName(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

export interface JoinResult {
  player: PlayerRec;
  reconnected: boolean;
}

/**
 * Join, or reclaim an existing player by name (case-insensitive).
 * A name can be reclaimed when the previous connection is gone, or when the
 * caller proves it is the same device by presenting the player id it was given.
 */
export function joinPlayer(
  g: Game,
  rawName: string,
  claimId: string | undefined,
  hasLiveConnection: (playerId: string) => boolean,
  emit: Emit,
): JoinResult {
  const name = cleanName(rawName);
  if (!name) throw new GameError('Entre un prénom.');
  const key = nameKeyOf(name);

  const existing = g.players.find((p) => p.nameKey === key);
  if (existing) {
    if (claimId !== existing.id && hasLiveConnection(existing.id)) {
      throw new GameError('Ce prénom est déjà pris dans cette salle.');
    }
    existing.connected = true; // keep the display name as first typed ("ann" does not rename "Ann")
    emit('player.reconnected', { playerId: existing.id, name: existing.name });
    return { player: existing, reconnected: true };
  }

  if (g.players.length >= MAX_PLAYERS) throw new GameError('La salle est pleine.');
  const player: PlayerRec = { id: randomUUID(), name, nameKey: key, score: 0, connected: true };
  g.players.push(player);
  if (g.memory.status === 'playing' && !g.memory.turnPlayerId) g.memory.turnPlayerId = player.id;
  emit('player.joined', { playerId: player.id, name });
  return { player, reconnected: false };
}

export function setConnected(g: Game, playerId: string, connected: boolean, emit: Emit): boolean {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.connected === connected) return false;
  p.connected = connected;
  if (!connected) emit('player.disconnected', { playerId });
  return true;
}

function playerOf(g: Game, id: string): PlayerRec {
  const p = g.players.find((x) => x.id === id);
  if (!p) throw new GameError('Joueur inconnu.');
  return p;
}

function addScore(g: Game, playerId: string, delta: number, emit: Emit, reason: string) {
  const p = playerOf(g, playerId);
  p.score = Math.max(0, p.score + delta);
  emit('score.updated', { playerId, delta, score: p.score, reason });
}

function removePlayer(g: Game, playerId: string, emit: Emit) {
  playerOf(g, playerId); // throws if unknown
  if (g.memory.turnPlayerId === playerId) advanceTurn(g, emit);
  g.players = g.players.filter((x) => x.id !== playerId);
  if (g.memory.turnPlayerId === playerId) g.memory.turnPlayerId = null;
  g.sprint.lockedOut = g.sprint.lockedOut.filter((id) => id !== playerId);
  if (g.sprint.buzzPlayerId === playerId) {
    g.sprint.buzzPlayerId = null;
    g.sprint.buzzNs = null;
    if (g.sprint.status === 'locked') g.sprint.status = 'asking';
  }
  g.climax.eligible = g.climax.eligible.filter((id) => id !== playerId);
  delete g.climax.bets[playerId];
  delete g.climax.answers[playerId];
  delete g.memory.leeches[playerId];
  delete g.predictions.picks[playerId];
  for (const [voter, target] of Object.entries(g.predictions.picks)) {
    if (target === playerId) delete g.predictions.picks[voter];
  }
  g.predictions.revealOrder = g.predictions.revealOrder.filter((id) => id !== playerId && g.predictions.picks[id]);
  g.predictions.winnerIds = g.predictions.winnerIds.filter((id) => id !== playerId);
  maybeResolveClimax(g, emit);
}

// ---------------------------------------------------------------------------
// Player actions (never trusted with timestamps or scores)
// ---------------------------------------------------------------------------

/** Returns false when the action was ignored (nothing changed, nothing to broadcast). */
export function playerAction(g: Game, playerId: string, msg: PlayerMessage, emit: Emit): boolean {
  if (!g.players.some((p) => p.id === playerId)) return false;

  if (msg.t === 'buzz') {
    // Capture arrival time first thing: the server decides who was first.
    const ns = process.hrtime.bigint();
    const s = g.sprint;
    if (g.phase !== 'sprint' || s.status !== 'asking' || s.lockedOut.includes(playerId)) return false;
    s.status = 'locked';
    s.buzzPlayerId = playerId;
    s.buzzNs = ns.toString();
    emit('sprint.buzz_won', { playerId });
    return true;
  }

  if (msg.t === 'bet') {
    const c = g.climax;
    if (g.phase !== 'climax' || c.status !== 'betting') throw new GameError('Les paris ne sont pas ouverts.');
    if (!c.eligible.includes(playerId)) throw new GameError('Tu passes ce tour.');
    const player = playerOf(g, playerId);
    const amount = Math.floor(Number(msg.amount));
    if (!Number.isFinite(amount) || amount < 0) throw new GameError('Mise invalide.');
    c.bets[playerId] = Math.min(amount, player.score);
    emit('climax.bet', { playerId });
    return true;
  }

  if (msg.t === 'answer') {
    const text = String(msg.text ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ANSWER_LENGTH);

    if (g.phase === 'memory') return memoryLeechAnswer(g, playerId, text, emit);

    const c = g.climax;
    if (g.phase !== 'climax' || c.status !== 'answering') throw new GameError('Ce n’est pas le moment de répondre.');
    if (!c.eligible.includes(playerId)) throw new GameError('Tu passes ce tour.');
    if ((c.bets[playerId] ?? 0) <= 0) throw new GameError('Tu n’as pas misé.');
    c.answers[playerId] = text;
    emit('climax.answer', { playerId });
    return true;
  }

  if (msg.t === 'predict') {
    const pred = g.predictions;
    if (g.phase !== 'predictions' || pred.status !== 'open') {
      throw new GameError('Les paris sur le vainqueur ne sont pas ouverts.');
    }
    playerOf(g, msg.playerId); // target must exist
    pred.picks[playerId] = msg.playerId;
    emit('predictions.pick', { playerId });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Host commands
// ---------------------------------------------------------------------------

export function applyCommand(g: Game, cmd: HostCommand, emit: Emit): void {
  switch (cmd.t) {
    case 'phase.set':
      return setPhase(g, cmd.phase, emit);
    case 'score.adjust': {
      const delta = Math.trunc(Number(cmd.delta));
      if (!Number.isFinite(delta) || delta === 0) throw new GameError('Changement de score invalide.');
      return addScore(g, cmd.playerId, delta, emit, 'host');
    }
    case 'player.kick':
      return removePlayer(g, cmd.playerId, emit);

    // Phase 1
    case 'sprint.next':
      return sprintNext(g, emit);
    case 'sprint.award':
      return sprintAward(g, emit);
    case 'sprint.pass':
      return sprintPass(g, emit);
    case 'sprint.skip':
      return sprintSkip(g, emit);

    // Phase 2
    case 'memory.flip':
      return memoryFlip(g, cmd.coord, emit);
    case 'memory.endLeech':
      return memoryEndLeech(g, emit);
    case 'memory.hint':
      return memoryHint(g, emit);
    case 'memory.resolve':
      return memoryResolve(g, cmd.correct, cmd.leechIds ?? [], emit);
    case 'memory.setTurn':
      if (g.memory.askingCoord) throw new GameError('Termine d’abord la question en cours.');
      playerOf(g, cmd.playerId);
      g.memory.turnPlayerId = cmd.playerId;
      return emit('memory.turn', { playerId: cmd.playerId });
    case 'memory.skipTurn':
      if (g.memory.askingCoord) throw new GameError('Termine d’abord la question en cours.');
      return advanceTurn(g, emit);

    // Phase 3
    case 'climax.pick':
      return climaxPick(g, cmd.questionId, emit);
    case 'climax.openBetting':
      return climaxOpenBetting(g, emit);
    case 'climax.lockBets':
      return climaxLockBets(g, emit);
    case 'climax.lockAnswers':
      return climaxLockAnswers(g, emit);
    case 'climax.judge':
      return climaxJudge(g, cmd.playerId, cmd.correct, emit);
    case 'climax.reset':
      return climaxReset(g);

    case 'predictions.lock':
      return lockPredictions(g, emit);
    case 'reveal.next':
      return revealNext(g, emit);
    case 'reveal.all':
      return revealAll(g, emit);
    case 'reveal.award':
      return revealAward(g, emit);

    default:
      throw new GameError('Commande inconnue.');
  }
}

function setPhase(g: Game, phase: Phase, emit: Emit) {
  if (g.phase === phase) return;
  // Leaving the prediction mini-step without an explicit lock still seals the picks.
  if (g.phase === 'predictions' && g.predictions.status === 'open' && phase !== 'predictions') {
    lockPredictions(g, emit);
  }
  g.phase = phase;
  emit('phase.changed', { phase });
  if (phase === 'predictions' && g.predictions.status === 'idle') {
    g.predictions.status = 'open';
    emit('predictions.open', {});
  }
  if (phase === 'memory' && g.memory.status === 'idle') startMemory(g, emit);
  if (phase === 'reveal') beginReveal(g, emit);
}

function requirePhase(g: Game, phase: Phase) {
  if (g.phase !== phase) throw new GameError(`Ça ne marche que pendant la phase ${phase}.`);
}

function question(g: Game, id: number): QuestionRec {
  const q = g.questions[id];
  if (!q) throw new GameError('Question inconnue.');
  return q;
}

// --- Phase 1: the Sprint ----------------------------------------------------

function sprintNext(g: Game, emit: Emit) {
  requirePhase(g, 'sprint');
  const s = g.sprint;
  if (s.status === 'asking' || s.status === 'locked') {
    throw new GameError('Résous d’abord la question en cours (correct, faux ou passer).');
  }
  if (s.index + 1 >= s.order.length) throw new GameError('Plus de questions sprint.');
  s.index += 1;
  s.status = 'asking';
  s.buzzPlayerId = null;
  s.buzzNs = null;
  s.lockedOut = [];
  const q = question(g, s.order[s.index]);
  emit('sprint.question', { index: s.index, difficulty: q.difficulty, points: POINTS[q.difficulty] });
}

function currentSprintQuestion(g: Game): QuestionRec {
  return question(g, g.sprint.order[g.sprint.index]);
}

function sprintAward(g: Game, emit: Emit) {
  requirePhase(g, 'sprint');
  const s = g.sprint;
  if (s.status !== 'locked' || !s.buzzPlayerId) throw new GameError('Personne n’a buzzé.');
  const q = currentSprintQuestion(g);
  addScore(g, s.buzzPlayerId, POINTS[q.difficulty], emit, 'sprint');
  s.status = 'resolved';
  emit('sprint.resolved', { correct: true, playerId: s.buzzPlayerId });
}

/** Wrong answer / false start: the buzzer reopens, but that player is locked out of this question. */
function sprintPass(g: Game, emit: Emit) {
  requirePhase(g, 'sprint');
  const s = g.sprint;
  if (s.status !== 'locked' || !s.buzzPlayerId) throw new GameError('Personne n’a buzzé.');
  s.lockedOut.push(s.buzzPlayerId);
  emit('sprint.pass', { playerId: s.buzzPlayerId });
  s.buzzPlayerId = null;
  s.buzzNs = null;
  s.status = 'asking';
}

function sprintSkip(g: Game, emit: Emit) {
  requirePhase(g, 'sprint');
  const s = g.sprint;
  if (s.status !== 'asking' && s.status !== 'locked') throw new GameError('Aucune question à passer.');
  s.status = 'resolved';
  emit('sprint.resolved', { correct: false, playerId: null });
}

// --- Phase 2: Memory Grid -----------------------------------------------------

function startMemory(g: Game, emit: Emit) {
  const ids = shuffle(Object.values(g.questions).filter((q) => q.bank === 'memory').map((q) => q.id));
  const m = g.memory;
  Object.assign(m, emptyMemory());
  if (ids.length === 0) {
    m.status = 'finished';
    return;
  }
  const size = computeGrid(ids.length);
  const coords = coordsFor(size, ids.length);
  m.cols = size.cols;
  m.rows = size.rows;
  m.tiles = ids.map((questionId, i) => ({ coord: coords[i], questionId, face: 'open' as TileFace }));
  m.status = 'playing';
  m.turnPlayerId = g.players[0]?.id ?? null;
  emit('memory.started', { tiles: m.tiles.length });
  if (m.turnPlayerId) emit('memory.turn', { playerId: m.turnPlayerId });
}

function memoryFlip(g: Game, rawCoord: string, emit: Emit) {
  requirePhase(g, 'memory');
  const m = g.memory;
  if (m.status !== 'playing') throw new GameError('La grille n’est pas encore en jeu.');
  if (m.askingCoord) throw new GameError('Termine d’abord la question en cours.');
  const coord = String(rawCoord).trim().toUpperCase();
  const tile = m.tiles.find((t) => t.coord === coord);
  if (!tile) throw new GameError(`Il n’y a pas de case ${coord}.`);
  if (tile.face !== 'open') throw new GameError(`${coord} a déjà été jouée.`);
  const q = question(g, tile.questionId);
  tile.face = 'asking';
  m.askingCoord = coord;
  m.askStatus = 'leeching';
  m.leechUntil = Date.now() + MEMORY_LEECH_MS;
  m.leeches = {};
  m.hintsUsed = 0;
  m.displayOptions = q.isMcq && q.options ? [...q.options] : null;
  m.clueRevealed = false;
  emit('memory.flipped', { coord, theme: q.theme, difficulty: q.difficulty });
  emit('memory.asking', { coord });
  maybeEndLeechEarly(g, emit);
}

function memoryLeechAnswer(g: Game, playerId: string, text: string, emit: Emit): boolean {
  requirePhase(g, 'memory');
  const m = g.memory;
  if (m.askStatus !== 'leeching') throw new GameError('La fenêtre de leech est fermée.');
  if (playerId === m.turnPlayerId) throw new GameError('C’est ton tour : réponds à voix haute.');
  if (m.leeches[playerId] !== undefined) throw new GameError('Réponse déjà verrouillée.');
  if (!text) throw new GameError('Écris une réponse.');
  playerOf(g, playerId);
  m.leeches[playerId] = text;
  emit('memory.leech', { playerId });
  maybeEndLeechEarly(g, emit);
  return true;
}

/** Connected non-active players who still need to lock a leech (empty room = wait out the timer). */
function pendingLeechers(g: Game): PlayerRec[] {
  const m = g.memory;
  return g.players.filter((p) => p.connected && p.id !== m.turnPlayerId && m.leeches[p.id] === undefined);
}

function maybeEndLeechEarly(g: Game, emit: Emit) {
  const m = g.memory;
  if (m.askStatus !== 'leeching') return;
  const spectators = g.players.filter((p) => p.connected && p.id !== m.turnPlayerId);
  if (spectators.length > 0 && pendingLeechers(g).length === 0) memoryEndLeech(g, emit);
}

function memoryEndLeech(g: Game, emit: Emit) {
  requirePhase(g, 'memory');
  const m = g.memory;
  if (m.askStatus !== 'leeching') throw new GameError('Pas de fenêtre de leech à fermer.');
  m.askStatus = 'answering';
  m.leechUntil = null;
  emit('memory.leech_locked', { count: Object.keys(m.leeches).length });
}

/**
 * Tiered host hints (disabled until leech lock):
 * - Easy: none
 * - Medium: format drop (−2) — reveal MCQ or 50/50
 * - Hard: clue (−1) then format drop (−2)
 */
function memoryHint(g: Game, emit: Emit) {
  requirePhase(g, 'memory');
  const m = g.memory;
  if (!m.askingCoord || m.askStatus !== 'answering') {
    throw new GameError('Les indices ne sont dispo qu’après la fenêtre de leech.');
  }
  const tile = m.tiles.find((t) => t.coord === m.askingCoord)!;
  const q = question(g, tile.questionId);
  const next = m.hintsUsed + 1;
  if (next > memoryMaxHints(q.difficulty)) throw new GameError('Plus d’indice pour cette carte.');

  if (q.difficulty === 'hard' && next === 1) {
    if (!q.contextHint?.trim()) throw new GameError('Pas d’indice contexte (`context_hint`) sur cette question.');
    m.clueRevealed = true;
  } else {
    applyFormatDrop(m, q);
  }

  m.hintsUsed = next;
  emit('memory.hint', {
    hintsUsed: m.hintsUsed,
    points: memoryCurrentValue(q.difficulty, m.hintsUsed),
    clue: m.clueRevealed,
  });
}

/** Reveal 4 options on an open question, or strip two wrong answers on an MCQ (50/50). */
function applyFormatDrop(m: Game['memory'], q: QuestionRec) {
  if (!q.options) throw new GameError('Cette question n’a pas d’options pour l’indice.');
  const alreadyShowing = m.displayOptions !== null && m.displayOptions.length >= 2;
  if (alreadyShowing && m.displayOptions!.length <= 2) {
    throw new GameError('Le 50/50 est déjà appliqué.');
  }
  if (alreadyShowing) {
    m.displayOptions = fiftyFifty(q.options, q.answer);
  } else {
    m.displayOptions = [...q.options];
  }
}

/** Keep the correct answer and one random wrong choice. */
function fiftyFifty(options: [string, string, string, string], answer: string): string[] {
  const wrong = shuffle(options.filter((o) => o !== answer));
  const keepWrong = wrong[0] ?? options.find((o) => o !== answer) ?? options[0];
  return shuffle([answer, keepWrong]);
}

/** Hit or miss, the tile is consumed: each question is only ever asked once. */
function memoryResolve(g: Game, correct: boolean, leechIds: string[], emit: Emit) {
  requirePhase(g, 'memory');
  const m = g.memory;
  if (!m.askingCoord) throw new GameError('Aucune case n’est posée.');
  if (m.askStatus === 'leeching') throw new GameError('Attends la fin de la fenêtre de leech.');
  const tile = m.tiles.find((t) => t.coord === m.askingCoord)!;
  const q = question(g, tile.questionId);

  const validLeechIds = [
    ...new Set(leechIds.map((id) => String(id)).filter((id) => m.leeches[id] !== undefined && id !== m.turnPlayerId)),
  ];

  const payout = memoryActivePayout(q.difficulty, m.hintsUsed, validLeechIds.length, correct);
  if (correct) {
    if (!m.turnPlayerId) throw new GameError('Personne n’est au tour.');
    addScore(g, m.turnPlayerId, payout, emit, 'memory');
  }
  for (const id of validLeechIds) addScore(g, id, 1, emit, 'memory_leech');

  tile.face = 'consumed';
  tile.result = correct ? 'hit' : 'miss';
  emit('memory.consumed', {
    coord: tile.coord,
    result: tile.result,
    playerId: m.turnPlayerId,
    points: payout,
    hintsUsed: m.hintsUsed,
    leechIds: validLeechIds,
  });
  clearAsk(m);
  if (m.tiles.every((t) => t.face === 'consumed')) m.status = 'finished';
  advanceTurn(g, emit);
}

/** Round-robin: each player after the other, in join order. */
function advanceTurn(g: Game, emit: Emit) {
  const m = g.memory;
  if (g.players.length === 0) {
    m.turnPlayerId = null;
    return;
  }
  const i = g.players.findIndex((p) => p.id === m.turnPlayerId);
  const next = g.players[(i + 1) % g.players.length];
  m.turnPlayerId = next.id;
  emit('memory.turn', { playerId: next.id });
}

/** Called about once a second: ends the leech window / climax typing timer. */
export function tick(g: Game, emit: Emit): boolean {
  let changed = false;
  const m = g.memory;
  if (
    g.phase === 'memory' &&
    m.askStatus === 'leeching' &&
    m.leechUntil !== null &&
    Date.now() >= m.leechUntil
  ) {
    memoryEndLeech(g, emit);
    changed = true;
  }
  const c = g.climax;
  if (g.phase === 'climax' && c.status === 'answering' && c.answerUntil !== null && Date.now() >= c.answerUntil) {
    climaxLockAnswers(g, emit);
    changed = true;
  }
  return changed;
}

// --- Phase 3: Double or Nothing ---------------------------------------------------

function climaxPick(g: Game, questionId: number, emit: Emit) {
  requirePhase(g, 'climax');
  const c = g.climax;
  if (c.status === 'betting' || c.status === 'answering' || c.status === 'asking') {
    throw new GameError('Une manche est déjà en cours.');
  }
  if (!c.candidates.includes(questionId) || c.used.includes(questionId)) {
    throw new GameError('Cette question n’est pas disponible.');
  }
  const q = question(g, questionId);
  c.questionId = questionId;
  c.status = 'announce';
  c.eligible = [];
  c.bets = {};
  c.answers = {};
  c.answerUntil = null;
  c.results = [];
  emit('climax.announce', { theme: q.theme, difficulty: q.difficulty });
}

function climaxOpenBetting(g: Game, emit: Emit) {
  requirePhase(g, 'climax');
  const c = g.climax;
  if (c.status !== 'announce') throw new GameError('Annonce d’abord une question.');
  // Players with no points left sit this round out.
  c.eligible = g.players.filter((p) => p.score > 0).map((p) => p.id);
  c.bets = {};
  c.answers = {};
  c.status = 'betting';
  emit('climax.betting_open', { eligible: c.eligible.length });
}

function climaxLockBets(g: Game, emit: Emit) {
  requirePhase(g, 'climax');
  const c = g.climax;
  if (c.status !== 'betting') throw new GameError('Les paris ne sont pas ouverts.');
  for (const id of c.eligible) {
    const p = g.players.find((x) => x.id === id);
    c.bets[id] = Math.min(c.bets[id] ?? 0, p?.score ?? 0);
  }
  c.answers = {};
  c.status = 'answering';
  c.answerUntil = Date.now() + CLIMAX_ANSWER_MS;
  emit('climax.betting_locked', {});
  emit('climax.revealed', { questionId: c.questionId, answerUntil: c.answerUntil });
}

/** End the typing window: empty answers auto-lose the wager; host judges the rest. */
function climaxLockAnswers(g: Game, emit: Emit) {
  requirePhase(g, 'climax');
  const c = g.climax;
  if (c.status !== 'answering') throw new GameError('Les réponses ne sont pas ouvertes.');
  c.answerUntil = null;
  c.status = 'asking';
  emit('climax.answers_locked', {});
  for (const id of c.eligible) {
    const wager = c.bets[id] ?? 0;
    if (wager <= 0) continue;
    const text = (c.answers[id] ?? '').trim();
    if (!text) {
      addScore(g, id, -wager, emit, 'climax');
      c.results.push({ playerId: id, wager, correct: false });
      emit('climax.judged', { playerId: id, wager, correct: false, reason: 'empty' });
    }
  }
  maybeResolveClimax(g, emit);
}

function pendingJudge(g: Game): string[] {
  const c = g.climax;
  return c.eligible.filter(
    (id) => (c.bets[id] ?? 0) > 0 && (c.answers[id] ?? '').trim() !== '' && !c.results.some((r) => r.playerId === id),
  );
}

/** Correct: net gain scales with difficulty (≈1.5× / 2× / 3× total). Wrong: full wager lost. */
function climaxJudge(g: Game, playerId: string, correct: boolean, emit: Emit) {
  requirePhase(g, 'climax');
  const c = g.climax;
  if (c.status !== 'asking') throw new GameError('La question n’est pas ouverte au jugement.');
  if (!pendingJudge(g).includes(playerId)) throw new GameError('Ce joueur n’a rien à juger.');
  const wager = c.bets[playerId];
  const difficulty = c.questionId !== null ? question(g, c.questionId).difficulty : 'hard';
  const delta = correct ? climaxWinDelta(wager, difficulty) : -wager;
  addScore(g, playerId, delta, emit, 'climax');
  c.results.push({ playerId, wager, correct });
  emit('climax.judged', { playerId, wager, correct, delta, difficulty });
  maybeResolveClimax(g, emit);
}

// --- Opening predictions + reveal -------------------------------------------

function lockPredictions(g: Game, emit: Emit) {
  const pred = g.predictions;
  if (pred.status === 'locked') return;
  if (pred.status !== 'open' && g.phase !== 'predictions') {
    throw new GameError('Les paris sur le vainqueur ne sont pas ouverts.');
  }
  pred.status = 'locked';
  emit('predictions.locked', { count: Object.keys(pred.picks).length });
}

function beginReveal(g: Game, emit: Emit) {
  const pred = g.predictions;
  if (pred.status === 'open') lockPredictions(g, emit);
  const top = Math.max(0, ...g.players.map((p) => p.score));
  pred.winnerIds = g.players.filter((p) => p.score === top).map((p) => p.id);
  pred.revealOrder = g.players.map((p) => p.id).filter((id) => pred.picks[id]);
  pred.revealIndex = -1;
  pred.awarded = false;
}

function revealPicksComplete(pred: Game['predictions']): boolean {
  const n = pred.revealOrder.length;
  if (n === 0) return pred.revealIndex >= 0; // skip the teaser, then nothing to show
  return pred.revealIndex >= n - 1;
}

function revealNext(g: Game, emit: Emit) {
  requirePhase(g, 'reveal');
  const pred = g.predictions;
  if (revealPicksComplete(pred)) return;
  pred.revealIndex += 1;
  emit('reveal.next', { index: pred.revealIndex });
}

function revealAll(g: Game, emit: Emit) {
  requirePhase(g, 'reveal');
  const pred = g.predictions;
  pred.revealIndex = Math.max(0, pred.revealOrder.length - 1);
  emit('reveal.next', { index: pred.revealIndex });
}

function revealAward(g: Game, emit: Emit) {
  requirePhase(g, 'reveal');
  const pred = g.predictions;
  if (pred.awarded) throw new GameError('Les bonus ont déjà été appliqués.');
  if (!revealPicksComplete(pred)) throw new GameError('Révèle d’abord tous les paris.');
  const winners = new Set(pred.winnerIds);
  const paid: string[] = [];
  for (const voterId of pred.revealOrder) {
    const target = pred.picks[voterId];
    if (target && winners.has(target)) {
      addScore(g, voterId, PREDICTION_BONUS, emit, 'prediction');
      paid.push(voterId);
    }
  }
  pred.awarded = true;
  emit('reveal.awarded', { paid, bonus: PREDICTION_BONUS });
}

function maybeResolveClimax(g: Game, emit: Emit) {
  const c = g.climax;
  if (c.status !== 'asking') return;
  if (pendingJudge(g).length > 0) return;
  c.status = 'resolved';
  if (c.questionId !== null && !c.used.includes(c.questionId)) c.used.push(c.questionId);
  emit('climax.resolved', { questionId: c.questionId });
}

function climaxReset(g: Game) {
  const c = g.climax;
  c.status = 'idle';
  c.questionId = null;
  c.eligible = [];
  c.bets = {};
  c.answers = {};
  c.answerUntil = null;
  c.results = [];
}

function climaxSubmissions(g: Game): { playerId: string; name: string; text: string; wager: number }[] {
  const c = g.climax;
  return c.eligible
    .filter((id) => (c.bets[id] ?? 0) > 0)
    .map((id) => {
      const p = g.players.find((x) => x.id === id);
      return {
        playerId: id,
        name: p?.name ?? '?',
        text: (c.answers[id] ?? '').trim(),
        wager: c.bets[id] ?? 0,
      };
    });
}

// ---------------------------------------------------------------------------
// Views: what each role is allowed to see
// ---------------------------------------------------------------------------

function questionView(
  q: QuestionRec,
  opts: {
    answer: boolean;
    notes: boolean;
    image?: boolean;
    /** Override bank points (memory uses MEMORY_POINTS / post-hint value). */
    points?: number;
    /** Override options (memory hints / 50-50). `null` hides options. */
    options?: [string, string, string, string] | string[] | null;
  },
): QuestionView {
  const options = opts.options !== undefined ? opts.options : q.options;
  return {
    id: q.id,
    theme: q.theme,
    ...(q.contributor ? { contributor: q.contributor } : {}),
    difficulty: q.difficulty,
    points: opts.points ?? POINTS[q.difficulty],
    prompt: q.prompt,
    ...(opts.image && q.image ? { image: mediaUrl(q.image) } : {}),
    ...(options && options.length > 0
      ? { options: options as [string, string, string, string] }
      : {}),
    ...(q.bank === 'memory' ? { isMcq: q.isMcq } : {}),
    ...(opts.answer ? { answer: q.answer } : {}),
    ...(opts.notes && q.notes ? { notes: q.notes } : {}),
    ...(opts.notes && q.contextHint ? { contextHint: q.contextHint } : {}),
  };
}

/**
 * Projects the full server state into what a given role may see.
 * - play: no prompts, no answers, only their own bet
 * - tv: prompts once asked; answers + wagers only after the typing window locks; never live bets
 * - host: everything
 */
export function viewFor(g: Game, role: Role, playerId: string | null): GameView {
  const isHost = role === 'host';
  const isPlay = role === 'play';
  const c = g.climax;

  const sitOutOf = (id: string, score: number) => {
    if (g.phase !== 'climax' || c.status === 'idle') return false;
    return c.status === 'announce' ? score === 0 : !c.eligible.includes(id);
  };

  const players: PlayerView[] = g.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    hasBet: c.bets[p.id] !== undefined,
    hasPick: g.predictions.picks[p.id] !== undefined,
    sitOut: sitOutOf(p.id, p.score),
  }));

  // Sprint
  const s = g.sprint;
  const sprintQ = s.index >= 0 && s.status !== 'idle' ? g.questions[s.order[s.index]] : undefined;
  const sprint: SprintView = {
    index: s.index,
    total: s.order.length,
    status: s.status,
    buzzPlayerId: s.buzzPlayerId,
    lockedOut: s.lockedOut,
    question:
      sprintQ && !isPlay
        ? questionView(sprintQ, { answer: isHost || s.status === 'resolved', notes: isHost, image: true })
        : null,
  };

  // Memory — tiles stay face-up; phones never see the live prompt (TV / host only).
  const m = g.memory;
  const tiles: TileView[] = m.tiles.map((t) => {
    const q = g.questions[t.questionId];
    return {
      coord: t.coord,
      face: t.face,
      theme: q.theme,
      difficulty: q.difficulty,
      ...(q.contributor ? { contributor: q.contributor } : {}),
      ...(t.result ? { result: t.result } : {}),
    };
  });
  const askingTile = m.askingCoord ? m.tiles.find((t) => t.coord === m.askingCoord) : undefined;
  const askingQ = askingTile ? g.questions[askingTile.questionId] : undefined;
  const memoryPoints = askingQ ? memoryCurrentValue(askingQ.difficulty, m.hintsUsed) : 0;
  const memory: MemoryView = {
    status: m.status,
    cols: m.cols,
    rows: m.rows,
    tiles,
    turnPlayerId: m.turnPlayerId,
    askingCoord: m.askingCoord,
    asking:
      askingQ && !isPlay
        ? questionView(askingQ, {
            answer: isHost,
            notes: isHost,
            image: true,
            points: memoryPoints,
            // Host keeps the full bank key; TV only sees what's been revealed / 50-50'd.
            options: isHost ? askingQ.options : m.displayOptions,
          })
        : null,
    remaining: m.tiles.filter((t) => t.face !== 'consumed').length,
    askStatus: m.askStatus,
    leechUntil: m.askStatus === 'leeching' ? m.leechUntil : null,
    hintsUsed: m.hintsUsed,
    maxHints: askingQ ? memoryMaxHints(askingQ.difficulty) : 0,
    clue: askingQ && m.clueRevealed && askingQ.contextHint ? askingQ.contextHint : null,
    myLeech: isPlay && playerId ? (m.leeches[playerId] ?? null) : null,
    leeches:
      isHost && (m.askStatus === 'leeching' || m.askStatus === 'answering')
        ? Object.entries(m.leeches).map(([id, text]) => ({
            playerId: id,
            name: g.players.find((p) => p.id === id)?.name ?? '?',
            text,
          }))
        : [],
  };

  // Climax
  const cq = c.questionId !== null ? g.questions[c.questionId] : undefined;
  const questionLive = c.status === 'answering' || c.status === 'asking' || c.status === 'resolved';
  const candidates: ClimaxCandidate[] = isHost
    ? c.candidates
        .filter((id) => !c.used.includes(id))
        .map((id) => g.questions[id])
        .map((q) => ({ id: q.id, theme: q.theme, difficulty: q.difficulty, prompt: q.prompt, answer: q.answer }))
    : [];
  const showOfficialAnswer = isHost || c.status === 'resolved';
  const climax: ClimaxView = {
    status: c.status,
    theme: cq && c.status !== 'idle' ? cq.theme : null,
    difficulty: cq && c.status !== 'idle' ? cq.difficulty : null,
    question:
      cq && c.status !== 'idle' && (isHost || questionLive)
        ? questionView(cq, {
            answer: showOfficialAnswer,
            notes: isHost,
            image: true,
          })
        : null,
    candidates,
    bets: isHost ? c.bets : {},
    pendingJudge: isHost && c.status === 'asking' ? pendingJudge(g) : [],
    myBet: isPlay && playerId ? (c.bets[playerId] ?? null) : null,
    myAnswer: isPlay && playerId ? (c.answers[playerId] ?? null) : null,
    answerUntil: c.status === 'answering' ? c.answerUntil : null,
    submissions: c.status === 'asking' || c.status === 'resolved' ? climaxSubmissions(g) : [],
    results: c.results,
  };

  const predictions = predictionsView(g, role, playerId);

  return {
    joinCode: g.joinCode,
    packTitle: g.packTitle,
    seq: g.seq,
    phase: g.phase,
    players,
    sprint,
    memory,
    climax,
    predictions,
    you: isPlay && playerId ? { playerId } : null,
  };
}

function predictionsView(g: Game, role: Role, playerId: string | null): PredictionsView {
  const pred = g.predictions;
  const winners = new Set(pred.winnerIds);
  const frozen = g.phase === 'reveal' || g.phase === 'results' || pred.winnerIds.length > 0;

  const asPick = (voterId: string): PredictionPick => {
    const targetId = pred.picks[voterId]!;
    return {
      voterId,
      targetId,
      correct: frozen ? winners.has(targetId) : null,
    };
  };

  let picks: PredictionPick[] = [];
  if (role === 'host') {
    picks = Object.keys(pred.picks).map(asPick);
  } else if (g.phase === 'reveal' || g.phase === 'results') {
    const shown = pred.revealIndex < 0 ? 0 : Math.min(pred.revealIndex + 1, pred.revealOrder.length);
    picks = pred.revealOrder.slice(0, shown).map(asPick);
  }

  return {
    status: pred.status,
    myPick: role === 'play' && playerId ? (pred.picks[playerId] ?? null) : null,
    picks,
    winnerIds: g.phase === 'reveal' || g.phase === 'results' ? pred.winnerIds : [],
    revealIndex: pred.revealIndex,
    awarded: pred.awarded,
    bonus: PREDICTION_BONUS,
  };
}
