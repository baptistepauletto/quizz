import { useEffect, useState } from 'react';
import type { Connection } from '../lib/useGame';
import { POINTS } from '../../shared/types';
import type { Difficulty, PlayerView } from '../../shared/types';

const DIFFICULTY_FR: Record<Difficulty, string> = {
  easy: 'facile',
  medium: 'moyen',
  hard: 'difficile',
};

export function DifficultyChip({
  difficulty,
  withPoints = true,
  points,
}: {
  difficulty: Difficulty;
  withPoints?: boolean;
  /** Override when phase points differ from Sprint (e.g. Grid). */
  points?: number;
}) {
  const pts = points ?? POINTS[difficulty];
  return (
    <span className={`chip ${difficulty}`}>
      {DIFFICULTY_FR[difficulty]}
      {withPoints ? ` · ${pts} pt${pts > 1 ? 's' : ''}` : ''}
    </span>
  );
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * French number formatting: 11384.31 → "11 384,31", keeping the decimals that were given.
 * Four-digit numbers stay ungrouped (French convention) so years read "1992", not "1 992".
 */
export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: Math.abs(n) >= 10000,
  });
}

/** Reformats the bare numbers inside an estimate answer ("2594.90 $" → "2594,90 $"); other text is left alone. */
export function formatNumbersIn(text: string): string {
  return text.replace(/\d+(?:\.\d+)?/g, (m) => formatNumber(Number(m), m.split('.')[1]?.length ?? 0));
}

export function nameOf(players: PlayerView[], id: string | null | undefined): string {
  return players.find((p) => p.id === id)?.name ?? '';
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Memory MCQ choices on TV / host / swipe. */
export function OptionsList({
  options,
  correct,
}: {
  options: readonly string[];
  /** When set (host), mark the matching choice. */
  correct?: string;
}) {
  return (
    <ol className="q-options">
      {options.map((text, i) => {
        const letter = OPTION_LETTERS[i] ?? String(i + 1);
        const isCorrect = correct !== undefined && text === correct;
        return (
          <li key={letter} className={isCorrect ? 'correct' : undefined}>
            <span className="q-opt-letter">{letter}</span>
            <span className="q-opt-text">{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small red pill when the socket is down, so nobody wonders why nothing moves. */
export function ConnectionPill({ connection }: { connection: Connection }) {
  if (connection === 'open') return null;
  return <div className="status-pill">{connection === 'connecting' ? 'Connexion…' : 'Reconnexion…'}</div>;
}
