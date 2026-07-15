import crypto from 'node:crypto';
import { LIMITS } from '../config.mjs';
import { stableId } from './ids.mjs';

export function attachmentKey(provider, nativeMessageId, sourcePath, nativeAttachmentId) {
  return `${provider}-attachment:${stableId(provider, nativeMessageId, sourcePath, nativeAttachmentId).slice(0, 24)}`;
}

function validBase64(value) {
  if (value.length % 4 !== 0) return false;
  let padding = 0;
  if (value.endsWith('=')) padding += 1;
  if (value.endsWith('==')) padding += 1;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const valid = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47;
    if (!valid) return false;
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

export function parseDataUrl(value) {
  if (typeof value !== 'string' || value.slice(0, 5).toLowerCase() !== 'data:') return null;
  const comma = value.indexOf(',', 5);
  if (comma < 0) return null;
  const segments = value.slice(5, comma).split(';');
  if (segments.at(-1)?.toLowerCase() !== 'base64') return null;
  const mime = (segments.shift() || 'application/octet-stream').toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) return null;
  const maxEncodedLength = Math.ceil(LIMITS.ATTACHMENT_MAX_BYTES / 3) * 4;
  const lineBreakAllowance = Math.ceil(maxEncodedLength / 76) * 2;
  const payload = value.slice(comma + 1);
  if (payload.length > maxEncodedLength + lineBreakAllowance) return null;
  const encoded = payload.replace(/[\r\n]/g, '');
  if (encoded.length > maxEncodedLength || !validBase64(encoded)) return null;
  const data = Buffer.from(encoded, 'base64');
  if (data.length > LIMITS.ATTACHMENT_MAX_BYTES) return null;
  return {
    mime,
    byteLength: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    data,
  };
}

export function decodeDataUrl(value) {
  const parsed = parseDataUrl(value);
  if (!parsed) {
    const error = new Error('Attachment payload is not a supported base64 data URL.');
    error.code = 'INVALID_ATTACHMENT_DATA';
    throw error;
  }
  return { mime: parsed.mime, data: parsed.data };
}
