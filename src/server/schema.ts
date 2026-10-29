import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Flat question store. `source_id` matches drafts/{bank}.json ids (e.g. s_001). */
export const questions = sqliteTable('questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull().unique(),
  bank: text('bank', { enum: ['sprint', 'memory', 'climax'] }).notNull(),
  theme: text('theme').notNull(),
  contributor: text('contributor'),
  prompt: text('prompt').notNull(),
  answer: text('answer').notNull(),
  notes: text('notes'),
  difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }).notNull(),
  status: text('status', { enum: ['draft', 'approved', 'rejected'] })
    .notNull()
    .default('draft'),
  image: text('image'),
  /** JSON array of 4 strings for memory choices; null otherwise. */
  options: text('options'),
  /** 1 = show options on open; 0 = reserve for format-drop hint; null = legacy. */
  isMcq: integer('is_mcq'),
  createdAt: integer('created_at').notNull(),
});

export const gameSessions = sqliteTable('game_sessions', {
  joinCode: text('join_code').primaryKey(),
  packId: integer('pack_id').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const questionAsks = sqliteTable('question_asks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionId: integer('question_id').notNull(),
  joinCode: text('join_code').notNull(),
  askedAt: integer('asked_at').notNull(),
});
