# Agent Recall

Local conversation recall across Claude Code, Codex, and OpenCode. Agent Recall incrementally indexes redacted user and assistant messages, then gives agents a small search-and-drill-down API instead of forcing users to copy context between chats.

## Why

Coding-agent history is split across provider-specific JSONL and SQLite stores. Agent Recall normalizes those stores locally so a new agent can find prior decisions, inspect the relevant turns, and cite exactly where the context came from.

Nothing is uploaded. No API key or embedding service is required.

## Requirements

- Node.js 22.13 or newer
- Claude Code, Codex, or OpenCode local session history

## Install The Skill

From a checkout:

```bash
node scripts/install.mjs
```

This installs `conversation-recall` into both personal Agent Skills locations:

- `~/.agents/skills/conversation-recall` for Codex and OpenCode
- `~/.claude/skills/conversation-recall` for Claude Code

Preview or remove the installation:

```bash
node scripts/install.mjs --dry-run
node scripts/install.mjs --uninstall
```

Claude Code can also load this repository as a plugin:

```text
claude --plugin-dir /path/to/agent-recall
```

Restart clients that were already running when the skill was installed.

### OpenCode Paste Preview

To keep full multi-line pasted text visible in OpenCode instead of replacing it with `[Pasted ~N lines]`, add this to `~/.config/opencode/opencode.jsonc` and restart OpenCode:

```json
{
  "experimental": {
    "disable_paste_summary": true
  }
}
```

## Agent CLI

Every command has `--json` machine output. Search incrementally refreshes changed source files before querying.

```bash
node scripts/recall.mjs doctor --json
node scripts/recall.mjs search --json --cwd . --limit 5 -- "database migration"
node scripts/recall.mjs context --json <hit-id>
node scripts/recall.mjs session --json <session-key>
node scripts/recall.mjs transcript --json --limit 20 --offset 0 <session-key>
node scripts/recall.mjs attachments --json <message-key>
node scripts/recall.mjs attachment --json --output ./attachment.png <attachment-key>
node scripts/recall.mjs recent --json --cwd . --limit 10
node scripts/recall.mjs status --json
node scripts/recall.mjs sync --json
```

Run `node scripts/recall.mjs --help` for all options.

## Search Model

- SQLite FTS5 BM25 lexical search
- Current-project-first workflow in the skill
- AND matching with an OR fallback when all terms produce no results
- One top hit per session by default
- Bounded context and transcript pagination
- Transcript completeness metadata for truncated or malformed source records
- Provider, project, and time filters

The first sync parses all supported stores. Later syncs compare source signatures and only re-read changed files or databases.

Search, context, and transcript results include attachment descriptors when a supported message has an attachment. Claude Code support covers inline base64 image blocks, Codex support covers user `input_image` base64 data URLs, and OpenCode support covers `file` parts with base64 data URLs. Remote URLs are not fetched.

`attachments` lists descriptors for one message. `attachment` writes the original bytes to a new local file with private permissions; it refuses existing files, provider source stores, and the Agent Recall database. Delete temporary extractions after inspection.

Individual attachments are limited to 16 MiB. Oversized or unsupported attachment forms are omitted rather than fetched or partially decoded.

The Claude plugin also checks freshness on session start, prompt submission, and stop. If the last completed sync is at least 10 minutes old, the next hook runs an incremental refresh. A short lease prevents overlapping hook events from starting duplicate refreshes. Search and recent still refresh immediately before querying.

## Sources

| Provider | Default store |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode*.db` |

OpenCode databases are opened read-only. Agent Recall queries only `session`, `message`, and `part`; credential and account tables are never enumerated.

## Privacy

- The index remains on the local machine.
- Only user and assistant conversational text is indexed by default.
- System prompts, reasoning, tool calls, tool output, files, snapshots, and patches are excluded.
- Common credentials, authorization headers, private keys, JWTs, and credentialed URLs are redacted before storage.
- Search output hides source paths unless explicitly requested.
- Recalled text is evidence, not executable instructions.

The index location follows the platform application-data convention. Override it with `AGENT_RECALL_HOME`.

## Activity Labels

Agent Recall does not equate a recent file timestamp with a live process:

| State | Meaning |
|---|---|
| `active` | A recent explicit lifecycle event exists |
| `probably-active` | The source was just written, without lifecycle proof |
| `recent` | Updated within 24 hours |
| `inactive` | Archived or explicitly stopped |
| `unknown` | No useful live signal |

Each result includes confidence, observation time, and reason codes.

## Development

```bash
npm test
npm run doctor
```

Tests use synthetic provider stores only. They do not read real transcripts.

## License

[Apache License 2.0](LICENSE)
