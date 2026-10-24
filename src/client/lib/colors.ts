import type { PlayerView } from '../../shared/types';

/** Bright enough to carry dark ink text, distinct enough to tell apart across a living room. */
export const PLAYER_COLORS = [
  '#ff6b5b',
  '#2ec4b6',
  '#9b7bff',
  '#c6e05a',
  '#ff8fc7',
  '#4cc3ff',
  '#ffb648',
  '#7ee08a',
  '#f45d9a',
  '#6f95ff',
  '#e8d44d',
  '#c49bff',
] as const;

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text.toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Seeded by the name, so a player keeps their color after a reconnect and every
 * screen agrees without the server knowing about colors. Collisions are resolved
 * in join order.
 */
export function playerColors(players: readonly PlayerView[]): Map<string, string> {
  const taken = new Set<number>();
  const out = new Map<string, string>();
  for (const p of players) {
    let i = hash(p.name) % PLAYER_COLORS.length;
    for (let step = 0; step < PLAYER_COLORS.length && taken.has(i); step++) i = (i + 1) % PLAYER_COLORS.length;
    taken.add(i);
    out.set(p.id, PLAYER_COLORS[i]);
  }
  return out;
}

export function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}
