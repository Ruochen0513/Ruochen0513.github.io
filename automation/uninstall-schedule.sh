#!/usr/bin/env bash
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
TIMER_NAME="player-home-update.timer"
SERVICE_NAME="player-home-update.service"

systemctl --user disable --now "$TIMER_NAME" 2>/dev/null || true
rm -f "$UNIT_DIR/$TIMER_NAME" "$UNIT_DIR/$SERVICE_NAME"
systemctl --user daemon-reload
echo "Removed $TIMER_NAME"
