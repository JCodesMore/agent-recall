import { KINDS } from '../shared/config.mjs';
import { terminalSafe } from '../shared/text.mjs';

const LABELS = { user: 'user', assistant: 'assistant', tool: 'tool' };

function clock(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * One message as plain text for agents: a header line with its sequence number, then the
 * text. Tool calls and outputs are single arrow lines so a transcript stays scannable.
 */
export function formatMessage(message) {
  const text = terminalSafe(message.text);
  const when = clock(message.ts);
  if (message.kind === KINDS.TOOL) return `#${message.seq} -> ${text}`;
  if (message.kind === KINDS.OUTPUT) return `#${message.seq} <- ${text}`;
  const label = message.kind === KINDS.SUMMARY ? 'summary' : LABELS[message.role] ?? message.role;
  return `#${message.seq} ${label}${when ? ` ${when}` : ''}\n${text}`;
}
