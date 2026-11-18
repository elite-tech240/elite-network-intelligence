-- Applied live after the main monitoring migration; recorded here so fresh environments match.
alter function public.enforce_row_limit() set search_path = public;
drop policy if exists platform_state_no_client_access on public.platform_state;
create policy platform_state_no_client_access on public.platform_state for all to authenticated using (false) with check (false);
