import { sqlite } from './db';

/** Remember which questions were actually shown, so the next night can leave them at the bottom. */
export function recordAsk(questionId: number, joinCode: string): void {
  sqlite
    .prepare('INSERT INTO question_asks (question_id, join_code, asked_at) VALUES (?, ?, ?)')
    .run(questionId, joinCode, Date.now());
}

/** question id -> last time it was shown. Missing means never asked. */
export function lastAsked(): Map<number, number> {
  const rows = sqlite
    .prepare('SELECT question_id AS id, MAX(asked_at) AS at FROM question_asks GROUP BY question_id')
    .all() as { id: number; at: number }[];
  return new Map(rows.map((row) => [row.id, row.at]));
}
