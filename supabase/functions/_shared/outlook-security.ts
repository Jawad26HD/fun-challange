export class OutlookError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'OutlookError';
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GRAPH = 'https://graph.microsoft.com';
const PAGE_FIELDS = new Set(['id', 'subject', 'from', 'sender', 'receivedDateTime', 'webLink', 'hasAttachments', 'toRecipients']);
const MESSAGE_FIELDS = new Set(['id', 'body', 'internetMessageHeaders']);
const IDENTITY_FIELDS = new Set(['id', 'mail']);

function validDomain(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && !/[^\x21-\x7e]/u.test(value) &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(value);
}

function emailAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254 || /[^\x21-\x7e]/u.test(value)) return null;
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length > 64 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/iu.test(parts[0]) ||
    !validDomain(parts[1])) return null;
  return value.toLowerCase();
}

export function universityEmail(email: string, domains: readonly string[]): string {
  if (!Array.isArray(domains) || !domains.length || domains.some(domain => !validDomain(domain))) {
    throw new OutlookError('server_not_configured', 503);
  }
  const address = emailAddress(email);
  if (!address || !domains.some(domain => domain.toLowerCase() === address.split('@')[1])) {
    throw new OutlookError('university_email_required', 403);
  }
  return address;
}

/** A narrow URL policy for runtime GETs, not a general Microsoft Graph client. */
export function requireGraphUrl(input: string, purpose: 'page' | 'message' | 'identity'): string {
  const reject = (): never => { throw new OutlookError('invalid_graph_url', 502); };
  // Check the raw authority/path too: URL silently normalizes :443, dot paths and backslashes.
  if (typeof input !== 'string' || input.length > 16000 || /[^\x21-\x7e]|[\\#]/u.test(input) ||
    !input.startsWith(`${GRAPH}/`)) return reject();
  let url: URL;
  try { url = new URL(input); } catch { return reject(); }
  if (url.origin !== GRAPH || url.username || url.password || url.port || url.hash) return reject();
  const rawPath = input.slice(GRAPH.length).split('?')[0];
  if (rawPath !== url.pathname || /%(?![0-9a-f]{2})/iu.test(input)) return reject();
  let fields: ReadonlySet<string>;
  if (purpose === 'page' && rawPath === '/v1.0/me/messages') fields = PAGE_FIELDS;
  else if (purpose === 'identity' && rawPath === '/v1.0/me') fields = IDENTITY_FIELDS;
  else if (purpose === 'message' && rawPath.startsWith('/v1.0/me/messages/')) {
    const segment = rawPath.slice('/v1.0/me/messages/'.length);
    let id: string;
    try { id = decodeURIComponent(segment); } catch { return reject(); }
    if (!id || id.length > 1024 || !/^[a-z0-9+/_=-]+$/iu.test(id) || id.toLowerCase() === 'delta' ||
      encodeURIComponent(id) !== segment) return reject();
    fields = MESSAGE_FIELDS;
  } else return reject();

  const keys = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (keys.has(key) || !value || /[\x00-\x1f\x7f-\x9f\ufffd]/u.test(value)) return reject();
    keys.add(key);
    if (key === '$select') {
      const selected = value.split(',');
      if (new Set(selected).size !== selected.length || selected.some(field => !fields.has(field))) return reject();
    } else if (purpose === 'page' && key === '$top') {
      if (!/^[1-9][0-9]{0,2}$/u.test(value) || Number(value) > 100) return reject();
    } else if (purpose === 'page' && key === '$skip') {
      if (!/^(?:0|[1-9][0-9]{0,14})$/u.test(value)) return reject();
    } else if (purpose === 'page' && key === '$skiptoken') {
      if (value.length > 8192) return reject();
    } else if (purpose === 'page' && key === '$orderby') {
      if (value !== 'receivedDateTime asc') return reject();
    } else if (purpose === 'page' && key === '$filter') {
      const range = /^receivedDateTime ge (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) and receivedDateTime le (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/u.exec(value);
      if (!range || range.slice(1).some(date => !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) ||
        Date.parse(range[1]) > Date.parse(range[2])) return reject();
    } else return reject();
  }
  if (keys.has('$skip') && keys.has('$skiptoken')) return reject();
  return url.href;
}

type Claims = Record<string, unknown>;
function record(value: unknown): value is Claims {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedJwtClaims(jwt: string, algorithms: readonly string[], code: string): Claims {
  const reject = (): never => { throw new OutlookError(code, 403); };
  if (typeof jwt !== 'string' || jwt.length > 20000) return reject();
  const parts = jwt.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[a-z0-9_-]+$/iu.test(part))) return reject();
  const decode = (part: string): unknown => {
    const bytes = Uint8Array.from(atob(part.replace(/-/gu, '+').replace(/_/gu, '/')), char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  try {
    const header = decode(parts[0]);
    const claims = decode(parts[1]);
    if (!record(header) || typeof header.alg !== 'string' || !algorithms.includes(header.alg) || !record(claims)) return reject();
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(claims.exp) || (claims.exp as number) <= now ||
      !Number.isSafeInteger(claims.iat) || (claims.iat as number) <= 0 || (claims.iat as number) > now ||
      (claims.iat as number) >= (claims.exp as number) ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) > now ||
        (claims.nbf as number) < 0 || (claims.nbf as number) >= (claims.exp as number)))) return reject();
    return claims;
  } catch { return reject(); }
}

/** Policy checks ONLY AFTER Supabase auth.getUser(jwt) succeeds. Does not verify JWT signatures. */
export function assertMicrosoftSessionAfterValidation(jwt: string): void {
  const code = 'university_microsoft_signin_required';
  const claims = validatedJwtClaims(jwt, ['HS256', 'RS256', 'ES256'], code);
  const reject = (): never => { throw new OutlookError(code, 403); };
  if (claims.aud !== 'authenticated' || claims.role !== 'authenticated' || claims.is_anonymous === true ||
    typeof claims.sub !== 'string' || !UUID.test(claims.sub) || typeof claims.iss !== 'string') return reject();
  try {
    const issuer = new URL(claims.iss);
    const local = issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname);
    if ((!local && issuer.protocol !== 'https:') || issuer.pathname !== '/auth/v1' ||
      issuer.username || issuer.password || issuer.search || issuer.hash) return reject();
  } catch { return reject(); }
  const metadata = claims.app_metadata;
  if (!record(metadata) || metadata.provider !== 'azure' || !Array.isArray(metadata.providers) ||
    !metadata.providers.includes('azure') || metadata.providers.some(provider => typeof provider !== 'string')) return reject();
  const now = Math.floor(Date.now() / 1000);
  const amr = claims.amr;
  const methods = new Set(['oauth', 'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn', 'token_refresh']);
  if (!Array.isArray(amr) || !amr.length || amr.length > 20 ||
    amr.some(entry => !record(entry) || typeof entry.method !== 'string' || !methods.has(entry.method) ||
      !Number.isSafeInteger(entry.timestamp) || (entry.timestamp as number) <= 0 || (entry.timestamp as number) > now) ||
    !amr.some(entry => entry.method === 'oauth')) return reject();
}

/** Policy checks ONLY AFTER Graph /me accepts this exact token. Does not verify JWT signatures. */
export function azureClaimsAfterGraphValidation(jwt: string, tenant: string): Claims {
  if (typeof tenant !== 'string' || !UUID.test(tenant)) throw new OutlookError('server_not_configured', 503);
  const code = 'invalid_microsoft_token';
  const claims = validatedJwtClaims(jwt, ['RS256'], code);
  const reject = (): never => { throw new OutlookError(code, 403); };
  if (typeof claims.tid !== 'string' || !UUID.test(claims.tid) || claims.tid.toLowerCase() !== tenant.toLowerCase() ||
    typeof claims.oid !== 'string' || !UUID.test(claims.oid) ||
    typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 ||
    !Number.isSafeInteger(claims.nbf) || claims.roles !== undefined ||
    (claims.idtyp !== undefined && claims.idtyp !== 'user')) return reject();
  const tenantId = claims.tid.toLowerCase();
  const issuer = claims.ver === '1.0' ? `https://sts.windows.net/${tenantId}/` :
    claims.ver === '2.0' ? `https://login.microsoftonline.com/${tenantId}/v2.0` : null;
  if (!issuer || claims.iss !== issuer || typeof claims.aud !== 'string' ||
    !['00000003-0000-0000-c000-000000000000', GRAPH, `${GRAPH}/`].includes(claims.aud) || typeof claims.scp !== 'string') return reject();
  const scopes = claims.scp.split(' ');
  const allowed = new Set(['Mail.Read', 'User.Read', 'openid', 'profile', 'email', 'offline_access']);
  if (!scopes.includes('Mail.Read') || !scopes.includes('User.Read') || new Set(scopes).size !== scopes.length ||
    scopes.some(scope => !allowed.has(scope))) return reject();
  return claims;
}

export interface MessageHeader { name: string; value: string }

function unfoldedHeader(value: string): string | null {
  const unfolded = value.replace(/\r\n[ \t]+/gu, ' ');
  return /[\x00-\x08\x0a-\x1f\x7f-\x9f]/u.test(unfolded) ? null : unfolded.trim();
}

function fromHeader(value: string): string | null {
  const bare = emailAddress(value);
  if (bare) return bare;
  // Deliberately not a full RFC mailbox parser: lists, comments and escaped names need review.
  const named = /^(?:[a-z0-9 .'-]+|"[a-z0-9 .,'-]+")?[ \t]*<([^<>]+)>$/iu.exec(value);
  return named ? emailAddress(named[1]) : null;
}

// Only configure a receiving service that strips forged headers before inserting its own verdict.
export function verifiedMailTransport(headers: readonly MessageHeader[], from: string, trustedAuthservId: string): boolean {
  const address = emailAddress(from);
  if (!address || !validDomain(trustedAuthservId) || !Array.isArray(headers) || headers.length > 500) return false;
  const auth: string[] = [];
  const froms: string[] = [];
  const senders: string[] = [];
  let size = 0;
  for (const header of headers) {
    if (!header || typeof header.name !== 'string' || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u.test(header.name) ||
      typeof header.value !== 'string' || header.value.length > 16000) return false;
    size += header.name.length + header.value.length;
    if (size > 128000) return false;
    const value = unfoldedHeader(header.value);
    if (value === null) return false;
    const name = header.name.toLowerCase();
    if (name.startsWith('resent-')) return false;
    if (name === 'authentication-results') auth.push(value);
    if (name === 'from') froms.push(value);
    if (name === 'sender') senders.push(value);
  }
  // Never search past a first untrusted verdict for a later header claiming to pass.
  // Multiple result headers (including duplicate trusted IDs) are intentionally review-only.
  if (auth.length !== 1 || froms.length !== 1 || fromHeader(froms[0]) !== address ||
    senders.length > 1 || (senders.length === 1 && fromHeader(senders[0]) !== address)) return false;
  const clauses = auth[0].split(';').map(part => part.trim());
  if (clauses.at(-1) === '') clauses.pop();
  const authority = clauses.shift()?.toLowerCase();
  if (authority !== trustedAuthservId.toLowerCase() && authority !== `${trustedAuthservId.toLowerCase()} 1`) return false;
  const methods = new Set<string>();
  let aligned = false;
  for (const clause of clauses) {
    // Only unambiguous unquoted tokens. Comments/quoted properties/unknown syntax fail closed.
    const tokens = clause.split(/[ \t]+/u);
    const method = /^([a-z][a-z0-9_-]*)=([a-z][a-z0-9_-]*)$/iu.exec(tokens.shift() ?? '');
    if (!method) return false;
    const name = method[1].toLowerCase();
    if (methods.has(name)) return false;
    methods.add(name);
    const properties = new Map<string, string>();
    for (const token of tokens) {
      const property = /^([a-z][a-z0-9_.-]*)=([a-z0-9@._:/+=-]+)$/iu.exec(token);
      if (!property || properties.has(property[1].toLowerCase())) return false;
      properties.set(property[1].toLowerCase(), property[2].toLowerCase());
    }
    if (name === 'dmarc') {
      aligned = method[2].toLowerCase() === 'pass' && properties.get('header.from') === address.split('@')[1];
    }
  }
  return aligned;
}
