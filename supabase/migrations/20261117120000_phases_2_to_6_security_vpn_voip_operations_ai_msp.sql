-- Phases 2-6: security, VPN, VoIP, controlled operations, and MSP/AI foundations.
-- This migration creates inventory/event models only. It does not push configuration to devices.
create table if not exists public.firewall_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  vendor text not null check (length(vendor) between 1 and 80),
  model text,
  firmware_version text,
  management_address inet,
  serial_number text,
  health_status text not null default 'unknown' check (health_status in ('healthy','degraded','critical','unknown')),
  last_config_sync_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists firewall_assets_org_site_idx on public.firewall_assets (organization_id, site_id);

create table if not exists public.firewall_policy_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  firewall_id uuid not null references public.firewall_assets(id) on delete cascade,
  external_policy_id text,
  policy_name text not null,
  action text not null check (action in ('allow','deny','reject','nat','unknown')),
  enabled boolean not null default true,
  source_zone text,
  destination_zone text,
  protocol text,
  source_summary jsonb not null default '{}'::jsonb,
  destination_summary jsonb not null default '{}'::jsonb,
  service_summary jsonb not null default '{}'::jsonb,
  hit_count bigint check (hit_count is null or hit_count >= 0),
  observed_at timestamptz not null default now()
);
create index if not exists firewall_policy_org_fw_time_idx on public.firewall_policy_snapshots (organization_id, firewall_id, observed_at desc);

create table if not exists public.firewall_security_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  firewall_id uuid references public.firewall_assets(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','high','critical')),
  source_address inet,
  destination_address inet,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists firewall_events_org_time_idx on public.firewall_security_events (organization_id, occurred_at desc);

create table if not exists public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_type text not null check (integration_type in ('firewall','vpn','voip','cloud','directory')),
  vendor text not null,
  label text not null,
  secret_ciphertext text not null,
  key_version text not null,
  enabled boolean not null default true,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists integration_credentials_org_type_idx on public.integration_credentials (organization_id, integration_type);

create table if not exists public.vpn_tunnels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  vendor text not null,
  tunnel_name text not null,
  tunnel_type text not null check (tunnel_type in ('ipsec','wireguard','ssl','openvpn','other')),
  local_endpoint inet,
  remote_endpoint inet,
  status text not null default 'unknown' check (status in ('up','down','degraded','unknown')),
  encryption_suite text,
  last_handshake_at timestamptz,
  observed_at timestamptz not null default now()
);
create index if not exists vpn_tunnels_org_status_idx on public.vpn_tunnels (organization_id, status);

create table if not exists public.vpn_session_metrics (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tunnel_id uuid not null references public.vpn_tunnels(id) on delete cascade,
  active_sessions integer check (active_sessions is null or active_sessions >= 0),
  bytes_in bigint check (bytes_in is null or bytes_in >= 0),
  bytes_out bigint check (bytes_out is null or bytes_out >= 0),
  latency_ms real check (latency_ms is null or latency_ms >= 0),
  packet_loss_percent real check (packet_loss_percent is null or packet_loss_percent between 0 and 100),
  recorded_at timestamptz not null default now()
);
create index if not exists vpn_session_metrics_org_tunnel_time_idx on public.vpn_session_metrics (organization_id, tunnel_id, recorded_at desc);

create table if not exists public.voip_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  extension text,
  endpoint_type text not null check (endpoint_type in ('phone','softphone','gateway','pbx','trunk','other')),
  vendor text,
  model text,
  ip_address inet,
  registration_status text not null default 'unknown' check (registration_status in ('registered','unregistered','degraded','unknown')),
  last_registered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists voip_endpoints_org_status_idx on public.voip_endpoints (organization_id, registration_status);

create table if not exists public.voip_call_quality (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid references public.voip_endpoints(id) on delete set null,
  call_reference_hash text,
  direction text check (direction in ('inbound','outbound','internal')),
  codec text,
  mos real check (mos is null or mos between 1 and 5),
  jitter_ms real check (jitter_ms is null or jitter_ms >= 0),
  latency_ms real check (latency_ms is null or latency_ms >= 0),
  packet_loss_percent real check (packet_loss_percent is null or packet_loss_percent between 0 and 100),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  sampled_at timestamptz not null default now()
);
create index if not exists voip_quality_org_time_idx on public.voip_call_quality (organization_id, sampled_at desc);

create table if not exists public.voip_trunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  vendor text not null,
  trunk_name text not null,
  signaling_protocol text not null check (signaling_protocol in ('sip','h323','other')),
  status text not null default 'unknown' check (status in ('up','down','degraded','unknown')),
  concurrent_calls integer check (concurrent_calls is null or concurrent_calls >= 0),
  capacity integer check (capacity is null or capacity >= 0),
  observed_at timestamptz not null default now()
);
create index if not exists voip_trunks_org_status_idx on public.voip_trunks (organization_id, status);

create table if not exists public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists maintenance_windows_org_time_idx on public.maintenance_windows (organization_id, starts_at, ends_at);

create table if not exists public.operation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('network_device','firewall','vpn','voip','agent')),
  target_id uuid not null,
  operation_type text not null,
  parameters jsonb not null default '{}'::jsonb,
  risk_level text not null default 'high' check (risk_level in ('low','medium','high','critical')),
  status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','scheduled','running','succeeded','failed','cancelled','expired')),
  requires_mfa boolean not null default true,
  maintenance_window_id uuid references public.maintenance_windows(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  approved_at timestamptz,
  executed_at timestamptz,
  completed_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists operation_requests_org_status_idx on public.operation_requests (organization_id, status, created_at desc);

create table if not exists public.operation_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_request_id uuid not null references public.operation_requests(id) on delete cascade,
  approver_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  comment text,
  mfa_verified_at timestamptz,
  decided_at timestamptz not null default now(),
  unique (operation_request_id, approver_id)
);
create index if not exists operation_approvals_org_request_idx on public.operation_approvals (organization_id, operation_request_id);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('user','agent','collector','system','ai')),
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null check (outcome in ('success','denied','failure','pending')),
  correlation_id uuid,
  source_ip inet,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists audit_logs_org_time_idx on public.audit_logs (organization_id, occurred_at desc);

create table if not exists public.msp_customer_access (
  id uuid primary key default gen_random_uuid(),
  provider_organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_organization_id uuid not null references public.organizations(id) on delete cascade,
  access_role text not null default 'viewer' check (access_role in ('viewer','operator','admin')),
  status text not null default 'pending' check (status in ('pending','active','suspended','revoked')),
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider_organization_id <> customer_organization_id),
  unique (provider_organization_id, customer_organization_id)
);
create index if not exists msp_customer_access_customer_idx on public.msp_customer_access (customer_organization_id, status);

create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  insight_type text not null check (insight_type in ('anomaly','capacity','availability','security','recommendation','root_cause')),
  severity text not null default 'info' check (severity in ('info','warning','high','critical')),
  title text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence real check (confidence is null or confidence between 0 and 1),
  status text not null default 'new' check (status in ('new','reviewed','dismissed','converted_to_request')),
  related_resource_type text,
  related_resource_id text,
  generated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);
create index if not exists ai_insights_org_time_idx on public.ai_insights (organization_id, generated_at desc);

-- Read-only tenant policies for operational inventory, telemetry, insights and audit history.
do $$
declare t text;
begin
  foreach t in array array[
    'firewall_assets','firewall_policy_snapshots','firewall_security_events',
    'vpn_tunnels','vpn_session_metrics','voip_endpoints','voip_call_quality','voip_trunks',
    'maintenance_windows','operation_requests','operation_approvals','audit_logs',
    'ai_insights','msp_customer_access'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_members m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())))', t || '_members_read', t, t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- MSP relationships and integration credentials are not directly readable by clients.
alter table public.integration_credentials enable row level security;
create policy integration_credentials_deny_clients on public.integration_credentials
  for all to anon, authenticated using (false) with check (false);
revoke all on public.integration_credentials from anon, authenticated;
grant all on public.integration_credentials to service_role;

-- Never allow client-side writes to operation, approval, audit, or telemetry records.
revoke insert, update, delete on public.firewall_assets, public.firewall_policy_snapshots,
  public.firewall_security_events, public.vpn_tunnels, public.vpn_session_metrics,
  public.voip_endpoints, public.voip_call_quality, public.voip_trunks,
  public.operation_requests, public.operation_approvals, public.audit_logs,
  public.ai_insights, public.msp_customer_access from anon, authenticated;
