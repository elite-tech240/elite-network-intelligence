-- Device identity, telemetry, alerting, and SNMP inventory foundation.
create table if not exists public.device_credentials (
  device_id uuid primary key references public.devices(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.device_metrics (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  cpu_percent real check (cpu_percent between 0 and 100),
  memory_percent real check (memory_percent between 0 and 100),
  disk_percent real check (disk_percent between 0 and 100),
  bytes_sent bigint check (bytes_sent >= 0),
  bytes_recv bigint check (bytes_recv >= 0),
  recorded_at timestamptz not null default now()
);
create index if not exists device_metrics_org_time_idx on public.device_metrics(organization_id, recorded_at desc);
create index if not exists device_metrics_device_time_idx on public.device_metrics(device_id, recorded_at desc);

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  metric text not null check (metric in ('cpu_percent','memory_percent','disk_percent','device_offline')),
  operator text not null default 'gt' check (operator in ('gt','gte')),
  threshold real check (threshold between 0 and 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists alert_rules_org_idx on public.alert_rules(organization_id, enabled);

create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  rule_id uuid references public.alert_rules(id) on delete set null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  title text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);
create index if not exists alert_events_org_time_idx on public.alert_events(organization_id, triggered_at desc);

create table if not exists public.snmp_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null,
  name text not null,
  host inet not null,
  port integer not null default 161 check (port between 1 and 65535),
  version text not null default '2c' check (version in ('2c','3')),
  credential_ciphertext text not null,
  enabled boolean not null default true,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (site_id, organization_id) references public.sites(id, organization_id) on delete cascade
);
create index if not exists snmp_targets_org_idx on public.snmp_targets(organization_id);

alter table public.device_credentials enable row level security;
alter table public.device_metrics enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alert_events enable row level security;
alter table public.snmp_targets enable row level security;

drop policy if exists "members read device metrics" on public.device_metrics;
create policy "members read device metrics" on public.device_metrics for select to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=device_metrics.organization_id and m.user_id=(select auth.uid())));
drop policy if exists "members read alert rules" on public.alert_rules;
create policy "members read alert rules" on public.alert_rules for select to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid())));
drop policy if exists "managers manage alert rules" on public.alert_rules;
create policy "managers manage alert rules" on public.alert_rules for all to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')))
with check (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists "members read alert events" on public.alert_events;
create policy "members read alert events" on public.alert_events for select to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=alert_events.organization_id and m.user_id=(select auth.uid())));
drop policy if exists "managers acknowledge alert events" on public.alert_events;
create policy "managers acknowledge alert events" on public.alert_events for update to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=alert_events.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')))
with check (exists (select 1 from public.organization_members m where m.organization_id=alert_events.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists "managers read SNMP targets" on public.snmp_targets;
create policy "managers read SNMP targets" on public.snmp_targets for select to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=snmp_targets.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')));
drop policy if exists "managers manage SNMP targets" on public.snmp_targets;
create policy "managers manage SNMP targets" on public.snmp_targets for all to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=snmp_targets.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')))
with check (exists (select 1 from public.organization_members m where m.organization_id=snmp_targets.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')));

-- Only trusted backend code may access device credentials and write telemetry/events.
revoke all on public.device_credentials from anon, authenticated;
grant select on public.device_metrics, public.alert_rules, public.alert_events to authenticated;
grant insert, update, delete on public.alert_rules to authenticated;
grant update on public.alert_events to authenticated;
grant select on public.snmp_targets to authenticated;
grant usage, select on sequence public.device_metrics_id_seq to service_role;
grant all on public.device_credentials, public.device_metrics, public.alert_events to service_role;
grant all on public.alert_rules, public.snmp_targets to service_role;
