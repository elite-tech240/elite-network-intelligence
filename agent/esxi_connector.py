"""Elite ESXi connector.

Polls a standalone VMware ESXi host (6.0+, no vCenter needed) over the
vSphere SOAP API and reports the host and its VMs into Elite Network
Intelligence. Each VM shows up as its own device with its own status,
history and charts — same as a regular endpoint agent.

Run it on any machine with network access to the ESXi host's management
interface (443/tcp). It never sends the ESXi password anywhere but to the
ESXi host itself; only metrics go to Elite.

First run (one-time enrollment — generate a token in the Virtualization
tab of your workspace first):

    ELITE_API_URL=... ELITE_SITE_ID=... ELITE_ENROLLMENT_TOKEN=... \\
    ESXI_HOST=192.168.1.10 ESXI_USER=root ESXI_PASSWORD=... \\
    python3 esxi_connector.py

State (the device id/token Elite issues) is saved next to this script in
esxi-connector-state.json, so later runs only need ESXI_HOST/USER/PASSWORD.
"""
import json
import os
import ssl
import sys
import time
from pathlib import Path

import requests

try:
    from pyVim.connect import SmartConnect, Disconnect
    from pyVmomi import vim
except ImportError:
    sys.exit(
        "Missing dependency pyvmomi. Install it first:\n"
        "    pip install pyvmomi requests"
    )

STATE_FILE = Path(__file__).resolve().parent / "esxi-connector-state.json"
POLL_SECONDS = int(os.environ.get("ESXI_POLL_SECONDS", "1"))
CONNECTOR_VERSION = "0.1.0"


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    try:
        os.chmod(STATE_FILE, 0o600)
    except OSError:
        pass


def enroll(api_url: str) -> dict:
    token = os.environ.get("ELITE_ENROLLMENT_TOKEN")
    site_id = os.environ.get("ELITE_SITE_ID")
    esxi_host = os.environ.get("ESXI_HOST")
    if not token or not site_id or not esxi_host:
        sys.exit(
            "First run needs ELITE_ENROLLMENT_TOKEN, ELITE_SITE_ID, ESXI_HOST "
            "(generate a token in the Virtualization tab)."
        )
    resp = requests.post(
        f"{api_url}/agents/enroll",
        json={
            "enrollment_token": token,
            "site_id": site_id,
            "hostname": esxi_host,
            "device_type": "esxi_host",
            "os_name": "VMware ESXi",
            "ip_address": esxi_host,
            "agent_version": CONNECTOR_VERSION,
        },
        timeout=20,
    )
    if resp.status_code != 200:
        sys.exit(f"Enrollment failed: {resp.status_code} {resp.text[:300]}")
    body = resp.json()
    state = {
        "api_url": api_url,
        "device_id": body["device"]["id"],
        "device_token": body["device_token"],
    }
    save_state(state)
    print(f"Enrolled as device {state['device_id']}. Saved to {STATE_FILE}.")
    return state


def connect_esxi():
    host = os.environ.get("ESXI_HOST")
    user = os.environ.get("ESXI_USER")
    password = os.environ.get("ESXI_PASSWORD")
    if not host or not user or not password:
        sys.exit("ESXI_HOST, ESXI_USER and ESXI_PASSWORD are required.")
    # ESXi 6's default self-signed cert is the common case; verify it yourself
    # (ESXI_CA_FILE) if you've installed a trusted one.
    ca_file = os.environ.get("ESXI_CA_FILE")
    if ca_file:
        context = ssl.create_default_context(cafile=ca_file)
    else:
        context = ssl._create_unverified_context()
    # ESXi 6.0's hostd speaks an old TLS/SSL stack that relies on legacy
    # renegotiation and weaker ciphers. OpenSSL 3.x (bundled with Python 3.10+
    # on recent Windows/Linux builds) disables both by default, which makes
    # the handshake die mid-stream with "UNEXPECTED_EOF_WHILE_READING" even
    # though the credentials and host are correct. Relax the context so
    # older hosts like this one can still complete the handshake.
    try:
        context.set_ciphers("DEFAULT:@SECLEVEL=0")
    except ssl.SSLError:
        pass
    legacy_renegotiation = getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)  # OpenSSL SSL_OP_LEGACY_SERVER_CONNECT
    context.options |= legacy_renegotiation
    return SmartConnect(host=host, user=user, pwd=password, port=443, sslContext=context)


def host_stats(si) -> dict:
    content = si.RetrieveContent()
    host_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
    hosts = host_view.view
    host_view.Destroy()
    if not hosts:
        return {}
    h = hosts[0]
    summary = h.summary
    hw = summary.hardware
    qs = summary.quickStats
    cpu_percent = None
    mem_percent = None
    if hw and hw.cpuMhz and hw.numCpuCores:
        total_mhz = hw.cpuMhz * hw.numCpuCores
        if total_mhz and qs.overallCpuUsage is not None:
            cpu_percent = round(min(100.0, 100.0 * qs.overallCpuUsage / total_mhz), 1)
    if hw and hw.memorySize and qs.overallMemoryUsage is not None:
        mem_percent = round(min(100.0, 100.0 * (qs.overallMemoryUsage * 1024 * 1024) / hw.memorySize), 1)
    uptime = getattr(qs, "uptime", None)
    return {"cpu_percent": cpu_percent, "memory_percent": mem_percent, "uptime_seconds": uptime, "status": "online" if summary.runtime.connectionState == "connected" else "degraded"}


def vm_stats(si) -> list:
    content = si.RetrieveContent()
    vm_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
    vms = vm_view.view
    vm_view.Destroy()
    out = []
    for vm in vms:
        summary = vm.summary
        qs = summary.quickStats
        cfg = summary.config
        cpu_percent = None
        mem_percent = None
        if cfg and cfg.numCpu and qs.overallCpuUsage is not None:
            # overallCpuUsage is MHz used; without per-VM MHz allocation this is
            # approximate, scaled against a nominal 2500MHz/core baseline.
            allotted = cfg.numCpu * 2500
            cpu_percent = round(min(100.0, 100.0 * qs.overallCpuUsage / allotted), 1) if allotted else None
        if cfg and cfg.memorySizeMB and qs.guestMemoryUsage is not None:
            mem_percent = round(min(100.0, 100.0 * qs.guestMemoryUsage / cfg.memorySizeMB), 1)
        out.append({
            "moid": str(vm._moId),
            "name": cfg.name if cfg else str(vm._moId),
            "power_state": str(summary.runtime.powerState),
            "cpu_percent": cpu_percent,
            "memory_percent": mem_percent,
            "os_name": cfg.guestFullName if cfg else None,
        })
    return out


def report_loop(state: dict):
    api_url = state["api_url"]
    device_id = state["device_id"]
    headers = {"Authorization": f"Bearer {state['device_token']}"}
    while True:
        try:
            si = connect_esxi()
            try:
                stats = host_stats(si)
                vms = vm_stats(si)
            finally:
                Disconnect(si)

            hb = requests.post(
                f"{api_url}/agents/{device_id}/heartbeat",
                headers=headers,
                json={
                    "cpu_percent": stats.get("cpu_percent"),
                    "memory_percent": stats.get("memory_percent"),
                    "uptime_seconds": stats.get("uptime_seconds"),
                    "status": stats.get("status", "online"),
                    "agent_version": CONNECTOR_VERSION,
                },
                timeout=20,
            )
            if hb.status_code != 200:
                print(f"host heartbeat failed: {hb.status_code} {hb.text[:200]}")

            esxi_vms_url = api_url.rstrip("/").rsplit("/", 1)[0] + f"/esxi-vms/{device_id}"
            vr = requests.post(esxi_vms_url, headers=headers, json={"vms": vms}, timeout=30)
            if vr.status_code != 200:
                print(f"vm report failed: {vr.status_code} {vr.text[:200]}")
            else:
                print(f"reported host + {vr.json().get('reported', 0)}/{len(vms)} VMs")
        except Exception as exc:  # keep polling even if one cycle fails
            print(f"poll error: {exc}")
        time.sleep(POLL_SECONDS)


def main():
    state = load_state()
    if not state.get("device_id"):
        api_url = os.environ.get("ELITE_API_URL")
        if not api_url:
            sys.exit("ELITE_API_URL is required for first-time enrollment.")
        state = enroll(api_url)
    report_loop(state)


if __name__ == "__main__":
    main()
