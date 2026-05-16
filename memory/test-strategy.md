# Test strategy

Use `node:test` (Node 20 stdlib). All fixtures in `test/fixtures/`.

## Fixture corpus

- `test/fixtures/projects/proj-a/<sid1>.jsonl` — small session, 3 user+3 assistant messages.
- `test/fixtures/projects/proj-a/<sid2>.jsonl` — session with tool_use + tool_result blocks.
- `test/fixtures/projects/proj-b/<sid3>.jsonl` — session with summary + ai-title records.
- `test/fixtures/projects/proj-b/<sid3>/subagents/agent-x.jsonl` — sub-agent trace.
- `test/fixtures/projects/proj-c/<sid4>/subagents/agent-y.jsonl` — subdir-only session.
- `test/fixtures/projects/proj-d/<sid5>.jsonl` — pathological: 50KB message, unicode, emojis.

## Coverage

1. **transcript-reader** — every record type yields the expected normalized record; counts match expected; thinking blocks skipped.
2. **paths** — discovers all five fixtures, including subdir-only.
3. **indexer.delta** — first run indexes all; second run skips unchanged; appending a line re-indexes only that file; deleting a file removes its docs.
4. **searcher** — BM25 ranks expected doc first; phrase-like proximity boosts; cross-session results sorted by score.
5. **snippet** — match centered, ellipses, highlight markers preserved.
6. **formatter** — CLI output contains `claude --resume <sid>`; JSON output has stable schema; web HTML escapes user content.
7. **web-server** — picks a free port in range; `/api/search?q=…` returns same Result[] as CLI; smoke-test with `fetch`.
8. **e2e** — point `CLAUDE_SEARCH_HOME` env at fixtures, run real `scripts/search.mjs hello`, assert exit 0 + non-empty output.

## Synthetic JSONL generator

`test/fixtures/build.mjs` generates fixtures deterministically — checked-in output too, so tests don't depend on regeneration.

## Run

`node --test test/*.test.mjs`
