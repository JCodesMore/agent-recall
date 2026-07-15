---
name: agent-recall
description: Use Agent Recall to find prior coding-agent conversations across Claude Code, Codex, and OpenCode. Use proactively when context may exist in another chat, session, or agent; when the user refers to prior work or decisions; or before asking them to repeat historical context.
argument-hint: <query>
user-invocable: true
license: Apache-2.0
compatibility: Requires Node.js 22.13 or newer.
allowed-tools: Read Bash(node:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/SKILL.md` and follow it as the authoritative workflow. Its `<skill-root>` is `${CLAUDE_PLUGIN_ROOT}`.
