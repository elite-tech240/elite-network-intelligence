-- Scheduler plumbing and platform health helpers.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Shared secret used by pg_cron to call the monitoring-api job endpoint. The API verifies it
-- through check_cron_secret(); the secret never has to be copied into function env vars.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'monitoring_cron_secret',
  'Shared secret for pg_cron calls to monitoring-api jobs')
where not exists (select 1 from vault.secrets where name = 'monitoring_cron_secret');

create or replace function public.check_cron_secret(p_secret text) returns boolean
language sql security definer set search_path = public, vault as $$
  select p_secret is not null and length(p_secret) >= 32 and exists (
    select 1 from vault.decrypted_secrets where name = 'monitoring_cron_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

-- Tenant-scoped platform overview for owners/admins (called by the API after a membership check).
create or replace function public.platform_overview(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(x.t order by (x.t->>'bytes')::bigint desc), '[]'::jsonb) from (
       select jsonb_build_object('name', relname, 'bytes', pg_total_relation_size(relid), 'rows', n_live_tup) as t
       from pg_stat_user_tables where schemaname = 'public'
       order by pg_total_relation_size(relid) desc limit 12) x),
    'org_rows', jsonb_build_object(
       'devices', (select count(*) from public.devices where organization_id = p_org),
       'metrics_raw', (select count(*) from public.device_metrics where organization_id = p_org),
       'metrics_hourly', (select count(*) from public.device_metrics_hourly where organization_id = p_org),
       'logs', (select count(*) from public.device_logs where organization_id = p_org),
       'uptime_results', (select count(*) from public.uptime_results where organization_id = p_org),
       'audit_entries', (select count(*) from public.audit_logs where organization_id = p_org)),
    'last_tick', (select value || jsonb_build_object('at', updated_at) from public.platform_state where key = 'last_tick'),
    'last_rollup', (select value || jsonb_build_object('at', updated_at) from public.platform_state where key = 'last_rollup'),
    'jobs', (select coalesce(jsonb_agg(j), '[]'::jsonb) from (
       select jb.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 160) as message
       from cron.job_run_details d join cron.job jb on jb.jobid = d.jobid
       where jb.jobname like 'monitoring-%' order by d.start_time desc limit 8) j)
  ) into result;
  return result;
end $$;
revoke all on function public.platform_overview(uuid) from public, anon, authenticated;
grant execute on function public.platform_overview(uuid) to service_role;

-- Hourly rollup + retention. The one-minute tick job is scheduled once the API endpoint is live.
select cron.schedule('monitoring-rollup', '17 * * * *', $$select public.rollup_and_prune_monitoring()$$);
