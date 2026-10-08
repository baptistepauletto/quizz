import type { Difficulty } from '../shared/types';
import { DIFFICULTIES } from '../shared/types';
import type { QuestionRec } from './game';
import { shuffle } from './game';

/** How many questions a night draws from each bank. Fewer if the pile is smaller. */
export const NIGHT_SIZE = { sprint: 8, memory: 16, climax: 4 } as const;

/**
 * Draw one night from the approved pile.
 *
 * Never-asked questions come first. After that, the one asked longest ago.
 * A question that was drawn but never shown stays "never asked", so it is
 * still near the top next time. When the fresh cards run out, the oldest
 * asked ones come back.
 *
 * Sprint keeps a mix of easy / medium / hard. Memory spreads across themes
 * so the grid is not twelve tiles of the same subject.
 */
export function drawNight(questions: QuestionRec[], lastAsked: ReadonlyMap<number, number>): QuestionRec[] {
  const of = (bank: QuestionRec['bank']) => questions.filter((q) => q.bank === bank);
  return [
    ...drawSprint(of('sprint'), lastAsked, NIGHT_SIZE.sprint),
    ...drawSpread(of('memory'), lastAsked, NIGHT_SIZE.memory),
    ...drawFresh(of('climax'), lastAsked, NIGHT_SIZE.climax, true),
  ];
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

/** About 3 easy, 3 medium, 2 hard in a full hand of 8. Short buckets are filled from whatever is left. */
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

/** Round-robin across themes, freshest question of each theme first. Then shuffled onto the grid. */
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
