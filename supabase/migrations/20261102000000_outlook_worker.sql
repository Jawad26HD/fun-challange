begin;
alter table private.outlook_connections add column last_attempt_at timestamptz;

create function public.outlook_worker_claim() returns table(user_id uuid,email text)
language plpgsql security definer set search_path = '' as $$
declare candidate record;
begin
  for candidate in
    select c.user_id, c.email from private.outlook_connections c
    join auth.users u on u.id = c.user_id
    where (c.lease_until is null or c.lease_until < now())
      and (c.last_attempt_at is null or c.last_attempt_at < now() - interval '5 minutes')
      and lower(u.email) = c.email
      and u.raw_app_meta_data->>'provider' = 'azure'
      and coalesce(to_jsonb(u)->>'encrypted_password','') = ''
      and (to_jsonb(u)->>'deleted_at') is null
      and ((to_jsonb(u)->>'banned_until') is null or (to_jsonb(u)->>'banned_until')::timestamptz < now())
      and exists (select 1 from private.university_config where lower(split_part(u.email,'@',2)) = any(allowed_domains))
    order by c.last_attempt_at nulls first, c.user_id
    limit 1 for update of c skip locked
  loop
    update private.outlook_connections set last_attempt_at = now() where outlook_connections.user_id = candidate.user_id;
    user_id := candidate.user_id;
    email := candidate.email;
    return next;
  end loop;
end;
$$;
revoke all on function public.outlook_worker_claim() from public, anon, authenticated;
grant execute on function public.outlook_worker_claim() to service_role;
commit;
