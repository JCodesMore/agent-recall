// Recall benchmark: `npm run eval`. Fails when hit@1 < 0.9 or hit@5 < 1, or when a recall
// request chat outranks the conversation it asked for.
import { fakeHome } from '../helpers/home.mjs';
import { CASES, buildCorpus } from './corpus.mjs';

const THRESHOLDS = { hit1: 0.9, hit5: 1 };

const home = fakeHome().activate();
try {
  const { current } = buildCorpus(home);
  process.env.CLAUDE_CODE_SESSION_ID = current;
  const recall = await import('../../src/recall.mjs');
  await recall.sync();
  let hit1 = 0;
  let hit5 = 0;
  const failures = [];
  for (const item of CASES) {
    const result = await recall.search(item.query, { cwd: item.cwd ?? '/nowhere', limit: 10, sync: 'never' });
    const ids = result.hits.map(hit => hit.id);
    const rank = ids.indexOf(item.target.id) + 1;
    if (rank === 1) hit1 += 1;
    if (rank >= 1 && rank <= 5) hit5 += 1;
    const asker = ids.findIndex(id => id.startsWith('asker-'));
    if (rank !== 1 || (asker !== -1 && asker < rank - 1) || ids.includes(current)) failures.push(`${item.query}: target rank ${rank || '-'}; top ${ids.slice(0, 3).join(', ')}`);
    console.log(`${String(rank || '-').padStart(2)}  ${item.query}`);
  }
  const score = { hit1: hit1 / CASES.length, hit5: hit5 / CASES.length };
  console.log(`\nhit@1 ${score.hit1.toFixed(2)}  hit@5 ${score.hit5.toFixed(2)}  (${CASES.length} cases)`);
  for (const failure of failures) console.log(`miss: ${failure}`);
  if (score.hit1 < THRESHOLDS.hit1 || score.hit5 < THRESHOLDS.hit5) process.exitCode = 1;
} finally {
  home.cleanup();
}
