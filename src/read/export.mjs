import fs from 'node:fs';
import path from 'node:path';
import { childSessions } from '../index/sessions.mjs';
import { formatMessage } from './format.mjs';
import { readTranscript } from './transcript.mjs';

const slug = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'session';

function section(db, session, depth) {
  const page = readTranscript(db, session, { all: true, tools: true, outputs: true });
  const heading = `${'#'.repeat(Math.min(depth + 1, 4))} ${session.title ?? session.handle} (${session.provider} ${session.handle})`;
  const meta = [session.cwd && `cwd: ${session.cwd}`, session.created_at && `started: ${session.created_at}`, session.updated_at && `updated: ${session.updated_at}`]
    .filter(Boolean).join('\n');
  const body = page.messages.map(formatMessage).join('\n\n');
  return { text: `${heading}\n\n${meta}\n\n${body}\n`, messages: page.messages.length };
}

/**
 * Writes a whole session, every message kind included, followed by its subagents. `out` may
 * be a file or an existing directory (a file name is derived from the title).
 */
export function exportTranscript(db, session, out, { subagents = true } = {}) {
  let file = path.resolve(out);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, `${slug(session.title)}-${session.handle}.md`);
  const parts = [section(db, session, 0)];
  if (subagents) {
    const seen = new Set([session.id]);
    const walk = (parent, depth) => {
      for (const child of childSessions(db, parent)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        parts.push(section(db, child, depth));
        walk(child, depth + 1);
      }
    };
    walk(session, 1);
  }
  const text = parts.map(part => part.text).join('\n---\n\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { path: file, bytes: Buffer.byteLength(text), messages: parts.reduce((sum, part) => sum + part.messages, 0), sessions: parts.length };
}
