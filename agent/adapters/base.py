"""Stable contract for vendor/protocol adapters."""
from __future__ import annotations
from typing import Any, Protocol
class NetworkDeviceAdapter(Protocol):
    name: str
    supported_vendors: tuple[str, ...]
    def identify(self, target: dict[str, Any]) -> dict[str, Any]:
        """Return normalized identity for an authorized target, read-only."""
        ...
    def collect(self, target: dict[str, Any]) -> dict[str, Any]:
        """Return normalized telemetry; implementations must be read-only."""
        ...
