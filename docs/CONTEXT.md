# Vocabulary

**Provider**: an agent product whose history we read: `claude`, `codex`, `opencode`, `cursor`.
Claude desktop Code tab and Cowork sessions are `claude` with a different **origin**.

**Source**: one file or database a provider writes (a Claude JSONL file, a Codex rollout, the
OpenCode database). Sync tracks each source's size, mtime and read offset.

**Session**: one conversation. It has a **handle**, a short stable id such as `k3f9x2a` that
every command accepts, alongside the provider's own **native id** (a UUID) or a unique prefix
of it. _Avoid_: thread, chat, task (except when quoting a provider).

**Root session** and **subagent session**: a subagent session was spawned by another session
(Claude Task agents, Codex spawned threads, OpenCode subtasks). Search folds subagent matches
into their root so one conversation is one result.

**Message**: one normalized entry in a session, numbered by **seq** from 0. Its **kind** is
`text` (what the user or assistant said), `tool` (a one-line summary of a tool call: the
command run, the file edited, the prompt given to a subagent) or `summary` (a compaction
summary the provider wrote).

**Turn**: a user text message and everything after it until the next one.

**Passage**: the searchable unit. A turn split into pieces of at most `PASSAGE_MAX_CHARS`,
indexed with separate columns for user text, assistant text and tool summaries.

**Hit**: one search result: a root session, its score, and the passages that matched, each
pointing at a message seq to read from.

**Title**: the best available name for a session, from the richest source that has one: a
user-set desktop title, a provider-generated title, then the first user prompt.

**Index**: the SQLite database under the data home. Derived state; `sync` rebuilds it.
