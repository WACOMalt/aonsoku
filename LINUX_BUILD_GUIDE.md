# Linux Build Guide — Aonsoku v0.15.0

This guide covers building the Linux desktop packages (AppImage, deb, tar.gz) for **Aonsoku v0.15.0** on a **Linux Mint** machine. It is written to be followed step-by-step by either a human or an AI agent with no prior context.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and Setup](#2-clone-and-setup)
3. [Build Steps](#3-build-steps)
4. [Expected Output](#4-expected-output)
5. [Upload to GitHub Release](#5-upload-to-github-release)
6. [Troubleshooting](#6-troubleshooting)
7. [Optional: Discord Rich Presence](#7-optional-discord-rich-presence)

---

## 1. Prerequisites

Install all of the following before proceeding. Each section includes the exact commands to run.

### 1.1 Build Essentials (gcc, g++, make, python3)

Required to compile native Node.js modules (`bufferutil`, `utf-8-validate`).

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 python3-pip
```

Verify:

```bash
gcc --version
g++ --version
make --version
python3 --version
```

### 1.2 libfuse2 (required for AppImage)

AppImage packaging requires FUSE 2. Linux Mint 21+ ships with FUSE 3 by default; `libfuse2` must be installed explicitly.

```bash
sudo apt-get install -y libfuse2
```

### 1.3 Additional Linux packaging dependencies

```bash
sudo apt-get install -y \
  libopenjp2-tools \
  rpm \
  fakeroot \
  dpkg \
  git \
  curl
```

> **Note:** `rpm` and `fakeroot` are needed by electron-builder even when only building `.deb` and AppImage targets.

### 1.4 Node.js 22 (via nvm — recommended)

Using **nvm** avoids permission issues and makes it easy to switch Node versions.

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload shell environment
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install and activate Node.js 22
nvm install 22
nvm use 22
nvm alias default 22
```

Verify:

```bash
node --version   # must print v22.x.x
npm --version
```

> **Alternative (nodesource):** If you prefer a system-wide install instead of nvm:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
> sudo apt-get install -y nodejs
> ```

### 1.5 pnpm 9.15.2

The project uses **pnpm** as its package manager. Install the exact version to avoid lockfile conflicts.

```bash
npm install -g pnpm@9.15.2
```

Verify:

```bash
pnpm --version   # must print 9.15.2
```

### 1.6 GitHub CLI (gh) — required for upload step

```bash
sudo apt-get install -y gh
```

Authenticate before the upload step:

```bash
gh auth login
```

Follow the prompts and choose **GitHub.com → HTTPS → Login with a web browser** (or paste a token).

---

## 2. Clone and Setup

### 2.1 Clone the repository

```bash
git clone https://github.com/WACOMalt/aonsoku.git
cd aonsoku
```

### 2.2 Check out the release tag

```bash
git checkout v0.15.0
```

Expected output:

```
HEAD is now at <commit-hash> <commit message>
```

### 2.3 Verify the build assets exist

The `build/` directory must contain the application icons. Confirm they are present:

```bash
ls build/
# Expected: entitlements.mac.plist  icon.icns  icon.ico  icon.png
```

If any icon files are missing the packaging step will fail. They are committed to the repository and should be present after checkout.

### 2.4 Install dependencies

```bash
pnpm install
```

This will:
- Install all Node.js dependencies from `pnpm-lock.yaml`
- Automatically run the `postinstall` script (`electron-builder install-app-deps`), which rebuilds native modules (`bufferutil`, `utf-8-validate`) against the bundled Electron version

> **Important:** The `postinstall` step requires `build-essential` and `python3` (installed in §1.1). If it fails with a node-gyp error, revisit that section.

Expected final lines from `pnpm install`:

```
 WARN  Issues with peer dependencies found
...
• Electron app dependencies rebuilt successfully
```

---

## 3. Build Steps

### Step 1 — Compile Electron/Vite sources

This compiles the TypeScript source (main process, preload, and renderer) using `electron-vite` and outputs compiled files to `out/`.

```bash
pnpm electron:build
```

Expected output ends with something like:

```
vite v7.x.x building for production...
✓ built in Xs
```

The `out/` directory will be created with subdirectories `main/`, `preload/`, and `renderer/`.

### Step 2 — Build Linux packages

```bash
pnpm build:linux
```

This runs `electron-builder --linux`, which reads [`electron-builder.yml`](electron-builder.yml) and produces all configured Linux targets:

| Target   | Architectures  |
|----------|---------------|
| AppImage | x64, arm64    |
| tar.gz   | x64, arm64    |
| deb      | x64 only      |

> **arm64 note:** If you are building on an **x64 machine**, electron-builder will attempt to cross-compile arm64 AppImage and tar.gz packages. This may fail or be skipped depending on your system's cross-compilation tooling. **The x64 builds are the priority.** If arm64 builds fail, the x64 artifacts will still be produced — proceed with those.

The build will take several minutes. Progress is printed to the terminal.

---

## 4. Expected Output

After a successful build, the following files will be present in the `dist/` directory:

```
dist/
├── Aonsoku-v0.15.0-linux-x64.AppImage
├── Aonsoku-v0.15.0-linux-arm64.AppImage      ← may be absent on x64-only machines
├── Aonsoku-v0.15.0-linux-x64.tar.gz
├── Aonsoku-v0.15.0-linux-arm64.tar.gz        ← may be absent on x64-only machines
└── Aonsoku-v0.15.0-linux-amd64.deb
```

> **Note on the `.deb` filename:** electron-builder uses the Debian architecture convention (`amd64`) rather than the Node.js convention (`x64`) for `.deb` filenames.

Verify the files exist:

```bash
ls -lh dist/Aonsoku-v0.15.0-linux-*
```

---

## 5. Upload to GitHub Release

The v0.15.0 release must already exist on GitHub (created by the Windows/macOS CI run). This step attaches the Linux artifacts to that existing release.

### 5.1 Confirm authentication

```bash
gh auth status
```

You must be authenticated as a user with write access to `WACOMalt/aonsoku`.

### 5.2 Upload all Linux artifacts

```bash
gh release upload v0.15.0 \
  dist/Aonsoku-v0.15.0-linux-*.AppImage \
  dist/Aonsoku-v0.15.0-linux-*.tar.gz \
  dist/Aonsoku-v0.15.0-linux-*.deb \
  --repo WACOMalt/aonsoku
```

> **Note:** Shell glob expansion (`*`) will only match files that actually exist. If arm64 builds were skipped, only the x64 AppImage and tar.gz will be uploaded — that is fine.

### 5.3 Verify the upload

```bash
gh release view v0.15.0 --repo WACOMalt/aonsoku
```

The Linux assets should appear in the `Assets` section of the output.

---

## 6. Troubleshooting

### 6.1 AppImage build fails — `libfuse2` not found

**Symptom:**

```
Error: FUSE library not found
```

**Fix:**

```bash
sudo apt-get install -y libfuse2
```

### 6.2 Native module build fails — `node-gyp` / `build-essential` missing

**Symptom:**

```
gyp ERR! find Python
gyp ERR! not ok
```

or

```
make: not found
```

**Fix:**

```bash
sudo apt-get install -y build-essential python3
```

Then re-run:

```bash
pnpm install
```

### 6.3 Node.js version mismatch

**Symptom:** Errors referencing unsupported syntax, or electron-builder complaining about the Node version.

**Fix:** Ensure Node.js 22 is active:

```bash
node --version   # must be v22.x.x
nvm use 22       # if using nvm
```

If you installed Node via nodesource and have multiple versions, use `update-alternatives` or reinstall via nvm.

### 6.4 arm64 cross-compilation fails on x64 machine

**Symptom:**

```
• cannot build for arm64 on x64
```

or the arm64 AppImage/tar.gz simply does not appear in `dist/`.

**This is expected behavior on x64-only machines.** The x64 AppImage, tar.gz, and deb will still be built successfully. Upload those and note in the release that arm64 Linux builds require a native arm64 build environment.

If arm64 builds are required, options include:
- Use a native arm64 Linux machine or VM
- Use Docker with QEMU emulation: `docker run --platform linux/arm64 ...`
- Use GitHub Actions with an `ubuntu-latest` arm64 runner

### 6.5 `pnpm install` fails with lockfile errors

**Symptom:**

```
ERR_PNPM_OUTDATED_LOCKFILE
```

**Fix:** Ensure you are on the correct tag and using the correct pnpm version:

```bash
git checkout v0.15.0
pnpm --version   # must be 9.15.2
pnpm install --frozen-lockfile
```

### 6.6 `out/` directory missing when running `pnpm build:linux`

**Symptom:**

```
Error: Cannot find module './out/main/index.js'
```

**Fix:** You must run `pnpm electron:build` **before** `pnpm build:linux`. The Vite compilation step must complete first.

```bash
pnpm electron:build
pnpm build:linux
```

### 6.7 `gh` upload fails — release not found

**Symptom:**

```
release not found
```

**Fix:** Confirm the release exists and you are targeting the correct repo:

```bash
gh release list --repo WACOMalt/aonsoku
```

If `v0.15.0` is not listed, the release must be created first (this is normally done by the Windows CI workflow).

---

## 7. Optional: Discord Rich Presence

If you want the built app to include Discord Rich Presence support, you must provide a Discord application client ID at **compile time** (Step 1), not at package time.

```bash
MAIN_VITE_DISCORD_CLIENT_ID=your_discord_client_id pnpm electron:build
```

Replace `your_discord_client_id` with the numeric client ID from the [Discord Developer Portal](https://discord.com/developers/applications).

Then proceed with the normal packaging step:

```bash
pnpm build:linux
```

> **Note:** If `MAIN_VITE_DISCORD_CLIENT_ID` is not set, Discord RPC will be compiled out and the feature will be unavailable in the built packages.

---

## Quick Reference — Full Command Sequence

For a clean machine, run these commands in order:

```bash
# 1. System dependencies
sudo apt-get update
sudo apt-get install -y build-essential python3 python3-pip libfuse2 rpm fakeroot dpkg git curl gh

# 2. Node.js 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 22 && nvm use 22 && nvm alias default 22

# 3. pnpm
npm install -g pnpm@9.15.2

# 4. Clone and checkout
git clone https://github.com/WACOMalt/aonsoku.git
cd aonsoku
git checkout v0.15.0

# 5. Install dependencies
pnpm install

# 6. Compile sources
pnpm electron:build

# 7. Build Linux packages
pnpm build:linux

# 8. Authenticate with GitHub and upload
gh auth login
gh release upload v0.15.0 \
  dist/Aonsoku-v0.15.0-linux-*.AppImage \
  dist/Aonsoku-v0.15.0-linux-*.tar.gz \
  dist/Aonsoku-v0.15.0-linux-*.deb \
  --repo WACOMalt/aonsoku
```
