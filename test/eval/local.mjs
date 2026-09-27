// Private benchmark against this machine's real history: `npm run eval:local`.
// Cases live outside the repository (they describe real conversations):
//   AGENT_RECALL_LOCAL_EVAL=<file>, default <data home>/local-eval.json
//   [{ "query": "...", "expect": ["<native id>", ...], "cwd": "...", "note": "..." }]
// With AGENT_RECALL_V0=<path to v0 scripts/recall.mjs>, the same queries run through v0 too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from '../../src/shared/paths.mjs';
import * as recall from '../../src/recall.mjs';

const file = process.env.AGENT_RECALL_LOCAL_EVAL ?? path.join(dataHome(), 'local-eval.json');
if (!fs.existsSync(file)) {
  console.log(`No local cases at ${file}; nothing to run.`);
  process.exit(0);
}
const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
const matches = (id, expect) => expect.some(target => id === target || id.startsWith(`${target}:`));

function rankOf(ids, expect) {
  const index = ids.findIndex(id => matches(id, expect));
  return index === -1 ? null : index + 1;
}

function v0Rank(item) {
  if (!process.env.AGENT_RECALL_V0) return undefined;
  try {
    const out = execFileSync(process.execPath, [process.env.AGENT_RECALL_V0, 'search', '--json', '--no-sync', '--limit', '50', '--', item.query], { encoding: 'utf8', env: { ...process.env, AGENT_RECALL_HOME: '' } });
    const asker = item.source?.split(':')[1];
    const ids = [...new Set(JSON.parse(out).hits.map(hit => hit.session.nativeId))].filter(id => id !== asker);
    return rankOf(ids, item.expect);
  } catch {
    return null;
  }
}

await recall.sync();
const totals = { v1: { hit1: 0, hit5: 0 }, v0: { hit1: 0, hit5: 0 } };
const misses = [];
for (const item of cases) {
  const started = performance.now();
  // The chat the question was asked in was the running one then, so it is excluded, as it
  // would have been live.
  const asker = item.source?.split(':')[1];
  const result = await recall.search(item.query, { cwd: item.cwd, limit: 10, sync: 'never', exclude: asker ? [asker] : [] });
  const ms = performance.now() - started;
  const rank = rankOf(result.hits.map(hit => hit.id), item.expect);
  const old = v0Rank(item);
  for (const [name, value] of [['v1', rank], ['v0', old]]) {
    if (value === 1) totals[name].hit1 += 1;
    if (value && value <= 5) totals[name].hit5 += 1;
  }
  if (rank !== 1) misses.push(`${item.note ?? item.query}: rank ${rank ?? '-'}; top ${result.hits.slice(0, 3).map(hit => hit.title).join(' | ')}`);
  console.log(`${String(rank ?? '-').padStart(2)} ${old === undefined ? '' : `v0 ${String(old ?? '-').padStart(2)} `}${ms.toFixed(0).padStart(4)}ms  ${item.note ?? item.query}`);
}
const pct = value => (value / cases.length).toFixed(2);
console.log(`\nv1 hit@1 ${pct(totals.v1.hit1)} hit@5 ${pct(totals.v1.hit5)} (${cases.length} cases)`);
if (process.env.AGENT_RECALL_V0) console.log(`v0 hit@1 ${pct(totals.v0.hit1)} hit@5 ${pct(totals.v0.hit5)}`);
for (const miss of misses) console.log(`miss: ${miss}`);
