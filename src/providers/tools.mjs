import { LIMITS } from '../shared/config.mjs';
import { oneLine } from '../shared/text.mjs';

// One searchable line per tool call: what ran, what was touched, what a subagent was asked.
// Tool output is indexed only as a short head-and-tail excerpt (see outputExcerpt).

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function commandText(command) {
  if (Array.isArray(command)) {
    // ["bash", "-lc", "npm test"] and ["powershell", "-Command", "..."] carry the script last.
    const shells = /^(bash|sh|zsh|pwsh|powershell(\.exe)?|cmd(\.exe)?)$/i;
    if (command.length >= 3 && shells.test(String(command[0]).split(/[\\/]/).at(-1))) return String(command.at(-1));
    return command.map(String).join(' ');
  }
  return String(command ?? '');
}

function compactArgs(input) {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

// Head and tail of a tool result: enough to find an error string or a file name.
export function outputExcerpt(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const head = LIMITS.OUTPUT_HEAD_CHARS;
  const tail = LIMITS.OUTPUT_TAIL_CHARS;
  if (text.length <= head + tail + 5) return text;
  return `${text.slice(0, head)} … ${text.slice(-tail)}`;
}

export function patchedFiles(patch) {
  const files = [];
  for (const match of String(patch ?? '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) files.push(match[1].trim());
  for (const match of String(patch ?? '').matchAll(/^\+\+\+ b\/(.+)$/gm)) files.push(match[1].trim());
  return [...new Set(files)];
}

const FILE_VERBS = new Map([
  ['read', 'read'], ['view', 'read'], ['read_file', 'read'],
  ['edit', 'edit'], ['multiedit', 'edit'], ['str_replace', 'edit'], ['str_replace_editor', 'edit'], ['search_replace', 'edit'],
  ['write', 'write'], ['create', 'write'], ['write_file', 'write'], ['notebookedit', 'edit'],
  ['delete_file', 'delete'],
]);

const SHELL_TOOLS = new Set(['bash', 'shell', 'shell_command', 'exec_command', 'local_shell', 'run_terminal_cmd', 'powershell', 'terminal', 'exec']);
const AGENT_TOOLS = new Set(['task', 'agent', 'spawn_agent', 'subagent']);

export function toolSummary(rawName, rawInput) {
  const name = String(rawName ?? 'tool');
  const key = name.toLowerCase();
  const input = parseMaybeJson(rawInput);
  const object = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const max = LIMITS.TOOL_SUMMARY_MAX_CHARS;

  if (SHELL_TOOLS.has(key)) {
    const command = object.command ?? object.cmd ?? object.script ?? (typeof input === 'string' ? input : '');
    return oneLine(`$ ${commandText(command)}`, max);
  }
  if (key === 'apply_patch') {
    const files = patchedFiles(object.input ?? object.patch ?? object.patchText ?? input);
    return oneLine(`edit ${files.join(', ') || '(patch)'}`, max);
  }
  const fileVerb = FILE_VERBS.get(key);
  if (fileVerb) {
    const file = object.file_path ?? object.path ?? object.target_file ?? object.notebook_path ?? object.filePath ?? '';
    return oneLine(`${fileVerb} ${file}`, max);
  }
  if (AGENT_TOOLS.has(key)) {
    const who = object.subagent_type ?? object.agent_type ?? object.agent ?? '';
    const what = object.description ?? '';
    const prompt = object.prompt ?? object.message ?? object.task ?? '';
    return oneLine(`agent${who ? ` (${who})` : ''}: ${[what, prompt].filter(Boolean).join(': ')}`, max);
  }
  if (key === 'glob' || key === 'grep' || key === 'search' || key === 'codebase_search' || key === 'grep_search') {
    const pattern = object.pattern ?? object.query ?? object.glob_pattern ?? '';
    const where = object.path ?? object.target_directory ?? '';
    return oneLine(`${key} ${pattern}${where ? ` in ${where}` : ''}`, max);
  }
  if (key === 'webfetch' || key === 'web_fetch' || key === 'fetch') return oneLine(`fetch ${object.url ?? compactArgs(input)}`, max);
  if (key === 'websearch' || key === 'web_search') return oneLine(`web search: ${object.query ?? compactArgs(input)}`, max);
  if (key === 'skill') return oneLine(`skill ${object.skill ?? object.name ?? ''} ${object.args ?? ''}`, max);
  if (key === 'todowrite' || key === 'update_plan') {
    const items = object.todos ?? object.plan ?? [];
    const text = Array.isArray(items) ? items.map(item => item?.content ?? item?.step ?? '').filter(Boolean).join('; ') : '';
    return oneLine(`plan: ${text}`, max);
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return oneLine(`${mcp[1]}.${mcp[2]} ${compactArgs(input)}`, max);
  return oneLine(`${name} ${compactArgs(input)}`, max);
}
