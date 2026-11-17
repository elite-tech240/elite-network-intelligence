-- Composite foreign keys ensure a site/network cannot be referenced across organizations.
-- The constraints are included in 0001 for clean installs; this migration is intentionally
-- idempotent for environments where the initial schema was deployed before these constraints.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'devices_site_org_fk') then
    alter table public.devices add constraint devices_site_org_fk
      foreign key (site_id, organization_id) references public.sites(id, organization_id) on delete cascade;
  end if;
end $$;
