# Agent Recall v1: goal and plan

## North star

An agent that needs something from a past conversation finds the right conversation on its
first search and reads exactly as much of it as it needs, whole transcript included. Any
agent on the machine, any provider, installed with one line.

## Done means

Each line is checked by a command, not by opinion.

1. **Finds it.** The committed recall benchmark (`npm run eval`) scores hit@1 >= 0.9 and
   hit@5 = 1.0 on synthetic fixtures built from real failure shapes: paraphrased questions,
   terms spread across turns, file paths, shell commands, chat titles, subagent work,
   compacted sessions. The private eval against this machine's real history
   (`npm run eval:local`, never committed) beats v0.6 on the same query set.
2. **Reads all of it.** `read` pages through any session with no silent gaps, and
   `read --out FILE` writes the complete transcript. A test proves every indexed message of
   a long session appears exactly once across pages.
3. **Sees everything.** Claude Code (CLI, desktop Code tab titles, Cowork, subagents), Codex
   (active, archived, titles, subagent threads), OpenCode and Cursor are indexed on this
   machine. `doctor` reports counts per provider.
4. **Fast.** A search with nothing new to index answers in under a second on this machine.
   A full first index of this machine completes and reports progress.
5. **Installs in one line.** Claude Code plugin, `npx skills add JCodesMore/agent-recall`,
   or "install this repo" to any agent. The installer is idempotent, keeps files it did not
   write, and is tested against a temporary home.
6. **One skill file.** The root `SKILL.md` is the only skill. A test lints it: frontmatter,
   referenced files exist, every command it shows parses against the CLI.
7. **Compatible.** `scripts/recall.mjs search --json --limit N --cwd DIR -- QUERY` still
   returns `hits[]` with `score`, so existing helpers keep working.
8. `npm run check` is green.

## Plan (vertical slices, each ends on its check)

1. Skeleton: new layout, shared config, JSONL reader, fixture builders. Check: `npm test`.
2. Claude provider end to end: parse to index to search to read, with turns and tool
   summaries. Check: Claude fixtures searchable and readable in full.
3. Search engine: query parsing, turn-level passages, session ranking, snippets. Check:
   benchmark on Claude fixtures.
4. Codex provider plus titles and subagent threads from `state_*.sqlite`. Check: fixtures.
5. OpenCode and Cursor providers. Check: fixtures.
6. Claude desktop titles and Cowork sessions. Check: fixtures.
7. Incremental sync: append-only tail parsing, lock, progress. Check: tests plus timing on
   the real machine.
8. CLI surface and rendering: `search`, `read`, `recent`, `show`, `sync`, `doctor`,
   `attachment`, compatibility flags. Check: CLI tests.
9. Skill, references, install paths, README. Check: skill lint, installer tests.
10. Real-machine verification: full index, local eval, timing, then review.
