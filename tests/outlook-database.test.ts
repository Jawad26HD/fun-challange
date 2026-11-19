import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parseOutlookMessage, type ParserCourse, type ParserEvent } from '../supabase/functions/_shared/outlook-parser.ts';
import type { Settings } from '../src/types.ts';

// In-memory PostgreSQL only: no Supabase project, mailbox, or real tokens.
// Run with: node --import tsx --test tests/outlook-database.test.ts
const a = '10000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
const email = (id: string) => `${id}@university.edu`;
const instructor = 'prof@university.edu';
type Json = Record<string, unknown>;
type Role = 'authenticated' | 'anon' | 'service_role';
interface Fixture { user: string; course: string; event: string; code: string }
interface Audit extends Json {
  id: string; event_id: string | null; status: string; actionable: boolean;
  reason: string; trusted_sender: boolean; old_snapshot: Json; applied_snapshot: Json | null;
}
interface Lease extends Json {
  lease_id: string; cursor: string | null; watermark: string; window_end: string | null;
  last_synced_at: string | null; error: string | null;
}

test('PostgreSQL migrations enforce Outlook ownership, replay safety, and event cleanup', async t => {
  const db = new PGlite();
  try {
    // Supabase Auth boundary reproduced from the recovered transcript bootstrap.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, encrypted_password text, raw_app_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      grant usage on schema auth to authenticated,anon,service_role;
    `);
    for (const migration of ['20261101000000_planner_outlook.sql', '20261102000000_outlook_worker.sql', '20261103000000_event_cleanup.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
    }

    // Each query commits independently, so deferred FKs are really checked and
    // expected SQL errors cannot leave later assertions in an aborted transaction.
    async function asRole<T = Json>(role: Role, sql: string, params: unknown[] = [], claims: Json = {}) {
      await db.exec(`set role ${role}`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [claims.sub ?? '', JSON.stringify(claims)]);
        return await db.query<T>(sql, params);
      } finally {
        await db.exec('reset role; reset request.jwt.claim.sub; reset request.jwt.claims;');
      }
    }
    function asUser<T = Json>(id: string, sql: string, params: unknown[] = [], claims: Json = {}) {
      return asRole<T>('authenticated', sql, params, {
        sub: id, email: email(id), app_metadata: { provider: 'azure' }, amr: [{ method: 'oauth' }], ...claims,
      });
    }
    function server<T = Json>(sql: string, params: unknown[] = []) {
      return asRole<T>('service_role', sql, params);
    }
    async function row(sql: string, params: unknown[] = []) {
      return (await db.query<Json>(sql, params)).rows[0];
    }
    async function addUser(id: string) {
      await db.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)', [id, email(id), { provider: 'azure', providers: ['azure'] }]);
    }
    async function settings(patch: Json, user = a) {
      await asUser(user, 'update public.profiles set settings = settings || $1::jsonb where user_id = $2', [patch, user]);
    }
    async function fixture(user = a): Promise<Fixture> {
      const f = { user, course: randomUUID(), event: randomUUID(), code: `CS${randomUUID().slice(0, 8)}` };
      await asUser(user, 'insert into public.courses(id,code,title,instructor_email) values($1,$2,$3,$4)', [f.course, f.code, 'Computing', instructor]);
      await asUser(user, "insert into public.events(id,course_id,title,kind,starts_at,location) values($1,$2,'Final exam','exam','2026-12-20T06:00:00Z','A-101')", [f.event, f.course]);
      return f;
    }
    async function snapshot(f: Fixture) {
      return (await db.query<{ snapshot: Json }>('select private.event_snapshot(e) as snapshot from public.events e where id = $1', [f.event])).rows[0].snapshot;
    }
    async function proposal(f: Fixture, overrides: Json = {}) {
      return {
        message_id: randomUUID(), sender: instructor, subject: `${f.code} final exam update`,
        excerpt: 'Explicit academic update', received_at: new Date(Date.now() + 60_000).toISOString(),
        source_url: 'https://outlook.office.com/mail/inbox', event_id: f.event, course_code: f.code,
        snapshot: await snapshot(f), new_start: '2026-12-20T07:00:00Z', new_location: 'B-204',
        actionable: true, authenticated_sender: true, direct_message: true, explicit_timezone: true,
        unambiguous: true, reason: 'Explicit date and time', ...overrides,
      };
    }
    async function connect(user = a) {
      await server("select public.outlook_connection_put($1,$2,'v1.test-only.access','v1.test-only.refresh')", [user, email(user)]);
      return begin(user);
    }
    async function begin(user = a) {
      return (await server<{ connection: Lease }>('select public.outlook_sync_begin($1) as connection', [user])).rows[0].connection;
    }
    async function persist(f: Fixture, lease: Lease, value: Json) {
      return (await server<{ audit: Audit }>('select to_jsonb(public.apply_outlook_proposal($1,$2,$3)) as audit', [f.user, lease.lease_id, value])).rows[0].audit;
    }
    async function resolve(id: string, action: string | null, user = a) {
      return (await asUser<{ audit: Audit }>(user, 'select to_jsonb(public.resolve_outlook_update($1,$2)) as audit', [id, action])).rows[0].audit;
    }
    async function alertCount(event: string) {
      return (await row('select count(*)::int as n from public.alerts where event_id = $1', [event])).n;
    }

    await t.test('university configuration defaults fail closed and Azure signup provisions safe settings', async () => {
      assert.deepEqual((await row('select allowed_domains from private.university_config')).allowed_domains, []);
      await assert.rejects(addUser(a), /University Microsoft sign-in required/u);
      assert.equal((await row('select count(*)::int as n from public.profiles')).n, 0);
      await db.exec("update private.university_config set allowed_domains = array['university.edu']");
      const invalid = [
        { email: email(a), metadata: {} },
        { email: email(a), metadata: { provider: 'email' } },
        { email: email(a), metadata: { provider: 'azure', providers: ['azure', 'email'] } },
        { email: email(a), metadata: { provider: 'azure' }, password: 'test-only-password-hash' },
        { email: 'a@eviluniversity.edu', metadata: { provider: 'azure' } },
        { email: 'a@university.edu.evil.test', metadata: { provider: 'azure' } },
        { email: null, metadata: { provider: 'azure' } },
      ];
      for (const value of invalid) {
        await assert.rejects(db.query('insert into auth.users(id,email,raw_app_meta_data,encrypted_password) values($1,$2,$3,$4)', [a, value.email, value.metadata, value.password ?? null]), /University Microsoft sign-in required/u);
      }
      await addUser(a);
      await addUser(b);
      const profiles = await asUser<{ settings: Json }>(a, 'select settings from public.profiles');
      assert.equal(profiles.rows.length, 1);
      assert.deepEqual(profiles.rows[0].settings, {
        display_name: '', language: 'en', theme: 'system', program: '', required_credits: 132,
        semester: '', timezone: 'Asia/Amman', alert_types: { assignment: true, exam: true, quiz: true, personal: true, lecture: true, update: true },
        reminder_minutes: 30, approved_senders: [], outlook_auto_apply: false,
      });
    });

    await t.test('auth storage rejects password/identity changes and RLS requires an exact university Azure OAuth session', async () => {
      for (const [sql, params] of [
        ['update auth.users set encrypted_password = $1 where id = $2', ['test-only-password-hash', a]],
        ['update auth.users set raw_app_meta_data = $1 where id = $2', [{ provider: 'email' }, a]],
        ['update auth.users set raw_app_meta_data = $1 where id = $2', [{ provider: 'azure', providers: ['azure', 'google'] }, a]],
        ['update auth.users set email = $1 where id = $2', ['a@outside.test', a]],
      ] as [string, unknown[]][]) {
        await assert.rejects(db.query(sql, params), /University Microsoft sign-in required/u);
      }
      const f = await fixture();
      const invalidClaims = [
        { amr: [{ method: 'otp' }] }, { amr: [{ method: 'password' }] }, { amr: [] },
        { app_metadata: { provider: 'email', providers: ['azure', 'email'] } },
        { email: 'a@eviluniversity.edu' }, { email: 'a@university.edu.evil.test' },
        { email: null }, { sub: '' },
      ];
      for (const claims of invalidClaims) {
        assert.equal((await asUser(a, 'select * from public.events', [], claims)).rows.length, 0);
        await assert.rejects(asUser(a, "insert into public.courses(code,title) values('BAD','Forbidden session')", [], claims), /row-level security/u);
        await assert.rejects(asUser(a, 'select public.resolve_outlook_update($1,$2)', [randomUUID(), 'apply'], claims), /unauthorized/u);
        assert.equal((await asUser(a, 'delete from public.events where id = $1 returning id', [f.event], claims)).rows.length, 0);
      }
      assert.equal((await asUser(a, 'select id from public.events where id = $1', [f.event], { email: email(a).toUpperCase() })).rows.length, 1);
      await assert.rejects(asRole('anon', 'select * from public.profiles'), /permission denied/u);
      await db.exec("update private.university_config set allowed_domains = '{}'");
      assert.equal((await asUser(a, 'select * from public.profiles')).rows.length, 0);
      await assert.rejects(addUser(randomUUID()), /University Microsoft sign-in required/u);
      await db.exec("update private.university_config set allowed_domains = array['university.edu']");
    });

    await t.test('owner RLS and composite FKs reject cross-user reads, writes, and references', async () => {
      const fa = await fixture();
      const fb = await fixture(b);
      const lease = await connect();
      const audit = await persist(fa, lease, await proposal(fa));
      await asUser(a, "insert into public.study_courses(code,title) values('PLAN','Study plan')");
      for (const table of ['profiles', 'courses', 'events', 'study_courses', 'alerts', 'outlook_updates']) {
        assert.equal((await asUser(b, `select * from public.${table} where user_id = $1`, [a])).rows.length, 0, table);
      }
      assert.equal((await asUser(b, "update public.events set title = 'hacked' where id = $1 returning id", [fa.event])).rows.length, 0);
      assert.equal((await asUser(b, 'update public.alerts set seen_at = now() where event_id = $1 returning id', [fa.event])).rows.length, 0);
      await assert.rejects(asUser(a, "insert into public.courses(user_id,code,title) values($1,'BAD','Bad owner')", [b]), /row-level security/u);
      await assert.rejects(asUser(a, 'update public.courses set user_id = $1 where id = $2', [b, fa.course]), /row-level security/u);
      await assert.rejects(asUser(a, "insert into public.events(course_id,title,kind,starts_at) values($1,'Bad reference','exam',now())", [fb.course]), /foreign key/u);
      await assert.rejects(asUser(a, 'update public.events set course_id = $1 where id = $2', [fb.course, fa.event]), /foreign key/u);
      await assert.rejects(db.query("insert into public.alerts(user_id,event_id,kind,title,body) values($1,$2,'update','Bad','Bad')", [b, fa.event]), /foreign key/u);
      await assert.rejects(db.query('update public.outlook_updates set event_id = $1 where id = $2', [fb.event, audit.id]), /foreign key/u);
      await assert.rejects(db.query('update public.events set outlook_update_id = $1 where id = $2', [audit.id, fb.event]), /foreign key/u);
      await assert.rejects(resolve(audit.id, 'apply', b), /update_not_found/u);
      await assert.rejects(persist(fb, await connect(b), await proposal(fa)), /event_not_found/u);
      assert.equal((await asUser(a, 'update public.alerts set seen_at = now() where event_id = $1 returning id', [fa.event])).rows.length, 1);
    });

    await t.test('client cannot access tokens, forge audit/status/alerts, or invoke server-only RPCs', async () => {
      for (const role of ['anon', 'authenticated', 'service_role'] as const) {
        for (const table of ['outlook_connections', 'university_config']) {
          await assert.rejects(asRole(role, `select * from private.${table}`), /permission denied/u);
        }
        assert.equal((await row("select has_function_privilege($1,'private.cleanup_event_references()','EXECUTE') as allowed", [role])).allowed, false);
        await assert.rejects(asRole(role, 'select private.cleanup_event_references()'), /permission denied/u);
      }
      const cleanup = await row("select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'cleanup_event_references'");
      assert.equal(cleanup.prosecdef, true);
      assert.deepEqual(cleanup.proconfig, ['search_path=""']);
      for (const sql of [
        "insert into public.profiles(user_id) values(auth.uid())",
        "insert into public.outlook_updates(message_id,sender,subject,excerpt,received_at,reason) values('forged','a@university.edu','x','x',now(),'x')",
        "update public.outlook_updates set status = 'applied'",
        'update public.outlook_updates set actionable = true, trusted_sender = true',
        'delete from public.outlook_updates',
        "insert into public.alerts(kind,title,body) values('update','Forged','Forged')",
        "update public.alerts set body = 'forged'", 'delete from public.alerts',
        'delete from public.profiles',
      ]) await assert.rejects(asUser(a, sql), /permission denied/u, sql);
      const rpcs: [string, unknown[]][] = [
        ['public.apply_outlook_proposal($1,$2,$3)', [a, randomUUID(), {}]],
        ['public.outlook_connection_put($1,$2,$3,$4)', [a, email(a), 'v1.fake', 'v1.fake']],
        ['public.outlook_connection_status($1)', [a]], ['public.outlook_connection_delete($1)', [a]],
        ['public.outlook_sync_begin($1)', [a]],
        ['public.outlook_sync_tokens($1,$2,$3,$4)', [a, randomUUID(), 'v1.fake', 'v1.fake']],
        ['public.outlook_sync_checkpoint($1,$2,$3,$4)', [a, randomUUID(), null, true]],
        ['public.outlook_sync_end($1,$2,$3)', [a, randomUUID(), null]],
      ];
      for (const [sql, params] of rpcs) {
        for (const role of ['authenticated', 'anon'] as const) {
          await assert.rejects(asRole(role, `select ${sql}`, params, { sub: a }), /permission denied/u, sql);
        }
      }
      await assert.rejects(server('select public.resolve_outlook_update($1,$2)', [randomUUID(), 'apply']), /permission denied/u);
      const status = (await server<{ status: Json }>('select public.outlook_connection_status($1) as status', [a])).rows[0].status;
      assert.deepEqual(Object.keys(status).sort(), ['connected', 'email', 'error', 'last_synced_at']);
      assert.equal(status.connected, true);
    });

    await t.test('settings validate types, bounds, exact sender addresses, and known keys', async () => {
      const invalid: Json[] = [
        { required_credits: -1 }, { required_credits: 1001 }, { required_credits: 1.5 }, { required_credits: '132' },
        { reminder_minutes: -1 }, { reminder_minutes: 10081 }, { reminder_minutes: 1.5 },
        { timezone: 'UTC' }, { language: 'fr' }, { theme: 'unknown' }, { display_name: 'x'.repeat(201) },
        { outlook_auto_apply: 'true' }, { outlook_auto_apply: null }, { outlook_connected: true },
        { approved_senders: ['*@university.edu'] }, { approved_senders: ['Prof@university.edu'] },
        { approved_senders: [1] }, { approved_senders: ['not-an-address'] },
        { approved_senders: Array(101).fill(instructor) }, { alert_types: {} },
        { alert_types: { assignment: true, exam: 'true', quiz: true, personal: true, lecture: true, update: true } },
        { alert_types: { assignment: true, exam: true, quiz: true, personal: true, lecture: true, update: true, extra: true } },
      ];
      for (const patch of invalid) await assert.rejects(settings(patch), /check constraint/u, JSON.stringify(patch));
      for (const value of [null, [], 'settings']) {
        await assert.rejects(asUser(a, 'update public.profiles set settings = $1::jsonb', [JSON.stringify(value)]), /check constraint/u);
      }
      await assert.rejects(asUser(a, "update public.profiles set settings = settings - 'timezone'"), /check constraint/u);
      await settings({ required_credits: 0, reminder_minutes: 0, language: 'ar', theme: 'dark', display_name: 'x'.repeat(200) });
      await settings({ required_credits: 1000, reminder_minutes: 10080, approved_senders: [instructor] });
      const f = await fixture();
      for (const sql of ["credits = -1", "credits = 101", "start_time = '25:00'", "end_time = '08:00'", "meeting_days = array[7]::smallint[]", "meeting_days = array[null]::smallint[]"]) {
        await assert.rejects(asUser(a, `update public.courses set ${sql} where id = $1`, [f.course]), /check constraint/u);
      }
      await asUser(a, 'update public.profiles set settings = private.default_settings()');
    });

    await t.test('client provenance and immutable identity are protected; manual edits clear Outlook provenance', async () => {
      const f = await fixture();
      const lease = await connect();
      const audit = await persist(f, lease, await proposal(f));
      for (const source of ['outlook', 'lms']) {
        await assert.rejects(asUser(a, 'update public.events set source = $1 where id = $2', [source, f.event]), /server_provenance_only/u);
        await assert.rejects(asUser(a, "insert into public.events(title,kind,starts_at,source) values('Forged','exam',now(),$1)", [source]), /server_provenance_only/u);
      }
      await assert.rejects(asUser(a, 'update public.events set outlook_update_id = $1 where id = $2', [audit.id, f.event]), /server_provenance_only/u);
      await assert.rejects(asUser(a, "insert into public.events(title,kind,starts_at,outlook_update_id) values('Forged','exam',now(),$1)", [audit.id]), /server_provenance_only/u);
      await assert.rejects(asUser(a, 'update public.events set user_id = $1 where id = $2', [b, f.event]), /immutable_owner/u);
      await assert.rejects(asUser(a, 'update public.events set id = $1 where id = $2', [randomUUID(), f.event]), /immutable_owner/u);
      await assert.rejects(asUser(a, 'update public.profiles set user_id = $1', [b]), /permission denied/u);
      await resolve(audit.id, 'apply');
      const applied = await row('select * from public.events where id = $1', [f.event]);
      assert.equal(applied.source, 'outlook');
      assert.equal(applied.outlook_update_id, audit.id);
      await asUser(a, "update public.events set notes = 'Student correction', created_at = '2000-01-01', updated_at = '2000-01-01' where id = $1", [f.event]);
      const edited = await row('select * from public.events where id = $1', [f.event]);
      assert.equal(edited.source, 'manual');
      assert.equal(edited.outlook_update_id, null);
      assert.deepEqual(edited.created_at, applied.created_at);
      assert.notDeepEqual(edited.updated_at, applied.updated_at);
      assert.notEqual(new Date(edited.updated_at as string).getUTCFullYear(), 2000);
      assert.equal((await row('select status from public.outlook_updates where id = $1', [audit.id])).status, 'applied');
      await assert.rejects(resolve(audit.id, 'revert'), /stale_event/u);
      assert.deepEqual(await row('select * from public.events where id = $1', [f.event]), edited);
    });

    await t.test('apply, dismiss, and revert are owner-only, atomic, idempotent state transitions', async () => {
      const f = await fixture();
      const lease = await connect();
      const original = await snapshot(f);
      const pending = await persist(f, lease, await proposal(f));
      assert.equal(pending.status, 'pending');
      assert.equal(pending.actionable, true);
      await assert.rejects(resolve(pending.id, 'apply', b), /update_not_found/u);
      await assert.rejects(resolve(pending.id, null), /invalid_action/u);
      await assert.rejects(resolve(pending.id, 'approve'), /invalid_action/u);
      await assert.rejects(resolve(pending.id, 'revert'), /invalid_transition/u);
      const applied = await resolve(pending.id, 'apply');
      assert.equal(applied.status, 'applied');
      assert.deepEqual(applied.old_snapshot, original);
      assert.deepEqual(applied.applied_snapshot, await snapshot(f));
      const afterApply = await snapshot(f);
      const applyAlerts = await alertCount(f.event);
      assert.deepEqual(await resolve(pending.id, 'apply'), applied);
      assert.deepEqual(await snapshot(f), afterApply);
      assert.equal(await alertCount(f.event), applyAlerts);
      await assert.rejects(resolve(pending.id, 'dismiss'), /invalid_transition/u);
      const reverted = await resolve(pending.id, 'revert');
      assert.equal(reverted.status, 'reverted');
      const afterRevert = await snapshot(f);
      for (const key of ['starts_at', 'location', 'source', 'outlook_update_id']) assert.deepEqual(afterRevert[key], original[key], key);
      const revertAlerts = await alertCount(f.event);
      assert.deepEqual(await resolve(pending.id, 'revert'), reverted);
      assert.deepEqual(await snapshot(f), afterRevert);
      assert.equal(await alertCount(f.event), revertAlerts);
      await assert.rejects(resolve(pending.id, 'apply'), /invalid_transition/u);
      const dismissible = await persist(f, lease, await proposal(f));
      const dismissed = await resolve(dismissible.id, 'dismiss');
      const dismissAlerts = await alertCount(f.event);
      assert.equal(dismissed.status, 'dismissed');
      assert.deepEqual(await resolve(dismissible.id, 'dismiss'), dismissed);
      assert.equal(await alertCount(f.event), dismissAlerts);
      assert.deepEqual(await snapshot(f), afterRevert);
      await assert.rejects(resolve(dismissible.id, 'apply'), /invalid_transition/u);
      await assert.rejects(resolve(dismissible.id, 'revert'), /invalid_transition/u);
    });

    await t.test('stale snapshots fail closed during ingestion, apply, and revert without partial writes', async () => {
      const f = await fixture();
      const lease = await connect();
      const staleValue = await proposal(f);
      await asUser(a, "update public.events set location = 'Student room' where id = $1", [f.event]);
      const stale = await persist(f, lease, staleValue);
      assert.equal(stale.actionable, false);
      assert.match(stale.reason, /^stale_event_or_course:/u);
      await assert.rejects(resolve(stale.id, 'apply'), /incomplete_proposal/u);
      const mismatched = await persist(f, lease, await proposal(f, { course_code: 'WRONG' }));
      assert.equal(mismatched.actionable, false);
      const current = await proposal(f);
      const first = await persist(f, lease, current);
      const second = await persist(f, lease, { ...current, message_id: randomUUID() });
      await resolve(first.id, 'apply');
      const beforeFailure = await snapshot(f);
      const alerts = await alertCount(f.event);
      await assert.rejects(resolve(second.id, 'apply'), /stale_event/u);
      assert.equal((await row('select status from public.outlook_updates where id = $1', [second.id])).status, 'pending');
      assert.deepEqual(await snapshot(f), beforeFailure);
      assert.equal(await alertCount(f.event), alerts);
      const newer = await persist(f, lease, await proposal(f, { new_location: 'C-305' }));
      await resolve(newer.id, 'apply');
      const latest = await snapshot(f);
      await assert.rejects(resolve(first.id, 'revert'), /stale_event/u);
      assert.deepEqual(await snapshot(f), latest);
      await resolve(newer.id, 'revert');
      assert.equal((await snapshot(f)).outlook_update_id, first.id);
      assert.equal((await snapshot(f)).source, 'outlook');
      // Restoring the old values must not restore a prior server timestamp.
      await assert.rejects(resolve(first.id, 'revert'), /stale_event/u);
    });

    await t.test('client timestamp spoofing cannot revive a stale proposal after a notes-only edit', async () => {
      const f = await fixture();
      const lease = await connect();
      const pending = await persist(f, lease, await proposal(f));
      await asUser(a, "update public.events set notes = 'Student notes', updated_at = $1 where id = $2", [pending.old_snapshot.updated_at, f.event]);
      const edited = await snapshot(f);
      assert.notEqual(edited.updated_at, pending.old_snapshot.updated_at);
      await assert.rejects(resolve(pending.id, 'apply'), /stale_event/u);
      assert.deepEqual(await snapshot(f), edited);
      assert.equal((await row('select status from public.outlook_updates where id = $1', [pending.id])).status, 'pending');
    });

    await t.test('safe autoapply requires every parser, sender, preference, and freshness gate', async () => {
      const lease = await connect();
      type Gate = { name: string; patch?: Json; preferences?: Json; edit?: string; actionable?: boolean; trusted?: boolean };
      const gates: Gate[] = [
        { name: 'opt-in', preferences: { outlook_auto_apply: false } },
        { name: 'approval', preferences: { approved_senders: [] }, trusted: false },
        { name: 'approved non-instructor', preferences: { approved_senders: ['other@university.edu'] }, patch: { sender: 'other@university.edu', trusted_sender: true }, trusted: false },
        { name: 'actionable', patch: { actionable: false }, actionable: false },
        { name: 'authenticated sender', patch: { authenticated_sender: false } },
        { name: 'missing authenticated sender', patch: { authenticated_sender: null } },
        { name: 'unambiguous', patch: { unambiguous: false } },
        { name: 'direct message', patch: { direct_message: false } },
        { name: 'explicit timezone', patch: { explicit_timezone: false } },
        { name: 'new values', patch: { new_start: null, new_location: null }, actionable: false },
        { name: 'pending exam', edit: "status = 'completed'", actionable: false },
        { name: 'exam kind', edit: "kind = 'assignment'", actionable: false },
        { name: 'received after manual change', patch: { received_at: '2000-01-01T00:00:00Z' } },
      ];
      for (const gate of gates) {
        await settings({ outlook_auto_apply: true, approved_senders: [instructor], ...gate.preferences });
        const f = await fixture();
        if (gate.edit) await asUser(a, `update public.events set ${gate.edit} where id = $1`, [f.event]);
        const before = await snapshot(f);
        const audit = await persist(f, lease, await proposal(f, gate.patch));
        assert.equal(audit.status, 'pending', gate.name);
        assert.equal(audit.actionable, gate.actionable ?? true, gate.name);
        if (gate.trusted !== undefined) assert.equal(audit.trusted_sender, gate.trusted, gate.name);
        assert.deepEqual(await snapshot(f), before, gate.name);
      }
      await settings({ outlook_auto_apply: true, approved_senders: [instructor] });
      const f = await fixture();
      // JSON timestamp spellings normalize to the same PostgreSQL snapshot.
      const normalized = { ...await snapshot(f) };
      normalized.starts_at = new Date(normalized.starts_at as string).toISOString();
      normalized.updated_at = (normalized.updated_at as string).replace('+00:00', 'Z');
      const applied = await persist(f, lease, await proposal(f, { snapshot: normalized, sender: instructor.toUpperCase() }));
      assert.equal(applied.status, 'applied');
      assert.equal(applied.trusted_sender, true);
      assert.equal((await snapshot(f)).outlook_update_id, applied.id);
      // A newer snapshot alone does not make an older/equal Outlook message safe.
      for (const received_at of [applied.received_at, '2000-01-01T00:00:00Z']) {
        const rejected = await persist(f, lease, await proposal(f, { received_at, new_location: 'Do not apply' }));
        assert.equal(rejected.status, 'pending');
        assert.equal((await snapshot(f)).outlook_update_id, applied.id);
      }
      const newer = await persist(f, lease, await proposal(f, { received_at: new Date(Date.now() + 120_000).toISOString(), new_location: 'C-305' }));
      assert.equal(newer.status, 'applied');
      await settings({ outlook_auto_apply: false, approved_senders: [] });
    });

    await t.test('autoapply independently requires exactly one pending exam and one normalized course', async () => {
      const lease = await connect();
      await settings({ outlook_auto_apply: true, approved_senders: [instructor] });
      for (const duplicate of ['pending exam', 'normalized course', 'completed exam', 'other owner']) {
        const f = await fixture();
        if (duplicate === 'pending exam' || duplicate === 'completed exam') {
          await asUser(a, "insert into public.events(course_id,title,kind,starts_at,status) values($1,'Other exam','exam',now(),$2)", [f.course, duplicate === 'pending exam' ? 'pending' : 'completed']);
        } else {
          await asUser(duplicate === 'other owner' ? b : a, 'insert into public.courses(code,title) values($1,$2)', [` ${f.code.toLowerCase().slice(0, 2)}-${f.code.slice(2)} `, 'Duplicate code']);
        }
        const audit = await persist(f, lease, await proposal(f));
        assert.equal(audit.status, duplicate === 'pending exam' || duplicate === 'normalized course' ? 'pending' : 'applied', duplicate);
      }
      await settings({ outlook_auto_apply: false, approved_senders: [] });
    });

    await t.test('leases are exclusive, expire, and reject stale workers; checkpoints and tokens are validated', async () => {
      const f = await fixture();
      const lease = await connect();
      const value = await proposal(f);
      await assert.rejects(begin(), /sync_in_progress/u);
      const wrong = { ...lease, lease_id: randomUUID() };
      await assert.rejects(persist(f, wrong, value), /sync_lease_lost/u);
      await assert.rejects(server("select public.outlook_sync_tokens($1,$2,'v1.fake','v1.fake')", [a, wrong.lease_id]), /sync_lease_lost/u);
      await assert.rejects(server('select public.outlook_sync_checkpoint($1,$2,null,true)', [a, wrong.lease_id]), /sync_lease_lost/u);
      await server('select public.outlook_sync_end($1,$2,null)', [a, wrong.lease_id]);
      await assert.rejects(begin(), /sync_in_progress/u);
      await assert.rejects(server("select public.outlook_connection_put($1,$2,'test-only-plaintext','v1.fake')", [a, email(a)]), /encrypted_tokens_required/u);
      await assert.rejects(server("select public.outlook_sync_tokens($1,$2,'v1.fake','test-only-plaintext')", [a, lease.lease_id]), /encrypted_tokens_required/u);
      for (const [cursor, finished] of [[null, false], ['https://graph.microsoft.com/v1.0/me/messages?$skiptoken=test', true], [null, null], ['https://evil.test/messages?x=1', false]] as const) {
        await assert.rejects(server('select public.outlook_sync_checkpoint($1,$2,$3,$4)', [a, lease.lease_id, cursor, finished]), /invalid_checkpoint|invalid_cursor/u);
      }
      await db.query("update private.outlook_connections set lease_until = now() - interval '1 second' where user_id = $1", [a]);
      await assert.rejects(persist(f, lease, value), /sync_lease_lost/u);
      await assert.rejects(server("select public.outlook_sync_tokens($1,$2,'v1.fake','v1.fake')", [a, lease.lease_id]), /sync_lease_lost/u);
      await assert.rejects(server('select public.outlook_sync_checkpoint($1,$2,null,true)', [a, lease.lease_id]), /sync_lease_lost/u);
      const fresh = await begin();
      assert.notEqual(fresh.lease_id, lease.lease_id);
      assert.equal(fresh.window_end, lease.window_end);
      await server('select public.outlook_sync_end($1,$2,$3)', [a, fresh.lease_id, 'test-only-sensitive-error-detail']);
      const status = (await server<{ status: Json }>('select public.outlook_connection_status($1) as status', [a])).rows[0].status;
      assert.equal(status.error, 'Sync interrupted. Retry; reconnect if authorization expired.');
      assert.ok(!JSON.stringify(status).includes('test-only-sensitive-error-detail'));
    });

    await t.test('message dedup survives replay/reconnect/disconnect and is scoped to the owner', async () => {
      const f = await fixture();
      const lease = await connect();
      const value = await proposal(f);
      const first = await persist(f, lease, value);
      const count = await alertCount(f.event);
      assert.deepEqual(await persist(f, lease, { ...value, new_location: 'Replay must not overwrite' }), first);
      assert.equal(await alertCount(f.event), count);
      const dismissed = await resolve(first.id, 'dismiss');
      assert.deepEqual(await persist(f, lease, value), dismissed);
      const cursor = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=test-only';
      await server('select public.outlook_sync_checkpoint($1,$2,$3,false)', [a, lease.lease_id, cursor]);
      const checkpoint = await row('select * from private.outlook_connections where user_id = $1', [a]);
      const reconnected = await connect();
      assert.equal(reconnected.cursor, cursor);
      assert.equal(reconnected.watermark, lease.watermark);
      assert.equal(reconnected.window_end, lease.window_end);
      assert.notEqual(reconnected.lease_id, lease.lease_id);
      await assert.rejects(persist(f, lease, value), /sync_lease_lost/u);
      assert.deepEqual(await persist(f, reconnected, value), dismissed);
      await server('select public.outlook_sync_checkpoint($1,$2,null,true)', [a, reconnected.lease_id]);
      const completed = await row('select * from private.outlook_connections where user_id = $1', [a]);
      assert.equal(completed.cursor, null);
      assert.equal(completed.window_end, null);
      assert.ok(completed.last_synced_at);
      assert.ok(new Date(completed.watermark as string).getTime() >= new Date(checkpoint.watermark as string).getTime());
      const fb = await fixture(b);
      const other = await persist(fb, await connect(b), await proposal(fb, { message_id: value.message_id }));
      assert.notEqual(other.id, first.id);
      await server('select public.outlook_connection_delete($1)', [a]);
      await assert.rejects(begin(), /outlook_not_connected/u);
      await assert.rejects(persist(f, reconnected, value), /sync_lease_lost/u);
      assert.deepEqual((await server<{ status: Json }>('select public.outlook_connection_status($1) as status', [a])).rows[0].status, { connected: false, email: '', last_synced_at: null, error: null });
      assert.deepEqual(await persist(f, await connect(), value), dismissed);
    });

    await t.test('regression control: the original deferred FKs reject deletion without the cleanup trigger', async () => {
      const f = await fixture();
      const lease = await connect();
      await persist(f, lease, await proposal(f));
      // This DDL exists only inside the in-memory test transaction and is rolled
      // back. It demonstrates the interrupted bug rather than merely assuming it.
      await db.exec('begin; alter table public.events disable trigger cleanup_event_references');
      try {
        await asUser(a, 'delete from public.events where id = $1', [f.event]);
        await assert.rejects(db.exec('set constraints all immediate'), /foreign key/u);
      } finally {
        await db.exec('rollback');
      }
      assert.equal((await db.query('select id from public.events where id = $1', [f.event])).rows.length, 1);
      assert.equal((await asUser(a, 'delete from public.events where id = $1 returning id', [f.event])).rows.length, 1);
      assert.equal(await alertCount(f.event), 0);
    });

    await t.test('event deletion removes alerts, retains complete nonactionable audit, and cannot affect another owner', async () => {
      const lease = await connect();
      const other = await fixture(b);
      const otherAudit = await persist(other, await connect(b), await proposal(other));
      const otherEvent = await snapshot(other);
      const otherAlerts = await alertCount(other.event);
      for (const state of ['pending', 'applied', 'dismissed', 'reverted']) {
        const f = await fixture();
        const initial = await persist(f, lease, await proposal(f));
        if (state === 'applied' || state === 'reverted') await resolve(initial.id, 'apply');
        if (state === 'reverted') await resolve(initial.id, 'revert');
        if (state === 'dismissed') await resolve(initial.id, 'dismiss');
        // Multiple references ensure cleanup isn't limited to the latest update.
        await persist(f, lease, await proposal(f));
        const before = (await db.query<Json>('select * from public.outlook_updates where event_id = $1 order by id', [f.event])).rows;
        assert.ok((await alertCount(f.event) as number) > 0);
        assert.equal((await asUser(b, 'delete from public.events where id = $1 returning id', [f.event])).rows.length, 0);
        assert.equal((await db.query('select id from public.events where id = $1', [f.event])).rows.length, 1);
        assert.deepEqual((await db.query('select * from public.outlook_updates where event_id = $1 order by id', [f.event])).rows, before);
        const deleted = await asUser(a, 'delete from public.events where id = $1 returning id', [f.event]);
        assert.deepEqual(deleted.rows, [{ id: f.event }]);
        assert.equal((await db.query('select id from public.events where id = $1', [f.event])).rows.length, 0);
        assert.equal(await alertCount(f.event), 0);
        for (const audit of before) {
          assert.deepEqual(await row('select * from public.outlook_updates where id = $1', [audit.id]), { ...audit, event_id: null, actionable: false });
        }
        if (state === 'pending') await assert.rejects(resolve(initial.id, 'apply'), /incomplete_proposal/u);
        if (state === 'applied') await assert.rejects(resolve(initial.id, 'revert'), /incomplete_proposal/u);
        assert.equal((await asUser(a, 'delete from public.events where id = $1 returning id', [f.event])).rows.length, 0);
      }
      assert.deepEqual(await snapshot(other), otherEvent);
      assert.equal(await alertCount(other.event), otherAlerts);
      assert.deepEqual((await server<{ audit: Audit }>('select to_jsonb(u) as audit from public.outlook_updates u where id = $1', [otherAudit.id])).rows[0].audit, otherAudit);
      const plain = await fixture();
      assert.equal((await asUser(a, 'delete from public.events where id = $1 returning id', [plain.event])).rows.length, 1);
    });

    await t.test('cleanup rolls back atomically and bulk deletion leaves unlinked alerts/audit untouched', async () => {
      const f = await fixture();
      const second = await fixture();
      const lease = await connect();
      const value = await proposal(f);
      await persist(f, lease, value);
      await persist(second, lease, await proposal(second));
      const unlinked = await persist(f, lease, await proposal(f, { event_id: null, snapshot: null, new_start: null, new_location: null, actionable: false }));
      const unlinkedAlerts = (await db.query('select * from public.alerts where user_id = $1 and event_id is null order by id', [a])).rows;
      const beforeAudits = (await db.query('select * from public.outlook_updates where event_id = $1 order by id', [f.event])).rows;
      const beforeAlerts = (await db.query('select * from public.alerts where event_id = $1 order by id', [f.event])).rows;
      // Deliberately roll back one transaction to prove the trigger's writes are
      // not detached from the delete that caused them.
      await db.exec('begin');
      try {
        await asUser(a, 'delete from public.events where id = $1', [f.event]);
        await db.exec('set constraints all immediate');
        assert.equal(await alertCount(f.event), 0);
      } finally {
        await db.exec('rollback');
      }
      assert.deepEqual((await db.query('select * from public.outlook_updates where event_id = $1 order by id', [f.event])).rows, beforeAudits);
      assert.deepEqual((await db.query('select * from public.alerts where event_id = $1 order by id', [f.event])).rows, beforeAlerts);
      const deleted = await asUser(a, 'delete from public.events where id in ($1,$2) returning id', [f.event, second.event]);
      assert.equal(deleted.rows.length, 2);
      assert.equal(await alertCount(f.event), 0);
      assert.equal(await alertCount(second.event), 0);
      assert.deepEqual((await db.query('select * from public.alerts where user_id = $1 and event_id is null order by id', [a])).rows, unlinkedAlerts);
      assert.deepEqual((await server<{ audit: Audit }>('select to_jsonb(u) as audit from public.outlook_updates u where id = $1', [unlinked.id])).rows[0].audit, unlinked);
      // Replaying the same mailbox message cannot recreate a deleted event or
      // reactivate the retained audit, even though its proposal has an old ID.
      const replay = await persist(f, lease, value);
      assert.equal(replay.event_id, null);
      assert.equal(replay.actionable, false);
      assert.equal((await db.query('select id from public.events where id = $1', [f.event])).rows.length, 0);
    });

    await t.test('profile and Auth-user cascades clean up circular event/audit references and token storage', async () => {
      for (const root of ['profiles', 'auth.users']) {
        const user = randomUUID();
        await addUser(user);
        const f = await fixture(user);
        const lease = await connect(user);
        const audit = await persist(f, lease, await proposal(f));
        await resolve(audit.id, 'apply', user);
        await asUser(user, "insert into public.study_courses(code,title) values('PLAN','Study plan')");
        if (root === 'profiles') await db.query('delete from public.profiles where user_id = $1', [user]);
        else await db.query('delete from auth.users where id = $1', [user]);
        for (const table of ['public.profiles', 'public.courses', 'public.events', 'public.study_courses', 'public.alerts', 'public.outlook_updates', 'private.outlook_connections']) {
          assert.equal((await db.query(`select * from ${table} where user_id = $1`, [user])).rows.length, 0, `${root}: ${table}`);
        }
        if (root === 'profiles') await db.query('delete from auth.users where id = $1', [user]);
        assert.equal((await db.query('select id from auth.users where id = $1', [user])).rows.length, 0);
        assert.equal((await asUser(b, 'select * from public.profiles')).rows.length, 1);
      }
    });
    await t.test('real parser output applies through SQL and ambiguous mail cannot change the exam', async () => {
      const user = randomUUID();
      await addUser(user);
      const f = await fixture(user);
      await asUser(user, "update public.courses set code = 'CS900' where id = $1", [f.course]);
      await settings({ approved_senders: [instructor], outlook_auto_apply: true }, user);
      const lease = await connect(user);
      const course = (await db.query<{ value: ParserCourse }>('select to_jsonb(c) as value from public.courses c where id = $1', [f.course])).rows[0].value;
      const event = (await db.query<{ value: ParserEvent }>('select to_jsonb(e) as value from public.events e where id = $1', [f.event])).rows[0].value;
      const preferences = (await db.query<{ settings: Settings }>('select settings from public.profiles where user_id = $1', [user])).rows[0].settings;
      const message = { id: randomUUID(), sender: instructor, from: instructor, subject: 'CS900 exam date update', text: 'CS900 exam moved to 2026-12-21 11:00 Asia/Amman.\nRoom: B-204', received_at: new Date(Date.now() + 60000).toISOString(), direct_recipient: true, authenticated_sender: true };
      const parsed = parseOutlookMessage(message, [course], [event], preferences);
      assert.ok(parsed?.actionable);
      const audit = await persist(f, lease, { ...parsed });
      assert.equal(audit.status, 'applied');
      assert.equal((await row('select location from public.events where id = $1', [f.event])).location, 'B-204');
      const uncertain = parseOutlookMessage({ ...message, id: randomUUID(), text: message.text + '\nThe date is tentative.' }, [course], [event], preferences);
      assert.equal(uncertain?.actionable, false);
      const review = await persist(f, lease, { ...uncertain });
      assert.equal(review.status, 'pending');
      await assert.rejects(resolve(review.id, 'apply', user), /incomplete_proposal/u);
      assert.equal((await row('select location from public.events where id = $1', [f.event])).location, 'B-204');
    });
  } finally {
    await db.close();
  }
});
