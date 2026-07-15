# Decisions

- Use the Agent Skills standard plus a local CLI instead of permanent MCP configuration.
- Require Node 22.13+ and use built-in `node:sqlite`; avoid native npm dependencies.
- Use lexical BM25 plus agent-side query reformulation. Local embeddings are a future opt-in feature, not a baseline dependency.
- Index redacted conversational text only. Tool output and reasoning are excluded.
- Open OpenCode databases read-only and never query credential-bearing tables.
- Represent resume operations as `{command,args,cwd}`, not interpolated shell strings.
- Report activity as a state with confidence and reasons, not a guessed boolean.
- Keep root `SKILL.md` authoritative; the Claude plugin skill is a thin wrapper.
