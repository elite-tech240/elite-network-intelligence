-- Assets management (Snipe-IT style inventory) and Tickets (GLPI style helpdesk).
-- All writes go through the monitoring-api edge function under the service role;
-- RLS here only allows authenticated members of the organization to read their own data,
-- matching the existing client-side read-only / server-side write pattern (see devices).

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_tag text not null,
  name text not null,
  category text not null default 'other',
  status text not null default 'in_stock',
  assigned_to text,
  device_id uuid references public.devices(id) on delete set null,
  site_id uuid references public.sites(id) on delete set null,
  location text,
  vendor text,
  serial_number text,
  purchase_date date,
  warranty_expires date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, asset_tag)
);
create index if not exists assets_org_idx on public.assets (organization_id);
create index if not exists assets_device_idx on public.assets (device_id);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number bigserial,
  title text not null,
  description text,
  status text not null default 'open',
  priority text not null default 'medium',
  requester_email text,
  device_id uuid references public.devices(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists tickets_org_idx on public.tickets (organization_id);
create index if not exists tickets_status_idx on public.tickets (organization_id, status);

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_comments_ticket_idx on public.ticket_comments (ticket_id);

alter table public.assets enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;

create policy "assets_select_members" on public.assets for select to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = assets.organization_id and m.user_id = (select auth.uid())));

create policy "tickets_select_members" on public.tickets for select to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = tickets.organization_id and m.user_id = (select auth.uid())));

create policy "ticket_comments_select_members" on public.ticket_comments for select to authenticated
  using (exists (select 1 from public.organization_members m where m.organization_id = ticket_comments.organization_id and m.user_id = (select auth.uid())));
