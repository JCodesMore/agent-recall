import { PROVIDER_LABELS } from '../shared/config.mjs';
import { HANDLE_LENGTH, sessionHandle } from '../shared/ids.mjs';
import { comparablePath, projectName } from '../shared/paths.mjs';
import { PASSAGE_FLAGS, buildPassages } from './passages.mjs';

const TITLE_RANK = { user: 3, generated: 2, prompt: 1 };

const json = value => (value === undefined || value === null ? null : JSON.stringify(value));
const parseJson = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

// Merges what the transcript said with labels from side stores (desktop titles, archive
// flags, spawn edges). A user-set title always wins.
export function effectiveSession(parsed, label) {
  let title = parsed.title ?? null;
  let titleSource = parsed.titleSource ?? null;
  if (label?.title && (TITLE_RANK[label.title_source] ?? 2) >= (TITLE_RANK[titleSource] ?? 0)) {
    title = label.title;
    titleSource = label.title_source ?? 'generated';
  }
  const parentNativeId = parsed.parentNativeId ?? label?.parent_native_id ?? null;
  const cwd = label?.cwd ?? parsed.cwd ?? null;
  const origin = label?.origin ?? parsed.origin ?? null;
  return {
    title,
    titleSource,
    parentNativeId,
    kind: parentNativeId ? 'subagent' : 'main',
    archived: label?.archived === null || label?.archived === undefined ? Boolean(parsed.archived) : Boolean(label.archived),
    cwd,
    cwdKey: cwd ? comparablePath(cwd) : null,
    origin,
    project: cwd ? projectName(cwd) : origin === 'cowork' ? 'cowork' : null,
    meta: { ...(parsed.meta ?? {}), ...parseJson(label?.meta, {}) },
  };
}

export function createWriter(db) {
  const q = {
    insertSource: db.prepare(`INSERT INTO sources(path, provider, size, mtime, extra, head, cursor, indexed_at, diagnostics)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
    updateSource: db.prepare('UPDATE sources SET size = ?, mtime = ?, extra = ?, head = ?, cursor = ?, indexed_at = ?, diagnostics = ? WHERE id = ?'),
    deleteSource: db.prepare('DELETE FROM sources WHERE path = ?'),
    findHandle: db.prepare('SELECT provider, native_id FROM sessions WHERE handle = ?'),
    upsertSession: db.prepare(`INSERT INTO sessions(handle, provider, native_id, source_id, parent_native_id, kind, title, title_source,
        first_prompt, cwd, cwd_key, project, git_branch, model, origin, created_at, updated_at, archived, resume, meta, parsed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, native_id) DO UPDATE SET
        parent_native_id = excluded.parent_native_id, kind = excluded.kind, title = excluded.title,
        title_source = excluded.title_source, first_prompt = excluded.first_prompt, cwd = excluded.cwd, cwd_key = excluded.cwd_key,
        project = excluded.project, git_branch = excluded.git_branch, model = excluded.model, origin = excluded.origin,
        created_at = excluded.created_at, updated_at = excluded.updated_at, archived = excluded.archived,
        resume = excluded.resume, meta = excluded.meta, parsed = excluded.parsed
      WHERE sessions.source_id = excluded.source_id
      RETURNING id`),
    owner: db.prepare(`SELECT s.id, s.source_id AS sourceId, src.mtime FROM sessions s JOIN sources src ON src.id = s.source_id
      WHERE s.provider = ? AND s.native_id = ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteOwnSession: db.prepare('DELETE FROM sessions WHERE provider = ? AND native_id = ? AND source_id = ?'),
    forceReparse: db.prepare('UPDATE sources SET size = -1, cursor = NULL WHERE id = ?'),
    reparseLosers: db.prepare("UPDATE sources SET size = -1, cursor = NULL WHERE json_extract(diagnostics, '$.duplicates') > 0"),
    setDiagnostics: db.prepare('UPDATE sources SET diagnostics = ? WHERE id = ?'),
    label: db.prepare('SELECT * FROM labels WHERE provider = ? AND native_id = ?'),
    deleteSessionDoc: db.prepare('DELETE FROM sessions_fts WHERE rowid = ?'),
    insertSessionDoc: db.prepare('INSERT INTO sessions_fts(rowid, title, context) VALUES (?, ?, ?)'),
    insertMessage: db.prepare('INSERT OR REPLACE INTO messages(session_id, seq, ts, role, kind, text, meta) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    countMessages: db.prepare('UPDATE sessions SET message_count = (SELECT count(*) FROM messages WHERE session_id = ?) WHERE id = ?'),
    insertAttachment: db.prepare(`INSERT OR IGNORE INTO attachments(id, session_id, seq, ordinal, kind, mime, bytes, sha256, name, locator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    lastTurnStart: db.prepare(`SELECT max(first_seq) AS seq FROM passages WHERE session_id = ? AND (flags & ${PASSAGE_FLAGS.TURN_START}) != 0`),
    passagesFrom: db.prepare('SELECT id, first_seq, last_seq, hash, flags FROM passages WHERE session_id = ? AND first_seq >= ?'),
    deletePassage: db.prepare('DELETE FROM passages WHERE id = ?'),
    messagesFrom: db.prepare('SELECT seq, ts, role, kind, text, meta FROM messages WHERE session_id = ? AND seq >= ? ORDER BY seq'),
    insertPassage: db.prepare('INSERT INTO passages(session_id, first_seq, last_seq, ts, hash, flags) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'),
    insertPassageDoc: db.prepare('INSERT INTO passages_fts(rowid, user, assistant, tools) VALUES (?, ?, ?, ?)'),
    sessionsForLabel: db.prepare('SELECT id, parsed, git_branch FROM sessions WHERE provider = ? AND native_id = ?'),
    updateEffective: db.prepare(`UPDATE sessions SET parent_native_id = ?, kind = ?, title = ?, title_source = ?, archived = ?,
      cwd = ?, cwd_key = ?, project = ?, origin = ?, meta = ? WHERE id = ?`),
    currentLabels: db.prepare('SELECT * FROM labels WHERE provider = ?'),
    upsertLabel: db.prepare(`INSERT OR REPLACE INTO labels(provider, native_id, title, title_source, archived, parent_native_id, origin, cwd, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    deleteLabel: db.prepare('DELETE FROM labels WHERE provider = ? AND native_id = ?'),
  };

  function handleFor(provider, nativeId) {
    for (let length = HANDLE_LENGTH; length <= 16; length += 1) {
      const handle = sessionHandle(provider, nativeId, length);
      const owner = q.findHandle.get(handle);
      if (!owner || (owner.provider === provider && owner.native_id === nativeId)) return handle;
    }
    throw new Error(`No free handle for ${provider}:${nativeId}`);
  }

  function writeSessionDoc(sessionId, provider, effective, gitBranch) {
    q.deleteSessionDoc.run(sessionId);
    const context = [effective.project, effective.cwd, gitBranch, PROVIDER_LABELS[provider], effective.origin, effective.meta?.agentType]
      .filter(Boolean).join(' ');
    // A title copied from the first prompt is already indexed with that turn; counting it
    // twice would rank chats that open with a recall request above what they asked for.
    const title = effective.titleSource === 'prompt' ? '' : effective.title ?? '';
    q.insertSessionDoc.run(sessionId, title, context);
  }

  // Two files can hold the same session (a copied project folder, a move caught mid-way).
  // The most recently written one owns it; the other is re-read whenever a source goes away.
  function claim(provider, sourceId, nativeId, mtime) {
    const owner = q.owner.get(provider, nativeId);
    if (!owner || owner.sourceId === sourceId) return true;
    if (mtime < owner.mtime) return false;
    q.deleteSession.run(owner.id);
    q.forceReparse.run(owner.sourceId);
    return true;
  }

  function upsertSession(provider, sourceId, session, mtime) {
    if (!claim(provider, sourceId, session.nativeId, mtime)) return null;
    const label = q.label.get(provider, session.nativeId);
    const effective = effectiveSession(session, label);
    const row = q.upsertSession.get(
      handleFor(provider, session.nativeId), provider, session.nativeId, sourceId, effective.parentNativeId, effective.kind,
      effective.title, effective.titleSource, session.firstPrompt ?? null, effective.cwd, effective.cwdKey, effective.project,
      session.gitBranch ?? null, session.model ?? null, effective.origin, session.createdAt ?? null, session.updatedAt ?? null,
      effective.archived ? 1 : 0, json(session.resume), json(effective.meta), JSON.stringify(session),
    );
    if (!row) return null;
    writeSessionDoc(row.id, provider, effective, session.gitBranch);
    return row.id;
  }

  // Rebuilds passages from the last turn start (or from 0), writing only those that changed:
  // a long autonomous turn grows by appends and would otherwise be rewritten every sync.
  function rebuildPassages(sessionId, fromSeq) {
    const start = fromSeq === 0 ? 0 : q.lastTurnStart.get(sessionId)?.seq ?? 0;
    const existing = new Map(q.passagesFrom.all(sessionId, start).map(row => [row.first_seq, row]));
    const messages = q.messagesFrom.all(sessionId, start).map(row => ({ ...row, meta: parseJson(row.meta, undefined) }));
    for (const passage of buildPassages(messages)) {
      const old = existing.get(passage.firstSeq);
      existing.delete(passage.firstSeq);
      if (old && old.last_seq === passage.lastSeq && old.hash === passage.hash && old.flags === passage.flags) continue;
      if (old) q.deletePassage.run(old.id);
      const { id } = q.insertPassage.get(sessionId, passage.firstSeq, passage.lastSeq, passage.ts, passage.hash, passage.flags);
      q.insertPassageDoc.run(id, passage.user, passage.assistant, passage.tools);
    }
    for (const stale of existing.values()) q.deletePassage.run(stale.id);
  }

  function writeContent(provider, sourceId, parsed, append, mtime) {
    const ids = new Map();
    let duplicates = 0;
    for (const session of parsed.sessions) {
      const id = upsertSession(provider, sourceId, session, mtime);
      if (id === null) duplicates += 1;
      else ids.set(session.nativeId, id);
    }
    const firstSeq = new Map();
    for (const message of parsed.messages) {
      const sessionId = ids.get(message.sessionNativeId);
      if (sessionId === undefined) continue;
      if (!firstSeq.has(sessionId)) firstSeq.set(sessionId, message.seq);
      q.insertMessage.run(sessionId, message.seq, message.ts ?? null, message.role, message.kind, message.text, json(message.meta));
    }
    for (const attachment of parsed.attachments) {
      const sessionId = ids.get(attachment.sessionNativeId);
      if (sessionId === undefined) continue;
      q.insertAttachment.run(attachment.id, sessionId, attachment.seq, attachment.ordinal, attachment.kind, attachment.mime,
        attachment.bytes, attachment.sha256, attachment.name ?? null, JSON.stringify(attachment.locator));
    }
    for (const [sessionId, seq] of firstSeq) {
      rebuildPassages(sessionId, append ? seq : 0);
      q.countMessages.run(sessionId, sessionId);
    }
    // Sessions without new messages still need a message count after a full write.
    if (!append) for (const sessionId of ids.values()) if (!firstSeq.has(sessionId)) q.countMessages.run(sessionId, sessionId);
    q.setDiagnostics.run(json({ ...parsed.diagnostics, duplicates }), sourceId);
    return { sessions: ids.size, messages: parsed.messages.length, duplicates };
  }

  return {
    replaceSource(source, stat, parsed, now) {
      q.deleteSource.run(source.path);
      const { id } = q.insertSource.get(source.path, source.provider, stat.size, stat.mtime, stat.extra ?? '', stat.head ?? null,
        json(parsed.cursor), now, json(parsed.diagnostics));
      return writeContent(source.provider, id, parsed, false, stat.mtime);
    },

    appendSource(sourceId, source, stat, parsed, now) {
      q.updateSource.run(stat.size, stat.mtime, stat.extra ?? '', stat.head ?? null, json(parsed.cursor), now, json(parsed.diagnostics), sourceId);
      return writeContent(source.provider, sourceId, parsed, true, stat.mtime);
    },

    // A partial parse (see builder.mjs) replaces only the sessions it returns or removes.
    updateSource(sourceId, source, stat, parsed, now) {
      q.updateSource.run(stat.size, stat.mtime, stat.extra ?? '', stat.head ?? null, json(parsed.cursor), now, json(parsed.diagnostics), sourceId);
      for (const nativeId of [...parsed.removed, ...parsed.sessions.map(session => session.nativeId)]) {
        q.deleteOwnSession.run(source.provider, nativeId, sourceId);
      }
      return writeContent(source.provider, sourceId, parsed, false, stat.mtime);
    },

    removeSource(path) {
      q.deleteSource.run(path);
      q.reparseLosers.run();
    },

    // Replaces a provider's labels and re-derives the sessions whose label changed.
    applyLabels(provider, labels) {
      const before = new Map(q.currentLabels.all(provider).map(row => [row.native_id, row]));
      const touched = new Set();
      const seen = new Set();
      for (const label of labels) {
        if (!label?.nativeId) continue;
        seen.add(label.nativeId);
        const row = [label.title ?? null, label.titleSource ?? null, label.archived === undefined || label.archived === null ? null : label.archived ? 1 : 0,
          label.parentNativeId ?? null, label.origin ?? null, label.cwd ?? null, json(label.meta)];
        const old = before.get(label.nativeId);
        if (old && [old.title, old.title_source, old.archived, old.parent_native_id, old.origin, old.cwd, old.meta].every((value, i) => value === row[i])) continue;
        q.upsertLabel.run(provider, label.nativeId, ...row);
        touched.add(label.nativeId);
      }
      for (const nativeId of before.keys()) {
        if (seen.has(nativeId)) continue;
        q.deleteLabel.run(provider, nativeId);
        touched.add(nativeId);
      }
      for (const nativeId of touched) {
        const session = q.sessionsForLabel.get(provider, nativeId);
        if (!session) continue;
        const effective = effectiveSession(parseJson(session.parsed, {}), q.label.get(provider, nativeId));
        q.updateEffective.run(effective.parentNativeId, effective.kind, effective.title, effective.titleSource, effective.archived ? 1 : 0,
          effective.cwd, effective.cwdKey, effective.project, effective.origin, json(effective.meta), session.id);
        writeSessionDoc(session.id, provider, effective, session.git_branch);
      }
      return touched.size;
    },
  };
}
