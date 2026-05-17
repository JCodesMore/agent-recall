import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, releaseLock } from '../src/indexer/lock.mjs';
import { INDEX_FILES } from '../src/config.mjs';

let TMP;

before(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-search-lock-test-'));
  process.env.CLAUDE_SEARCH_HOME = TMP;
});

after(async () => {
  delete process.env.CLAUDE_SEARCH_HOME;
  await fs.rm(TMP, { recursive: true, force: true });
});

afterEach(async () => {
  await releaseLock();
});

test('acquireLock succeeds when no lock exists', async () => {
  assert.equal(await acquireLock(), true);
});

test('second acquireLock returns false while first is held', async () => {
  assert.equal(await acquireLock(), true);
  assert.equal(await acquireLock(), false);
});

test('acquireLock succeeds again after releaseLock', async () => {
  assert.equal(await acquireLock(), true);
  await releaseLock();
  assert.equal(await acquireLock(), true);
});

test('acquireLock cleans up a lock held by a dead PID and takes it', async () => {
  const lockFile = path.join(TMP, INDEX_FILES.LOCK);
  await fs.writeFile(lockFile, '99999999');
  assert.equal(await acquireLock(), true);
  const content = await fs.readFile(lockFile, 'utf8');
  assert.equal(parseInt(content.trim(), 10), process.pid);
});

test('releaseLock is a no-op when no lock file exists', async () => {
  await releaseLock();
  await releaseLock();
});
