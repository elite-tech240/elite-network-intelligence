# Elite Network Intelligence

**Version:** 0.2.0  
**Status:** Early MVP foundation — not production-ready.

Elite is a multi-tenant foundation for discovering and monitoring network assets. The repository contains a React/Vite dashboard, a FastAPI service, a lightweight Python agent skeleton, and Supabase migrations.

## Repository layout

- `frontend/` — React + TypeScript + Vite dashboard.
- `backend/` — FastAPI API with tenant-scoped enrollment and device endpoints.
- `agent/` — starter agent that reports host metadata to the API.
- `supabase/migrations/` — PostgreSQL schema and tenant integrity constraints.
- `docs/` — architecture and deployment notes.

## Quick start

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `frontend/.env`. The dashboard renders a clear setup state until Supabase is configured.

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the server. Never expose the service-role key in frontend variables.

### Database

Apply the SQL files in `supabase/migrations/` to the Supabase project in filename order. Review policies and adapt them to your authentication model before production use.

### Agent

```bash
cd agent
pip install -r requirements.txt
ELITE_API_URL=http://127.0.0.1:8000 ELITE_ENROLLMENT_TOKEN=... python agent.py
```

## Current scope and limitations

Implemented foundation: tenant and site schema, tenant integrity constraints, API health endpoint, authenticated enrollment-token validation, device heartbeat ingestion, and a basic dashboard shell.

Still requires implementation and security review: production identity/RBAC, token rotation and revocation UI, durable agent queue, SNMP/WMI/SSH collectors, topology mapping, historical traffic charts, service/process inventory, log/event ingestion, alert rules, reporting, and approved remote actions. The included agent reports basic host metadata only. Do not expose this service publicly or use it for operational control without a security review.

## Deployment

See `docs/deployment.md`. Vercel can host the static frontend. Host the FastAPI service on a Python-capable runtime (or adapt it to a supported Vercel Python function); configure the API URL separately. Supabase stores application data.
