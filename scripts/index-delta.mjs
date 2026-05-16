#!/usr/bin/env node
import { buildDelta } from '../src/indexer/delta.mjs';

(async () => {
  try {
    const stats = await buildDelta({});
    const out = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `# claude-search index\nLast indexer pass: indexed ${stats.indexed}, skipped ${stats.skipped}, removed ${stats.removed}. ${stats.sessions} sessions across ${stats.docs} messages searchable. Run \`/claude-search:search <query>\` to search.`,
      },
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`claude-search index failed: ${err.message}\n`);
    process.exit(0);
  }
})();
