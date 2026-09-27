# Changelog

## Unreleased

## 1.0.0

A rewrite built from how agents actually used 0.6 (1,065 recall calls on real machines).

- **Finds more.** Searches rank whole conversations from turn-sized passages, so words spread
  across a chat add up instead of failing an all-words-in-one-message test. Tool calls, file
  names, commands and error output are searchable. Subagent work counts toward its parent
  chat; copies of the same history in forks count once.
- **Ranks better.** The chat you are in is left out, chats that only asked for a
  conversation rank below it, and the current project is a boost rather than a filter.
  Real titles come from the Claude desktop app, `/rename`, Codex thread names and Cursor.
  Injected harness text is no longer indexed or used as a title.
- **Reads everything.** `read` pages through a whole conversation by message number, with
  `--at`, `--from`, `--last`, `--grep`, and `--out` to export it with its subagents.
- **Sees more.** Adds Cursor, Claude desktop and Cowork sessions, nested subagent folders,
  Codex subagent threads and titles.
- **Faster.** Growing transcripts are read from where the last sync stopped; a search with
  nothing new answers in about 0.2 s. Big backlogs finish in the background.
- **Easier.** Short handles (`abc1234`) plus native ids, prefixes, `codex:<id>` and
  `codex://threads/<id>`; compact text output with the next command to run; `--stdin` for
  queries that are hard to quote; suggestions for mistyped commands and options.
- **One skill.** The root `SKILL.md` is the only skill file for every agent and the Claude
  plugin. The installer keeps files you add to the skill folder.
- Commands `context`, `transcript`, `session` and `status` still work as aliases.
  `search --json` keeps `hits[].score` and adds `completeness.complete`.
- Removed: the redaction layer (the index holds the same text as the history files it reads)
  and hook-based activity tracking (results mark conversations written in the last minutes as
  active instead).

## 0.6.0

- Fixed Codex parent/child identity so Agent Recall opens the conversation that actually matched.
- Added native restore and open support for archived Codex desktop tasks.
- Rewrote the README around practical, natural-language use cases.
- Added `--agents-only` installation for Codex and OpenCode users without Claude Code.

## 0.5.0

- Standardized the project, repository, skill, plugin, marketplace entry, and install paths on the Agent Recall name.
- Migrated marker-owned `conversation-recall` skill installations to `agent-recall`.
- Marketplace users must replace the old plugin installation because Claude Code keys installed plugins by name.

## 0.4.1

- Fixed attachment indexing for repeated Claude message IDs and large Codex image payloads.

## 0.4.0

- Added attachment discovery and original-byte extraction for Claude Code, Codex, and OpenCode conversations.
- Added attachment descriptors to search, context, and transcript results, plus attachment counts on sessions.
- Added `attachments` and `attachment --output` CLI commands.

## 0.3.0

- Rebuilt the former Claude-only search plugin as Agent Recall.
- Added Claude Code, Codex, and OpenCode adapters.
- Added transactional SQLite FTS5 indexing and incremental synchronization.
- Added bounded search, context, session, transcript, recent, status, sync, and doctor commands.
- Added pre-index secret redaction and evidence-based activity labels.
- Added a portable Agent Skills definition and cross-client installer.
- Added hook-driven incremental refresh when the index is at least 10 minutes old.
