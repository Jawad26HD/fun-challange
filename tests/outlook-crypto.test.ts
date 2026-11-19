import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptToken, encryptToken } from '../supabase/functions/_shared/outlook-crypto.ts';
import { OutlookError } from '../supabase/functions/_shared/outlook-security.ts';

// Test-only keys; production keys must be generated independently from 32 random bytes.
const key = Buffer.alloc(32, 7).toString('base64');
const otherKey = Buffer.alloc(32, 8).toString('base64');
const user = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const token = 'test-only-provider-token';
const safeError = (code: string) => (error: unknown): boolean => error instanceof OutlookError &&
  error.status === 503 && error.code === code && error.message === code &&
  !error.message.includes(token) && !error.message.includes(key);

test('AES-256-GCM round trips tokens for both purposes, without Deno globals', async () => {
  for (const purpose of ['access', 'refresh'] as const) {
    for (const plaintext of [token, 'Unicode token: مرحبا', 'x'.repeat(20000)]) {
      const encrypted = await encryptToken(plaintext, key, user, purpose);
      assert.match(encrypted, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/u);
      assert.equal(await decryptToken(encrypted, key, user, purpose), plaintext);
      assert.equal(encrypted.includes(token), false);
    }
  }
});

test('random 96-bit IVs make encryption nondeterministic', async () => {
  const encrypted = await Promise.all(Array.from({ length: 32 }, () => encryptToken(token, key, user, 'access')));
  assert.equal(new Set(encrypted).size, 32);
  assert.equal(new Set(encrypted.map(value => value.split('.')[1])).size, 32);
});

test('authenticated context prevents user, purpose, or key substitution', async () => {
  const ciphertext = await encryptToken(token, key, user, 'access');
  for (const [decryptKey, decryptUser, purpose] of [
    [otherKey, user, 'access'], [key, 'another-user', 'access'], [key, user, 'refresh'],
  ] as const) {
    await assert.rejects(decryptToken(ciphertext, decryptKey, decryptUser, purpose), safeError('token_decryption_failed'));
  }
  const second = await encryptToken(token, key, 'a:refresh', 'access');
  await assert.rejects(decryptToken(second, key, 'a', 'refresh'), safeError('token_decryption_failed'));
});

test('every IV, ciphertext and authentication-tag byte is authenticated', async () => {
  const ciphertext = await encryptToken(token, key, user, 'access');
  const parts = ciphertext.split('.');
  for (const field of [1, 2]) {
    const original = Buffer.from(parts[field], 'base64url');
    for (let index = 0; index < original.length; index++) {
      const changed = Buffer.from(original);
      changed[index] ^= 1;
      const forged = [...parts];
      forged[field] = changed.toString('base64url');
      await assert.rejects(decryptToken(forged.join('.'), key, user, 'access'), safeError('token_decryption_failed'));
    }
  }
});

test('invalid/noncanonical keys fail closed on both operations without secrets', async () => {
  const ciphertext = await encryptToken(token, key, user, 'refresh');
  for (const invalid of ['', 'not-base64', key.trimEnd() + '\n', key.slice(0, -1),
    Buffer.alloc(16).toString('base64'), Buffer.alloc(24).toString('base64'),
    Buffer.alloc(33).toString('base64'), 'A'.repeat(42) + 'B=']) {
    await assert.rejects(encryptToken(token, invalid, user, 'refresh'), safeError('server_not_configured'));
    await assert.rejects(decryptToken(ciphertext, invalid, user, 'refresh'), safeError('server_not_configured'));
  }
});

test('malformed, unversioned, truncated, oversized and padded ciphertexts fail closed', async () => {
  const ciphertext = await encryptToken(token, key, user, 'access');
  const [version, iv, body] = ciphertext.split('.');
  for (const invalid of ['', token, 'v2.' + iv + '.' + body, ciphertext + '.extra', ciphertext + '=',
    `${version}.${iv}=.${body}`, `${version}.${iv}.`, `${version}.${iv}.${body.slice(0, -1)}`,
    `${version}.${iv.slice(1)}.${body}`, `${version}.${iv}.${'A'.repeat(22)}`,
    `${version}.${iv}.@@@`, 'v1.' + 'A'.repeat(27000)]) {
    await assert.rejects(decryptToken(invalid, key, user, 'access'), safeError('token_decryption_failed'));
  }
});

test('empty, oversized or non-roundtrippable plaintext and invalid contexts are rejected', async () => {
  for (const invalid of ['', 'x'.repeat(20001), '界'.repeat(10000), '\ud800']) {
    await assert.rejects(encryptToken(invalid, key, user, 'access'), safeError('token_encryption_failed'));
  }
  for (const invalidUser of ['', 'x'.repeat(129), 'user\nname']) {
    await assert.rejects(encryptToken(token, key, invalidUser, 'access'), safeError('invalid_token_context'));
  }
  await assert.rejects(encryptToken(token, key, user, 'other' as 'access'), safeError('invalid_token_context'));
});
