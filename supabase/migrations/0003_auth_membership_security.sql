-- Keep membership lookup non-recursive: a signed-in user can read only their own membership row.
drop policy if exists "members can read organization membership" on public.organization_members;
create policy "users can read their own membership"
  on public.organization_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No client-side self-enrollment or role changes are permitted.
-- Provision the first owner through the Supabase SQL editor using docs/owner-setup.sql.
