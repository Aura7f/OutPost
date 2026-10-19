-- Outpost tables are accessed exclusively by the NestJS API through Prisma.
-- The browser only uses Supabase Auth. Without RLS, Supabase's public schema
-- would expose these tables to PostgREST clients holding the anon key.
--
-- Enabling RLS with no policies denies anon/authenticated access. The API uses
-- the Supabase postgres role (table owner), which bypasses RLS. If you connect
-- the API with a custom role, grant it BYPASSRLS or add explicit policies.
-- Role revokes are conditional so this migration also works on plain PostgreSQL.

DO $$
DECLARE
  table_name text;
  outpost_tables text[] := ARRAY[
    'UserProfile',
    'Team',
    'TeamMember',
    'TeamInvitation',
    'Project',
    'Service',
    'Integration',
    'Monitor',
    'MonitorRun',
    'MonitoringJob',
    'DatabaseMetric',
    'HeartbeatRun',
    'ErrorGroup',
    'ErrorEvent',
    'Incident',
    'AlertRule',
    'NotificationChannel',
    'NotificationDelivery',
    'Report',
    'ReportSchedule',
    'ReportShare',
    'AuditLog',
    '_prisma_migrations'
  ];
BEGIN
  FOREACH table_name IN ARRAY outpost_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
