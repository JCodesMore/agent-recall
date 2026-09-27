# Provider formats

What each provider stores and how `src/providers/<id>.mjs` normalizes it. Shapes were read
from real stores in September 2026; every rule below is covered by a synthetic test.
Normalized output is documented in `src/providers/builder.mjs`; the provider interface in
`src/providers/registry.mjs`.

## Claude Code (`claude.mjs`)

- **Transcripts:** `~/.claude/projects/<slug>/<session-uuid>.jsonl`. Subagents live below
  the session: `<session-uuid>/subagents/**/agent-<id>.jsonl` (nested folders such as
  `workflows/` exist) with `agent-<id>.meta.json` holding `description` and `agentType`.
  Subagent native id: `<session-uuid>:agent-<id>`.
- **Cowork:** `<appData>/Claude/local-agent-mode-sessions/<acct>/<org>/local_<id>/.claude/projects/`,
  same layout, origin `cowork`.
- **Records:** `user` (string or blocks: `text`, `image` base64, `tool_result`), `assistant`
  (`text`, `tool_use`, `thinking` ignored), `custom-title` (from `/rename`, user title),
  `agent-name`, `ai-title`, `summary`, `attachment` (only `queued_command` carries user words),
  `system`, `file-history-snapshot`, `progress`. `isCompactSummary` user records become
  `summary` messages; `isMeta` user records are skipped.
- **Injected text** removed from user messages: `system-reminder`, `local-command-*`,
  `command-message` tags; slash commands become `/name args`; interruption notices dropped.
- **Large lines:** `file-history-snapshot`, `progress` and non-`queued_command` attachments
  are skipped from their first bytes without parsing.
- **Labels:** the desktop Code tab keeps `<appData>/Claude/claude-code-sessions/<acct>/<org>/local_<id>.json`
  with `cliSessionId`, `title`, `titleSource` (`user` or generated) and `isArchived`. Cowork
  keeps the same file shape plus `userSelectedFolders` (used as the cwd).
- **Retention:** `cleanupPeriodDays` in `~/.claude/settings.json` (default 30) deletes old
  transcripts; `doctor` warns below 90 days.
- **Current session:** `CLAUDE_CODE_SESSION_ID` is set for tool processes and excluded.

## Codex (`codex.mjs`)

To be written with the provider.

## OpenCode (`opencode.mjs`)

- **Store:** `<XDG_DATA_HOME or ~/.local/share>/opencode/opencode*.db`, SQLite, opened
  read-only. Tables `session`, `message`, `part` with JSON `data` columns. One source per
  database; it is re-read whenever the file or its WAL changes.
- **Parts:** `text` (user or assistant; `synthetic`/`ignored` parts dropped), `tool`
  (`state.input`, `state.output`, `state.error`), `subtask` (a spawned subagent's prompt),
  `file` (data URL attachments). `reasoning`, `step-*`, `patch` and `compaction` are skipped.
  Assistant messages with `summary: true` are compaction summaries.
- **Sessions:** `parentID` marks subagents; `directory` is the cwd; titles are generated
  unless they are OpenCode's `New session - <date>` placeholder, which falls back to the
  first prompt. `apply_patch` inputs arrive as `patchText`.
- **Legacy:** pre-SQLite `storage/session|message|part` JSON trees are not read; the stores
  seen so far had already been migrated.
- **Resume:** `opencode --session <id>`.

## Cursor (`cursor.mjs`)

- **Transcripts:** `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, with
  subagents in `<uuid>/subagents/<child>.jsonl`. Lines are `{role, message: {content: [text |
  tool_use]}}`: no timestamps and no tool results.
- **User text:** only the `<user_query>` body is indexed. The surrounding `<timestamp>` tag
  gives message times when present; otherwise file times bound the session.
- **Folder:** the slug is the workspace path with every non-alphanumeric run replaced by `-`,
  so it is decoded by matching real directory names level by level.
- **Labels:** `<appData>/Cursor/User/globalStorage/state.vscdb`, table `composerHeaders`:
  titles, archive flags, workspace folders and subagent parents.
- **Resume:** CLI chats (listed under `~/.cursor/chats/`) resume with
  `cursor-agent --resume <id>`; IDE chats have no resume command.
