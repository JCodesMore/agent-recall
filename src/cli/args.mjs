import { PROVIDERS } from '../shared/config.mjs';

export class UsageError extends Error {}

const COMMON = { json: 'bool', 'no-sync': 'bool', help: 'bool' };
const FILTERS = { provider: 'list', project: 'value', since: 'value', until: 'value', archived: 'value', limit: 'int' };

// Flags each command accepts: bool, value, int or list (repeatable or comma separated).
export const COMMANDS = {
  search: { ...COMMON, ...FILTERS, cwd: 'value', stdin: 'bool', 'include-current': 'bool', peers: 'list' },
  read: { ...COMMON, at: 'int', from: 'int', last: 'int', grep: 'value', 'max-chars': 'int', outputs: 'bool', 'no-tools': 'bool', all: 'bool', out: 'value', context: 'int', peer: 'value' },
  show: { ...COMMON, peer: 'value' },
  recent: { ...COMMON, ...FILTERS, 'include-current': 'bool', peers: 'list' },
  sync: { ...COMMON, provider: 'list', full: 'bool', quiet: 'bool' },
  doctor: { ...COMMON, peers: 'list' },
  attachment: { ...COMMON, out: 'value' },
  install: { ...COMMON, target: 'list', 'dry-run': 'bool', uninstall: 'bool', 'agents-only': 'bool' },
  help: { ...COMMON },
};

// Names agents used with v0 keep working.
export const COMMAND_ALIASES = { transcript: 'read', context: 'read', session: 'show', status: 'doctor', find: 'search' };
const FLAG_ALIASES = { output: 'out', offset: 'from', n: 'limit', h: 'help', 'max-results': 'limit' };

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function closest(word, options) {
  let best = null;
  for (const option of options) {
    const d = distance(word, option);
    if (d <= Math.max(2, Math.floor(option.length / 3)) && (!best || d < best.d)) best = { option, d };
  }
  return best?.option ?? null;
}

function toInt(flag, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new UsageError(`--${flag} needs a whole number, got "${value}".`);
  return number;
}

// Flags that only make sense on this computer are not passed on to another one.
export const LOCAL_ONLY_FLAGS = new Set(['json', 'peers', 'peer', 'stdin', 'out', 'help']);

/** Rebuilds a command line from parsed flags, for running the same command on another computer. */
export function toArgv(command, flags, positional) {
  const spec = COMMANDS[command];
  const argv = [command];
  for (const [name, value] of Object.entries(flags)) {
    if (LOCAL_ONLY_FLAGS.has(name) || value === undefined || value === false) continue;
    // --name=value keeps a value such as "--force" from being read as the next option.
    if (spec[name] === 'bool') argv.push(`--${name}`);
    else argv.push(`--${name}=${spec[name] === 'list' ? value.join(',') : String(value)}`);
  }
  return [...argv, '--', ...positional];
}

/**
 * Parses `argv` (after the command) against the command's flag table. Supports
 * `--flag value`, `--flag=value` and `--` to end options. Returns { flags, positional }.
 */
export function parseArgs(command, argv) {
  const spec = COMMANDS[command];
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!/^--?[a-z]/i.test(arg)) {
      positional.push(arg);
      continue;
    }
    const [rawName, inline] = arg.replace(/^--?/, '').split(/=(.*)/s, 2);
    const name = FLAG_ALIASES[rawName] ?? rawName;
    const type = spec[name];
    if (!type) {
      const guess = closest(name, Object.keys(spec));
      throw new UsageError(`Unknown option --${rawName} for ${command}.${guess ? ` Did you mean --${guess}?` : ''} Run: ${command} --help`);
    }
    if (type === 'bool') {
      flags[name] = true;
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (inline === undefined) i += 1;
    if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new UsageError(`--${name} needs a value.`);
    if (type === 'int') flags[name] = toInt(name, value);
    else if (type === 'list') flags[name] = [...(flags[name] ?? []), ...value.split(',').map(item => item.trim()).filter(Boolean)];
    else flags[name] = value;
  }
  if (flags.provider) {
    flags.provider = flags.provider.map(provider => provider.toLowerCase());
    const known = Object.values(PROVIDERS);
    for (const provider of flags.provider) {
      if (!known.includes(provider)) throw new UsageError(`Unknown provider "${provider}". Use one of: ${known.join(', ')}.`);
    }
  }
  if (flags.archived && !['include', 'exclude', 'only'].includes(flags.archived)) throw new UsageError('--archived is include, exclude or only.');
  return { flags, positional };
}

const UNITS = { h: 3_600_000, d: 86_400_000, w: 604_800_000, m: 2_592_000_000, y: 31_536_000_000 };

// Accepts ISO dates and times and relative ages such as 36h, 7d, 2w, 3m, 1y. A bare date is
// a local calendar day: --since takes its start and --until its end, so both include it.
export function parseWhen(flag, value, now = Date.now()) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  const invalid = () => new UsageError(`--${flag} takes a date (2026-01-31) or an age (7d, 2w, 3m).`);
  const relative = text.match(/^(\d+)\s*([hdwmy])$/i);
  if (relative) return new Date(now - Number(relative[1]) * UNITS[relative[2].toLowerCase()]).toISOString();
  const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const [year, month, date] = day.slice(1).map(Number);
    const start = new Date(year, month - 1, date);
    if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== date) throw invalid();
    return (flag === 'until' ? new Date(new Date(year, month - 1, date + 1).getTime() - 1) : start).toISOString();
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw invalid();
  return date.toISOString();
}
