# Architecture (working draft)

## Layers (one responsibility each)

1. **`src/config.mjs`** — all constants: paths, limits, scoring weights, port range, file globs. No code logic.
2. **`src/paths.mjs`** — resolves `~/.claude/projects/`, walks transcript files, derives `sessionId` ↔ file path ↔ project path. Pure path-fu.
3. **`src/transcript-reader.mjs`** — streams a `.jsonl` file, yields normalized `{sessionId, messageId, role, ts, text, project, cwd}` records. Pure dispatch on `type` field.
4. **`src/indexer/`** — persists a queryable index:
   - `manifest.mjs` — per-file `{mtime, size, hash, sessionId, lastIndexedAt}` map.
   - `inverted.mjs` — token→postings inverted index, BM25 stats.
   - `delta.mjs` — diff filesystem against manifest, re-index changed files only.
5. **`src/searcher/`** — query API:
   - `tokenize.mjs` — pure tokenizer (lowercase, unicode-safe).
   - `score.mjs` — pure BM25 scorer over postings.
   - `snippet.mjs` — pure highlighter: given match positions in original text, return snippet ±N chars.
   - `index.mjs` — `Searcher.search(query, opts) -> Result[]` ; loads index lazily.
6. **`src/formatter/`** — renders Result[] for CLI (ANSI), JSON (web API), markdown (skill).
7. **`src/web-server/`** — minimal Node http server on 127.0.0.1:<port>; serves static HTML + `/api/search`; uses same Searcher.

## Data flow

```
jsonl files
   │
   ▼
[paths.list()] → file paths
   │
   ▼
[transcript-reader.read(file)] → normalized records
   │
   ▼
[indexer.delta.update()] → updates manifest + inverted index on disk
   │
   ▼  (query time)
[searcher.search(q)] → ranked Result[]
   │
   ▼
[formatter.cli|json|md] → output
```

## Index storage

Two files in plugin data dir (e.g. `~/.claude-search/`):
- `manifest.json` — `{ "<absPath>": {sessionId, mtime, size, hash, recordCount} }`
- `index.json` — `{ docs: [{id, sessionId, project, cwd, ts, firstPrompt, summary, msgCount, role}], postings: { token: [[docId, tf, [positions]], ...] }, df: {token:n}, N: <docs>, avgdl: <num> }`

Storing as JSON keeps the index portable and inspectable; size for typical users (~100MB jsonl) should be <30MB.

## Layer interfaces (explicit)

- `Searcher.search(query: string, opts: {limit?: number, project?: string}) -> Promise<Result[]>` — single API surface. CLI, web, skill all call this. None touches `index.json` directly.
- `Result = { sessionId, project, cwd, ts, firstPrompt, summary, msgCount, score, snippet, resumeCommand }`
- `TranscriptReader.read(absPath: string) -> AsyncIterable<Record>` — pure streaming.
- `Indexer.update(opts?: {force?: boolean}) -> Promise<{indexed: number, skipped: number, removed: number}>` — incremental by default.

## Why not SQLite FTS5

- Native dep across win/mac/linux is brittle for a "two-command install, zero config" plugin.
- Pure JS keeps deps to zero (Node 20 stdlib is enough).
- Inverted-index + BM25 is ~200 LOC and runs in <100ms for typical loads.

## Web UI

Static HTML/JS in `src/web-server/public/`. JS fetches `/api/search?q=…` and renders. Same `Searcher.search()` backs the API. Port picked from `[PORT_MIN..PORT_MAX]` in config; first free wins.

## Hook → indexer

`hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/index-delta.mjs\"" }
        ]
      }
    ]
  }
}
```

Hook runs asynchronously, non-blocking (script `setTimeout(()=>process.exit(0),0)` after kicking off background work).
