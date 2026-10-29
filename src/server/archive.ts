import fs from 'node:fs';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { DRAFTS_DIR } from './packs';
import { db, schema, sqlite } from './db';
import type { Game } from './game';
import { parseOptions } from './draft';
import type { Bank, Difficulty } from '../shared/types';

const { questions } = schema;

export interface ArchiveQuestion {
  sourceId: string;
  bank: Bank;
  theme: string;
  contributor: string | null;
  prompt: string;
  answer: string;
  notes: string | null;
  contextHint: string | null;
  difficulty: Difficulty;
  image: string | null;
  options: [string, string, string, string] | null;
  isMcq: boolean;
}

export interface EveningArchive {
  label: string;
  title: string;
  joinCode: string;
  archivedAt: number;
  questions: ArchiveQuestion[];
}

export function archiveDir(): string {
  const dir = path.join(DRAFTS_DIR, 'archive');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Distinct question ids that were actually shown on the TV for this room. */
export function askedIdsForJoin(joinCode: string): number[] {
  const rows = sqlite
    .prepare('SELECT DISTINCT question_id AS id FROM question_asks WHERE join_code = ?')
    .all(joinCode) as { id: number }[];
  return rows.map((r) => r.id);
}

function dayLabel(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function frenchTitle(d = new Date()): string {
  return `Soirée du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/**
 * Snapshot every question asked tonight into drafts/archive/, mark them archived
 * in the DB so they leave the live night pool, and drop them from the prepared plan.
 */
export function archiveEvening(g: Game): { label: string; count: number; file: string } {
  const ids = askedIdsForJoin(g.joinCode);
  const label = dayLabel();
  const setKey = `${label}-${g.joinCode}`;
  const fileName = `${setKey}.json`;
  const filePath = path.join(archiveDir(), fileName);

  const rows =
    ids.length > 0
      ? db.select().from(questions).where(inArray(questions.id, ids)).all()
      : [];

  const payload: EveningArchive = {
    label: setKey,
    title: frenchTitle(),
    joinCode: g.joinCode,
    archivedAt: Date.now(),
    questions: rows.map((row) => {
      const options = parseOptions(row.options);
      return {
        sourceId: row.sourceId,
        bank: row.bank,
        theme: row.theme,
        contributor: row.contributor,
        prompt: row.prompt,
        answer: row.answer,
        notes: row.notes,
        contextHint: row.contextHint ?? null,
        difficulty: row.difficulty,
        image: row.image,
        options,
        isMcq: row.isMcq === 1 || (row.isMcq == null && options !== null),
      };
    }),
  };

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    sqlite
      .prepare(`UPDATE questions SET status = 'archived', archive_set = ? WHERE id IN (${placeholders})`)
      .run(setKey, ...ids);
    sqlite.prepare(`DELETE FROM night_plan WHERE question_id IN (${placeholders})`).run(...ids);
  }

  return { label: setKey, count: payload.questions.length, file: fileName };
}
