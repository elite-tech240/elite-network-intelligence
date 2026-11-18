"""Passive network discovery: reads the OS neighbour (ARP) table only. Never scans or probes."""
from __future__ import annotations
import re
import subprocess
from typing import Any

_WIN = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s+(\w+)")
_NIX = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}).*?lladdr\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+(\w+)")
_MAC = re.compile(r"\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})")


def _run(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.stdout if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def collect_neighbours() -> list[dict[str, Any]]:
    hosts: dict[str, str] = {}
    for line in _run(["arp", "-a"]).splitlines():
        match = _WIN.match(line)
        if match and match.group(3).lower() == "dynamic":
            hosts[match.group(2).replace("-", ":").lower()] = match.group(1)
            continue
        match = _MAC.search(line)
        if match:
            mac = ":".join(part.zfill(2) for part in match.group(2).split(":")).lower()
            hosts[mac] = match.group(1)
    for line in _run(["ip", "neigh", "show"]).splitlines():
        match = _NIX.match(line)
        if match and match.group(3).upper() in {"REACHABLE", "STALE", "DELAY", "PROBE"}:
            hosts[match.group(2).lower()] = match.group(1)
    return [{"ip": ip, "mac": mac} for mac, ip in list(hosts.items())[:256]]
