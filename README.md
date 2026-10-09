
# OpenRCT2 BingoSync Server

**OpenRCT2 BingoSync** runs the OpenRCT2 Bingo servers and connects their games to [Bingosync.com](https://bingosync.com).

It needs the openrct2-bingo plugin installed in your OpenRCT2 user folder, get it at: https://github.com/bingothon/openrct2-bingo

## What it does

- **Runs one OpenRCT2 server per game mode** (e.g. COOP, PVP and LOCKOUT), headless, each on its own port. Each server starts its game right away with the configured mode and duration, so players only pick their colour.
- **Restarts a server for a new game** when an admin types `/restart` in that server's chat. Restarting loads the scenario fresh; players rejoin afterwards. A server that crashes is restarted automatically.
- **Links each game to a Bingosync.com room**: the plugin creates a room for the board when the game starts and marks goals there as they are completed.

## Usage

Download the executable for your platform from the [latest release](https://github.com/bingothon/openrct2-bingosync/releases/latest), put a `servers.json` next to it (start from [servers.example.json](servers.example.json)) and run it:

```bash
./openrct-bingosync-linux-v<version>                       # uses ./servers.json
./openrct-bingosync-linux-v<version> --config my-servers.json
```

Stop it with Ctrl+C; that stops all servers.

### servers.json

| Setting | Default | |
|---|---|---|
| `scenario` | (required) | Park or scenario every game starts from |
| `servers` | (required) | One entry per server: `id` (also its folder name), `mode` (`coop`, `pvp` or `lockout`), `port` and an optional `name` for the server list |
| `openrct2Path` | `openrct2` | OpenRCT2 executable |
| `baseUserDirectory` | `~/.config/OpenRCT2` | Your normal OpenRCT2 user folder: config, groups, objects and plugins are taken from here |
| `dataDirectory` | `~/.config/openrct2-bingo-servers` | Each server gets its own OpenRCT2 user folder in here |
| `headless` | `true` | Run the servers without a game window |
| `tcpPort` | `12414` | Port the plugin connects to (local only) |
| `gameDurationYears` | `2` | Game length in in-game years |

Each server's folder gets a copy of `config.ini`, `groups.json`, `users.json` (admins) and `objects.idx` the first time (edit the copy to change one server, e.g. its groups) and shares `object/` and `plugin/` with the base folder, so all servers use the same plugin build.

## Server deployment

The game server runs everything as the `openrct2-bingo` systemd service (user `openrct2`) from `/opt/openrct2-bingo` (layout in [deploy/setup-server.sh](deploy/setup-server.sh)):

```bash
sudo systemctl status openrct2-bingo
journalctl -u openrct2-bingo -f              # logs of the manager and all servers
sudo systemctl restart openrct2-bingo        # new games on all servers
```

- **Setup** (once, as root): `sudo deploy/setup-server.sh --import <old OpenRCT2 folder>`, then install OpenRCT2 with `deploy/install-openrct2.sh`. Rerun the setup after changing `deploy/openrct2-bingo.service`.
- **Deploys** run on self-hosted GitHub runners on the server (user `github-runner`, label `openrct2-bingo-server`), one per repository:
  - this repository's [Deploy](.github/workflows/deploy.yml) workflow installs the manager and [deploy/servers.production.json](deploy/servers.production.json) on every push to `main`
  - the plugin repository's Deploy workflow installs `bingo.js`
  - both restart the servers
- **OpenRCT2 updates**: [Update OpenRCT2](.github/workflows/update-openrct2.yml) checks hourly for a new release. A new version is smoke-tested (a lockout game with the plugin must finish its setup) before the servers switch to it. Run it by hand with a version tag to install a specific version.

## Development

```bash
npm ci
npm run build:ts
node dist/index.js --config servers.json
```

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`), not committed to the repository. To publish a new version, tag it and push the tag:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The workflow builds the Linux, macOS and Windows executables with the version from the tag and attaches them to a new GitHub Release. Every push to `main` and every pull request is checked by `.github/workflows/ci.yml`.
