#!/usr/bin/env node
import { acquireLock, releaseLock } from '../src/indexer/lock.mjs';
import { buildDelta } from '../src/indexer/delta.mjs';
import { readIndex } from '../src/indexer/inverted.mjs';

function emit(stats) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `# claude-search index\nLast indexer pass: indexed ${stats.indexed}, skipped ${stats.skipped}, removed ${stats.removed}. ${stats.sessions} sessions across ${stats.docs} messages searchable. Run \`/claude-search:search <query>\` to search.`,
    },
  };
  process.stdout.write(JSON.stringify(out));
}

(async () => {
  try {
    const got = await acquireLock();
    if (!got) {
      const idx = await readIndex();
      emit({
        indexed: 0,
        skipped: 0,
        removed: 0,
        docs: idx.docs.length,
        sessions: Object.keys(idx.sessions).length,
      });
      process.exit(0);
    }
    let stats;
    try {
      stats = await buildDelta({});
    } finally {
      await releaseLock();
    }
    emit(stats);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`claude-search index failed: ${err.message}\n`);
    process.exit(0);
  }
})();
