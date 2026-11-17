# Elite Network Intelligence Agent

## Unified multi-platform Core
The same Python Core runs on Windows, Linux and macOS. It collects normalized host telemetry and network-interface inventory using psutil. OS-specific service wrappers manage lifecycle: WinSW/Inno Setup on Windows, systemd on Linux and launchd on macOS.

See ARCHITECTURE.md, INSTALLER.md, install-linux.sh and install-macos.sh.

## Windows installer
A Windows x64 setup executable is built by GitHub Actions. Generate a fresh one-time enrollment token and Site ID for each endpoint. Run the installer as Administrator; it registers the agent as a Windows service. The setup executable is reusable, but enrollment tokens are single-use.

## Linux
Copy agent-config.json to /etc/elite-network-intelligence/agent-config.json with ELITE_API_URL, ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID, then run sudo ./install-linux.sh from this directory. The script installs a systemd service and starts it.

## macOS
Copy agent-config.json to /Library/Preferences/EliteNetworkIntelligence/agent-config.json with the same three keys, then run sudo ./install-macos.sh from this directory. The script installs a launchd LaunchDaemon.

## Network devices
Routers, switches, firewalls, access points, printers and PBX appliances generally cannot host this endpoint binary. Monitor them through explicit, read-only SNMP/API/SSH/SIP adapters. The adapter interface is in adapters/base.py; the current live implementation remains the existing limited SNMPv2c router/switch poller. SNMPv3 and vendor-specific adapters are follow-up work.

## Security
The agent authenticates with a device-scoped credential. Never place a Supabase service-role key in an endpoint. Collectors are read-only; no remote shell, configuration push or unrestricted scanning is provided.
