<div align="center">

# Agent Recall

### Give your AI agents memory across chats

Your agent finds and reads any past conversation you had with Claude Code, Codex, OpenCode
or Cursor, then brings what matters into the work you are doing now.

[![Stars](https://img.shields.io/github/stars/JCodesMore/agent-recall?style=flat)](https://github.com/JCodesMore/agent-recall/stargazers)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/hrTSX5yTpB)

[Get started](#get-started) · [What it can do](#what-can-it-do) · [Privacy](#private-by-default)

</div>

---

## Get started

Works on Windows, macOS and Linux. You need [Node.js](https://nodejs.org/) 22.16 or newer (the
"LTS" download is fine; Node 23 lacks the search engine Agent Recall uses).

Paste this to any AI coding agent that can run commands:

> Install https://github.com/JCodesMore/agent-recall on this machine.

Then start a new chat. That is it: ask naturally whenever an older conversation would help.
The first search spends a minute or so reading your history; after that answers are instant.

<details>
<summary><b>Prefer to install it yourself?</b></summary>

### Claude Code plugin

Run these inside Claude Code:

```text
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install agent-recall@jcodesmore-plugins
```

### Any agent (Codex, OpenCode, Cursor, Claude Code)

```bash
git clone https://github.com/JCodesMore/agent-recall.git
node agent-recall/scripts/recall.mjs install
```

This puts one copy in `~/.agents/skills/agent-recall` and links it into
`~/.claude/skills`. Run the same command again to update; files you added to that folder are
kept. `--agents-only` skips the Claude link, `--uninstall` removes it.

Using the [skills CLI](https://skills.sh)? `npx skills add JCodesMore/agent-recall` works too.

</details>

## What can it do?

Ask in your own words. These all work:

> **"Find how we designed the UI for our last project, so we can do it again here."**

> **"Catch me up on everything I changed in the last 24 hours across all my agents."**

> **"We fixed this exact error before. Find how, and apply the fix here."**

> **"Find the screenshot I shared when we designed this page."**

> **"Find the chat where we stopped building this feature and tell me what is left."**

> **"Reopen my old Codex conversation about Spanish practice."**

You do not need to remember which agent you used, what the chat was called, or where it was
saved. Agent Recall searches every conversation on this computer, including archived chats,
subagent work, the commands that ran and the errors they printed. Your agent can then read
the whole conversation, not just a snippet.

In Claude Code you can also type `/agent-recall` followed by what you are looking for.

## Private by default

Everything stays on your computers. Agent Recall reads the history files your agents already
keep, builds a search index next to them, and never uploads anything. No account, API key or
cloud service.

<details>
<summary><b>How it works</b></summary>

A small local SQLite index covers each conversation's messages, tool calls, the start and
end of tool output, titles and folders. Searches rank whole conversations, so words spread
across a long chat still find it, and your current project comes first. After the first run,
only new messages are read, so a search takes well under a second.

| App | History it reads |
|---|---|
| Claude Code | `~/.claude/projects`, desktop app titles, Cowork sessions, subagents |
| Codex | `~/.codex/sessions`, archived sessions, thread titles, subagent threads |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Cursor | `~/.cursor/projects/*/agent-transcripts`, chat titles |

Claude Code deletes transcripts after 30 days unless you change `cleanupPeriodDays` in
`~/.claude/settings.json`. `doctor` warns you when that applies.

</details>

<details>
<summary><b>More than one computer</b></summary>

If you use agents on several computers, each one keeps its own index, and Agent Recall can
ask the others over SSH: "find the chat on my laptop where we set up the VPN". List your
computers once in a `peers.json` file ([setup guide](references/peers.md)); nothing is
copied or uploaded, and each computer answers from its own history.

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

That runs the tests and the recall benchmark. Both use synthetic history only. Start with
[AGENTS.md](AGENTS.md).

## License

[Apache License 2.0](LICENSE) © 2026 JCodesMore
