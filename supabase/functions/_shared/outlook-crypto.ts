import { OutlookError } from './outlook-security.ts';

type TokenPurpose = 'access' | 'refresh';
const MAX_TOKEN_BYTES = 20000;
const encoder = new TextEncoder();

async function encryptionKey(base64Key: string): Promise<CryptoKey> {
  try {
    if (typeof base64Key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/u.test(base64Key)) throw new Error();
    const binary = atob(base64Key);
    if (binary.length !== 32 || btoa(binary) !== base64Key) throw new Error();
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    try { return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
    finally { bytes.fill(0); }
  } catch { throw new OutlookError('server_not_configured', 503); }
}

function context(userId: string, purpose: TokenPurpose): Uint8Array<ArrayBuffer> {
  if (typeof userId !== 'string' || !userId || userId.length > 128 || /[\x00-\x20\x7f]/u.test(userId) ||
    (purpose !== 'access' && purpose !== 'refresh')) throw new OutlookError('invalid_token_context', 503);
  return encoder.encode(JSON.stringify(['student-planner', 'outlook-token', 'v1', userId, purpose]));
}

function encode(bytes: Uint8Array<ArrayBuffer>): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
  const bytes = Uint8Array.from(atob(value.replace(/-/gu, '+').replace(/_/gu, '/')), char => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error();
  return bytes;
}

/** Versioned AES-256-GCM; ciphertext includes the 128-bit authentication tag. */
export async function encryptToken(text: string, base64Key: string, userId: string, purpose: TokenPurpose): Promise<string> {
  const key = await encryptionKey(base64Key);
  const additionalData = context(userId, purpose);
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (typeof text !== 'string' || !text || text.length > MAX_TOKEN_BYTES) throw new Error();
    plaintext = encoder.encode(text);
    if (plaintext.byteLength > MAX_TOKEN_BYTES || new TextDecoder('utf-8', { fatal: true }).decode(plaintext) !== text) throw new Error();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, plaintext);
    return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
  } catch { throw new OutlookError('token_encryption_failed', 503); }
  finally { plaintext?.fill(0); }
}

export async function decryptToken(text: string, base64Key: string, userId: string, purpose: TokenPurpose): Promise<string> {
  const key = await encryptionKey(base64Key);
  const additionalData = context(userId, purpose);
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (typeof text !== 'string' || text.length > 26800) throw new Error();
    const parts = text.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw new Error();
    const iv = decode(parts[1]);
    const ciphertext = decode(parts[2]);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > MAX_TOKEN_BYTES + 16) throw new Error();
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, ciphertext));
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch { throw new OutlookError('token_decryption_failed', 503); }
  finally { plaintext?.fill(0); }
}
