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

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Validates drafts/{bank}.json. Optional images on any bank; MCQ options on memory only. */
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
      const rel = normalizeImagePath(imageRaw);
      if (!rel) bad(`${where}: "image" invalide (jpg/png/webp/gif sous pictures/).`);
      else if (!imageFileExists(rel)) bad(`${where}: photo introuvable pictures/${rel}.`);
      else image = rel;
    }

    let options: [string, string, string, string] | undefined;
    if (rec.options !== undefined) {
      if (bank !== 'memory') {
        bad(`${where}: "options" n’est autorisé qu’en grille mémoire.`);
      } else if (!Array.isArray(rec.options) || rec.options.length !== 4) {
        bad(`${where}: "options" doit être un tableau de exactement 4 chaînes.`);
      } else {
        const cleaned = rec.options.map((o, i) => {
          const s = str(o);
          if (!s) bad(`${where}: options[${i}] vide.`);
          return s;
        });
        if (cleaned.every(Boolean) && cleaned.length === 4) {
          const uniq = new Set(cleaned.map((s) => s.toLocaleLowerCase()));
          if (uniq.size !== 4) bad(`${where}: les 4 options doivent être distinctes.`);
          else if (!cleaned.some((o) => o === answer)) {
            bad(`${where}: "answer" doit être l’une des 4 options (texte exact).`);
          } else {
            options = cleaned as [string, string, string, string];
          }
        }
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
        ...(options ? { options } : {}),
        ...(contributor ? { contributor } : {}),
      });
    }
  });

  if (problems.length > 0) throw new DraftError(problems);
  return { questions };
}

export function fingerprint(
  prompt: string,
  answer: string,
  difficulty: string,
  options?: string[] | null,
): string {
  const opt = options && options.length ? `\n${JSON.stringify(options)}` : '';
  return `${prompt.trim()}\n${answer.trim()}\n${difficulty.trim().toLowerCase()}${opt}`;
}

export function serializeOptions(options: [string, string, string, string] | null | undefined): string | null {
  return options ? JSON.stringify(options) : null;
}

export function parseOptions(raw: string | null | undefined): [string, string, string, string] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'string' && x.trim())) return null;
    return v.map((x) => String(x).trim()) as [string, string, string, string];
  } catch {
    return null;
  }
}

export function optionLabel(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}
