import { ACTIVITY } from './config.mjs';
import { openDatabase } from './storage/database.mjs';

function ageMs(timestamp, now) {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? Math.max(0, now - value) : Number.POSITIVE_INFINITY;
}

export function classifyActivity(session, event, now = Date.now()) {
  if (session.archived) {
    return { state: 'inactive', confidence: 1, observedAt: session.updated_at, reasons: ['archived'] };
  }
  if (event) {
    const eventAge = ageMs(event.observed_at, now);
    const sourceTime = new Date(session.source_updated_at || session.updated_at || 0).getTime();
    const eventTime = new Date(event.observed_at || 0).getTime();
    if (event.event === 'stop' && eventTime >= sourceTime) {
      return { state: 'inactive', confidence: 0.98, observedAt: event.observed_at, reasons: ['explicit-stop'] };
    }
    if (eventAge <= ACTIVITY.EXPLICIT_ACTIVE_TTL_MS && ['start', 'prompt'].includes(event.event)) {
      return { state: 'active', confidence: 0.95, observedAt: event.observed_at, reasons: [`explicit-${event.event}`] };
    }
  }
  const age = ageMs(session.source_updated_at || session.updated_at, now);
  if (age <= ACTIVITY.PROBABLY_ACTIVE_MS) {
    return {
      state: 'probably-active',
      confidence: 0.45,
      observedAt: session.source_updated_at || session.updated_at,
      reasons: ['recent-source-write', 'no-lifecycle-signal'],
    };
  }
  if (age <= ACTIVITY.RECENT_MS) {
    return {
      state: 'recent',
      confidence: 0.8,
      observedAt: session.source_updated_at || session.updated_at,
      reasons: ['updated-within-24h'],
    };
  }
  return {
    state: 'unknown',
    confidence: 0,
    observedAt: session.source_updated_at || session.updated_at || null,
    reasons: ['no-live-signal'],
  };
}

export function latestActivityEvent(db, provider, nativeId) {
  return db.prepare(`
    SELECT event, observed_at
    FROM activity_events
    WHERE provider = ? AND native_session_id = ?
    ORDER BY observed_at DESC LIMIT 1
  `).get(provider, nativeId);
}

export async function recordActivity(provider, nativeSessionId, event, metadata = {}, options = {}) {
  if (!provider || !nativeSessionId || !['start', 'prompt', 'stop'].includes(event)) return false;
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  try {
    db.prepare(`
      INSERT INTO activity_events(provider, native_session_id, event, observed_at, metadata_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(provider, nativeSessionId, event, new Date().toISOString(), JSON.stringify(metadata));
    return true;
  } finally {
    if (ownsDb) db.close();
  }
}
