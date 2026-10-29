import { sqlite } from './db';
import type { Game } from './game';
import { POINTS } from '../shared/types';
import type { GameEventType } from '../shared/types';

// Results kept for stats across nights. Players get a new id every game, so rows
// store the player's name; the guest list keeps those names consistent.
// A game is only written once something scores, so lobby-only test games leave nothing.

type Round = 'sprint' | 'memory' | 'climax' | 'prediction' | 'adjust';

interface Play {
  round: Round;
  questionId?: number | null;
  playerId?: string | null;
  correct?: boolean | null;
  points?: number;
  wager?: number | null;
  answer?: string | null;
}

const gameIds = new Map<string, number>();

function gameKey(g: Game): string {
  return `${g.joinCode}:${g.createdAt}`;
}

function existingGameId(g: Game): number | null {
  const cached = gameIds.get(gameKey(g));
  if (cached !== undefined) return cached;
  const row = sqlite.prepare('SELECT id FROM games WHERE join_code = ? AND created_at = ?').get(g.joinCode, g.createdAt) as
    | { id: number }
    | undefined;
  if (row) gameIds.set(gameKey(g), row.id);
  return row?.id ?? null;
}

function gameIdFor(g: Game): number {
  const known = existingGameId(g);
  if (known !== null) return known;
  const id = Number(
    sqlite.prepare('INSERT INTO games (join_code, created_at) VALUES (?, ?)').run(g.joinCode, g.createdAt).lastInsertRowid,
  );
  gameIds.set(gameKey(g), id);
  return id;
}

function nameOf(g: Game, playerId: string | null | undefined): string | null {
  return g.players.find((p) => p.id === playerId)?.name ?? null;
}

function pointsOf(g: Game, questionId: number | null | undefined): number {
  const q = questionId == null ? undefined : g.questions[questionId];
  return q ? POINTS[q.difficulty] : 0;
}

function insert(g: Game, play: Play): void {
  sqlite
    .prepare(
      `INSERT INTO plays (game_id, at, round, question_id, player, correct, points, wager, answer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      gameIdFor(g),
      Date.now(),
      play.round,
      play.questionId ?? null,
      nameOf(g, play.playerId),
      play.correct == null ? null : play.correct ? 1 : 0,
      play.points ?? 0,
      play.wager ?? null,
      play.answer ?? null,
    );
}

/** Called for every event after the game state changed. */
export function recordEvent(g: Game, type: GameEventType, payload: Record<string, unknown>): void {
  const playerId = typeof payload.playerId === 'string' ? payload.playerId : null;
  switch (type) {
    case 'sprint.resolved': {
      const questionId = g.sprint.order[g.sprint.index];
      // Nobody found it: kept with no player so a question's hit rate stays honest.
      if (payload.correct) insert(g, { round: 'sprint', questionId, playerId, correct: true, points: pointsOf(g, questionId) });
      else insert(g, { round: 'sprint', questionId, correct: null });
      return;
    }
    case 'sprint.pass':
      return insert(g, { round: 'sprint', questionId: g.sprint.order[g.sprint.index], playerId, correct: false });
    case 'memory.consumed': {
      const tile = g.memory.tiles.find((t) => t.coord === payload.coord);
      const correct = payload.result === 'hit';
      const activePoints = Number(payload.points ?? 0);
      insert(g, {
        round: 'memory',
        questionId: tile?.questionId,
        playerId,
        correct,
        points: correct ? activePoints : 0,
      });
      const leechIds = Array.isArray(payload.leechIds)
        ? payload.leechIds.filter((id): id is string => typeof id === 'string')
        : [];
      for (const leechId of leechIds) {
        insert(g, {
          round: 'memory',
          questionId: tile?.questionId,
          playerId: leechId,
          correct: true,
          points: 1,
          answer: 'leech',
        });
      }
      return;
    }
    case 'climax.judged': {
      const correct = payload.correct === true;
      const wager = Number(payload.wager ?? 0);
      return insert(g, {
        round: 'climax',
        questionId: g.climax.questionId,
        playerId,
        correct,
        points: correct ? Number(payload.delta ?? 0) : -wager,
        wager,
        answer: playerId ? (g.climax.answers[playerId] ?? '').trim() || null : null,
      });
    }
    case 'reveal.awarded': {
      const winners = new Set(g.predictions.winnerIds);
      const bonus = Number(payload.bonus ?? 0);
      for (const [voterId, targetId] of Object.entries(g.predictions.picks)) {
        const correct = winners.has(targetId);
        insert(g, {
          round: 'prediction',
          playerId: voterId,
          correct,
          points: correct ? bonus : 0,
          answer: nameOf(g, targetId),
        });
      }
      return;
    }
    case 'score.updated':
      if (payload.reason === 'host') insert(g, { round: 'adjust', playerId, points: Number(payload.delta ?? 0) });
      return;
    default:
      return;
  }
}

/** Final scores and ranks (ties share a rank). Skipped for games where nothing was played. */
export function recordGameEnd(g: Game): void {
  const id = existingGameId(g);
  if (id === null) return;
  const ranked = [...g.players].sort((a, b) => b.score - a.score);
  const insertPlayer = sqlite.prepare('INSERT INTO game_players (game_id, name, score, rank) VALUES (?, ?, ?, ?)');
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE games SET ended_at = ? WHERE id = ?').run(Date.now(), id);
    sqlite.prepare('DELETE FROM game_players WHERE game_id = ?').run(id);
    ranked.forEach((p) => insertPlayer.run(id, p.name, p.score, ranked.findIndex((x) => x.score === p.score) + 1));
  })();
  gameIds.delete(gameKey(g));
}
