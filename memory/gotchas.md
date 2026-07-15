# Gotchas

- OpenCode WAL changes are part of the source signature.
- Codex event messages often duplicate response items; use them only as a fallback.
- Claude subagents can reuse filenames across parent sessions; namespace them under the parent ID.
- A source mtime is not proof that an agent process is active.
- `node:sqlite` can emit an experimental warning on supported Node releases; the CLI suppresses that warning without suppressing errors.
- Full paths are useful for local scoping but should not appear in compact public output.
