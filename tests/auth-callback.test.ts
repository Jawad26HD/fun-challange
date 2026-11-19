import assert from 'node:assert/strict';
import test from 'node:test';
import { callbackCode, createAuthCallbackHandler } from '../src/lib/auth-callback.ts';

const redirect = 'studenthub://auth/callback';
test('native callback accepts only the exact redirect destination', () => {
  assert.equal(callbackCode(`${redirect}?code=valid-code`, redirect), 'valid-code');
  for (const url of ['studenthub://other/callback?code=bad', 'studenthub://auth/other?code=bad', 'https://auth/callback?code=bad', 'studenthub://user@auth/callback?code=bad', 'studenthub://auth/callback?code=a&code=b', 'studenthub://auth/callback?code=a#access_token=bad', 'invalid', `${redirect}?code=`, `${redirect}?code=a%20b`]) {
    assert.equal(callbackCode(url, redirect), null, url);
  }
  const expo = 'exp://192.168.1.2:8081/--/auth/callback';
  assert.equal(callbackCode(`${expo}?code=expo-code`, expo), 'expo-code');
  assert.equal(callbackCode(`${expo}?code=expo-code`, redirect), null);
});
test('OAuth error messages are safe and not taken from provider input', () => {
  assert.throws(() => callbackCode(`${redirect}?error=denied&error_description=secret`, redirect), error => error instanceof Error && !error.message.includes('secret'));
});
test('browser and Linking callbacks exchange a PKCE code once', async () => {
  const received: string[] = [];
  const handler = createAuthCallbackHandler(async code => { received.push(code); });
  assert.deepEqual(await Promise.all([handler(`${redirect}?code=once`, redirect), handler(`${redirect}?code=once`, redirect)]), [true, true]);
  await handler(`${redirect}?code=once`, redirect);
  await handler(`${redirect}?code=next`, redirect);
  assert.deepEqual(received, ['once', 'next']);
  assert.equal(await handler('studenthub://planner', redirect), false);
});
test('failed exchanges are not retried by duplicate native delivery', async () => {
  let calls = 0;
  const handler = createAuthCallbackHandler(async () => { calls++; throw new Error('exchange failed'); });
  await assert.rejects(handler(`${redirect}?code=once`, redirect), /exchange failed/u);
  await assert.rejects(handler(`${redirect}?code=once`, redirect), /exchange failed/u);
  assert.equal(calls, 1);
});
