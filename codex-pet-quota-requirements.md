# Codex Pet Quota Requirements

## Goal

Build a lightweight companion plugin for Codex Desktop pets. When the user clicks the active pet, a quota display appears near the pet and shows the current Codex usage quota:

- Remaining 5-hour quota
- Remaining weekly quota
- Refresh/reset time for both windows
- Last updated time

The plugin should survive Codex Desktop updates as much as possible by avoiding direct modification of Codex app files.

## Product Positioning

This project is not a replacement for Codex pets. It is a small companion utility that works alongside the official Codex Desktop pet system.

Users should still install/select pets through Codex normally. This plugin only adds quota display behavior on top of the existing pet experience.

## Primary User Flow

1. User installs the tool with a single command.
2. User opens Codex Desktop and selects a pet normally.
3. The companion utility runs in the background.
4. User clicks the visible Codex pet.
5. A quota display appears near the pet.
6. The bubble shows:
   - `5h remaining`
   - `Weekly remaining`
   - `5h refreshes at`
   - `Weekly refreshes at`
7. Bubble disappears automatically after a few seconds, or when the user clicks elsewhere.

## Installation Experience

Target install command for Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/<owner>/codex-pet-quota/main/install.ps1 | iex
```

Optional future commands:

```powershell
codex-pet-quota start
codex-pet-quota stop
codex-pet-quota status
codex-pet-quota update
codex-pet-quota uninstall
```

The first release should optimize for Windows because Codex Desktop pets are already visible in the user's Windows setup.

## GitHub Repository Shape

Recommended repository name:

```text
codex-pet-quota
```

Recommended structure:

```text
codex-pet-quota/
├── README.md
├── LICENSE
├── install.ps1
├── uninstall.ps1
├── package.json
├── src/
│   ├── main/
│   ├── overlay/
│   ├── quota/
│   └── tray/
├── assets/
│   └── icon.ico
└── docs/
    ├── requirements.md
    ├── architecture.md
    └── troubleshooting.md
```

## Non-Goals

- Do not patch Codex Desktop source files.
- Do not modify files inside the Codex app installation directory.
- Do not depend on private internal Codex UI code if avoidable.
- Do not require users to rebuild Codex Desktop.
- Do not require users to manually copy files into many folders.
- Do not upload user auth data or quota data to any external server.

## Update-Safe Architecture

To avoid breakage after Codex updates, the plugin should be an external desktop companion app:

1. It reads quota data from local Codex authentication/session sources or from a supported quota CLI/helper.
2. It detects the Codex pet overlay position without modifying Codex itself.
3. It renders its own transparent always-on-top quota display window.
4. It stores its own config under:

```text
%USERPROFILE%\.codex-pet-quota\
```

This keeps the plugin independent from Codex app updates. If Codex changes its pet UI, only the position-detection adapter may need an update; quota reading and bubble rendering should remain separate.

## Quota Data Requirements

The plugin should display the most useful information available:

- 5-hour window usage or remaining percentage
- Weekly window usage or remaining percentage
- 5-hour reset time
- Weekly reset time
- Data source status
- Error state if quota cannot be loaded

Preferred data format internally:

```json
{
  "fiveHour": {
    "remainingText": "72%",
    "resetAt": "2026-05-13T18:30:00+08:00"
  },
  "weekly": {
    "remainingText": "84%",
    "resetAt": "2026-05-17T09:00:00+08:00"
  },
  "updatedAt": "2026-05-13T15:22:10+08:00",
  "source": "local-codex"
}
```

## UI Requirements

The bubble should feel like a natural pet quota display:

- Appears near the active pet
- Dark/light mode aware
- Compact enough to avoid covering the workspace
- Shows loading state while refreshing
- Shows friendly error text when quota is unavailable
- Auto-dismisses after 5-8 seconds
- Refreshes quota when clicked, if cached data is stale

Suggested bubble copy:

```text
5h: 72% left
Resets 18:30

Week: 84% left
Resets Sun 09:00
```

## Click Behavior

Preferred behavior:

- Single-click on or near the visible Codex pet toggles the Quota.
- If reliable click interception is not possible without patching Codex, provide a fallback:
  - tray icon click
  - global hotkey
  - small transparent click target aligned near the pet

The project should document this clearly. The first version may use the fallback if direct pet-click detection is too fragile.

## Reliability Requirements

- Plugin should auto-start on login if the user enables it.
- Plugin should recover if Codex restarts.
- Plugin should not crash if Codex is closed.
- Plugin should show a clear error if the user is not logged in.
- Plugin should avoid sending any local token or auth file to remote servers.
- Plugin should work after normal Codex Desktop updates.

## Privacy Requirements

- All quota fetching should happen locally.
- No telemetry by default.
- No external server required.
- Never print or upload auth tokens.
- README must clearly explain what local files are read and why.

## MVP Scope

Version `0.1.0` should include:

- One-command installer for Windows
- Background companion process
- Quota reader
- quota display overlay
- Tray icon
- Manual refresh
- Auto refresh interval
- Basic uninstall script
- README with install/use/troubleshooting

## Future Scope

Possible later features:

- macOS support
- Linux support
- Multiple Codex accounts
- Custom bubble themes
- Custom pet-specific bubble styles
- Notification when quota is close to exhausted
- Support for more precise usage numbers if the data source exposes them

## Success Criteria

The project is successful if a new user can:

1. Run one install command from the README.
2. Restart or open Codex Desktop.
3. Select any Codex pet normally.
4. Click the pet or companion target.
5. See current 5-hour and weekly quota plus refresh times.
6. Update Codex Desktop later without reinstalling the plugin.

