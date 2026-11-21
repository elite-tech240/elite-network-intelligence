-- Remote agent upgrade: command channel, published release feed, and owner-only request RPCs.
-- Applied live on 2026-11-21; kept here so the schema is reproducible.

alter table public.pending_agent_commands drop constraint if exists pending_agent_commands_command_check;
alter table public.pending_agent_commands
  add constraint pending_agent_commands_command_check check (command in ('uninstall','upgrade'));

alter table public.pending_agent_commands
  add column if not exists parameters jsonb not null default '{}'::jsonb,
  add column if not exists result text,
  add column if not exists error text;

alter table public.pending_agent_commands drop constraint if exists pending_agent_commands_status_check;
alter table public.pending_agent_commands
  add constraint pending_agent_commands_status_check
  check (status in ('queued','delivered','running','completed','failed','cancelled'));

create table if not exists public.agent_releases (
  id boolean primary key default true check (id),
  version text not null,
  published_at timestamptz,
  notes text,
  assets jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.agent_releases enable row level security;

drop policy if exists "signed in users can read the agent release" on public.agent_releases;
create policy "signed in users can read the agent release"
  on public.agent_releases for select to authenticated using (true);

insert into public.agent_releases (id, version, notes)
values (true, '0.4.0', 'Seeded from the version the web app shipped with.')
on conflict (id) do nothing;

-- Owner-only: queue an upgrade for one device.
create or replace function public.request_agent_upgrade(p_device_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid; v_version text; v_current text; v_online boolean; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select d.organization_id, d.agent_version, (d.last_seen_at > now() - interval '5 minutes')
    into v_org, v_current, v_online
  from devices d where d.id = p_device_id and d.archived_at is null;
  if v_org is null then raise exception 'device not found'; end if;
  if not exists (select 1 from organization_members
                 where organization_id = v_org and user_id = auth.uid() and role = 'owner')
  then raise exception 'only an owner can update an agent'; end if;
  select version into v_version from agent_releases where id;
  if v_version is null then raise exception 'no agent release is published yet'; end if;
  if v_current is not distinct from v_version then raise exception 'this agent is already on %', v_version; end if;
  if not coalesce(v_online, false) then raise exception 'the device is offline, so it cannot be updated right now'; end if;
  if exists (select 1 from pending_agent_commands
             where device_id = p_device_id and command = 'upgrade'
               and status in ('queued','delivered','running'))
  then raise exception 'an update is already in progress for this device'; end if;
  insert into pending_agent_commands (device_id, command, requested_by, parameters)
  values (p_device_id, 'upgrade', auth.uid(), jsonb_build_object('target_version', v_version))
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.request_agent_upgrade(uuid) from public;
grant execute on function public.request_agent_upgrade(uuid) to authenticated;

-- Owner-only: queue an upgrade for every outdated, online device in a workspace.
create or replace function public.request_agent_upgrade_all(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_version text; v_count integer := 0; v_device record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from organization_members
                 where organization_id = p_organization_id and user_id = auth.uid() and role = 'owner')
  then raise exception 'only an owner can update agents'; end if;
  select version into v_version from agent_releases where id;
  if v_version is null then raise exception 'no agent release is published yet'; end if;
  for v_device in
    select d.id from devices d
    where d.organization_id = p_organization_id
      and d.archived_at is null
      and d.agent_version is not null
      and d.agent_version is distinct from v_version
      and d.last_seen_at > now() - interval '5 minutes'
      and not exists (select 1 from pending_agent_commands c
                      where c.device_id = d.id and c.command = 'upgrade'
                        and c.status in ('queued','delivered','running'))
  loop
    insert into pending_agent_commands (device_id, command, requested_by, parameters)
    values (v_device.id, 'upgrade', auth.uid(), jsonb_build_object('target_version', v_version));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

revoke all on function public.request_agent_upgrade_all(uuid) from public;
grant execute on function public.request_agent_upgrade_all(uuid) to authenticated;
