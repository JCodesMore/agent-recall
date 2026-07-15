import crypto from 'node:crypto';

export function sessionKey(provider, nativeId, sourcePath) {
  const source = stableId(sourcePath || nativeId).slice(0, 12);
  return `${provider}:${nativeId}:${source}`;
}

export function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map(part => String(part ?? '')).join('\0')).digest('hex');
}

export function messageKey(provider, nativeId, sourcePath, sequence) {
  const id = nativeId || 'generated';
  return `${provider}:${id}:${stableId(sourcePath, sequence).slice(0, 12)}`;
}

export function asIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
