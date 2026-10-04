import { useEffect, useState } from 'react';
import type { Connection } from '../lib/useGame';
import { POINTS } from '../../shared/types';
import type { Difficulty, PlayerView } from '../../shared/types';

export function DifficultyChip({ difficulty, withPoints = true }: { difficulty: Difficulty; withPoints?: boolean }) {
  return (
    <span className={`chip ${difficulty}`}>
      {difficulty}
      {withPoints ? ` · ${POINTS[difficulty]} pt${POINTS[difficulty] > 1 ? 's' : ''}` : ''}
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

/** Small red pill when the socket is down, so nobody wonders why nothing moves. */
export function ConnectionPill({ connection }: { connection: Connection }) {
  if (connection === 'open') return null;
  return <div className="status-pill">{connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>;
}
