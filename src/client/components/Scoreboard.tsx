import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { playerColors } from '../lib/colors';
import type { PlayerView } from '../../shared/types';
import { ChipStack, Token, useCountUp } from './stage';

interface Props {
  players: PlayerView[];
  turnPlayerId?: string | null;
  buzzPlayerId?: string | null;
  /** Compact chip stacks next to the number (TV scoreboard). */
  chips?: boolean;
  /** One horizontal row of pills instead of a column (TV memory grid). */
  strip?: boolean;
}

interface Delta {
  value: number;
  key: number;
}

/** Remembers the last score change of each player for a couple of seconds. */
function useDeltas(players: PlayerView[]): Record<string, Delta> {
  const prev = useRef<Map<string, number> | null>(null);
  const [deltas, setDeltas] = useState<Record<string, Delta>>({});
  const signature = players.map((p) => `${p.id}:${p.score}`).join(',');

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(players.map((p) => [p.id, p.score]));
    if (!before) return;
    const changed: Record<string, Delta> = {};
    for (const p of players) {
      const old = before.get(p.id);
      if (old !== undefined && old !== p.score) changed[p.id] = { value: p.score - old, key: Date.now() };
    }
    if (Object.keys(changed).length === 0) return;
    setDeltas((d) => ({ ...d, ...changed }));
    setTimeout(() => {
      setDeltas((d) => {
        const next = { ...d };
        for (const k of Object.keys(changed)) if (next[k]?.key === changed[k].key) delete next[k];
        return next;
      });
    }, 2200);
  }, [signature]);

  return deltas;
}

/** Rows slide to their new rank instead of jumping (FLIP). */
function useFlip(order: string) {
  const rows = useRef(new Map<string, HTMLElement>());
  const spots = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    for (const [id, el] of rows.current) {
      const now = { x: el.offsetLeft, y: el.offsetTop };
      next.set(id, now);
      const before = spots.current.get(id);
      if (before && (before.x !== now.x || before.y !== now.y)) {
        el.animate([{ transform: `translate(${before.x - now.x}px, ${before.y - now.y}px)` }, { transform: 'none' }], {
          duration: 650,
          easing: 'cubic-bezier(.2,.9,.3,1.2)',
        });
      }
    }
    spots.current = next;
  }, [order]);
  return (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };
}

/**
 * Live ranking. The rows share the panel height (CSS grid 1fr rows), so ~10 players
 * fit as cleanly on a TV as 4 would, and the font scales with the screen height.
 */
export function Scoreboard({ players, turnPlayerId, buzzPlayerId, chips = false, strip = false }: Props) {
  const ranked = players
    .map((p, joinOrder) => ({ p, joinOrder }))
    .sort((a, b) => b.p.score - a.p.score || a.joinOrder - b.joinOrder);
  const top = ranked[0]?.p.score ?? 0;
  const colors = playerColors(players);
  const deltas = useDeltas(players);
  const ref = useFlip(ranked.map(({ p }) => p.id).join(','));

  return (
    <div className={['scoreboard', chips ? 'with-chips' : '', strip ? 'strip' : ''].join(' ')}>
      {ranked.map(({ p }, i) => {
        const delta = deltas[p.id];
        return (
          <div
            key={p.id}
            ref={ref(p.id)}
            style={{ '--pc': colors.get(p.id) } as CSSProperties}
            className={[
              'score-row',
              p.connected ? '' : 'offline',
              top > 0 && p.score === top ? 'lead' : '',
              p.id === turnPlayerId ? 'turn' : '',
              p.id === buzzPlayerId ? 'buzz' : '',
              p.sitOut ? 'sit' : '',
              delta ? (delta.value > 0 ? 'gain' : 'loss') : '',
            ].join(' ')}
          >
            <span className="rank">{i + 1}</span>
            <Token name={p.name} color={colors.get(p.id)} />
            <span className="name">
              {p.name}
              {p.sitOut && <span className="tag"> passe</span>}
            </span>
            <ScorePts score={p.score} delta={delta} chips={chips} />
          </div>
        );
      })}
    </div>
  );
}

function ScorePts({ score, delta, chips }: { score: number; delta?: Delta; chips: boolean }) {
  const shown = useCountUp(score, 900);
  return (
    <span className="pts">
      {delta && (
        <span className="delta" key={delta.key}>
          {delta.value > 0 ? `+${delta.value}` : delta.value}
        </span>
      )}
      {shown}
      {chips && (
        <ChipStack mode={shown > 0 ? 'shown' : 'empty'} amount={shown} showLabel={false} className="score-chips" />
      )}
    </span>
  );
}
