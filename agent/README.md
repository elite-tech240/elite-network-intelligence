# Elite Network Intelligence Agent

## Windows installer

A Windows x64 setup executable is built by GitHub Actions. From the authenticated dashboard, generate a fresh enrollment configuration for each endpoint, download `EliteNetworkAgent-Setup.exe` and `agent-config.json`, keep both files in the same folder, then run the installer as Administrator. The installer registers the agent as an automatic Windows service. The setup executable is reusable; the one-time JSON configuration is **not** reusable and must be generated separately for every device. See [INSTALLER.md](INSTALLER.md) for build and troubleshooting details.


The endpoint agent reports host inventory and periodic CPU, memory, disk, and cumulative network-interface counters. It can also poll configured routers and switches using read-only SNMPv2c. It does not run remote commands or make configuration changes on monitored equipment.

## Install

Python 3.10+ is recommended.

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

For router/switch polling, install Net-SNMP command-line tools and ensure both `snmpget` and `snmpwalk` are on PATH:
- Ubuntu/Debian: `sudo apt-get install snmp`
- Windows: install a trusted Net-SNMP distribution and add its `bin` directory to PATH.

Generate a one-time enrollment token in **Sites & Networks → Enroll a monitoring agent**. The token expires after 24 hours and can only be used once for its selected site.

### Windows PowerShell

```powershell
$env:ELITE_API_URL="https://pkaihrushsdxebfoyiis.supabase.co/functions/v1/monitoring-api"
$env:ELITE_SITE_ID="YOUR-SITE-UUID"
$env:ELITE_ENROLLMENT_TOKEN="ONE-TIME-TOKEN"
python .\\agent.py
```

### Linux

```bash
export ELITE_API_URL="https://pkaihrushsdxebfoyiis.supabase.co/functions/v1/monitoring-api"
export ELITE_SITE_ID="YOUR-SITE-UUID"
export ELITE_ENROLLMENT_TOKEN="ONE-TIME-TOKEN"
python agent.py
```

After first enrollment, the agent stores its unique device credential in `~/.elite-network-agent.json` (permissions are restricted on POSIX systems). Subsequent starts reuse that credential. Protect this file like a password. To re-enroll after revocation, remove the state file and generate a new enrollment token.

## Optional SNMP router/switch polling

Set `ELITE_SNMP_TARGETS` to a JSON array on the machine running the agent. Use read-only SNMP communities and only target equipment you own or are authorized to monitor.

Example PowerShell:

```powershell
$env:ELITE_SNMP_TARGETS='[{"host":"192.168.1.1","port":161,"community":"YOUR_READ_ONLY_COMMUNITY","device_type":"router"},{"host":"192.168.1.2","port":161,"community":"YOUR_READ_ONLY_COMMUNITY","device_type":"switch"}]'
```

Example Linux:

```bash
export ELITE_SNMP_TARGETS='[{"host":"192.168.1.1","port":161,"community":"YOUR_READ_ONLY_COMMUNITY","device_type":"router"}]'
```

The collector reads sysName/sysDescr and sums high-capacity interface input/output octet counters. Discovered devices appear in the workspace inventory and their counters appear in Traffic. Polling is read-only.

**Security note:** This initial collector supports SNMPv2c only. SNMPv2c community strings are transmitted without encryption and may be visible to local process inspection. Use a dedicated read-only community, restrict UDP/161 to a management VLAN and the collector host, and do not reuse credentials. SNMPv3 authPriv support is a required next hardening step.

Set `ELITE_INTERVAL_SECONDS` to change the reporting interval (minimum 15 seconds; default 30 seconds).

## Data collected

- Hostname, operating system and version
- Local IP address and available MAC addresses
- CPU, memory and root-volume utilization
- Cumulative endpoint network bytes sent/received
- For SNMP targets: device name/description and summed interface bytes in/out

Endpoint counters are host-level. SNMP counters are aggregate interface counters; they are not per-flow packet inspection.
