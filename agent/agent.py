"""Elite endpoint and read-only SNMP telemetry agent."""
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import tempfile
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
from collectors.logs import collect_logs
from collectors.discovery import collect_neighbours

AGENT_VERSION = "0.5.0"

API_URL = os.getenv("ELITE_API_URL", "http://127.0.0.1:8000").rstrip("/")
ENROLLMENT_TOKEN = os.getenv("ELITE_ENROLLMENT_TOKEN", "")
SITE_ID = os.getenv("ELITE_SITE_ID", "")
INTERVAL = max(15, int(os.getenv("ELITE_INTERVAL_SECONDS", "30")))
STATE_FILE = Path(os.getenv("ELITE_AGENT_STATE", str(Path.home() / ".elite-network-agent.json")))
LOG_INTERVAL = 60
DISCOVERY_INTERVAL = 600
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
        "os_name": platform.system(), "os_version": platform.release(), "agent_version": AGENT_VERSION,
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


def post_optional(state, path, body):
    """Best-effort delivery for logs/discovery: failures never affect core telemetry."""
    try:
        response = requests.post(f"{API_URL}/agents/{state['device_id']}/{path}", json=body,
                                 headers={"Authorization": f"Bearer {state['device_token']}"}, timeout=20)
        response.raise_for_status()
        return True
    except requests.RequestException as exc:
        print(f"{path} delivery failed:", exc)
        return False


ALLOWED_DOWNLOAD_HOSTS = ("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
UPGRADE_URL = API_URL.rsplit("/", 1)[0] + "/agent-upgrade"


def report_upgrade(state, command_id, status, detail):
    """Tell the server how the upgrade went."""
    body = {"id": command_id, "status": status}
    body["error" if status == "failed" else "result"] = detail
    try:
        requests.post(
            UPGRADE_URL + "/" + state["device_id"],
            json=body,
            headers={"Authorization": "Bearer " + state["device_token"]},
            timeout=20,
        )
    except requests.RequestException as exc:
        print("Could not report upgrade result:", exc)


def fetch_upgrade(state):
    """Ask the server whether this device should install a new agent."""
    try:
        response = requests.get(
            UPGRADE_URL + "/" + state["device_id"],
            headers={"Authorization": "Bearer " + state["device_token"]},
            timeout=20,
        )
        response.raise_for_status()
        return response.json().get("upgrade")
    except requests.RequestException as exc:
        print("Could not read upgrade instructions:", exc)
        return None


def run_upgrade(command):
    """Download the installer named by the server and run it. Returns (status, detail)."""
    params = command.get("parameters") or {}
    target = str(params.get("target_version") or "")
    url = str(params.get("download_url") or "")
    if not target:
        return "failed", "The server did not say which version to install"
    if target == AGENT_VERSION:
        return "completed", "Already running " + AGENT_VERSION
    if not url:
        return "failed", "No installer published for this platform in " + target

    # Only ever run something fetched from the project's own release assets.
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not any(host == h or host.endswith("." + h) for h in ALLOWED_DOWNLOAD_HOSTS):
            return "failed", "Refused to download from " + (host or "an unknown host")
    except Exception as exc:
        return "failed", "Could not read the download URL: " + str(exc)

    work = Path(tempfile.mkdtemp(prefix="eni-upgrade-"))
    name = str(params.get("asset_name") or "").strip() or ("installer.exe" if os.name == "nt" else "install.sh")
    installer = work / os.path.basename(name)
    try:
        with requests.get(url, stream=True, timeout=120) as response:
            response.raise_for_status()
            size = 0
            digest = hashlib.sha256()
            with open(installer, "wb") as handle:
                for chunk in response.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > 120 * 1024 * 1024:
                        return "failed", "The installer is larger than expected, so it was not run"
                    digest.update(chunk)
                    handle.write(chunk)
        expected = str(params.get("sha256") or "").lower().strip()
        if expected and digest.hexdigest() != expected:
            return "failed", "The installer did not match its published checksum"
        print("Downloaded", installer.name, size, "bytes for", target)

        if os.name == "nt":
            # Inno Setup installs silently over the running copy and restarts the service.
            subprocess.Popen(
                'start "" /b "' + str(installer) + '" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
                shell=True, close_fds=True,
            )
            return "running", "Installing " + target
        os.chmod(installer, 0o755)
        subprocess.Popen(
            ["/bin/sh", str(installer)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        return "running", "Installing " + target
    except requests.RequestException as exc:
        return "failed", "Download failed: " + str(exc)
    except Exception as exc:
        return "failed", "Upgrade failed: " + str(exc)
    finally:
        if os.name != "nt":
            shutil.rmtree(work, ignore_errors=True)


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

    last_logs = last_discovery = 0.0
    while True:
        snapshot = collect_host_metrics()
        payload = {
            "status": "online", "cpu_percent": snapshot["cpu_percent"],
            "memory_percent": snapshot["memory_percent"], "disk_percent": snapshot["disk_percent"],
            "bytes_sent": snapshot["bytes_sent"], "bytes_recv": snapshot["bytes_recv"],
            "uptime_seconds": snapshot["uptime_seconds"], "net_sent_bps": snapshot["net_sent_bps"],
            "net_recv_bps": snapshot["net_recv_bps"], "top_processes": snapshot["top_processes"],
            "agent_version": AGENT_VERSION,
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
            commands = result.get("commands", []) or []
            if any(c.get("command") == "uninstall" for c in commands):
                if schedule_windows_uninstall():
                    return
                raise SystemExit("Could not schedule remote uninstall.")
            for command in commands:
                if command.get("command") != "upgrade":
                    continue
                instructions = fetch_upgrade(state)
                if not instructions:
                    continue
                status, detail = run_upgrade({"parameters": instructions})
                print("Upgrade", status + ":", detail)
                report_upgrade(state, instructions.get("id"), status, detail)
        except requests.RequestException as exc:
            print("Endpoint telemetry delivery failed:", exc)

        if time.monotonic() - last_logs >= LOG_INTERVAL:
            last_logs = time.monotonic()
            logs = collect_logs(since_minutes=10)
            if logs:
                post_optional(state, "logs", {"logs": logs})
        if time.monotonic() - last_discovery >= DISCOVERY_INTERVAL:
            last_discovery = time.monotonic()
            hosts = collect_neighbours()
            if hosts:
                post_optional(state, "discovery", {"hosts": hosts})

        for target in SNMP_TARGETS:
            poll_snmp_target(state, target)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
