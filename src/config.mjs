import os from 'node:os';
import path from 'node:path';

export const APP = Object.freeze({
  NAME: 'agent-recall',
  CLI_SCHEMA_VERSION: 2,
  DB_SCHEMA_VERSION: 3,
  REDACTION_POLICY_VERSION: 5,
  INDEX_POLICY_VERSION: 'db3-redaction5-adapters7',
  MIN_NODE: Object.freeze({ major: 22, minor: 13 }),
});

export const PROVIDERS = Object.freeze({
  CLAUDE: 'claude',
  CODEX: 'codex',
  OPENCODE: 'opencode',
});

export const PATHS = Object.freeze({
  HOME: os.homedir(),
  CLAUDE_ROOT: path.join(os.homedir(), '.claude', 'projects'),
  CODEX_ROOT: path.join(os.homedir(), '.codex', 'sessions'),
  CODEX_ARCHIVE_ROOT: path.join(os.homedir(), '.codex', 'archived_sessions'),
  CODEX_SESSION_INDEX: path.join(os.homedir(), '.codex', 'session_index.jsonl'),
  OPENCODE_ROOT: path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    'opencode',
  ),
});

export const DATABASE = Object.freeze({
  FILE: 'agent-recall.db',
  BUSY_TIMEOUT_MS: 5_000,
});

export const REFRESH = Object.freeze({
  AUTO_SYNC_MAX_AGE_MS: 10 * 60 * 1_000,
  AUTO_SYNC_LEASE_MS: 5 * 60 * 1_000,
});

export const LIMITS = Object.freeze({
  SEARCH_DEFAULT: 5,
  SEARCH_MAX: 50,
  CONTEXT_BEFORE_DEFAULT: 2,
  CONTEXT_AFTER_DEFAULT: 3,
  CONTEXT_MAX: 25,
  TRANSCRIPT_DEFAULT: 20,
  TRANSCRIPT_MAX: 100,
  TEXT_MAX_CHARS: 200_000,
  SNIPPET_MAX_CHARS: 500,
  TITLE_MAX_CHARS: 120,
  QUERY_MAX_CHARS: 2_000,
  JSONL_MAX_LINE_CHARS: 24 * 1024 * 1024,
  ATTACHMENT_MAX_BYTES: 16 * 1024 * 1024,
});

export const TOKENIZE = Object.freeze({
  MIN_TOKEN_LEN: 2,
  MAX_TOKEN_LEN: 64,
  TOKEN_REGEX: /[\p{L}\p{N}][\p{L}\p{N}_-]*/gu,
});

export const ACTIVITY = Object.freeze({
  PROBABLY_ACTIVE_MS: 2 * 60 * 1_000,
  RECENT_MS: 24 * 60 * 60 * 1_000,
  EXPLICIT_ACTIVE_TTL_MS: 30 * 60 * 1_000,
});

export const EXIT_CODES = Object.freeze({
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  STALE: 4,
});
