-- Run manually only after deploying outlook-worker and creating the two named Vault secrets.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'studenthub_outlook_worker_url' and decrypted_secret ~ '^https://[^/]+/functions/v1/outlook-worker$')
    or not exists (select 1 from vault.decrypted_secrets where name = 'studenthub_outlook_worker_secret' and length(decrypted_secret) between 32 and 256) then
    raise exception 'Configure the deployed worker URL and matching OUTLOOK_WORKER_SECRET in Vault first';
  end if;
end $$;
select cron.schedule('studenthub-outlook', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'studenthub_outlook_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'studenthub_outlook_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
commit;
