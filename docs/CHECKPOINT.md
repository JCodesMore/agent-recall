# Checkpoint

Objective: v1 rewrite of Agent Recall on `rewrite/v1` (see docs/GOAL.md for done criteria).

## Decisions

- Two-level FTS5 index: turn passages (`user`, `assistant`, `tools` columns) and session docs
  (`title`, `context`). Contentless tables; messages table holds the readable text.
- Subagents fold into their root conversation in results; forks stay separate and copied
  history is deduped by passage hash (oldest session keeps it).
- Current project is a ranking boost, never a filter. The running session is excluded via
  each provider's `currentSessionEnv` (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`).
- Only a root's own real title is ranked; titles derived from the first prompt are not
  indexed (they made recall-request chats outrank their target).
- Labels (desktop titles, Codex thread names, archive flags, spawn edges) live in a `labels`
  table and are merged over what the transcript said (`sessions.parsed`).
- A session found in two files belongs to the newest one; the other is re-examined when the
  owner disappears.
- Database sources (OpenCode) take a cursor of per-session versions and return partial
  updates. JSONL sources resume from a byte cursor behind a sized head fingerprint.
- No redaction layer: the source stores already hold the same plaintext.
- Supported: Node ^22.16 or >=24 (node:sqlite has FTS5 from 22.16; 23 does not; `?1`
  parameters fail before 22.23). CI (`.github/workflows/check.yml`) runs `npm run check` on
  Linux, macOS and Windows with Node 22.16.0, 22 and 24. Locally, WSL Ubuntu with nvm runs
  the same check on Linux.
- Fixtures use invented names only; names from real history were scrubbed from the whole
  branch before it was pushed.
- Never run v1 against the default data home while developing: opening it removes v0's
  `agent-recall.db`. Use a scratch `AGENT_RECALL_HOME`.

## Done

- All goal lines. `npm run check` green: 36 tests, synthetic eval hit@1 1.00, hit@5 1.00.
- Private eval (37 real cases, `npm run eval:local`): v1 hit@1 0.62, hit@5 0.92;
  v0.6 on the same set 0.24 / 0.38.
- Real machine (Claude 180 + 756 subagents, Codex 628 + 1,604, OpenCode 25 + 44, Cursor
  82 + 126): fresh full index 83 s, no-op sync 0.5 s, search 0.2 s, index 393 MB.
- Reviewer findings: all high and medium fixed (installer links, duplicate files, read
  edges, archive filter, sync failure fallback, lock takeover, passage diffs, OpenCode
  partial updates); low items closed (config constants, provider-owned refs, newest-first
  sync, `--until` end of day, export cycle guard, Claude origin).

## Deployment (this user's machines)

- Installed from this branch into `~/.agents/skills/agent-recall` on TWELVE (2026-09-27). The
  `JCodesMore/agent-skills` repo syncs `~/.agents` every 60 s to THIRTEEN and the MacBook, so
  one install updates all three; Claude and Cursor reach it through links.
- `peers.json` (same content, self-skipped by hostname) sits in each computer's data folder.
  The old `recall-network.*` wrapper was retired; pc-link's SKILL.md now points at
  `--peers all`. Orphaned plugin 0.5.0 and the v0 restore backup went to the Recycle Bin.
- To update later: `node scripts/recall.mjs install` from a checkout on any one computer.

## Next

- Codex segments read as separate parts (linked by `continuesIn`); a merged read could come
  later if agents trip on it.
- OpenCode pre-SQLite JSON storage is not read (no store seen that still used it).
