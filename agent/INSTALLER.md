# Agent installers

## Windows x64
The Windows installer is built by GitHub Actions from .github/workflows/build-windows-agent-installer.yml. It embeds the Elite Network Intelligence application icon and installs the agent as a WinSW-managed service.

Generate a fresh one-time enrollment token and Site ID for each endpoint. The installer prompts for the API URL, token and Site ID. Keep the token private; it is single-use and expires according to the server policy. The service stores its device-scoped credential under ProgramData after successful enrollment.

## Linux
Create /etc/elite-network-intelligence/agent-config.json with ELITE_API_URL, ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID, then run sudo ./install-linux.sh from the agent source directory. The script installs dependencies and a systemd service. Validate on each supported distribution before broad rollout.

## macOS
Create /Library/Preferences/EliteNetworkIntelligence/agent-config.json with the same three keys, then run sudo ./install-macos.sh from the agent source directory. The script installs dependencies and a launchd LaunchDaemon. Validate on supported macOS versions before broad rollout.

## Validation status
Windows packaging is built in CI. Linux and macOS service scripts are initial implementation scaffolding and still require real-host installation, upgrade, restart and uninstall tests. Network appliances use read-only protocol adapters; they do not run the endpoint installer.
