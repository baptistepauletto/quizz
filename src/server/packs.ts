import { asc, eq } from 'drizzle-orm';
import { db, schema } from './db';
import type {
  DraftFile,
  PackDetail,
  PackStatus,
  PackSummary,
  QuestionDto,
  QuestionStatus,
} from '../shared/types';
import { BANKS } from '../shared/types';
import type { QuestionRec } from './game';

const { packs, themes, questions } = schema;

type Row = QuestionDto & { packId: number };

function summarise(pack: typeof packs.$inferSelect, rows: Row[]): PackSummary {
  const counts = {} as PackSummary['counts'];
  for (const b of BANKS) counts[b] = { draft: 0, approved: 0, rejected: 0 };
  for (const q of rows) counts[q.bank][q.status] += 1;
  return { id: pack.id, title: pack.title, status: pack.status, createdAt: pack.createdAt, counts };
}

function questionRows(packId?: number): Row[] {
  const base = db
    .select({ q: questions, t: themes })
    .from(questions)
    .innerJoin(themes, eq(questions.themeId, themes.id));
  const rows = (packId === undefined ? base : base.where(eq(themes.packId, packId)))
    .orderBy(asc(themes.sortOrder), asc(questions.id))
    .all();
  return rows.map(({ q, t }) => ({
    id: q.id,
    packId: t.packId,
    themeId: t.id,
    bank: t.bank,
    theme: t.label,
    contributor: t.contributorName,
    prompt: q.prompt,
    answer: q.answer,
    notes: q.notes,
    difficulty: q.difficulty,
    status: q.status,
    source: q.source,
  }));
}

export function listPacks(): PackSummary[] {
  const allPacks = db.select().from(packs).orderBy(asc(packs.id)).all();
  const all = questionRows();
  return allPacks
    .map((p) =>
      summarise(
        p,
        all.filter((q) => q.packId === p.id),
      ),
    )
    .reverse(); // newest first
}

export function getPack(id: number): PackDetail | null {
  const pack = db.select().from(packs).where(eq(packs.id, id)).get();
  if (!pack) return null;
  const rows = questionRows(id);
  return {
    ...summarise(pack, rows),
    questions: rows.map(({ packId: _packId, ...q }) => q),
  };
}

export function importDraft(draft: DraftFile): number {
  return db.transaction((tx) => {
    const pack = tx
      .insert(packs)
      .values({ title: draft.title, createdAt: Date.now(), status: 'draft' })
      .returning()
      .get();
    let sort = 0;
    for (const bank of BANKS) {
      for (const group of draft[bank]) {
        const theme = tx
          .insert(themes)
          .values({
            packId: pack.id,
            bank,
            label: group.theme,
            contributorName: group.contributor ?? null,
            sortOrder: sort++,
          })
          .returning()
          .get();
        for (const q of group.questions) {
          tx.insert(questions)
            .values({
              themeId: theme.id,
              prompt: q.prompt,
              answer: q.answer,
              notes: q.notes ?? null,
              difficulty: q.difficulty,
              status: 'draft',
              source: 'llm',
              createdAt: Date.now(),
            })
            .run();
        }
      }
    }
    return pack.id;
  });
}

export function setQuestionStatus(id: number, status: QuestionStatus): boolean {
  return db.update(questions).set({ status }).where(eq(questions.id, id)).run().changes > 0;
}

export function deletePack(id: number): boolean {
  return db.delete(packs).where(eq(packs.id, id)).run().changes > 0;
}

export type ReadyResult = { ok: true } | { ok: false; message: string };

/** A pack can be played once every bank has at least one approved question. */
export function setPackStatus(id: number, status: PackStatus): ReadyResult {
  const pack = getPack(id);
  if (!pack) return { ok: false, message: 'Pack not found.' };
  if (status === 'ready') {
    const missing = BANKS.filter((b) => pack.counts[b].approved === 0);
    if (missing.length > 0) {
      return { ok: false, message: `Approve at least one question in: ${missing.join(', ')}.` };
    }
  }
  db.update(packs).set({ status }).where(eq(packs.id, id)).run();
  return { ok: true };
}

/** Approved questions of a pack, ready to be frozen into a live game. */
export function approvedQuestions(packId: number): QuestionRec[] {
  return questionRows(packId)
    .filter((q) => q.status === 'approved')
    .map((q) => ({
      id: q.id,
      bank: q.bank,
      theme: q.theme,
      contributor: q.contributor,
      difficulty: q.difficulty,
      prompt: q.prompt,
      answer: q.answer,
      notes: q.notes,
    }));
}

export function getPackTitle(id: number): string | null {
  return db.select().from(packs).where(eq(packs.id, id)).get()?.title ?? null;
}

export function isPackReady(id: number): boolean {
  return db.select().from(packs).where(eq(packs.id, id)).get()?.status === 'ready';
}
