"""Cross-platform host telemetry collector (Windows, Linux and macOS)."""
from __future__ import annotations
import os
import platform
from typing import Any
import psutil

def _system_volume() -> str:
    if platform.system() == "Windows":
        drive = os.environ.get("SystemDrive", "C:")
        return drive.rstrip("\\\\") + "\\\\"
    return "/"

def collect_host_metrics() -> dict[str, Any]:
    """Return normalized host metrics and interface inventory without changing state."""
    counters = psutil.net_io_counters() or None
    interfaces: list[dict[str, Any]] = []
    addresses = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    for name, entries in addresses.items():
        info = stats.get(name)
        ipv4 = [entry.address for entry in entries if getattr(entry.family, "name", "") == "AF_INET"]
        ipv6 = [entry.address.split("%", 1)[0] for entry in entries if getattr(entry.family, "name", "") == "AF_INET6"]
        mac = next((entry.address for entry in entries if getattr(entry.family, "name", "") in ("AF_LINK", "AF_PACKET") and entry.address), None)
        interfaces.append({"name": name[:128], "ipv4": ipv4[:8], "ipv6": ipv6[:8], "mac": mac,
            "is_up": bool(info.isup) if info else None,
            "speed_mbps": int(info.speed) if info and info.speed else None,
            "mtu": int(info.mtu) if info and info.mtu else None})
    try:
        disk_percent = psutil.disk_usage(_system_volume()).percent
    except (OSError, PermissionError):
        disk_percent = None
    return {"platform": platform.system(), "platform_release": platform.release(),
        "architecture": platform.machine(), "cpu_percent": psutil.cpu_percent(interval=1),
        "memory_percent": psutil.virtual_memory().percent, "disk_percent": disk_percent,
        "bytes_sent": counters.bytes_sent if counters else 0,
        "bytes_recv": counters.bytes_recv if counters else 0, "interfaces": interfaces}
