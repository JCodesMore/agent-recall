# Working agreement: Agent Recall

`AGENTS.md` is canonical; `CLAUDE.md` is exactly `@AGENTS.md`. Read `docs/CHECKPOINT.md`
first when it exists, then `docs/GOAL.md` (north star, done criteria, plan) and
`docs/CONTEXT.md` (vocabulary). Provider format notes live in `docs/providers.md`.

## What this is

A local CLI plus one Agent Skill that lets any coding agent search and read the user's past
conversations from Claude Code, Codex, OpenCode and Cursor. The repository root is the skill:
`SKILL.md` is the only skill file, and the Claude plugin, `npx skills add` and the installer
all ship this folder as it is. Keep the root lean because every file in it gets installed.

## Architecture

```
scripts/recall.mjs   CLI entry (stable path; other tools call it)
src/cli/             argv parsing, commands, text and JSON rendering
src/recall.mjs       the service: the one API the CLI and tests use
src/search/          query parsing, ranking, snippets
src/read/            transcript paging and export
src/index/           SQLite schema, sync writer, lock
src/providers/       one module per provider; all format knowledge lives here
src/install/         installer
src/shared/          config, paths, ids, text helpers
```

- Dependency direction: `cli -> recall -> search|read|index -> providers -> shared`.
  Providers never import from `index`, `search` or `cli`.
- A provider turns its store into normalized sessions, turns and messages. Nothing outside
  `src/providers/` knows a provider's file format.
- The index is derived state. Deleting it and running `sync` rebuilds it. Provider stores are
  opened read-only and never written.
- Every limit, default and version lives in `src/shared/config.mjs`. A value that appears in
  two places is a review failure.

## Less is more

- Build the smallest complete thing that meets the goal line it serves. Add a mechanism only
  for a need shown by a fixture, a measurement or a real usage failure.
- Strict core, tolerant providers: a provider skips what it cannot parse, counts it, and keeps
  going. Search and storage assume normalized input.
- Validate at the edges (argv, provider records), then trust inward.
- Agent-facing output is compact text by default and stable JSON with `--json`. Every result
  names the next command to run.

## Tests

- Fixtures are synthetic and built in code with `test/helpers/` (a fake home per test). Never
  commit real transcript content, and invent names: real project names and chat titles from
  local history are private too (the repository is public).
- Test through the service and the CLI, not SQL. Expected values are literals.
- `npm test` runs everything; `node --test test/<file>.test.mjs` runs one file while editing.
- `npm run eval` is the recall benchmark. A ranking change must not lower it.
- `npm run check` (tests plus eval plus skill lint) is green before every commit. Report
  failures with their output.
- CI runs the check on Linux, macOS and Windows with the oldest and newest supported Node.
  Build paths with `node:path`, spawn `process.execPath` rather than a shell, and treat
  path case as the platform does (`comparablePath`).

## Code

- Plain ESM JavaScript on Node >= 22.16 (or 24+; see `APP.MIN_NODE`), no runtime dependencies, `node:sqlite` for storage.
- Files under 400 lines, guard clauses, named constants, comments only for a non-obvious why.
- Bump `INDEX_VERSION` in `src/shared/config.mjs` whenever normalized output changes, so
  existing indexes rebuild instead of mixing shapes.

## Git and process

- Commit at every verified step with a plain message saying what changed and why. No
  attribution lines.
- Brief every subagent with the goal line it serves, the files it owns, the interfaces it must
  honor and the check to run. Reads parallelize; writes serialize.
- Keep `docs/CHECKPOINT.md` current: objective, decisions, done, active, next. Update it at
  each slice boundary.
