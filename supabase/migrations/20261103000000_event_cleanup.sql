begin;

-- RLS on events still decides who may delete. Clean up only that event's owned
-- references before its deferred composite foreign keys are checked.
create function private.cleanup_event_references() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.alerts
    where user_id = old.user_id and event_id = old.id;
  update public.outlook_updates
    set event_id = null, actionable = false
    where user_id = old.user_id and event_id = old.id;
  return old;
end;
$$;

create trigger cleanup_event_references
before delete on public.events
for each row execute function private.cleanup_event_references();

-- Trigger invocation needs no client EXECUTE grant, including for service_role.
revoke all on function private.cleanup_event_references()
  from public, anon, authenticated, service_role;

commit;
