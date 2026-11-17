-- Phase 0 security and query-plan hardening.
-- Keep the browser role limited to the operations the current UI actually needs.

-- Remove the default broad grants from the public API roles, then grant back
-- the narrow, explicit permissions required by the application.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- Read-only workspace inventory.
grant select on public.organizations, public.organization_members,
  public.devices, public.sites, public.networks,
  public.device_metrics, public.alert_rules, public.alert_events
to authenticated;

-- Workspace CRUD remains protected by the existing role-aware RLS policies.
grant insert, delete on public.sites, public.networks to authenticated;
grant update (name, location) on public.sites to authenticated;
grant update (site_id, name, cidr) on public.networks to authenticated;

-- Alert rules can be managed by the roles allowed by RLS. Do not allow a
-- browser session to rewrite organization_id on an existing rule.
grant insert, delete on public.alert_rules to authenticated;
grant update (name, metric, operator, threshold, enabled)
  on public.alert_rules to authenticated;

-- Alert acknowledgement is the only client-side event mutation currently used.
grant update (status, acknowledged_at) on public.alert_events to authenticated;

-- Device identity, enrollment tokens, SNMP secrets, and queued commands are
-- exclusively managed by trusted backend code using service_role.
revoke all privileges on public.device_credentials, public.enrollment_tokens,
  public.snmp_targets, public.pending_agent_commands
from anon, authenticated;

-- Public read policies are not needed: unauthenticated requests must not see
-- workspace data. Wrap auth.uid() in a scalar subquery for initplan evaluation.
drop policy if exists "members can read own organizations" on public.organizations;
create policy "members can read own organizations"
  on public.organizations for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = organizations.id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists "members can read sites" on public.sites;
create policy "members can read sites"
  on public.sites for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = sites.organization_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists "members can read networks" on public.networks;
create policy "members can read networks"
  on public.networks for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = networks.organization_id
      and m.user_id = (select auth.uid())
  ));

drop policy if exists "members can read devices" on public.devices;
create policy "members can read devices"
  on public.devices for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = devices.organization_id
      and m.user_id = (select auth.uid())
  ));

-- Cover the two foreign keys identified by the Supabase performance advisor.
create index if not exists networks_organization_id_idx
  on public.networks (organization_id);
create index if not exists pending_agent_commands_requested_by_idx
  on public.pending_agent_commands (requested_by);

