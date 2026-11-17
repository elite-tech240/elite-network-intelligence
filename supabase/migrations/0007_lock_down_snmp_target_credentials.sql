-- SNMP credentials are backend-only; keep the table inaccessible to browser roles.
drop policy if exists "deny client access to SNMP targets" on public.snmp_targets;
create policy "deny client access to SNMP targets" on public.snmp_targets
for all to anon, authenticated using (false) with check (false);
revoke all on public.snmp_targets from anon, authenticated;
