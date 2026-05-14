ObjC.import("Cocoa");
ObjC.import("Foundation");
ObjC.import("AppKit");

const app = Application.currentApplication();
app.includeStandardAdditions = true;

const processInfo = callMaybe($.NSProcessInfo, "processInfo");
const fileManager = callMaybe($.NSFileManager, "defaultManager");
const args = callMaybe(processInfo, "arguments");
const argv = [];
const argCount = Number(callMaybe(args, "count"));
for (let i = 0; i < argCount; i += 1) argv.push(ObjC.unwrap(args.objectAtIndex(i)));

let packageDir = "";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--package-dir" && i + 1 < argv.length) packageDir = argv[i + 1];
}

const home = ObjC.unwrap($.NSHomeDirectory());
const codexHome = home + "/.codex";
const statePath = codexHome + "/.codex-global-state.json";
const authPath = codexHome + "/auth.json";
const appHome = home + "/.codex-pet-quota";
const pidPath = appHome + "/app.pid";
const launchAgentPath = home + "/Library/LaunchAgents/com.kname1.codex-pet-quota.plist";

let quota = null;
let lastQuotaFetch = 0;
let lastHoverShow = 0;
let lastWarningKey = null;
let lastWarningAt = 0;
let wasDown = false;
let isHovering = false;
let downStartedOnPet = false;
let downX = 0;
let downY = 0;
let maxMove = 0;
let visibleUntil = 0;
let layoutWidth = 176;
let layoutHeight = 48;

function nsString(value) {
  return $.NSString.alloc.initWithUTF8String(String(value));
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function nowMs() {
  return Date.now();
}

function fileExists(path) {
  return fileManager.fileExistsAtPath(path);
}

function readText(path) {
  try {
    const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
    if (!text) return null;
    return ObjC.unwrap(text);
  } catch (error) {
    return null;
  }
}

function writeText(path, value) {
  nsString(value).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
}

function ensureHome() {
  fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(appHome, true, null, null);
  writeText(pidPath, callMaybe(processInfo, "processIdentifier"));
}

function parseJson(path) {
  const text = readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function getPetBounds() {
  const state = parseJson(statePath);
  if (!state) return null;
  const atom = state["electron-persisted-atom-state"] || state;
  const overlay = atom["electron-avatar-overlay-bounds"] || state["electron-avatar-overlay-bounds"];
  if (!overlay || !overlay.mascot) return null;
  return {
    x: Number(overlay.x || 0) + Number(overlay.mascot.left || 0),
    y: Number(overlay.y || 0) + Number(overlay.mascot.top || 0),
    width: Number(overlay.mascot.width || 0),
    height: Number(overlay.mascot.height || 0)
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function clickBounds(bounds) {
  if (!bounds) return null;
  const pad = Math.max(10, Math.round(bounds.height * 0.28));
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2
  };
}

function resetText(value) {
  if (!value) return "?";
  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) return "?";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}.${day} ${hour}:${minute}`;
}

function remainingText(window) {
  if (!window) return "?";
  if (window.remaining_percent !== undefined && window.remaining_percent !== null) return `${Math.round(Number(window.remaining_percent))}%`;
  if (window.used_percent !== undefined && window.used_percent !== null) return `${Math.max(0, Math.round(100 - Number(window.used_percent)))}%`;
  return "?";
}

function fetchQuota() {
  try {
    const auth = parseJson(authPath);
    const token = auth && auth.tokens && auth.tokens.access_token;
    if (!token) throw new Error("No access token");
    const command = [
      "/usr/bin/curl -sS --max-time 20",
      "-H " + shellQuote("Authorization: Bearer " + token),
      "-H " + shellQuote("Accept: application/json"),
      "-H " + shellQuote("User-Agent: codex-pet-quota"),
      shellQuote("https://chatgpt.com/backend-api/wham/usage")
    ].join(" ");
    const raw = app.doShellScript(command);
    const usage = JSON.parse(raw);
    const primary = usage.rate_limit && usage.rate_limit.primary_window;
    const secondary = usage.rate_limit && usage.rate_limit.secondary_window;
    quota = {
      five: remainingText(primary),
      fiveReset: resetText(primary && primary.reset_at),
      week: remainingText(secondary),
      weekReset: resetText(secondary && secondary.reset_at)
    };
    lastQuotaFetch = nowMs();
    return quota;
  } catch (error) {
    return quota || { five: "?", fiveReset: "?", week: "?", weekReset: "?" };
  }
}

function ensureQuota() {
  if (!quota || nowMs() - lastQuotaFetch > 60000) return fetchQuota();
  return quota;
}

function percent(text) {
  const match = String(text || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function warningKey(data) {
  const parts = [];
  [["5h", percent(data.five)], ["week", percent(data.week)]].forEach((pair) => {
    const name = pair[0];
    const value = pair[1];
    if (value === null) return;
    if (value <= 5) parts.push(`${name}:5`);
    else if (value <= 10) parts.push(`${name}:10`);
    else if (value <= 20) parts.push(`${name}:20`);
  });
  return parts.length ? parts.join("|") : null;
}

function isLightMode() {
  try {
    const style = app.doShellScript("/usr/bin/defaults read -g AppleInterfaceStyle 2>/dev/null || true");
    return !String(style).match(/Dark/i);
  } catch (error) {
    return false;
  }
}

function callMaybe(owner, name) {
  const value = owner[name];
  return typeof value === "function" ? value.call(owner) : value;
}

function mainScreenFrame() {
  const screen = callMaybe($.NSScreen, "mainScreen");
  return callMaybe(screen, "frame");
}

function mousePoint() {
  const point = callMaybe($.NSEvent, "mouseLocation");
  const frame = mainScreenFrame();
  return {
    x: Number(point.x),
    y: Number(frame.size.height) - Number(point.y)
  };
}

function pressedButtons() {
  try {
    return Number(callMaybe($.NSEvent, "pressedMouseButtons"));
  } catch (error) {
    return 0;
  }
}

const nsApp = callMaybe($.NSApplication, "sharedApplication");
nsApp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
callMaybe(nsApp, "finishLaunching");

const style = $.NSWindowStyleMaskBorderless || 0;
const backing = $.NSBackingStoreBuffered || 2;
const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, 230, 78), style, backing, false);
panel.setOpaque(false);
panel.setBackgroundColor($.NSColor.clearColor);
panel.setIgnoresMouseEvents(true);
panel.setHasShadow(false);
panel.setLevel($.NSFloatingWindowLevel || 3);
panel.setCollectionBehavior(($.NSWindowCollectionBehaviorCanJoinAllSpaces || 1) | ($.NSWindowCollectionBehaviorStationary || 16));

const content = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 230, 78));
panel.setContentView(content);

function makeLabel(text, bold) {
  const label = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 0, 10, 10));
  label.setStringValue(text);
  label.setBezeled(false);
  label.setBordered(false);
  label.setDrawsBackground(false);
  label.setEditable(false);
  label.setSelectable(false);
  label.setAlignment($.NSTextAlignmentCenter || 2);
  label.setFont(bold ? $.NSFont.boldSystemFontOfSize(13.5) : $.NSFont.systemFontOfSize(13.5));
  content.addSubview(label);
  return label;
}

const labels = {
  fiveName: makeLabel("5h", false),
  fiveValue: makeLabel("...", true),
  fiveReset: makeLabel("...", false),
  weekName: makeLabel("Week", false),
  weekValue: makeLabel("...", true),
  weekReset: makeLabel("...", false)
};

function setTextColor() {
  const light = isLightMode();
  const muted = light ? $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.263, 0.322, 0.408, 1) : $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.859, 0.898, 0.937, 1);
  const strong = light ? $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.067, 0.094, 0.153, 1) : $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.961, 0.973, 0.988, 1);
  [labels.fiveName, labels.fiveReset, labels.weekName, labels.weekReset].forEach((label) => label.setTextColor(muted));
  [labels.fiveValue, labels.weekValue].forEach((label) => label.setTextColor(strong));
}

function applyLayout(pet) {
  const scale = Math.max(0.78, Math.min(1.6, Number(pet.height) / 87));
  const labelWidth = Math.round(44 * scale);
  const valueWidth = Math.round(50 * scale);
  const resetWidth = Math.round(82 * scale);
  const rowHeight = Math.round(24 * scale);
  const fontSize = Math.round(13.5 * scale * 10) / 10;
  layoutWidth = labelWidth + valueWidth + resetWidth;
  layoutHeight = rowHeight * 2;

  const y2 = 0;
  const y1 = rowHeight;
  const columns = [
    { x: 0, width: labelWidth },
    { x: labelWidth, width: valueWidth },
    { x: labelWidth + valueWidth, width: resetWidth }
  ];
  labels.fiveName.setFrame($.NSMakeRect(columns[0].x, y1, columns[0].width, rowHeight));
  labels.fiveValue.setFrame($.NSMakeRect(columns[1].x, y1, columns[1].width, rowHeight));
  labels.fiveReset.setFrame($.NSMakeRect(columns[2].x, y1, columns[2].width, rowHeight));
  labels.weekName.setFrame($.NSMakeRect(columns[0].x, y2, columns[0].width, rowHeight));
  labels.weekValue.setFrame($.NSMakeRect(columns[1].x, y2, columns[1].width, rowHeight));
  labels.weekReset.setFrame($.NSMakeRect(columns[2].x, y2, columns[2].width, rowHeight));
  Object.keys(labels).forEach((key) => {
    const isValue = key === "fiveValue" || key === "weekValue";
    labels[key].setFont(isValue ? $.NSFont.boldSystemFontOfSize(fontSize) : $.NSFont.systemFontOfSize(fontSize));
  });
  content.setFrame($.NSMakeRect(0, 0, layoutWidth, layoutHeight));
}

function positionWindow() {
  const pet = getPetBounds();
  if (!pet) return;
  applyLayout(pet);
  const frame = mainScreenFrame();
  const leftTop = Math.max(0, Math.min(pet.x + pet.width / 2 - layoutWidth / 2, Number(frame.size.width) - layoutWidth));
  const top = Math.max(0, Math.min(pet.y + pet.height + 2 - layoutHeight * 0.1, Number(frame.size.height) - layoutHeight));
  const cocoaY = Number(frame.size.height) - top - layoutHeight;
  panel.setFrameDisplay($.NSMakeRect(leftTop, cocoaY, layoutWidth, layoutHeight), true);
}

function updateTexts(data) {
  labels.fiveValue.setStringValue(data.five);
  labels.fiveReset.setStringValue(data.fiveReset);
  labels.weekValue.setStringValue(data.week);
  labels.weekReset.setStringValue(data.weekReset);
}

function showQuota(animate) {
  setTextColor();
  positionWindow();
  updateTexts(ensureQuota());
  panel.setAlphaValue(1);
  panel.orderFrontRegardless();
  visibleUntil = nowMs() + 7000;
  if (animate) {
    try {
      content.setFrameCenterRotation(0);
      content.setBoundsSize($.NSMakeSize(layoutWidth * 0.82, layoutHeight * 0.82));
      $.NSAnimationContext.runAnimationGroupCompletionHandler((context) => {
        context.setDuration(0.42);
        content.animator.setBoundsSize($.NSMakeSize(layoutWidth, layoutHeight));
      }, null);
    } catch (error) {
      content.setBoundsSize($.NSMakeSize(layoutWidth, layoutHeight));
    }
  } else {
    content.setBoundsSize($.NSMakeSize(layoutWidth, layoutHeight));
  }
}

function hideQuota() {
  panel.orderOut(null);
  visibleUntil = 0;
}

function selfCleanup() {
  try {
    app.doShellScript([
      "/bin/launchctl bootout gui/$(/usr/bin/id -u) " + shellQuote(launchAgentPath) + " >/dev/null 2>&1 || true",
      "/bin/rm -f " + shellQuote(launchAgentPath),
      "(/bin/sleep 1; /bin/rm -rf " + shellQuote(appHome) + ") >/dev/null 2>&1 &"
    ].join("; "));
  } catch (error) {}
  $.exit(0);
}

function tick() {
  if (packageDir && !fileExists(packageDir)) selfCleanup();

  const current = nowMs();
  if (!quota || current - lastQuotaFetch > 60000) {
    const data = fetchQuota();
    const key = warningKey(data);
    if (key && (key !== lastWarningKey || current - lastWarningAt > 30 * 60 * 1000)) {
      lastWarningKey = key;
      lastWarningAt = current;
      showQuota(true);
    }
  }

  const pet = getPetBounds();
  const hit = clickBounds(pet);
  const point = mousePoint();
  const hover = pointInBounds(point, hit);
  const buttons = pressedButtons();
  const down = (buttons & 1) !== 0;

  if (down && !wasDown) {
    downX = point.x;
    downY = point.y;
    maxMove = 0;
    downStartedOnPet = hover;
  }
  if (down && wasDown) {
    maxMove = Math.max(maxMove, Math.max(Math.abs(point.x - downX), Math.abs(point.y - downY)));
    if (maxMove > 8 && downStartedOnPet) hideQuota();
  }
  if (!down && wasDown) {
    if (downStartedOnPet && maxMove <= 10) showQuota(false);
    downStartedOnPet = false;
  }
  if (hover && !isHovering && current - lastHoverShow > 7000) {
    lastHoverShow = current;
    showQuota(false);
  }
  isHovering = hover;
  wasDown = down;

  if (visibleUntil && current > visibleUntil) hideQuota();
}

ensureHome();
fetchQuota();

while (true) {
  tick();
  callMaybe($.NSRunLoop, "currentRunLoop").runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.12));
}
