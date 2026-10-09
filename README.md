
# OpenRCT2 BingoSync Server

**OpenRCT2 BingoSync** is a server tool that interacts with Bingosync.com, allowing you to create bingo boards for OpenRCT2 challenges.

This only works when you have the openrct2-bingo plugin installed, get it at: https://github.com/bingothon/openrct2-bingo

## Usage

Download the executable for your platform from the [latest release](https://github.com/bingothon/openrct2-bingosync/releases/latest) and run it:

### Linux
```bash
./openrct-bingosync-linux-v<version>
```

### macOS
```bash
./openrct-bingosync-macos-v<version>
```

### Windows
```run in cmd
openrct-bingosync-win-v<version>.exe
```

**Note:** Ensure you have network access to Bingosync.com, as this server interacts with it to create and manage bingo boards.

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`), not committed to the repository. To publish a new version, tag it and push the tag:

```bash
git tag v1.0.2
git push origin v1.0.2
```

The workflow builds the Linux, macOS and Windows executables with the version from the tag and attaches them to a new GitHub Release. Every push to `main` and every pull request is checked by `.github/workflows/ci.yml`.
