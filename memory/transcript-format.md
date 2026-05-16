# Transcript JSONL format (observed in real files)

## Storage location

Claude Code stores transcripts under `~/.claude/projects/<sanitized-cwd>/`:

- Project dir naming: cwd with `\` → `-`, `:` → empty, `/` → `-`. Example:
  - cwd `C:\Users\jmd50\Documents\Main\Projects\Claude\claude-search`
  - dir `C--Users-jmd50-Documents-Main-Projects-Claude-claude-search`
- Top-level files: `<sessionId>.jsonl` — the main transcript (newer projects)
- Subdir per session: `<sessionId>/subagents/agent-*.jsonl` — sub-agent traces
- Older projects may have `<sessionId>/` dirs with only `subagents/` (no main jsonl)
- `sessions-index.json` exists in some projects but is stale — DO NOT trust it; walk the filesystem.

**Implication:** the goal-spec path `~/.claude/projects/**/sessions/*.jsonl` is WRONG. Real pattern is `~/.claude/projects/<proj>/*.jsonl` + `~/.claude/projects/<proj>/<sid>/subagents/*.jsonl`.

## Record types observed

One JSON object per line. Top-level `type` distinguishes record kinds:

- `user` — user message. `message.role: "user"`, `message.content` is string OR array.
- `assistant` — assistant turn. `message.content` array of blocks.
- `attachment` — hook output, system context, command output.
- `summary` — session summary (where present).
- `ai-title` — AI-generated short title.
- `file-history-snapshot` — file tracking metadata (not searchable).
- `permission-mode`, `last-prompt`, `base64`, `create`, `system`, `text`, `tool_result` — metadata or wrappers; treat as either non-content or extract text where present.

## Common fields (on user/assistant/attachment)

- `uuid` — record id
- `parentUuid` — tree linkage (null for root)
- `sessionId` — same across all messages in one session
- `timestamp` — ISO 8601 UTC
- `cwd` — absolute path of project dir at time of message (Windows backslashes preserved)
- `version` — Claude Code version
- `gitBranch`
- `isSidechain` — true for messages inside sub-agent invocations
- `isMeta` — true for harness-injected user messages (e.g., `<command-name>` wrappers)

## Content block shapes

User message content:
- string — plain user text
- array of blocks:
  - `{type: "text", text: "..."}` — searchable
  - `{type: "tool_result", content: <string or array of {type:"text", text}>, tool_use_id, is_error}` — searchable

Assistant message content (always array):
- `{type: "text", text: "..."}` — searchable
- `{type: "thinking", thinking: "...", signature}` — ENCRYPTED in `thinking` field; treat as non-searchable (server-encrypted blob is opaque).
- `{type: "tool_use", id, name, input: {...}}` — index `name` + key string values from `input` (e.g., file paths, bash commands).

Attachment content (varies):
- `content` may be a string, an array of strings, or `stdout`/`stderr` text inside a `hook_success` shape. Extract any string fields.

## First-prompt + summary heuristic

For per-result display:
- "First prompt" = first `type:"user"` with `isMeta:false` (or fall back to first user record).
- "Summary" = `type:"summary"` record's `summary` field if present, else `ai-title.title`, else trimmed first prompt.

## Resume command

`claude --resume <sessionId>` is the canonical resume. SessionId is in every record AND is the filename stem of the main jsonl.

## Lossless extraction rules

For each line, dispatch on `type` and emit zero or more `{messageId, role, text, ts}` searchable units. Concatenating all units per message preserves all visible text; thinking blocks (encrypted) are intentionally skipped.
