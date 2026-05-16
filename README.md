<div align="center">

# Claude Search

### Find any conversation you ever had with Claude Code — in seconds, all local

Ask *"where did I work out that postgres pool issue?"* and Claude searches every transcript on your machine, ranks the hits, and hands you a `claude --resume` you can paste straight back. No API key, no upload, no signup — your sessions never leave the laptop.

[Quick Start](#quick-start) · [Try it](#try-it) · [How it works](#how-it-works) · [More plugins](https://github.com/JCodesMore/jcodesmore-plugins)

</div>

---

## Quick Start

**1. Install the plugin** — inside Claude Code, run:

```
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install claude-search@jcodesmore-plugins
```

Then fully **restart Claude Code** (quit the app and reopen).

**2. That's it.** The first time a session starts, the indexer reads everything under `~/.claude/projects/` once. After that it only re-reads files that changed. No API key, no signup — just start asking.

## Try it

Talk to Claude like a friend who remembers everything you've ever done together:

- *"Search my sessions for the migration script we wrote last month."*
- *"Find where I debugged that pgbouncer pool exhaustion."*
- *"Look up my notes on tokio cancellation safety."*
- *"What did I figure out about Next.js middleware?"*
- *"Open a browser UI to browse my history."*

Each result comes with a `claude --resume <id>` command — paste it and you're back in that conversation, exactly where it ended.

## What's inside

| Capability | Try saying |
|---|---|
| Ranked full-text search | *"Find sessions where I worked on JWT validation"* |
| Filter by project | *"Search 'auth refactor' in the web-app project"* |
| Resume any past session | *"Give me a resume command for the pgbouncer one"* |
| Local web UI | *"Open the search UI in my browser"* |
| Show only recent matches | *"What did I work on yesterday about Postgres?"* |

## How it works

- **Local-only.** Reads `~/.claude/projects/**/*.jsonl` (the transcripts Claude Code already writes). Nothing is uploaded.
- **Incremental.** Files unchanged since the last pass are skipped. The first index takes ~30 seconds on a large corpus; later runs are fast.
- **Ranked.** BM25 with a small user-role boost and recency decay — so the message you wrote yourself ranks above tool output, and recent sessions rank above stale ones.
- **Resumable.** Every result includes `claude --resume <session-id>`. Run it in the original project directory to pick the conversation back up.
- **Zero deps.** Pure Node 20 stdlib. No native bindings, no install step, no npm packages.

## Try the CLI directly

If you want to run it outside Claude Code:

```bash
node scripts/search.mjs "your query here"
node scripts/search.mjs --web              # opens local UI at 127.0.0.1
node scripts/search.mjs --project foo bar  # filter by project name
node scripts/search.mjs --json query       # machine-readable output
```

<details>
<summary><b>Where the index lives</b></summary>

The index is stored at `~/.claude-search/` (override with `CLAUDE_SEARCH_HOME`):

- `index.json` — postings offsets, document metadata, session metadata
- `postings.ndjson` — one token per line; loaded on demand for each query
- `docs.ndjson` — one message per line; loaded on demand for snippets
- `manifest.json` — file signatures so we know what changed

To rebuild from scratch, delete the folder. The next session start (or any `/search`) will rebuild it.

</details>

<details>
<summary><b>Advanced install (without the marketplace)</b></summary>

```bash
git clone https://github.com/JCodesMore/claude-search.git
cd claude-search
# Use directly from this clone:
claude --plugin-dir ./claude-search
```

**Requirements:** Node.js ≥ 20.

</details>

<details>
<summary><b>Run the tests</b></summary>

```bash
npm test
```

35 tests covering the reader, indexer, searcher, formatter, and web server — all on synthetic JSONL fixtures, no fixtures from your real machine.

</details>

## License

[Apache License 2.0](LICENSE) — © 2026 JCodesMore

> Search runs entirely on your local machine. No network calls, no telemetry, no third-party services.

---

*Part of [jcodesmore-plugins](https://github.com/JCodesMore/jcodesmore-plugins).*
