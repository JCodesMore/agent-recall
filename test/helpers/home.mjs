import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A throwaway machine: a fake home with provider stores plus a separate data home for the
 * index. Everything is synthetic. `env` is what the CLI and service need to see only it.
 */
export function fakeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recall-'));
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.mkdirSync(home, { recursive: true });
  const env = { AGENT_RECALL_SOURCE_HOME: home, AGENT_RECALL_HOME: data };
  const previous = {};
  return {
    root,
    home,
    data,
    env,
    file(relative, content) {
      const full = path.join(home, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return full;
    },
    jsonl(relative, records) {
      return this.file(relative, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    },
    append(relative, records) {
      fs.appendFileSync(path.join(home, relative), records.map(record => JSON.stringify(record)).join('\n') + '\n');
    },
    // Points this process at the fake home (for tests that call modules directly).
    activate() {
      for (const [key, value] of Object.entries(env)) {
        previous[key] = process.env[key];
        process.env[key] = value;
      }
      return this;
    },
    cleanup() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const at = minute => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();

// Records in the shape Claude Code writes to ~/.claude/projects/<slug>/<id>.jsonl.
export const claude = {
  user: (text, minute, extra = {}) => ({ type: 'user', timestamp: at(minute), cwd: extra.cwd ?? '/work/demo', gitBranch: 'main', message: { role: 'user', content: text }, ...extra }),
  assistant: (content, minute) => ({
    type: 'assistant',
    timestamp: at(minute),
    message: { role: 'assistant', model: 'claude-test', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content },
  }),
  toolUse: (id, name, input) => ({ type: 'tool_use', id, name, input }),
  toolResult: (id, text, minute) => ({ type: 'user', timestamp: at(minute), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }),
  title: (customTitle, sessionId) => ({ type: 'custom-title', customTitle, sessionId }),
};
