import type { CSSProperties } from 'react';
import { parseCoord } from '../../shared/grid';
import type { MemoryView, PlayerView, TileView } from '../../shared/types';
import { DIFFICULTIES } from '../../shared/types';

const DIFF_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' } as const;

function nameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Always-face-up TV grid: theme, difficulty dots, and optional contributor tint. */
export function TvGrid({
  memory,
  players,
  colors,
}: {
  memory: MemoryView;
  players: PlayerView[];
  colors: Map<string, string>;
}) {
  const cells: Array<TileView | null> = Array.from({ length: memory.cols * memory.rows }, () => null);
  for (const t of memory.tiles) {
    const pos = parseCoord(t.coord);
    if (pos) cells[pos.row * memory.cols + pos.col] = t;
  }

  return (
    <div
      className="mem-grid"
      style={{
        gridTemplateColumns: `repeat(${memory.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${memory.rows}, minmax(0, 1fr))`,
      }}
    >
      {cells.map((t, i) =>
        t ? (
          <Tile key={t.coord} tile={t} players={players} colors={colors} />
        ) : (
          <div key={`empty-${i}`} className="tile empty" />
        ),
      )}
    </div>
  );
}

function Tile({
  tile,
  players,
  colors,
}: {
  tile: TileView;
  players: PlayerView[];
  colors: Map<string, string>;
}) {
  const level = tile.difficulty ? DIFFICULTIES.indexOf(tile.difficulty) + 1 : 0;
  const owner = matchContributor(tile.contributor, players);
  const tint = owner ? colors.get(owner.id) : undefined;
  return (
    <div
      className={['tile', 'up', tile.face, tile.difficulty ?? '', tile.result ?? '', tint ? 'owned' : ''].join(' ')}
      style={tint ? ({ '--owner': tint } as CSSProperties) : undefined}
    >
      <div className="tile-inner">
        <div className="tile-face tile-front">
          <span className="t-top">
            <span className="t-coord">{tile.coord}</span>
            {tile.difficulty && (
              <span className="t-diff" aria-label={DIFF_LABEL[tile.difficulty]}>
                {Array.from({ length: level }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            )}
          </span>
          <span className="t-theme">
            <span>{tile.theme}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function matchContributor(contributor: string | undefined, players: PlayerView[]): PlayerView | undefined {
  if (!contributor) return undefined;
  const key = nameKey(contributor);
  return players.find((p) => nameKey(p.name) === key);
}
