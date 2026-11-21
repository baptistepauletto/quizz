import type { CSSProperties, ReactNode } from 'react';
import { playerColors } from '../lib/colors';
import { Token } from './stage';
import type { Difficulty, MemoryView, PlayerView, TileView } from '../../shared/types';
import { DIFFICULTIES, MEMORY_POINTS, isMaisonContributor, nameKey } from '../../shared/types';

const DIFF_LABEL = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' } as const;
const ROW_SLOTS: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 2 };

export interface ContributorColumn {
  key: string;
  name: string;
  theme: string;
  color?: string;
  cards: TileView[];
}

export interface HouseBand {
  difficulty: Difficulty;
  label: string;
  cards: TileView[];
}

export interface OpenBoard {
  columns: ContributorColumn[];
  house: HouseBand[];
}

/** Contributor columns (theme once, cards by difficulty) then Maison bands. */
export function openBoard(memory: MemoryView, players: PlayerView[], colors: Map<string, string>): OpenBoard {
  const columns = new Map<string, ContributorColumn>();
  const house: Record<Difficulty, TileView[]> = { easy: [], medium: [], hard: [] };

  for (const tile of memory.tiles) {
    if (isMaisonContributor(tile.contributor) || !tile.difficulty) {
      if (tile.difficulty) house[tile.difficulty].push(tile);
      continue;
    }
    const key = nameKey(tile.contributor!);
    const column = columns.get(key);
    if (column) column.cards.push(tile);
    else {
      const owner = players.find((p) => nameKey(p.name) === key);
      columns.set(key, {
        key,
        name: owner?.name ?? tile.contributor!,
        theme: tile.theme ?? '',
        color: owner ? colors.get(owner.id) : undefined,
        cards: [tile],
      });
    }
  }

  const bySeat = new Map(players.map((p, i) => [nameKey(p.name), i]));
  const ordered = [...columns.values()].sort((a, b) => {
    const sa = bySeat.get(a.key);
    const sb = bySeat.get(b.key);
    if (sa !== undefined && sb !== undefined) return sa - sb;
    if (sa !== undefined) return -1;
    if (sb !== undefined) return 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  for (const column of ordered) {
    column.cards.sort((a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty) || a.coord.localeCompare(b.coord));
    const themes = [...new Set(column.cards.map((t) => t.theme).filter(Boolean))];
    if (themes.length > 0) column.theme = themes.join(' · ');
  }
  for (const difficulty of DIFFICULTIES) {
    house[difficulty].sort((a, b) => (a.theme ?? '').localeCompare(b.theme ?? '', 'fr') || a.coord.localeCompare(b.coord));
  }

  return {
    columns: ordered,
    house: DIFFICULTIES.map((difficulty) => ({
      difficulty,
      label: DIFF_LABEL[difficulty],
      cards: house[difficulty],
    })).filter((band) => band.cards.length > 0),
  };
}

function difficultyRank(difficulty: Difficulty | undefined): number {
  return difficulty ? DIFFICULTIES.indexOf(difficulty) : DIFFICULTIES.length;
}

function longestWord(text: string): number {
  return Math.max(1, ...text.split(/\s+/).map((w) => w.length));
}

function slotsFor(cards: TileView[], difficulty: Difficulty): Array<TileView | null> {
  const mine = cards.filter((card) => card.difficulty === difficulty);
  const count = Math.max(ROW_SLOTS[difficulty], mine.length);
  return Array.from({ length: count }, (_, i) => mine[i] ?? null);
}

/** TV board: value cards per person, labeled Maison cards underneath. */
export function TvBoard({
  memory,
  players,
  colors,
}: {
  memory: MemoryView;
  players: PlayerView[];
  colors: Map<string, string>;
}) {
  const board = openBoard(memory, players, colors);
  return (
    <div className="board">
      {board.columns.length > 0 && (
        <div className="board-lanes">
          {board.columns.map((column) => (
            <section key={column.key} className="lane" style={{ '--owner': column.color ?? 'var(--copper)' } as CSSProperties}>
              <header className="lane-head">
                <Token name={column.name} color={column.color} />
                <span className="lane-name">{column.name}</span>
                <span className="lane-theme">{column.theme}</span>
              </header>
              <div className="lane-rows">
                {DIFFICULTIES.map((difficulty) => {
                  const slots = slotsFor(column.cards, difficulty);
                  return (
                    <div
                      key={difficulty}
                      className="lane-row"
                      style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
                    >
                      {slots.map((tile, i) =>
                        tile ? (
                          <ValueCard key={tile.coord} tile={tile} />
                        ) : (
                          <div key={`${difficulty}-empty-${i}`} className="tile empty" />
                        ),
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {board.house.length > 0 && (
        <div className="house">
          {board.house.map((band) => (
            <div key={band.difficulty} className="house-band">
              <div className={`house-label ${band.difficulty}`}>{band.label}</div>
              <div
                className="house-cards"
                style={{ gridTemplateColumns: `repeat(${Math.min(12, band.cards.length)}, minmax(0, 1fr))` }}
              >
                {band.cards.map((tile) => (
                  <HouseCard key={tile.coord} tile={tile} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ValueCard({ tile }: { tile: TileView }) {
  const points = tile.difficulty ? MEMORY_POINTS[tile.difficulty] : 0;
  const level = tile.difficulty ? DIFFICULTIES.indexOf(tile.difficulty) + 1 : 0;
  return (
    <CardShell tile={tile} variant="value">
      <span className="t-points">{points}</span>
      {tile.difficulty && (
        <span className="t-diff" aria-label={DIFF_LABEL[tile.difficulty]}>
          {Array.from({ length: level }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
    </CardShell>
  );
}

function HouseCard({ tile }: { tile: TileView }) {
  const level = tile.difficulty ? DIFFICULTIES.indexOf(tile.difficulty) + 1 : 0;
  return (
    <CardShell tile={tile} variant="house">
      <span className="t-top">
        <span className="t-maison">Maison</span>
        {tile.difficulty && (
          <span className="t-diff" aria-label={DIFF_LABEL[tile.difficulty]}>
            {Array.from({ length: level }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        )}
      </span>
      <span className="t-theme">
        <span style={{ '--word': longestWord(tile.theme ?? '') } as CSSProperties}>{tile.theme}</span>
      </span>
    </CardShell>
  );
}

function CardShell({
  tile,
  variant,
  children,
}: {
  tile: TileView;
  variant: 'value' | 'house';
  children: ReactNode;
}) {
  return (
    <div
      className={['tile', 'up', variant, tile.face, tile.difficulty ?? '', tile.result ?? '', variant === 'house' ? 'maison' : 'owned']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="tile-inner">
        <div className="tile-face tile-front">{children}</div>
        <div className="tile-face tile-back">
          {tile.result && <span className={`t-mark ${tile.result}`} aria-label={tile.result === 'hit' ? 'Trouvé' : 'Raté'} />}
        </div>
      </div>
    </div>
  );
}

const DIFF_SHORT: Record<Difficulty, string> = { easy: 'F', medium: 'M', hard: 'D' };

/** Host phone: one row of value cards per person, then the house bands. */
export function HostBoard({
  memory,
  players,
  selected,
  onSelect,
}: {
  memory: MemoryView;
  players: PlayerView[];
  selected: string | null;
  onSelect: (coord: string) => void;
}) {
  const board = openBoard(memory, players, playerColors(players));
  const locked = memory.status !== 'playing' || !!memory.askingCoord;
  return (
    <div className="host-board">
      {board.columns.map((column) => (
        <div key={column.key} className="host-lane">
          <div className="host-lane-head">
            <b style={{ color: column.color }}>{column.name}</b>
            <span className="muted grow">{column.theme}</span>
          </div>
          <div className="host-lane-cards">
            {column.cards.map((tile) => (
              <HostCard key={tile.coord} tile={tile} selected={selected} locked={locked} onSelect={onSelect} showTheme={false} />
            ))}
          </div>
        </div>
      ))}
      {board.house.map((band) => (
        <div key={band.difficulty} className="host-house">
          <div className={`host-house-label ${band.difficulty}`}>{band.label}</div>
          <div className="host-house-cards">
            {band.cards.map((tile) => (
              <HostCard key={tile.coord} tile={tile} selected={selected} locked={locked} onSelect={onSelect} showTheme />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HostCard({
  tile,
  selected,
  locked,
  onSelect,
  showTheme,
}: {
  tile: TileView;
  selected: string | null;
  locked: boolean;
  onSelect: (coord: string) => void;
  showTheme: boolean;
}) {
  const points = tile.difficulty ? MEMORY_POINTS[tile.difficulty] : 0;
  return (
    <button
      type="button"
      className={['host-tile', tile.face, tile.difficulty ?? '', tile.result ?? '', selected === tile.coord ? 'selected' : '']
        .filter(Boolean)
        .join(' ')}
      disabled={tile.face !== 'open' || locked}
      onClick={() => onSelect(tile.coord)}
    >
      {showTheme && <span className="host-tile-theme">{tile.theme}</span>}
      <span className="host-tile-points">{points}</span>
      {tile.difficulty && <span className={`host-tile-diff ${tile.difficulty}`}>{DIFF_SHORT[tile.difficulty]}</span>}
      {tile.result && <span className={`host-tile-mark ${tile.result}`}>{tile.result === 'hit' ? '✓' : '✗'}</span>}
    </button>
  );
}
