import { SEARCH_DEFAULTS } from '../config.mjs';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function formatResult(r, i) {
  const lines = [];
  const title = r.title || r.summary || truncate(r.firstPrompt, SEARCH_DEFAULTS.TITLE_MAX_LEN) || '(no title)';
  lines.push(`${ANSI.bold}${ANSI.cyan}${i + 1}. ${title}${ANSI.reset}`);
  lines.push(`${ANSI.dim}   ${fmtDate(r.lastTs || r.firstTs || r.ts)}  ·  ${r.project || '?'}  ·  ${r.msgCount} msgs  ·  ${r.hitCount} hits${ANSI.reset}`);
  if (r.snippet) {
    lines.push(`   ${r.snippet}`);
  }
  lines.push(`   ${ANSI.green}${r.resumeCommand}${ANSI.reset}`);
  return lines.join('\n');
}

export function formatResults(results, { query, webUrl, elapsedMs } = {}) {
  if (results.length === 0) {
    return `${ANSI.yellow}No matches for "${query}".${ANSI.reset}\n${ANSI.dim}Try simpler keywords or check that you've used Claude Code in some projects.${ANSI.reset}`;
  }
  const header = `${ANSI.bold}Found ${results.length} session${results.length === 1 ? '' : 's'} for "${query}"${ANSI.reset}` +
    (elapsedMs != null ? `${ANSI.dim} (${elapsedMs} ms)${ANSI.reset}` : '');
  const body = results.map(formatResult).join('\n\n');
  const footer = webUrl ? `\n\n${ANSI.dim}Browse all results: ${webUrl}${ANSI.reset}` : '';
  return `${header}\n\n${body}${footer}`;
}

