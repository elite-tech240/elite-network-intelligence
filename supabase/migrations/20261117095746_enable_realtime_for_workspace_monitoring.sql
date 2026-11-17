-- Enable Postgres Changes for the tables consumed by the workspace live views.
-- All six tables already have RLS enabled; Realtime still evaluates row visibility
-- for authenticated subscribers. Keep this list explicit instead of publishing
-- every table in the public schema.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'devices',
    'sites',
    'networks',
    'device_metrics',
    'alert_events',
    'alert_rules'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
