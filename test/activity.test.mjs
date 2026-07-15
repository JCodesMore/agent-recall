import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyActivity } from '../src/activity.mjs';

const NOW = new Date('2026-07-15T12:00:00.000Z').getTime();

test('activity uses explicit lifecycle evidence only while it remains current', () => {
  const active = classifyActivity(
    { archived: 0, source_updated_at: '2026-07-15T11:58:00.000Z' },
    { event: 'prompt', observed_at: '2026-07-15T11:59:00.000Z' },
    NOW,
  );
  assert.equal(active.state, 'active');
  assert.equal(active.confidence, 0.95);

  const stopped = classifyActivity(
    { archived: 0, source_updated_at: '2026-07-15T11:58:00.000Z' },
    { event: 'stop', observed_at: '2026-07-15T11:59:00.000Z' },
    NOW,
  );
  assert.equal(stopped.state, 'inactive');
});

test('a source update after a stop event supersedes the stale stop', () => {
  const result = classifyActivity(
    { archived: 0, source_updated_at: '2026-07-15T11:59:30.000Z' },
    { event: 'stop', observed_at: '2026-07-15T11:50:00.000Z' },
    NOW,
  );
  assert.equal(result.state, 'probably-active');
  assert.ok(result.reasons.includes('no-lifecycle-signal'));
});
