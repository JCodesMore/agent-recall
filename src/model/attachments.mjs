import { stableId } from './ids.mjs';

export function attachmentKey(provider, nativeMessageId, sourcePath, ordinal) {
  return `${provider}-attachment:${stableId(provider, nativeMessageId, sourcePath, ordinal).slice(0, 24)}`;
}

export function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const encoded = match[2].replace(/[\r\n]/g, '');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return {
    mime: match[1].toLowerCase(),
    encoded,
    byteLength: Math.max(0, Math.floor(encoded.length * 3 / 4) - padding),
  };
}

export function decodeDataUrl(value) {
  const parsed = parseDataUrl(value);
  if (!parsed) throw new Error('Attachment payload is not a supported base64 data URL.');
  return { mime: parsed.mime, data: Buffer.from(parsed.encoded, 'base64') };
}
