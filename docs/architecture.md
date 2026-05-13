# Architecture

## Design Choice

The project runs as an external companion app instead of patching Codex Desktop. This is the main update-safety boundary.

```text
Codex Desktop
  ├─ official pet rendering
  └─ writes last known pet bounds

codex-pet-quota
  ├─ reads pet bounds when showing quota
  ├─ reads quota locally
  ├─ passively watches pet clicks on Windows
  └─ owns a compact quota overlay
```

## Why Not Reuse the Internal Codex Bubble Directly?

Codex Desktop already renders pet bubbles internally, but there is no stable public pet bubble API in the custom pet contract. Reusing the internal UI would likely require patching app internals, which could break after a Codex update.

The current MVP copies the behavior visually with an external overlay. If Codex exposes an official pet interaction API later, only the overlay adapter should need to change.

## Drag Behavior

The overlay does not try to follow the pet while it is being dragged. Cross-process window tracking is fragile across Electron, Windows, macOS, Linux/X11, and Linux/Wayland. Instead, the app hides the quota label when a drag starts and lets the user click the pet again after repositioning.

## Data Flow

1. User clicks the pet.
2. Electron main process requests quota.
3. Quota reader tries the local Codex usage API with `~/.codex/auth.json`.
4. Quota reader falls back to `~/.codex/usage-limits.json`.
5. Bubble window renders the result.

## Stable Components

- npm CLI
- user config under `~/.codex-pet-quota`
- quota normalization
- tray and hotkey fallback

## Fragile Components

- Pet bounds discovery from `~/.codex/.codex-global-state.json`
- Pet bounds detection depends on Codex's saved pet position

Those are isolated in `src/main/petBounds.js` so future Codex UI changes are easier to patch.
