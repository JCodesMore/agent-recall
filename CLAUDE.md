# claude-search plugin

Local, ranked, lossless full-text search across `~/.claude/projects/**` transcripts. Two-command install. Ships in jcodesmore-plugins.

## Status
- Phase: bootstrap → research
- See `memory/` for topic-specific notes.

## Pointers
- `memory/architecture.md` — module layout & data flow
- `memory/transcript-format.md` — JSONL schema observed in real files
- `memory/decisions.md` — ADRs
- `memory/gotchas.md` — Windows path quirks, sidechain handling, etc.
- `memory/test-strategy.md` — synthetic fixtures + node:test plan
- `memory/dod.md` — Definition of Done checklist

## Layout (canonical)
- `.claude-plugin/` — only `plugin.json` + `marketplace.json`
- `skills/search/SKILL.md`
- `agents/` (if any)
- `hooks/hooks.json` — SessionStart → delta indexer
- `commands/search.md` — slash command frontmatter
- `scripts/` — thin shims (Node entrypoints invoked by command/hook)
- `src/` — `config.mjs`, `paths.mjs`, `transcript-reader.mjs`, `indexer/`, `searcher/`, `formatter/`, `web-server/`
- `test/fixtures/`
- `memory/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`

## Discipline
- One todo `in_progress` at a time; `completed` only after tests pass.
- All constants in `src/config.mjs` — no magic numbers/strings.
- One responsibility per module. Pure parse/rank/snippet fns.
- `Searcher.search()` is the single API consumed by CLI/web/skill.
- No dead code. No backwards-compat shims.
- Cross-platform: `os.homedir()` + `path.join`, never hardcode `~` or `/`.
