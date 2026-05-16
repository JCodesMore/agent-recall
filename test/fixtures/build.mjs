#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'projects');

const PROJECTS = {
  'proj-a': '00000000-0000-0000-0000-000000000001',
  'proj-a2': '00000000-0000-0000-0000-000000000002',
  'proj-b': '00000000-0000-0000-0000-000000000003',
  'proj-c': '00000000-0000-0000-0000-000000000004',
  'proj-d': '00000000-0000-0000-0000-000000000005',
};

const ISO = (offsetMin = 0) => new Date(Date.UTC(2026, 0, 1, 12, offsetMin)).toISOString();

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map(o => JSON.stringify(o)).join('\n') + '\n');
}

const sid = PROJECTS;

writeLines(path.join(ROOT, 'proj-a', `${sid['proj-a']}.jsonl`), [
  { type: 'user', sessionId: sid['proj-a'], uuid: 'u1', parentUuid: null, timestamp: ISO(0), cwd: 'C:\\proj-a',
    message: { role: 'user', content: 'How do I use ripgrep to search recursively?' } },
  { type: 'assistant', sessionId: sid['proj-a'], uuid: 'a1', parentUuid: 'u1', timestamp: ISO(1), cwd: 'C:\\proj-a',
    message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'OPAQUE_ENCRYPTED', signature: 'sig' },
      { type: 'text', text: 'Use `rg pattern` from the project root. Ripgrep recurses by default.' },
    ] } },
  { type: 'user', sessionId: sid['proj-a'], uuid: 'u2', parentUuid: 'a1', timestamp: ISO(2), cwd: 'C:\\proj-a',
    message: { role: 'user', content: 'What about case sensitivity?' } },
  { type: 'assistant', sessionId: sid['proj-a'], uuid: 'a2', parentUuid: 'u2', timestamp: ISO(3), cwd: 'C:\\proj-a',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'Pass `-i` for case-insensitive matching. Smart-case is also available with -S.' },
    ] } },
]);

writeLines(path.join(ROOT, 'proj-a', `${sid['proj-a2']}.jsonl`), [
  { type: 'user', sessionId: sid['proj-a2'], uuid: 'u1', parentUuid: null, timestamp: ISO(10), cwd: 'C:\\proj-a',
    message: { role: 'user', content: 'Run the unit tests.' } },
  { type: 'assistant', sessionId: sid['proj-a2'], uuid: 'a1', parentUuid: 'u1', timestamp: ISO(11), cwd: 'C:\\proj-a',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'Running tests now.' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node --test test/foo.test.mjs', description: 'Run the unit tests' } },
    ] } },
  { type: 'user', sessionId: sid['proj-a2'], uuid: 'u2', parentUuid: 'a1', timestamp: ISO(12), cwd: 'C:\\proj-a',
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'All 12 tests passed.\nDuration: 230ms', is_error: false },
    ] } },
  { type: 'assistant', sessionId: sid['proj-a2'], uuid: 'a2', parentUuid: 'u2', timestamp: ISO(13), cwd: 'C:\\proj-a',
    message: { role: 'assistant', content: [
      { type: 'text', text: 'Tests pass. Twelve green.' },
    ] } },
]);

writeLines(path.join(ROOT, 'proj-b', `${sid['proj-b']}.jsonl`), [
  { type: 'ai-title', sessionId: sid['proj-b'], title: 'Postgres connection pooling investigation', uuid: 't1' },
  { type: 'summary', sessionId: sid['proj-b'], summary: 'Diagnosed pgbouncer pool exhaustion under burst load.', uuid: 's1' },
  { type: 'user', sessionId: sid['proj-b'], uuid: 'u1', parentUuid: null, timestamp: ISO(20), cwd: 'C:\\proj-b',
    message: { role: 'user', content: 'Why does postgres keep rejecting connections during deploy?' } },
  { type: 'assistant', sessionId: sid['proj-b'], uuid: 'a1', parentUuid: 'u1', timestamp: ISO(21), cwd: 'C:\\proj-b',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Pgbouncer pool max is hit when both old and new pods overlap during rolling deploys. Increase max_client_conn or stagger the rollout.' }] } },
  { type: 'attachment', sessionId: sid['proj-b'], uuid: 'at1', parentUuid: 'a1', timestamp: ISO(22), cwd: 'C:\\proj-b',
    attachment: { type: 'hook_success', content: '', stdout: 'deployment.log: max connections reached at 12:04:11', stderr: '' } },
]);

writeLines(
  path.join(ROOT, 'proj-b', sid['proj-b'], 'subagents', 'agent-research.jsonl'),
  [
    { type: 'user', sessionId: sid['proj-b'], uuid: 'su1', parentUuid: null, timestamp: ISO(23), cwd: 'C:\\proj-b', isSidechain: true,
      message: { role: 'user', content: 'Research pgbouncer pool_mode options.' } },
    { type: 'assistant', sessionId: sid['proj-b'], uuid: 'sa1', parentUuid: 'su1', timestamp: ISO(24), cwd: 'C:\\proj-b', isSidechain: true,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Session pooling holds the connection for the lifetime of the client session. Transaction pooling releases after each transaction.' }] } },
  ]
);

writeLines(
  path.join(ROOT, 'proj-c', sid['proj-c'], 'subagents', 'agent-orphan.jsonl'),
  [
    { type: 'user', sessionId: sid['proj-c'], uuid: 'cu1', parentUuid: null, timestamp: ISO(30), cwd: 'C:\\proj-c', isSidechain: true,
      message: { role: 'user', content: 'Subdir-only session: investigate the cache miss anomaly.' } },
    { type: 'assistant', sessionId: sid['proj-c'], uuid: 'ca1', parentUuid: 'cu1', timestamp: ISO(31), cwd: 'C:\\proj-c', isSidechain: true,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Cache miss spike correlates with deploy timestamp.' }] } },
  ]
);

writeLines(path.join(ROOT, 'proj-d', `${sid['proj-d']}.jsonl`), [
  { type: 'user', sessionId: sid['proj-d'], uuid: 'du1', parentUuid: null, timestamp: ISO(40), cwd: 'C:\\proj-d',
    message: { role: 'user', content: 'Emoji search: 🚀 rocket and 日本語 text and €uros.' } },
  { type: 'assistant', sessionId: sid['proj-d'], uuid: 'da1', parentUuid: 'du1', timestamp: ISO(41), cwd: 'C:\\proj-d',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Unicode round-trips fine — 🚀, 日本語, €.' }] } },
]);

console.log('Fixtures built under', ROOT);
