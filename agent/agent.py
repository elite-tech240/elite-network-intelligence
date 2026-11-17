"""Elite endpoint and read-only SNMP telemetry agent."""
import json
import os
import platform
import socket
import subprocess
import sys
import time
from pathlib import Path

# Load installer-generated configuration before reading environment settings.
_config_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
_config_candidates = [
    Path(os.environ["ELITE_AGENT_CONFIG"]) if os.environ.get("ELITE_AGENT_CONFIG") else _config_dir / "__no_explicit_config__",
    _config_dir / "agent-config.json",
    Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "EliteNetworkIntelligence" / "Agent" / "agent-config.json",
    Path("/etc/elite-network-intelligence/agent-config.json"),
    Path("/Library/Preferences/EliteNetworkIntelligence/agent-config.json"),
]
for _config_file in _config_candidates:
    if _config_file.exists():
        try:
            _config = json.loads(_config_file.read_text(encoding="utf-8"))
            for _key, _value in _config.items():
                if _value is not None:
                    os.environ.setdefault(str(_key), str(_value))
            break
        except (OSError, ValueError) as exc:
            raise SystemExit(f"Could not read {_config_file}: {exc}")

import psutil
import requests
from collectors.host import collect_host_metrics

API_URL = os.getenv("ELITE_API_URL", "http://127.0.0.1:8000").rstrip("/")
ENROLLMENT_TOKEN = os.getenv("ELITE_ENROLLMENT_TOKEN", "")
SITE_ID = os.getenv("ELITE_SITE_ID", "")
INTERVAL = max(15, int(os.getenv("ELITE_INTERVAL_SECONDS", "30")))
STATE_FILE = Path(os.getenv("ELITE_AGENT_STATE", str(Path.home() / ".elite-network-agent.json")))
SNMP_TARGETS = json.loads(os.getenv("ELITE_SNMP_TARGETS", "[]"))


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("1.1.1.1", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


def mac_addresses():
    values = []
    for _, addresses in psutil.net_if_addrs().items():
        for address in addresses:
            if getattr(address.family, "name", "") in ("AF_LINK", "AF_PACKET") and address.address:
                values.append(address.address)
    return list(dict.fromkeys(values))[:16]


def enroll():
    payload = {
        "enrollment_token": ENROLLMENT_TOKEN, "site_id": SITE_ID,
        "hostname": socket.gethostname(),
        "device_type": "server" if platform.system() == "Linux" else "workstation",
        "os_name": platform.system(), "os_version": platform.release(),
        "ip_address": local_ip(), "mac_addresses": mac_addresses(),
    }
    response = requests.post(f"{API_URL}/agents/enroll", json=payload, timeout=20)
    response.raise_for_status()
    result = response.json()
    state = {"device_id": result["device"]["id"], "device_token": result["device_token"]}
    STATE_FILE.write_text(json.dumps(state), encoding="utf-8")
    try:
        STATE_FILE.chmod(0o600)
    except OSError:
        pass
    # The one-time token is no longer needed after successful enrollment.
    for config_path in _config_candidates:
        if config_path.exists():
            try:
                installed_config = json.loads(config_path.read_text(encoding="utf-8"))
                installed_config.pop("ELITE_ENROLLMENT_TOKEN", None)
                config_path.write_text(json.dumps(installed_config, indent=2), encoding="utf-8")
            except (OSError, ValueError):
                pass
    print("Enrolled endpoint:", result["device"].get("hostname", socket.gethostname()))
    return state


def snmp_value(host, port, community, oid, walk=False):
    command = ["snmpwalk" if walk else "snmpget", "-v2c", "-c", community,
               "-t", "3", "-r", "1", "-Oqv", f"{host}:{port}", oid]
    result = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
    if result.returncode != 0:
        raise RuntimeError("SNMP query failed")
    return result.stdout.strip()


def poll_snmp_target(state, target):
    host = str(target.get("host", "")).strip()
    community = str(target.get("community", ""))
    port = int(target.get("port", 161))
    if not host or not community:
        return
    try:
        sys_name = snmp_value(host, port, community, ".1.3.6.1.2.1.1.5.0")
        sys_descr = snmp_value(host, port, community, ".1.3.6.1.2.1.1.1.0")
        inbound = snmp_value(host, port, community, ".1.3.6.1.2.1.31.1.1.1.6", walk=True)
        outbound = snmp_value(host, port, community, ".1.3.6.1.2.1.31.1.1.1.10", walk=True)
        def sum_counters(raw):
            return sum(int(line.strip()) for line in raw.splitlines() if line.strip().isdigit()) or None
        payload = {
            "ip_address": host,
            "hostname": sys_name.strip('"') or host,
            "sys_descr": sys_descr[:120],
            "device_type": "switch" if target.get("device_type") == "switch" else "router",
            "bytes_recv": sum_counters(inbound),
            "bytes_sent": sum_counters(outbound),
        }
        response = requests.post(
            f"{API_URL}/agents/{state['device_id']}/snmp/report",
            json=payload,
            headers={"Authorization": f"Bearer {state['device_token']}"},
            timeout=20,
        )
        response.raise_for_status()
        print("SNMP counters accepted for", host)
    except (OSError, subprocess.SubprocessError, requests.RequestException, RuntimeError) as exc:
        print("SNMP poll failed for", host, ":", str(exc))



def report_interfaces(state, interfaces):
    """Send bounded, normalized interface inventory and counters to the trusted API."""
    response = requests.post(
        f"{API_URL}/agents/{state['device_id']}/interfaces/report",
        json={"interfaces": interfaces[:64]},
        headers={"Authorization": f"Bearer {state['device_token']}"},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def schedule_windows_uninstall():
    """Launch the registered Inno Setup uninstaller after this service exits."""
    if os.name != "nt":
        return False
    install_dir = Path(sys.executable).resolve().parent
    uninstaller = install_dir / "unins000.exe"
    if not uninstaller.exists():
        print("Installed uninstaller was not found.")
        return False
    script = Path(os.environ.get("TEMP", str(Path.home()))) / "elite-agent-remove.ps1"
    program_data = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "EliteNetworkIntelligence" / "Agent"
    script.write_text(
        "$ErrorActionPreference = 'SilentlyContinue'\n"
        "Start-Sleep -Seconds 8\n"
        f"Start-Process -FilePath '{uninstaller}' -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait\n"
        f"Remove-Item -LiteralPath '{program_data}' -Recurse -Force\n"
        f"Remove-Item -LiteralPath '{script}' -Force\n",
        encoding="utf-8",
    )
    subprocess.Popen(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(script)],
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), close_fds=True)
    print("Remote uninstall scheduled.")
    return True


def main():
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    else:
        if not ENROLLMENT_TOKEN or not SITE_ID:
            raise SystemExit("Set ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID for first enrollment")
        state = enroll()

    while True:
        snapshot = collect_host_metrics()
        payload = {
            "status": "online", "cpu_percent": snapshot["cpu_percent"],
            "memory_percent": snapshot["memory_percent"], "disk_percent": snapshot["disk_percent"],
            "bytes_sent": snapshot["bytes_sent"], "bytes_recv": snapshot["bytes_recv"],
        }
        print("Collected", len(snapshot["interfaces"]), "network interfaces on", snapshot["platform"])
        try:
            response = requests.post(
                f"{API_URL}/agents/{state['device_id']}/heartbeat",
                json=payload,
                headers={"Authorization": f"Bearer {state['device_token']}"},
                timeout=20,
            )
            if response.status_code == 401:
                raise SystemExit("Device credential was revoked. Remove local state and enroll again.")
            response.raise_for_status()
            result = response.json()
            print("Endpoint telemetry accepted")
            try:
                interface_result = report_interfaces(state, snapshot.get("interfaces", []))
                print("Interface telemetry accepted:", interface_result.get("accepted", 0))
            except requests.RequestException as exc:
                print("Interface telemetry delivery failed:", exc)
            if any(c.get("command") == "uninstall" for c in result.get("commands", [])):
                if schedule_windows_uninstall():
                    return
                raise SystemExit("Could not schedule remote uninstall.")
        except requests.RequestException as exc:
            print("Endpoint telemetry delivery failed:", exc)

        for target in SNMP_TARGETS:
            poll_snmp_target(state, target)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
