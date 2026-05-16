# ADRs

## ADR-001: Pure-JS inverted index over SQLite FTS5
- **Decision:** custom inverted index + BM25, stored as JSON.
- **Why:** zero native deps → cross-platform install with no `node-gyp`. JSON index is inspectable. Performance is fine for transcript-scale data (<100MB).
- **Trade-off:** slightly slower than FTS5 for huge corpora; we don't have huge corpora.

## ADR-002: Goal-spec path was wrong; walk real layout
- **Decision:** Walk `~/.claude/projects/<sanitized>/*.jsonl` and `**/subagents/*.jsonl`. Do NOT rely on `sessions/` subdir or `sessions-index.json`.
- **Why:** Observed structure differs from the spec; stale `sessions-index.json` would silently miss sessions.

## ADR-003: Skip `thinking` blocks
- **Decision:** Do not index `{type:"thinking"}` assistant content.
- **Why:** Server-encrypted blob (signature field). Not human-readable; indexing it wastes index size and pollutes ranking.

## ADR-004: Index per-message, display per-session
- **Decision:** Each indexed doc = one message (user / assistant turn). Display groups results by session so users see "session X has 3 matches, here's the top snippet."
- **Why:** Better ranking granularity, better snippets, but UX shows the session-level affordance (resumeCommand).

## ADR-005: Pure-JS Node 20 stdlib, zero runtime deps
- **Decision:** No `package.json` dependencies, only `devDependencies` if any. Use `node:fs`, `node:path`, `node:os`, `node:http`, `node:test`.
- **Why:** "Two-command install, zero config" demands no `npm install` step. Plugin scripts run with Claude Code's bundled Node.

## ADR-006: Index storage path
- **Decision:** Index at `~/.claude-search/` (top-level user dir).
- **Why:** Stays out of `~/.claude/projects` (which Claude Code owns) and `${CLAUDE_PLUGIN_ROOT}` (which is per-install + read-only in spirit). User-owned data lives in user home.
