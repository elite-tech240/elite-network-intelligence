"""Cross-platform host telemetry collector (Windows, Linux and macOS)."""
from __future__ import annotations
import os
import platform
import time
from typing import Any
import psutil

def _system_volume() -> str:
    if platform.system() == "Windows":
        drive = os.environ.get("SystemDrive", "C:")
        return drive.rstrip("\\") + "\\"
    return "/"

_prev_net: tuple[float, int, int] | None = None


def _top_processes(limit: int = 8) -> list[dict[str, Any]]:
    """Top processes by CPU then memory. Names only: no command lines, no user data."""
    cores = psutil.cpu_count() or 1
    rows = []
    for proc in psutil.process_iter(["name", "cpu_percent", "memory_info"]):
        try:
            info = proc.info
            mem = info.get("memory_info")
            rows.append({"name": str(info.get("name") or "unknown")[:80],
                         "cpu": round((info.get("cpu_percent") or 0) / cores, 1),
                         "memory_mb": int((mem.rss if mem else 0) / 1048576)})
        except (psutil.Error, OSError):
            continue
    rows.sort(key=lambda r: (r["cpu"], r["memory_mb"]), reverse=True)
    return rows[:limit]


def _net_rates(counters) -> tuple[float | None, float | None]:
    global _prev_net
    now = time.monotonic()
    rates = (None, None)
    if counters and _prev_net:
        elapsed = now - _prev_net[0]
        sent, recv = counters.bytes_sent - _prev_net[1], counters.bytes_recv - _prev_net[2]
        if elapsed > 0 and sent >= 0 and recv >= 0:
            rates = (round(sent / elapsed, 1), round(recv / elapsed, 1))
    if counters:
        _prev_net = (now, counters.bytes_sent, counters.bytes_recv)
    return rates


def collect_host_metrics() -> dict[str, Any]:
    """Return normalized host metrics and interface inventory without changing state."""
    counters = psutil.net_io_counters() or None
    pernic = psutil.net_io_counters(pernic=True) or {}
    interfaces: list[dict[str, Any]] = []
    addresses = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    for name, entries in addresses.items():
        io = pernic.get(name)
        info = stats.get(name)
        ipv4 = [entry.address for entry in entries if getattr(entry.family, "name", "") == "AF_INET"]
        ipv6 = [entry.address.split("%", 1)[0] for entry in entries if getattr(entry.family, "name", "") == "AF_INET6"]
        mac = next((entry.address for entry in entries if getattr(entry.family, "name", "") in ("AF_LINK", "AF_PACKET") and entry.address), None)
        interfaces.append({"name": name[:128], "ipv4": ipv4[:8], "ipv6": ipv6[:8], "mac": mac,
            "is_up": bool(info.isup) if info else None,
            "speed_mbps": int(info.speed) if info and info.speed else None,
            "mtu": int(info.mtu) if info and info.mtu else None,
            "in_octets": str(io.bytes_recv) if io else None,
            "out_octets": str(io.bytes_sent) if io else None,
            "in_errors": str(io.errin) if io else None,
            "out_errors": str(io.errout) if io else None,
            "in_discards": str(io.dropin) if io else None,
            "out_discards": str(io.dropout) if io else None})
    try:
        disk_percent = psutil.disk_usage(_system_volume()).percent
    except (OSError, PermissionError):
        disk_percent = None
    sent_bps, recv_bps = _net_rates(counters)
    return {"uptime_seconds": int(time.time() - psutil.boot_time()), "net_sent_bps": sent_bps,
        "net_recv_bps": recv_bps, "top_processes": _top_processes(),
        "platform": platform.system(), "platform_release": platform.release(),
        "architecture": platform.machine(), "cpu_percent": psutil.cpu_percent(interval=1),
        "memory_percent": psutil.virtual_memory().percent, "disk_percent": disk_percent,
        "bytes_sent": counters.bytes_sent if counters else 0,
        "bytes_recv": counters.bytes_recv if counters else 0, "interfaces": interfaces}
