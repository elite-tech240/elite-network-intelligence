#!/usr/bin/env bash
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then echo "Run as root: sudo ./install-linux.sh" >&2; exit 1; fi
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/opt/elite-network-intelligence-agent"; CONFIG_DIR="/etc/elite-network-intelligence"; STATE_DIR="/var/lib/elite-network-intelligence"
install -d -m 0750 "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"
cp -R "$SOURCE_DIR"/. "$INSTALL_DIR"/
python3 -m venv "$INSTALL_DIR/.venv"
"$INSTALL_DIR/.venv/bin/pip" install --disable-pip-version-check -r "$INSTALL_DIR/requirements.txt"
if [[ ! -f "$CONFIG_DIR/agent-config.json" ]]; then echo "Create $CONFIG_DIR/agent-config.json with ELITE_API_URL, ELITE_ENROLLMENT_TOKEN and ELITE_SITE_ID, then rerun." >&2; exit 2; fi
chmod 0600 "$CONFIG_DIR/agent-config.json"
cat >/etc/systemd/system/elite-network-agent.service <<EOF
[Unit]
Description=Elite Network Intelligence Agent
Wants=network-online.target
After=network-online.target
[Service]
Type=simple
User=root
Environment=ELITE_AGENT_CONFIG=$CONFIG_DIR/agent-config.json
Environment=ELITE_AGENT_STATE=$STATE_DIR/device-state.json
ExecStart=$INSTALL_DIR/.venv/bin/python $INSTALL_DIR/agent.py
Restart=always
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$STATE_DIR $CONFIG_DIR
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now elite-network-agent.service
systemctl --no-pager --full status elite-network-agent.service
