# Phase 0 — Foundation & Security

## Applied database hardening

- Revoke anonymous and authenticated default table/sequence privileges, then grant only the current frontend's required permissions.
- Keep device credentials, enrollment tokens, SNMP target secrets, and pending agent commands backend-only.
- Restrict alert event client updates to status and acknowledgement timestamp.
- Keep organization identifiers immutable through column-level update grants for sites, networks, and alert rules.
- Scope workspace read policies to the authenticated role and use scalar-subquery `auth.uid()` evaluation.
- Add covering indexes for networks.organization_id and pending_agent_commands.requested_by.
- Preserve the no-policy RLS behavior on pending_agent_commands: client requests fail closed.

## Validation checklist

- Verify anon has no table privileges on public application tables.
- Verify authenticated has only the expected CRUD privileges.
- Verify service_role retains backend access to protected tables.
- Verify RLS remains enabled on all 12 public application tables.
- Re-run Supabase security/performance advisors.
- Run frontend TypeScript/Vite production build.
- Smoke-test sign-in, workspace reads, site/network CRUD, alert rule CRUD, alert acknowledgement, device archive/restore/uninstall authorization, and agent enrollment/heartbeat.
- Verify cross-organization access is denied with two test users from separate organizations.

## Manual dashboard item

The current Supabase project tools do not expose the Auth leaked-password-protection setting. An Auth administrator must enable leaked-password protection in Supabase Dashboard → Authentication → Settings → Password Security, then re-run the security advisor.

## Deliberately not removed

Unused-index notices are not acted on in Phase 0. The database currently has very small row counts, so those indexes may simply not have had enough workload to be used. Reassess with production query statistics after representative traffic.
