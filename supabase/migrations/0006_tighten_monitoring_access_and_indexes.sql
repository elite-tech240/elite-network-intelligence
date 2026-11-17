-- Tighten backend-only credential tables and remove overlapping permissive policies.
drop policy if exists "managers manage alert rules" on public.alert_rules;
create policy "managers create alert rules" on public.alert_rules for insert to authenticated
with check (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')));
create policy "managers update alert rules" on public.alert_rules for update to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')))
with check (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')));
create policy "managers delete alert rules" on public.alert_rules for delete to authenticated
using (exists (select 1 from public.organization_members m where m.organization_id=alert_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')));

drop policy if exists "managers read SNMP targets" on public.snmp_targets;
drop policy if exists "managers manage SNMP targets" on public.snmp_targets;
revoke all on public.snmp_targets from anon, authenticated;

drop policy if exists "deny client access to device credentials" on public.device_credentials;
create policy "deny client access to device credentials" on public.device_credentials for all to anon, authenticated using (false) with check (false);
drop policy if exists "deny client access to enrollment tokens" on public.enrollment_tokens;
create policy "deny client access to enrollment tokens" on public.enrollment_tokens for all to anon, authenticated using (false) with check (false);

create index if not exists alert_events_device_idx on public.alert_events(device_id);
create index if not exists alert_events_rule_idx on public.alert_events(rule_id);
create index if not exists devices_site_org_idx on public.devices(site_id, organization_id);
create index if not exists devices_network_org_idx on public.devices(network_id, organization_id);
create index if not exists networks_site_org_idx on public.networks(site_id, organization_id);
create index if not exists sites_org_idx on public.sites(organization_id);
create index if not exists organization_members_user_idx on public.organization_members(user_id);
create index if not exists enrollment_tokens_org_idx on public.enrollment_tokens(organization_id);
create index if not exists enrollment_tokens_site_org_idx on public.enrollment_tokens(site_id, organization_id);
create index if not exists snmp_targets_site_org_idx on public.snmp_targets(site_id, organization_id);
