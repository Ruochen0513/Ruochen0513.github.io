#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="player-home-update.service"
TIMER_NAME="player-home-update.timer"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js was not found in PATH." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/$SERVICE_NAME" <<EOF
[Unit]
Description=Update PLAYER_HOME external data

[Service]
Type=oneshot
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN $PROJECT_DIR/automation/update-site-data.mjs
EOF

cat > "$UNIT_DIR/$TIMER_NAME" <<'EOF'
[Unit]
Description=Run PLAYER_HOME updater every day at 03:00

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$TIMER_NAME"
systemctl --user start "$SERVICE_NAME" || true

echo "Installed $TIMER_NAME"
echo "Check status: systemctl --user status $TIMER_NAME"
echo "View logs: journalctl --user -u $SERVICE_NAME -n 50 --no-pager"
