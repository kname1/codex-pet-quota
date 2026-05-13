const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, globalShortcut } = require("electron");
const { bubbleBoundsForPet, hotspotBoundsForPet, readCodexPetBounds } = require("./petBounds");
const { pidPath, readConfig, stateDir } = require("./config");
const { readQuota } = require("./quota");

let bubbleWindow;
let hotspotWindow;
let tray;
let config;
let dismissTimer;
let mouseWatcher;
let cachedQuota = null;
let cachedQuotaAt = 0;
let hoverWatcher;
let isHoveringPet = false;
let lastHoverShowAt = 0;
let quotaRefreshTimer;
let lastWarningKey = null;
let lastWarningAt = 0;

const isInstall = process.argv.includes("--install");
const isUninstall = process.argv.includes("--uninstall");
const isDev = process.argv.includes("--dev");

function writePid() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(pidPath, String(process.pid));
}

function createBubbleWindow() {
  bubbleWindow = new BrowserWindow({
    width: 220,
    height: 76,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "overlay", "preload.js")
    }
  });

  bubbleWindow.setAlwaysOnTop(true, "screen-saver");
  bubbleWindow.loadFile(path.join(__dirname, "..", "overlay", "bubble.html"));
}

function createHotspotWindow() {
  hotspotWindow = new BrowserWindow({
    width: 100,
    height: 100,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "overlay", "preload.js")
    }
  });

  hotspotWindow.setAlwaysOnTop(true, "screen-saver");
  hotspotWindow.loadFile(path.join(__dirname, "..", "overlay", "hotspot.html"));
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function positionWindows() {
  const petBounds = readCodexPetBounds();
  if (!petBounds) return false;

  const bubbleBounds = bubbleBoundsForPet(petBounds);
  if (bubbleBounds && bubbleWindow) {
    bubbleWindow.setBounds(bubbleBounds);
  }

  const hotspotBounds = hotspotBoundsForPet(petBounds, config.hotspot.padding);
  if (hotspotBounds && hotspotWindow) {
    hotspotWindow.setBounds(hotspotBounds);
    if (config.hotspot.enabled && process.platform !== "win32") hotspotWindow.showInactive();
  }

  return true;
}

async function refreshQuota(force = false) {
  const now = Date.now();
  if (!force && cachedQuota && now - cachedQuotaAt < 60000) {
    return cachedQuota;
  }

  cachedQuota = await readQuota();
  cachedQuotaAt = Date.now();
  return cachedQuota;
}

function quotaPercentValue(value) {
  if (!value || !value.remainingText) return null;
  const match = String(value.remainingText).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function thresholdFor(percent) {
  if (percent === null) return null;
  if (percent <= 5) return 5;
  if (percent <= 10) return 10;
  if (percent <= 20) return 20;
  return null;
}

function lowQuotaKey(quota) {
  const five = quotaPercentValue(quota && quota.fiveHour);
  const week = quotaPercentValue(quota && quota.weekly);
  const parts = [];
  const fiveThreshold = thresholdFor(five);
  const weekThreshold = thresholdFor(week);
  if (fiveThreshold) parts.push(`5h:${fiveThreshold}`);
  if (weekThreshold) parts.push(`week:${weekThreshold}`);
  return parts.length ? parts.join("|") : null;
}

async function showBubble(options = {}) {
  positionWindows();
  if (!bubbleWindow) return;

  if (cachedQuota) {
    bubbleWindow.webContents.send("quota:data", { ...cachedQuota, animate: Boolean(options.animate) });
  } else {
    bubbleWindow.webContents.send("quota:loading");
  }
  bubbleWindow.showInactive();

  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    if (bubbleWindow) bubbleWindow.hide();
  }, config.bubbleDismissMs);

  const quota = await refreshQuota(false);
  bubbleWindow.webContents.send("quota:data", { ...quota, animate: Boolean(options.animate) });
}

function toggleBubble() {
  if (!bubbleWindow) return;
  if (bubbleWindow.isVisible()) {
    bubbleWindow.hide();
  } else {
    showBubble();
  }
}

async function refreshQuotaInBackground() {
  const quota = await refreshQuota(true);
  const warningKey = lowQuotaKey(quota);
  const now = Date.now();

  if (warningKey && (warningKey !== lastWarningKey || now - lastWarningAt > 30 * 60 * 1000)) {
    lastWarningKey = warningKey;
    lastWarningAt = now;
    showBubble({ animate: true });
  }

  return quota;
}

function startQuotaRefreshLoop() {
  refreshQuotaInBackground().catch(() => {});
  quotaRefreshTimer = setInterval(() => {
    refreshQuotaInBackground().catch(() => {});
  }, 60 * 1000);
}

function createTrayIcon() {
  return nativeImage.createFromDataURL(
    "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#15171c"/>
  <path d="M9 18.5c0-4 3-7.5 7-7.5s7 3.5 7 7.5-3 6.5-7 6.5h-4.4c-.8 0-1.2-.9-.8-1.5l1-1.4C10.1 20.9 9 19.8 9 18.5Z" fill="#f8fafc"/>
  <path d="M11 18.2c0-2.9 2.2-5.3 5-5.3s5 2.4 5 5.3-2.2 4.8-5 4.8h-2.5l.8-1.1c.2-.3.1-.8-.2-1C12.2 19.9 11 19.1 11 18.2Z" fill="#6d5dfc"/>
  <circle cx="14" cy="18" r="1" fill="#15171c"/>
  <circle cx="18" cy="18" r="1" fill="#15171c"/>
</svg>
`)
  );
}

function startWindowsMouseWatcher() {
  if (process.platform !== "win32") return;

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MouseNative {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  public struct POINT { public int X; public int Y; }
}
"@

$wasDown = $false
$downX = 0
$downY = 0
$maxMove = 0
$downAt = Get-Date

while ($true) {
  $point = New-Object MouseNative+POINT
  [MouseNative]::GetCursorPos([ref]$point) | Out-Null
  $isDown = ([MouseNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0

  if ($isDown -and -not $wasDown) {
    $downX = $point.X
    $downY = $point.Y
    $maxMove = 0
    $downAt = Get-Date
  }

  if ($isDown -and $wasDown) {
    $dx = [Math]::Abs($point.X - $downX)
    $dy = [Math]::Abs($point.Y - $downY)
    $move = [Math]::Max($dx, $dy)
    if ($move -gt $maxMove) { $maxMove = $move }
    if ($maxMove -gt 8) {
      $payload = @{
        kind = "drag"
        x = $point.X
        y = $point.Y
        downX = $downX
        downY = $downY
        maxMove = $maxMove
      } | ConvertTo-Json -Compress
      Write-Output $payload
      [Console]::Out.Flush()
    }
  }

  if (-not $isDown -and $wasDown) {
    $duration = [int]((Get-Date) - $downAt).TotalMilliseconds
    $payload = @{
      kind = "up"
      x = $point.X
      y = $point.Y
      downX = $downX
      downY = $downY
      durationMs = $duration
      maxMove = $maxMove
    } | ConvertTo-Json -Compress
    Write-Output $payload
    [Console]::Out.Flush()
  }

  $wasDown = $isDown
  Start-Sleep -Milliseconds 5
}
`;

  mouseWatcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"]
  });

  let buffer = "";
  mouseWatcher.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const petBounds = readCodexPetBounds();
        const startedOnPet = pointInBounds({ x: event.downX, y: event.downY }, petBounds);
        if (event.kind === "drag" && startedOnPet) {
          if (bubbleWindow && bubbleWindow.isVisible()) bubbleWindow.hide();
          continue;
        }
        if (event.kind === "up") {
          // Let click detection below handle short press/release events.
        }
        const clickedPet = startedOnPet && pointInBounds(event, petBounds);
        const isClick = event.durationMs <= 650 && event.maxMove <= 8;
        if (clickedPet && isClick) toggleBubble();
      } catch {
        // Ignore malformed watcher lines.
      }
    }
  });

  mouseWatcher.on("exit", () => {
    mouseWatcher = null;
  });
}

function startWindowsHoverWatcher() {
  if (process.platform !== "win32") return;

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CursorNative {
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  public struct POINT { public int X; public int Y; }
}
"@

while ($true) {
  $point = New-Object CursorNative+POINT
  [CursorNative]::GetCursorPos([ref]$point) | Out-Null
  $payload = @{
    x = $point.X
    y = $point.Y
  } | ConvertTo-Json -Compress
  Write-Output $payload
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 120
}
`;

  hoverWatcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"]
  });

  let buffer = "";
  hoverWatcher.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const point = JSON.parse(line);
        const petBounds = readCodexPetBounds();
        const hovering = pointInBounds(point, petBounds);
        const now = Date.now();

        if (hovering && !isHoveringPet && now - lastHoverShowAt > config.bubbleDismissMs) {
          lastHoverShowAt = now;
          showBubble();
        }

        isHoveringPet = hovering;
      } catch {
        // Ignore malformed hover watcher lines.
      }
    }
  });

  hoverWatcher.on("exit", () => {
    hoverWatcher = null;
  });
}

function createTray() {
  if (process.platform === "win32" && !process.argv.includes("--show-tray")) return;

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Codex Pet Quota");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show quota", click: showBubble },
      { label: "Refresh position", click: positionWindows },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
  tray.on("click", showBubble);
}

function setupAutoStart() {
  if (process.platform !== "darwin") return;
  app.setLoginItemSettings({
    openAtLogin: isUninstall ? false : Boolean(config.autoStart),
    args: []
  });
}

ipcMain.on("hotspot:click", toggleBubble);
ipcMain.on("bubble:close", () => bubbleWindow && bubbleWindow.hide());
ipcMain.on("bubble:refresh", async () => {
  if (!bubbleWindow) return;
  bubbleWindow.webContents.send("quota:data", await refreshQuota(true));
});

app.whenReady().then(() => {
  config = readConfig();
  writePid();

  createBubbleWindow();
  createHotspotWindow();
  createTray();
  setupAutoStart();

  if (isUninstall) {
    app.quit();
    return;
  }

  positionWindows();
  startWindowsMouseWatcher();
  startWindowsHoverWatcher();
  startQuotaRefreshLoop();

  globalShortcut.register("CommandOrControl+Alt+Q", showBubble);

  if (isInstall) {
    showBubble();
  }

  if (isDev) {
    console.log(`Codex Pet Quota running. State: ${stateDir}`);
  }
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  if (mouseWatcher) mouseWatcher.kill();
  if (hoverWatcher) hoverWatcher.kill();
  if (quotaRefreshTimer) clearInterval(quotaRefreshTimer);
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Nothing to clean up.
  }
});
