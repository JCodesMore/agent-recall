---
name: agent-recall
description: Find prior conversations across Claude Code, Codex, and OpenCode, and restore selected Codex tasks. Use when useful context may exist in another chat or agent, the user refers to earlier work, or before asking them to repeat context.
argument-hint: <query>
user-invocable: true
license: Apache-2.0
compatibility: Requires Node.js 22.13 or newer.
allowed-tools: Read Bash(node:*)
---

Read `${CLAUDE_PLUGIN_ROOT}/SKILL.md` and follow it as the authoritative workflow. Its `<skill-root>` is `${CLAUDE_PLUGIN_ROOT}`.
