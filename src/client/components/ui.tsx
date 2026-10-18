import { useEffect, useState } from 'react';
import type { Connection } from '../lib/useGame';
import { POINTS } from '../../shared/types';
import type { Difficulty, PlayerView } from '../../shared/types';

const DIFFICULTY_FR: Record<Difficulty, string> = {
  easy: 'facile',
  medium: 'moyen',
  hard: 'difficile',
};

export function DifficultyChip({ difficulty, withPoints = true }: { difficulty: Difficulty; withPoints?: boolean }) {
  const pts = POINTS[difficulty];
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
