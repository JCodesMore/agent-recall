// Every limit, default and version lives here. Import from this module; never repeat a value.

import fs from 'node:fs';

// package.json is the single source of the release version; manifests are checked against it.
export const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export const APP = Object.freeze({
  NAME: 'agent-recall',
  // JSON output contract. Bump only when a field is removed or changes meaning.
  JSON_SCHEMA: 3,
  // Bump when normalized provider output or passage building changes; indexes then rebuild.
  INDEX_VERSION: 1,
  DB_FILE: 'recall-v1.db',
  LEGACY_DB_FILES: ['agent-recall.db', 'agent-recall.db-wal', 'agent-recall.db-shm'],
  MIN_NODE: Object.freeze({ major: 22, minor: 13 }),
});

export const PROVIDERS = Object.freeze({
  CLAUDE: 'claude',
  CODEX: 'codex',
  OPENCODE: 'opencode',
  CURSOR: 'cursor',
});

export const PROVIDER_LABELS = Object.freeze({
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
});

// text: what the user or assistant said. tool: one line per tool call. output: head and tail
// of a tool result. summary: a compaction summary the provider wrote.
export const KINDS = Object.freeze({ TEXT: 'text', TOOL: 'tool', OUTPUT: 'output', SUMMARY: 'summary' });
export const ROLES = Object.freeze({ USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool' });

// A tool call whose command matches this is a recall lookup; its output quotes other
// conversations, so it is kept out of the index and its turn is demoted.
export const RECALL_INVOCATION = /recall(?:-network)?\.mjs|\bagent-recall\s+(?:search|read|recent|show)/i;

export const LIMITS = Object.freeze({
  // Normalization
  MESSAGE_MAX_CHARS: 100_000,
  TOOL_SUMMARY_MAX_CHARS: 400,
  OUTPUT_HEAD_CHARS: 240,
  OUTPUT_TAIL_CHARS: 160,
  TITLE_MAX_CHARS: 120,
  JSONL_MAX_LINE_BYTES: 32 * 1024 * 1024,
  // Lines above this size are checked for skippable record types before JSON.parse.
  JSONL_PEEK_THRESHOLD_BYTES: 64 * 1024,
  JSONL_PEEK_BYTES: 2048,
  ATTACHMENT_MAX_BYTES: 16 * 1024 * 1024,
  // Indexing
  PASSAGE_MAX_CHARS: 6_000,
  // Search
  QUERY_MAX_CHARS: 2_000,
  QUERY_MAX_TERMS: 16,
  SEARCH_DEFAULT: 6,
  SEARCH_MAX: 50,
  SEARCH_CANDIDATES: 600,
  SESSION_CANDIDATES: 150,
  MATCHES_PER_HIT: 2,
  SNIPPET_CHARS: 260,
  // Reading
  READ_BUDGET_CHARS: 24_000,
  READ_MAX_BUDGET_CHARS: 200_000,
  READ_CONTEXT_BEFORE: 3,
  READ_GREP_CONTEXT: 1,
  RECENT_DEFAULT: 10,
});

export const RANKING = Object.freeze({
  // bm25 column weights for passages_fts(user, assistant, tools) and sessions_fts(title, context)
  PASSAGE_WEIGHTS: [1.6, 1.0, 0.6],
  SESSION_WEIGHTS: [2.5, 0.8],
  // Weight of a session's 2nd and 3rd best passages relative to its best one.
  EXTRA_PASSAGE_WEIGHTS: [0.35, 0.15],
  TITLE_WEIGHT: 1.2,
  // Added to every conversation's text score so the multiplicative boosts below still order
  // results when bm25 gives near zero (a term present in most of a small index).
  BASE_SCORE: 0.5,
  // Fraction of query terms a session covers, squared, times this, times the best score.
  COVERAGE_WEIGHT: 0.6,
  CURRENT_PROJECT_BOOST: 1.25,
  RECENCY_BOOST: 0.15,
  RECENCY_HALF_LIFE_DAYS: 30,
  SUMMARY_PENALTY: 0.5,
  // Turns that ran a recall lookup are usually the request for a conversation, not the
  // conversation itself.
  RECALL_PENALTY: 0.3,
});

export const SYNC = Object.freeze({
  // A hook-triggered sync is skipped when the last one is younger than this.
  STALE_AFTER_MS: 2 * 60 * 1_000,
  LOCK_STALE_MS: 10 * 60 * 1_000,
  // How long a search or read may spend catching the index up before answering from it and
  // leaving the rest to a background sync.
  FOREGROUND_BUDGET_MS: 4_000,
  LOCK_WAIT_MS: 60 * 1_000,
  PROGRESS_INTERVAL_MS: 2_000,
  BUSY_TIMEOUT_MS: 10_000,
  // Sources written this recently are labelled live in results.
  LIVE_WINDOW_MS: 2 * 60 * 1_000,
  // Head bytes hashed to detect a rewritten (not appended) source.
  HEAD_BYTES: 512,
  // Commit a transaction after this many parsed bytes during a full index.
  BATCH_BYTES: 64 * 1024 * 1024,
});

export const RETENTION = Object.freeze({
  CLAUDE_DEFAULT_DAYS: 30,
  WARN_BELOW_DAYS: 90,
});

export const EXIT = Object.freeze({ OK: 0, ERROR: 1, USAGE: 2, NOT_FOUND: 3, STALE: 4 });
