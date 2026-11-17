# Deployment notes

## Supabase

1. Use project `pkaihrushsdxebfoyiis`.
2. Apply migrations `0001` through `0007` in filename order. These create tenant-scoped sites/networks, device credentials, endpoint metrics, alert rules/events, and backend-only SNMP credential storage.
3. Deploy the Edge Function source at `supabase/functions/monitoring-api/index.ts` as `monitoring-api` with JWT verification disabled. The function verifies user JWTs itself on user-only routes and uses per-device high-entropy bearer credentials for agent heartbeats.
4. Supabase provides the function's server-side `SUPABASE_SERVICE_ROLE_KEY`; never copy it into frontend or agent configuration.
5. Configure Auth SMTP and the invite email template before using Team Management. The Auth leaked-password protection advisor should also be enabled in Supabase Auth settings.

## Vercel frontend

- Root Directory: `frontend`; Framework: Vite; Build: `npm run build`; Output: `dist`.
- Required variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL=https://pkaihrushsdxebfoyiis.supabase.co/functions/v1/monitoring-api`.
- The Supabase publishable key is intended for browser use with RLS. Never use a service-role or secret key in frontend variables.

## Endpoint agents

Use **Sites & Networks → Enroll a monitoring agent** to generate a one-time, 24-hour token. Follow `agent/README.md` for Windows PowerShell and Linux installation. The agent stores a unique device credential locally after first enrollment. Revoke the device credential in the backend before deleting the local state file and re-enrolling.

## Separate FastAPI development service

`backend/` contains an optional FastAPI implementation for local testing and non-Edge hosting. Configure `backend/.env.example` values on a trusted server only. Production frontend requests currently use the Supabase Edge Function.

## Current production scope and gaps

Implemented: login, organization membership roles, Sites & Networks, one-time enrollment, per-device credential hashes, authenticated heartbeat, CPU/memory/disk and cumulative endpoint network counters, threshold-based alert rules/events, event acknowledgement, and owner/admin email invitations.

Implemented since the first endpoint telemetry release: optional read-only SNMPv2c polling through a local agent, router/switch inventory registration, and aggregate interface octet counters. Not implemented yet: SNMPv3 authPriv, packet-flow analytics, active network discovery/topology mapping, automatic offline alert jobs, credential rotation UI, audit log, rate limiting, multi-tenant automated security tests, and formal penetration/security review. Host counters must not be described as router-wide or per-flow traffic. Do not use the system for remote control or security response actions.
