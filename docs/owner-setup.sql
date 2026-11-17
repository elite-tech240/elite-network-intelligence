-- Run this once in Supabase SQL Editor AFTER creating your owner account in
-- Authentication -> Users. Replace the email and organization name below.
-- Keep public sign-ups disabled; invite/create additional users from the dashboard.

do $$
declare
  owner_email text := lower('REPLACE_WITH_YOUR_EMAIL');
  organization_name text := 'Elite Network';
  owner_id uuid;
  organization_id uuid;
begin
  select id into owner_id
  from auth.users
  where lower(email) = owner_email
  limit 1;

  if owner_id is null then
    raise exception 'No Supabase Auth user found for %. Create the user first.', owner_email;
  end if;

  insert into public.organizations (name)
  values (organization_name)
  returning id into organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, owner_id, 'owner');
end $$;
