-- Apply using the database owner. No token-bearing schema is exposed by PostgREST.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.university_config (
  singleton boolean primary key default true check (singleton),
  allowed_domains text[] not null default '{}'
);
-- Fail closed until an operator sets the university's exact email domains.
insert into private.university_config default values;

create function private.default_settings() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"display_name":"","language":"en","theme":"system","program":"","required_credits":132,"semester":"","timezone":"Asia/Amman","alert_types":{"assignment":true,"exam":true,"quiz":true,"personal":true,"lecture":true,"update":true},"reminder_minutes":30,"approved_senders":[],"outlook_auto_apply":false}'::jsonb;
$$;

create function private.valid_settings(s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; n numeric;
begin
  if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text) > 16000 then return false; end if;
  if not (s ?& array['display_name','language','theme','program','required_credits','semester','timezone','alert_types','reminder_minutes','approved_senders','outlook_auto_apply']) then return false; end if;
  for k,v in select * from jsonb_each(s) loop
    if k in ('display_name','program','semester') then
      if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 200 then return false; end if;
    elsif k = 'language' then
      if v not in ('"en"'::jsonb,'"ar"'::jsonb) then return false; end if;
    elsif k = 'theme' then
      if v not in ('"system"'::jsonb,'"light"'::jsonb,'"dark"'::jsonb) then return false; end if;
    elsif k = 'timezone' then
      if v <> '"Asia/Amman"'::jsonb then return false; end if;
    elsif k in ('required_credits','reminder_minutes') then
      if jsonb_typeof(v) <> 'number' then return false; end if;
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or n < 0 or n > (case when k = 'required_credits' then 1000 else 10080 end) then return false; end if;
    elsif k = 'outlook_auto_apply' then
      if jsonb_typeof(v) <> 'boolean' then return false; end if;
    elsif k = 'approved_senders' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 100 then return false; end if;
      if exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string'
        or length(x #>> '{}') > 254 or (x #>> '{}') !~ '^[a-z0-9.!#$%&''+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$') then return false; end if;
    elsif k = 'alert_types' then
      if jsonb_typeof(v) <> 'object' or not (v ?& array['assignment','exam','quiz','personal','lecture','update'])
        or (select count(*) from jsonb_object_keys(v)) <> 6
        or exists (select 1 from jsonb_each(v) x where jsonb_typeof(x.value) <> 'boolean') then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings jsonb not null default private.default_settings() check (private.valid_settings(settings))
);
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  code text not null check (length(code) between 1 and 40),
  title text not null check (length(title) between 1 and 300),
  title_ar text not null default '' check (length(title_ar) <= 300),
  instructor text not null default '' check (length(instructor) <= 200),
  instructor_email text not null default '' check (length(instructor_email) <= 254),
  room text not null default '' check (length(room) <= 200),
  credits numeric(5,2) not null default 0 check (credits >= 0 and credits <= 100),
  meeting_days smallint[] not null default '{}' check (meeting_days <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(meeting_days) <= 7 and array_position(meeting_days,null) is null),
  start_time text not null default '09:00' check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null default '10:00' check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time > start_time),
  unique (user_id,id)
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  course_id uuid,
  title text not null check (length(title) between 1 and 300),
  title_ar text not null default '' check (length(title_ar) <= 300),
  kind text not null check (kind in ('assignment','exam','quiz','personal')),
  starts_at timestamptz not null check (isfinite(starts_at)),
  location text not null default '' check (length(location) <= 200),
  notes text not null default '' check (length(notes) <= 10000),
  status text not null default 'pending' check (status in ('pending','completed')),
  source text not null default 'manual' check (source in ('manual','outlook','lms')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  outlook_update_id uuid,
  unique (user_id,id),
  foreign key (user_id,course_id) references public.courses(user_id,id) on delete no action deferrable initially deferred
);
create table public.study_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  code text not null check (length(code) between 1 and 40),
  title text not null check (length(title) between 1 and 300),
  title_ar text not null default '' check (length(title_ar) <= 300),
  credits numeric(5,2) not null default 0 check (credits >= 0 and credits <= 100),
  status text not null default 'remaining' check (status in ('completed','current','remaining')),
  category text not null default 'major' check (category in ('university','faculty','major'))
);
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  event_id uuid,
  kind text not null check (kind in ('assignment','exam','quiz','personal','lecture','update')),
  title text not null check (length(title) <= 300),
  body text not null check (length(body) <= 2000),
  created_at timestamptz not null default now(),
  seen_at timestamptz check (seen_at is null or isfinite(seen_at)),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete no action deferrable initially deferred
);
create table public.outlook_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  event_id uuid,
  message_id text not null check (length(message_id) between 1 and 1024),
  sender text not null check (length(sender) <= 254),
  subject text not null check (length(subject) <= 300),
  excerpt text not null check (length(excerpt) <= 1200),
  received_at timestamptz not null check (isfinite(received_at)),
  previous_start timestamptz,
  new_start timestamptz check (new_start is null or isfinite(new_start)),
  previous_location text,
  new_location text check (new_location is null or length(new_location) between 1 and 200),
  status text not null default 'pending' check (status in ('applied','pending','dismissed','reverted')),
  reason text not null check (length(reason) <= 2000),
  source_url text check (source_url is null or (length(source_url) <= 2048 and source_url ~ '^https://(outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com)/[^[:cntrl:]]*$')),
  old_snapshot jsonb,
  applied_snapshot jsonb,
  actionable boolean not null default false,
  trusted_sender boolean not null default false,
  authenticated_sender boolean not null default false,
  unambiguous boolean not null default false,
  direct_message boolean not null default false,
  explicit_timezone boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id,id),
  unique (user_id,message_id),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete no action deferrable initially deferred
);
alter table public.events add foreign key (user_id,outlook_update_id) references public.outlook_updates(user_id,id) deferrable initially deferred;
create index courses_owner on public.courses(user_id);
create index events_owner_start on public.events(user_id,starts_at);
create index events_course on public.events(user_id,course_id);
create index study_courses_owner on public.study_courses(user_id);
create index alerts_owner_created on public.alerts(user_id,created_at desc);
create index alerts_event on public.alerts(user_id,event_id);
create index outlook_updates_owner_status on public.outlook_updates(user_id,status);
create index outlook_updates_event on public.outlook_updates(user_id,event_id);

create function private.guard_event() returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and (new.id <> old.id or new.user_id <> old.user_id) then raise exception 'immutable_owner' using errcode = '42501'; end if;
  if current_user not in ('postgres','service_role','supabase_admin') then
    if TG_OP = 'INSERT' then
      if new.source <> 'manual' or new.outlook_update_id is not null then raise exception 'server_provenance_only' using errcode = '42501'; end if;
    else
      if new.source is distinct from old.source or new.outlook_update_id is distinct from old.outlook_update_id then raise exception 'server_provenance_only' using errcode = '42501'; end if;
      if (to_jsonb(new) - array['updated_at','created_at']) is distinct from (to_jsonb(old) - array['updated_at','created_at']) then
        new.source := 'manual'; new.outlook_update_id := null;
      end if;
    end if;
  end if;
  if TG_OP = 'INSERT' then new.created_at := clock_timestamp(); else new.created_at := old.created_at; end if;
  -- Always server-generated; stale snapshots cannot be made current by client timestamps.
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger guard_event before insert or update on public.events for each row execute function private.guard_event();

create function private.guard_university_auth() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Disabling email signup alone does not prevent updateUser({password: ...}). Reject
  -- password hashes and non-Azure identity linking at the Auth storage boundary too.
  if new.raw_app_meta_data->>'provider' is distinct from 'azure'
    or new.email is null
    or coalesce(to_jsonb(new)->>'encrypted_password','') <> ''
    or exists (select 1 from jsonb_array_elements_text(coalesce(new.raw_app_meta_data->'providers','["azure"]'::jsonb)) p where p <> 'azure')
    or not exists (select 1 from private.university_config where lower(split_part(new.email,'@',2)) = any(allowed_domains)) then
    raise exception 'University Microsoft sign-in required' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_planner_auth before insert or update on auth.users for each row execute function private.guard_university_auth();
create function private.provision_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values(new.id);
  return new;
end;
$$;
create trigger provision_planner_profile after insert on auth.users for each row execute function private.provision_profile();

create function private.microsoft_session() returns boolean
language sql stable security definer set search_path = '' as $$
  -- A linked Azure identity alone is insufficient: existing accounts can otherwise
  -- obtain email-OTP sessions even when email signup is disabled in GoTrue.
  select coalesce(auth.jwt()->'app_metadata'->>'provider' = 'azure'
    and auth.jwt()->'amr' @> '[{"method":"oauth"}]'::jsonb
    and exists (select 1 from private.university_config where lower(split_part(auth.jwt()->>'email','@',2)) = any(allowed_domains)),false);
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','courses','events','study_courses','alerts','outlook_updates'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_only on public.%I for all to authenticated using ((select auth.uid()) = user_id and (select private.microsoft_session())) with check ((select auth.uid()) = user_id and (select private.microsoft_session()))',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant update(settings) on public.profiles to authenticated;
grant insert, update, delete on public.courses, public.study_courses, public.events to authenticated;
grant update(seen_at) on public.alerts to authenticated;
-- No client INSERT/UPDATE/DELETE on audit/status tables or profile creation.

create table private.outlook_connections (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  email text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  consented_at timestamptz not null default now(),
  consent_version text not null default 'mail-read-v1',
  watermark timestamptz not null default (now() - interval '7 days'),
  window_end timestamptz,
  cursor text,
  last_synced_at timestamptz,
  error text,
  lease_id uuid,
  lease_until timestamptz
);
alter table private.outlook_connections enable row level security;
revoke all on private.outlook_connections, private.university_config from public, anon, authenticated, service_role;

create function private.event_snapshot(e public.events) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',e.id,'course_id',e.course_id,'title',e.title,'title_ar',e.title_ar,'kind',e.kind,
    'starts_at',e.starts_at,'location',e.location,'updated_at',e.updated_at,'source',e.source,'outlook_update_id',e.outlook_update_id);
$$;
create function private.notify_outlook(p_user_id uuid,p_event_id uuid,p_title text,p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Persistent in-app audit notifications; push delivery is intentionally not implied.
  insert into public.alerts(user_id,event_id,kind,title,body) values(p_user_id,p_event_id,'update',p_title,left(p_body,2000));
  perform pg_notify('outlook_update', jsonb_build_object('user_id',p_user_id,'event_id',p_event_id)::text);
end;
$$;

create function public.resolve_outlook_update(p_update_id uuid,p_action text) returns public.outlook_updates
language plpgsql security definer set search_path = '' as $$
declare u public.outlook_updates; e public.events; s jsonb;
begin
  if auth.uid() is null or not private.microsoft_session() then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('apply','dismiss','revert') then raise exception 'invalid_action' using errcode = '22023'; end if;
  select * into u from public.outlook_updates where id = p_update_id and user_id = auth.uid() for update;
  if not found then raise exception 'update_not_found' using errcode = 'P0002'; end if;
  -- Retried successful requests are idempotent, but may not reopen another state.
  if (p_action = 'apply' and u.status = 'applied') or (p_action = 'dismiss' and u.status = 'dismissed') or (p_action = 'revert' and u.status = 'reverted') then return u; end if;
  if p_action = 'dismiss' then
    if u.status <> 'pending' then raise exception 'invalid_transition'; end if;
    update public.outlook_updates set status = 'dismissed', resolved_at = now() where id = u.id returning * into u;
  else
    if (p_action = 'apply' and u.status <> 'pending') or (p_action = 'revert' and u.status <> 'applied') then raise exception 'invalid_transition'; end if;
    if not u.actionable or u.event_id is null or u.old_snapshot is null or (u.new_start is null and u.new_location is null) then raise exception 'incomplete_proposal'; end if;
    select * into e from public.events where id = u.event_id and user_id = u.user_id for update;
    if not found then raise exception 'event_not_found'; end if;
    s := private.event_snapshot(e);
    if p_action = 'apply' then
      if s is distinct from u.old_snapshot then raise exception 'stale_event'; end if;
      update public.events set starts_at = coalesce(u.new_start,starts_at), location = coalesce(u.new_location,location), source = 'outlook', outlook_update_id = u.id
        where id = e.id and user_id = u.user_id returning * into e;
      update public.outlook_updates set status = 'applied', applied_snapshot = private.event_snapshot(e), resolved_at = now() where id = u.id returning * into u;
    else
      if s is distinct from u.applied_snapshot or e.outlook_update_id is distinct from u.id then raise exception 'stale_event'; end if;
      update public.events set starts_at = u.previous_start, location = u.previous_location,
        source = u.old_snapshot->>'source', outlook_update_id = (u.old_snapshot->>'outlook_update_id')::uuid
        where id = e.id and user_id = u.user_id returning * into e;
      update public.outlook_updates set status = 'reverted', resolved_at = now() where id = u.id returning * into u;
    end if;
  end if;
  perform private.notify_outlook(u.user_id,u.event_id,'Outlook change ' || u.status,u.subject);
  return u;
end;
$$;

-- Server-only operation. The caller supplies an independently parsed proposal, never raw instructions.
-- Lease checks also prevent an in-flight sync from writing after disconnect/reconnect.
create function public.apply_outlook_proposal(p_user_id uuid,p_lease_id uuid,p_proposal jsonb) returns public.outlook_updates
language plpgsql security definer set search_path = '' as $$
declare u public.outlook_updates; e public.events; c public.courses; s jsonb; expected jsonb;
  ready boolean := false; trusted boolean := false; auto_apply boolean := false; settings jsonb; why text;
begin
  perform 1 from private.outlook_connections where user_id = p_user_id and lease_id = p_lease_id and lease_until > now() for update;
  if not found then raise exception 'sync_lease_lost'; end if;
  if jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text) > 24000 then raise exception 'invalid_proposal'; end if;
  select * into u from public.outlook_updates where user_id = p_user_id and message_id = p_proposal->>'message_id';
  if found then return u; end if;
  select p.settings into settings from public.profiles p where user_id = p_user_id for update;
  why := coalesce(p_proposal->>'reason','Needs manual review');
  if p_proposal->>'event_id' is not null then
    select * into e from public.events where id = (p_proposal->>'event_id')::uuid and user_id = p_user_id for update;
    if not found then raise exception 'event_not_found'; end if;
    select * into c from public.courses where id = e.course_id and user_id = p_user_id for update;
    s := private.event_snapshot(e);
    expected := p_proposal->'snapshot';
    -- Normalize timestamp JSON formatting while retaining all snapshot fields.
    if jsonb_typeof(expected) = 'object' then
      expected := expected || jsonb_build_object('starts_at',(expected->>'starts_at')::timestamptz,'updated_at',(expected->>'updated_at')::timestamptz);
    end if;
    if s is distinct from expected or c.code is distinct from p_proposal->>'course_code' then
      -- Persist the stale proposal, but never let a reviewer apply it later without reparsing.
      why := 'stale_event_or_course: ' || why;
    else
      ready := coalesce((p_proposal->>'actionable')::boolean,false)
        and e.kind = 'exam' and e.status = 'pending'
        and (p_proposal->>'new_start' is not null or nullif(p_proposal->>'new_location','') is not null);
    end if;
    trusted := lower(c.instructor_email) = lower(p_proposal->>'sender')
      and (settings->'approved_senders') ? lower(p_proposal->>'sender');
  end if;
  insert into public.outlook_updates(user_id,event_id,message_id,sender,subject,excerpt,received_at,previous_start,new_start,previous_location,new_location,reason,source_url,old_snapshot,actionable,trusted_sender,authenticated_sender,unambiguous,direct_message,explicit_timezone)
    values(p_user_id,e.id,p_proposal->>'message_id',lower(p_proposal->>'sender'),p_proposal->>'subject',p_proposal->>'excerpt',(p_proposal->>'received_at')::timestamptz,
      e.starts_at,(p_proposal->>'new_start')::timestamptz,e.location,p_proposal->>'new_location',left(why,2000),p_proposal->>'source_url',s,ready,coalesce(trusted,false),coalesce((p_proposal->>'authenticated_sender')::boolean,false),
      coalesce((p_proposal->>'unambiguous')::boolean,false),coalesce((p_proposal->>'direct_message')::boolean,false),coalesce((p_proposal->>'explicit_timezone')::boolean,false)) returning * into u;
  auto_apply := ready and coalesce(trusted,false) and u.unambiguous and u.direct_message and u.explicit_timezone
    and settings->>'timezone' = 'Asia/Amman' and coalesce((settings->>'outlook_auto_apply')::boolean,false)
    and u.authenticated_sender
    and (case when e.source = 'outlook' then
      u.received_at > (select received_at from public.outlook_updates where id = e.outlook_update_id and user_id = p_user_id)
      else u.received_at >= e.updated_at end)
    -- Independently fail closed if the catalog changed to contain duplicate candidates.
    and (select count(*) from public.events where user_id = p_user_id and course_id = e.course_id and kind = 'exam' and status = 'pending') = 1
    and (select count(*) from public.courses where user_id = p_user_id and upper(regexp_replace(code,'[[:space:]-]','','g')) = upper(regexp_replace(c.code,'[[:space:]-]','','g'))) = 1;
  if auto_apply then
    update public.events set starts_at = coalesce(u.new_start,starts_at), location = coalesce(u.new_location,location), source = 'outlook', outlook_update_id = u.id
      where id = e.id and user_id = p_user_id returning * into e;
    update public.outlook_updates set status = 'applied', resolved_at = now(), applied_snapshot = private.event_snapshot(e) where id = u.id returning * into u;
  end if;
  perform private.notify_outlook(p_user_id,u.event_id,case when u.status = 'applied' then 'Exam updated from Outlook' else 'Outlook change needs review' end,u.subject || ': ' || u.reason);
  return u;
end;
$$;

create function public.outlook_connection_put(p_user_id uuid,p_email text,p_access_token text,p_refresh_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_access_token !~ '^v1\.' or p_refresh_token !~ '^v1\.' or length(p_access_token) > 40000 or length(p_refresh_token) > 40000 then raise exception 'encrypted_tokens_required'; end if;
  insert into private.outlook_connections(user_id,email,access_token_ciphertext,refresh_token_ciphertext) values(p_user_id,p_email,p_access_token,p_refresh_token)
  on conflict(user_id) do update set email = excluded.email, access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext, consented_at = now(), error = null, lease_id = null, lease_until = null;
  -- Reconnect preserves cursor/watermark and audit deduplication, but invalidates any running worker.
end;
$$;
create function public.outlook_connection_status(p_user_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('connected',true,'email',email,'last_synced_at',last_synced_at,'error',error)
    from private.outlook_connections where user_id = p_user_id),'{"connected":false,"email":"","last_synced_at":null,"error":null}'::jsonb);
$$;
create function public.outlook_connection_delete(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.outlook_connections where user_id = p_user_id;
  -- Previously reviewed/applied changes and minimal audit stay visible. Mailbox permission must
  -- additionally be revoked by the user in Microsoft My Apps; Mail.Read cannot revoke consent.
end;
$$;
create function public.outlook_sync_begin(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.outlook_connections;
begin
  select * into c from private.outlook_connections where user_id = p_user_id for update;
  if not found then raise exception 'outlook_not_connected'; end if;
  if c.lease_until > now() then raise exception 'sync_in_progress'; end if;
  update private.outlook_connections set lease_id = gen_random_uuid(), lease_until = now() + interval '5 minutes',
    window_end = coalesce(window_end,now()), error = null where user_id = p_user_id returning * into c;
  return to_jsonb(c);
end;
$$;
create function public.outlook_sync_tokens(p_user_id uuid,p_lease_id uuid,p_access_token text,p_refresh_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_access_token !~ '^v1\.' or p_refresh_token !~ '^v1\.' then raise exception 'encrypted_tokens_required'; end if;
  update private.outlook_connections set access_token_ciphertext = p_access_token, refresh_token_ciphertext = p_refresh_token
    where user_id = p_user_id and lease_id = p_lease_id and lease_until > now();
  if not found then raise exception 'sync_lease_lost'; end if;
end;
$$;
create function public.outlook_sync_checkpoint(p_user_id uuid,p_lease_id uuid,p_cursor text,p_finished boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_finished is null or (p_finished and p_cursor is not null) or (not p_finished and p_cursor is null) then raise exception 'invalid_checkpoint'; end if;
  if p_cursor is not null and (length(p_cursor) > 16000 or p_cursor !~ '^https://graph\.microsoft\.com/v1\.0/me/messages\?') then raise exception 'invalid_cursor'; end if;
  update private.outlook_connections set cursor = p_cursor,
    -- A ten-minute overlap tolerates ordinary delivery/indexing delays; message IDs deduplicate.
    watermark = case when p_finished then greatest(watermark,window_end - interval '10 minutes') else watermark end,
    window_end = case when p_finished then null else window_end end,
    last_synced_at = case when p_finished then now() else last_synced_at end,
    lease_until = now() + interval '5 minutes'
    where user_id = p_user_id and lease_id = p_lease_id and lease_until > now();
  if not found then raise exception 'sync_lease_lost'; end if;
end;
$$;
create function public.outlook_sync_end(p_user_id uuid,p_lease_id uuid,p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.outlook_connections set lease_id = null, lease_until = null,
    error = case when p_error is null then null else 'Sync interrupted. Retry; reconnect if authorization expired.' end
    where user_id = p_user_id and lease_id = p_lease_id;
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default: remove it from every function here.
revoke all on all functions in schema private from public, anon, authenticated, service_role;
-- CHECK/default helpers contain no privileged data and are needed by ordinary inserts/updates.
grant usage on schema private to authenticated;
grant execute on function private.default_settings(), private.valid_settings(jsonb), private.microsoft_session() to authenticated;
revoke all on function public.resolve_outlook_update(uuid,text) from public, anon, service_role;
grant execute on function public.resolve_outlook_update(uuid,text) to authenticated;
revoke all on function public.apply_outlook_proposal(uuid,uuid,jsonb), public.outlook_connection_put(uuid,text,text,text), public.outlook_connection_status(uuid), public.outlook_connection_delete(uuid), public.outlook_sync_begin(uuid), public.outlook_sync_tokens(uuid,uuid,text,text), public.outlook_sync_checkpoint(uuid,uuid,text,boolean), public.outlook_sync_end(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.apply_outlook_proposal(uuid,uuid,jsonb), public.outlook_connection_put(uuid,text,text,text), public.outlook_connection_status(uuid), public.outlook_connection_delete(uuid), public.outlook_sync_begin(uuid), public.outlook_sync_tokens(uuid,uuid,text,text), public.outlook_sync_checkpoint(uuid,uuid,text,boolean), public.outlook_sync_end(uuid,uuid,text) to service_role;
commit;
