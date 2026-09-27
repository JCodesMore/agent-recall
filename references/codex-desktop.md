# Reopening a Codex conversation in the desktop app

Use this when the user asks to restore, reopen or return to a Codex task. It needs the Codex
app's own tools (`read_thread`, `set_thread_archived`, `navigate_to_codex_page`); without
them, say that desktop navigation is unavailable here and offer the `resume` command from
`show` instead, which reopens the conversation in the Codex CLI.

1. Run `show HANDLE`. Continue only when the provider is `codex`. Its `id` is the desktop
   `threadId`. A `part of:` line means this is a subagent thread; the user usually wants the
   parent, so ask when both are plausible.
2. Read the thread with `read_thread` to confirm its current title and `hostId`. The app is
   the authority on titles and archive state; the index may lag.
3. Check the archive list on that host, following its pagination. When the task is archived,
   call `set_thread_archived` with its `threadId`, `hostId` and `archived: false`.
4. Open it with `navigate_to_codex_page`. Report unarchiving and navigation separately if
   either fails.

A `codex://threads/<threadId>` link opens a task but does not unarchive it.
