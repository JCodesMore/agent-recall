#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP, EXIT_CODES, LIMITS, PROVIDERS } from '../src/config.mjs';
import { databasePath, displayPath } from '../src/paths.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type !== 'ExperimentalWarning') emitWarning(warning, ...args);
};

const USAGE = `Agent Recall ${APP.CLI_SCHEMA_VERSION}

Usage:
  agent-recall search [options] -- <query>
  agent-recall context [options] <hit-id>
  agent-recall session [options] <session-key>
  agent-recall transcript [options] <session-key>
  agent-recall attachments [options] <message-key>
  agent-recall attachment [options] <attachment-key>
  agent-recall recent [options]
  agent-recall status [--json]
  agent-recall sync [--provider NAME] [--force] [--json]
  agent-recall doctor [--json]

Common options:
  --json                 Emit stable machine-readable JSON
  --provider NAME        claude, codex, or opencode
  --cwd PATH             Scope to this project and child directories
  --limit N              Bound result or transcript count
  --no-sync              Skip incremental refresh

Search options:
  --since DATE           Earliest message timestamp
  --until DATE           Latest message timestamp

Context options:
  --before N             Messages before the hit (default ${LIMITS.CONTEXT_BEFORE_DEFAULT})
  --after N              Messages after the hit (default ${LIMITS.CONTEXT_AFTER_DEFAULT})

Transcript options:
  --offset N             Message offset for pagination

Attachment options:
  --output PATH          Write the original attachment bytes to PATH

Session options:
  --source               Include the protected source path`;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { positional: [], json: false, sync: true };
  let positionalOnly = false;
  const valueFlags = new Set(['--provider', '--cwd', '--limit', '--since', '--until', '--before', '--after', '--offset', '--output']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (positionalOnly) {
      options.positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === '--json') options.json = true;
    else if (arg === '--no-sync') options.sync = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--source') options.includeSource = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

function validateDate(value, flag) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new UsageError(`${flag} must be a valid date or timestamp`);
  return date.toISOString();
}

function commandOptions(options) {
  return {
    provider: options.provider,
    cwd: options.cwd,
    limit: options.limit,
    since: validateDate(options.since, '--since'),
    until: validateDate(options.until, '--until'),
    before: options.before,
    after: options.after,
    offset: options.offset,
    includeSource: options.includeSource,
    output: options.output,
  };
}

function textSession(session) {
  const when = session.updatedAt || session.createdAt || 'unknown time';
  return `[${session.provider}] ${session.title || session.project || session.nativeId} (${when})\n` +
    `  session: ${session.sessionKey}\n` +
    `  project: ${session.cwd || session.project || 'unknown'}\n` +
    `  activity: ${session.activity.state} (${session.activity.confidence})`;
}

function terminalSafe(value) {
  return String(value ?? '')
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)?)/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

function textAttachments(attachments = []) {
  if (!attachments.length) return '';
  return attachments.map(attachment => (
    `  attachment: ${attachment.attachmentKey} | ${attachment.name || attachment.kind} | ${attachment.mime} | ${attachment.byteLength} bytes`
  )).join('\n');
}

function samePath(left, right) {
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

async function resolvedExistingPath(value) {
  try {
    return await fs.realpath(value);
  } catch (error) {
    if (error.code === 'ENOENT') return path.resolve(value);
    throw error;
  }
}

async function writeAttachmentOutput(requestedPath, data, protectedPaths) {
  const requested = path.resolve(requestedPath);
  await fs.mkdir(path.dirname(requested), { recursive: true, mode: 0o700 });
  const parent = await fs.realpath(path.dirname(requested));
  const output = path.join(parent, path.basename(requested));
  for (const protectedPath of protectedPaths) {
    if (protectedPath && samePath(output, await resolvedExistingPath(protectedPath))) {
      throw new UsageError('Refusing to overwrite an Agent Recall database or authoritative provider source.');
    }
  }

  const temporary = path.join(parent, `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(temporary, output);
    return output;
  } catch (error) {
    if (error.code === 'EEXIST') throw new UsageError(`Output already exists: ${displayPath(output)}`);
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function protectedAttachmentPaths(sourcePath) {
  const recallDatabase = databasePath();
  const paths = [sourcePath, recallDatabase, `${recallDatabase}-wal`, `${recallDatabase}-shm`];
  if (path.extname(sourcePath).toLowerCase() === '.db') {
    paths.push(`${sourcePath}-wal`, `${sourcePath}-shm`);
  }
  return paths;
}

function formatText(command, result) {
  if (command === 'search') {
    if (!result.hits.length) return `No conversation matches for "${result.query}".`;
    return result.hits.map((hit, index) => (
      `${index + 1}. ${textSession(hit.session)}\n` +
      `  hit: ${hit.hitId} | ${hit.role} | ${hit.occurredAt || 'unknown time'}\n` +
      `  ${terminalSafe(hit.snippet).replaceAll('\n', '\n  ')}` +
      `${hit.attachments?.length ? `\n${textAttachments(hit.attachments)}` : ''}`
    )).join('\n\n');
  }
  if (command === 'recent') return result.sessions.map(textSession).join('\n\n') || 'No indexed sessions.';
  if (command === 'context' || command === 'transcript') {
    return `${textSession(result.session)}\n\n${result.messages.map(message => (
      `[${message.sequence}] ${message.role} ${message.timestamp || ''}${message.matched ? '  <match>' : ''}\n${terminalSafe(message.text)}` +
      `${message.attachments?.length ? `\n${textAttachments(message.attachments)}` : ''}`
    )).join('\n\n')}`;
  }
  if (command === 'session') return `${textSession(result)}\n  messages: ${result.messageCount}\n  attachments: ${result.attachmentCount}\n  resume: ${JSON.stringify(result.resume)}`;
  if (command === 'attachments') return textAttachments(result.attachments) || 'No attachments for this message.';
  return JSON.stringify(result, null, 2);
}

async function runDoctor() {
  const checks = [];
  const version = process.versions.node.split('.').map(Number);
  const nodeOkay = version[0] > APP.MIN_NODE.major || (
    version[0] === APP.MIN_NODE.major && version[1] >= APP.MIN_NODE.minor
  );
  checks.push({ name: 'node', ok: nodeOkay, detail: process.versions.node });

  try {
    const [{ openDatabase }, { adaptersFor }] = await Promise.all([
      import('../src/storage/database.mjs'),
      import('../src/sources/registry.mjs'),
    ]);
    const db = await openDatabase();
    try {
      db.prepare("SELECT count(*) AS count FROM messages_fts WHERE messages_fts MATCH 'doctor'").get();
      checks.push({ name: 'sqlite-fts5', ok: true });
    } finally {
      db.close();
    }
    for (const adapter of adaptersFor()) {
      try {
        const sources = await adapter.discover();
      checks.push({ name: `source-${adapter.provider}`, ok: true, sources: sources.length });
      } catch (error) {
        checks.push({ name: `source-${adapter.provider}`, ok: false, detail: 'Source discovery failed.' });
      }
    }
  } catch (error) {
    checks.push({ name: 'runtime', ok: false, detail: 'Runtime initialization failed.' });
  }
  return {
    schemaVersion: APP.CLI_SCHEMA_VERSION,
    healthy: checks.every(check => check.ok),
    dataHome: displayPath((await import('../src/paths.mjs')).dataHome()),
    checks,
  };
}

async function main() {
  const [command = 'help', ...argv] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const options = parseArgs(argv);
  if (command === 'help' || options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (options.provider && !Object.values(PROVIDERS).includes(options.provider)) {
    throw new UsageError(`Unsupported provider: ${options.provider}`);
  }
  if (command === 'search' && !options.positional.join(' ').trim()) {
    throw new UsageError('search requires a query; place -- before queries that begin with a dash');
  }
  const resolvedOptions = commandOptions(options);

  const service = await import('../src/service.mjs');
  const { syncHistory } = await import('../src/sync.mjs');
  let refresh;
  if (options.sync && ['search', 'recent'].includes(command)) {
    refresh = await syncHistory({ providers: options.provider ? [options.provider] : undefined });
  }

  let result;
  if (command === 'search') {
    const query = options.positional.join(' ').trim();
    result = await service.searchHistory(query, resolvedOptions);
  } else if (command === 'context') {
    if (options.positional.length !== 1) throw new UsageError('context requires one hit ID');
    result = await service.getContext(options.positional[0], resolvedOptions);
  } else if (command === 'session') {
    if (options.positional.length !== 1) throw new UsageError('session requires one session key');
    result = await service.getSession(options.positional[0], resolvedOptions);
  } else if (command === 'transcript') {
    if (options.positional.length !== 1) throw new UsageError('transcript requires one session key');
    result = await service.getTranscript(options.positional[0], resolvedOptions);
  } else if (command === 'attachments') {
    if (options.positional.length !== 1) throw new UsageError('attachments requires one message key');
    result = await service.listAttachments(options.positional[0], resolvedOptions);
  } else if (command === 'attachment') {
    if (options.positional.length !== 1) throw new UsageError('attachment requires one attachment key');
    if (!options.output) throw new UsageError('attachment requires --output PATH');
    const extracted = await service.getAttachmentData(options.positional[0], resolvedOptions);
    if (extracted) {
      const output = await writeAttachmentOutput(
        options.output,
        extracted.data,
        protectedAttachmentPaths(extracted.sourcePath),
      );
      const { data, sourcePath, ...metadata } = extracted;
      result = { ...metadata, output };
    } else {
      result = null;
    }
  } else if (command === 'recent') {
    result = await service.recentSessions(resolvedOptions);
  } else if (command === 'status') {
    result = await service.recallStatus(resolvedOptions);
  } else if (command === 'sync') {
    result = await syncHistory({ providers: options.provider ? [options.provider] : undefined, force: options.force });
  } else if (command === 'doctor') {
    result = await runDoctor();
  } else {
    throw new UsageError(`Unknown command: ${command}`);
  }

  if (refresh?.errors.length && result && typeof result === 'object') {
    result.warnings = refresh.errors.map(error => ({ kind: 'source-refresh-failed', ...error }));
  }

  if (result === null) {
    const error = {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      error: {
        kind: 'not-found',
        message: 'Not found. Run agent-recall sync and verify the ID.',
      },
    };
    process.stderr.write(`${options.json ? JSON.stringify(error) : error.error.message}\n`);
    process.exitCode = EXIT_CODES.NOT_FOUND;
    return;
  }
  process.stdout.write(`${options.json ? JSON.stringify(result) : terminalSafe(formatText(command, result))}\n`);
}

main().catch(error => {
  const json = process.argv.includes('--json');
  const usage = error instanceof UsageError;
  const stale = error?.code === 'STALE_ATTACHMENT';
  const message = usage || stale
    ? error.message
    : 'Agent Recall failed. Run agent-recall doctor for local diagnostics.';
  const output = {
    schemaVersion: APP.CLI_SCHEMA_VERSION,
    error: { kind: usage ? 'usage-error' : stale ? 'stale-attachment' : 'runtime-error', message },
  };
  const text = `error: ${usage || stale ? error.message : `${message}\n${error.stack || ''}`}`;
  process.stderr.write(`${json ? JSON.stringify(output) : terminalSafe(text)}\n`);
  process.exitCode = usage ? EXIT_CODES.USAGE : stale ? EXIT_CODES.STALE : EXIT_CODES.INTERNAL;
});
