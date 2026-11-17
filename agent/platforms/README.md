# Platform service adapters

The collector core is OS-neutral and uses psutil for Windows, Linux and macOS telemetry. Service lifecycle is platform-specific:

- Windows: WinSW + Inno Setup (installer/EliteNetworkAgent.iss).
- Linux: systemd unit + install-linux.sh.
- macOS: launchd LaunchDaemon + install-macos.sh.

Installers do not grant remote shell access. Endpoint credentials remain device-scoped; network equipment is monitored through separately configured, read-only protocol adapters.
