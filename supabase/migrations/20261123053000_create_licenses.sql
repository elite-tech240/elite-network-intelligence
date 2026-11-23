-- Snipe-IT-style Licenses: seats checked out/in like accessories, plus license key and expiry.
-- Applied live on 2026-11-23; kept here so the schema is reproducible.
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  license_key text,
  seats integer not null default 1 check (seats >= 0),
  site_id uuid references public.sites(id) on delete set null,
  vendor text,
  purchase_date date,
  expiration_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index licenses_org_idx on public.licenses(organization_id);

create table public.license_seats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  assigned_user_id uuid,
  assigned_to text,
  checked_out_at timestamptz not null default now(),
  checked_in_at timestamptz
);
create index license_seats_license_idx on public.license_seats(license_id);
create index license_seats_active_idx on public.license_seats(license_id) where checked_in_at is null;

alter table public.licenses enable row level security;
alter table public.license_seats enable row level security;

create policy "members can read licenses" on public.licenses for select
  using (exists (select 1 from organization_members m where m.organization_id = licenses.organization_id and m.user_id = (select auth.uid())));
create policy "members can read license seats" on public.license_seats for select
  using (exists (select 1 from organization_members m where m.organization_id = license_seats.organization_id and m.user_id = (select auth.uid())));
