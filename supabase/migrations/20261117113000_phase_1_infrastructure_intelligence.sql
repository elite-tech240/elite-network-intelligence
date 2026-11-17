-- Phase 1: infrastructure intelligence data model.
-- Telemetry and discovery results are backend-written; browser clients are read-only.
create table if not exists public.device_interfaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  name text not null check (length(name) between 1 and 128),
  interface_index integer,
  description text,
  mac_address macaddr,
  admin_status text not null default 'unknown' check (admin_status in ('up','down','testing','unknown')),
  oper_status text not null default 'unknown' check (oper_status in ('up','down','testing','unknown')),
  speed_bps bigint check (speed_bps is null or speed_bps >= 0),
  mtu integer check (mtu is null or mtu between 576 and 9216),
  is_physical boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, name),
  unique (id, organization_id)
);
create index if not exists device_interfaces_org_device_idx on public.device_interfaces (organization_id, device_id);

create table if not exists public.interface_metrics (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  interface_id uuid not null references public.device_interfaces(id) on delete cascade,
  in_octets bigint check (in_octets is null or in_octets >= 0),
  out_octets bigint check (out_octets is null or out_octets >= 0),
  in_errors bigint check (in_errors is null or in_errors >= 0),
  out_errors bigint check (out_errors is null or out_errors >= 0),
  in_discards bigint check (in_discards is null or in_discards >= 0),
  out_discards bigint check (out_discards is null or out_discards >= 0),
  in_utilization_percent real check (in_utilization_percent is null or in_utilization_percent between 0 and 100),
  out_utilization_percent real check (out_utilization_percent is null or out_utilization_percent between 0 and 100),
  recorded_at timestamptz not null default now()
);
create index if not exists interface_metrics_org_interface_time_idx on public.interface_metrics (organization_id, interface_id, recorded_at desc);

create table if not exists public.network_checks (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  target text not null check (length(target) between 1 and 253),
  check_type text not null check (check_type in ('icmp','dns','tcp','http','dhcp')),
  status text not null check (status in ('ok','failed','timeout','degraded','unknown')),
  latency_ms real check (latency_ms is null or latency_ms >= 0),
  packet_loss_percent real check (packet_loss_percent is null or packet_loss_percent between 0 and 100),
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists network_checks_org_time_idx on public.network_checks (organization_id, checked_at desc);
create index if not exists network_checks_site_target_time_idx on public.network_checks (site_id, target, checked_at desc);

create table if not exists public.ipam_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  network_id uuid references public.networks(id) on delete set null,
  site_id uuid references public.sites(id) on delete set null,
  address inet not null,
  hostname text,
  mac_address macaddr,
  device_id uuid references public.devices(id) on delete set null,
  state text not null default 'unknown' check (state in ('available','used','reserved','conflict','unknown')),
  source text not null default 'manual' check (source in ('manual','agent','snmp','dhcp','discovery')),
  last_seen_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, address)
);
create index if not exists ipam_addresses_org_network_idx on public.ipam_addresses (organization_id, network_id);
create index if not exists ipam_addresses_device_idx on public.ipam_addresses (device_id) where device_id is not null;

create table if not exists public.vlans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  vlan_id integer not null check (vlan_id between 1 and 4094),
  name text not null check (length(name) between 1 and 128),
  description text,
  discovered_from_device_id uuid references public.devices(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, site_id, vlan_id)
);
create index if not exists vlans_org_site_idx on public.vlans (organization_id, site_id);

create table if not exists public.discovery_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  cidr_block cidr not null,
  status text not null default 'pending' check (status in ('pending','approved','running','completed','failed','cancelled')),
  rate_limit_per_second integer not null default 5 check (rate_limit_per_second between 1 and 50),
  max_hosts integer not null default 256 check (max_hosts between 1 and 4096),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (masklen(cidr_block) >= 16)
);
create index if not exists discovery_jobs_org_status_idx on public.discovery_jobs (organization_id, status, created_at desc);

-- Tenant-scoped read policies. No browser write grants are added in this phase.
do $$
declare t text;
begin
  foreach t in array array['device_interfaces','interface_metrics','network_checks','ipam_addresses','vlans','discovery_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())))', t || '_members_read', t, t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Explicitly keep discovery requests read-only from the browser; the trusted API
-- will validate membership, CIDR ownership, rate limits and approval before running.
