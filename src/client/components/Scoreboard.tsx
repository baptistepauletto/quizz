import type { PlayerView } from '../../shared/types';

interface Props {
  players: PlayerView[];
  turnPlayerId?: string | null;
  buzzPlayerId?: string | null;
}

/**
 * Live ranking. The rows share the panel height (CSS grid 1fr rows), so ~10 players
 * fit as cleanly on a TV as 4 would, and the font scales with the screen height.
 */
export function Scoreboard({ players, turnPlayerId, buzzPlayerId }: Props) {
  const ranked = players
    .map((p, joinOrder) => ({ p, joinOrder }))
    .sort((a, b) => b.p.score - a.p.score || a.joinOrder - b.joinOrder);
  const max = Math.max(1, ...players.map((p) => p.score));
  const top = ranked[0]?.p.score ?? 0;

  return (
    <div className="scoreboard">
      {ranked.map(({ p }, i) => (
        <div
          key={p.id}
          className={[
            'score-row',
            p.connected ? '' : 'offline',
            top > 0 && p.score === top ? 'lead' : '',
            p.id === turnPlayerId ? 'turn' : '',
            p.id === buzzPlayerId ? 'buzz' : '',
            p.sitOut ? 'sit' : '',
          ].join(' ')}
        >
          <div className="bar" style={{ width: `${(p.score / max) * 100}%` }} />
          <span className="rank">{i + 1}</span>
          <span className="name">
            {p.name}
            {p.sitOut && <span className="tag"> sitting out</span>}
          </span>
          <span className="pts" key={p.score}>
            {p.score}
          </span>
        </div>
      ))}
    </div>
  );
}
