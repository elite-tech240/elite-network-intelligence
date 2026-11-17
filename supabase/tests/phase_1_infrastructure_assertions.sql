-- Phase 1 infrastructure intelligence assertions.
do $$
declare t text;
begin
  foreach t in array array['device_interfaces','interface_metrics','network_checks','ipam_addresses','vlans','discovery_jobs'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception 'RLS is not enabled on public.%', t;
    end if;
    if has_table_privilege('anon', format('public.%I', t), 'select,insert,update,delete') then
      raise exception 'anon unexpectedly has access to public.%', t;
    end if;
    if has_table_privilege('authenticated', format('public.%I', t), 'insert,update,delete') then
      raise exception 'authenticated unexpectedly has write access to public.%', t;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', t), 'select') then
      raise exception 'authenticated is missing read access to public.%', t;
    end if;
    if not has_table_privilege('service_role', format('public.%I', t), 'select,insert,update,delete') then
      raise exception 'service_role is missing backend access to public.%', t;
    end if;
  end loop;
end $$;
