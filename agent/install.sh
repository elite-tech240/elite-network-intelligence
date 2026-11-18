#!/usr/bin/env bash
# One-command installer for Linux and macOS.
#   curl -fsSL https://raw.githubusercontent.com/elite-tech240/elite-network-intelligence/main/agent/install.sh | \
#     sudo ELITE_API_URL=... ELITE_SITE_ID=... ELITE_ENROLLMENT_TOKEN=... bash
# Downloads the agent source from GitHub, writes the config, then runs the platform installer.
set -euo pipefail
REPO_TARBALL="${ELITE_AGENT_TARBALL:-https://github.com/elite-tech240/elite-network-intelligence/archive/refs/heads/main.tar.gz}"
for var in ELITE_API_URL ELITE_SITE_ID ELITE_ENROLLMENT_TOKEN; do
  if [[ -z "${!var:-}" ]]; then echo "Missing $var. Generate it from Sites & Networks > Agent installer." >&2; exit 1; fi
done
if [[ "$(id -u)" -ne 0 ]]; then echo "Run with sudo (the agent installs a system service)." >&2; exit 1; fi
command -v python3 >/dev/null || { echo "python3 is required (macOS: run 'xcode-select --install')." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
python3 -c "import venv, ensurepip" 2>/dev/null || { echo "python3-venv is missing (Debian/Ubuntu: apt install python3-venv)." >&2; exit 1; }

case "$(uname -s)" in
  Linux)  CONFIG_DIR="/etc/elite-network-intelligence"; INSTALLER="install-linux.sh"; install -d -m 0750 "$CONFIG_DIR" ;;
  Darwin) CONFIG_DIR="/Library/Preferences/EliteNetworkIntelligence"; INSTALLER="install-macos.sh"; mkdir -p "$CONFIG_DIR" ;;
  *) echo "Unsupported OS: $(uname -s). Windows uses the .exe installer." >&2; exit 1 ;;
esac

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "Downloading agent..."
curl -fsSL "$REPO_TARBALL" | tar -xz -C "$WORK"
SRC="$(find "$WORK" -maxdepth 2 -type d -name agent | head -1)"
[[ -f "$SRC/agent.py" ]] || { echo "Download did not contain the agent." >&2; exit 1; }

# Config is written through python so the token is JSON-escaped safely.
( umask 077; python3 - "$CONFIG_DIR/agent-config.json" <<'PY'
import json, os, sys
json.dump({k: os.environ[k] for k in ("ELITE_API_URL", "ELITE_SITE_ID", "ELITE_ENROLLMENT_TOKEN")}, open(sys.argv[1], "w"), indent=2)
PY
)
chmod 0600 "$CONFIG_DIR/agent-config.json"
bash "$SRC/$INSTALLER"
echo "Done. The device should appear in Devices within a minute."
