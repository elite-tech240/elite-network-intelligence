# Phases 1–6 implementation status and safety contract

## Phase 1 — Infrastructure Intelligence
Schema foundation: device interfaces, interface counters/utilization, network check observations, IPAM addresses, VLANs, and bounded discovery job records. The current agent still needs a separately tested collector extension to populate these tables. No network scan is started merely by creating a job.

## Phase 2 — Firewall Security
Schema foundation: firewall inventory, normalized read-only policy snapshots, security events, and backend-only encrypted integration credential records. Vendor adapters (Fortinet, Palo Alto, Cisco, Sophos, Check Point, etc.) must be implemented and tested individually. Never store plaintext credentials; use a managed encryption key outside the database and rotate key versions.

## Phase 3 — VPN Intelligence
Schema foundation: tunnel inventory and time-series session, throughput, latency and packet-loss observations. Vendor/API polling adapters and site-to-site/remote-access dashboards remain to be connected.

## Phase 4 — VoIP Communications
Schema foundation: endpoint registration, trunks/capacity, and call-quality observations (MOS, jitter, latency, packet loss). PBX/SBC integrations and vendor-specific normalization remain to be implemented. Call identifiers should be hashed; do not store call audio or raw phone numbers in telemetry.

## Phase 5 — Controlled Operations
Schema foundation: maintenance windows, operation requests, separate approval records, idempotency keys, MFA evidence fields, and append-oriented audit events. This is deliberately NOT an execution engine. A future executor must enforce role checks, step-up MFA, separation of requester/approver, target allowlists, parameter schemas, expiry, maintenance windows, dry-run preview, idempotency, timeouts, audit-before-and-after, and rollback/compensation. Until then, no configuration-changing operation is available.

## Phase 6 — AI and MSP
Schema foundation: explainable AI insight records with evidence/confidence/review state and explicit MSP-to-customer access relationship records. AI is advisory only; it cannot approve or execute changes. MSP access is not implicitly granted by creating a relationship: a secure consent/acceptance flow and cross-tenant authorization layer must be implemented before customer data is exposed.

## Security defaults
- All new operational tables have RLS enabled and tenant-member SELECT policies.
- Browser roles have no write access to telemetry, operation, approval, audit, AI, or MSP relationship records.
- Integration secrets are backend-only ciphertext and are denied to anon/authenticated.
- Trusted service role is the write path; it must only be used in server-side Edge Functions/collectors.
- No broad subnet scan, exploit check, shell execution, firewall rule push, VPN change, PBX change, or other disruptive operation is introduced by these migrations.

## Validation still required before production
- Apply migrations to a disposable Supabase branch and run SQL assertions.
- Add composite tenant foreign keys to every vendor-specific table where the integration adapter introduces cross-table references.
- Implement and test vendor adapters and collector transport.
- Add real two-tenant tests, permission tests, approval/MFA tests, failure/retry/idempotency tests, and lab-device integration tests.
- Add UI pages and dashboards for all domains.
- Verify encryption-key management and rotation in the deployment environment.
