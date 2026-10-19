-- Outpost dispatcher for Supabase Cron (pg_cron + pg_net).
-- Run this in the SQL editor of the Outpost database, not in monitored projects.
--
-- Prerequisites:
--   1. Enable the pg_cron and pg_net extensions (Dashboard → Database → Extensions).
--   2. Deploy the API over HTTPS and set CRON_SECRET to a random value ≥ 32 chars.
--   3. Store the same value in Supabase Vault (see below).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the cron secret in Vault. Run once, then delete this statement.
-- The secret must exactly match the API's CRON_SECRET.
select vault.create_secret(
  'REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS',
  'outpost_cron_secret',
  'Outpost cron dispatcher secret'
);

-- To rotate the secret later, update Vault and the API environment, then restart:
-- select vault.update_secret(
--   (select id from vault.secrets where name = 'outpost_cron_secret' limit 1),
--   'NEW_RANDOM_SECRET'
-- );

-- Calls the API with the secret from Vault. SECURITY DEFINER is required so the
-- scheduled job can read Vault; execute is revoked from API-facing roles.
create or replace function public.outpost_dispatch_cron()
returns bigint
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  cron_secret text;
begin
  select decrypted_secret
    into cron_secret
    from vault.decrypted_secrets
   where name = 'outpost_cron_secret'
   limit 1;

  if cron_secret is null or length(cron_secret) < 32 then
    raise exception 'Outpost cron secret is missing or too short in Vault';
  end if;

  return net.http_post(
    url := 'https://api.yourdomain.com/v1/internal/cron/dispatch',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', cron_secret
    ),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.outpost_dispatch_cron() from public;
revoke all on function public.outpost_dispatch_cron() from anon, authenticated;

-- Safe re-run: remove the existing Outpost job if it exists.
select cron.unschedule(jobid)
from cron.job
where jobname = 'outpost-dispatch';

-- Every minute. The API enqueues and claims due work; overlapping calls are safe.
select cron.schedule(
  'outpost-dispatch',
  '* * * * *',
  $cron$select public.outpost_dispatch_cron();$cron$
);

-- Verify:
--   select jobid, schedule, command, active from cron.job where jobname = 'outpost-dispatch';
--   select status_code, timed_out, error_msg, created
--     from net._http_response order by created desc limit 10;
--   select * from cron.job_run_details order by start_time desc limit 10;
--
-- The API's GET /v1/internal/cron/status endpoint (X-Cron-Secret) reports job
-- counts, active workers, and overdue queued jobs for operational checks.
