import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LIMITS, PATHS, PROVIDERS } from '../config.mjs';
import { attachmentKey, decodeDataUrl, parseDataUrl } from '../model/attachments.mjs';
import { asIso, messageKey, sessionKey } from '../model/ids.mjs';
import { emptyDiagnostics, sourceSignature } from './source-adapter.mjs';

const PROVIDER = PROVIDERS.OPENCODE;
const DATABASE_PATTERN = /^opencode.*\.db$/i;

function timestamp(value) {
  if (typeof value === 'bigint') value = Number(value);
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e12) value *= 1_000;
  return asIso(value);
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function parseData(value, diagnostics) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') {
    diagnostics.malformed += 1;
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('not an object');
    return parsed;
  } catch {
    diagnostics.malformed += 1;
    return null;
  }
}

function modelName(data, row = {}) {
  const model = firstDefined(data?.model, data?.modelID, data?.modelId, row.model);
  if (typeof model === 'string') {
    if (model.trim().startsWith('{')) {
      try { return modelName({ model: JSON.parse(model) }); } catch { return model; }
    }
    return model;
  }
  if (model && typeof model === 'object') {
    return firstDefined(model.modelID, model.modelId, model.id, model.name) ?? null;
  }
  return null;
}

function providerId(data) {
  return firstDefined(data?.providerID, data?.providerId, data?.model?.providerID, data?.model?.providerId);
}

function compactObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined && value !== null));
}

function compareTimed(left, right) {
  const leftTime = left.sortTime ?? Number.POSITIVE_INFINITY;
  const rightTime = right.sortTime ?? Number.POSITIVE_INFINITY;
  return leftTime - rightTime || String(left.id).localeCompare(String(right.id));
}

function numericTime(value) {
  if (typeof value === 'bigint') return Number(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dataTime(data, row) {
  return firstDefined(
    data?.time?.created,
    data?.time?.start,
    data?.time,
    row.time_created,
    row.created_at,
    row.createdAt,
  );
}

function isArchived(value) {
  return value !== false && value !== 0 && value !== '0' && value !== null && value !== undefined;
}

async function statIfPresent(file) {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function databaseFiles(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw new Error(`Unable to inspect OpenCode data directory "${root}": ${error.message}`, { cause: error });
  }
  return entries
    .filter(entry => entry.isFile() && DATABASE_PATTERN.test(entry.name))
    .map(entry => path.resolve(root, entry.name));
}

async function descriptor(file) {
  let stat;
  try {
    stat = await statIfPresent(file);
  } catch (error) {
    throw new Error(`Unable to inspect OpenCode database "${file}": ${error.message}`, { cause: error });
  }
  if (!stat?.isFile()) return null;

  const walPath = `${file}-wal`;
  let walStat;
  try {
    walStat = await statIfPresent(walPath);
  } catch (error) {
    throw new Error(`Unable to inspect OpenCode WAL "${walPath}": ${error.message}`, { cause: error });
  }
  const walSize = walStat?.isFile() ? walStat.size : 0;
  const walMtimeMs = walStat?.isFile() ? Math.trunc(walStat.mtimeMs) : 0;

  return {
    provider: PROVIDER,
    path: file,
    signature: sourceSignature(stat, `wal=${walSize}:${walMtimeMs}`),
    metadata: {
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      walPath,
      walSize,
      walMtimeMs,
    },
  };
}

async function discover(options = {}) {
  const override = firstDefined(options.database, options.db, process.env.OPENCODE_DB);
  let files;
  if (override) {
    files = [path.resolve(String(override))];
  } else {
    const root = path.resolve(options.root ?? PATHS.OPENCODE_ROOT);
    const roots = [root];
    if (path.basename(root).toLowerCase() !== 'opencode') roots.push(path.join(root, 'opencode'));
    files = (await Promise.all(roots.map(databaseFiles))).flat();
  }

  const descriptors = await Promise.all([...new Set(files)].sort().map(descriptor));
  return descriptors.filter(Boolean);
}

function readRows(db, sourcePath) {
  try {
    return {
      sessions: db.prepare('SELECT * FROM session').all(),
      messages: db.prepare('SELECT * FROM message').all(),
      parts: db.prepare('SELECT * FROM part').all(),
    };
  } catch (error) {
    const schemaError = /no such table|no such column|has no column/i.test(error.message);
    const detail = schemaError
      ? 'Expected OpenCode tables session, message, and part.'
      : 'Verify that the database is a readable OpenCode SQLite database.';
    throw new Error(`Unable to query OpenCode database "${sourcePath}": ${error.message} ${detail}`, {
      cause: error,
    });
  }
}

function normalizeParts(rows, diagnostics) {
  const textByMessage = new Map();
  const attachmentsByMessage = new Map();
  for (const row of rows) {
    const data = parseData(row.data, diagnostics);
    if (!data) continue;
    const messageId = firstDefined(row.message_id, row.messageId, data.messageID, data.messageId);
    const id = firstDefined(row.id, data.id);
    if (!messageId || !id) {
      diagnostics.skipped += 1;
      continue;
    }

    const type = String(firstDefined(data.type, row.type, '')).toLowerCase();
    if (type === 'file') {
      const parsed = parseDataUrl(data.url);
      if (!parsed) continue;
      const attachments = attachmentsByMessage.get(String(messageId)) ?? [];
      attachments.push({
        id: String(id),
        mime: parsed.mime,
        byteLength: parsed.byteLength,
        sha256: parsed.sha256,
        messageId: String(messageId),
        sessionId: String(firstDefined(row.session_id, row.sessionId, data.sessionID, data.sessionId) ?? ''),
        name: firstDefined(data.filename, data.name) ?? null,
        sortTime: numericTime(dataTime(data, row)),
      });
      attachmentsByMessage.set(String(messageId), attachments);
      continue;
    }
    let text = null;
    if (type === 'text' && typeof data.text === 'string') text = data.text;
    if (type === 'subtask' && typeof data.prompt === 'string') text = data.prompt;
    if (text === null) continue;

    const time = dataTime(data, row);
    const part = { id, type, text, sortTime: numericTime(time) };
    const parts = textByMessage.get(String(messageId)) ?? [];
    parts.push(part);
    textByMessage.set(String(messageId), parts);
  }
  for (const parts of textByMessage.values()) parts.sort(compareTimed);
  for (const attachments of attachmentsByMessage.values()) attachments.sort(compareTimed);
  return { textByMessage, attachmentsByMessage };
}

function normalizeMessages(rows, textByMessage, attachmentsByMessage, knownSessions, sourcePath, diagnostics) {
  const parsed = [];
  for (const row of rows) {
    const data = parseData(row.data, diagnostics);
    const id = firstDefined(row.id, data?.id);
    const nativeSessionId = firstDefined(row.session_id, row.sessionId, data?.sessionID, data?.sessionId);
    if (!data || !id || !nativeSessionId || !knownSessions.has(String(nativeSessionId))) {
      diagnostics.skipped += 1;
      continue;
    }

    const parts = textByMessage.get(String(id)) ?? [];
    const attachmentParts = attachmentsByMessage.get(String(id)) ?? [];
    if (parts.length === 0 && attachmentParts.length === 0) {
      diagnostics.skipped += 1;
      continue;
    }
    let text = parts.map(part => part.text).join('\n');
    const truncated = text.length > LIMITS.TEXT_MAX_CHARS;
    if (text.length > LIMITS.TEXT_MAX_CHARS) {
      text = text.slice(0, LIMITS.TEXT_MAX_CHARS);
      diagnostics.truncated += 1;
    }

    const time = dataTime(data, row);
    const parentId = firstDefined(data.parentID, data.parentId, row.parent_id, row.parentId);
    const role = String(firstDefined(data.role, row.role, 'unknown'));
    if (!['user', 'assistant'].includes(role)) {
      diagnostics.skipped += 1;
      continue;
    }
    parsed.push({
      id: String(id),
      nativeSessionId: String(nativeSessionId),
      sortTime: numericTime(time),
      time,
      role,
      parentId: parentId ? String(parentId) : null,
      model: modelName(data, row),
      contentType: parts.length === 0 ? 'attachment' : parts.every(part => part.type === 'subtask') ? 'subtask' : 'text',
      text,
      parts,
      attachmentParts,
      data,
      truncated,
    });
  }

  parsed.sort(compareTimed);
  const sequenceBySession = new Map();
  const sequenced = parsed.map(item => {
    const sequence = sequenceBySession.get(item.nativeSessionId) ?? 0;
    sequenceBySession.set(item.nativeSessionId, sequence + 1);
    return { item, sequence };
  });
  const keysByNativeId = new Map();
  for (const { item, sequence } of sequenced) {
    if (!keysByNativeId.has(item.id)) keysByNativeId.set(item.id, messageKey(PROVIDER, item.id, sourcePath, sequence));
  }
  const messages = [];
  const attachments = [];
  for (const { item, sequence } of sequenced) {
    const ownMessageKey = messageKey(PROVIDER, item.id, sourcePath, sequence);
    messages.push({
      messageKey: ownMessageKey,
      sessionKey: sessionKey(PROVIDER, item.nativeSessionId, sourcePath),
      nativeId: item.id,
      parentMessageKey: item.parentId ? keysByNativeId.get(item.parentId) ?? null : null,
      sequence,
      timestamp: timestamp(item.time),
      role: item.role,
      contentType: item.contentType,
      text: item.text,
      sourcePath,
      sourceLocator: `message:${item.id}`,
      model: item.model,
      metadata: compactObject([
        ['agent', item.data.agent],
        ['mode', item.data.mode],
        ['providerId', providerId(item.data)],
        ['partIds', [...item.parts, ...item.attachmentParts].map(part => String(part.id))],
        ['truncated', item.truncated || undefined],
      ]),
    });
    for (const [ordinal, attachment] of item.attachmentParts.entries()) {
      attachments.push({
        attachmentKey: attachmentKey(PROVIDER, item.id, sourcePath, attachment.id),
        messageKey: ownMessageKey,
        sessionKey: sessionKey(PROVIDER, item.nativeSessionId, sourcePath),
        provider: PROVIDER,
        nativeId: attachment.id,
        ordinal,
        kind: attachment.mime.startsWith('image/') ? 'image' : 'file',
        mime: attachment.mime,
        byteLength: attachment.byteLength,
        sha256: attachment.sha256,
        sourcePath,
        locator: {
          partId: attachment.id,
          messageId: attachment.messageId,
          sessionId: attachment.sessionId,
        },
        metadata: attachment.name ? { name: String(attachment.name) } : {},
      });
    }
  }
  return { messages, attachments };
}

function normalizeSessions(rows, messages, sourcePath, diagnostics) {
  const modelBySession = new Map();
  for (const message of messages) {
    if (message.model) modelBySession.set(message.sessionKey, message.model);
  }

  const sessions = [];
  for (const row of rows) {
    const id = firstDefined(row.id, row.session_id, row.sessionId);
    if (!id) {
      diagnostics.skipped += 1;
      continue;
    }
    const nativeId = String(id);
    const key = sessionKey(PROVIDER, nativeId, sourcePath);
    const parentId = firstDefined(row.parent_id, row.parentId);
    const cwd = firstDefined(row.directory, row.cwd, row.path) ?? null;
    const created = firstDefined(row.time_created, row.created_at, row.createdAt);
    const updated = firstDefined(row.time_updated, row.updated_at, row.updatedAt, created);
    const archivedValue = firstDefined(row.time_archived, row.archived, false);
    const summary = typeof row.summary === 'string'
      ? row.summary
      : firstDefined(row.summary_text, row.summaryText) ?? null;

    sessions.push({
      sessionKey: key,
      provider: PROVIDER,
      nativeId,
      sourcePath,
      parentSessionKey: parentId ? sessionKey(PROVIDER, String(parentId), sourcePath) : null,
      title: firstDefined(row.title, row.slug) ?? null,
      summary,
      project: firstDefined(row.project, row.project_id, row.projectId) ?? null,
      cwd,
      gitBranch: firstDefined(row.git_branch, row.gitBranch, row.branch) ?? null,
      model: modelName(null, row) ?? modelBySession.get(key) ?? null,
      createdAt: timestamp(created),
      updatedAt: timestamp(updated),
      sourceUpdatedAt: timestamp(updated),
      archived: isArchived(archivedValue),
      resume: { command: 'opencode', args: ['--session', nativeId], cwd },
      metadata: compactObject([
        ['projectId', firstDefined(row.project_id, row.projectId)],
        ['slug', row.slug],
        ['version', row.version],
        ['shareUrl', firstDefined(row.share_url, row.shareUrl)],
      ]),
      sortTime: numericTime(created),
      id: nativeId,
    });
  }
  sessions.sort(compareTimed);
  return sessions.map(({ sortTime, id, ...session }) => session);
}

function read(descriptorValue) {
  const sourcePath = typeof descriptorValue === 'string' ? descriptorValue : descriptorValue?.path;
  if (!sourcePath) throw new TypeError('OpenCode source descriptor must include a database path');

  let db;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true });
  } catch (error) {
    throw new Error(
      `Unable to open OpenCode database "${sourcePath}" read-only: ${error.message}. Check OPENCODE_DB and file permissions.`,
      { cause: error },
    );
  }

  try {
    const diagnostics = emptyDiagnostics();
    const rows = readRows(db, sourcePath);
    const knownSessions = new Set(
      rows.sessions.map(row => firstDefined(row.id, row.session_id, row.sessionId)).filter(Boolean).map(String),
    );
    const { textByMessage, attachmentsByMessage } = normalizeParts(rows.parts, diagnostics);
    const normalized = normalizeMessages(
      rows.messages,
      textByMessage,
      attachmentsByMessage,
      knownSessions,
      sourcePath,
      diagnostics,
    );
    const sessions = normalizeSessions(rows.sessions, normalized.messages, sourcePath, diagnostics);
    return { sessions, messages: normalized.messages, attachments: normalized.attachments, diagnostics };
  } finally {
    db.close();
  }
}

function readAttachment(attachment) {
  const db = new DatabaseSync(attachment.sourcePath, { readOnly: true });
  try {
    const row = db.prepare('SELECT message_id, session_id, data FROM part WHERE id = ?').get(attachment.locator.partId);
    if (!row) return null;
    if (String(row.message_id) !== String(attachment.locator.messageId)) return null;
    if (attachment.locator.sessionId && String(row.session_id) !== String(attachment.locator.sessionId)) return null;
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      return null;
    }
    if (data.type !== 'file') return null;
    return decodeDataUrl(data.url);
  } finally {
    db.close();
  }
}

export const opencodeAdapter = Object.freeze({ provider: PROVIDER, discover, read, readAttachment });
