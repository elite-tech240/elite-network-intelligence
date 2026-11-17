"""Minimal host-inventory reporter. This agent does not run commands remotely."""
import os
import platform
import socket
import time

import psutil
import requests

API_URL = os.getenv("ELITE_API_URL", "http://127.0.0.1:8000").rstrip("/")
ENROLLMENT_TOKEN = os.getenv("ELITE_ENROLLMENT_TOKEN", "")
SITE_ID = os.getenv("ELITE_SITE_ID", "")
INTERVAL = max(30, int(os.getenv("ELITE_INTERVAL_SECONDS", "60")))


def main() -> None:
    if not ENROLLMENT_TOKEN or not SITE_ID:
        raise SystemExit("Set ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID before running the agent")
    payload = {
        "enrollment_token": ENROLLMENT_TOKEN,
        "site_id": SITE_ID,
        "hostname": socket.gethostname(),
        "device_type": "server" if platform.system() != "Windows" else "workstation",
        "os_name": platform.system(),
        "os_version": platform.release(),
    }
    response = requests.post(f"{API_URL}/api/v1/agents/enroll", json=payload, timeout=15)
    response.raise_for_status()
    print("Device enrolled:", response.json().get("device", {}).get("id", "unknown"))
    while True:
        print({"cpu_percent": psutil.cpu_percent(interval=1), "memory_percent": psutil.virtual_memory().percent, "disk_percent": psutil.disk_usage("/").percent})
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
