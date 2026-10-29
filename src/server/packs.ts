import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import type {
  Bank,
  BankDraftQuestion,
  PileSummary,
  QuestionDto,
  QuestionStatus,
  SyncResult,
} from '../shared/types';
import { BANKS } from '../shared/types';
import { DraftError, fingerprint, parseBankDraft, parseOptions, serializeOptions } from './draft';
import { NIGHT_SIZE } from './draw';
import type { QuestionRec } from './game';

/** Bank draft files live here: sprint.json, memory.json, climax.json */
export const DRAFTS_DIR = path.resolve(process.env.DRAFTS_DIR ?? 'drafts');

const { questions } = schema;

function resolveIsMcq(raw: number | null | undefined, options: [string, string, string, string] | null): boolean {
  if (raw === 1) return true;
  if (raw === 0) return false;
  return options !== null;
}

function toDto(row: typeof questions.$inferSelect): QuestionDto {
  const options = parseOptions(row.options);
  return {
    id: row.id,
    sourceId: row.sourceId,
    bank: row.bank,
    theme: row.theme,
    contributor: row.contributor,
    prompt: row.prompt,
    answer: row.answer,
    notes: row.notes,
    difficulty: row.difficulty,
    status: row.status,
    image: row.image,
    options,
    isMcq: resolveIsMcq(row.isMcq, options),
  };
}

function allRows(): QuestionDto[] {
  return db
    .select()
    .from(questions)
    .orderBy(asc(questions.bank), asc(questions.id))
    .all()
    .map(toDto);
}

export function setQuestionStatus(id: number, status: QuestionStatus): boolean {
  return db.update(questions).set({ status }).where(eq(questions.id, id)).run().changes > 0;
}

export function approvedQuestions(): QuestionRec[] {
  return allRows()
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
      image: q.image,
      options: q.options,
      isMcq: q.isMcq,
    }));
}

export function pileSummary(): PileSummary {
  const approved = { sprint: 0, memory: 0, climax: 0 };
  let draft = 0;
  let rejected = 0;
  for (const q of allRows()) {
    if (q.status === 'approved') approved[q.bank] += 1;
    else if (q.status === 'draft') draft += 1;
    else if (q.status === 'rejected') rejected += 1;
  }
  const prepared = preparedCounts();
  const tonight = { sprint: 0, memory: 0, climax: 0 };
  for (const bank of BANKS) tonight[bank] = prepared[bank] || Math.min(NIGHT_SIZE[bank], approved[bank]);
  return { approved, prepared, tonight, draft, rejected };
}

/** Hand-picked questions per round that are still approved (see night.ts). */
function preparedCounts(): Record<Bank, number> {
  const rows = sqlite
    .prepare(
      `SELECT n.bank AS bank, COUNT(*) AS n FROM night_plan n
       JOIN questions q ON q.id = n.question_id AND q.bank = n.bank AND q.status = 'approved'
       GROUP BY n.bank`,
    )
    .all() as { bank: Bank; n: number }[];
  const out = { sprint: 0, memory: 0, climax: 0 };
  for (const row of rows) if (BANKS.includes(row.bank)) out[row.bank] = Math.min(row.n, NIGHT_SIZE[row.bank]);
  return out;
}

export function pileQuestions(bank?: Bank): QuestionDto[] {
  return allRows().filter((q) => q.status === 'approved' && (!bank || q.bank === bank));
}

export function draftQuestions(): QuestionDto[] {
  return allRows().filter((q) => q.status === 'draft');
}

function applyDraftRow(bank: Bank, q: BankDraftQuestion): 'added' | 'updated' | 'unchanged' {
  const existing = db.select().from(questions).where(eq(questions.sourceId, q.id)).get();
  const draftIsMcq = q.is_mcq ?? false;
  const fp = fingerprint(q.prompt, q.answer, q.difficulty, q.options, draftIsMcq);
  const fields = {
    bank,
    theme: q.theme,
    contributor: q.contributor ?? null,
    prompt: q.prompt,
    answer: q.answer,
    notes: q.notes ?? null,
    difficulty: q.difficulty,
    image: q.image ?? null,
    options: serializeOptions(q.options),
    isMcq: q.options ? (draftIsMcq ? 1 : 0) : null,
  };

  if (!existing) {
    db.insert(questions)
      .values({
        sourceId: q.id,
        ...fields,
        status: 'draft',
        createdAt: Date.now(),
      })
      .run();
    return 'added';
  }

  const existingOptions = parseOptions(existing.options);
  const existingIsMcq = resolveIsMcq(existing.isMcq, existingOptions);
  const same =
    fingerprint(existing.prompt, existing.answer, existing.difficulty, existingOptions, existingIsMcq) === fp;
  // Re-adding a rejected id (even with the same text) puts it back in the inbox.
  if (same && existing.status !== 'rejected') {
    db.update(questions)
      .set({
        theme: fields.theme,
        contributor: fields.contributor,
        notes: fields.notes,
        image: fields.image,
        options: fields.options,
        isMcq: fields.isMcq,
        bank: fields.bank,
      })
      .where(eq(questions.id, existing.id))
      .run();
    return 'unchanged';
  }

  db.update(questions)
    .set({
      ...fields,
      status: 'draft',
    })
    .where(eq(questions.id, existing.id))
    .run();
  return 'updated';
}

/**
 * Diff drafts/{sprint,memory,climax}.json against the DB.
 * New / fingerprint-changed → draft (inbox). Missing from file → rejected.
 */
export function syncDraftsFromDisk(): SyncResult {
  const result: SyncResult = {
    added: 0,
    updated: 0,
    rejected: 0,
    unchanged: 0,
    reviewCount: 0,
    problems: [],
  };

  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  const seenIds = new Set<string>();

  for (const bank of BANKS) {
    const file = `${bank}.json`;
    const full = path.join(DRAFTS_DIR, file);
    if (!fs.existsSync(full)) {
      result.problems.push({ file, problems: ['Fichier manquant.'] });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      result.problems.push({ file, problems: [`JSON invalide : ${(err as Error).message}`] });
      continue;
    }
    let draft;
    try {
      draft = parseBankDraft(bank, raw);
    } catch (err) {
      if (err instanceof DraftError) result.problems.push({ file, problems: err.problems });
      else result.problems.push({ file, problems: [(err as Error).message] });
      continue;
    }

    for (const q of draft.questions) {
      seenIds.add(q.id);
      const kind = applyDraftRow(bank, q);
      result[kind] += 1;
    }
  }

  // Approved/draft rows whose source_id vanished from JSON → rejected.
  for (const row of db.select().from(questions).all()) {
    if (!seenIds.has(row.sourceId) && row.status !== 'rejected') {
      db.update(questions).set({ status: 'rejected' }).where(eq(questions.id, row.id)).run();
      result.rejected += 1;
    }
  }

  result.reviewCount = draftQuestions().length;
  return result;
}

/** @deprecated kept name for room imports */
export function getPackTitle(_id: number): string | null {
  return 'Ce soir';
}
