#!/usr/bin/env bash
# Installs an OpenRCT2 release for the Bingo servers and switches to it, but only after a smoke
# test: a headless lockout game with the plugin must finish its setup without errors. A version
# that fails is left installed for inspection and not switched to. If the servers don't keep running
# on the new version after the restart, it switches back to the previous one.
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
    # Read the whole response before parsing: a grep that stops early makes curl fail (pipefail),
    # and the JSON may be on a single line
    RELEASE=$(curl -fsSL https://api.github.com/repos/OpenRCT2/OpenRCT2/releases/latest)
    VERSION=$(grep -o '"tag_name": *"[^"]*"' <<<"$RELEASE" | sed -n '1s/.*"\([^"]*\)"$/\1/p')
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
    # The unpacked folder is only accessible to the user running this script (the runner), but
    # the servers run as openrct2
    chmod -R u=rwX,go=rX "$TARGET"
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
    restart() { if [ "$(id -u)" -eq 0 ]; then systemctl restart openrct2-bingo; else sudo -n systemctl restart openrct2-bingo; fi; }
    restart

    # The smoke test runs as this script's user, the servers as openrct2: check the real servers
    # are still running after their first seconds (the manager gives up after 3 quick crashes)
    sleep 30
    expected=$(grep -c '"port"' "$ROOT/servers.json" || true)
    running=$(pgrep -fc "^$ROOT/openrct2/current/AppRun host" || true)
    if [ "$running" -lt "$expected" ]; then
        log "Only $running of $expected servers are running on $VERSION"
        if [ -n "$CURRENT" ] && [ -x "$ROOT/openrct2/$CURRENT/AppRun" ]; then
            log "Switching back to $CURRENT"
            ln -sfn "$CURRENT" "$ROOT/openrct2/current"
            restart
        fi
        exit 1
    fi
    log "All $running servers are running on $VERSION"
fi
