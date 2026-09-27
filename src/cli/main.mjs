import fs from 'node:fs';
import { APP, EXIT, VERSION } from '../shared/config.mjs';
import { COMMAND_ALIASES, COMMANDS, UsageError, closest, parseArgs, parseWhen } from './args.mjs';
import { renderAttachment, renderDoctor, renderError, renderRead, renderRecent, renderSearch, renderShow, renderSync } from './render.mjs';

const HELP = `Agent Recall ${VERSION}: search and read past Claude Code, Codex, OpenCode and Cursor conversations.

Usage: recall.mjs <command> [options]

  search [options] -- <words>   Find conversations. Words can be topics, file names, commands, errors.
      --limit N                 Conversations to return (default 6, max 50)
      --provider NAME           claude, codex, opencode, cursor (repeat or comma-separate)
      --project NAME|PATH       Only conversations in this project (name or folder)
      --cwd PATH                Current project, ranked first (default: this folder)
      --since, --until WHEN     Date (2026-01-31) or age (36h, 7d, 2w, 3m)
      --archived MODE           include (default), exclude, only
      --include-current         Also return the conversation running this command
      --stdin                   Read the query from standard input (avoids shell quoting)
  read <handle> [options]       Read a conversation, a page at a time.
      --at N                    Start a few messages before message #N (from a search match)
      --from N                  Start at message #N (from a "more:" footer)
      --last N                  The last N messages
      --grep TEXT               Only messages containing TEXT, with neighbours
      --max-chars N             Page size in characters (default 24000)
      --outputs                 Include tool output excerpts
      --no-tools                Hide tool calls
      --all                     Everything in one page
      --out FILE|DIR            Write the whole conversation and its subagents to a Markdown file
  show <handle>                 Details: folder, branch, resume command, subagents, attachments.
  recent [options]              Latest conversations (same filters as search).
  sync [--full] [--provider P]  Update the index now (searches do this automatically).
  doctor                        Check setup, index and per-provider counts.
  attachment <id> [--out FILE]  Save an image or file attached to a message.
  install [--target DIR]        Install or update the skill for your agents.

Handles are the 7-character ids in results. Native ids, unique prefixes, provider:id and
codex://threads/<id> links also work. Add --json to any command for machine-readable output.`;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function progressReporter(enabled) {
  if (!enabled) return undefined;
  return ({ done, total, doneBytes, totalBytes }) => {
    const percent = totalBytes ? Math.floor((doneBytes / totalBytes) * 100) : Math.floor((done / Math.max(total, 1)) * 100);
    process.stderr.write(`indexing conversations: ${percent}% (${done}/${total} files)\n`);
  };
}

function filterOptions(flags) {
  return {
    limit: flags.limit,
    providers: flags.provider,
    project: flags.project,
    since: parseWhen('since', flags.since),
    until: parseWhen('until', flags.until),
    archived: flags.archived,
    includeCurrent: flags['include-current'],
    sync: flags['no-sync'] ? 'never' : 'auto',
  };
}

async function run(command, flags, positional, json) {
  const recall = await import('../recall.mjs');
  const onProgress = progressReporter(!json && !flags.quiet);
  const one = what => {
    if (positional.length !== 1) throw new UsageError(`${command} takes one ${what}. Example: ${command} ${what === 'handle' ? 'abc1234' : what}`);
    return positional[0];
  };
  switch (command) {
    case 'search': {
      const text = flags.stdin ? readStdin() : positional.join(' ');
      if (!text.trim()) throw new UsageError('search needs words. Example: search -- stripe webhook retries');
      const result = await recall.search(text, { ...filterOptions(flags), cwd: flags.cwd ?? process.cwd(), onProgress });
      result.completeness = { complete: result.index.pending === 0 && result.warnings.length === 0, pending: result.index.pending };
      return [result, renderSearch];
    }
    case 'read':
      return [await recall.read(one('handle'), {
        at: flags.at, from: flags.from, last: flags.last, grep: flags.grep, maxChars: flags['max-chars'], context: flags.context,
        outputs: flags.outputs, tools: !flags['no-tools'], all: flags.all, out: flags.out, sync: flags['no-sync'] ? 'never' : 'auto', onProgress,
      }), renderRead];
    case 'show':
      return [await recall.show(one('handle'), { sync: flags['no-sync'] ? 'never' : 'auto', onProgress }), renderShow];
    case 'recent':
      return [await recall.recent({ ...filterOptions(flags), onProgress }), renderRecent];
    case 'sync':
      return [await recall.sync({ full: flags.full, providers: flags.provider, onProgress }), renderSync];
    case 'doctor':
      return [await recall.doctor(), renderDoctor];
    case 'attachment':
      return [await recall.attachment(one('attachment id'), { out: flags.out, sync: flags['no-sync'] ? 'never' : 'auto' }), renderAttachment];
    case 'install': {
      const { install, renderInstall } = await import('../install/install.mjs');
      return [await install({ targets: flags.target, dryRun: flags['dry-run'], uninstall: flags.uninstall }), renderInstall];
    }
    default:
      throw new UsageError(`Unknown command ${command}.`);
  }
}

function emit(json, value, render) {
  process.stdout.write(`${json ? JSON.stringify({ schemaVersion: APP.JSON_SCHEMA, ...value }) : render(value)}\n`);
}

export async function main(argv) {
  const [rawCommand = 'help', ...rest] = argv;
  const json = rest.includes('--json');
  if (['help', '--help', '-h'].includes(rawCommand)) return void process.stdout.write(`${HELP}\n`);
  if (['--version', '-v', 'version'].includes(rawCommand)) return void process.stdout.write(`${VERSION}\n`);
  const command = COMMAND_ALIASES[rawCommand] ?? rawCommand;
  try {
    if (!COMMANDS[command]) {
      const guess = closest(command, Object.keys(COMMANDS));
      throw new UsageError(`Unknown command "${rawCommand}".${guess ? ` Did you mean ${guess}?` : ''} Run: help`);
    }
    const { flags, positional } = parseArgs(command, rest);
    if (flags.help) return void process.stdout.write(`${HELP}\n`);
    const [result, render] = await run(command, flags, positional, json);
    if (!flags.quiet) emit(json, result, render);
    if (command === 'sync' && result.errors?.length) process.exitCode = EXIT.ERROR;
  } catch (error) {
    const usage = error instanceof UsageError;
    const code = usage || error.code === 'usage' || error.code === 'ambiguous' ? EXIT.USAGE : error.code === 'not_found' || error.code === 'empty' ? EXIT.NOT_FOUND : EXIT.ERROR;
    const payload = { code: usage ? 'usage' : error.code ?? 'error', message: error.message, hint: error.hint ?? null, candidates: error.candidates ?? undefined };
    if (json) process.stdout.write(`${JSON.stringify({ schemaVersion: APP.JSON_SCHEMA, error: payload })}\n`);
    else process.stderr.write(`${renderError(error)}\n`);
    if (!usage && !error.code) process.stderr.write(`${error.stack}\n`);
    process.exitCode = code;
  }
}
