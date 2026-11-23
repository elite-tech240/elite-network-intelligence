-- Snipe-IT-style Components: parts (RAM, drives, etc) assigned by quantity to an ASSET, not a user.
-- Applied live on 2026-11-23; kept here so the schema is reproducible.
create table public.components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null default 'other',
  total_qty integer not null default 1 check (total_qty >= 0),
  min_qty integer check (min_qty is null or min_qty >= 0),
  site_id uuid references public.sites(id) on delete set null,
  vendor text,
  purchase_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index components_org_idx on public.components(organization_id);

create table public.component_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  component_id uuid not null references public.components(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  qty integer not null default 1 check (qty > 0),
  assigned_at timestamptz not null default now(),
  checked_in_at timestamptz
);
create index component_assignments_component_idx on public.component_assignments(component_id);
create index component_assignments_active_idx on public.component_assignments(component_id) where checked_in_at is null;

alter table public.components enable row level security;
alter table public.component_assignments enable row level security;

create policy "members can read components" on public.components for select
  using (exists (select 1 from organization_members m where m.organization_id = components.organization_id and m.user_id = (select auth.uid())));
create policy "members can read component assignments" on public.component_assignments for select
  using (exists (select 1 from organization_members m where m.organization_id = component_assignments.organization_id and m.user_id = (select auth.uid())));
