# Codex Pet Quota

Show Codex remaining quota under your Codex Desktop pet.

<p>
  <img src="./assets/demo-dark.png" width="220" alt="Dark mode preview" />
  <img src="./assets/demo-light.png" width="220" alt="Light mode preview" />
</p>

## Install

Install and enable auto-start:

```powershell
npx github:kname1/codex-pet-quota install
```

After npm publish:

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

## Commands

```powershell
npx github:kname1/codex-pet-quota start
npx github:kname1/codex-pet-quota status
npx github:kname1/codex-pet-quota stop
npx github:kname1/codex-pet-quota uninstall
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
