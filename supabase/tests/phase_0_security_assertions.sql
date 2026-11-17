-- Run against a Supabase database after applying Phase 0 migrations.
do $$
declare
  table_row record;
begin
  for table_row in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if has_table_privilege('anon', table_row.oid, 'select,insert,update,delete') then
      raise exception 'anon unexpectedly has table access to public.%', table_row.relname;
    end if;
    if not (select relrowsecurity from pg_class where oid = table_row.oid) then
      raise exception 'RLS is not enabled on public.%', table_row.relname;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.pending_agent_commands', 'select,insert,update,delete') then
    raise exception 'authenticated unexpectedly has access to pending_agent_commands';
  end if;
  if has_table_privilege('authenticated', 'public.device_credentials', 'select,insert,update,delete') then
    raise exception 'authenticated unexpectedly has access to device_credentials';
  end if;
  if has_table_privilege('authenticated', 'public.enrollment_tokens', 'select,insert,update,delete') then
    raise exception 'authenticated unexpectedly has access to enrollment_tokens';
  end if;
  if has_table_privilege('authenticated', 'public.snmp_targets', 'select,insert,update,delete') then
    raise exception 'authenticated unexpectedly has access to snmp_targets';
  end if;

  if has_column_privilege('authenticated', 'public.alert_events', 'message', 'update') then
    raise exception 'authenticated can unexpectedly edit alert event message';
  end if;
  if has_column_privilege('authenticated', 'public.networks', 'organization_id', 'update') then
    raise exception 'authenticated can unexpectedly move a network between tenants';
  end if;
  if has_column_privilege('authenticated', 'public.alert_rules', 'organization_id', 'update') then
    raise exception 'authenticated can unexpectedly move an alert rule between tenants';
  end if;

  if not has_table_privilege('service_role', 'public.pending_agent_commands', 'select,insert,update,delete') then
    raise exception 'service_role lost access to pending_agent_commands';
  end if;
  if not has_table_privilege('service_role', 'public.device_credentials', 'select,insert,update,delete') then
    raise exception 'service_role lost access to device_credentials';
  end if;
end;
$$;
