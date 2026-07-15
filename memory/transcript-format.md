# Provider Formats

- Claude Code: project JSONL records with `user`/`assistant` messages and optional subagent JSONL below `<session>/subagents/`.
- Codex: rollout JSONL with `session_meta`, `turn_context`, and `response_item` messages; non-mirrored `event_msg` records supplement response messages and provide the fallback when response messages are absent.
- OpenCode: SQLite `session -> message -> part`; text and subtask prompts are searchable, while reasoning/tool/file/snapshot/patch parts are excluded.

Adapters tolerate malformed records and return diagnostics. Synthetic tests capture the accepted shapes.
