# Deployment notes

## Supabase

1. Use the Supabase project created for Elite Network Intelligence.
2. Apply `supabase/migrations/0001_initial_schema.sql` then `0002_tenant_reference_integrity.sql`.
3. Create the first organization and owner membership through a trusted administrative process. Do not expose the service-role key to browsers.
4. Configure backend secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `ENROLLMENT_TOKEN_SECRET`.

## Vercel frontend

- Import the GitHub repository and set Root Directory to `frontend`.
- Framework preset: Vite; Build command: `npm run build`; Output directory: `dist`.
- Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and (when API integration is enabled) `VITE_API_URL`.
- The Supabase publishable/anon key is intended for browser use with RLS. Never use the service-role key here.

## API hosting

The FastAPI service is a separate process. Deploy it to a Python-capable host, configure the environment variables from `backend/.env.example`, restrict CORS to the frontend origin, and put it behind HTTPS. The current heartbeat route deliberately returns 501 until per-device credentials are implemented.

## Before production

Complete user signup/invitation and organization provisioning, test RLS with multiple tenants, implement device credential verification and token rotation, add rate limits/audit logs, and perform a security review. The agent currently sends basic host inventory only; it does not perform network scanning or remote administration.
