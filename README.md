# Codex Pet Quota

Show Codex remaining quota under your Codex Desktop pet.

<p>
  <img src="./assets/demo-dark.png" width="220" alt="Dark mode preview" />
  <img src="./assets/demo-light.png" width="220" alt="Light mode preview" />
</p>

## Install

Install and enable auto-start:

```powershell
npx codex-pet-quota@latest install
```

Then open Codex Desktop, select a pet, and hover or click it.

## Features

- Shows 5-hour and weekly remaining quota.
- Shows reset time for both windows.
- Refreshes quota every minute in the background.
- Proactively warns at `20%`, `10%`, and `5%`.
- Hides while dragging the pet.
- Runs outside Codex, so Codex updates should not overwrite it.
- No Electron download.

## Commands

```powershell
npx codex-pet-quota@latest start
npx codex-pet-quota@latest status
npx codex-pet-quota@latest stop
npx codex-pet-quota@latest uninstall
```

## Privacy

Quota is fetched locally using your existing Codex login. Tokens are read from `~/.codex/auth.json` and are never sent to third-party servers by this tool.

## Platform Status

- Windows: supported.
- macOS/Linux: planned.

## Development

```powershell
npm install
npm run dev
npm run lint
```
