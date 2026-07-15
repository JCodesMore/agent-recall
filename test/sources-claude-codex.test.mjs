import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { LIMITS } from '../src/config.mjs';
import { parseDataUrl } from '../src/model/attachments.mjs';
import { claudeAdapter } from '../src/sources/claude.mjs';
import { codexAdapter } from '../src/sources/codex.mjs';

let temporaryRoot;
const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function jsonl(records) {
  return records.map(record => typeof record === 'string' ? record : JSON.stringify(record)).join('\n') + '\n';
}

async function writeJsonl(file, records) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, jsonl(records));
}

before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recall-sources-'));
});

after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('Claude discovers main and subagent sessions and reads only conversational text', async () => {
  const root = path.join(temporaryRoot, 'claude');
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const mainFile = path.join(root, 'project-one', `${sessionId}.jsonl`);
  const subagentFile = path.join(root, 'project-one', sessionId, 'subagents', 'agent-research.jsonl');
  await writeJsonl(mainFile, [
    { type: 'ai-title', sessionId, title: 'Synthetic title' },
    { type: 'summary', sessionId, summary: 'Synthetic summary' },
    { type: 'user', sessionId, uuid: 'claude-user-1', timestamp: '2026-01-01T00:00:00Z', cwd: 'C:\\work\\project-one', gitBranch: 'main', message: { role: 'user', content: 'Real user text.<system-reminder>injected</system-reminder>' } },
    '{ definitely malformed',
    { type: 'assistant', sessionId, uuid: 'claude-assistant-1', parentUuid: 'claude-user-1', timestamp: '2026-01-01T00:01:00Z', message: { role: 'assistant', model: 'claude-test', content: [
      { type: 'thinking', thinking: 'secret thought' },
      { type: 'text', text: 'Visible assistant text.' },
      { type: 'tool_use', name: 'Bash', input: { command: 'secret command' } },
    ] } },
    { type: 'user', sessionId, timestamp: '2026-01-01T00:02:00Z', message: { role: 'user', content: [
      { type: 'text', text: 'Array user text.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_DATA } },
      { type: 'tool_result', content: 'secret tool result' },
    ] } },
    { type: 'system', message: { role: 'system', content: 'secret system prompt' } },
    { type: 'assistant', sessionId, uuid: 'long-message', timestamp: '2026-01-01T00:03:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(LIMITS.TEXT_MAX_CHARS + 1) }] } },
  ]);
  await writeJsonl(subagentFile, [
    { type: 'user', sessionId, uuid: 'sub-user', timestamp: '2026-01-01T00:04:00Z', cwd: 'C:\\work\\project-one', isSidechain: true, message: { role: 'user', content: 'Research this.' } },
    { type: 'assistant', sessionId, uuid: 'sub-assistant', timestamp: '2026-01-01T00:05:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Research result.' }] } },
  ]);

  const descriptors = await claudeAdapter.discover({ root });
  assert.equal(descriptors.length, 2);
  assert.ok(descriptors.every(descriptor => descriptor.provider === 'claude' && descriptor.signature));

  const mainDescriptor = descriptors.find(descriptor => !descriptor.metadata.isSubagent);
  const result = await claudeAdapter.read(mainDescriptor);
  assert.match(result.sessions[0].sessionKey, new RegExp(`^claude:${sessionId}:`));
  assert.equal(result.sessions[0].title, 'Synthetic title');
  assert.equal(result.sessions[0].summary, 'Synthetic summary');
  assert.equal(result.sessions[0].project, 'project-one');
  assert.equal(result.sessions[0].metadata.project, undefined);
  assert.equal(result.sessions[0].cwd, 'C:\\work\\project-one');
  assert.equal(result.sessions[0].gitBranch, 'main');
  assert.equal(result.sessions[0].model, 'claude-test');
  assert.deepEqual(result.sessions[0].resume, { command: 'claude', args: ['--resume', sessionId], cwd: 'C:\\work\\project-one' });
  assert.match(result.messages[0].messageKey, /^claude:claude-user-1:/);
  assert.equal(result.messages[1].parentMessageKey, result.messages[0].messageKey);
  assert.match(result.messages[2].messageKey, /^claude:generated:/);
  assert.deepEqual(result.messages.map(message => message.sequence), [0, 1, 2, 3]);
  const combined = result.messages.map(message => message.text).join('\n');
  assert.match(combined, /Real user text/);
  assert.match(combined, /Visible assistant text/);
  assert.match(combined, /Array user text/);
  assert.doesNotMatch(combined, /injected|secret thought|secret command|secret tool result|secret system prompt/);
  assert.equal(result.messages[3].text.length, LIMITS.TEXT_MAX_CHARS);
  assert.equal(result.diagnostics.malformed, 1);
  assert.equal(result.diagnostics.truncated, 1);
  assert.ok(result.diagnostics.skipped >= 1);
  assert.equal(result.attachments.length, 1);
  assert.deepEqual((await claudeAdapter.readAttachment(result.attachments[0])).data, Buffer.from(PNG_DATA, 'base64'));

  const subResult = await claudeAdapter.read(descriptors.find(descriptor => descriptor.metadata.isSubagent));
  assert.equal(subResult.sessions[0].nativeId, `${sessionId}:subagent:agent-research`);
  assert.equal(subResult.sessions[0].parentSessionKey, result.sessions[0].sessionKey);
  assert.equal(subResult.sessions[0].metadata.isSubagent, true);
  assert.deepEqual(subResult.sessions[0].resume.args, ['--resume', sessionId]);
  assert.ok(subResult.messages.every(message => message.sessionKey === subResult.sessions[0].sessionKey));
});

test('Codex prefers response items, captures context, and discovers archives', async () => {
  const sessionsRoot = path.join(temporaryRoot, 'codex', 'sessions');
  const archiveRoot = path.join(temporaryRoot, 'codex', 'archived_sessions');
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const activeFile = path.join(sessionsRoot, '2026', '07', `rollout-2026-07-14-${sessionId}.jsonl`);
  const archivedId = '33333333-3333-4333-8333-333333333333';
  const archivedFile = path.join(archiveRoot, `rollout-${archivedId}.jsonl`);
  await writeJsonl(activeFile, [
    { timestamp: '2026-07-14T10:00:00Z', type: 'session_meta', payload: { id: sessionId, cwd: 'C:\\repo\\active', originator: 'codex_cli_rs', cli_version: '1.2.3', git: { branch: 'feature/test' } } },
    { timestamp: '2026-07-14T10:00:01Z', type: 'turn_context', payload: { cwd: 'C:\\repo\\active', model: 'gpt-test' } },
    { timestamp: '2026-07-14T10:00:02Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'secret system prompt' }] } },
    { timestamp: '2026-07-14T10:00:02.500Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<codex_internal_context source="goal">injected goal</codex_internal_context>' }] } },
    { timestamp: '2026-07-14T10:00:03Z', type: 'response_item', payload: { type: 'message', role: 'user', id: 'codex-user', content: [
      { type: 'input_text', text: '<environment_context>injected</environment_context>Actual request.' },
      { type: 'input_image', image_url: `data:image/png;base64,${PNG_DATA}` },
    ] } },
    { timestamp: '2026-07-14T10:00:03.250Z', type: 'event_msg', payload: { type: 'user_message', message: 'Actual request.' } },
    '{ bad json',
    { timestamp: '2026-07-14T10:00:04Z', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'secret reasoning' }] } },
    { timestamp: '2026-07-14T10:00:05Z', type: 'response_item', payload: { type: 'message', role: 'assistant', id: 'codex-assistant', parent_id: 'codex-user', content: [{ type: 'output_text', text: 'Actual answer.' }, { type: 'reasoning', text: 'secret thought' }] } },
    { timestamp: '2026-07-14T10:00:05.500Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Actual answer.' } },
    { timestamp: '2026-07-14T10:00:06Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"secret tool"}' } },
    { timestamp: '2026-07-14T10:00:07Z', type: 'event_msg', payload: { type: 'agent_message', id: 'event-only', message: 'Event-only follow-up.' } },
  ]);
  await writeJsonl(archivedFile, [
    { timestamp: '2026-07-13T09:00:00Z', type: 'session_meta', payload: { cwd: '/tmp/archive' } },
    { timestamp: '2026-07-13T09:00:01Z', type: 'event_msg', payload: { type: 'user_message', id: 'fallback-user', message: 'Fallback question.' } },
    { timestamp: '2026-07-13T09:00:02Z', type: 'event_msg', payload: { type: 'agent_reasoning', message: 'secret fallback reasoning' } },
    { timestamp: '2026-07-13T09:00:03Z', type: 'event_msg', payload: { type: 'agent_message', id: 'fallback-assistant', message: 'Fallback answer.' } },
  ]);

  const descriptors = await codexAdapter.discover({ root: sessionsRoot, archiveRoot });
  assert.equal(descriptors.length, 2);
  assert.ok(descriptors.every(descriptor => descriptor.provider === 'codex' && descriptor.signature));
  assert.equal(descriptors.filter(descriptor => descriptor.metadata.archived).length, 1);

  const activeResult = await codexAdapter.read(descriptors.find(descriptor => !descriptor.metadata.archived));
  assert.match(activeResult.sessions[0].sessionKey, new RegExp(`^codex:${sessionId}:`));
  assert.equal(activeResult.sessions[0].cwd, 'C:\\repo\\active');
  assert.equal(activeResult.sessions[0].gitBranch, 'feature/test');
  assert.equal(activeResult.sessions[0].model, 'gpt-test');
  assert.equal(activeResult.sessions[0].archived, false);
  assert.deepEqual(activeResult.sessions[0].resume, { command: 'codex', args: ['resume', sessionId], cwd: 'C:\\repo\\active' });
  assert.deepEqual(activeResult.messages.map(message => message.text), ['Actual request.', 'Actual answer.', 'Event-only follow-up.']);
  assert.ok(activeResult.messages[0].messageKey.startsWith('codex:codex-user:'));
  assert.ok(activeResult.messages[1].messageKey.startsWith('codex:codex-assistant:'));
  assert.equal(activeResult.messages[1].parentMessageKey, activeResult.messages[0].messageKey);
  assert.ok(activeResult.messages.every(message => message.model === 'gpt-test'));
  assert.equal(activeResult.diagnostics.malformed, 1);
  assert.ok(activeResult.diagnostics.skipped >= 3);
  assert.equal(activeResult.attachments.length, 1);
  assert.deepEqual((await codexAdapter.readAttachment(activeResult.attachments[0])).data, Buffer.from(PNG_DATA, 'base64'));
  assert.doesNotMatch(activeResult.messages.map(message => message.text).join('\n'), /secret|injected/);

  const archivedResult = await codexAdapter.read(descriptors.find(descriptor => descriptor.metadata.archived));
  assert.equal(archivedResult.sessions[0].nativeId, archivedId);
  assert.equal(archivedResult.sessions[0].archived, true);
  assert.deepEqual(archivedResult.messages.map(message => message.text), ['Fallback question.', 'Fallback answer.']);
  assert.ok(archivedResult.messages.every(message => message.metadata.fallback));
  assert.doesNotMatch(archivedResult.messages.map(message => message.text).join('\n'), /reasoning/);
});

test('discovery tolerates missing synthetic roots', async () => {
  const missing = path.join(temporaryRoot, 'does-not-exist');
  assert.deepEqual(await claudeAdapter.discover({ root: missing }), []);
  assert.deepEqual(await codexAdapter.discover({ root: missing, archiveRoot: `${missing}-archive` }), []);
});

test('attachment parsing is strict and content-bound keys survive earlier insertions', async () => {
  assert.equal(parseDataUrl('data:application/octet-stream;base64,').byteLength, 0);
  assert.equal(parseDataUrl('data:image/png;charset=utf-8;base64,QUJDRA==').mime, 'image/png');
  assert.equal(parseDataUrl('data:image/png;base64,A==='), null);
  assert.equal(parseDataUrl('data:image/png,QUJDRA=='), null);
  const oversized = 'A'.repeat(Math.ceil(LIMITS.ATTACHMENT_MAX_BYTES / 3) * 4 + 4);
  assert.equal(parseDataUrl(`data:application/octet-stream;base64,${oversized}`), null);

  const source = path.join(temporaryRoot, 'stable-attachment.jsonl');
  const record = images => ({
    type: 'user', uuid: 'stable-message', message: {
      role: 'user',
      content: images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })),
    },
  });
  await writeJsonl(source, [record([PNG_DATA])]);
  const first = await claudeAdapter.read({ path: source, metadata: {} });
  const original = first.attachments[0];
  assert.equal(first.messages[0].text, '');

  await writeJsonl(source, [record([Buffer.from('different').toString('base64'), PNG_DATA])]);
  const second = await claudeAdapter.read({ path: source, metadata: {} });
  const reindexed = second.attachments.find(attachment => attachment.sha256 === original.sha256);
  assert.equal(reindexed.attachmentKey, original.attachmentKey);
  assert.equal(reindexed.ordinal, 1);
});
