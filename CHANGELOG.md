# Changelog

## Unreleased

- Rewrote the README and public descriptions around the cross-agent search benefit.
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
