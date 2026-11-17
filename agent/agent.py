"""Elite endpoint telemetry agent. Sends inventory and periodic host metrics only."""
import json
import os
import platform
import socket
import time
from pathlib import Path

import psutil
import requests

API_URL = os.getenv("ELITE_API_URL", "http://127.0.0.1:8000").rstrip("/")
ENROLLMENT_TOKEN = os.getenv("ELITE_ENROLLMENT_TOKEN", "")
SITE_ID = os.getenv("ELITE_SITE_ID", "")
INTERVAL = max(15, int(os.getenv("ELITE_INTERVAL_SECONDS", "30")))
STATE_FILE = Path(os.getenv("ELITE_AGENT_STATE", str(Path.home() / ".elite-network-agent.json")))


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
        "enrollment_token": ENROLLMENT_TOKEN,
        "site_id": SITE_ID,
        "hostname": socket.gethostname(),
        "device_type": "server" if platform.system() != "Windows" else "workstation",
        "os_name": platform.system(),
        "os_version": platform.release(),
        "ip_address": local_ip(),
        "mac_addresses": mac_addresses(),
    }
    response = requests.post(f"{API_URL}/api/v1/agents/enroll", json=payload, timeout=20)
    response.raise_for_status()
    result = response.json()
    state = {"device_id": result["device"]["id"], "device_token": result["device_token"]}
    STATE_FILE.write_text(json.dumps(state), encoding="utf-8")
    try:
        STATE_FILE.chmod(0o600)
    except OSError:
        pass
    print("Enrolled device:", result["device"].get("hostname", socket.gethostname()))
    return state


def main():
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    else:
        if not ENROLLMENT_TOKEN or not SITE_ID:
            raise SystemExit("Set ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID for first enrollment")
        state = enroll()

    while True:
        cpu = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory().percent
        disk = psutil.disk_usage(os.path.abspath(os.sep)).percent
        counters = psutil.net_io_counters()
        payload = {
            "status": "online",
            "cpu_percent": cpu,
            "memory_percent": memory,
            "disk_percent": disk,
            "bytes_sent": counters.bytes_sent,
            "bytes_recv": counters.bytes_recv,
        }
        try:
            response = requests.post(
                f"{API_URL}/api/v1/agents/{state['device_id']}/heartbeat",
                json=payload,
                headers={"Authorization": f"Bearer {state['device_token']}"},
                timeout=20,
            )
            if response.status_code == 401:
                raise SystemExit("Device credential was revoked. Remove local state and enroll again.")
            response.raise_for_status()
            print("Telemetry accepted:", payload)
        except requests.RequestException as exc:
            print("Telemetry delivery failed:", exc)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
