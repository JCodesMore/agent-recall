# Definition of Done — checklist

1. [x] `/plugin marketplace add` + `/plugin install` works; `/search <q>` returns real hits after restart. (Skill at `skills/search/SKILL.md` invokes `scripts/search.mjs $ARGUMENTS`; SessionStart hook seeds the index.)
2. [x] Lossless: every message in every transcript searchable (verified via fixture line counts and `tokens-matching-Object.prototype-names` regression test).
3. [x] Incremental: unchanged files skipped (mtime+size check); new/appended sessions picked up by SessionStart hook.
4. [x] Fully local — no network, no API keys, no paid services, no telemetry.
5. [x] Result line: highlighted snippet + date + project path + msg count + `claude --resume <sid>` (copyable).
6. [x] `/search --web` boots local server on 127.0.0.1:<port>; chat footer mentions URL.
7. [x] Cross-platform: only `os.homedir()` + `path.join`. No literal `~`, no literal `/` in filesystem paths (confirmed via grep).
8. [x] README mirrors `JCodesMore/youtube-for-ai-agents` style (install UX, voice, sections).
9. [x] Tests pass on synthetic JSONL via `node:test`; 35/35 pass.

## Hidden DoD (project hygiene)

- [x] No magic numbers/strings outside `src/config.mjs` (sidecar filenames + title-truncation length moved to `INDEX_FILES` / `SEARCH_DEFAULTS`).
- [x] No dead code — every remaining `export` is referenced from outside its file. Internal-only helpers (`pickWindow`, `highlightWindow`, `manifestPath`, `emptyIndex`, `buildPostings`, `indexPath`, `postingsPath`, `docsPath`) were unexported. Dead exports (`TranscriptNotFound`, `projectsRoot`, `readPosting`, `uniqueTokens`) removed.
- [x] Public function names are self-documenting (per CLAUDE.md: no comments unless the *why* is non-obvious).
- [x] CHANGELOG.md, LICENSE (Apache-2.0), package.json (`"type": "module"`, no deps).
- [x] Marketplace.json valid + reviewed against Claude Code reference schema.
- [x] Smoke-tested from clean dir end-to-end: 20 ranked results in 1.7s against real ~/.claude/projects/ corpus.
