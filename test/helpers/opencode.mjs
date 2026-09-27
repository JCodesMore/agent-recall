import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The subset of OpenCode's opencode.db schema the provider reads.
const SCHEMA = `
CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL,
  directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL, time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL, time_archived INTEGER, agent TEXT, model TEXT);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
`;

export const OPENCODE_DB = path.join('.local', 'share', 'opencode', 'opencode.db');

export const ms = minute => Date.UTC(2026, 0, 5, 10, minute);

/**
 * Writes a synthetic opencode.db under the fake home.
 * sessions: [{ id, parentId, title, directory, agent, archivedAt, minute,
 *              messages: [{ id, role, minute, summary, modelID, parts: [data] }] }]
 */
export function writeOpencodeDb(home, sessions) {
  const file = path.join(home.home, OPENCODE_DB);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insertSession = db.prepare(`INSERT INTO session (id, project_id, parent_id, slug, directory, title, version,
    time_created, time_updated, time_archived, agent, model) VALUES (?, 'prj', ?, 'slug', ?, ?, '1.18.30', ?, ?, ?, ?, ?)`);
  const insertMessage = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)');
  const insertPart = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)');
  for (const session of sessions) {
    const created = ms(session.minute ?? 0);
    insertSession.run(session.id, session.parentId ?? null, session.directory ?? '/work/demo', session.title,
      created, created, session.archivedAt ?? null, session.agent ?? null, JSON.stringify({ id: 'model-test', providerID: 'test' }));
    for (const message of session.messages ?? []) {
      const time = ms(message.minute);
      const data = { role: message.role, time: { created: time }, ...(message.summary ? { summary: true } : {}), ...(message.modelID ? { modelID: message.modelID } : {}) };
      insertMessage.run(message.id, session.id, time, time, JSON.stringify(data));
      message.parts.forEach((part, index) => {
        insertPart.run(`${message.id}_p${index}`, message.id, session.id, time, time, JSON.stringify(part));
      });
    }
  }
  db.close();
  return file;
}

export const part = {
  text: (text, extra = {}) => ({ type: 'text', text, ...extra }),
  tool: (tool, input, output, status = 'completed') => ({
    type: 'tool',
    tool,
    callID: 'call',
    state: status === 'error' ? { status, input, error: output } : { status, input, output },
  }),
  reasoning: text => ({ type: 'reasoning', text }),
  file: (filename, url) => ({ type: 'file', mime: 'image/png', filename, url }),
};
