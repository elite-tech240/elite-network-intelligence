"""Explicit adapter registry; no network scanning is performed by registration."""
from __future__ import annotations
from .base import NetworkDeviceAdapter
_ADAPTERS: dict[str, NetworkDeviceAdapter] = {}
def register_adapter(adapter: NetworkDeviceAdapter) -> None:
    key = adapter.name.strip().lower()
    if not key or key in _ADAPTERS: raise ValueError(f"Adapter name is empty or already registered: {key!r}")
    _ADAPTERS[key] = adapter
def get_adapter(name: str) -> NetworkDeviceAdapter:
    try: return _ADAPTERS[name.strip().lower()]
    except KeyError as exc: raise LookupError(f"No network adapter registered for {name!r}") from exc
def registered_adapters() -> tuple[str, ...]: return tuple(sorted(_ADAPTERS))
