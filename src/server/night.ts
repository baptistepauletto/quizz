import { sqlite } from './db';
import { drawBank } from './draw';
import { shuffle } from './game';
import type { QuestionRec } from './game';
import { lastAsked } from './history';
import { approvedQuestions } from './packs';
import { BANKS, NIGHT_SIZE } from '../shared/types';
import type { Bank, NightPlanDto } from '../shared/types';

// The prepared night: the questions picked by hand on /prep, per round, in play order.
// A round with nothing picked falls back to the automatic draw when the game starts.
// The plan stays until it is changed, so ending and restarting a game keeps it.

type Selection = Record<Bank, number[]>;

function emptySelection(): Selection {
  return { sprint: [], memory: [], climax: [] };
}

function readSelection(): Selection {
  const rows = sqlite.prepare('SELECT question_id AS id, bank FROM night_plan ORDER BY bank, position').all() as {
    id: number;
    bank: Bank;
  }[];
  const out = emptySelection();
  for (const row of rows) if (BANKS.includes(row.bank)) out[row.bank].push(row.id);
  return out;
}

/** Drops ids that are no longer approved or sit in the wrong round, duplicates, and anything past the round size. */
function clean(selection: Partial<Selection>, approved: QuestionRec[]): Selection {
  const byId = new Map(approved.map((q) => [q.id, q]));
  const seen = new Set<number>();
  const out = emptySelection();
  for (const bank of BANKS) {
    for (const raw of selection[bank] ?? []) {
      const id = Number(raw);
      const q = byId.get(id);
      if (!q || q.bank !== bank || seen.has(id) || out[bank].length >= NIGHT_SIZE[bank]) continue;
      seen.add(id);
      out[bank].push(id);
    }
  }
  return out;
}

function write(selection: Selection): void {
  const insert = sqlite.prepare('INSERT INTO night_plan (question_id, bank, position) VALUES (?, ?, ?)');
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM night_plan').run();
    for (const bank of BANKS) selection[bank].forEach((id, i) => insert.run(id, bank, i));
  })();
}

function dto(selection: Selection): NightPlanDto {
  return { selected: selection, asked: Object.fromEntries(lastAsked()) };
}

export function getNightPlan(): NightPlanDto {
  return dto(clean(readSelection(), approvedQuestions()));
}

export function saveNightPlan(selection: Partial<Selection>): NightPlanDto {
  const next = clean(selection, approvedQuestions());
  write(next);
  return dto(next);
}

/** Tops up the given rounds to their full size with the automatic draw, keeping what was picked. */
export function fillNightPlan(banks: readonly Bank[]): NightPlanDto {
  const approved = approvedQuestions();
  const asked = lastAsked();
  const selection = clean(readSelection(), approved);
  for (const bank of banks) {
    const taken = new Set(selection[bank]);
    const pool = approved.filter((q) => q.bank === bank && !taken.has(q.id));
    const extra = drawBank(bank, pool, asked, NIGHT_SIZE[bank] - selection[bank].length);
    selection[bank].push(...extra.map((q) => q.id));
  }
  write(selection);
  return dto(selection);
}

/**
 * Tonight's questions: the prepared ones where a round has a selection, the
 * automatic draw elsewhere. Sprint and finale keep the prepared order; the
 * memory grid is shuffled onto the board anyway.
 */
export function nightHand(): QuestionRec[] {
  const approved = approvedQuestions();
  const asked = lastAsked();
  const selection = clean(readSelection(), approved);
  const byId = new Map(approved.map((q) => [q.id, q]));
  return BANKS.flatMap((bank) => {
    if (selection[bank].length === 0) {
      return drawBank(
        bank,
        approved.filter((q) => q.bank === bank),
        asked,
        NIGHT_SIZE[bank],
      );
    }
    const picked = selection[bank].map((id) => byId.get(id)!);
    return bank === 'memory' ? shuffle(picked) : picked;
  });
}
