# Phase 0 — Foundation & Security

## Applied database hardening

- Revoke anonymous and authenticated default table/sequence privileges, then grant only the current frontend's required permissions.
- Keep device credentials, enrollment tokens, SNMP target secrets, and pending agent commands backend-only.
- Add an explicit deny-all RLS policy to pending agent commands; service_role remains the only runtime actor.
- Restrict alert event client updates to status and acknowledgement timestamp.
- Keep organization identifiers immutable through column-level update grants for sites, networks, and alert rules.
- Scope workspace read policies to the authenticated role and use scalar-subquery `auth.uid()` evaluation.
- Add covering indexes for networks.organization_id and pending_agent_commands.requested_by.

## Automated database assertions

Run `supabase/tests/phase_0_security_assertions.sql` after applying migrations. It checks:
- no anonymous table privileges across public application tables;
- RLS enabled on every public application table;
- no browser access to credentials, enrollment tokens, SNMP secrets, or queued commands;
- no cross-tenant organization_id updates through the browser;
- service_role retains backend access to protected command/credential tables.

## Validation checklist

- Re-run Supabase security/performance advisors.
- Run frontend TypeScript/Vite production build.
- Smoke-test sign-in, workspace reads, site/network CRUD, alert rule CRUD, alert acknowledgement, device archive/restore/uninstall authorization, and agent enrollment/heartbeat.
- Verify cross-organization access is denied with two test users from separate organizations. The connected production workspace currently has only one organization, so the two-tenant isolation test still requires a dedicated test tenant and test user.

## Manual dashboard item

The current Supabase project tools do not expose the Auth leaked-password-protection setting. An Auth administrator must enable leaked-password protection in Supabase Dashboard → Authentication → Settings → Password Security, then re-run the security advisor.

## Deliberately not removed

Unused-index notices are not acted on in Phase 0. The database currently has very small row counts, so those indexes may simply not have had enough workload to be used. Reassess with production query statistics after representative traffic.
