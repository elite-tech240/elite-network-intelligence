#!/usr/bin/env bash
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then echo "Run as root: sudo ./install-macos.sh" >&2; exit 1; fi
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/Library/Application Support/EliteNetworkIntelligence/Agent"; CONFIG_DIR="/Library/Preferences/EliteNetworkIntelligence"; PLIST="/Library/LaunchDaemons/com.elite.network-agent.plist"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"
cp -R "$SOURCE_DIR"/. "$INSTALL_DIR"/
python3 -m venv "$INSTALL_DIR/.venv"
"$INSTALL_DIR/.venv/bin/pip" install --disable-pip-version-check -r "$INSTALL_DIR/requirements.txt"
if [[ ! -f "$CONFIG_DIR/agent-config.json" ]]; then echo "Create $CONFIG_DIR/agent-config.json with ELITE_API_URL, ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID, then rerun." >&2; exit 2; fi
chmod 0600 "$CONFIG_DIR/agent-config.json"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.elite.network-agent</string>
<key>ProgramArguments</key><array><string>$INSTALL_DIR/.venv/bin/python</string><string>$INSTALL_DIR/agent.py</string></array>
<key>EnvironmentVariables</key><dict><key>ELITE_AGENT_CONFIG</key><string>$CONFIG_DIR/agent-config.json</string><key>ELITE_AGENT_STATE</key><string>/Library/Application Support/EliteNetworkIntelligence/device-state.json</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/var/log/elite-network-agent.log</string><key>StandardErrorPath</key><string>/var/log/elite-network-agent-error.log</string>
</dict></plist>
EOF
chown root:wheel "$PLIST"; chmod 0644 "$PLIST"
launchctl bootout system "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap system "$PLIST"
launchctl enable system/com.elite.network-agent
launchctl kickstart -k system/com.elite.network-agent
