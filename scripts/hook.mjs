#!/usr/bin/env node
import { recordActivity } from '../src/activity.mjs';
import { PROVIDERS } from '../src/config.mjs';
import { syncIfStale } from '../src/sync.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return {};
  try { return JSON.parse(input); } catch { return {}; }
}

const event = process.argv[2];
const input = await readStdin();
const nativeSessionId = process.env.CLAUDE_SESSION_ID || input.session_id || input.sessionId;
await recordActivity(PROVIDERS.CLAUDE, nativeSessionId, event, {
  cwd: input.cwd || process.cwd(),
  hookEvent: input.hook_event_name || input.hookEventName || null,
});
await syncIfStale();
