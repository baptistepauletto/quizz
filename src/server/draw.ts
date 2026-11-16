import type { Bank, Difficulty } from '../shared/types';
import {
  DIFFICULTIES,
  MEMORY_CONTRIBUTOR_QUOTA,
  MEMORY_CONTRIBUTOR_SLOTS,
  MEMORY_HOUSE_QUOTA,
  NIGHT_SIZE,
  isMaisonContributor,
  nameKey,
} from '../shared/types';
import type { QuestionRec } from './game';
import { shuffle } from './game';

export { NIGHT_SIZE };

/**
 * Draw one night from the approved pile.
 *
 * Never-asked questions come first. After that, the one asked longest ago.
 * A question that was drawn but never shown stays "never asked", so it is
 * still near the top next time. When the fresh cards run out, the oldest
 * asked ones come back.
 *
 * Sprint keeps a mix of easy / medium / hard. Memory seats up to eight
 * contributors at 1 easy / 2 medium / 2 hard, then 10 easy, 10 medium and
 * 10 hard Maison, spread across house themes. A short difficulty stays short.
 */
export function drawNight(questions: QuestionRec[], lastAsked: ReadonlyMap<number, number>): QuestionRec[] {
  return (['sprint', 'memory', 'climax'] as const).flatMap((bank) =>
    drawBank(
      bank,
      questions.filter((q) => q.bank === bank),
      lastAsked,
      NIGHT_SIZE[bank],
    ),
  );
}

/** `count` questions of one bank, with that bank's rules (difficulty mix, theme spread, freshness). */
export function drawBank(
  bank: Bank,
  items: QuestionRec[],
  lastAsked: ReadonlyMap<number, number>,
  count: number,
): QuestionRec[] {
  if (count <= 0) return [];
  if (bank === 'sprint') return drawSprint(items, lastAsked, count);
  if (bank === 'memory') return drawMemory(items, lastAsked, count);
  return drawFresh(items, lastAsked, count, true);
}

/** Never asked first, then oldest ask. Ties break on id so the pick is stable before the shuffle. */
function byFreshness(lastAsked: ReadonlyMap<number, number>) {
  return (a: QuestionRec, b: QuestionRec) => {
    const aa = lastAsked.get(a.id);
    const bb = lastAsked.get(b.id);
    if (aa === undefined && bb === undefined) return a.id - b.id;
    if (aa === undefined) return -1;
    if (bb === undefined) return 1;
    return aa - bb || a.id - b.id;
  };
}

function drawFresh(
  items: QuestionRec[],
  lastAsked: ReadonlyMap<number, number>,
  count: number,
  mix: boolean,
): QuestionRec[] {
  const picked = [...items].sort(byFreshness(lastAsked)).slice(0, count);
  return mix ? shuffle(picked) : picked;
}

/** About 3/8 easy, 3/8 medium, 2/8 hard. Short buckets are filled from whatever is left. */
function sprintQuotas(n: number): Record<Difficulty, number> {
  const easy = Math.floor((n * 3) / 8);
  const medium = Math.floor((n * 3) / 8);
  return { easy, medium, hard: n - easy - medium };
}

function drawSprint(items: QuestionRec[], lastAsked: ReadonlyMap<number, number>, count: number): QuestionRec[] {
  const n = Math.min(count, items.length);
  if (n === 0) return [];
  const buckets: Record<Difficulty, QuestionRec[]> = { easy: [], medium: [], hard: [] };
  for (const q of items) buckets[q.difficulty].push(q);
  const quota = sprintQuotas(n);
  const picked: QuestionRec[] = [];
  const used = new Set<number>();
  for (const difficulty of DIFFICULTIES) {
    for (const q of drawFresh(buckets[difficulty], lastAsked, quota[difficulty], false)) {
      picked.push(q);
      used.add(q.id);
    }
  }
  if (picked.length < n) {
    const rest = items.filter((q) => !used.has(q.id));
    for (const q of drawFresh(rest, lastAsked, n - picked.length, false)) picked.push(q);
  }
  return shuffle(picked);
}

/**
 * Contributor quota, then the house shelf.
 * `already` is what the night plan already holds, so a top-up does not deal a second easy
 * to someone who picked theirs by hand. Contributors already seated are kept even past
 * the slot cap; new ones are added, freshest first, only while a slot remains.
 */
export function drawMemory(
  pool: QuestionRec[],
  lastAsked: ReadonlyMap<number, number>,
  count: number,
  already: QuestionRec[] = [],
): QuestionRec[] {
  if (count <= 0) return [];
  const picked: QuestionRec[] = [];
  const poolGroups = groupContributors(pool);
  const alreadyGroups = groupContributors(already);
  const seated = seatedContributors(already, poolGroups, lastAsked);

  for (const key of seated) {
    const have = tally(alreadyGroups.get(key) ?? []);
    const available = poolGroups.get(key) ?? [];
    for (const difficulty of DIFFICULTIES) {
      const need = MEMORY_CONTRIBUTOR_QUOTA[difficulty] - have[difficulty];
      if (need <= 0) continue;
      const bucket = available.filter((q) => q.difficulty === difficulty);
      for (const q of drawFresh(bucket, lastAsked, need, false)) {
        if (picked.length >= count) return picked;
        picked.push(q);
      }
    }
  }

  const maisonHave = tally(already.filter((q) => isMaisonContributor(q.contributor)));
  const maisonPool = pool.filter((q) => isMaisonContributor(q.contributor));
  for (const difficulty of DIFFICULTIES) {
    const need = MEMORY_HOUSE_QUOTA[difficulty] - maisonHave[difficulty];
    if (need <= 0) continue;
    const room = count - picked.length;
    if (room <= 0) break;
    const bucket = maisonPool.filter((q) => q.difficulty === difficulty);
    picked.push(...drawSpread(bucket, lastAsked, Math.min(need, room)));
  }
  return picked;
}

function contributorKey(contributor: string | null): string | null {
  if (isMaisonContributor(contributor)) return null;
  return nameKey(contributor!);
}

function groupContributors(items: QuestionRec[]): Map<string, QuestionRec[]> {
  const groups = new Map<string, QuestionRec[]>();
  for (const q of items) {
    const key = contributorKey(q.contributor);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(q);
    groups.set(key, list);
  }
  return groups;
}

function tally(items: QuestionRec[]): Record<Difficulty, number> {
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const q of items) counts[q.difficulty] += 1;
  return counts;
}

function freshest(list: QuestionRec[], lastAsked: ReadonlyMap<number, number>): QuestionRec {
  return [...list].sort(byFreshness(lastAsked))[0];
}

/** People already on the plan, then the freshest newcomers, up to the slot cap. */
function seatedContributors(
  already: QuestionRec[],
  poolGroups: Map<string, QuestionRec[]>,
  lastAsked: ReadonlyMap<number, number>,
): string[] {
  const seated: string[] = [];
  const seen = new Set<string>();
  for (const q of already) {
    const key = contributorKey(q.contributor);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    seated.push(key);
  }
  const fresh = [...poolGroups.keys()].filter((key) => !seen.has(key));
  fresh.sort((a, b) => byFreshness(lastAsked)(freshest(poolGroups.get(a)!, lastAsked), freshest(poolGroups.get(b)!, lastAsked)));
  for (const key of fresh) {
    if (seated.length >= MEMORY_CONTRIBUTOR_SLOTS) break;
    seated.push(key);
  }
  return seated;
}

/** Round-robin across themes, freshest question of each theme first. Then shuffled. */
function drawSpread(items: QuestionRec[], lastAsked: ReadonlyMap<number, number>, count: number): QuestionRec[] {
  const groups = new Map<string, QuestionRec[]>();
  for (const q of items) {
    const key = q.theme.trim().toLocaleLowerCase();
    const list = groups.get(key) ?? [];
    list.push(q);
    groups.set(key, list);
  }
  for (const list of groups.values()) list.sort(byFreshness(lastAsked));
  const keys = [...groups.keys()].sort((a, b) => byFreshness(lastAsked)(groups.get(a)![0], groups.get(b)![0]));
  const picked: QuestionRec[] = [];
  while (picked.length < count) {
    let took = false;
    for (const key of keys) {
      if (picked.length >= count) break;
      const list = groups.get(key)!;
      if (list.length === 0) continue;
      picked.push(list.shift()!);
      took = true;
    }
    if (!took) break;
  }
  return shuffle(picked);
}
