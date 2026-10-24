import { sqlite } from './db';
import { MAX_PLAYERS, cleanName, nameKeyOf } from './game';

// Tonight's guest list. When it is not empty, phones pick their name from it
// instead of typing one, and the server refuses names that are not on it.

export function readGuests(): string[] {
  return (sqlite.prepare('SELECT name FROM guests ORDER BY position').all() as { name: string }[]).map((r) => r.name);
}

/** Trims, drops blanks and duplicates (case-insensitive), and keeps at most one room's worth. */
export function saveGuests(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of raw) {
    const name = cleanName(String(value ?? ''));
    const key = nameKeyOf(name);
    if (!name || seen.has(key) || names.length >= MAX_PLAYERS) continue;
    seen.add(key);
    names.push(name);
  }
  const insert = sqlite.prepare('INSERT INTO guests (position, name) VALUES (?, ?)');
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM guests').run();
    names.forEach((name, i) => insert.run(i, name));
  })();
  return names;
}

export function isGuest(guests: string[], name: string): boolean {
  const key = nameKeyOf(cleanName(name));
  return guests.some((g) => nameKeyOf(g) === key);
}
