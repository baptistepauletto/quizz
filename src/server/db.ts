import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'quizz-in.db');

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

/** Schema v2: flat questions with source_id. Wipe legacy pack/theme DBs. */
const SCHEMA_VERSION = 3;
const ver = Number(sqlite.pragma('user_version', { simple: true }) ?? 0);
if (ver < 2) {
  sqlite.exec(`
    DROP TABLE IF EXISTS question_asks;
    DROP TABLE IF EXISTS game_sessions;
    DROP TABLE IF EXISTS questions;
    DROP TABLE IF EXISTS themes;
    DROP TABLE IF EXISTS packs;
  `);
}
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL UNIQUE,
    bank TEXT NOT NULL,
    theme TEXT NOT NULL,
    contributor TEXT,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    notes TEXT,
    difficulty TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    image TEXT,
    options TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_sessions (
    join_code TEXT PRIMARY KEY,
    pack_id INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS question_asks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    join_code TEXT NOT NULL,
    asked_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS night_plan (
    question_id INTEGER PRIMARY KEY,
    bank TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank);
  CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
  CREATE INDEX IF NOT EXISTS idx_asks_question ON question_asks(question_id);
`);
if (ver < 3) {
  const cols = sqlite.prepare(`PRAGMA table_info(questions)`).all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === 'options')) {
    sqlite.exec(`ALTER TABLE questions ADD COLUMN options TEXT`);
  }
  sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
}

export const db = drizzle(sqlite, { schema });
export { schema };
