#!/usr/bin/env node
import { acquireLock, releaseLock } from '../src/indexer/lock.mjs';
import { buildDelta } from '../src/indexer/delta.mjs';
import { INDEXER } from '../src/config.mjs';

const got = await acquireLock();
if (!got) process.exit(0);

const watchdog = setTimeout(() => {
  releaseLock().finally(() => process.exit(1));
}, INDEXER.TIMEOUT_MS);
watchdog.unref();

try {
  await buildDelta({});
} catch (err) {
  process.stderr.write(`claude-search background indexer failed: ${err.message}\n`);
} finally {
  clearTimeout(watchdog);
  await releaseLock();
}
process.exit(0);
