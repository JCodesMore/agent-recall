import { KINDS, LIMITS, ROLES } from '../shared/config.mjs';
import { hashHex } from '../shared/ids.mjs';

export const PASSAGE_FLAGS = Object.freeze({ RECALL: 1, SUMMARY: 2, TURN_START: 4 });

const startsTurn = message => message.role === ROLES.USER && message.kind === KINDS.TEXT;

function column(message) {
  if (message.kind === KINDS.TOOL || message.kind === KINDS.OUTPUT) return 'tools';
  if (message.role === ROLES.USER) return 'user';
  return 'assistant';
}

function isRecall(message) {
  return Boolean(message.meta?.recall);
}

function build(messages, turnFlags, isTurnStart) {
  const text = { user: [], assistant: [], tools: [] };
  let flags = turnFlags | (isTurnStart ? PASSAGE_FLAGS.TURN_START : 0);
  for (const message of messages) {
    if (message.kind === KINDS.SUMMARY) flags |= PASSAGE_FLAGS.SUMMARY;
    // A recall lookup's own command would match the very query it ran; keep it out.
    if (!isRecall(message)) text[column(message)].push(message.text);
  }
  return {
    firstSeq: messages[0].seq,
    lastSeq: messages.at(-1).seq,
    ts: messages.find(message => message.ts)?.ts ?? null,
    hash: hashHex(...messages.map(message => `${message.role}\u0001${message.kind}\u0001${message.text}`)).slice(0, 24),
    flags,
    user: text.user.join('\n'),
    assistant: text.assistant.join('\n'),
    tools: text.tools.join('\n'),
  };
}

/**
 * Splits ordered messages into turns (a user text message and what follows it), then splits
 * each turn at message boundaries so no passage exceeds PASSAGE_MAX_CHARS unless a single
 * message does.
 */
export function buildPassages(messages) {
  const turns = [];
  for (const message of messages) {
    if (!turns.length || startsTurn(message)) turns.push([]);
    turns.at(-1).push(message);
  }
  const passages = [];
  for (const turn of turns) {
    const turnFlags = turn.some(isRecall) ? PASSAGE_FLAGS.RECALL : 0;
    let chunk = [];
    let size = 0;
    let first = true;
    for (const message of turn) {
      if (chunk.length && size + message.text.length > LIMITS.PASSAGE_MAX_CHARS) {
        passages.push(build(chunk, turnFlags, first && startsTurn(chunk[0])));
        first = false;
        chunk = [];
        size = 0;
      }
      chunk.push(message);
      size += message.text.length;
    }
    if (chunk.length) passages.push(build(chunk, turnFlags, first && startsTurn(chunk[0])));
  }
  return passages;
}
