"""Read-only OS log collection (Windows Event Log via wevtutil, Linux via journalctl)."""
from __future__ import annotations
import json
import platform
import re
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any

MAX_EVENTS = 100
MAX_MESSAGE = 1500
_LEVELS = {"1": "critical", "2": "error", "3": "warning"}
_NS = {"e": "http://schemas.microsoft.com/win/2004/08/events/event"}


def _iso(value: str) -> str | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def _wevtutil(channel: str, query: str, count: int) -> list[dict[str, Any]]:
    command = ["wevtutil", "qe", channel, f"/q:{query}", f"/c:{count}", "/rd:true", "/f:xml"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=25, check=False,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode != 0 or not result.stdout.strip():
        return []
    try:
        root = ET.fromstring("<Events>" + result.stdout + "</Events>")
    except ET.ParseError:
        return []
    events = []
    for node in root.findall("e:Event", _NS) or root.findall("Event"):
        system = node.find("e:System", _NS)
        if system is None:
            continue
        event_id = system.findtext("e:EventID", default="0", namespaces=_NS)
        level = system.findtext("e:Level", default="4", namespaces=_NS)
        record = system.findtext("e:EventRecordID", default="", namespaces=_NS)
        provider = system.find("e:Provider", _NS)
        created = system.find("e:TimeCreated", _NS)
        logged_at = _iso(created.get("SystemTime", "")) if created is not None else None
        if not logged_at:
            continue
        data = [(d.text or "").strip() for d in node.findall(".//e:EventData/e:Data", _NS) if (d.text or "").strip()]
        provider_name = provider.get("Name") if provider is not None else channel
        message = f"{provider_name} event {event_id}" + (": " + " | ".join(data) if data else "")
        events.append({"source": channel, "event_id": int(event_id) if event_id.isdigit() else None,
                       "record_id": record, "level": _LEVELS.get(level, "info"), "provider": provider_name,
                       "message": message[:MAX_MESSAGE], "logged_at": logged_at})
    return events


def _windows(since_minutes: int) -> list[dict[str, Any]]:
    window = f"TimeCreated[timediff(@SystemTime) <= {since_minutes * 60000}]"
    events: list[dict[str, Any]] = []
    for channel in ("System", "Application"):
        events += _wevtutil(channel, f"*[System[(Level>=1 and Level<=3) and {window}]]", 40)
    # Failed sign-ins: only the fact and the account/source, never passwords (not in the event anyway).
    for event in _wevtutil("Security", f"*[System[(EventID=4625) and {window}]]", 30):
        event["level"] = "audit_failure"
        event["message"] = "Failed sign-in attempt (event 4625)"
        events.append(event)
    return events


def _linux(since_minutes: int) -> list[dict[str, Any]]:
    command = ["journalctl", "-p", "warning", "--since", f"{since_minutes} minutes ago", "-o", "json", "-n", "80", "--no-pager"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=25, check=False)
    if result.returncode != 0:
        return []
    names = {"0": "critical", "1": "critical", "2": "critical", "3": "error", "4": "warning"}
    events = []
    for line in result.stdout.splitlines():
        try:
            item = json.loads(line)
            stamp = datetime.fromtimestamp(int(item["__REALTIME_TIMESTAMP"]) / 1_000_000, tz=timezone.utc)
        except (ValueError, KeyError, TypeError):
            continue
        message = item.get("MESSAGE")
        if not isinstance(message, str) or not message:
            continue
        unit = str(item.get("SYSLOG_IDENTIFIER") or item.get("_COMM") or "journal")
        events.append({"source": "journal", "record_id": "", "event_id": None,
                       "level": names.get(str(item.get("PRIORITY")), "warning"), "provider": unit[:120],
                       "message": re.sub(r"\s+", " ", message)[:MAX_MESSAGE], "logged_at": stamp.isoformat()})
    return events


def collect_logs(since_minutes: int = 10) -> list[dict[str, Any]]:
    """Return a bounded list of recent warning-or-worse events. Never raises."""
    try:
        system = platform.system()
        events = _windows(since_minutes) if system == "Windows" else _linux(since_minutes) if system == "Linux" else []
    except (OSError, subprocess.SubprocessError):
        return []
    return events[:MAX_EVENTS]
