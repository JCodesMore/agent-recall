# Checkpoint

Objective: v1 rewrite of Agent Recall on `rewrite/v1` (see docs/GOAL.md for done criteria).

## Decisions

- Two-level FTS5 index: turn passages (`user`, `assistant`, `tools` columns) and session docs
  (`title`, `context`). Contentless tables; messages table holds the readable text.
- Subagents fold into their root conversation in results; forks stay separate and copied
  history is deduped by passage hash.
- Current project is a ranking boost, never a filter. The current Claude session is excluded
  via `CLAUDE_CODE_SESSION_ID`.
- Labels (desktop titles, Codex thread names, archive flags, spawn edges) live in a `labels`
  table and are merged over what the transcript said (`sessions.parsed`).
- No redaction layer: the source stores already hold the same plaintext.

## Done

- Foundation: shared config/paths/ids/text, JSONL scanner, builder, Claude provider, index
  schema, writer, incremental sync with lock (commit 33ea4f9).

## Active

- Codex, OpenCode, Cursor providers (delegated; lead wires them into registry.mjs).
- Search (src/search), read (src/read), service (src/recall.mjs), CLI (src/cli).

## Next

- Root SKILL.md, references/, agents/openai.yaml, plugin manifests, hooks, installer.
- Eval benchmark (synthetic) and private local eval; README; CHANGELOG; delete v0 modules.
