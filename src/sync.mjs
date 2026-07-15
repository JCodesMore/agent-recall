import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { APP, REFRESH } from './config.mjs';
import { stableId } from './model/ids.mjs';
import { redactRecord, redactText, redactValue } from './privacy/redactor.mjs';
import { adaptersFor } from './sources/registry.mjs';
import { openDatabase, withTransaction } from './storage/database.mjs';

const INSERT_SOURCE = `
  INSERT INTO sources(source_path, provider, signature, indexed_at, diagnostics_json)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(source_path) DO UPDATE SET
    provider=excluded.provider,
    signature=excluded.signature,
    indexed_at=excluded.indexed_at,
    diagnostics_json=excluded.diagnostics_json
`;

const INSERT_SESSION = `
  INSERT INTO sessions(
    session_key, provider, native_id, source_path, parent_session_key, title, summary,
    project, cwd, git_branch, model, created_at, updated_at, source_updated_at,
    archived, message_count, resume_json, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_MESSAGE = `
  INSERT INTO messages(
    message_key, session_key, native_id, parent_message_key, sequence, timestamp,
    role, content_type, text, source_path, source_locator, model, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_ATTACHMENT = `
  INSERT INTO attachments(
    attachment_key, message_key, session_key, provider, native_id, ordinal,
    kind, mime, byte_length, source_path, locator_json, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const AUTO_SYNC_LEASE_KEY = 'auto_sync_lease';

function safeJson(value) {
  return JSON.stringify(value ?? {});
}

function safeMetadataText(value) {
  if (!value) return null;
  return redactText(String(value)).text;
}

function replaceSource(db, descriptor, parsed, indexedAt) {
  const insertSource = db.prepare(INSERT_SOURCE);
  const insertSession = db.prepare(INSERT_SESSION);
  const insertMessage = db.prepare(INSERT_MESSAGE);
  const insertAttachment = db.prepare(INSERT_ATTACHMENT);

  withTransaction(db, () => {
    db.prepare('DELETE FROM sources WHERE source_path = ?').run(descriptor.path);
    insertSource.run(
      descriptor.path,
      descriptor.provider,
      descriptor.signature,
      indexedAt,
      safeJson(parsed.diagnostics),
    );

    const counts = new Map();
    for (const message of parsed.messages) {
      counts.set(message.sessionKey, (counts.get(message.sessionKey) || 0) + 1);
    }

    for (const session of parsed.sessions) {
      insertSession.run(
        session.sessionKey,
        session.provider,
        session.nativeId,
        descriptor.path,
        session.parentSessionKey ?? null,
        safeMetadataText(session.title),
        safeMetadataText(session.summary),
        safeMetadataText(session.project),
        session.cwd ?? null,
        safeMetadataText(session.gitBranch),
        safeMetadataText(session.model),
        session.createdAt ?? null,
        session.updatedAt ?? null,
        session.sourceUpdatedAt ?? null,
        session.archived ? 1 : 0,
        counts.get(session.sessionKey) || 0,
        safeJson(session.resume),
        safeJson(redactValue(session.metadata)),
      );
    }

    for (const rawMessage of parsed.messages) {
      const message = redactRecord(rawMessage);
      insertMessage.run(
        message.messageKey,
        message.sessionKey,
        message.nativeId ?? null,
        message.parentMessageKey ?? null,
        message.sequence,
        message.timestamp ?? null,
        message.role,
        message.contentType,
        message.text,
        descriptor.path,
        message.sourceLocator ?? null,
        safeMetadataText(message.model),
        safeJson(redactValue(message.metadata)),
      );
    }

    for (const attachment of parsed.attachments || []) {
      insertAttachment.run(
        attachment.attachmentKey,
        attachment.messageKey,
        attachment.sessionKey,
        attachment.provider,
        attachment.nativeId,
        attachment.ordinal,
        attachment.kind,
        attachment.mime,
        attachment.byteLength,
        descriptor.path,
        safeJson(attachment.locator),
        safeJson(attachment.metadata),
      );
    }
  });
}

function removeMissingSources(db, provider, discovered) {
  const existing = db.prepare('SELECT source_path FROM sources WHERE provider = ?').all(provider);
  const missing = existing.filter(row => !discovered.has(row.source_path));
  if (missing.length === 0) return 0;
  withTransaction(db, () => {
    const remove = db.prepare('DELETE FROM sources WHERE source_path = ?');
    for (const row of missing) remove.run(row.source_path);
  });
  return missing.length;
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function claimStaleSync(db, now, maxAgeMs) {
  return withTransaction(db, () => {
    const lastSyncAt = db.prepare('SELECT value FROM metadata WHERE key = ?').get('last_sync_at')?.value ?? null;
    const lastSyncTime = Date.parse(lastSyncAt);
    if (Number.isFinite(lastSyncTime) && now - lastSyncTime < maxAgeMs) {
      return { claimed: false, reason: 'fresh', lastSyncAt };
    }

    const leaseRow = db.prepare('SELECT value FROM metadata WHERE key = ?').get(AUTO_SYNC_LEASE_KEY);
    const lease = parseJson(leaseRow?.value);
    if (Number.isFinite(Date.parse(lease?.expiresAt)) && Date.parse(lease.expiresAt) > now) {
      return { claimed: false, reason: 'in-progress', lastSyncAt };
    }

    const token = randomUUID();
    const value = JSON.stringify({
      token,
      expiresAt: new Date(now + REFRESH.AUTO_SYNC_LEASE_MS).toISOString(),
    });
    db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)').run(AUTO_SYNC_LEASE_KEY, value);
    return { claimed: true, token, value, lastSyncAt };
  });
}

export async function syncIfStale({
  maxAgeMs = REFRESH.AUTO_SYNC_MAX_AGE_MS,
  now = Date.now(),
  db: providedDb,
  ...syncOptions
} = {}) {
  const db = providedDb || await openDatabase();
  const ownsDb = !providedDb;
  const claim = claimStaleSync(db, now, maxAgeMs);
  try {
    if (!claim.claimed) {
      return {
        schemaVersion: APP.CLI_SCHEMA_VERSION,
        refreshed: false,
        reason: claim.reason,
        lastSyncAt: claim.lastSyncAt,
      };
    }
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      refreshed: true,
      previousSyncAt: claim.lastSyncAt,
      sync: await syncHistory({ ...syncOptions, db }),
    };
  } finally {
    if (claim.claimed) {
      db.prepare('DELETE FROM metadata WHERE key = ? AND value = ?').run(AUTO_SYNC_LEASE_KEY, claim.value);
    }
    if (ownsDb) db.close();
  }
}

export async function syncHistory({ providers, roots = {}, force = false, db: providedDb } = {}) {
  const db = providedDb || await openDatabase();
  const ownsDb = !providedDb;
  const stats = {
    schemaVersion: APP.CLI_SCHEMA_VERSION,
    ok: true,
    indexed: 0,
    skipped: 0,
    removed: 0,
    sessions: 0,
    messages: 0,
    attachments: 0,
    redactions: 0,
    errors: [],
    providers: {},
  };

  try {
    for (const adapter of adaptersFor(providers)) {
      const providerStats = { discovered: 0, indexed: 0, skipped: 0, removed: 0, errors: 0 };
      stats.providers[adapter.provider] = providerStats;
      let descriptors;
      try {
        descriptors = await adapter.discover(roots[adapter.provider] || {});
      } catch (error) {
        providerStats.errors += 1;
        stats.errors.push({
          provider: adapter.provider,
          kind: 'source-discovery-failed',
          message: 'Source discovery failed; run agent-recall doctor for local diagnostics.',
        });
        continue;
      }
      providerStats.discovered = descriptors.length;
      const discovered = new Set(descriptors.map(item => item.path));
      providerStats.removed = removeMissingSources(db, adapter.provider, discovered);
      stats.removed += providerStats.removed;

      const signatureQuery = db.prepare('SELECT signature FROM sources WHERE source_path = ?');
      for (const descriptor of descriptors) {
        const indexedDescriptor = {
          ...descriptor,
          signature: `${descriptor.signature}:policy=${APP.INDEX_POLICY_VERSION}`,
        };
        const previous = signatureQuery.get(descriptor.path);
        if (!force && previous?.signature === indexedDescriptor.signature) {
          providerStats.skipped += 1;
          stats.skipped += 1;
          continue;
        }
        try {
          const parsed = await adapter.read(descriptor);
          replaceSource(db, indexedDescriptor, parsed, new Date().toISOString());
          providerStats.indexed += 1;
          stats.indexed += 1;
        } catch (error) {
          providerStats.errors += 1;
          stats.errors.push({
            provider: adapter.provider,
            source: path.basename(descriptor.path),
            sourceId: stableId(descriptor.path).slice(0, 12),
            kind: 'source-index-failed',
            message: 'Source could not be indexed; inspect the source locally or run agent-recall doctor.',
          });
        }
      }
    }

    const counts = db.prepare(`
      SELECT
        (SELECT count(*) FROM sessions) AS sessions,
        (SELECT count(*) FROM messages) AS messages,
        (SELECT count(*) FROM attachments) AS attachments,
        (SELECT coalesce(sum(json_extract(metadata_json, '$.privacy.redactions')), 0) FROM messages) AS redactions
    `).get();
    stats.sessions = Number(counts.sessions);
    stats.messages = Number(counts.messages);
    stats.attachments = Number(counts.attachments);
    stats.redactions = Number(counts.redactions);
    stats.ok = stats.errors.length === 0;
    db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)').run(
      'last_sync_at',
      new Date().toISOString(),
    );
    if ((!providers || providers.length === 0) && stats.errors.length === 0) {
      db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)').run(
        'index_policy_version',
        APP.INDEX_POLICY_VERSION,
      );
    }
    return stats;
  } finally {
    if (ownsDb) db.close();
  }
}
