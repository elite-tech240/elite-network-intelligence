-- Snipe-IT-style asset reference data: Locations, Companies, Manufacturers and Models, added as
-- lookup tables that asset management screens can list/manage. Not yet referenced by the assets
-- table itself (that FK wiring is a future step).
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);
create index locations_org_idx on public.locations(organization_id);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index companies_org_idx on public.companies(organization_id);

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  support_url text,
  created_at timestamptz not null default now()
);
create index manufacturers_org_idx on public.manufacturers(organization_id);

create table public.models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  manufacturer_id uuid references public.manufacturers(id) on delete set null,
  model_number text,
  created_at timestamptz not null default now()
);
create index models_org_idx on public.models(organization_id);

alter table public.locations enable row level security;
alter table public.companies enable row level security;
alter table public.manufacturers enable row level security;
alter table public.models enable row level security;

create policy "members can read locations" on public.locations for select
  using (exists (select 1 from organization_members m where m.organization_id = locations.organization_id and m.user_id = (select auth.uid())));
create policy "members can read companies" on public.companies for select
  using (exists (select 1 from organization_members m where m.organization_id = companies.organization_id and m.user_id = (select auth.uid())));
create policy "members can read manufacturers" on public.manufacturers for select
  using (exists (select 1 from organization_members m where m.organization_id = manufacturers.organization_id and m.user_id = (select auth.uid())));
create policy "members can read models" on public.models for select
  using (exists (select 1 from organization_members m where m.organization_id = models.organization_id and m.user_id = (select auth.uid())));
