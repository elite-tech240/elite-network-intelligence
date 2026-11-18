-- Full monitoring: device logs, usage detail, uptime checks, notifications, passive discovery,
-- retention/rollups, audit triggers and platform health. Telemetry tables are backend-written.

-- ---------------------------------------------------------------------------
-- 1. Usage detail on existing tables
-- ---------------------------------------------------------------------------
alter table public.device_metrics
  add column if not exists uptime_seconds bigint check (uptime_seconds is null or uptime_seconds >= 0),
  add column if not exists net_sent_bps real check (net_sent_bps is null or net_sent_bps >= 0),
  add column if not exists net_recv_bps real check (net_recv_bps is null or net_recv_bps >= 0),
  add column if not exists top_processes jsonb check (top_processes is null or jsonb_typeof(top_processes) = 'array');

alter table public.devices
  add column if not exists agent_version text check (agent_version is null or length(agent_version) <= 40);

alter table public.alert_rules drop constraint if exists alert_rules_threshold_check;
alter table public.alert_rules add constraint alert_rules_threshold_check check (
  threshold is null
  or (metric = 'device_offline' and threshold between 1 and 10080)
  or (metric <> 'device_offline' and threshold between 0 and 100)
);

alter table public.alert_events
  add column if not exists source text not null default 'metric' check (source in ('metric','offline','uptime','discovery','log')),
  add column if not exists uptime_check_id uuid,
  add column if not exists notified_at timestamptz,
  add column if not exists resolved_notified_at timestamptz;
-- Do not notify retroactively for alerts that already exist.
update public.alert_events set notified_at = coalesce(notified_at, now()), resolved_notified_at = coalesce(resolved_notified_at, now());
create index if not exists alert_events_unnotified_idx on public.alert_events (triggered_at) where notified_at is null;
create index if not exists alert_events_open_idx on public.alert_events (organization_id, status, triggered_at desc);

-- ---------------------------------------------------------------------------
-- 2. Device logs (Windows Event Log / journald) - backend written
-- ---------------------------------------------------------------------------
create table if not exists public.device_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  source text not null check (length(source) between 1 and 80),
  level text not null check (level in ('critical','error','warning','info','audit_failure')),
  event_id integer,
  provider text check (provider is null or length(provider) <= 160),
  message text not null check (length(message) <= 2000),
  dedupe_key text not null check (length(dedupe_key) between 1 and 200),
  logged_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (device_id, dedupe_key)
);
create index if not exists device_logs_org_time_idx on public.device_logs (organization_id, logged_at desc);
create index if not exists device_logs_device_time_idx on public.device_logs (device_id, logged_at desc);
create index if not exists device_logs_org_level_time_idx on public.device_logs (organization_id, level, logged_at desc);

-- ---------------------------------------------------------------------------
-- 3. Hourly rollups (raw metrics are pruned after 7 days)
-- ---------------------------------------------------------------------------
create table if not exists public.device_metrics_hourly (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  bucket timestamptz not null,
  samples integer not null,
  cpu_avg real, cpu_max real,
  memory_avg real, memory_max real,
  disk_avg real, disk_max real,
  net_sent_bps_avg real, net_recv_bps_avg real,
  net_sent_bps_max real, net_recv_bps_max real,
  primary key (device_id, bucket)
);
create index if not exists device_metrics_hourly_org_bucket_idx on public.device_metrics_hourly (organization_id, bucket desc);

-- ---------------------------------------------------------------------------
-- 4. Uptime checks (HTTP / TCP from the cloud to public targets)
-- ---------------------------------------------------------------------------
create table if not exists public.uptime_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  check_type text not null check (check_type in ('http','tcp')),
  target text not null check (length(target) between 1 and 253),
  port integer check (port is null or port between 1 and 65535),
  interval_seconds integer not null default 60 check (interval_seconds between 60 and 3600),
  timeout_ms integer not null default 5000 check (timeout_ms between 1000 and 15000),
  enabled boolean not null default true,
  status text not null default 'unknown' check (status in ('up','down','unknown')),
  consecutive_failures integer not null default 0,
  last_checked_at timestamptz,
  last_status_change_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    (check_type = 'http' and target ~* '^https?://[^[:space:]]+$')
    or (check_type = 'tcp' and port is not null and target ~* '^[a-z0-9.-]+$')
  )
);
create index if not exists uptime_checks_org_idx on public.uptime_checks (organization_id, enabled);
alter table public.alert_events drop constraint if exists alert_events_uptime_check_id_fkey;
alter table public.alert_events add constraint alert_events_uptime_check_id_fkey
  foreign key (uptime_check_id) references public.uptime_checks(id) on delete set null;

create table if not exists public.uptime_results (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  check_id uuid not null references public.uptime_checks(id) on delete cascade,
  status text not null check (status in ('up','down')),
  latency_ms real check (latency_ms is null or latency_ms >= 0),
  status_code integer,
  error text check (error is null or length(error) <= 300),
  checked_at timestamptz not null default now()
);
create index if not exists uptime_results_check_time_idx on public.uptime_results (check_id, checked_at desc);
create index if not exists uptime_results_org_time_idx on public.uptime_results (organization_id, checked_at desc);

create or replace function public.enforce_row_limit() returns trigger language plpgsql as $$
declare cap integer := tg_argv[0]::integer; current_count integer;
begin
  execute format('select count(*) from public.%I where organization_id = $1', tg_table_name) into current_count using new.organization_id;
  if current_count >= cap then
    raise exception 'Limit of % rows reached for %', cap, tg_table_name using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists uptime_checks_limit on public.uptime_checks;
create trigger uptime_checks_limit before insert on public.uptime_checks
  for each row execute function public.enforce_row_limit('50');

-- ---------------------------------------------------------------------------
-- 5. Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  channel_type text not null check (channel_type in ('email','telegram','webhook')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  min_severity text not null default 'warning' check (min_severity in ('info','warning','critical')),
  enabled boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists notification_channels_org_idx on public.notification_channels (organization_id, enabled);
drop trigger if exists notification_channels_limit on public.notification_channels;
create trigger notification_channels_limit before insert on public.notification_channels
  for each row execute function public.enforce_row_limit('10');

create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid references public.notification_channels(id) on delete set null,
  alert_event_id uuid references public.alert_events(id) on delete set null,
  kind text not null check (kind in ('alert','resolved','report','test')),
  status text not null check (status in ('sent','failed','skipped')),
  detail text check (detail is null or length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists notification_deliveries_org_time_idx on public.notification_deliveries (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Passive discovery (ARP/neighbour table reported by agents; no scanning)
-- ---------------------------------------------------------------------------
create table if not exists public.discovered_hosts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  reported_by_device_id uuid references public.devices(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  ip_address inet not null,
  mac_address macaddr not null,
  state text not null default 'new' check (state in ('new','known','ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (organization_id, site_id, mac_address)
);
create index if not exists discovered_hosts_org_state_idx on public.discovered_hosts (organization_id, state, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- 7. Platform health support
-- ---------------------------------------------------------------------------
create table if not exists public.platform_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.platform_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  level text not null check (level in ('info','warning','error')),
  source text not null check (length(source) <= 80),
  message text not null check (length(message) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists platform_events_org_time_idx on public.platform_events (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Row level security and grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['device_logs','device_metrics_hourly','uptime_checks','uptime_results','discovered_hosts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())))', t || '_members_read', t, t);
  end loop;
  foreach t in array array['notification_channels','notification_deliveries','platform_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admins_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'')))', t || '_admins_read', t, t);
  end loop;
end $$;
alter table public.platform_state enable row level security;

-- Browser-writable tables: operators manage checks/windows/discovery state; admins manage channels.
drop policy if exists uptime_checks_operators_insert on public.uptime_checks;
create policy uptime_checks_operators_insert on public.uptime_checks for insert to authenticated
  with check (exists (select 1 from public.organization_members m where m.organization_id = uptime_checks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists uptime_checks_operators_update on public.uptime_checks;
create policy uptime_checks_operators_update on public.uptime_checks for update to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = uptime_checks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')))
  with check (exists (select 1 from public.organization_members m where m.organization_id = uptime_checks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists uptime_checks_operators_delete on public.uptime_checks;
create policy uptime_checks_operators_delete on public.uptime_checks for delete to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = uptime_checks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists notification_channels_admins_insert on public.notification_channels;
create policy notification_channels_admins_insert on public.notification_channels for insert to authenticated
  with check (exists (select 1 from public.organization_members m where m.organization_id = notification_channels.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));
drop policy if exists notification_channels_admins_update on public.notification_channels;
create policy notification_channels_admins_update on public.notification_channels for update to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = notification_channels.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')))
  with check (exists (select 1 from public.organization_members m where m.organization_id = notification_channels.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));
drop policy if exists notification_channels_admins_delete on public.notification_channels;
create policy notification_channels_admins_delete on public.notification_channels for delete to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = notification_channels.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));

drop policy if exists maintenance_windows_operators_insert on public.maintenance_windows;
create policy maintenance_windows_operators_insert on public.maintenance_windows for insert to authenticated
  with check (exists (select 1 from public.organization_members m where m.organization_id = maintenance_windows.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists maintenance_windows_operators_update on public.maintenance_windows;
create policy maintenance_windows_operators_update on public.maintenance_windows for update to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = maintenance_windows.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')))
  with check (exists (select 1 from public.organization_members m where m.organization_id = maintenance_windows.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists maintenance_windows_operators_delete on public.maintenance_windows;
create policy maintenance_windows_operators_delete on public.maintenance_windows for delete to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = maintenance_windows.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists discovered_hosts_operators_update on public.discovered_hosts;
create policy discovered_hosts_operators_update on public.discovered_hosts for update to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = discovered_hosts.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')))
  with check (exists (select 1 from public.organization_members m where m.organization_id = discovered_hosts.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

do $$
declare t text;
begin
  foreach t in array array['device_logs','device_metrics_hourly','uptime_checks','uptime_results','discovered_hosts','notification_channels','notification_deliveries','platform_events','platform_state'] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
  foreach t in array array['device_logs','device_metrics_hourly','uptime_checks','uptime_results','discovered_hosts','notification_channels','notification_deliveries','platform_events'] loop
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.device_logs_id_seq, public.uptime_results_id_seq,
  public.notification_deliveries_id_seq, public.platform_events_id_seq to service_role;

-- Column-level write grants: status/health columns stay backend-only.
grant insert (organization_id, site_id, name, check_type, target, port, interval_seconds, timeout_ms, enabled) on public.uptime_checks to authenticated;
grant update (name, target, port, interval_seconds, timeout_ms, enabled) on public.uptime_checks to authenticated;
grant delete on public.uptime_checks to authenticated;
grant insert (organization_id, name, channel_type, config, min_severity, enabled) on public.notification_channels to authenticated;
grant update (name, config, min_severity, enabled) on public.notification_channels to authenticated;
grant delete on public.notification_channels to authenticated;
grant insert (organization_id, name, starts_at, ends_at) on public.maintenance_windows to authenticated;
grant update (name, starts_at, ends_at) on public.maintenance_windows to authenticated;
grant delete on public.maintenance_windows to authenticated;
grant update (state) on public.discovered_hosts to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Audit triggers for browser-originated changes (service-role writes are logged by the API)
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; uid uuid := auth.uid();
begin
  if uid is null then return coalesce(new, old); end if;
  r := to_jsonb(coalesce(new, old));
  insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, resource_type, resource_id, outcome, details)
  values ((r->>'organization_id')::uuid, uid, 'user', lower(tg_op), tg_table_name, r->>'id', 'success',
    jsonb_strip_nulls(jsonb_build_object('name', r->>'name', 'metric', r->>'metric', 'threshold', r->>'threshold',
      'enabled', r->>'enabled', 'status', r->>'status', 'state', r->>'state', 'title', r->>'title')));
  return coalesce(new, old);
end $$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sites','networks','alert_rules','alert_events','uptime_checks','notification_channels','maintenance_windows','discovered_hosts'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Retention / rollup job body
-- ---------------------------------------------------------------------------
create or replace function public.rollup_and_prune_monitoring() returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  insert into public.device_metrics_hourly as h (organization_id, device_id, bucket, samples,
    cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, disk_max,
    net_sent_bps_avg, net_recv_bps_avg, net_sent_bps_max, net_recv_bps_max)
  select organization_id, device_id, date_trunc('hour', recorded_at), count(*)::int,
    avg(cpu_percent), max(cpu_percent), avg(memory_percent), max(memory_percent), avg(disk_percent), max(disk_percent),
    avg(net_sent_bps), avg(net_recv_bps), max(net_sent_bps), max(net_recv_bps)
  from public.device_metrics
  where recorded_at >= now() - interval '14 days' and recorded_at < date_trunc('hour', now())
  group by organization_id, device_id, date_trunc('hour', recorded_at)
  on conflict (device_id, bucket) do update set samples = excluded.samples,
    cpu_avg = excluded.cpu_avg, cpu_max = excluded.cpu_max, memory_avg = excluded.memory_avg, memory_max = excluded.memory_max,
    disk_avg = excluded.disk_avg, disk_max = excluded.disk_max, net_sent_bps_avg = excluded.net_sent_bps_avg,
    net_recv_bps_avg = excluded.net_recv_bps_avg, net_sent_bps_max = excluded.net_sent_bps_max, net_recv_bps_max = excluded.net_recv_bps_max;
  get diagnostics n = row_count; result := result || jsonb_build_object('hourly_upserted', n);

  delete from public.device_metrics where recorded_at < now() - interval '7 days';
  get diagnostics n = row_count; result := result || jsonb_build_object('raw_metrics_deleted', n);
  delete from public.interface_metrics where recorded_at < now() - interval '7 days';
  get diagnostics n = row_count; result := result || jsonb_build_object('interface_metrics_deleted', n);
  delete from public.device_metrics_hourly where bucket < now() - interval '400 days';
  get diagnostics n = row_count; result := result || jsonb_build_object('hourly_deleted', n);
  delete from public.device_logs where logged_at < now() - interval '30 days';
  get diagnostics n = row_count; result := result || jsonb_build_object('logs_deleted', n);
  delete from public.uptime_results where checked_at < now() - interval '30 days';
  get diagnostics n = row_count; result := result || jsonb_build_object('uptime_results_deleted', n);
  delete from public.network_checks where checked_at < now() - interval '30 days';
  delete from public.notification_deliveries where created_at < now() - interval '90 days';
  delete from public.platform_events where created_at < now() - interval '30 days';
  insert into public.platform_state (key, value, updated_at) values ('last_rollup', result, now())
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return result;
end $$;
revoke all on function public.rollup_and_prune_monitoring() from public, anon, authenticated;
grant execute on function public.rollup_and_prune_monitoring() to service_role;

-- Default "device offline" rule so offline detection works out of the box (5 minutes).
insert into public.alert_rules (organization_id, name, metric, operator, threshold, enabled)
select o.id, 'Device offline', 'device_offline', 'gt', 5, true
from public.organizations o
where not exists (select 1 from public.alert_rules r where r.organization_id = o.id and r.metric = 'device_offline');
