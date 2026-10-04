import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

// Everything lives in one SQLite file next to the app (data/quizz-in.db by default).
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const sqlite = new Database(path.join(dataDir, 'quizz-in.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Tiny schema, so we create it directly instead of shipping migration files.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
  );
  CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    bank TEXT NOT NULL,
    label TEXT NOT NULL,
    contributor_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    notes TEXT,
    difficulty TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'llm',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_sessions (
    join_code TEXT PRIMARY KEY,
    pack_id INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_themes_pack ON themes(pack_id);
  CREATE INDEX IF NOT EXISTS idx_questions_theme ON questions(theme_id);
`);

export const db = drizzle(sqlite, { schema });
export { schema };
