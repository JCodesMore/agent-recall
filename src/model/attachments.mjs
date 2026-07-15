import crypto from 'node:crypto';
import { LIMITS } from '../config.mjs';
import { stableId } from './ids.mjs';

export function attachmentKey(provider, nativeMessageId, sourcePath, nativeAttachmentId) {
  return `${provider}-attachment:${stableId(provider, nativeMessageId, sourcePath, nativeAttachmentId).slice(0, 24)}`;
}

export function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:([^,]*),([\s\S]*)$/i);
  if (!match) return null;
  const segments = match[1].split(';');
  if (segments.at(-1)?.toLowerCase() !== 'base64') return null;
  const mime = (segments.shift() || 'application/octet-stream').toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) return null;
  const maxEncodedLength = Math.ceil(LIMITS.ATTACHMENT_MAX_BYTES / 3) * 4;
  const lineBreakAllowance = Math.ceil(maxEncodedLength / 76) * 2;
  if (match[2].length > maxEncodedLength + lineBreakAllowance) return null;
  const encoded = match[2].replace(/[\r\n]/g, '');
  if (
    encoded.length > maxEncodedLength
    || encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    return null;
  }
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
