-- Workspace asset management: owners, admins, and operators can create/update sites and networks.
drop policy if exists "workspace managers can create sites" on public.sites;
create policy "workspace managers can create sites" on public.sites
for insert to authenticated
with check (exists (select 1 from public.organization_members m where m.organization_id = sites.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists "workspace managers can update sites" on public.sites;
create policy "workspace managers can update sites" on public.sites
for update to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id = sites.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')))
with check (exists (select 1 from public.organization_members m where m.organization_id = sites.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists "owners and admins can delete sites" on public.sites;
create policy "owners and admins can delete sites" on public.sites
for delete to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id = sites.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));

drop policy if exists "workspace managers can create networks" on public.networks;
create policy "workspace managers can create networks" on public.networks
for insert to authenticated
with check (exists (select 1 from public.organization_members m where m.organization_id = networks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists "workspace managers can update networks" on public.networks;
create policy "workspace managers can update networks" on public.networks
for update to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id = networks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')))
with check (exists (select 1 from public.organization_members m where m.organization_id = networks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists "owners and admins can delete networks" on public.networks;
create policy "owners and admins can delete networks" on public.networks
for delete to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id = networks.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));
