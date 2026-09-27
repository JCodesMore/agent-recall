# Searching other computers

Each computer keeps its own index of its own conversations. With peers set up, `search` and
`recent` also ask the other computers over SSH and merge their answers; `read` and `show` with
`--peer NAME` open a conversation where it lives. Nothing is copied between computers.

## Requirements

- Agent Recall installed on every computer (the same version is best).
- From this computer, `ssh <alias>` logs in to each other computer without a password
  prompt (an SSH key), and Node.js 22.16+ runs there.

Check a computer by hand first: `ssh <alias> node --version`.

## peers.json

Create `peers.json` in Agent Recall's data folder on each computer (`doctor` prints the
index path; the file sits next to it):

- Windows: `%LOCALAPPDATA%\agent-recall\peers.json`
- macOS: `~/Library/Application Support/agent-recall/peers.json`
- Linux: `~/.local/share/agent-recall/peers.json`

```json
{
  "peers": [
    { "name": "desktop", "ssh": "desktop", "recall": "C:/Users/me/.agents/skills/agent-recall/scripts/recall.mjs", "hostnames": ["DESKTOP-1"] },
    { "name": "laptop", "ssh": "laptop", "node": "/usr/local/bin/node", "recall": "/Users/me/.agents/skills/agent-recall/scripts/recall.mjs" }
  ]
}
```

- `name`: what you type after `--peers` and `--peer`, and what results show as `@name`.
- `ssh`: the SSH host or alias (defaults to `name`).
- `recall`: the absolute path of `scripts/recall.mjs` on that computer.
- `node`: the Node.js command there (default `node`; macOS over SSH often needs the full path,
  because SSH sessions do not load your shell profile).
- `hostnames`: optional names this computer answers to. The same file can then list every
  computer and be copied to all of them; each skips its own entry.
- `shell`: only when a path contains spaces: `posix` or `powershell`, the shell SSH starts on
  that computer.

## Check it

```bash
node scripts/recall.mjs doctor --peers all
```

Each computer reports its version and conversation count, or why it could not be reached.

## How it stays safe

Only the fixed words from `peers.json` (the Node command, the script path and
`peer-request`) are placed on the remote command line. The query and every other argument
travel as JSON on SSH's standard input, and the remote side answers only `search`, `read`,
`show`, `recent` and `doctor`: it refuses `--out` (no files are written) and never forwards to
further computers. Each computer returns up to `--limit` results, ranked with the others by
score; the current project boost applies wherever the same folder exists.
