import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

export const PATHS = Object.freeze({
  CLAUDE_HOME: path.join(HOME, '.claude'),
  PROJECTS_ROOT: path.join(HOME, '.claude', 'projects'),
  INDEX_HOME: path.join(HOME, '.claude-search'),
});

export const INDEX_FILES = Object.freeze({
  MANIFEST: 'manifest.json',
  INDEX: 'index.json',
  LOCK: 'index.lock',
  POSTINGS: 'postings.ndjson',
  DOCS: 'docs.ndjson',
});

export const TRANSCRIPT = Object.freeze({
  TOP_LEVEL_GLOB: '*.jsonl',
  SUBAGENT_DIR: 'subagents',
  SUBAGENT_PREFIX: 'agent-',
  JSONL_EXT: '.jsonl',
  PROJECT_DIR_SEPARATOR: '-',
});

export const RECORD_TYPES = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  ATTACHMENT: 'attachment',
  SUMMARY: 'summary',
  AI_TITLE: 'ai-title',
  SYSTEM: 'system',
});

export const CONTENT_BLOCK_TYPES = Object.freeze({
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
});

export const ROLES = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  ATTACHMENT: 'attachment',
  META: 'meta',
});

export const SCORING = Object.freeze({
  BM25_K1: 1.5,
  BM25_B: 0.75,
  USER_ROLE_BOOST: 1.2,
  RECENCY_HALF_LIFE_DAYS: 90,
  RECENCY_WEIGHT: 0.15,
});

export const SEARCH_DEFAULTS = Object.freeze({
  LIMIT: 20,
  MAX_LIMIT: 200,
  SNIPPET_RADIUS: 60,
  SNIPPET_MAX_LEN: 220,
  TITLE_MAX_LEN: 80,
  HIGHLIGHT_OPEN: '\x1b[1;33m',
  HIGHLIGHT_CLOSE: '\x1b[0m',
  HIGHLIGHT_HTML_OPEN: '<mark>',
  HIGHLIGHT_HTML_CLOSE: '</mark>',
});

export const WEB = Object.freeze({
  HOST: '127.0.0.1',
  PORT_MIN: 7345,
  PORT_MAX: 7395,
  API_PATH: '/api/search',
  API_OPEN_FOLDER: '/api/actions/open-folder',
  API_RESUME: '/api/actions/resume',
});

export const VALIDATION = Object.freeze({
  SESSION_ID_REGEX: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
});

export const TOKENIZE = Object.freeze({
  MIN_TOKEN_LEN: 2,
  MAX_TOKEN_LEN: 64,
  TOKEN_REGEX: /[\p{L}\p{N}][\p{L}\p{N}_]*/gu,
});

export const INDEXER = Object.freeze({
  MAX_TEXT_PER_RECORD: 200_000,
  TIMEOUT_MS: 60_000,
  LOCK_STALE_AFTER_MS: 90_000,
});

export const EXIT_CODES = Object.freeze({
  OK: 0,
  USAGE: 2,
  NO_RESULTS: 0,
  INTERNAL: 1,
});
