-- ESXi virtualization: hosts and their VMs ride on the existing devices/device_metrics
-- tables (device_type 'esxi_host' / 'esxi_vm') so the whole app — charts, alerts,
-- offline detection, the device detail page — works for them with zero extra code.
-- Only two things are genuinely new: a way to group a VM under its host, and a
-- stable key to match a VM across polls (its ESXi managed-object id).

alter table public.devices add column if not exists parent_device_id uuid references public.devices(id) on delete cascade;
alter table public.devices add column if not exists esxi_moid text;

create index if not exists devices_parent_idx on public.devices(parent_device_id);

-- A VM is uniquely identified by (its host, its moid). Partial index so normal
-- devices (esxi_moid null) are never constrained by this.
create unique index if not exists devices_parent_moid_idx
  on public.devices(parent_device_id, esxi_moid)
  where esxi_moid is not null;

-- Children belong to the same workspace as their parent and are read under the
-- same "members can read devices" policy already in place (it has no device_type
-- filter), so no new RLS policy is needed.
