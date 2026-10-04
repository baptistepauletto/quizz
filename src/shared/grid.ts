// Grid sizing and coordinates for the Memory Grid (phase 2).
// Columns are letters (A, B, C ...), rows are numbers (1, 2, 3 ...): "B3" = column B, row 3.

export interface GridSize {
  cols: number;
  rows: number;
}

const MIN_COLS = 4;
const MAX_COLS = 10;
const TARGET_ASPECT = 1.8; // TVs are wide: prefer more columns than rows

/** 50 tiles -> 10x5, 60 tiles -> 10x6, other counts -> best fit with few empty cells. */
export function computeGrid(count: number): GridSize {
  if (count <= 0) return { cols: MIN_COLS, rows: 1 };
  let best: GridSize & { score: number } | null = null;
  for (let cols = MIN_COLS; cols <= MAX_COLS; cols++) {
    const rows = Math.ceil(count / cols);
    const empty = cols * rows - count;
    const score = empty * 10 + Math.abs(cols / rows - TARGET_ASPECT);
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best!.cols, rows: best!.rows };
}

export function coordFor(col: number, row: number): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

/** Row-major list of the first `count` coordinates of a grid. */
export function coordsFor(size: GridSize, count: number): string[] {
  const out: string[] = [];
  for (let row = 0; row < size.rows; row++) {
    for (let col = 0; col < size.cols; col++) {
      if (out.length < count) out.push(coordFor(col, row));
    }
  }
  return out;
}

export function parseCoord(coord: string): { col: number; row: number } | null {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(coord.trim());
  if (!m) return null;
  return { col: m[1].toUpperCase().charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}
