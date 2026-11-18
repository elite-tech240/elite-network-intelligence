-- Aggregated report data computed in SQL so large organizations never hit API row limits.
create or replace function public.report_summary(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
with dev as (
  select id, hostname, device_type, status, created_at from public.devices
  where organization_id = p_org and archived_at is null
), down as (
  select e.device_id,
    sum(greatest(0, extract(epoch from (least(coalesce(e.resolved_at, p_to), p_to) - greatest(e.triggered_at, p_from))))) as secs
  from public.alert_events e
  where e.organization_id = p_org and e.source = 'offline' and e.triggered_at < p_to and coalesce(e.resolved_at, p_to) > p_from
  group by e.device_id
), usage as (
  select device_id, avg(cpu_avg) cpu_avg, max(cpu_max) cpu_max, avg(memory_avg) mem_avg, max(memory_max) mem_max,
         max(disk_max) disk_max, avg(net_sent_bps_avg) sent_bps, avg(net_recv_bps_avg) recv_bps
  from public.device_metrics_hourly
  where organization_id = p_org and bucket >= p_from and bucket < p_to
  group by device_id
), alerts as (
  select * from public.alert_events where organization_id = p_org and triggered_at >= p_from and triggered_at < p_to
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'devices', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'hostname', d.hostname, 'device_type', d.device_type, 'status', d.status,
      'availability_percent', round((100 * (1 - least(1, coalesce(dn.secs, 0) / greatest(1, extract(epoch from (p_to - greatest(p_from, d.created_at)))))))::numeric, 2),
      'cpu_avg', round(u.cpu_avg::numeric, 1), 'cpu_max', round(u.cpu_max::numeric, 1),
      'memory_avg', round(u.mem_avg::numeric, 1), 'memory_max', round(u.mem_max::numeric, 1),
      'disk_max', round(u.disk_max::numeric, 1),
      'net_sent_bps_avg', round(u.sent_bps::numeric, 0), 'net_recv_bps_avg', round(u.recv_bps::numeric, 0)
    ) order by d.hostname)
    from dev d left join down dn on dn.device_id = d.id left join usage u on u.device_id = d.id), '[]'::jsonb),
  'alerts', jsonb_build_object(
    'total', (select count(*) from alerts),
    'open', (select count(*) from public.alert_events where organization_id = p_org and status in ('open','acknowledged')),
    'by_severity', coalesce((select jsonb_object_agg(severity, c) from (select severity, count(*) c from alerts group by severity) s), '{}'::jsonb),
    'top', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'count', t.c) order by t.c desc)
      from (select regexp_replace(title, ': .*$', '') as title, count(*) c from alerts group by 1 order by c desc limit 5) t), '[]'::jsonb)
  ),
  'uptime_checks', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'checks', coalesce(r.total, 0),
      'availability_percent', case when coalesce(r.total, 0) = 0 then null else round((100.0 * r.up / r.total)::numeric, 2) end,
      'avg_latency_ms', round(r.lat::numeric, 0)) order by c.name)
    from public.uptime_checks c
    left join (select check_id, count(*) total, count(*) filter (where status = 'up') up, avg(latency_ms) filter (where status = 'up') lat
               from public.uptime_results where organization_id = p_org and checked_at >= p_from and checked_at < p_to group by check_id) r on r.check_id = c.id
    where c.organization_id = p_org), '[]'::jsonb),
  'logs', coalesce((select jsonb_object_agg(level, c) from (
      select level, count(*) c from public.device_logs where organization_id = p_org and logged_at >= p_from and logged_at < p_to group by level) l), '{}'::jsonb)
);
$$;
revoke all on function public.report_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.report_summary(uuid, timestamptz, timestamptz) to service_role;
