import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.1';
import type { Settings } from '../../../src/types.ts';
import { decryptToken, encryptToken } from './outlook-crypto.ts';
import { parseOutlookMessage, type ParserCourse, type ParserEvent } from './outlook-parser.ts';
import { processMailboxPages, type MailPage } from './outlook-pagination.ts';
import { requireWorkerRequest } from './outlook-worker-auth.ts';
import { assertMicrosoftSessionAfterValidation, azureClaimsAfterGraphValidation, OutlookError, requireGraphUrl, universityEmail, verifiedMailTransport, type MessageHeader } from './outlook-security.ts';

type Client = SupabaseClient;
type Operation = 'connect' | 'status' | 'sync' | 'disconnect';
interface Context { db: Client; userId: string; email: string; domains: string[] }
interface Connection {
  user_id: string; email: string; access_token_ciphertext: string; refresh_token_ciphertext: string;
  lease_id: string; cursor: string | null; watermark: string; window_end: string;
}
interface Address { emailAddress?: { address?: string } }
interface GraphMessage {
  id: string; subject?: string; from?: Address; sender?: Address; receivedDateTime: string;
  webLink?: string; hasAttachments?: boolean; toRecipients?: Address[];
  body?: { contentType?: string; content?: string }; internetMessageHeaders?: MessageHeader[];
}
interface TokenPair { access_token: string; refresh_token: string }
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
// User.Read is the baseline identity permission required by Graph /me (also used by
// Supabase Azure sign-in). Mail.Read is the ONLY mailbox permission; never .default.
const OAUTH_SCOPE = 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read';

function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new OutlookError('server_not_configured', 503);
  return value;
}
function tenantId(): string {
  const value = env('AZURE_TENANT_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new OutlookError('server_not_configured', 503);
  return value;
}
function allowedDomains(): string[] {
  const domains = env('UNIVERSITY_ALLOWED_DOMAINS').toLowerCase().split(',').map(s => s.trim());
  if (!domains.length || domains.some(domain => !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(domain))) throw new OutlookError('server_not_configured', 503);
  return domains;
}
async function readJson(response: Response | Request, limit: number): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new OutlookError('payload_too_large', 413); }
  if (!response.body) throw new OutlookError('invalid_json');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new OutlookError('payload_too_large', 413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof OutlookError) throw error;
    throw new OutlookError('invalid_json');
  } finally { reader.releaseLock(); }
}
async function graphJson<T>(url: string, token: string, purpose: 'page' | 'message' | 'identity'): Promise<T> {
  const safe = requireGraphUrl(url, purpose);
  const response = await fetch(safe, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new OutlookError(response.status === 401 ? 'graph_unauthorized' : response.status === 429 ? 'graph_rate_limited' : 'graph_request_failed', response.status === 401 ? 401 : 502);
  }
  return await readJson(response, purpose === 'identity' ? 64000 : 1024 * 1024) as T;
}
async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const response = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('AZURE_CLIENT_ID'), client_secret: env('AZURE_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: refreshToken, scope: OAUTH_SCOPE }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new OutlookError('microsoft_reconnect_required', 409); }
  const tokens = await readJson(response, 64000) as Partial<TokenPair>;
  if (typeof tokens.access_token !== 'string' || tokens.access_token.length > 20000 || !tokens.access_token) throw new OutlookError('invalid_microsoft_response', 502);
  const nextRefresh = tokens.refresh_token ?? refreshToken;
  if (typeof nextRefresh !== 'string' || !nextRefresh || nextRefresh.length > 20000) throw new OutlookError('invalid_microsoft_response', 502);
  return { access_token: tokens.access_token, refresh_token: nextRefresh };
}
async function verifyMicrosoftIdentity(token: string, email: string, domains: readonly string[]): Promise<string> {
  const me = await graphJson<{ id?: string; mail?: string }>(`${GRAPH_ROOT}/me?$select=id,mail`, token, 'identity');
  azureClaimsAfterGraphValidation(token, tenantId());
  if (typeof me.mail !== 'string' || typeof me.id !== 'string' || !me.id || universityEmail(me.mail, domains) !== email) throw new OutlookError('microsoft_account_mismatch', 403);
  return me.id;
}
async function authenticate(request: Request): Promise<Context> {
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.length > 10000 || !/^Bearer [A-Za-z0-9._-]+$/u.test(authorization)) throw new OutlookError('unauthorized', 401);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: { user }, error } = await db.auth.getUser(authorization.slice(7));
  if (error || !user) throw new OutlookError('unauthorized', 401);
  assertMicrosoftSessionAfterValidation(authorization.slice(7));
  if (user.app_metadata.provider !== 'azure' || !user.identities?.some(identity => identity.provider === 'azure') || !user.email) throw new OutlookError('university_microsoft_signin_required', 403);
  const domains = allowedDomains();
  return { db, userId: user.id, email: universityEmail(user.email, domains), domains };
}
async function rpc<T = unknown>(context: Context, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await context.db.rpc(name, args);
  if (error) {
    if (error.message.includes('sync_in_progress')) throw new OutlookError('sync_in_progress', 409);
    if (error.message.includes('outlook_not_connected')) throw new OutlookError('outlook_not_connected', 409);
    if (error.message.includes('sync_lease_lost')) throw new OutlookError('sync_lease_lost', 409);
    throw new OutlookError('storage_operation_failed', 503);
  }
  return data as T;
}
async function connect(context: Context, request: Request): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new OutlookError('json_required', 415);
  const body = await readJson(request, 48000) as Partial<TokenPair>;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['access_token','refresh_token'].includes(key)) ||
    typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 20000 ||
    typeof body.refresh_token !== 'string' || !body.refresh_token || body.refresh_token.length > 20000) throw new OutlookError('provider_tokens_required');
  const identityId = await verifyMicrosoftIdentity(body.access_token, context.email, context.domains);
  // Validate both supplied credentials, not just the access token. A mismatched refresh
  // credential must never connect somebody else's mailbox after the access token expires.
  const pair = await refreshTokens(body.refresh_token);
  if (await verifyMicrosoftIdentity(pair.access_token, context.email, context.domains) !== identityId) throw new OutlookError('microsoft_account_mismatch', 403);
  const key = env('OUTLOOK_TOKEN_ENCRYPTION_KEY');
  await rpc(context, 'outlook_connection_put', {
    p_user_id: context.userId, p_email: context.email,
    p_access_token: await encryptToken(pair.access_token, key, context.userId, 'access'),
    p_refresh_token: await encryptToken(pair.refresh_token, key, context.userId, 'refresh'),
  });
  return rpc(context, 'outlook_connection_status', { p_user_id: context.userId });
}
class Mailbox {
  private token = '';
  private refresh = '';
  private refreshed = false;
  constructor(private context: Context, private connection: Connection) {}
  async open(): Promise<void> {
    const key = env('OUTLOOK_TOKEN_ENCRYPTION_KEY');
    this.token = await decryptToken(this.connection.access_token_ciphertext, key, this.context.userId, 'access');
    this.refresh = await decryptToken(this.connection.refresh_token_ciphertext, key, this.context.userId, 'refresh');
    try { await verifyMicrosoftIdentity(this.token, this.context.email, this.context.domains); }
    catch (error) {
      if (!(error instanceof OutlookError) || error.code !== 'graph_unauthorized') throw error;
      await this.rotate();
    }
  }
  private async rotate(): Promise<void> {
    if (this.refreshed) throw new OutlookError('microsoft_reconnect_required', 409);
    this.refreshed = true;
    const pair = await refreshTokens(this.refresh);
    await verifyMicrosoftIdentity(pair.access_token, this.context.email, this.context.domains);
    const key = env('OUTLOOK_TOKEN_ENCRYPTION_KEY');
    await rpc(this.context, 'outlook_sync_tokens', {
      p_user_id: this.context.userId, p_lease_id: this.connection.lease_id,
      p_access_token: await encryptToken(pair.access_token, key, this.context.userId, 'access'),
      p_refresh_token: await encryptToken(pair.refresh_token, key, this.context.userId, 'refresh'),
    });
    this.token = pair.access_token; this.refresh = pair.refresh_token;
  }
  async get<T>(url: string, purpose: 'page' | 'message'): Promise<T> {
    try { return await graphJson<T>(url, this.token, purpose); }
    catch (error) {
      if (!(error instanceof OutlookError) || error.code !== 'graph_unauthorized') throw error;
      await this.rotate();
      return graphJson<T>(url, this.token, purpose);
    }
  }
}
async function allRows<T>(context: Context, table: 'courses' | 'events'): Promise<T[]> {
  // Never silently truncate the student's catalog at PostgREST's default row limit.
  const rows: T[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data, error } = await context.db.from(table).select('*').eq('user_id', context.userId).order('id').range(offset, offset + 499);
    if (error || !data) throw new OutlookError('storage_operation_failed', 503);
    rows.push(...data as T[]);
    if (data.length < 500) return rows;
  }
  throw new OutlookError('catalog_limit_exceeded', 409);
}
async function sync(context: Context): Promise<unknown> {
  const started = Date.now();
  const connection = await rpc<Connection>(context, 'outlook_sync_begin', { p_user_id: context.userId });
  let failed = true;
  try {
    if (connection.email !== context.email) throw new OutlookError('microsoft_account_mismatch', 403);
    const mailbox = new Mailbox(context, connection);
    await mailbox.open();
    const [courses, events, profile] = await Promise.all([
      allRows<ParserCourse>(context, 'courses'), allRows<ParserEvent>(context, 'events'),
      context.db.from('profiles').select('settings').eq('user_id', context.userId).single(),
    ]);
    if (profile.error || !profile.data) throw new OutlookError('storage_operation_failed', 503);
    const settings = profile.data.settings as Settings;
    const knownSenders = new Set([...settings.approved_senders, ...courses.map(course => course.instructor_email.toLowerCase())].filter(Boolean));
    const initial = new URL(`${GRAPH_ROOT}/me/messages`);
    initial.searchParams.set('$select', 'id,subject,from,sender,receivedDateTime,webLink,hasAttachments,toRecipients');
    initial.searchParams.set('$filter', `receivedDateTime ge ${new Date(connection.watermark).toISOString()} and receivedDateTime le ${new Date(connection.window_end).toISOString()}`);
    initial.searchParams.set('$orderby', 'receivedDateTime asc');
    initial.searchParams.set('$top', '25');
    const result = await processMailboxPages<GraphMessage>({
      cursor: connection.cursor, initialUrl: initial.href, maxPages: 3,
      shouldYield: () => Date.now() - started > 45000,
      getPage: url => mailbox.get<MailPage<GraphMessage>>(url, 'page'),
      process: async message => {
        if (typeof message.id !== 'string' || !message.id || message.id.length > 1024 || !Number.isFinite(Date.parse(message.receivedDateTime))) throw new OutlookError('invalid_graph_message', 502);
        const from = message.from?.emailAddress?.address?.toLowerCase() ?? '';
        const sender = message.sender?.emailAddress?.address?.toLowerCase() ?? from;
        if (!knownSenders.has(from) && !knownSenders.has(sender)) return false;
        const { data: seen, error } = await context.db.from('outlook_updates').select('id').eq('user_id', context.userId).eq('message_id', message.id).maybeSingle();
        if (error) throw new OutlookError('storage_operation_failed', 503);
        if (seen) return false;
        const detail = await mailbox.get<GraphMessage>(`${GRAPH_ROOT}/me/messages/${encodeURIComponent(message.id)}?$select=id,body,internetMessageHeaders`, 'message');
        if (detail.id !== message.id || detail.body?.contentType?.toLowerCase() !== 'text' || typeof detail.body.content !== 'string') throw new OutlookError('unsupported_message_body', 502);
        const headers = detail.internetMessageHeaders;
        if (!Array.isArray(headers) || headers.length > 500 || headers.some(header => typeof header.name !== 'string' || typeof header.value !== 'string')) throw new OutlookError('invalid_message_headers', 502);
        const proposal = parseOutlookMessage({
          id: message.id, sender, from, subject: message.subject ?? '', text: detail.body.content,
          received_at: message.receivedDateTime, source_url: message.webLink,
          direct_recipient: !!message.toRecipients?.some(recipient => recipient.emailAddress?.address?.toLowerCase() === context.email),
          authenticated_sender: verifiedMailTransport(headers, from, Deno.env.get('OUTLOOK_TRUSTED_AUTHSERV_ID')?.trim().toLowerCase() ?? ''),
          has_attachments: message.hasAttachments,
        }, courses, events, settings);
        if (!proposal) return false;
        await rpc(context, 'apply_outlook_proposal', { p_user_id: context.userId, p_lease_id: connection.lease_id, p_proposal: proposal });
        // Re-read after every proposal: a following email cannot use the pre-apply snapshot.
        // A concurrent manual edit between parse and RPC still fails the SQL snapshot check.
        if (proposal.event_id) {
          const { data, error: eventError } = await context.db.from('events').select('*').eq('user_id', context.userId).eq('id', proposal.event_id).single();
          if (eventError) throw new OutlookError('storage_operation_failed', 503);
          const index = events.findIndex(event => event.id === proposal.event_id);
          if (index >= 0) events[index] = data as ParserEvent;
        }
        return true;
      },
      checkpoint: (cursor, finished) => rpc<void>(context, 'outlook_sync_checkpoint', { p_user_id: context.userId, p_lease_id: connection.lease_id, p_cursor: cursor, p_finished: finished }),
    });
    failed = false;
    return { ...result, ...await rpc<Record<string, unknown>>(context, 'outlook_connection_status', { p_user_id: context.userId }) };
  } finally {
    // Do not mask the original failure or expose token/Graph/SQL diagnostics to the client.
    // If storage is unavailable, the lease expires and the same unacknowledged page replays.
    try { await rpc(context, 'outlook_sync_end', { p_user_id: context.userId, p_lease_id: connection.lease_id, p_error: failed ? 'interrupted' : null }); } catch { /* lease expiry recovers */ }
  }
}

export async function handleOutlookWorker(request: Request): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    await requireWorkerRequest(request, env('OUTLOOK_WORKER_SECRET'));
    if (request.body) {
      const body = await readJson(request, 32);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new OutlookError('empty_body_required');
    }
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await db.rpc('outlook_worker_claim');
    if (error) throw new OutlookError('storage_operation_failed', 503);
    const candidate = (data as { user_id: string; email: string }[] | null)?.[0];
    if (!candidate) return new Response(JSON.stringify({ attempted: 0, synced: 0, failed: 0 }), { headers });
    try {
      const domains = allowedDomains();
      const email = universityEmail(candidate.email, domains);
      await sync({ db, userId: candidate.user_id, email, domains });
      return new Response(JSON.stringify({ attempted: 1, synced: 1, failed: 0 }), { headers });
    } catch {
      return new Response(JSON.stringify({ attempted: 1, synced: 0, failed: 1 }), { headers });
    }
  } catch (error) {
    const safe = error instanceof OutlookError ? error : new OutlookError('worker_failed', 503);
    return new Response(JSON.stringify({ error: safe.code }), { status: safe.status, headers });
  }
}

export async function handleOutlook(operation: Operation, request: Request): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  try {
    const origin = request.headers.get('origin');
    if (origin) {
      const origins = (Deno.env.get('OUTLOOK_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);
      if (!origins.includes(origin)) throw new OutlookError('origin_not_allowed', 403);
      headers.set('Access-Control-Allow-Origin', origin);
    }
    headers.set('Access-Control-Allow-Methods', operation === 'status' ? 'GET, POST, OPTIONS' : 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST' && !(operation === 'status' && request.method === 'GET')) throw new OutlookError('method_not_allowed', 405);
    const context = await authenticate(request);
    let result: unknown;
    if (operation === 'connect') result = await connect(context, request);
    else if (operation === 'status') result = await rpc(context, 'outlook_connection_status', { p_user_id: context.userId });
    else if (operation === 'sync') result = await sync(context);
    else {
      await rpc(context, 'outlook_connection_delete', { p_user_id: context.userId });
      result = { connected: false, email: '', last_synced_at: null, error: null };
    }
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    // Intentionally no console logging: errors from OAuth/Graph may embed credentials or mail.
    const safe = error instanceof OutlookError ? error : new OutlookError('outlook_operation_failed', 503);
    return new Response(JSON.stringify({ error: safe.code }), { status: safe.status, headers });
  }
}
