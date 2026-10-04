import { parseCoord } from '../../shared/grid';
import type { MemoryView, TileView } from '../../shared/types';
import { DIFFICULTIES } from '../../shared/types';

/** The big TV grid: coordinates face-down, themes face-up during the preview and once played. */
export function TvGrid({ memory }: { memory: MemoryView }) {
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
        t ? <Tile key={t.coord} tile={t} /> : <div key={`empty-${i}`} className="tile empty" />,
      )}
    </div>
  );
}

function Tile({ tile }: { tile: TileView }) {
  const up = tile.face !== 'hidden';
  const level = tile.difficulty ? DIFFICULTIES.indexOf(tile.difficulty) + 1 : 0;
  return (
    <div className={['tile', up ? 'up' : '', tile.face, tile.difficulty ?? '', tile.result ?? ''].join(' ')}>
      <div className="tile-inner">
        <div className="tile-face tile-back">{tile.coord}</div>
        <div className="tile-face tile-front">
          <span className="t-coord">{tile.coord}</span>
          <span className="t-theme">{tile.theme}</span>
          <span className="t-diff" aria-label={tile.difficulty}>
            {Array.from({ length: level }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
