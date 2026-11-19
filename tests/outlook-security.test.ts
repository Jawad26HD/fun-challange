import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertMicrosoftSessionAfterValidation, azureClaimsAfterGraphValidation, OutlookError,
  requireGraphUrl, universityEmail, verifiedMailTransport, type MessageHeader,
} from '../supabase/functions/_shared/outlook-security.ts';

const tenant = '11111111-2222-4333-8444-555555555555';
const user = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const now = Math.floor(Date.now() / 1000);
// Deliberately unsigned fixtures: these helpers are post-validation policy checks, NOT verifiers.
function jwt(claims: unknown, alg = 'RS256'): string {
  return [JSON.stringify({ alg, typ: 'JWT' }), JSON.stringify(claims), 'fixture-signature']
    .map(part => Buffer.from(part).toString('base64url')).join('.');
}
function session(overrides: Record<string, unknown> = {}): string {
  return jwt({ iss: 'https://project.supabase.co/auth/v1', aud: 'authenticated', role: 'authenticated',
    sub: user, iat: now - 60, exp: now + 3600, is_anonymous: false,
    app_metadata: { provider: 'azure', providers: ['azure'] },
    amr: [{ method: 'oauth', timestamp: now - 60 }], ...overrides });
}
function azure(overrides: Record<string, unknown> = {}): string {
  return jwt({ iss: `https://sts.windows.net/${tenant}/`, aud: 'https://graph.microsoft.com',
    ver: '1.0', tid: tenant, oid: user, sub: 'pairwise-subject', nbf: now - 60,
    iat: now - 60, exp: now + 3600, scp: 'Mail.Read User.Read', ...overrides });
}
function fails(run: () => unknown, code?: string): void {
  assert.throws(run, error => error instanceof OutlookError && (!code || error.code === code));
}

test('OutlookError exposes only the supplied safe code and status', () => {
  const error = new OutlookError('invalid_request');
  assert.equal(error.message, 'invalid_request');
  assert.equal(error.code, 'invalid_request');
  assert.equal(error.status, 400);
  assert.equal(new OutlookError('unauthorized', 401).status, 401);
});

test('university email uses exact domains, normalized case, and one valid ASCII mailbox', () => {
  assert.equal(universityEmail('Student.Name+planner@EXAMPLE.EDU', ['example.edu']), 'student.name+planner@example.edu');
  for (const email of ['a@sub.example.edu', 'a@example.edu.evil.com', 'a@notexample.edu',
    'a@example.edu.', 'a@@example.edu', 'Name <a@example.edu>', 'a@example.edu\r\nBcc:x@evil.com',
    '.a@example.edu', 'a..b@example.edu', 'a@-example.edu', 'a@exam_ple.edu',
    ' a@example.edu', 'a@example.edu ', 'a@ｅxample.edu', 'ſtudent@example.edu', 'a'.repeat(65) + '@example.edu']) {
    fails(() => universityEmail(email, ['example.edu']), 'university_email_required');
  }
  for (const domains of [[], ['*.example.edu'], ['example.edu.'], ['-example.edu'], ['K.edu']]) {
    fails(() => universityEmail('a@example.edu', domains), 'server_not_configured');
  }
});

const graph = 'https://graph.microsoft.com/v1.0';
test('Graph URLs support exactly the recovered runtime calls and opaque page cursors', () => {
  assert.equal(requireGraphUrl(`${graph}/me?$select=id,mail`, 'identity'), `${graph}/me?$select=id,mail`);
  const initial = new URL(`${graph}/me/messages`);
  initial.searchParams.set('$select', 'id,subject,from,sender,receivedDateTime,webLink,hasAttachments,toRecipients');
  initial.searchParams.set('$filter', 'receivedDateTime ge 2026-01-01T00:00:00.000Z and receivedDateTime le 2026-01-31T00:00:00.000Z');
  initial.searchParams.set('$orderby', 'receivedDateTime asc');
  initial.searchParams.set('$top', '25');
  assert.equal(requireGraphUrl(initial.href, 'page'), initial.href);
  initial.searchParams.set('$skiptoken', 'opaque+/==&$expand=not-a-query');
  assert.equal(requireGraphUrl(initial.href, 'page'), initial.href);
  const message = `${graph}/me/messages/${encodeURIComponent('AAMk+/abc==')}?$select=id,body,internetMessageHeaders`;
  assert.equal(requireGraphUrl(message, 'message'), message);
});

test('Graph allowlist rejects alternate hosts, authority tricks, normalization and endpoints', () => {
  for (const url of [
    'http://graph.microsoft.com/v1.0/me/messages', '//graph.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com:443/v1.0/me/messages', 'https://graph.microsoft.com:8443/v1.0/me/messages',
    'https://user@graph.microsoft.com/v1.0/me/messages', 'https://graph.microsoft.com@evil.com/v1.0/me/messages',
    'https://graph.microsoft.com.evil.com/v1.0/me/messages', 'https://graph.microsoft.com./v1.0/me/messages',
    'https://graph.microsoft.com\\@evil.com/v1.0/me/messages', `${graph}/users/me/messages`,
    'https://graph.microsoft.com/beta/me/messages', `${graph}/me/mailFolders/inbox/messages`,
    `${graph}/me/messages#`, `${graph}/me/messages#secret`, `${graph}/me/../me/messages`,
    `${graph}/me/%2e%2e/me/messages`, `${graph}/me/messages/`, `${graph}/me/messages\n`,
    `${graph}/me/messages?$skiptoken=%`, `${graph}/me/messages?$skiptoken=%0d%0a`,
    `${graph}/me/messages?$skiptoken=%ff`,
  ]) fails(() => requireGraphUrl(url, 'page'), 'invalid_graph_url');
  for (const id of ['delta', '%64elta', '..', '.', 'x/attachments', 'x/$value', 'x%252Fattachments', 'x%3F%24expand', 'x%23']) {
    fails(() => requireGraphUrl(`${graph}/me/messages/${id}`, 'message'), 'invalid_graph_url');
  }
  fails(() => requireGraphUrl(`${graph}/me/messages`, 'identity'));
  fails(() => requireGraphUrl(`${graph}/me`, 'page'));
});

test('Graph queries cannot expand, add aliases, duplicate parameters or exceed caps', () => {
  for (const query of [
    '$expand=attachments', '$select=id,body', '$select=id,id', '$select=id($expand=attachments)',
    '$top=101', '$top=0', '$top=-1', '$top=1e2', '$top=25&%24top=1',
    '$skip=1&$skiptoken=abc', '$skip=9007199254740999', '$skip=-1', '$orderby=subject asc',
    '$count=true', '$search=secret', '@alias=1', '$filter=subject eq x',
    '$filter=receivedDateTime ge 2026-02-30T00:00:00.000Z and receivedDateTime le 2026-03-31T00:00:00.000Z',
    '$filter=receivedDateTime ge 2026-02-01T00:00:00.000Z and receivedDateTime le 2026-01-01T00:00:00.000Z',
  ]) fails(() => requireGraphUrl(`${graph}/me/messages?${query.replaceAll(' ', '%20')}`, 'page'));
  fails(() => requireGraphUrl(`${graph}/me?$select=id,mail&$expand=manager`, 'identity'));
  fails(() => requireGraphUrl(`${graph}/me/messages/abc?$top=1`, 'message'));
});

test('validated Supabase sessions require Azure metadata and actual OAuth AMR', () => {
  assert.doesNotThrow(() => assertMicrosoftSessionAfterValidation(session()));
  assert.doesNotThrow(() => assertMicrosoftSessionAfterValidation(session({
    amr: [{ method: 'oauth', timestamp: now - 60 }, { method: 'totp', timestamp: now - 30 }],
  })));
  for (const overrides of [
    { app_metadata: { provider: 'email', providers: ['azure', 'email'] } },
    { app_metadata: { provider: 'azure', providers: ['email'] } }, { app_metadata: null },
    { amr: [] }, { amr: [{ method: 'password', timestamp: now - 10 }] },
    { amr: [{ method: 'oauth', timestamp: now - 60 }, { method: 'password', timestamp: now - 10 }] },
    { amr: [{ method: 'oauth', timestamp: now + 3600 }] }, { amr: ['oauth'] },
    { role: 'service_role' }, { aud: 'other' }, { is_anonymous: true }, { sub: 'invalid' },
    { iss: 'https://project.supabase.co/auth/v1?other=1' }, { iss: 'http://evil.com/auth/v1' },
    { exp: now - 1 }, { exp: '9999999999' }, { iat: now + 3600 }, { nbf: now + 3600 },
  ]) fails(() => assertMicrosoftSessionAfterValidation(session(overrides)), 'university_microsoft_signin_required');
});

test('validated Azure claims require tenant, issuer, expiry and delegated Graph permissions', () => {
  assert.equal(azureClaimsAfterGraphValidation(azure(), tenant).tid, tenant);
  assert.doesNotThrow(() => azureClaimsAfterGraphValidation(azure({ ver: '2.0',
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`, aud: '00000003-0000-0000-c000-000000000000',
    scp: 'openid profile email User.Read Mail.Read offline_access', idtyp: 'user' }), tenant));
  for (const overrides of [
    { tid: user }, { tid: 'common' }, { ver: '3.0' }, { oid: 'not-a-uuid' }, { sub: '' },
    { iss: `https://evil.com/${tenant}/` }, { iss: `https://login.microsoftonline.com/${tenant}/v2.0` },
    { aud: 'https://outlook.office365.com' }, { aud: ['https://graph.microsoft.com'] },
    { scp: 'Mail.Read' }, { scp: 'User.Read' }, { scp: 'Mail.Read User.Read Mail.Send' },
    { scp: 'Mail.ReadWrite User.Read' }, { scp: 'Mail.Read User.Read .default' },
    { scp: 'mail.read User.Read' }, { scp: 'Mail.Read User.Read User.Read' }, { scp: undefined },
    { roles: ['Mail.Read'] }, { idtyp: 'app' }, { exp: now - 1 }, { nbf: now + 600 },
    { nbf: undefined }, { iat: now + 600 }, { exp: null },
  ]) fails(() => azureClaimsAfterGraphValidation(azure(overrides), tenant), 'invalid_microsoft_token');
  for (const invalid of ['common', 'organizations', '', `${tenant}/../common`]) {
    fails(() => azureClaimsAfterGraphValidation(azure(), invalid), 'server_not_configured');
  }
});

test('malformed JWTs and unsigned algorithms fail with safe errors', () => {
  for (const token of ['', 'not-a-jwt', 'e30.e30.', 'e30.!!!!.abc', jwt(null), jwt([]), jwt({}, 'none'), 'a'.repeat(20001)]) {
    fails(() => assertMicrosoftSessionAfterValidation(token));
    fails(() => azureClaimsAfterGraphValidation(token, tenant));
  }
});

const sender = 'professor@example.edu';
const trusted = 'mx.example.edu';
function mail(result = `${trusted}; spf=pass smtp.mailfrom=example.edu; dkim=pass header.d=example.edu; dmarc=pass action=none header.from=example.edu`): MessageHeader[] {
  return [{ name: 'From', value: `Professor Smith <${sender}>` }, { name: 'Authentication-Results', value: result }];
}

test('mail authentication needs trusted receiving service, exact alignment and matching From', () => {
  assert.equal(verifiedMailTransport(mail(), sender, trusted), true);
  assert.equal(verifiedMailTransport(mail(`${trusted} 1;\r\n\tdmarc=pass header.from=EXAMPLE.EDU;`), sender, trusted), true);
  assert.equal(verifiedMailTransport(mail(), sender, ''), false);
  assert.equal(verifiedMailTransport(mail(), sender, 'other.example.edu'), false);
  assert.equal(verifiedMailTransport(mail(), 'other@example.edu', trusted), false);
  assert.equal(verifiedMailTransport(mail(), sender, '*.example.edu'), false);
  for (const result of [
    'dmarc=pass header.from=example.edu', `attacker.example; dmarc=pass header.from=example.edu`,
    `${trusted}; dmarc=fail header.from=example.edu`, `${trusted}; spf=pass smtp.mailfrom=example.edu`,
    `${trusted}; dmarc=pass header.from=sub.example.edu`, `${trusted}; dmarc=pass header.from=example.edu.evil.com`,
    `${trusted}; dmarc=pass header.from=professor@example.edu`, `${trusted}; dmarc=pass`,
    `${trusted}; dmarc=pass header.from=example.edu header.from=evil.com`,
    `${trusted}; dmarc=pass header.from=example.edu; dmarc=fail header.from=example.edu`,
    `${trusted}; dmarc=pass (header.from=example.edu)`, `${trusted}; dmarc=pass header.from="example.edu"`,
    `${trusted}; dmarc=pass header.from=example.edu\r\nX-Evil: injected`,
  ]) assert.equal(verifiedMailTransport(mail(result), sender, trusted), false, result);
});

test('forged, duplicate, ambiguous and ARC-only transport headers stay review-only', () => {
  const headers = mail();
  for (const altered of [
    [headers[1]], [headers[0]], [headers[0], { name: 'ARC-Authentication-Results', value: headers[1].value }],
    [...headers, headers[1]], [...headers, { ...headers[0], name: 'fRoM' }],
    [{ name: 'Authentication-Results', value: 'evil.com; dmarc=fail header.from=example.edu' }, ...headers],
    [...headers, { name: 'Authentication-Results', value: 'evil.com; dmarc=pass header.from=example.edu' }],
    [...headers, { name: 'Sender', value: 'attacker@evil.com' }],
    [...headers, { name: 'Resent-From', value: sender }],
    [{ name: 'From', value: `${sender}, attacker@evil.com` }, headers[1]],
    [{ name: 'From', value: `"fake <${sender}>" <attacker@evil.com>` }, headers[1]],
    [...headers, { name: 'X-Header', value: 'x'.repeat(16001) }],
    [...headers, ...Array.from({ length: 499 }, () => ({ name: 'X-Header', value: 'x' }))],
  ]) assert.equal(verifiedMailTransport(altered, sender, trusted), false);
});
