# How agents used Agent Recall v0.6, and where it failed

Mined on 2026-09-27 from this machine's real Claude Code and Codex transcripts: 1,065 recall
calls in 135 sessions (search 636, context 231, transcript 57, session 42, recent 23). Numbers
below are measured unless marked otherwise. No transcript content is reproduced.

## Failure modes, ranked

1. **Per-message AND was too strict.** 48% of searches fell back to OR mode, 30 more returned
   nothing. Terms spread across a conversation never added up because each session was ranked
   by its single best message. One user question took 41 reformulations.
2. **The current chat and earlier "find X" chats ranked first.** 23% of Codex searches had the
   calling session as the top hit. A chat asking "find the Bedrock credits convo" outranked
   the Bedrock conversation itself.
3. **Injected context was indexed as the user's words and used as titles.** 1,090 of 2,228
   Codex titles started with `<`, 299 with `# AGENTS.md instructions`, 161 with
   `# Files mentioned`. Real titles in `~/.codex/session_index.jsonl` were never read.
4. **Forks and subagents split conversations.** Codex forks copy their parent's history, so
   four forks crowded out the original. 729 of 873 Claude files are subagent transcripts.
5. **Tool calls were not indexed.** About 90% of Claude and 92% of Codex bytes are tool input
   and output. Agents fell back to grepping raw files 66 times in 12 sessions, looking for
   commands, file names and error strings.
6. **Project scoping excluded the right chat.** One project lived under five roots plus 30
   worktrees; a `--cwd` filter hid the answer.
7. **IDs were fragile.** Keys hashed the source path, so archiving a Codex rollout changed
   them. Bare native ids, `codex:<id>` and `codex://threads/<id>` all failed.
8. **Output was too large.** Median search output 7K characters, context up to 26K, a limit of
   20 produced 62K. 147 calls piped output through filters to shrink it.
9. **Sync blocked searches.** Median 0.74 s, p90 5.1 s, max 159 s, almost all of it re-parsing
   growing files from scratch. The query itself took about 8 ms.
10. **Shell friction.** Invented flags (`--global`, `--session`), a curly apostrophe breaking
    PowerShell quoting, a base64 wrapper script written just to pass queries.
11. **Transcript paging was clumsy.** Agents paged to the end 20 messages at a time; requests
    for 400 were silently cut to 100; no tail, no search inside a session, no export.
12. **Coverage gaps.** `subagents/workflows/**` files, Codex inter-agent messages, Cursor,
    Cowork and Claude desktop titles were never read.

Successes shared one pattern: a distinctive term (a project nickname, a product name) found
the chat in one to three searches.

## What the stores contain

Claude sample (50 files), characters by block type: tool_result 32.9M, tool_use input 7.0M,
user text 3.2M, assistant text 1.2M, thinking 0.85M, compact summaries 0.5M. Codex sample
(40 rollouts, 170 MB): compacted replacement history 48%, command executions 12%, tool
outputs 13%, user messages 8% (mostly injected context), assistant messages 0.3%.

## Requirements this produced

- Rank whole conversations from turn-level passages; no AND cliff.
- Strip injected context before indexing and titling; read real titles.
- Exclude the calling session; demote chats whose matching turn is itself a recall request.
- Fold subagents into their root; collapse fork-copied history onto the original.
- Index one line per tool call plus the head and tail of its output.
- Treat the current project as a ranking boost, never a filter.
- Stable ids that survive archiving; accept every id form agents actually tried.
- Compact text output with next-step commands; bounded sizes; honest truncation notes.
- Incremental sync from byte offsets; never block a search for long.
- Query from stdin; suggest the right flag for unknown ones.
