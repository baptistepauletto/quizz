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
const SCHEMA_VERSION = 4;
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
    is_mcq INTEGER,
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
  CREATE TABLE IF NOT EXISTS guests (
    position INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    join_code TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    UNIQUE (join_code, created_at)
  );
  CREATE TABLE IF NOT EXISTS game_players (
    game_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (game_id, name)
  );
  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    round TEXT NOT NULL,
    question_id INTEGER,
    player TEXT,
    correct INTEGER,
    points INTEGER NOT NULL DEFAULT 0,
    wager INTEGER,
    answer TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_plays_game ON plays(game_id);
  CREATE INDEX IF NOT EXISTS idx_plays_player ON plays(player);
  CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank);
  CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
  CREATE INDEX IF NOT EXISTS idx_asks_question ON question_asks(question_id);
`);
if (ver < 3) {
  const cols = sqlite.prepare(`PRAGMA table_info(questions)`).all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === 'options')) {
    sqlite.exec(`ALTER TABLE questions ADD COLUMN options TEXT`);
  }
}
if (ver < 4) {
  const cols = sqlite.prepare(`PRAGMA table_info(questions)`).all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === 'is_mcq')) {
    sqlite.exec(`ALTER TABLE questions ADD COLUMN is_mcq INTEGER`);
    // Legacy rows with options were shown as QCM immediately.
    sqlite.exec(`UPDATE questions SET is_mcq = 1 WHERE options IS NOT NULL AND is_mcq IS NULL`);
  }
  sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
}

export const db = drizzle(sqlite, { schema });
export { schema };
