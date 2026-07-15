# Agent Recall

Local cross-agent conversation recall for Claude Code, Codex, and OpenCode.

## Architecture

- `src/sources/` discovers and normalizes provider stores.
- `src/sync.mjs` transactionally refreshes changed sources.
- `src/storage/database.mjs` owns the SQLite schema.
- `src/service.mjs` is the sole search and retrieval API.
- `scripts/recall.mjs` exposes the machine-readable CLI.
- `SKILL.md` is the canonical portable skill.
- `skills/conversation-recall/SKILL.md` is the Claude plugin wrapper.

## Discipline

- Use synthetic fixtures; never commit real transcript content.
- Add an adapter version or schema migration when normalized shapes change.
- Keep provider-specific parsing out of storage and service modules.
- Run single test files while editing and the full suite before completion.
