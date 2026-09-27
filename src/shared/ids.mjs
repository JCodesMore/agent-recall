import crypto from 'node:crypto';
import { LIMITS } from './config.mjs';

// Crockford-style alphabet without look-alike characters, all lower case.
const HANDLE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function sha256(...parts) {
  return crypto.createHash('sha256').update(parts.map(part => String(part ?? '')).join('\0')).digest();
}

export function hashHex(...parts) {
  return sha256(...parts).toString('hex');
}

// Stable short id for a session. Collisions extend the handle one character at a time.
export function sessionHandle(provider, nativeId, length = LIMITS.HANDLE_LENGTH) {
  const digest = sha256(provider, nativeId);
  let bits = 0n;
  for (const byte of digest.subarray(0, 10)) bits = (bits << 8n) | BigInt(byte);
  let handle = '';
  for (let index = 0; index < length; index += 1) {
    handle += HANDLE_ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }
  return handle;
}

export function asIso(value) {
  if (value === null || value === undefined || value === '') return null;
  let input = value;
  if (typeof input === 'bigint') input = Number(input);
  if (typeof input === 'string' && /^-?\d+(\.\d+)?$/.test(input)) input = Number(input);
  // Seconds-precision epochs are promoted to milliseconds.
  if (typeof input === 'number' && Math.abs(input) < 1e12) input *= 1_000;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function minIso(current, candidate) {
  if (!candidate) return current;
  return !current || candidate < current ? candidate : current;
}

export function maxIso(current, candidate) {
  if (!candidate) return current;
  return !current || candidate > current ? candidate : current;
}
