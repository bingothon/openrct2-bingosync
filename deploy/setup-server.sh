#!/usr/bin/env bash
# One-time setup of the OpenRCT2 Bingo servers on a Linux host. Safe to run again: it only
# creates or copies what is missing.
#
#   sudo deploy/setup-server.sh [--import <old OpenRCT2 folder>]
#
# --import copies the RCT2 game files, the OpenRCT2 config, groups, users (admins), objects and
# scenarios from an existing setup (a folder with game_data/ and user_data/).
#
# Layout (/opt/openrct2-bingo):
#   openrct2/<version>/   unpacked OpenRCT2 AppImages, openrct2/current -> the one in use
#   manager/              openrct2-bingosync executable
#   plugin/bingo.js       the plugin (deployed by the openrct2-bingo repo)
#   base/                 OpenRCT2 user folder the servers' folders are made from
#   data/<server id>/     each server's OpenRCT2 user folder (created by the manager)
#   game_data/            original RollerCoaster Tycoon 2 files
#   servers.json          which servers run (deploy/servers.production.json)
set -euo pipefail

ROOT=/opt/openrct2-bingo
SERVICE_USER=openrct2
RUNNER_USER=github-runner
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMPORT_FROM=""

while [ $# -gt 0 ]; do
    case "$1" in
        --import) IMPORT_FROM="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this as root (sudo)." >&2
    exit 1
fi

log() { echo "[setup] $*"; }

# Users: the service runs as $SERVICE_USER; GitHub Actions runners run as $RUNNER_USER and
# deploy by writing into $ROOT (group $SERVICE_USER) and restarting the service
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    log "Creating user $SERVICE_USER"
    useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
    log "Creating user $RUNNER_USER"
    useradd --create-home --shell /bin/bash "$RUNNER_USER"
fi
usermod -aG "$SERVICE_USER" "$RUNNER_USER"

mkdir -p "$ROOT"/{openrct2,manager,plugin,base/scenario,base/object,data,game_data}
ln -sfn ../plugin "$ROOT/base/plugin"

if [ -n "$IMPORT_FROM" ]; then
    OLD_DATA="$IMPORT_FROM/user_data"
    log "Importing from $IMPORT_FROM"
    if [ -z "$(ls -A "$ROOT/game_data")" ] && [ -d "$IMPORT_FROM/game_data" ]; then
        log "  RCT2 game files"
        cp -a "$IMPORT_FROM/game_data/." "$ROOT/game_data/"
    fi
    for file in config.ini groups.json users.json objects.idx; do
        if [ ! -e "$ROOT/base/$file" ] && [ -e "$OLD_DATA/$file" ]; then
            log "  $file"
            cp -a "$OLD_DATA/$file" "$ROOT/base/$file"
        fi
    done
    log "  objects and scenarios"
    cp -an "$OLD_DATA/object/." "$ROOT/base/object/"
    cp -an "$OLD_DATA/scenario/." "$ROOT/base/scenario/"
fi

if [ -f "$ROOT/base/config.ini" ]; then
    # The game files live here now
    sed -i "s|^game_path = .*|game_path = \"$ROOT/game_data/\"|" "$ROOT/base/config.ini"
fi

if [ ! -e "$ROOT/servers.json" ]; then
    log "Installing servers.json"
    cp "$SCRIPT_DIR/servers.production.json" "$ROOT/servers.json"
fi

# Everything belongs to the service user; its group (incl. the runner) may write, and new files
# inherit the group
chown -R "$SERVICE_USER:$SERVICE_USER" "$ROOT"
chmod -R g+rwX "$ROOT"
find "$ROOT" -type d -exec chmod g+s {} +

log "Installing the systemd service"
install -m 644 "$SCRIPT_DIR/openrct2-bingo.service" /etc/systemd/system/openrct2-bingo.service
systemctl daemon-reload
systemctl enable openrct2-bingo >/dev/null

# Deploy workflows may restart the service and nothing else
SUDOERS=/etc/sudoers.d/openrct2-bingo-runner
cat > "$SUDOERS" <<EOF
# GitHub Actions runners deploying OpenRCT2 Bingo (openrct2-bingosync deploy/setup-server.sh)
$RUNNER_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart openrct2-bingo, /usr/bin/systemctl start openrct2-bingo, /usr/bin/systemctl stop openrct2-bingo
EOF
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null

log "Done. Next: install OpenRCT2 (deploy/install-openrct2.sh), the manager and the plugin, then:"
log "  sudo systemctl start openrct2-bingo && journalctl -u openrct2-bingo -f"
