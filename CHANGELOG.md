# Changelog

All notable changes to `claude-search` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-05-17

### Changed

- Indexer now runs as a background hook with a concurrency lock — `SessionStart` no longer blocks the prompt, and overlapping sessions can't clobber each other's writes.
- CLI strips ANSI escape codes automatically when stdout isn't a TTY (skill invocations, pipes, redirects), so consumers always receive clean text.

### Fixed

- Skill now echoes the raw CLI output verbatim instead of relying on the model to re-render results.

## [0.1.0] — 2026-05-15

### Added

- `/claude-search:search <query>` slash command — searches every transcript under `~/.claude/projects/` and returns ranked, resumable sessions.
- `--web` flag opens a local browser UI on `127.0.0.1:<port>` for incremental search.
- `--json` flag for machine-readable output.
- `--project` flag to filter results by project (substring match).
- `--limit` flag to cap the number of results.
- `SessionStart` hook runs the incremental indexer in the background — only re-reads files whose mtime/size changed since the last pass.
- BM25 ranking with a user-role boost and recency decay.
- Highlighted snippets in ANSI (CLI) and `<mark>` (web).
- Pure Node 20 stdlib — no native bindings, no `npm install` step.
- 35-test suite covering reader, indexer, searcher, formatter, web server.

### Compatibility

- Linux, macOS, Windows (PowerShell + WSL).
- Requires Node.js 20 or newer (bundled with Claude Code on supported platforms).
