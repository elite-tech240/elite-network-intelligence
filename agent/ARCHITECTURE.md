# Unified Agent Architecture

## Design
One versioned, platform-neutral Core is shared by endpoint agents. OS-specific service wrappers handle install/start/stop only; collectors normalize telemetry into a stable schema. Network infrastructure is handled by separately installed protocol/vendor adapters rather than pretending every router, firewall, switch or PBX can run an endpoint binary.

## Current implementation
- Shared host collector using psutil on Windows, Linux and macOS.
- Normalized interface inventory: name, IPv4/IPv6, MAC, link state, speed and MTU.
- Adapter contract and registry for vendor/protocol integrations.
- Windows service packaging remains WinSW + Inno Setup; Linux systemd and macOS launchd install scripts are added.
- Existing endpoint heartbeat and SNMPv2c reporting remain backward-compatible.

## Device coverage model
| Device class | Delivery model | Current status |
| --- | --- | --- |
| Windows workstations/servers | Installed Core + WinSW | Existing; collector refactored |
| Linux servers/workstations | Installed Core + systemd | Install script added; lab validation required |
| macOS endpoints | Installed Core + launchd | Install script added; lab validation required |
| Routers/switches/firewalls/APs | SNMP/API/SSH read-only adapter | Existing limited SNMPv2c router/switch poll; vendor adapters future work |
| Printers/PBX/VoIP | SNMP/SIP/PBX API adapter | Adapter contract only; vendor implementation pending |
| Appliances/IoT | Protocol-specific connector or passive inventory | Per-model capability dependent |

## Security boundaries
- Endpoint agent authenticates with its device-scoped bearer credential; it never receives Supabase service-role credentials.
- Enrollment token is one-time and removed from local config after successful enrollment.
- Collectors are read-only. No shell execution, configuration writes, firewall rules, VPN changes or broad scans are enabled.
- Discovery must be explicitly scoped to approved CIDRs and rate limits before active probing is implemented.
- New telemetry fields must be accepted and tenant/device-authorized by the Edge Function before persistence to Phase 1+ tables.

## Compatibility
The current heartbeat API still receives existing CPU, memory, disk and cumulative network counters. Interface detail is collected locally but is not sent until a separately reviewed ingestion contract and database write path are implemented. This avoids silently sending fields the current API does not persist.
