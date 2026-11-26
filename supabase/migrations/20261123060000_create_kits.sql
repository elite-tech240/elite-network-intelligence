-- Snipe-IT-style Predefined Kits: a named bundle of accessories/consumables/licenses
-- that can be checked out together to one user in a single action.
create table public.kits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  site_id uuid references public.sites(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kits_org_idx on public.kits(organization_id);

create table public.kit_items (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_type text not null check (item_type in ('accessory', 'consumable', 'license')),
  item_id uuid not null,
  qty integer not null default 1 check (qty > 0)
);
create index kit_items_kit_idx on public.kit_items(kit_id);

-- History log of kit checkouts (the actual per-item checkouts land in
-- accessory_checkouts / consumable_uses / license_seats as usual; this is just
-- a record that a kit was handed out, for traceability on the Kits page).
create table public.kit_checkouts (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assigned_user_id uuid,
  assigned_to text,
  checked_out_at timestamptz not null default now()
);
create index kit_checkouts_kit_idx on public.kit_checkouts(kit_id);

alter table public.kits enable row level security;
alter table public.kit_items enable row level security;
alter table public.kit_checkouts enable row level security;

create policy "members can read kits" on public.kits for select
  using (exists (select 1 from organization_members m where m.organization_id = kits.organization_id and m.user_id = (select auth.uid())));
create policy "members can read kit items" on public.kit_items for select
  using (exists (select 1 from organization_members m where m.organization_id = kit_items.organization_id and m.user_id = (select auth.uid())));
create policy "members can read kit checkouts" on public.kit_checkouts for select
  using (exists (select 1 from organization_members m where m.organization_id = kit_checkouts.organization_id and m.user_id = (select auth.uid())));
