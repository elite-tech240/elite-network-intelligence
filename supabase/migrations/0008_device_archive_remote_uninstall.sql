-- Preserve endpoint history while supporting archive and remote agent removal.
alter table public.devices add column if not exists archived_at timestamptz;
create index if not exists devices_org_archived_idx on public.devices (organization_id, archived_at);
create table if not exists public.pending_agent_commands (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id) on delete cascade,
 command text not null check (command in ('uninstall')),
 status text not null default 'queued' check (status in ('queued','delivered','completed','failed')),
 requested_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 delivered_at timestamptz,
 completed_at timestamptz
);
create index if not exists pending_agent_commands_device_status_idx on public.pending_agent_commands(device_id,status,created_at);
alter table public.pending_agent_commands enable row level security;
