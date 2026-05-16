---
name: search
description: Search your past Claude Code conversations. Use when the user asks to find, search, look up, or recall something from past sessions, transcripts, chats, or history.
argument-hint: [query]
allowed-tools: Bash(node *)
---

# Search past Claude Code conversations

Search the user's local Claude Code transcripts (everything under `~/.claude/projects/**`) and return ranked, resumable sessions. Indexing is incremental — only changed files are re-read.

## When the user gives a query

Run the search CLI with the user's query. Pass everything they typed as one argument.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs" $ARGUMENTS
```

The CLI prints ranked results with:
- Date and project for each match
- A highlighted snippet
- A `claude --resume <id>` command to resume that session

Forward the CLI output to the user as-is. Do not summarize — the styled output is the product.

## When the user wants to browse in a web UI

If the user asks to "open", "browse", "show me a UI", or otherwise wants a visual interface, pass `--web`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/search.mjs" --web $ARGUMENTS
```

This starts a local server on `127.0.0.1:<port>` and prints the URL. Tell the user to open that URL in their browser. The server keeps running until they stop it with Ctrl+C.

## When the user gives no query

Tell them what to do: `/claude-search:search <words to find>`. Mention they can also add `--web` to browse in a browser, or `--project <name>` to filter by project.

## Notes

- All searching is local. Nothing leaves the machine.
- The index lives at `~/.claude-search/` and is refreshed automatically.
- If a session shows up but resume fails, the transcript was likely deleted — tell the user to run the search again to refresh the index.
