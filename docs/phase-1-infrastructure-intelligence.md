# Phase 1 — Infrastructure Intelligence

## Scope implemented in this change
- Separate per-interface inventory from device-level heartbeat counters.
- Store interface octet/error/discard counters and calculated utilization independently.
- Add tenant-scoped ICMP, DNS, TCP, HTTP and DHCP check results.
- Add IPAM address inventory with duplicate-IP conflict state and source attribution.
- Add VLAN inventory.
- Add explicitly scoped discovery-job records with bounded rate/host limits and approval lifecycle.

## Security model
- All six tables have RLS enabled.
- Authenticated users receive SELECT only, scoped by organization membership.
- Browser clients cannot create or execute discovery jobs or write telemetry.
- Writes are reserved for trusted collector/API code. Discovery is not enabled by this schema: a future API must validate the requested CIDR against an organization's registered network, require explicit approval, enforce rate limits, and audit execution before any probe is sent.
- No arbitrary host scanning, shell commands, or device configuration changes are introduced.

## Not yet complete
This is the Phase 1 storage foundation, not the complete feature. Remaining work includes collector/agent interface reporting, SNMPv3 authPriv credential handling, ICMP/DNS/TCP/DHCP probe workers, subnet validation and IP conflict reconciliation, topology inference, UI pages, retention/rollups, and end-to-end tests with authorized lab devices.
