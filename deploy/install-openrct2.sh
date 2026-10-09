#!/usr/bin/env bash
# Installs an OpenRCT2 release for the Bingo servers and switches to it, but only after a smoke
# test: a headless lockout game with the plugin must finish its setup without errors. A version
# that fails is left installed for inspection and not switched to.
#
#   deploy/install-openrct2.sh [<version tag, e.g. v0.5.5> | latest]   (default: latest)
#
# Run by the "Update OpenRCT2" workflow (as the runner user) or by hand (as root).
set -euo pipefail

ROOT=/opt/openrct2-bingo
VERSION="${1:-latest}"
SMOKE_PORT=11799
SMOKE_TIMEOUT=180

log() { echo "[install-openrct2] $*"; }

WORK=""
SMOKE=""
SMOKE_PID=""
cleanup() {
    if [ -n "$SMOKE_PID" ]; then kill "$SMOKE_PID" 2>/dev/null || true; fi
    rm -rf "$WORK" "$SMOKE"
}
trap cleanup EXIT

if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -fsSL https://api.github.com/repos/OpenRCT2/OpenRCT2/releases/latest | grep -m1 '"tag_name":' | cut -d '"' -f 4)
    [ -n "$VERSION" ] || { log "Couldn't find the latest OpenRCT2 release"; exit 1; }
fi

TARGET="$ROOT/openrct2/$VERSION"
CURRENT="$(readlink "$ROOT/openrct2/current" 2>/dev/null || true)"
if [ "$CURRENT" = "$VERSION" ]; then
    log "OpenRCT2 $VERSION is already in use."
    exit 0
fi

if [ ! -x "$TARGET/AppRun" ]; then
    WORK="$(mktemp -d)"
    APPIMAGE="OpenRCT2-${VERSION}-linux-x86_64.AppImage"
    log "Downloading $APPIMAGE"
    curl -fsSL -o "$WORK/$APPIMAGE" "https://github.com/OpenRCT2/OpenRCT2/releases/download/${VERSION}/${APPIMAGE}"
    chmod +x "$WORK/$APPIMAGE"
    # AppImages need FUSE to run directly, which containers usually don't have, so unpack it
    log "Unpacking"
    (cd "$WORK" && "./$APPIMAGE" --appimage-extract >/dev/null)
    rm -rf "$TARGET"
    mv "$WORK/squashfs-root" "$TARGET"
fi
log "Installed: $("$TARGET/AppRun" --version | head -n 1)"

# Smoke test: a throwaway user folder like the servers' that starts a lockout game right away
SMOKE="$(mktemp -d)"
for file in config.ini groups.json objects.idx; do
    [ -e "$ROOT/base/$file" ] && cp "$ROOT/base/$file" "$SMOKE/"
done
# Keep the test server out of the public server list
[ -e "$SMOKE/config.ini" ] && sed -i 's/^advertise = .*/advertise = false/' "$SMOKE/config.ini"
ln -s "$ROOT/base/object" "$SMOKE/object"
ln -s "$ROOT/plugin" "$SMOKE/plugin"
# managerPort 1: nothing listens there, so the plugin doesn't talk to the running manager
echo '{"bingoServer":{"id":"smoke-test","mode":"lockout","durationYears":2,"managerPort":1}}' > "$SMOKE/plugin.store.json"

log "Smoke test: lockout game setup with the plugin (up to ${SMOKE_TIMEOUT}s)"
"$TARGET/AppRun" host "$ROOT/base/scenario/bingothon-map.park" --headless --port "$SMOKE_PORT" \
    --user-data-path "$SMOKE" > "$SMOKE/server.log" 2>&1 &
SMOKE_PID=$!

result="timeout"
for _ in $(seq 1 "$SMOKE_TIMEOUT"); do
    if grep -qE "Invalid action parameters|\[Bingo Plugin\] Error" "$SMOKE/server.log"; then result="error"; break; fi
    if grep -q "LOCKOUT game initialized successfully" "$SMOKE/server.log"; then result="ok"; break; fi
    if ! kill -0 "$SMOKE_PID" 2>/dev/null; then result="crashed"; break; fi
    sleep 1
done

if [ "$result" != "ok" ]; then
    log "Smoke test failed ($result) - staying on ${CURRENT:-the current version}. Last log lines:"
    tail -n 40 "$SMOKE/server.log" | sed 's/\x1b\[[0-9;]*m//g'
    exit 1
fi
log "Smoke test passed"

ln -sfn "$VERSION" "$ROOT/openrct2/current"
log "Switched to $VERSION"

# Keep the new and the previous version only
for dir in "$ROOT"/openrct2/v*; do
    name="$(basename "$dir")"
    if [ "$name" != "$VERSION" ] && [ "$name" != "$CURRENT" ]; then
        log "Removing old version $name"
        rm -rf "$dir"
    fi
done

if systemctl is-active --quiet openrct2-bingo; then
    log "Restarting the servers"
    if [ "$(id -u)" -eq 0 ]; then systemctl restart openrct2-bingo; else sudo -n systemctl restart openrct2-bingo; fi
fi
