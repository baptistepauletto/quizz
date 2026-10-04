import { desc, eq, gt } from 'drizzle-orm';
import { db, schema } from './db';
import type { Game } from './game';

const { gameSessions } = schema;

/** Games older than this are not restored after a restart. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function saveSnapshot(game: Game): void {
  const stateJson = JSON.stringify(game);
  const updatedAt = Date.now();
  db.insert(gameSessions)
    .values({ joinCode: game.joinCode, packId: game.packId, stateJson, updatedAt })
    .onConflictDoUpdate({ target: gameSessions.joinCode, set: { stateJson, updatedAt } })
    .run();
}

export function deleteSnapshot(joinCode: string): void {
  db.delete(gameSessions).where(eq(gameSessions.joinCode, joinCode)).run();
}

/** The most recent game still worth resuming (e.g. the TV PC was restarted mid-game). */
export function loadLatestSnapshot(): Game | null {
  const row = db
    .select()
    .from(gameSessions)
    .where(gt(gameSessions.updatedAt, Date.now() - MAX_AGE_MS))
    .orderBy(desc(gameSessions.updatedAt))
    .get();
  if (!row) return null;
  try {
    const game = JSON.parse(row.stateJson) as Game;
    for (const p of game.players) p.connected = false; // nobody is connected after a restart
    return game;
  } catch {
    return null;
  }
}
