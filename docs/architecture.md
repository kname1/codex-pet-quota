# Architecture

## Design

Codex Pet Quota runs as an external companion app. It does not patch Codex Desktop, so normal Codex updates should not overwrite it.

```text
Codex Desktop
  ├─ renders the selected pet
  └─ stores the last known pet bounds

codex-pet-quota
  ├─ reads the pet bounds from the local Codex state file
  ├─ reads the existing Codex auth token locally
  ├─ fetches quota from the Codex usage endpoint
  └─ renders a compact native quota label under the pet
```

## Runtime

The Windows release uses a small PowerShell/WPF overlay instead of Electron. This keeps the npm package small and avoids downloading an Electron binary during install.

The Node CLI is only responsible for:

- installing the command
- adding/removing the Windows login startup entry
- starting/stopping the PowerShell companion process

## Behavior

- Hover or click the pet to show quota.
- Quota refreshes once per minute in the background.
- Low-quota warnings appear once at `20%`, `10%`, and `5%`.
- The label hides while the pet is being dragged.

## Local Files

- App state: `%USERPROFILE%\.codex-pet-quota`
- Codex auth: `%USERPROFILE%\.codex\auth.json`
- Codex pet bounds: `%USERPROFILE%\.codex\.codex-global-state.json`

No tokens or quota data are sent anywhere except the official Codex usage endpoint.
