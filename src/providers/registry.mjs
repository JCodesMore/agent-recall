import { claudeProvider } from './claude.mjs';
import { cursorProvider } from './cursor.mjs';
import { opencodeProvider } from './opencode.mjs';

/**
 * Every provider implements:
 *   id                              one of PROVIDERS
 *   discover(roots) -> source[]     source = { provider, path, kind: 'jsonl'|'sqlite'|'file', meta }
 *   labels(roots) -> label[]        optional; titles, archive flags and parents kept outside transcripts
 *   parse(source, cursor) -> parsed see builder.mjs for the normalized shape
 *   readAttachment(source, locator) -> { mime, data: Buffer } | null
 */
export const PROVIDER_LIST = Object.freeze([claudeProvider, opencodeProvider, cursorProvider]);

const byId = new Map(PROVIDER_LIST.map(provider => [provider.id, provider]));

export function providerById(id) {
  return byId.get(id) ?? null;
}

// `ids` may be undefined (all), or a list of provider ids; unknown ids throw so typos surface.
export function providersFor(ids) {
  if (!ids?.length) return PROVIDER_LIST;
  return ids.map(id => {
    const provider = byId.get(id);
    if (!provider) throw new Error(`Unknown provider "${id}". Known: ${[...byId.keys()].join(', ')}`);
    return provider;
  });
}
