import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { APP, SYNC } from '../shared/config.mjs';
import { dataHome, databasePath, ensureDataHome } from '../shared/paths.mjs';

const TOKENIZER = "tokenize='porter unicode61 remove_diacritics 2'";

// The index is derived state: when INDEX_VERSION changes the file is rebuilt, never migrated.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  extra TEXT NOT NULL DEFAULT '',
  head TEXT,
  cursor TEXT,
  indexed_at TEXT NOT NULL,
  diagnostics TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  parent_native_id TEXT,
  kind TEXT NOT NULL,
  title TEXT,
  title_source TEXT,
  first_prompt TEXT,
  cwd TEXT,
  -- cwd in comparable form (forward slashes, case folded where the OS folds case).
  cwd_key TEXT,
  project TEXT,
  git_branch TEXT,
  model TEXT,
  origin TEXT,
  created_at TEXT,
  updated_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  resume TEXT,
  meta TEXT,
  -- What the transcript itself said, before labels from other stores were applied.
  parsed TEXT NOT NULL DEFAULT '{}',
  UNIQUE (provider, native_id)
);
CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_parent ON sessions(provider, parent_native_id);
CREATE INDEX IF NOT EXISTS sessions_source ON sessions(source_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  ts TEXT,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  meta TEXT,
  UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS passages (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  first_seq INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  ts TEXT,
  hash TEXT NOT NULL,
  flags INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS passages_session ON passages(session_id, first_seq);
CREATE INDEX IF NOT EXISTS passages_hash ON passages(hash);

CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
  user, assistant, tools, content='', contentless_delete=1, ${TOKENIZER}
);
CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
  DELETE FROM passages_fts WHERE rowid = old.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  title, context, content='', contentless_delete=1, ${TOKENIZER}
);
CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
  DELETE FROM sessions_fts WHERE rowid = old.id;
END;

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  name TEXT,
  locator TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(session_id, seq);

CREATE TABLE IF NOT EXISTS labels (
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  title TEXT,
  title_source TEXT,
  archived INTEGER,
  parent_native_id TEXT,
  origin TEXT,
  cwd TEXT,
  meta TEXT,
  PRIMARY KEY (provider, native_id)
);
`;

function removeFiles(file) {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(candidate, { force: true });
}

function configure(db) {
  db.exec(`PRAGMA busy_timeout=${SYNC.BUSY_TIMEOUT_MS}; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;`);
}

function metaValue(db, key) {
  try {
    return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  } catch {
    return null;
  }
}

export function openIndex({ file = databasePath(), readonly = false } = {}) {
  if (readonly) {
    if (!fs.existsSync(file)) return null;
    const db = new DatabaseSync(file, { readOnly: true });
    db.exec(`PRAGMA busy_timeout=${SYNC.BUSY_TIMEOUT_MS};`);
    return db;
  }
  ensureDataHome();
  // v0 indexes lived in a different file; they are derived data and only cost disk space.
  for (const legacy of APP.LEGACY_DB_FILES) fs.rmSync(path.join(dataHome(), legacy), { force: true });
  let db = new DatabaseSync(file);
  configure(db);
  const version = metaValue(db, 'index_version');
  if (version !== null && version !== String(APP.INDEX_VERSION)) {
    db.close();
    removeFiles(file);
    db = new DatabaseSync(file);
    configure(db);
  }
  db.exec(SCHEMA);
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('index_version', String(APP.INDEX_VERSION));
  return db;
}

export function getMeta(db, key) {
  return metaValue(db, key);
}

export function setMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, String(value));
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
