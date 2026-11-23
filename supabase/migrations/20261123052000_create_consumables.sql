-- Snipe-IT-style Consumables: quantity depletes on use, never checked back in.
-- Applied live on 2026-11-23; kept here so the schema is reproducible.
create table public.consumables (
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
create index consumables_org_idx on public.consumables(organization_id);

create table public.consumable_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  consumable_id uuid not null references public.consumables(id) on delete cascade,
  assigned_user_id uuid,
  assigned_to text,
  qty integer not null check (qty > 0),
  used_at timestamptz not null default now()
);
create index consumable_uses_consumable_idx on public.consumable_uses(consumable_id);

alter table public.consumables enable row level security;
alter table public.consumable_uses enable row level security;

create policy "members can read consumables" on public.consumables for select
  using (exists (select 1 from organization_members m where m.organization_id = consumables.organization_id and m.user_id = (select auth.uid())));
create policy "members can read consumable uses" on public.consumable_uses for select
  using (exists (select 1 from organization_members m where m.organization_id = consumable_uses.organization_id and m.user_id = (select auth.uid())));
