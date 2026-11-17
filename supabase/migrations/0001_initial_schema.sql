create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','operator','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  location text,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.networks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null,
  name text not null,
  cidr cidr,
  created_at timestamptz not null default now(),
  foreign key (site_id, organization_id) references public.sites(id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null,
  network_id uuid,
  hostname text not null,
  device_type text not null default 'unknown',
  os_name text,
  os_version text,
  ip_address inet,
  mac_addresses text[] not null default '{}',
  status text not null default 'unknown' check (status in ('online','offline','degraded','unknown')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (site_id, organization_id) references public.sites(id, organization_id) on delete cascade,
  foreign key (network_id, organization_id) references public.networks(id, organization_id) on delete set null
);

create table if not exists public.enrollment_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null,
  token_hash text not null unique,
  label text not null default 'Agent token',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (site_id, organization_id) references public.sites(id, organization_id) on delete cascade
);

create index if not exists devices_org_last_seen_idx on public.devices (organization_id, last_seen_at desc);
create index if not exists devices_site_idx on public.devices (site_id);
create index if not exists enrollment_tokens_site_idx on public.enrollment_tokens (site_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sites enable row level security;
alter table public.networks enable row level security;
alter table public.devices enable row level security;
alter table public.enrollment_tokens enable row level security;

create policy "members can read own organizations" on public.organizations for select using (exists (select 1 from public.organization_members m where m.organization_id = id and m.user_id = auth.uid()));
create policy "members can read organization membership" on public.organization_members for select using (user_id = auth.uid() or exists (select 1 from public.organization_members m where m.organization_id = organization_id and m.user_id = auth.uid()));
create policy "members can read sites" on public.sites for select using (exists (select 1 from public.organization_members m where m.organization_id = sites.organization_id and m.user_id = auth.uid()));
create policy "members can read networks" on public.networks for select using (exists (select 1 from public.organization_members m where m.organization_id = networks.organization_id and m.user_id = auth.uid()));
create policy "members can read devices" on public.devices for select using (exists (select 1 from public.organization_members m where m.organization_id = devices.organization_id and m.user_id = auth.uid()));
-- Enrollment tokens are server-only. No authenticated-client policy is created.
