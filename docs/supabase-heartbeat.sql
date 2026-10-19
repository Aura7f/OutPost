-- Outpost heartbeat setup for Supabase
-- Run once in the SQL editor of the Supabase project you want to monitor.
--
-- This creates a single-row table and a narrowly-scoped SECURITY DEFINER RPC.
-- Outpost calls POST /rest/v1/rpc/outpost_heartbeat_ping with the project's
-- publishable/anon key. The anon role cannot read or write the table directly.
--
-- Supabase Free projects can be paused by Supabase policy. Heartbeat activity
-- may not prevent pausing; Outpost reports this limitation.

create table if not exists public.outpost_heartbeat (
  id boolean primary key default true check (id = true),
  last_ping_at timestamptz not null default now(),
  ping_count bigint not null default 0
);

alter table public.outpost_heartbeat enable row level security;
revoke all on table public.outpost_heartbeat from anon, authenticated;

insert into public.outpost_heartbeat (id) values (true)
on conflict (id) do nothing;

create or replace function public.outpost_heartbeat_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.outpost_heartbeat (id, last_ping_at, ping_count)
  values (true, now(), 1)
  on conflict (id) do update
    set last_ping_at = now(),
        ping_count = public.outpost_heartbeat.ping_count + 1
  returning last_ping_at;
$$;

revoke all on function public.outpost_heartbeat_ping() from public;
grant execute on function public.outpost_heartbeat_ping() to anon, authenticated;

-- Optional verification from the SQL editor:
--   select public.outpost_heartbeat_ping();
--   select * from public.outpost_heartbeat;
