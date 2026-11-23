-- Remap asset statuses to Snipe-IT's fixed status types (deployable/pending/undeployable/
-- archived). "Deployed" is a computed meta-status shown client-side whenever a deployable
-- asset is actually checked out (has assigned_user_id or assigned_to), exactly like
-- Snipe-IT's own meta status - it is not stored separately.
-- Applied live on 2026-11-23; kept here so the schema is reproducible.

alter table public.assets drop constraint if exists assets_status_check;

update public.assets set status = 'ready_to_deploy' where status in ('in_stock','in_use');
update public.assets set status = 'pending' where status = 'repair';
update public.assets set status = 'archived' where status = 'retired';

alter table public.assets add constraint assets_status_check
  check (status = any (array['ready_to_deploy','pending','undeployable','archived']));

alter table public.assets alter column status set default 'ready_to_deploy';
