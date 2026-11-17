-- Phases 2-6 security assertions. Run after migrations in an isolated test database.
do $$
declare t text;
begin
  foreach t in array array[
    'firewall_assets','firewall_policy_snapshots','firewall_security_events',
    'vpn_tunnels','vpn_session_metrics','voip_endpoints','voip_call_quality','voip_trunks',
    'maintenance_windows','operation_requests','operation_approvals','audit_logs',
    'ai_insights','msp_customer_access','integration_credentials'
  ] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception 'RLS missing on public.%', t;
    end if;
    if has_table_privilege('anon', format('public.%I', t), 'select,insert,update,delete') then
      raise exception 'anon has unexpected privilege on public.%', t;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.integration_credentials', 'select,insert,update,delete') then
    raise exception 'authenticated can access integration credentials';
  end if;
  if has_table_privilege('authenticated', 'public.operation_requests', 'insert,update,delete') then
    raise exception 'authenticated can directly execute or mutate operations';
  end if;
  if has_table_privilege('authenticated', 'public.audit_logs', 'insert,update,delete') then
    raise exception 'authenticated can tamper with audit logs';
  end if;
end $$;
