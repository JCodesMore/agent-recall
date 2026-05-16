# Claude Code Plugin Spec — Reference for `claude-search`

Compiled from official Anthropic docs on 2026-05-15. All quotes are verbatim from the source pages.

## Source URLs

- Plugins guide: https://code.claude.com/docs/en/plugins
- Plugins reference: https://code.claude.com/docs/en/plugins-reference
- Skills: https://code.claude.com/docs/en/skills
- Sub-agents: https://code.claude.com/docs/en/sub-agents
- Hooks: https://code.claude.com/docs/en/hooks
- Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Best practices: https://code.claude.com/docs/en/best-practices

---

## 0. Critical conceptual change: commands == skills

The Skills page says this verbatim: **"Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way. Your existing `.claude/commands/` files keep working."**

For a plugin, both layouts work:
- `commands/<name>.md` — flat file (legacy form, still supported).
- `skills/<name>/SKILL.md` — directory with optional supporting files (recommended for new plugins per the reference).

Both share the same frontmatter schema and the same string-substitution rules. The body of a `commands/*.md` file IS the body of an equivalent `SKILL.md`. There is no separate "slash command frontmatter" anymore.

For our `/search <query>` we should use `skills/search/SKILL.md`. It gives us a folder to drop supporting files (e.g. a `scripts/launch-ui.js`) and is the path the docs recommend for new plugins.

---

## 1. `plugin.json` schema

Location: `<plugin-root>/.claude-plugin/plugin.json`. Warning from the docs: "Don't put `commands/`, `agents/`, `skills/`, or `hooks/` inside the `.claude-plugin/` directory. Only `plugin.json` goes inside `.claude-plugin/`."

The manifest is optional: "If omitted, Claude Code auto-discovers components in default locations and derives the plugin name from the directory name." If included, only `name` is required.

### Complete schema (verbatim from plugins-reference)

```json
{
  "name": "plugin-name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "skills": "./custom/skills/",
  "commands": ["./custom/commands/special.md"],
  "agents": ["./custom/agents/reviewer.md"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json",
  "experimental": {
    "themes": "./themes/",
    "monitors": "./monitors.json"
  },
  "dependencies": [
    "helper-lib",
    { "name": "secrets-vault", "version": "~2.1.0" }
  ]
}
```

### Required fields

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Only required field. kebab-case, no spaces. Acts as the namespace for all components — agent `agent-creator` in plugin `plugin-dev` appears as `plugin-dev:agent-creator`. |

### Optional metadata

| Field | Notes |
|-------|-------|
| `$schema` | `"https://json.schemastore.org/claude-code-plugin-manifest.json"` for editor autocomplete. Claude Code ignores at load. |
| `version` | Optional semver. **If set, users only update when you bump it.** If omitted in a git-hosted marketplace, the commit SHA is the version and every commit counts as new. |
| `description` | Shown in `/plugin` manager. |
| `author` | Object: `name` (required), `email`, `url`. |
| `homepage`, `repository`, `license`, `keywords` | Discovery metadata. |

### Component-path fields (replace-vs-add semantics)

| Field | Replaces or adds | Notes |
|-------|-----------------|-------|
| `skills` | **ADDS** to default `skills/` | string or array, paths must start with `./`. |
| `commands` | **REPLACES** default `commands/` | Same path rules. To keep the default folder, list it explicitly. |
| `agents` | **REPLACES** default `agents/` | |
| `outputStyles` | REPLACES default | |
| `experimental.themes` / `experimental.monitors` | REPLACE defaults | |
| `hooks`, `mcpServers`, `lspServers` | own merge rules | Each has its own merging behaviour, see individual sections in the reference. |

All paths must be relative and start with `./`. Multiple paths can be passed as arrays.

### `userConfig` (worth knowing about)

Declares values prompted at enable time, available as `${user_config.KEY}` substitution and `CLAUDE_PLUGIN_OPTION_<KEY>` env var. Field types: `string`, `number`, `boolean`, `directory`, `file`. Use `"sensitive": true` for secrets — stored in keychain (~2 KB limit). Not needed for our search plugin unless we want the user to configure a search index path.

### Minimal manifest we'll likely use

```json
{
  "name": "claude-search",
  "version": "0.1.0",
  "description": "Local search UI for your Claude conversations",
  "author": { "name": "Subs" }
}
```

---

## 2. `marketplace.json` schema

Location: `<marketplace-repo-root>/.claude-plugin/marketplace.json`.

### Verbatim example (from plugin-marketplaces)

```json
{
  "name": "company-tools",
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@example.com"
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "Automatic code formatting on save",
      "version": "2.1.0",
      "author": {
        "name": "DevTools Team"
      }
    },
    {
      "name": "deployment-tools",
      "source": {
        "source": "github",
        "repo": "company/deploy-plugin"
      },
      "description": "Deployment automation tools"
    }
  ]
}
```

### Required fields

| Field | Notes |
|-------|-------|
| `name` | kebab-case marketplace identifier. Reserved names: `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `knowledge-work-plugins`, `life-sciences`, plus look-alikes. |
| `owner` | Object: `name` required, `email` optional. |
| `plugins` | Array of plugin entries. |

### Plugin-entry sources (the "path vs git URL" question)

Both work, plus more:

| `source` form | Shape | Notes |
|---------------|-------|-------|
| Relative path (string) | `"./plugins/my-plugin"` | Must start with `./`. Resolved from the marketplace root (directory containing `.claude-plugin/`), NOT from inside `.claude-plugin/`. No `../`. **Only works when users add the marketplace via Git or local path — fails for URL-based marketplaces** (URL marketplaces only download the JSON, not the plugin files). |
| `github` | `{"source": "github", "repo": "owner/repo", "ref"?: "v2.0.0", "sha"?: "..."}` | |
| `url` | `{"source": "url", "url": "https://...", "ref"?, "sha"?}` | Git URL on any host. `.git` suffix optional. |
| `git-subdir` | `{"source": "git-subdir", "url": "...", "path": "tools/plugin", "ref"?, "sha"?}` | Sparse clones for monorepos. |
| `npm` | `{"source": "npm", "package": "@org/plugin", "version"?, "registry"?}` | |

`ref` is branch or tag; `sha` pins to a 40-char commit. Marketplace source itself only supports `ref` (no `sha`); plugin sources support both.

### Versioning (verbatim resolution order)

> "The version is resolved from the first of these that is set:
> 1. The `version` field in the plugin's `plugin.json`
> 2. The `version` field in the plugin's marketplace entry in `marketplace.json`
> 3. The git commit SHA of the plugin's source, for `github`, `url`, `git-subdir`, and relative-path sources in a git-hosted marketplace
> 4. `unknown`, for `npm` sources or local directories not inside a git repository"

**Warning from docs:** "If you set `version` in `plugin.json`, you must bump it every time you want users to receive changes. Pushing new commits alone is not enough."

Recommendation for active development: **omit `version` from both** so commit SHA does the work and every push is a new version.

### `strict` mode (relevant if marketplace entry overrides plugin.json)

- `strict: true` (default) — `plugin.json` is the authority; the marketplace entry can supplement.
- `strict: false` — marketplace entry IS the entire definition; `plugin.json` declaring components is a conflict.

### Optional marketplace fields

`$schema`, `description`, `version`, `metadata.pluginRoot` (base dir prepended to relative plugin sources, e.g. `"./plugins"`), `allowCrossMarketplaceDependenciesOn`.

---

## 3. Slash command (SKILL.md) frontmatter

Use `skills/<name>/SKILL.md` for new commands. Plugin namespace = plugin's `name` field, so a SKILL at `skills/search/SKILL.md` in plugin `claude-search` invokes as `/claude-search:search`.

### Verbatim frontmatter reference (from Skills doc)

```yaml
---
name: my-skill
description: What this skill does
disable-model-invocation: true
allowed-tools: Read Grep
---

Your skill instructions here...
```

### Full field table

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name. Defaults to directory name. lowercase, digits, hyphens; max 64 chars. |
| `description` | Recommended | What it does + when to use it. Claude uses this to decide auto-invocation. **Put the key use case first — combined `description` + `when_to_use` is truncated at 1,536 chars in the skill listing.** |
| `when_to_use` | No | Trigger phrases / example requests. Appended to `description`. Counts toward 1,536 cap. |
| `argument-hint` | No | Autocomplete hint, e.g. `[issue-number]` or `[filename] [format]`. |
| `arguments` | No | Named positional args for `$name` substitution. Space-separated string or YAML list. |
| `disable-model-invocation` | No | `true` → only you can `/invoke`; Claude won't auto-trigger. Default `false`. |
| `user-invocable` | No | `false` → hidden from `/` menu; only Claude can invoke. Default `true`. |
| `allowed-tools` | No | Tools the skill can use without prompting. Space-separated string or YAML list. Permission rule syntax supported, e.g. `Bash(git add *)`. |
| `model` | No | Override model for the rest of the turn: `sonnet`, `opus`, `haiku`, full ID, or `inherit`. |
| `effort` | No | `low`, `medium`, `high`, `xhigh`, `max`. |
| `context` | No | `fork` → run the skill body in a forked subagent. |
| `agent` | No | Which subagent type for `context: fork`. Defaults to `general-purpose`. |
| `hooks` | No | Skill-scoped hook lifecycle. |
| `paths` | No | Glob list — only auto-invoke when working on matching files. |
| `shell` | No | `bash` (default) or `powershell`. PowerShell requires `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. |

### Argument substitution

| Variable | Behavior |
|----------|----------|
| `$ARGUMENTS` | Full argument string as typed. If the body does not reference it, Claude Code appends `ARGUMENTS: <value>` automatically. |
| `$ARGUMENTS[N]` | 0-indexed positional argument. Shell-style quoting: `"hello world" second` → `$0` = `hello world`, `$1` = `second`. |
| `$N` | Shorthand for `$ARGUMENTS[N]`. |
| `$name` | Named arg from `arguments` frontmatter list. With `arguments: [issue, branch]`, `$issue` = first arg, `$branch` = second. |
| `${CLAUDE_SESSION_ID}` | Current session ID. |
| `${CLAUDE_EFFORT}` | Active effort level. |
| `${CLAUDE_SKILL_DIR}` | Directory containing this `SKILL.md`. For plugin skills, this is the skill subdir within the plugin (NOT plugin root). Use this for `${CLAUDE_SKILL_DIR}/scripts/foo.py` to reference bundled scripts. |

### Body conventions: shell injection ("backtick syntax")

- Inline: `` !`<command>` `` — runs at render time, output replaces the placeholder before Claude sees the body. Preprocessing, not Claude calling Bash.
- Block form (multi-line):

  ````
  ```!
  node --version
  npm --version
  git status --short
  ```
  ````

- Disable globally via setting: `"disableSkillShellExecution": true` (each command becomes `[shell command execution disabled by policy]`).

### How to invoke a bundled script (the pattern for our search plugin)

```yaml
---
name: search
description: Search your Claude conversations. Use when the user asks to search, find, or look up past conversations.
argument-hint: [query]
allowed-tools: Bash(node *)
---

# Search

Run the local search UI script with the user's query:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/launch-ui.js "$ARGUMENTS"
```

The script starts a local web server on http://localhost:<port> and opens the browser.
```

Note: in the example above, the fenced ```bash block is **instructions to Claude**, not auto-executed. To auto-execute, use the ```! form. For starting a local UI server we probably want Claude to be the one launching it via the Bash tool (so the user can see it happen and approve), so the ```bash form is right.

### Commands (flat-file) form, for completeness

Same frontmatter, no folder. Path: `commands/search.md` directly under plugin root. Doesn't get supporting files. Docs recommend skills for new plugins.

### Best-practice notes on description (verbatim-summarized)

- "Check the description includes keywords users would naturally say."
- "Make the description more specific" if Claude triggers too often.
- Skill descriptions live in the listing budget (default 1% of context window). Overflow drops descriptions of least-used skills first.

---

## 4. Hooks: `hooks/hooks.json`

Default location: `hooks/hooks.json` at plugin root. Can also be inline in `plugin.json` via the `hooks` field.

### Verbatim plugin hook example (from plugins-reference)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/format-code.sh"
          }
        ]
      }
    ]
  }
}
```

The top-level wrapper is `{"hooks": { <EventName>: [ {matcher, hooks: [...]} ] }}`. Hooks can optionally have a top-level `description` field.

### Hook event list (full, from the hooks WebFetch summary)

| Event | When | Blocking? |
|-------|------|-----------|
| `SessionStart` | Session begins or resumes (every kind of start) | **No** — cannot block execution; exit 2 only shows stderr |
| `Setup` | `--init-only`, or `--init`/`--maintenance` in `-p` mode | No |
| `UserPromptSubmit` | User submits a prompt | Yes (exit 2) |
| `UserPromptExpansion` | Slash command expands into a prompt | Yes (exit 2) |
| `PreToolUse` | Before tool call | Yes (`permissionDecision`) |
| `PermissionRequest` | Permission dialog opens | Yes |
| `PermissionDenied` | Tool denied by auto mode | No |
| `PostToolUse` | Tool succeeded | No |
| `PostToolUseFailure` | Tool failed | No |
| `PostToolBatch` | Parallel batch resolved | Yes (exit 2) |
| `Notification` | Claude Code notification fires | No |
| `SubagentStart` / `SubagentStop` | Subagent lifecycle | No / Yes (exit 2) |
| `TaskCreated` / `TaskCompleted` | Task tool lifecycle | Yes (exit 2) |
| `Stop` | Claude finishes a turn | Yes (exit 2) |
| `StopFailure` | Turn ended by API error | No |
| `TeammateIdle` | Agent-team teammate about to idle | Yes (exit 2) |
| `InstructionsLoaded` | CLAUDE.md / rules loaded | No |
| `ConfigChange` | Settings changed mid-session | Yes (exit 2) |
| `CwdChanged` | `cd` changed working dir | No |
| `FileChanged` | Watched file changed | No |
| `WorktreeCreate` / `WorktreeRemove` | Worktree lifecycle | Create: Yes (any non-zero); Remove: No |
| `PreCompact` / `PostCompact` | Around context compaction | Pre: Yes; Post: No |
| `Elicitation` / `ElicitationResult` | MCP elicitation | Yes |
| `SessionEnd` | Session terminates | No |

### Matcher rules

| Matcher value | Treated as |
|--------------|-----------|
| `"*"`, `""`, or omitted | Match all |
| Letters/digits/`_`/`\|` only | Exact string or `\|`-separated list, e.g. `"Bash"`, `"Edit\|Write"` |
| Any other char | JavaScript regex, e.g. `"^Notebook"`, `"mcp__memory__.*"` |

What each event matches against (relevant ones):
- `PreToolUse` / `PostToolUse` etc. → `tool_name` (e.g. `"Bash"`, `"Edit|Write"`, `"mcp__.*"`).
- **`SessionStart` → `source`**: `"startup"`, `"resume"`, `"clear"`, `"compact"`.
- Several events ignore matchers silently (always fire): `UserPromptSubmit`, `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`.

### SessionStart — what we care about most

Verbatim from the WebFetched hooks doc:

> "SessionStart fires on ALL session starts/resumes. You cannot make it fire on only new sessions via matcher alone; use the `source` field in your hook logic to differentiate."

To fire only on new sessions, set `"matcher": "startup"` (matcher works on `source` for SessionStart) or check `$source` inside the script.

> "SessionStart hooks cannot block execution. Exit code 2 shows stderr to user but doesn't prevent session start."

So it's inherently non-blocking. We get this for free.

#### Input JSON (on stdin)

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../<id>.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6",
  "agent_type": "optional-agent-name"
}
```

#### Output protocol

| Exit | Behavior |
|------|----------|
| 0 | Stdout is added as context for Claude. If stdout is JSON it's parsed. |
| 2 | Non-blocking error. Stderr shown to user; stdout ignored. |
| Other | Non-blocking error. Stderr only shown with `--verbose`. |

Two ways to add context:

```bash
#!/bin/bash
echo "Current branch: main"
echo "Open issues: #42, #117"
exit 0
```

or structured:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth-refactor\nUncommitted changes: src/auth.ts"
  }
}
```

#### SessionStart example for our plugin

A common pattern from the docs is using SessionStart to install deps on first run / after updates:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "diff -q \"${CLAUDE_PLUGIN_ROOT}/package.json\" \"${CLAUDE_PLUGIN_DATA}/package.json\" >/dev/null 2>&1 || (cd \"${CLAUDE_PLUGIN_DATA}\" && cp \"${CLAUDE_PLUGIN_ROOT}/package.json\" . && npm install) || rm -f \"${CLAUDE_PLUGIN_DATA}/package.json\""
          }
        ]
      }
    ]
  }
}
```

For our use case, the SessionStart hook can print a one-liner tip to context, e.g. "Use `/claude-search:search <query>` to search past conversations" — but per best-practices it should be **idempotent**, **fast** (default timeout 600s but UserPromptSubmit-style stuck hooks are dangerous), and **safe**.

### Hook handler types

```json
{ "type": "command", "command": "path/to/script.sh", "args": ["--arg1", "value"] }
{ "type": "http", "url": "https://api.example.com/hook", "headers": {"Authorization": "Bearer $TOKEN"}, "allowedEnvVars": ["TOKEN"] }
{ "type": "mcp_tool", "server": "server_name", "tool": "tool_name", "input": {"param": "${tool_input.file_path}"} }
{ "type": "prompt", "prompt": "Is this command safe? $ARGUMENTS", "model": "claude-opus-4-1" }
{ "type": "agent", "prompt": "Verify the deployment target. $ARGUMENTS" }
```

### Exec form vs shell form (Windows matters here)

Docs recommend **exec form with `args`** for paths because no shell tokenization:

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js", "--fix"]
}
```

Shell form requires manual quoting:

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/scripts/format.js --fix"
}
```

### Plugin-hook env vars

Available to every hook process:
- `CLAUDE_PROJECT_DIR` — project root.
- `CLAUDE_PLUGIN_ROOT` — plugin install dir (plugin hooks only).
- `CLAUDE_PLUGIN_DATA` — persistent data dir (plugin hooks only).
- `CLAUDE_ENV_FILE` — only on `SessionStart`, `Setup`, `CwdChanged`, `FileChanged`. Append `export FOO=bar` lines and they persist to subsequent Bash calls.
- `CLAUDE_CODE_REMOTE` — `"true"` in remote web env.

### Default timeouts

- `command`, `http`, `mcp_tool`: 600s (10 min). UserPromptSubmit lowers to 30s because it blocks every prompt.
- `prompt`: 30s. `agent`: 60s.

Custom: `"timeout": 1800` (in seconds).

### Windows note (PowerShell)

For hook scripts on Windows, write in PowerShell and add `"shell": "powershell"` to the hook entry. (Skills doc and sub-agents doc both reference this.)

---

## 5. `${CLAUDE_PLUGIN_ROOT}` semantics

Verbatim from plugins-reference: "the absolute path to your plugin's installation directory. Use this to reference scripts, binaries, and config files bundled with the plugin."

Three related vars:
- `${CLAUDE_PLUGIN_ROOT}` — install dir. Changes on plugin update. Old version stays on disk ~7 days then cleaned up. **Treat as ephemeral, do not write state here.**
- `${CLAUDE_PLUGIN_DATA}` — `~/.claude/plugins/data/<id>/`. Persistent across updates. Created on first reference. Good for `node_modules`, venv, caches, generated code.
- `${CLAUDE_PROJECT_DIR}` — project root. Same value as hook env `CLAUDE_PROJECT_DIR`.

### Where it's available

> "All are substituted inline anywhere they appear in skill content, agent content, hook commands, monitor commands, and MCP or LSP server configs. All are also exported as environment variables to hook processes and MCP or LSP server subprocesses."

That covers everything we care about: commands (`SKILL.md` body), hooks (in command strings AND env), skills, MCP configs. Also reachable from invoked scripts because the hook process inherits it.

### Path-separator on Windows

The docs do not say verbatim what separator `${CLAUDE_PLUGIN_ROOT}` uses on Windows. From the docs' example syntax (`"${CLAUDE_PLUGIN_ROOT}"/scripts/format.sh`), they consistently use forward slashes — and Node, Python, and modern Windows tooling all accept forward slashes. **AMBIGUITY:** whether the substituted value itself contains `\` or `/` on Windows is not documented; test before relying on string-matching the path.

### Quoting rules

- Exec form (`type: command` with `args`): each `args` element is one argument, no shell tokenization. Paths with spaces need no quoting.
- Shell form (single `command` string): wrap in double quotes — `"${CLAUDE_PLUGIN_ROOT}"` — to handle spaces.

### Skill-local variant

`${CLAUDE_SKILL_DIR}` resolves to the directory containing this `SKILL.md`. For plugin skills, this is the per-skill subdir, NOT the plugin root. Use it when invoking a script bundled with one specific skill (which is what we want for our search UI launcher).

---

## 6. Two-command install flow

### From a user's POV (verbatim from the marketplaces walkthrough)

```shell
/plugin marketplace add ./my-marketplace
/plugin install quality-review-plugin@my-plugins
```

Or for a GitHub-hosted marketplace:

```shell
/plugin marketplace add owner/repo
/plugin install plugin-name@marketplace-name
```

`marketplace-name` is the `name` field inside `marketplace.json`, NOT the repo path.

### Forms accepted by `/plugin marketplace add`

- GitHub `owner/repo` shorthand (optionally `owner/repo@ref`)
- Git URL: `https://gitlab.com/team/plugins.git` (optionally `#ref`)
- Remote URL to a `marketplace.json`: `https://example.com/marketplace.json` (note: relative-path plugin sources WILL FAIL here)
- Local path: `./my-marketplace`

### Restart / live behavior

- Live testing during dev: `claude --plugin-dir ./my-plugin` works without install. **Once installed via marketplace, run `/reload-plugins`** to pick up changes "without restarting. This reloads plugins, skills, agents, hooks, plugin MCP servers, and plugin LSP servers."
- Monitors require a session restart even after `/reload-plugins`.
- After a mid-session plugin update, hooks/monitors/MCP/LSP keep the OLD `${CLAUDE_PLUGIN_ROOT}` until `/reload-plugins`.
- Skills: directly editing local skills is "live change detected" inside session for `.claude/skills/` and `~/.claude/skills/`. For plugin skills, plugins-reference points to `/reload-plugins`.

### Subagent caveat

From sub-agents doc: "Subagents are loaded at session start. If you add or edit a subagent file directly on disk, restart your session to load it." We don't ship an agent so this is informational.

### CLI variants (non-interactive)

```bash
claude plugin marketplace add acme-corp/claude-plugins
claude plugin install formatter@my-marketplace
claude plugin install formatter@my-marketplace --scope project   # team-shared
claude plugin install formatter@my-marketplace --scope local     # gitignored
```

Default scope is `user` (`~/.claude/settings.json`).

---

## 7. Skills detail (already covered above) — extras

### When does Claude auto-invoke?

- Default: skill description always loaded; full body loads only when invoked. Claude can decide to invoke based on description keywords.
- `disable-model-invocation: true` → user-only. Description is NOT loaded into context. Good for `/deploy`, `/commit`, anything with side effects.
- `user-invocable: false` → hidden from `/` menu, Claude-only.

For our `/search`: probably leave defaults so Claude can auto-trigger when the user says "find my notes on X" — but if we want to keep the listing budget clean we could set `disable-model-invocation: true` and force explicit invocation.

### Listing-budget gotcha

> "All skill names are always included, but if you have many skills, descriptions are shortened to fit the character budget, which can strip the keywords Claude needs to match your request. The budget scales at 1% of the model's context window."

If our description has the key trigger phrase late in the string, it might get truncated. Put the use case FIRST. The combined `description` + `when_to_use` cap is 1,536 chars.

### Skill-content lifecycle (worth knowing)

> "When you or Claude invoke a skill, the rendered SKILL.md content enters the conversation as a single message and stays there for the rest of the session. Claude Code does not re-read the skill file on later turns."

So `$ARGUMENTS` is substituted at invoke time, then the body is locked in for the rest of the session.

---

## 8. Agents (not needed for our plugin, but flagged)

We're not shipping an agent. If we did:
- Location: `agents/<name>.md`.
- Frontmatter (verbatim from plugins-reference): `name`, `description`, `model`, `effort`, `maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, `isolation` (only `"worktree"` is valid).
- **Plugin agents do NOT support `hooks`, `mcpServers`, or `permissionMode`** for security.

Example:

```markdown
---
name: agent-name
description: What this agent specializes in and when Claude should invoke it
model: sonnet
effort: medium
maxTurns: 20
disallowedTools: Write, Edit
---

Detailed system prompt...
```

---

## 9. Best practices relevant to this plugin

Distilled from the best-practices and skills docs (verbatim where quoted):

### Skill descriptions
- "Check the description includes keywords users would naturally say."
- Put the key use case first; description is capped at 1,536 chars combined with `when_to_use`.
- Be specific to avoid over-triggering; loose descriptions = annoying false positives.

### Hooks
- "Use hooks for actions that must happen every time with zero exceptions."
- "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."
- Make hook scripts idempotent and fast. SessionStart in particular runs on every session start (startup, resume, clear, compact).
- Always make scripts executable: `chmod +x ./scripts/your-script.sh`. On Windows, set `"shell": "powershell"` and write `.ps1` scripts.
- Use exec form (`command` + `args`) rather than shell form for paths with spaces.

### When to prefer commands vs skills vs subagents
From best-practices and sub-agents docs:
- **Skill / command**: reusable prompt / workflow that runs in the main conversation. Best for our `/search` (we want results in the main session).
- **Subagent**: isolated context for verbose work — running tests, searching codebases without polluting main context. Not needed here.
- **MCP server**: external tool integration over a protocol. Heavier; only worth it if we have many search-related tools to expose.

### Local web UI / launching processes
**Nothing in the docs specifically calls out best practices for local web UIs or background servers from a plugin.** Closest is the `monitors/` system (background commands with stdout going to Claude as notifications), but that's for status streams, not a UI server.

Reasonable approach for our plugin: have the `/search` command's body instruct Claude to run `node ${CLAUDE_SKILL_DIR}/scripts/launch-ui.js "$ARGUMENTS"` via Bash. Allow-list it with `allowed-tools: Bash(node *)` so it doesn't prompt every time. The script picks a free port, starts an Express server, opens the browser, and returns the URL on stdout for Claude to relay to the user.

### Token-cost awareness

`claude plugin details <name>` shows always-on vs on-invoke token cost per component. Keep skill descriptions tight to minimize always-on cost.

---

## 10. Directory layout for our plugin

```
claude-search/                          # plugin root (also the marketplace if we colocate)
├── .claude-plugin/
│   └── plugin.json                     # manifest
├── skills/
│   └── search/
│       ├── SKILL.md                    # the /claude-search:search command
│       └── scripts/
│           └── launch-ui.js            # local web UI launcher
├── hooks/
│   └── hooks.json                      # SessionStart hook
├── scripts/                            # any shared scripts (hook scripts go here)
│   └── session-start.sh
└── (optional) bin/                     # executables on PATH when plugin enabled
```

For marketplace colocation (so `/plugin marketplace add` points at the same repo):

```
<repo-root>/
├── .claude-plugin/
│   └── marketplace.json                # marketplace manifest
└── plugins/
    └── claude-search/                  # plugin folder as referenced by marketplace source
        ├── .claude-plugin/plugin.json
        ├── skills/search/SKILL.md
        ├── hooks/hooks.json
        └── scripts/...
```

`marketplace.json` plugin entry: `{"name": "claude-search", "source": "./plugins/claude-search"}`.

---

## 11. Ambiguities I had to flag

These are NOT settled by the docs and should be confirmed by experiment.

1. **Path separator inside `${CLAUDE_PLUGIN_ROOT}` on Windows.** Docs show forward slashes in examples but never state explicitly whether substitution uses `\` or `/`. Probably `\` (Windows absolute path) but tools generally accept both. Verify with `echo ${CLAUDE_PLUGIN_ROOT}` from a hook.
2. **Whether `--plugin-dir ./local` overrides an installed plugin of the same name only for that session.** Docs say yes, but explicitly note managed-settings force-enabled plugins can't be overridden. Our user scope plugin should be overridable.
3. **Whether SessionStart hook stdout context appears as a system message or user message.** Docs say "added as context for Claude" but don't specify the role/visibility. Test with a uniquely-tagged string.
4. **Live skill reload for plugin skills.** Local `.claude/skills/` has live change detection. Plugins are copied to `~/.claude/plugins/cache`, so editing the source repo probably does NOT live-update — `/reload-plugins` is needed. Confirm before iterating on SKILL.md in an installed plugin.
5. **Whether `${CLAUDE_SKILL_DIR}` is exported as an env var to scripts the skill invokes**, or only substituted in skill text. Docs imply only-substituted ("Use this in bash injection commands"). Safer to substitute it on the `bash` command line rather than expect `$CLAUDE_SKILL_DIR` inside the script env.
6. **Whether `/reload-plugins` picks up edits to `plugin.json` itself** (not just components). Reference says "reloads plugins, skills, agents, hooks, plugin MCP servers, and plugin LSP servers" — manifest changes are plausibly included but not explicit.
7. **Whether `commands/<name>.md` flat files support `${CLAUDE_SKILL_DIR}`.** Docs imply yes (commands ARE skills now) but the variable is named SKILL_DIR. For a flat command, the "skill dir" is presumably the plugin root or the commands dir; not stated.
8. **How `allowed-tools` interacts with the user-allowlist.** Docs say "grants permission for the listed tools while the skill is active … your permission settings still govern tools that are not listed." Whether `allowed-tools` in a plugin skill works without the user accepting a trust dialog is unclear; the docs only address the workspace-trust case for project-level skills.
9. **Marketplace `name` reuse across multiple installs.** If two marketplaces share a `name`, which wins? Docs say marketplace names are user-visible and unique per user, but don't specify conflict behavior.

---

## 12. Quick checklist for our plugin build

- [ ] `claude-search/.claude-plugin/plugin.json` with `name: "claude-search"`, no `version` (so commit SHA is used during dev).
- [ ] `claude-search/skills/search/SKILL.md` with `description`, `argument-hint: [query]`, `allowed-tools: Bash(node *)`, body that calls `node ${CLAUDE_SKILL_DIR}/scripts/launch-ui.js "$ARGUMENTS"`.
- [ ] `claude-search/skills/search/scripts/launch-ui.js` that starts a local web server, opens the browser, prints the URL.
- [ ] `claude-search/hooks/hooks.json` with a `SessionStart` entry (no `matcher` so it always fires, or `"matcher": "startup"` to skip resumes). Script is non-blocking, idempotent, fast.
- [ ] On Windows: hook scripts in PowerShell, `"shell": "powershell"` on each hook entry.
- [ ] Marketplace at `<repo>/.claude-plugin/marketplace.json` with `source: "./plugins/claude-search"` (or root colocation).
- [ ] Test with `claude --plugin-dir ./claude-search` first, then install via marketplace and `/reload-plugins`.
- [ ] User-facing install instructions: `/plugin marketplace add <repo-or-path>` then `/plugin install claude-search@<marketplace-name>`.
