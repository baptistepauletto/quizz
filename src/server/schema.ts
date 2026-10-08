import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const packs = sqliteTable('packs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  status: text('status', { enum: ['draft', 'ready'] })
    .notNull()
    .default('draft'),
});

export const themes = sqliteTable('themes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  packId: integer('pack_id')
    .notNull()
    .references(() => packs.id, { onDelete: 'cascade' }),
  bank: text('bank', { enum: ['sprint', 'memory', 'climax'] }).notNull(),
  label: text('label').notNull(),
  contributorName: text('contributor_name'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const questions = sqliteTable('questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  themeId: integer('theme_id')
    .notNull()
    .references(() => themes.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  answer: text('answer').notNull(),
  notes: text('notes'),
  difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }).notNull(),
  status: text('status', { enum: ['draft', 'approved', 'rejected'] })
    .notNull()
    .default('draft'),
  source: text('source', { enum: ['llm', 'manual'] })
    .notNull()
    .default('llm'),
  image: text('image'),
  createdAt: integer('created_at').notNull(),
});

export const gameSessions = sqliteTable('game_sessions', {
  joinCode: text('join_code').primaryKey(),
  packId: integer('pack_id').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
