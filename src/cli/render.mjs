import { PROVIDER_LABELS } from '../shared/config.mjs';
import { displayPath } from '../shared/paths.mjs';
import { oneLine, terminalSafe } from '../shared/text.mjs';
import { formatMessage } from '../read/format.mjs';

const DAY_MS = 86_400_000;

function ago(iso, now = Date.now()) {
  const time = Date.parse(iso ?? '');
  if (!Number.isFinite(time)) return 'unknown date';
  const days = Math.floor((now - time) / DAY_MS);
  const date = new Date(time).toISOString().slice(0, 10);
  if (days <= 0) return `${date} (today)`;
  if (days === 1) return `${date} (yesterday)`;
  if (days < 60) return `${date} (${days} days ago)`;
  return date;
}

// How to name a session in a follow-up command, including the computer it lives on.
const ref = session => `${session.handle}${session.peer ? ` --peer ${session.peer}` : ''}`;

function computersLine(result) {
  if (!result.computers) return [];
  const parts = result.computers.map(computer => (computer.ok ? `${computer.name} ${computer.count}` : `${computer.name} failed (${terminalSafe(oneLine(computer.error, 120))})`));
  return [`computers: ${parts.join(', ')}`];
}

function sessionLine(session) {
  const tags = [session.kind === 'subagent' && 'subagent', session.archived && 'archived', session.live && 'active now'].filter(Boolean);
  const where = session.project ?? (session.cwd ? displayPath(session.cwd) : null);
  const parts = [where, ago(session.updated), `${session.messages} msgs`, ...tags].filter(Boolean);
  const computer = session.peer ? ` @${session.peer}` : '';
  return `${terminalSafe(oneLine(session.title ?? '(untitled)', 100))}  [${session.provider} ${session.handle}${computer}]  ${parts.join(' · ')}`;
}

function warningsBlock(result) {
  return (result.warnings ?? []).map(warning => `warning: ${terminalSafe(warning)}`);
}

export function renderSearch(result) {
  const lines = [];
  const count = result.hits.length;
  lines.push(count
    ? `${count} conversation${count === 1 ? '' : 's'} for: ${result.query.terms.join(', ')}`
    : `No conversations matched: ${result.query.terms.join(', ')}`);
  result.hits.forEach((hit, index) => {
    lines.push('', `${index + 1}. ${sessionLine(hit)}`);
    for (const match of hit.matches) {
      const who = match.kind === 'tool' ? 'tool' : match.kind === 'output' ? 'output' : match.role;
      const via = match.subagent ? ` (subagent ${match.handle}: ${terminalSafe(oneLine(match.subagent, 60))})` : '';
      lines.push(`   #${match.seq} ${who}${via}: ${terminalSafe(match.snippet)}`);
    }
    if (hit.missing.length) lines.push(`   not found here: ${hit.missing.join(', ')}`);
    const first = hit.matches[0];
    lines.push(`   read ${first ? `${first.handle}${hit.peer ? ` --peer ${hit.peer}` : ''} --at ${first.seq}` : ref(hit)}`);
  });
  lines.push('');
  lines.push(count
    ? 'Next: read <handle> --at <#> opens a match in context; read <handle> pages the whole conversation.'
    : 'Next: try other words (a file name, command, error text or project name), or: recent --project <name>');
  lines.push(...computersLine(result));
  lines.push(...warningsBlock(result));
  return lines.join('\n');
}

export function renderRead(result) {
  if (result.export) {
    const e = result.export;
    return [`Wrote ${e.messages} messages from ${e.sessions} session(s) to ${e.path} (${e.bytes} bytes).`, ...warningsBlock(result)].join('\n');
  }
  const lines = [sessionLine(result.session)];
  if (result.session.cwd) lines.push(`cwd: ${result.session.cwd}`);
  if (result.root) lines.push(`part of: ${sessionLine(result.root)}`);
  const first = result.messages[0];
  const last = result.messages.at(-1);
  if (result.grepHits) {
    lines.push(`${result.grepHits.length} matching message(s); showing ${result.shown} with context.`);
  } else if (first) {
    lines.push(`Showing #${first.seq}-#${last.seq}: ${result.shown} of ${result.available} messages${result.available < result.total ? ` (${result.total - result.available} tool outputs hidden; add --outputs)` : ''}.`);
  } else {
    lines.push('No messages to show.');
  }
  lines.push('');
  for (const message of result.messages) lines.push(formatMessage(message), '');
  const handle = ref(result.session);
  if (result.grepNextFrom !== null && result.grepNextFrom !== undefined) lines.push(`-- more matches: read ${handle} --grep "..." --max-chars <larger>, or read ${handle} --from ${result.grepNextFrom} --`);
  else if (result.nextFrom !== null && result.nextFrom !== undefined) lines.push(`-- more: read ${handle} --from ${result.nextFrom} --`);
  else if (result.continuesIn) lines.push(`-- continues in the next part: read ${ref(result.continuesIn)} --`);
  else if (!result.grepHits) lines.push('-- end of conversation --');
  if (result.prevFrom !== null && result.prevFrom !== undefined) lines.push(`-- earlier: read ${handle} --from ${result.prevFrom} --`);
  if (result.subagents?.length) {
    lines.push('', 'Subagents:');
    for (const child of result.subagents) lines.push(`  ${sessionLine(child)}`);
  }
  for (const note of result.notes ?? []) lines.push(`note: ${note}`);
  lines.push(...warningsBlock(result));
  return lines.join('\n');
}

export function renderShow(result) {
  const s = result.session;
  const lines = [sessionLine(s)];
  const field = (label, value) => value !== null && value !== undefined && value !== '' && lines.push(`${label}: ${terminalSafe(value)}`);
  field('id', s.id);
  field('provider', PROVIDER_LABELS[s.provider] ?? s.provider);
  field('cwd', s.cwd);
  field('branch', s.branch);
  field('model', s.model);
  field('origin', s.origin);
  field('started', s.created);
  field('updated', s.updated);
  field('first prompt', s.firstPrompt && oneLine(s.firstPrompt, 200));
  field('transcript', s.source && s.peer ? `${s.source} (on ${s.peer})` : s.source);
  if (s.resume) field('resume', [s.resume.command, ...s.resume.args].join(' ') + (s.resume.cwd ? `   (in ${s.resume.cwd})` : ''));
  if (result.root) lines.push(`part of: ${sessionLine(result.root)}`);
  if (result.subagents.length) {
    lines.push('subagents:');
    for (const child of result.subagents) lines.push(`  ${sessionLine(child)}`);
  }
  if (result.attachments.length) {
    lines.push('attachments:');
    const save = a => (s.peer ? `   (on ${s.peer}: attachment ${a.id} --out <file>)` : `   (attachment ${a.id} --out <file>)`);
    for (const a of result.attachments) lines.push(`  ${a.id}  #${a.seq} ${a.mime} ${a.bytes} bytes${a.name ? ` ${a.name}` : ''}${save(a)}`);
  }
  lines.push('', `Next: read ${ref(s)}`);
  lines.push(...warningsBlock(result));
  return lines.join('\n');
}

export function renderRecent(result) {
  const lines = result.sessions.length ? result.sessions.map((session, i) => `${i + 1}. ${sessionLine(session)}`) : ['No conversations found.'];
  lines.push('', `Next: read <handle>${result.computers ? ' (add --peer NAME for another computer)' : ''}`);
  lines.push(...computersLine(result));
  lines.push(...warningsBlock(result));
  return lines.join('\n');
}

export function renderSync(result) {
  if (result.locked) return 'Another sync is running; nothing to do.';
  const lines = [`Indexed ${result.indexed} new or changed source(s), appended ${result.appended}, removed ${result.removed}, ${result.skipped} unchanged (${(result.elapsedMs / 1000).toFixed(1)}s).`];
  for (const error of result.errors) lines.push(`error: ${error.provider}${error.source ? ` ${error.source}` : ''}: ${error.message}`);
  return lines.join('\n');
}

export function renderDoctor(result) {
  const lines = [`Agent Recall ${result.version} on Node ${result.node}`, `index: ${displayPath(result.index.path)} (${(result.index.bytes / 1e6).toFixed(1)} MB), last sync ${result.index.lastSync ?? 'never'}`];
  for (const [id, stats] of Object.entries(result.providers)) {
    lines.push(`${(PROVIDER_LABELS[id] ?? id).padEnd(12)} ${String(stats.roots ?? 0).padStart(6)} conversations, ${String(stats.sessions - (stats.roots ?? 0)).padStart(6)} subagents, ${String(stats.messages ?? 0).padStart(8)} messages${stats.newest ? `, newest ${ago(stats.newest)}` : ''}`);
  }
  for (const computer of result.computers ?? []) {
    if (!computer.ok) lines.push(`computer ${computer.name}: unreachable (${terminalSafe(oneLine(computer.error, 160))})`);
    else lines.push(`computer ${computer.name}: Agent Recall ${computer.version} on Node ${computer.node}, ${Object.values(computer.providers ?? {}).reduce((sum, stats) => sum + (stats.roots ?? 0), 0)} conversations${computer.warnings.length ? `, ${computer.warnings.length} warning(s)` : ''}`);
  }
  if (result.claudeRetentionDays) lines.push(`Claude transcript retention: ${result.claudeRetentionDays} days`);
  lines.push(...warningsBlock(result));
  if (!result.warnings.length && (result.computers ?? []).every(computer => computer.ok)) lines.push('ok');
  return lines.join('\n');
}

export function renderAttachment(result) {
  return `Wrote ${result.mime} (${result.bytes} bytes) to ${result.path}`;
}

export function renderError(error) {
  const lines = [`error: ${terminalSafe(error.message)}`];
  for (const candidate of error.candidates ?? []) lines.push(`  ${sessionLine(candidate)}`);
  if (error.hint) lines.push(error.hint);
  return lines.join('\n');
}
