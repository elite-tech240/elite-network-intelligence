# Elite Network Intelligence

**Version:** 0.4.0  
**Status:** Monitoring MVP — endpoint telemetry and alerting are implemented; router/SNMP and flow analytics remain in progress.

Elite is a multi-tenant network monitoring application with a React/Vite dashboard, Supabase Auth/Postgres, a Supabase Edge Function API, an optional FastAPI service, and a Python endpoint agent.

## Repository layout

- `frontend/` — React + TypeScript + Vite dashboard.
- `backend/` — optional FastAPI API for local development or separate hosting.
- `agent/` — Windows/Linux endpoint inventory and telemetry agent.
- `supabase/functions/monitoring-api/` — production API for one-time enrollment, device heartbeat, and team invitations.
- `supabase/migrations/` — tenant schema, RLS, device credentials, telemetry, alerts, and SNMP target storage.
- `docs/` — deployment and operating notes.

## What works

- Email/password sign-in and password reset; no public self-signup.
- Workspace-scoped roles: owner, admin, operator, viewer.
- Site and CIDR network creation.
- Owner/admin email invitations (requires working Supabase Auth email delivery).
- Short-lived one-time agent enrollment tokens; raw tokens are not stored.
- Unique device credentials; only token hashes are stored in the database.
- Agent heartbeat with CPU, memory, disk, and cumulative network-interface byte counters.
- Device health history, threshold rules, alert events, and acknowledgement.

## Quick start

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL` in the frontend environment. Production API URL:

```
https://pkaihrushsdxebfoyiis.supabase.co/functions/v1/monitoring-api
```

### Database and API

Apply `supabase/migrations/` in filename order. Deploy `supabase/functions/monitoring-api/index.ts` as the `monitoring-api` Edge Function with JWT verification disabled; it performs explicit user JWT verification on protected routes. Supabase service credentials stay server-side.

### Agent

See `agent/README.md` for Windows PowerShell and Linux install instructions. Generate an enrollment token from **Sites & Networks → Enroll a monitoring agent**.

## Important limitations

The current agent monitors the endpoint where it runs. Its network byte counters are cumulative host interface counters, not packet-flow inspection or router/switch bandwidth. SNMP polling, router/switch discovery, topology mapping, offline-detection schedules, audit logs, rate limiting, credential revocation UI, and formal security review are not yet implemented. Do not use this MVP for remote administration or security response actions.

## Deployment

See `docs/deployment.md`. Vercel hosts the frontend; Supabase hosts Auth, Postgres, and the production Edge Function API.
