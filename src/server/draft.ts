import { BANKS, DIFFICULTIES } from '../shared/types';
import type { Bank, DraftFile, DraftGroup, DraftQuestion, Difficulty } from '../shared/types';
import { imageFileExists, normalizeImagePath } from './pictures';

export class DraftError extends Error {
  constructor(public problems: string[]) {
    super(problems.join('\n'));
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Validates (and normalises) a JSON draft file. Throws DraftError listing every problem found. */
export function parseDraft(raw: unknown): DraftFile {
  const problems: string[] = [];
  const bad = (msg: string) => {
    if (problems.length < 12) problems.push(msg);
  };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DraftError(['The file must be a JSON object: { "title": ..., "sprint": [...], "memory": [...], "climax": [...] }']);
  }
  const obj = raw as Record<string, unknown>;

  const title = str(obj.title);
  if (!title) bad('Missing "title".');

  const out: DraftFile = { title, sprint: [], memory: [], climax: [] };
  let total = 0;

  for (const bank of BANKS) {
    const groups = obj[bank];
    if (groups === undefined) continue;
    if (!Array.isArray(groups)) {
      bad(`"${bank}" must be an array of { theme, questions } groups.`);
      continue;
    }
    groups.forEach((g, gi) => {
      const where = `${bank}[${gi}]`;
      if (typeof g !== 'object' || g === null) return bad(`${where} must be an object.`);
      const group = g as Record<string, unknown>;
      const theme = str(group.theme);
      if (!theme) bad(`${where}: missing "theme".`);
      if (!Array.isArray(group.questions) || group.questions.length === 0) {
        bad(`${where} (${theme || '?'}): "questions" must be a non-empty array.`);
        return;
      }
      const questions: DraftQuestion[] = [];
      group.questions.forEach((q, qi) => {
        const qw = `${where}.questions[${qi}]`;
        if (typeof q !== 'object' || q === null) return bad(`${qw} must be an object.`);
        const rec = q as Record<string, unknown>;
        const prompt = str(rec.prompt);
        const answer = str(rec.answer);
        const difficulty = str(rec.difficulty).toLowerCase() as Difficulty;
        if (!prompt) bad(`${qw}: missing "prompt".`);
        if (!answer) bad(`${qw}: missing "answer".`);
        if (!DIFFICULTIES.includes(difficulty)) bad(`${qw}: "difficulty" must be easy, medium or hard.`);
        const imageRaw = str(rec.image);
        let image: string | undefined;
        if (imageRaw) {
          if (bank !== 'sprint') bad(`${qw}: pictures are only for sprint questions.`);
          else {
            const rel = normalizeImagePath(imageRaw);
            if (!rel) bad(`${qw}: "image" must be a jpg, png, webp or gif path inside the pictures folder, like "friends/corentin.jpg".`);
            else if (!imageFileExists(rel)) bad(`${qw}: picture not found at pictures/${rel}.`);
            else image = rel;
          }
        }
        if (prompt && answer && DIFFICULTIES.includes(difficulty) && (!imageRaw || image)) {
          const notes = str(rec.notes);
          questions.push({ prompt, answer, difficulty, ...(notes ? { notes } : {}), ...(image ? { image } : {}) });
        }
      });
      const contributor = str(group.contributor);
      const parsed: DraftGroup = { theme, questions, ...(contributor ? { contributor } : {}) };
      out[bank as Bank].push(parsed);
      total += questions.length;
    });
  }

  if (total === 0 && problems.length === 0) bad('The file contains no questions.');
  if (problems.length > 0) throw new DraftError(problems);
  return out;
}
