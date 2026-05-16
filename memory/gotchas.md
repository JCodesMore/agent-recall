# Gotchas (record as encountered)

- **Windows paths in JSONL:** `cwd` field has backslashes. Normalize for display but keep the raw value when constructing `resumeCommand` (since `claude --resume <id>` doesn't need cwd).
- **`sessions-index.json` is stale:** observed entries pointing to `.jsonl` files that no longer exist. Always walk the filesystem.
- **`message.content` polymorphism:** sometimes string, sometimes array. The string form is more common for short user messages. Handle both.
- **`thinking` blocks have a server signature:** the `thinking` field is encrypted. Indexing this is pointless and wastes space.
- **`isMeta:true` user messages:** harness injection wrapping commands. Indexable but not useful as "firstPrompt".
- **Sub-agent traces:** under `<sessionId>/subagents/agent-*.jsonl`. Same record shape; treat as belonging to the same parent session for display, but they have their own message tree.
- **Subdir-only sessions (no top-level jsonl):** older projects. Indexer must tolerate sessions with only `subagents/` content.
- **JSONL line lengths:** assistant messages with large `thinking` signatures can exceed 100KB per line. Use streaming read, not full-file `JSON.parse` of joined content.
