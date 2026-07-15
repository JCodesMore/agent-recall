import { PROVIDERS } from '../config.mjs';
import { assertAdapter } from './source-adapter.mjs';
import { claudeAdapter } from './claude.mjs';
import { codexAdapter } from './codex.mjs';
import { opencodeAdapter } from './opencode.mjs';

const ADAPTERS = new Map([
  [PROVIDERS.CLAUDE, assertAdapter(claudeAdapter)],
  [PROVIDERS.CODEX, assertAdapter(codexAdapter)],
  [PROVIDERS.OPENCODE, assertAdapter(opencodeAdapter)],
]);

export function adaptersFor(providers) {
  if (!providers || providers.length === 0) return [...ADAPTERS.values()];
  return providers.map(provider => {
    const adapter = ADAPTERS.get(provider);
    if (!adapter) throw new Error(`Unsupported provider: ${provider}`);
    return adapter;
  });
}

export function supportedProviders() {
  return [...ADAPTERS.keys()];
}

export function adapterFor(provider) {
  return ADAPTERS.get(provider) ?? null;
}
