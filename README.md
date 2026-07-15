<div align="center">

# Agent Recall

### Find any conversation you've had with Claude Code, Codex, or OpenCode

Ask *"where did we figure out that auth bug?"* and your current agent searches your past coding chats across all three tools, then pulls the relevant messages into your new chat. Start fresh, switch agents, or come back weeks later without explaining everything again.

[Quick Start](#quick-start) · [Try it](#try-it) · [Privacy](#private-by-default) · [More plugins](https://github.com/JCodesMore/jcodesmore-plugins)

</div>

---

## Quick Start

**Requires [Node.js](https://nodejs.org/) 22.13 or newer.** Follow the section for each agent where you want to use it.

### Claude Code

Run these inside Claude Code:

```text
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install agent-recall@jcodesmore-plugins
```

Fully restart Claude Code so the new skill loads.

### Codex, OpenCode, or a standalone install

From a terminal:

```bash
git clone https://github.com/JCodesMore/agent-recall.git
cd agent-recall
node scripts/install.mjs --agents-only
```

Restart Codex or OpenCode if it was already running.

**That's it.** Invoke Agent Recall directly, followed by your query:

| Agent | Invocation |
|---|---|
| Claude Code plugin | `/agent-recall:agent-recall <query>` |
| Claude Code standalone skill | `/agent-recall <query>` |
| Codex | `$agent-recall <query>` |
| OpenCode | `Use the agent-recall skill: <query>` |

The first search builds a private local index; later searches refresh only what changed.

## Try it

Replace `<query>` with something like:

- *"What did we do in the past 24 hours?"*
- *"Where did we fix that Postgres connection issue?"*
- *"What did we decide about the new auth flow?"*
- *"Find where I compared those proxy APIs and summarize the result."*
- *"Catch me up on this project from yesterday."*
- *"What did I discuss in Codex about this feature last week?"*
- *"Find where we debugged the checkout page and show me the screenshot I shared."*

You do not need to remember which agent you used, what the chat was called, or where the session file lives. Just describe what you remember.

One question can search all three chat histories. Results show the app, project, time, and surrounding messages, so you can see the earlier decision in context. Your agent can also catch you up on recent sessions and reopen supported local images or files from a matching chat.

Attachment support covers inline images from Claude Code, input images from Codex, and locally stored OpenCode file parts. It does not download files from remote URLs.

## Private by default

Searching and indexing happen on your computer. Agent Recall does not upload your chat history to its own server, and you do not need a separate API key, account, or embedding service.

Only user and assistant conversation text, including supported subagent chats, is indexed by default. System prompts, private reasoning, tool logs, patches, and other background data are skipped. Common credentials and private keys are redacted before text reaches the index.

When your agent opens a matching excerpt or attachment, that content is handled by the AI service you are currently using, just like anything else you type or attach in that chat.

## How it works

The first search reads your existing chat history. Later searches only refresh files that changed. Your agent starts with a few likely matches, opens the surrounding messages when needed, and can pull a longer transcript or an attached image.

| App | Conversation history read by default |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode*.db` |

OpenCode databases are opened read-only. Credential and account tables are never read.

<details>
<summary><b>Use the CLI directly</b></summary>

Every command supports `--json` output for agents and scripts:

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

</details>

<details>
<summary><b>Search and attachment details</b></summary>

- Search uses local SQLite FTS5 ranking with current-project-first behavior.
- If every search term does not appear together, Agent Recall retries with a broader match.
- Results are limited and grouped by conversation so one long chat does not crowd out everything else.
- Context windows and transcripts are bounded and paginated.
- Claude Code inline images, Codex input images, and OpenCode base64 file parts can be recovered on demand.
- Remote attachment URLs are never fetched.
- Individual attachments are limited to 16 MiB and are written only to a new local file you choose.

The local index follows your operating system's application-data convention. Set `AGENT_RECALL_HOME` to override it.

</details>

<details>
<summary><b>Install or remove the standalone skill</b></summary>

From a checkout:

```bash
node scripts/install.mjs                 # Claude Code, Codex, and OpenCode
node scripts/install.mjs --agents-only   # Codex and OpenCode only
node scripts/install.mjs --dry-run
node scripts/install.mjs --uninstall
```

This installs `agent-recall` into:

- `~/.agents/skills/agent-recall` for Codex and OpenCode
- `~/.claude/skills/agent-recall` for Claude Code

Claude Code can also load the checkout directly:

```text
claude --plugin-dir /path/to/agent-recall
```

</details>

## Community

[**Discord**](https://discord.gg/babcVNJBet) · [**Issues**](https://github.com/JCodesMore/agent-recall/issues) · [**More plugins**](https://github.com/JCodesMore/jcodesmore-plugins)

## Development

```bash
npm test
npm run doctor
```

Tests use synthetic conversation history only. They never read your real chats.

## License

[Apache License 2.0](LICENSE) - © 2026 JCodesMore

---

*Part of [jcodesmore-plugins](https://github.com/JCodesMore/jcodesmore-plugins).*
