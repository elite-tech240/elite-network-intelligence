# Elite Network Intelligence — Enterprise Roadmap

## Product direction

Build a multi-tenant Network Operations and Security Intelligence platform for companies of all sizes, IT service providers, and MSPs. Support cloud-hosted, customer-hosted, and hybrid deployments. Monitoring is read-only by default; any action that changes a managed system must use explicit authorization and an auditable approval workflow.

## Target architecture

- **Web console:** React, TypeScript, Vite; tenant-aware views for Infrastructure, Security, Communications, Operations, and Administration.
- **Cloud control plane:** Supabase Auth, Postgres, RLS, Realtime, and Edge Functions for organizations, inventory, policies, enrollment, command approvals, and audit history.
- **On-prem collector:** A customer-network service for SNMP, ICMP, syslog, flow export, and vendor APIs. It must buffer telemetry during WAN outages and synchronize securely when connectivity returns.
- **Endpoint agent:** Windows/Linux service with signed updates, per-device credentials, least-privilege collection, health telemetry, and modular collectors.
- **Integration adapters:** Versioned adapters for firewall, VPN, switching/routing, and PBX vendors; normalize vendor data into a common internal schema.
- **Telemetry pipeline:** Separate high-volume time-series/flow ingestion from transactional inventory and authorization data. Add retention, rollups, and tenant quotas before scaling flow ingestion.
- **Security:** Tenant isolation, RLS, short-lived enrollment tokens, hashed device credentials, secrets encryption, MFA, audit trails, rate limits, and security testing.

## Delivery phases

### Phase 0 — Stabilize and secure the foundation
- Verify migrations, tenant isolation, role permissions, and backend authorization.
- Enable Realtime only for the workspace tables used by live views; retain polling as a fallback.
- Remove user-facing manual refresh controls while keeping internal post-mutation data reloads.
- Add automated build, API, agent, and multi-tenant security tests.
- Resolve security/performance advisor findings and document intentional backend-only tables.

### Phase 1 — Infrastructure intelligence
- Expand endpoint inventory, hardware/software inventory, interface-level metrics, and service health.
- Add SNMPv3 authPriv, ICMP availability, DNS/DHCP checks, subnet/IPAM, VLANs, and duplicate-IP detection.
- Implement active discovery only for explicitly authorized CIDR ranges with rate limits and maintenance windows.
- Build topology from observed interfaces, neighbors, routing, and site links.
- Distinguish endpoint counters, interface counters, and flow telemetry in both storage and UI.

### Phase 2 — Firewall and security intelligence
- Start with read-only adapters for Fortinet FortiGate, Sophos, Palo Alto, Cisco, Check Point, pfSense, and OPNsense where supported.
- Collect health, interfaces, sessions, policies, VPN status, blocked/allowed events, IPS/security events, and configuration metadata.
- Add rule review, configuration snapshots/diffs, suspicious-activity correlation, and security incident workflows.
- Keep firewall policy changes out of scope until approvals, rollback, and vendor-specific validation are proven.

### Phase 3 — VPN intelligence
- Normalize site-to-site tunnels and remote-access sessions across firewall and VPN vendors.
- Track tunnel state, uptime, users, duration, throughput, latency, packet loss, certificate expiry, and failed authentication.
- Add site-link maps, outage correlation, and VPN-specific alert policies.

### Phase 4 — VoIP and communications intelligence
- Integrate 3CX, Asterisk, FreePBX, Cisco CUCM, and Yeastar through supported APIs/telemetry.
- Track PBX health, trunks, extensions, concurrent calls, queues, call failures, and call-quality metrics.
- Add SIP/RTP measurements including latency, jitter, packet loss, and MOS when source data supports it.

### Phase 5 — Controlled operations and automation
- Introduce a command catalog with read-only diagnostics first.
- Require RBAC, MFA/step-up confirmation, target preview, approval, maintenance window, idempotency, timeout, execution result, and audit record for changes.
- Add configuration backup/restore and rollback only where the vendor API supports reliable recovery.
- Support bulk actions through staged rollout and per-target failure isolation.

### Phase 6 — AI and MSP/enterprise capabilities
- Add anomaly detection, capacity forecasting, alert correlation, and explainable root-cause suggestions.
- Add natural-language investigation over tenant-scoped telemetry and audit-safe reporting.
- Add MSP tenant switching, delegated roles, customer portals, SLA reporting, quotas, retention policies, and usage metering.

## Non-negotiable operating rules

1. Monitoring and discovery must be restricted to assets and networks the customer is authorized to manage.
2. Read-only is the default for all integrations.
3. No arbitrary remote shell or unrestricted command execution.
4. Every state-changing operation is approved, scoped, logged, and recoverable where technically possible.
5. Tenant identity is enforced server-side; never trust organization IDs supplied by the browser without membership checks.
6. High-volume telemetry must not be mixed indiscriminately with transactional tables.
7. Cloud and on-prem collectors use outbound authenticated connections; do not require inbound exposure of customer networks.

## Initial acceptance criteria

- Realtime events update the relevant dashboard views, with polling fallback when disconnected.
- Cross-tenant reads and writes are denied by automated tests.
- All backend routes validate user/device identity and role before privileged actions.
- Device credentials and integration secrets are never returned to the browser.
- Agent and collector installers are versioned, signed, and support safe upgrade/rollback.
- Every operational command has a complete approval and audit trail.
