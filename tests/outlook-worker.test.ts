import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { requireWorkerRequest } from '../supabase/functions/_shared/outlook-worker-auth.ts';

const secret = 'test-only-worker-key-with-at-least-32-characters';
const request = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://worker.example.test', { method, headers: { Authorization: `Bearer ${secret}`, ...headers } });

test('worker requires a separate secret, POST, and no browser Origin', async () => {
  await requireWorkerRequest(request(), secret);
  await assert.rejects(requireWorkerRequest(request({}, 'GET'), secret), /method_not_allowed/u);
  await assert.rejects(requireWorkerRequest(request({ Origin: 'https://app.example.test' }), secret), /origin_not_allowed/u);
  await assert.rejects(requireWorkerRequest(request({ Authorization: 'Bearer ordinary-session-token' }), secret), /unauthorized/u);
  await assert.rejects(requireWorkerRequest(request({ Authorization: `Bearer ${secret}x` }), secret), /unauthorized/u);
  await assert.rejects(requireWorkerRequest(request(), 'short'), /worker_not_configured/u);
});

test('worker SQL is service-only, bounded, fair, and excludes revoked accounts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
      create schema auth;
      create table auth.users(id uuid primary key,email text,encrypted_password text,raw_app_meta_data jsonb not null default '{}',banned_until timestamptz,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      grant usage on schema auth to authenticated,anon,service_role;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261101000000_planner_outlook.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261102000000_outlook_worker.sql', import.meta.url), 'utf8'));
    await db.exec("update private.university_config set allowed_domains = array['university.edu'];");
    const a = '10000000-0000-4000-8000-000000000001';
    const b = '10000000-0000-4000-8000-000000000002';
    for (const [id, email] of [[a, 'a@university.edu'], [b, 'b@university.edu']]) {
      await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,'{\"provider\":\"azure\"}')", [id, email]);
      await db.query("select public.outlook_connection_put($1,$2,'v1.test-access','v1.test-refresh')", [id, email]);
    }
    async function claim() {
      await db.exec('set role service_role');
      try { return (await db.query<{ user_id: string; email: string }>('select * from public.outlook_worker_claim()')).rows; }
      finally { await db.exec('reset role'); }
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.query('select * from public.outlook_worker_claim()'), /permission denied/u); }
      finally { await db.exec('reset role'); }
    }
    assert.deepEqual((await claim()).map(row => row.user_id), [a]);
    assert.deepEqual((await claim()).map(row => row.user_id), [b]);
    assert.equal((await claim()).length, 0);
    await db.exec("update private.outlook_connections set last_attempt_at = now() - interval '10 minutes'");
    await db.query('select public.outlook_sync_begin($1)', [a]);
    assert.deepEqual((await claim()).map(row => row.user_id), [b]);
    await db.query('select public.outlook_connection_delete($1)', [a]);
    await db.exec("update private.outlook_connections set last_attempt_at = null");
    await db.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [b]);
    assert.equal((await claim()).length, 0);
    await db.query('update auth.users set banned_until = null, deleted_at = now() where id = $1', [b]);
    assert.equal((await claim()).length, 0);
    await db.query('update auth.users set deleted_at = null where id = $1', [b]);
    await db.exec("update private.university_config set allowed_domains = '{}'::text[]");
    assert.equal((await claim()).length, 0);
  } finally { await db.close(); }
});
