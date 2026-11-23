-- Snipe-IT-style Accessories: non-serialized items checked out by quantity (no asset tag).
-- Applied live on 2026-11-23; kept here so the schema is reproducible.
create table public.accessories (
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
create index accessories_org_idx on public.accessories(organization_id);

create table public.accessory_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  accessory_id uuid not null references public.accessories(id) on delete cascade,
  assigned_user_id uuid,
  assigned_to text,
  checked_out_at timestamptz not null default now(),
  checked_in_at timestamptz
);
create index accessory_checkouts_accessory_idx on public.accessory_checkouts(accessory_id);
create index accessory_checkouts_active_idx on public.accessory_checkouts(accessory_id) where checked_in_at is null;

alter table public.accessories enable row level security;
alter table public.accessory_checkouts enable row level security;

create policy "members can read accessories" on public.accessories for select
  using (exists (select 1 from organization_members m where m.organization_id = accessories.organization_id and m.user_id = (select auth.uid())));
create policy "members can read accessory checkouts" on public.accessory_checkouts for select
  using (exists (select 1 from organization_members m where m.organization_id = accessory_checkouts.organization_id and m.user_id = (select auth.uid())));
