// Synthetic recall benchmark corpus. Each case is a target conversation plus a query shaped
// like a real v0 failure; the corpus also holds distractors that caused those failures:
// long noisy sessions, recall-request chats, the calling chat, subagents and forks.

import { claude } from '../helpers/home.mjs';

const FILLER = `refactor component state props render effect hook module export import build lint format test
suite mock fixture assert expect snapshot coverage branch merge rebase commit push pull review comment
deploy staging production config env variable secret token cache queue worker job retry timeout log
metric trace span dashboard alert error warning exception stack handler route middleware request
response header body json schema validate parse serialize database table column index query migration
seed transaction lock pool connection client server socket stream buffer file path folder script
command terminal shell package dependency version upgrade release changelog docs readme guide page
layout style theme color font icon button form input select modal toast menu list grid card chart
user account session auth login logout password email profile settings permission role admin team`
  .split(/\s+/).filter(Boolean);

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function filler(random, words) {
  return Array.from({ length: words }, () => FILLER[Math.floor(random() * FILLER.length)]).join(' ');
}

// A long, generic session that matches common words everywhere (v0's top false positive).
function noisySession(random, index) {
  const records = [];
  for (let turn = 0; turn < 40; turn += 1) {
    records.push(claude.user(`${filler(random, 30)}`, turn * 2), claude.assistant(filler(random, 120), turn * 2 + 1));
  }
  return { id: `noise-${index}`, cwd: `/work/app-${index % 7}`, records };
}

const t = (text, minute) => claude.user(text, minute);
const a = (text, minute) => claude.assistant(text, minute);

export const CASES = [
  {
    query: 'bedrock credits startup program',
    target: { id: 'bedrock', cwd: '/work/cloud', records: [t('Can we get AWS Bedrock credits through the startup program?', 1), a('Apply to AWS Activate; credits apply to Bedrock usage.', 2)] },
  },
  {
    query: 'stripe webhook retries backoff',
    target: { id: 'webhook', cwd: '/work/shop', records: [t('The stripe webhook handler times out under load', 1), a('Moved work to a queue.', 2), t('add retries with exponential backoff too', 3), a('Done with jitter.', 4)] },
  },
  {
    query: 'invoice.test.ts totalCents',
    target: { id: 'vitest', cwd: '/work/billing', records: [t('run the billing tests', 1), a([claude.toolUse('v1', 'Bash', { command: 'pnpm vitest run src/billing/invoice.test.ts' })], 2), claude.toolResult('v1', 'TypeError: Cannot read properties of undefined (reading totalCents)', 3), a('Guarded the undefined line item.', 4)] },
  },
  {
    query: 'migrating postgres enums',
    target: { id: 'enums', cwd: '/work/db', records: [t('How should we migrate the Postgres enum types without downtime?', 1), a('Create the new enum, migrate columns, then drop the old enum.', 2)] },
  },
  {
    query: 'codex-lb load balancer',
    target: { id: 'codexlb', cwd: '/work/infra', records: [t('set up codex-lb in front of the two gateway nodes', 1), a('codex-lb now round-robins across both nodes.', 2)] },
  },
  {
    query: 'carrier phone trade-in deal',
    target: { id: 'phone', cwd: '/home/notes', records: [t('my brother wants the carrier trade-in deal for a new phone, is it worth it?', 1), a('The trade-in credit is spread over 36 months; compare with selling it outright.', 2)] },
  },
  {
    query: 'Pebblewick coin flip odds',
    target: { id: 'pebble', cwd: '/work/Pebblewick', records: [t('In Pebblewick the coin flip game pays 1.9x', 1), a('House edge is 5% at 1.9x odds for a fair coin.', 2)] },
  },
  {
    query: 'tile cache eviction',
    cwd: '/work/atlas-app',
    target: { id: 'tiles', cwd: '/work/atlas-app-worktree-3', records: [t('tiles flicker when the cache evicts under zoom', 1), a('Switched eviction to LRU keyed by zoom level.', 2)] },
  },
  {
    query: 'refresh token rotation',
    target: {
      id: 'oauth',
      cwd: '/work/auth',
      records: [t('Audit the auth flow', 1), a('Spawning a reviewer agent.', 2)],
      subagent: { id: 'agent-r1', description: 'Review auth client', records: [t('Check oauthClient.ts for token handling', 3), a('The refresh token is never rotated after use.', 4)] },
    },
  },
  {
    query: 'quarterly roadmap',
    target: { id: 'roadmap', cwd: '/work/pm', title: 'Quarterly roadmap', records: [t('help me lay out the next three months', 1), a('Here is a draft by month.', 2)] },
  },
  {
    query: 'ENOSPC watcher limit',
    target: { id: 'enospc', cwd: '/work/web', records: [t('dev server crashes on start', 1), a([claude.toolUse('w1', 'Bash', { command: 'npm run dev' })], 2), claude.toolResult('w1', 'Error: ENOSPC: System limit for number of file watchers reached', 3), a('Raised fs.inotify.max_user_watches.', 4)] },
  },
  {
    query: 'which font did we pick for the landing page headline',
    target: { id: 'font', cwd: '/work/site', records: [t('choose a headline font for the landing page', 1), a('Going with Fraunces for headlines and Inter for body.', 2)] },
  },
];

// Chats that ask for a target: they must rank below it, never above.
export const RECALL_REQUESTS = CASES.slice(0, 6).map((item, index) => ({
  id: `asker-${index}`,
  cwd: item.target.cwd,
  records: [
    t(`find the conversation about ${item.query}`, 1),
    a([claude.toolUse(`r${index}`, 'Bash', { command: `node scripts/recall.mjs search -- ${item.query}` })], 2),
    claude.toolResult(`r${index}`, `1. ${item.query}`, 3),
    a(`Found it: the ${item.query} conversation.`, 4),
  ],
}));

export function buildCorpus(home, { noise = 60, seed = 7 } = {}) {
  const random = rng(seed);
  const write = (session, slug = 'p') => {
    const records = session.records.map(record => (record.type === 'user' && record.cwd ? { ...record, cwd: session.cwd } : record));
    if (session.title) records.push(claude.title(session.title, session.id));
    home.jsonl(`.claude/projects/-${slug}/${session.id}.jsonl`, records);
    if (session.subagent) {
      home.jsonl(`.claude/projects/-${slug}/${session.id}/subagents/${session.subagent.id}.jsonl`, session.subagent.records);
      home.file(`.claude/projects/-${slug}/${session.id}/subagents/${session.subagent.id}.meta.json`, JSON.stringify({ description: session.subagent.description }));
    }
  };
  for (let i = 0; i < noise; i += 1) write(noisySession(random, i), `noise${i % 5}`);
  for (const item of CASES) write(item.target, 'targets');
  for (const asker of RECALL_REQUESTS) write(asker, 'askers');
  // A fork that copies the webhook conversation and continues elsewhere.
  write({ id: 'webhook-fork', cwd: '/work/shop', records: [...CASES[1].target.records, t('now unrelated: rename the css classes', 9)] }, 'targets');
  return { current: 'asker-0' };
}
