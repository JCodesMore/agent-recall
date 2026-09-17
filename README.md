<div align="center">

# Agent Recall

### Give your AI agents memory across chats

Search past conversations from Claude Code, Codex, and OpenCode—then bring the useful context into whatever you are working on now.

[![Stars](https://img.shields.io/github/stars/JCodesMore/agent-recall?style=flat)](https://github.com/JCodesMore/agent-recall/stargazers)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/hrTSX5yTpB)

[Get started](#get-started) · [See what it can do](#what-can-it-do) · [Privacy](#private-by-default)

</div>

---

## Get started

Requires [Node.js](https://nodejs.org/) 22.13 or newer.

Give this to an AI coding agent with terminal access:

> Install https://github.com/JCodesMore/agent-recall on this machine.

Restart the agent after installation. That is it—you can ask naturally whenever an older conversation would help.

<details>
<summary><b>Prefer to install it yourself?</b></summary>

### Claude Code plugin

Run these inside Claude Code:

```text
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install agent-recall@jcodesmore-plugins
```

### Standalone skill

```bash
git clone https://github.com/JCodesMore/agent-recall.git
cd agent-recall
node scripts/install.mjs
```

Use `node scripts/install.mjs --agents-only` to install for Codex and OpenCode without adding the standalone Claude Code skill.

</details>

## What can it do?

These are the kinds of requests Agent Recall is built for:

> **“/agent-recall find how we designed the UI/UX for our last project, so we can do it again for this one.”**

> **“/agent-recall catch me up on everything we changed in the last 24 hours across all my agents.”**

> **“/agent-recall find how we fixed this same bug before and apply the fix here.”**

> **“/agent-recall find the screenshot I shared when we designed this page.”**

> **“/agent-recall find the chat where we stopped building this feature, then tell me what is finished and what is left.”**

> **“/agent-recall find and reopen my old Codex conversation about Spanish practice.”**

You do not need to remember which agent you used, the chat title, or where its history is stored. Describe what you remember and Agent Recall searches your local Claude Code, Codex, and OpenCode conversations for the relevant context.

It can also recover supported images and files from old chats. In Codex desktop, it can restore an archived task and open the original conversation.

## Private by default

Your searchable index stays on your computer. Agent Recall does not upload your history to its own service and does not need an account, API key, or embedding service.

It indexes user and assistant conversation text—not system prompts, private reasoning, tool logs, or patches. Common credentials and private keys are redacted before text enters the index. Attachments are extracted only when requested.

<details>
<summary><b>How it works</b></summary>

The first search builds a local SQLite index. Later searches refresh only the history that changed. Results include the source agent, project, time, and surrounding messages so your current agent can use the earlier work in context.

Default history locations:

| App | Conversation history |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` and `~/.codex/archived_sessions` |
| OpenCode | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode*.db` |

</details>

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

Run `node scripts/recall.mjs --help` for every option. Set `AGENT_RECALL_HOME` to choose a different index location.

</details>

## Community

[**Discord**](https://discord.gg/hrTSX5yTpB) · [**Issues**](https://github.com/JCodesMore/agent-recall/issues) · [**More plugins**](https://github.com/JCodesMore/jcodesmore-plugins)

## Development

```bash
npm test
npm run doctor
```

Tests use synthetic conversation history only.

## License

[Apache License 2.0](LICENSE) © 2026 JCodesMore
