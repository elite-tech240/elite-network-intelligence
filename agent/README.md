# Elite Network Intelligence Agent

The endpoint agent reports host inventory and periodic CPU, memory, disk, and cumulative network-interface counters. It does not run remote commands, install software silently, or scan networks.

## Install

Python 3.10+ is recommended.

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

Generate a one-time enrollment token in **Sites & Networks → Enroll a monitoring agent**. The token expires after 24 hours and can only be used for its selected site.

### Windows PowerShell

```powershell
$env:ELITE_API_URL="https://YOUR-API-DOMAIN"
$env:ELITE_SITE_ID="YOUR-SITE-UUID"
$env:ELITE_ENROLLMENT_TOKEN="ONE-TIME-TOKEN"
python .\\agent.py
```

### Linux

```bash
export ELITE_API_URL="https://YOUR-API-DOMAIN"
export ELITE_SITE_ID="YOUR-SITE-UUID"
export ELITE_ENROLLMENT_TOKEN="ONE-TIME-TOKEN"
python agent.py
```

After first enrollment, the agent stores its unique device credential in `~/.elite-network-agent.json` (permissions are restricted on POSIX systems). Subsequent starts reuse that credential and no longer need the enrollment token. Protect this file like a password. To re-enroll after revocation, remove the state file and generate a new enrollment token.

Set `ELITE_INTERVAL_SECONDS` to change the reporting interval (minimum 15 seconds). The default is 30 seconds.

## Data collected

- Hostname, operating system and version
- Local IP address and available MAC addresses
- CPU, memory and root-volume utilization
- Cumulative bytes sent and received from host network interfaces

Traffic counters are host-level cumulative counters, not per-flow inspection or router/switch bandwidth. SNMP polling and packet-flow analytics are separate collector features and are not yet enabled.
