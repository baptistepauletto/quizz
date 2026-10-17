import { DIFFICULTIES } from '../shared/types';
import type { Bank, BankDraftFile, BankDraftQuestion, Difficulty } from '../shared/types';
import { imageFileExists, normalizeImagePath } from './pictures';

export class DraftError extends Error {
  constructor(public problems: string[]) {
    super(problems.join('\n'));
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const ID_RE: Record<Bank, RegExp> = {
  sprint: /^s_\d+$/,
  memory: /^m_\d+$/,
  climax: /^c_\d+$/,
};

/** Validates drafts/{bank}.json. Images allowed on sprint and climax only. */
export function parseBankDraft(bank: Bank, raw: unknown): BankDraftFile {
  const problems: string[] = [];
  const bad = (msg: string) => {
    if (problems.length < 20) problems.push(msg);
  };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DraftError([`Le fichier ${bank} doit être { "questions": [ ... ] }.`]);
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.questions)) {
    throw new DraftError([`"questions" doit être un tableau.`]);
  }

  const seen = new Set<string>();
  const questions: BankDraftQuestion[] = [];

  obj.questions.forEach((q, qi) => {
    const where = `questions[${qi}]`;
    if (typeof q !== 'object' || q === null) return bad(`${where} doit être un objet.`);
    const rec = q as Record<string, unknown>;
    const id = str(rec.id);
    const theme = str(rec.theme);
    const prompt = str(rec.prompt);
    const answer = str(rec.answer);
    const difficulty = str(rec.difficulty).toLowerCase() as Difficulty;
    if (!id) bad(`${where}: "id" manquant.`);
    else if (!ID_RE[bank].test(id)) bad(`${where}: "id" doit matcher ${ID_RE[bank]} (ex. ${bank[0]}_001).`);
    else if (seen.has(id)) bad(`${where}: id en double "${id}".`);
    else seen.add(id);
    if (!theme) bad(`${where}: "theme" manquant.`);
    if (!prompt) bad(`${where}: "prompt" manquant.`);
    if (!answer) bad(`${where}: "answer" manquant.`);
    if (!DIFFICULTIES.includes(difficulty)) bad(`${where}: "difficulty" doit être easy, medium ou hard.`);

    const imageRaw = str(rec.image);
    let image: string | undefined;
    if (imageRaw) {
      if (bank === 'memory') bad(`${where}: les photos ne sont pas autorisées en grille.`);
      else {
        const rel = normalizeImagePath(imageRaw);
        if (!rel) bad(`${where}: "image" invalide (jpg/png/webp/gif sous pictures/).`);
        else if (!imageFileExists(rel)) bad(`${where}: photo introuvable pictures/${rel}.`);
        else image = rel;
      }
    }

    if (id && theme && prompt && answer && DIFFICULTIES.includes(difficulty) && (!imageRaw || image)) {
      const notes = str(rec.notes);
      const contributor = str(rec.contributor);
      questions.push({
        id,
        theme,
        prompt,
        answer,
        difficulty,
        ...(notes ? { notes } : {}),
        ...(image ? { image } : {}),
        ...(contributor ? { contributor } : {}),
      });
    }
  });

  if (problems.length > 0) throw new DraftError(problems);
  return { questions };
}

export function fingerprint(prompt: string, answer: string, difficulty: string): string {
  return `${prompt.trim()}\n${answer.trim()}\n${difficulty.trim().toLowerCase()}`;
}
