-- Explicitly document the backend-only boundary for queued agent commands.
-- No browser role receives table privileges; this policy also keeps RLS fail-closed.
drop policy if exists "deny client access to pending agent commands" on public.pending_agent_commands;
create policy "deny client access to pending agent commands"
  on public.pending_agent_commands
  for all
  to anon, authenticated
  using (false)
  with check (false);
