<div align="center">

# Agent Recall

### Give your AI agents memory across chats

Your agent can find any past chat you've had in Claude Code, Codex, OpenCode or Cursor, read
it, and bring what matters into the work you're doing now.

[![Stars](https://img.shields.io/github/stars/JCodesMore/agent-recall?style=flat)](https://github.com/JCodesMore/agent-recall/stargazers)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/hrTSX5yTpB)

[Get started](#get-started) · [What it can do](#what-can-it-do) · [Privacy](#private-by-default)

</div>

---

## Get started

**1. Ask your agent to install it.** Paste this into Claude Code, Codex, Cursor or any other
coding agent:

> Install https://github.com/JCodesMore/agent-recall on this machine.

**2. Start a new chat.** That's it. Whenever an older conversation would help, just ask.

The first search takes a minute or so while it reads your history. After that, answers come
back right away.

> You'll need [Node.js](https://nodejs.org/) on your computer. If you don't have it yet, grab
> the LTS download or ask your agent to set it up.

<details>
<summary><b>Prefer to install it yourself?</b></summary>

### Claude Code plugin

Run these inside Claude Code:

```text
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install agent-recall@jcodesmore-plugins
```

### Any agent

```bash
git clone https://github.com/JCodesMore/agent-recall.git
node agent-recall/scripts/recall.mjs install
```

This sets it up for Codex, OpenCode, Cursor and Claude Code at once. Run the same command
again to update, or add `--uninstall` to remove it.

Using the [skills CLI](https://skills.sh)? `npx skills add JCodesMore/agent-recall` works too.

**Requirements:** Node.js 22.16 or newer. Works on Windows, macOS and Linux.

</details>

## What can it do?

Ask in your own words. These all work:

> **"Find how we designed the UI for our last project, so we can do it again here."**

> **"Catch me up on everything I changed in the last 24 hours across all my agents."**

> **"We fixed this exact error before. Find how, and apply the fix here."**

> **"Find the screenshot I shared when we designed this page."**

> **"Find the chat where we stopped building this feature and tell me what is left."**

> **"Reopen my old Codex conversation about Spanish practice."**

You don't need to remember which agent you used, what the chat was called or where it was
saved. Agent Recall looks through every conversation, archived ones included, down to the
commands that ran and the errors they printed. Then your agent reads the whole conversation,
not just a snippet.

In Claude Code you can also type `/agent-recall` followed by what you're looking for.

## Private by default

Everything stays on your computer. Agent Recall reads the history your agents already keep,
builds its search index right beside it, and never uploads anything. There's no account, API
key or cloud service.

<details>
<summary><b>How it works</b></summary>

A small local SQLite index covers each conversation's messages, tool calls, titles and
folders, plus the start and end of tool output. Searches rank whole conversations, so words
spread across a long chat still find it, and your current project comes first. After the
first run only new messages are read, so a search takes well under a second.

| App | History it reads |
|---|---|
| Claude Code | `~/.claude/projects`, desktop app titles, Cowork sessions, subagents |
| Codex | `~/.codex/sessions`, archived sessions, thread titles, subagent threads |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Cursor | `~/.cursor/projects/*/agent-transcripts`, chat titles |

Claude Code deletes chats after 30 days unless you change `cleanupPeriodDays` in
`~/.claude/settings.json`. `doctor` warns you when that applies.

</details>

<details>
<summary><b>More than one computer</b></summary>

If you use agents on several computers, Agent Recall can ask the others over SSH: "find the
chat on my laptop where we set up the VPN". List your computers once in a `peers.json` file
by following the [setup guide](references/peers.md). Nothing is copied or uploaded, and each
computer answers from its own history.

</details>

<details>
<summary><b>Use it from the terminal</b></summary>

```bash
node scripts/recall.mjs search -- database migration rollback
node scripts/recall.mjs read abc1234 --at 42
node scripts/recall.mjs read abc1234 --out transcript.md
node scripts/recall.mjs recent --since 2d
node scripts/recall.mjs show abc1234
node scripts/recall.mjs doctor
```

Add `--json` to any command for scripts. `--help` lists every option. Set
`AGENT_RECALL_HOME` to keep the index somewhere else.

</details>

## Community

[**Discord**](https://discord.gg/hrTSX5yTpB) · [**Issues**](https://github.com/JCodesMore/agent-recall/issues) · [**More plugins**](https://github.com/JCodesMore/jcodesmore-plugins)

## Development

```bash
npm run check
```

That runs the tests and the recall benchmark, both on made-up history. Start with
[AGENTS.md](AGENTS.md).

## License

[Apache License 2.0](LICENSE) © 2026 JCodesMore
