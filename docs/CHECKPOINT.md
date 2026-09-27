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

- Foundation, Claude/OpenCode/Cursor providers, index + incremental sync, search, read,
  service (src/recall.mjs), CLI, root SKILL.md + lint, installer, README, CHANGELOG,
  synthetic benchmark (hit@1 1.00), local eval runner. Real machine without Codex: full index
  28 s, no-op sync 0.3 s, search 0.2 s.

## Active

- Codex provider (delegated). Wire into registry.mjs, fill docs/providers.md Codex section.
- Private local eval set being built at %LOCALAPPDATA%/agent-recall/local-eval.json.
- Reviewer pass on the core (delegated).

## Next

- Run eval:local with Codex indexed; tune ranking; compare with v0 (AGENT_RECALL_V0).
- Codex current-session exclusion (env var if one exists; else live + recall-turn heuristic).
- Final: npm run check, real-machine timing with Codex, update CHECKPOINT, summary.
