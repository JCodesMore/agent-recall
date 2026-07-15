import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { APP, DATABASE } from '../config.mjs';
import { databasePath, ensureDataHome } from '../paths.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  source_path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  signature TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  parent_session_key TEXT,
  title TEXT,
  summary TEXT,
  project TEXT,
  cwd TEXT,
  git_branch TEXT,
  model TEXT,
  created_at TEXT,
  updated_at TEXT,
  source_updated_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  resume_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(source_path) REFERENCES sources(source_path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_provider_updated ON sessions(provider, updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_cwd ON sessions(cwd);

CREATE TABLE IF NOT EXISTS messages (
  rowid INTEGER PRIMARY KEY,
  message_key TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  native_id TEXT,
  parent_message_key TEXT,
  sequence INTEGER NOT NULL,
  timestamp TEXT,
  role TEXT NOT NULL,
  content_type TEXT NOT NULL,
  text TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_locator TEXT,
  model TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_session_sequence ON messages(session_key, sequence);
CREATE INDEX IF NOT EXISTS messages_timestamp ON messages(timestamp DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS activity_session_time ON activity_events(provider, native_session_id, observed_at DESC);
`;

export async function openDatabase({ file = databasePath(), readonly = false } = {}) {
  if (!readonly) await ensureDataHome();
  if (!readonly && fs.existsSync(file)) {
    const probe = new DatabaseSync(file, { readOnly: true });
    let version;
    try {
      const hasMetadata = probe.prepare(`
        SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'metadata'
      `).get();
      version = hasMetadata
        ? probe.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version')?.value
        : null;
    } finally {
      probe.close();
    }
    const numericVersion = Number(version);
    if (Number.isFinite(numericVersion) && numericVersion > APP.DB_SCHEMA_VERSION) {
      throw new Error(`Agent Recall database schema ${numericVersion} is newer than supported schema ${APP.DB_SCHEMA_VERSION}.`);
    }
    if (String(version ?? '') !== String(APP.DB_SCHEMA_VERSION)) {
      for (const candidate of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(candidate, { force: true });
    }
  }
  const db = new DatabaseSync(file, { readOnly: readonly });
  db.exec(`PRAGMA busy_timeout=${DATABASE.BUSY_TIMEOUT_MS}; PRAGMA foreign_keys=ON;`);
  if (!readonly) {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    db.exec(SCHEMA);
    db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(APP.DB_SCHEMA_VERSION),
    );
    if (process.platform !== 'win32' && fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
  return db;
}

export function withTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function databaseSchemaSql() {
  return SCHEMA;
}
