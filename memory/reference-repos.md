# Reference Repos

Notes captured from `JCodesMore/jcodesmore-plugins` (marketplace) and `JCodesMore/youtube-for-ai-agents` (sibling plugin we are mirroring). Both read via `gh api` on 2026-05-15. Use this file when authoring `marketplace.json`, `.claude-plugin/plugin.json`, and `README.md` for `claude-search`.

## jcodesmore-plugins marketplace structure

### Repo top-level layout (entire tree, recursive)

```
.claude-plugin/
.claude-plugin/marketplace.json
README.md
```

That is the **whole** repo. No `package.json`, no CI workflows, no `.github/`, no per-plugin directories. Each plugin lives in its own separate GitHub repo and is referenced from `marketplace.json` via a `source.url` pointing at the plugin repo's `.git` URL. Adding a new plugin = adding one entry to `marketplace.json` + one row to `README.md`.

### `.claude-plugin/marketplace.json` — verbatim shape

Lives at `.claude-plugin/marketplace.json` in repo root. Required top-level keys: `name`, `owner`, `plugins`. `metadata` is present and used. Every plugin entry uses the same five fields: `name`, `source`, `description`, `version`, `strict`. No optional fields beyond those are exercised. Versions follow semver (`0.1.0`, `0.2.0`, `0.2.1`, `0.3.0`, `1.6.0` at marketplace level). Marketplace `metadata.version` is bumped when plugin set changes.

Full current contents:

```json
{
  "name": "jcodesmore-plugins",
  "owner": {
    "name": "JCodesMore",
    "url": "https://github.com/JCodesMore"
  },
  "metadata": {
    "description": "Claude Code plugins by JCodesMore",
    "version": "1.6.0"
  },
  "plugins": [
    {
      "name": "youtube",
      "source": {
        "source": "url",
        "url": "https://github.com/JCodesMore/youtube-for-ai-agents.git"
      },
      "description": "YouTube tools — search, transcripts, video info, channel browsing, playlists",
      "version": "0.2.0",
      "strict": true
    },
    {
      "name": "jobs-for-ai-agents",
      "source": {
        "source": "url",
        "url": "https://github.com/JCodesMore/jobs-for-ai-agents.git"
      },
      "description": "Your AI job-search wingman — find roles, polish your resume, research companies, and tailor applications, all from Claude Code.",
      "version": "0.2.0",
      "strict": true
    }
    // ... 5 more entries identical in shape (fix-claude-code, movies-for-ai-agents,
    // service-business-website-builder, discord, slack)
  ]
}
```

Conventions that matter:
- `name` is the install slug (`youtube`, `discord`, `slack`) or full repo name (`jobs-for-ai-agents`, `movies-for-ai-agents`, `fix-claude-code`, `service-business-website-builder`). Short brand names dominate when the brand is unambiguous (youtube, discord, slack); descriptive names use the `-for-ai-agents` suffix. For `claude-search`, the repo name suggests a short slug like `search` if no conflict, else `claude-search`.
- `source.source` is the literal string `"url"`; `source.url` ends in `.git`.
- `description` uses em-dashes (`—`, U+2014) for clause separation. Sentence case. No emoji. Ends without period in shorter descriptions, with period in longer ones — both forms appear.
- `version` is the plugin's own semver, independent of marketplace `metadata.version`.
- `strict: true` is set on every plugin.

### `README.md` of the marketplace repo — verbatim

```markdown
# JCodesMore Plugins

Claude Code plugin marketplace by [JCodesMore](https://github.com/JCodesMore).

## Install

` ` `bash
/plugin marketplace add JCodesMore/jcodesmore-plugins
` ` `

Then install any plugin:

` ` `bash
/plugin install jobs-for-ai-agents@jcodesmore-plugins
` ` `

## Available Plugins

| Plugin | Description | Repo |
|--------|-------------|------|
| `movies-for-ai-agents` | Movie discovery... | [movies-for-ai-agents](https://github.com/JCodesMore/movies-for-ai-agents) |
| `jobs-for-ai-agents` | Your AI job-search wingman... | [jobs-for-ai-agents](https://github.com/JCodesMore/jobs-for-ai-agents) |
... (one row per plugin)
```

The `/plugin marketplace add` URL form is `<github-user>/<repo>` (no `https://`, no `.git`). Install form is `<plugin-name>@<marketplace-name>`.

### How a new plugin is added to the marketplace

1. Append a new object to the `plugins` array in `.claude-plugin/marketplace.json` with `name`, `source` (`{"source":"url","url":"https://github.com/JCodesMore/<repo>.git"}`), `description`, `version`, `strict: true`.
2. Bump marketplace `metadata.version` (minor for added plugin, patch for in-place version bump of an existing plugin — inferred from current `1.6.0` across ~7 plugins).
3. Add one row to the `## Available Plugins` table in `README.md`.
4. Commit + push to the marketplace repo's `main` branch. No CI; no validation step.

### Example plugin layout: `youtube-for-ai-agents`

Top-level (file/dir):

```
.claude-plugin/
.claude-plugin/plugin.json
.cursor-plugin/                  (Cursor-specific manifest dir)
.github/
.github/ISSUE_TEMPLATE/
.github/PULL_REQUEST_TEMPLATE.md
.gitignore
.mcp.json                        (MCP server registration at repo root)
.opencode/                       (OpenCode-specific manifest dir)
CHANGELOG.md
CLA.md
CLAUDE.md
CONTRIBUTING.md
GEMINI.md
LICENSE                          (Apache-2.0)
NOTICE
README.md
agents/
agents/video-watcher.md          (single agent, markdown w/ YAML frontmatter)
dist/                            (TS build output; gitignored content but dir tracked)
docs/                            (per-host setup guides: README.cursor.md, etc.)
gemini-extension.json
package.json
package-lock.json
scripts/
scripts/config.mjs
scripts/ensure-deps.mjs
scripts/extract-cookies.mjs
scripts/start-mcp.mjs
skills/
skills/setup/SKILL.md
skills/youtube/SKILL.md
skills/youtube/references/       (supporting docs the skill references)
src/                             (TypeScript MCP server source)
tsconfig.json
```

No `commands/` directory and no `hooks/` directory in this plugin — both confirmed 404 via `gh api`. Hooks are declared inline in `plugin.json` instead. (Sibling plugin `jobs-for-ai-agents` also has no `commands/`; it adds an `mcp/` dir and `references/` dir but otherwise mirrors the same shape. `fix-claude-code` is much thinner: only `.claude-plugin/`, `docs/`, `skills/`, `README.md`, `LICENSE`, `.gitignore`.)

### `.claude-plugin/plugin.json` — verbatim (youtube)

```json
{
  "name": "youtube",
  "description": "YouTube tools — search, transcripts, video info, channel browsing, playlists",
  "version": "0.2.0",
  "author": {
    "name": "JCodesMore",
    "url": "https://github.com/JCodesMore"
  },
  "homepage": "https://github.com/JCodesMore/youtube-for-ai-agents",
  "repository": "https://github.com/JCodesMore/youtube-for-ai-agents",
  "license": "Apache-2.0",
  "keywords": [
    "youtube",
    "mcp",
    "transcripts",
    "research",
    "search",
    "claude-code"
  ],
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/ensure-deps.mjs\""
          }
        ]
      }
    ]
  }
}
```

Required-in-practice fields: `name`, `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`. `hooks` is optional but useful for SessionStart dep-ensure pattern. Note the `${CLAUDE_PLUGIN_ROOT}` variable inside a quoted string — that's the Claude Code idiom for referencing plugin files.

### `.mcp.json` — verbatim (root, not inside `.claude-plugin/`)

```json
{
  "mcpServers": {
    "youtube": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.mjs"],
      "env": {
        "CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}"
      }
    }
  }
}
```

The MCP server is spawned via a tiny `.mjs` launcher that loads the compiled `dist/index.js`. Both `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` are environment variables Claude Code substitutes; `CLAUDE_PLUGIN_DATA` is the persistent data dir (cookies, config) that survives across projects.

### `package.json` highlights (youtube)

```json
{
  "name": "@jcodesmore/youtube-for-ai-agents",
  "version": "0.2.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "youtube-mcp": "./dist/index.js" },
  "files": ["dist", "skills", "agents", "scripts", "docs/README.*.md",
            ".claude-plugin", ".cursor-plugin", ".opencode",
            "gemini-extension.json", "GEMINI.md", "CHANGELOG.md",
            "LICENSE", "README.md"],
  "license": "Apache-2.0",
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "prepublishOnly": "npm run build"
  }
}
```

Conventions:
- `package.json` lives at **plugin repo root**, not at marketplace root (marketplace has no `package.json` at all).
- `type: "module"` — ESM everywhere.
- Scripts directory uses `.mjs` extension (e.g. `start-mcp.mjs`, `ensure-deps.mjs`, `config.mjs`, `extract-cookies.mjs`). No `.js` plain files in `scripts/`.
- Node `>=18.0.0`.
- No ESLint or Prettier config files visible at repo root — minimal toolchain.
- `tsconfig.json` present; TypeScript source in `src/`, built to `dist/`.
- npm package is scoped (`@jcodesmore/<repo-name>`), enabling parallel `npx -y` install from the README's "advanced install" section.

### Component conventions (skills, agents)

Skills live at `skills/<skill-name>/SKILL.md` with YAML frontmatter:

```markdown
---
name: youtube:setup
description: Configure YouTube plugin — search mode (anonymous/personalized) and plugin settings (defaults, language, locale)
---

# YouTube Plugin Setup
...
```

Name uses `<plugin>:<skill>` namespacing. Skill body is conversational walkthrough prose.

Agents live at `agents/<agent-name>.md` with frontmatter:

```markdown
---
name: video-watcher
description: Watches a YouTube video and reports back with analysis...
model: sonnet
---

You are a video analyst. ...
```

Agent `name` is unprefixed (just `video-watcher`). `model` field appears; `sonnet` is the value used.

## youtube-for-ai-agents README skeleton

### Section ordering (top-to-bottom)

1. **Hero block** (centered, inside `<div align="center">`)
   - `# Title` (e.g. `# YouTube for AI Agents`)
   - `### Tagline` — one line, italics in sub-claim (`### Claude watches YouTube so you don't have to`)
   - **Intro paragraph** — 3-4 sentences, conversational, leads with an example question in italics (`Ask *"what's the best video on…?"* and Claude finds it...`). Pitches three concrete capabilities.
   - **Discord badge** — `shields.io` `for-the-badge` style, `5865F2` Discord blue, links to invite.
   - **Inline nav row** — `[Quick Start](#quick-start) · [Try it](#try-it) · [Discord](...) · [Demo](#demo)` separated by middle dots ` · `.
2. `---` horizontal rule
3. `## Demo` — clickable YouTube thumbnail (`maxresdefault.jpg`) linking to `youtu.be/<id>`, with a `> Click the image to watch the 1-minute walkthrough.` blockquote underneath.
4. `## Quick Start` — numbered steps. Step 1 says "Install the plugin" with a fenced code block of the two install commands, then "fully **restart Claude Code**" in bold. Step 2 says "That's it." with the no-API-key boast. Optional `/setup` mention as a blockquote tip.
5. `## Try it` — bulleted list of italic example prompts the user could literally paste. 6 examples, each starting with `*"`. Closes with a one-line sell about the agent's behavior.
6. `## What's inside` — opening sentence count of tools/skills/agents, then a 2-column table (`Capability | Try saying`) with 7 rows. The "try saying" column is always italicized.
7. `## Community` — a single line of pipe-separated links with bold link text: `[**Discord**](...) — chat... · [**Issues**](...) — bugs... · [**Contribute**](...) · [**More plugins**](...)`.
8. **Collapsible details blocks** (`<details><summary><b>...</b></summary>`) — four of them, in order:
   - `Personalized results (optional)` — opt-in feature explanation
   - `Use it in Cursor, Codex, OpenCode, or Gemini CLI` — links to per-host docs
   - `Advanced install (without the marketplace)` — `git clone` + `npm install` + `npm run build`; also shows raw `mcpServers` JSON snippet for any MCP-compatible client; ends with `**Requirements:** Node.js ≥ 18.`
   - `Built on` — bulleted list of upstream dependencies with links
9. `## License` — `[Apache License 2.0](LICENSE) — © 2026 JCodesMore` plus a one-line blockquote disclaimer about third-party services / non-affiliation.
10. `---` horizontal rule
11. **Footer line** — `*Part of [jcodesmore-plugins](https://github.com/JCodesMore/jcodesmore-plugins).*`

Total length is ~115 lines, ~4.7 KB.

### Tone notes

- Voice is conversational, second-person, friendly-confident. "Talk to Claude like a friend", "no scrubbing, no scrolling", "no API key, no signup. Just start asking."
- Em-dashes (`—`, U+2014) everywhere — clause breaks, taglines, table sentences, footer.
- Italics used for example prompts (always wrapped in `*"..."*`) and for inline asides (`*Optional:*`, `*Part of ...*`).
- Bold used sparingly: numbered-step verbs (`**1. Install the plugin**`), key concept words inside a paragraph (`**Anonymous**`, `**Personalized**`), and the `<summary>` text inside `<details>` blocks via `<b>`.
- **No emoji anywhere in the README** (confirmed by inspection). The only icon-like elements are the shields.io Discord badge SVG.
- Marketing claims are concrete (`Nine smart tools`, `1-minute walkthrough`, `Node.js ≥ 18`) rather than vague.
- No "AI-flavored" filler ("delve", "leverage", "robust", "comprehensive solution"); writing reads human.
- Tables use sentence-case headers (`Capability | Try saying`), not Title Case.

### Install snippet — verbatim

````markdown
**1. Install the plugin** — inside Claude Code, run:

```
/plugin marketplace add JCodesMore/jcodesmore-plugins
/plugin install youtube@jcodesmore-plugins
```

Then fully **restart Claude Code** (quit the app and reopen).
````

Notes:
- The code fence is **unlabeled** (no `bash`, no `sh`). Both lines sit in the same fenced block.
- `/plugin marketplace add` takes `<user>/<repo>` (no protocol, no `.git`).
- `/plugin install` takes `<plugin-name>@<marketplace-name>`. The `<plugin-name>` matches the `name` field in `marketplace.json`, not necessarily the repo name (e.g. `youtube`, not `youtube-for-ai-agents`).
- The "fully restart Claude Code" instruction is part of the standard install flow.

### Quick-reference badge URL

```
[![Discord](https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/babcVNJBet)
```

Only badge used. No CI badge, no npm badge, no license badge. Replace Discord link if `claude-search` doesn't ship with one; otherwise keep the same shields.io URL pattern.

### Repo root layout for structure comparison

See `youtube-for-ai-agents` tree above (under "Example plugin layout"). For `claude-search`, the minimum-viable mirror is:

```
.claude-plugin/plugin.json
.mcp.json                  (if shipping an MCP server)
README.md
LICENSE                    (Apache-2.0 to match)
.gitignore
package.json               (if Node-based; type: module)
tsconfig.json              (if TypeScript)
src/                       (TS source)
dist/                      (build output)
scripts/*.mjs              (.mjs only, never .js)
skills/<name>/SKILL.md     (one dir per skill, frontmatter required)
agents/<name>.md           (flat files, frontmatter required)
```

Anything beyond that (`.cursor-plugin/`, `.opencode/`, `gemini-extension.json`, `GEMINI.md`, `CHANGELOG.md`, `CLA.md`, `CONTRIBUTING.md`, `NOTICE`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/README.<host>.md`) is optional polish for multi-host distribution — add only if `claude-search` targets Cursor/Codex/OpenCode/Gemini in addition to Claude Code.
