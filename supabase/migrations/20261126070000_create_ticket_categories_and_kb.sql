-- GLPI-style additions to Ticketing: ticket categories (to classify/triage tickets) and a
-- lightweight knowledge base of articles agents can write and link from a ticket.
create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index ticket_categories_org_idx on public.ticket_categories(organization_id);

alter table public.tickets add column if not exists category_id uuid references public.ticket_categories(id) on delete set null;

create table public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kb_articles_org_idx on public.kb_articles(organization_id);

alter table public.ticket_categories enable row level security;
alter table public.kb_articles enable row level security;

create policy "members can read ticket categories" on public.ticket_categories for select
  using (exists (select 1 from organization_members m where m.organization_id = ticket_categories.organization_id and m.user_id = (select auth.uid())));
create policy "members can read kb articles" on public.kb_articles for select
  using (exists (select 1 from organization_members m where m.organization_id = kb_articles.organization_id and m.user_id = (select auth.uid())));
