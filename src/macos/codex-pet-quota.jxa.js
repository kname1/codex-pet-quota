ObjC.import("Cocoa");
ObjC.import("Foundation");
ObjC.import("AppKit");

var scriptApp = Application.currentApplication();
scriptApp.includeStandardAdditions = true;

var home = ObjC.unwrap($.NSHomeDirectory());
var codexHome = home + "/.codex";
var statePath = codexHome + "/.codex-global-state.json";
var authPath = codexHome + "/auth.json";
var appHome = home + "/.codex-pet-quota";
var pidPath = appHome + "/app.pid";
var configPath = appHome + "/config.json";
var fatalLogPath = appHome + "/macos-error.log";
var launchAgentPath = home + "/Library/LaunchAgents/com.kname1.codex-pet-quota.plist";
var layoutWidth = 176;
var layoutHeight = 48;

function objcValue(owner, name) {
  var value = owner[name];
  if (typeof value === "function") {
    try {
      return value();
    } catch (error) {
      return value;
    }
  }
  return value;
}

function nsString(value) {
  return $.NSString.alloc.initWithUTF8String(String(value));
}

function writeText(path, value) {
  nsString(value).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, $());
}

function appendText(path, value) {
  var manager = $.NSFileManager.defaultManager;
  var data = nsString(value).dataUsingEncoding($.NSUTF8StringEncoding);
  if (!manager.fileExistsAtPath(path)) {
    manager.createFileAtPathContentsAttributes(path, data, $());
    return;
  }
  var handle = $.NSFileHandle.fileHandleForWritingAtPath(path);
  handle.seekToEndOfFile;
  handle.writeData(data);
  handle.closeFile;
}

function logFatal(error) {
  try {
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(appHome, true, $(), $());
    appendText(fatalLogPath, "\n[" + new Date().toISOString() + "] " + String(error) + "\n");
  } catch (ignored) {}
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function nowMs() {
  return new Date().getTime();
}

function fileExists(path) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(path);
}

function readText(path) {
  try {
    var text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, $());
    if (!text) return null;
    return ObjC.unwrap(text);
  } catch (error) {
    return null;
  }
}

function parseJson(path) {
  var text = readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function pad2(value) {
  value = String(value);
  return value.length < 2 ? "0" + value : value;
}

function resetText(value) {
  if (!value) return "?";
  var date = new Date(Number(value) * 1000);
  if (isNaN(date.getTime())) return "?";
  return String(date.getMonth() + 1) + "." + String(date.getDate()) + " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
}

function remainingText(window) {
  if (!window) return "?";
  if (window.remaining_percent !== undefined && window.remaining_percent !== null) return String(Math.round(Number(window.remaining_percent))) + "%";
  if (window.used_percent !== undefined && window.used_percent !== null) return String(Math.max(0, Math.round(100 - Number(window.used_percent)))) + "%";
  return "?";
}

function getPackageDir() {
  var config = parseJson(configPath);
  if (config && config.packageDir) return String(config.packageDir);
  return "";
}

function getPetBounds() {
  var state = parseJson(statePath);
  if (!state) return null;
  var atom = state["electron-persisted-atom-state"] || state;
  var overlay = atom["electron-avatar-overlay-bounds"] || state["electron-avatar-overlay-bounds"];
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
  var pad = Math.max(10, Math.round(bounds.height * 0.28));
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2
  };
}

function mainScreenFrame() {
  return $.NSScreen.mainScreen.frame;
}

function mousePoint() {
  var point = $.NSEvent.mouseLocation;
  var frame = mainScreenFrame();
  return {
    x: Number(point.x),
    y: Number(frame.size.height) - Number(point.y)
  };
}

function pressedButtons() {
  try {
    return Number($.NSEvent.pressedMouseButtons);
  } catch (error) {
    return 0;
  }
}

function isLightMode() {
  try {
    var style = scriptApp.doShellScript("/usr/bin/defaults read -g AppleInterfaceStyle 2>/dev/null || true");
    return !String(style).match(/Dark/i);
  } catch (error) {
    return false;
  }
}

function fetchQuota() {
  try {
    var auth = parseJson(authPath);
    var token = auth && auth.tokens && auth.tokens.access_token;
    if (!token) throw new Error("No access token");
    var command = [
      "/usr/bin/curl -sS --max-time 20",
      "-H " + shellQuote("Authorization: Bearer " + token),
      "-H " + shellQuote("Accept: application/json"),
      "-H " + shellQuote("User-Agent: codex-pet-quota"),
      shellQuote("https://chatgpt.com/backend-api/wham/usage")
    ].join(" ");
    var raw = scriptApp.doShellScript(command);
    var usage = JSON.parse(raw);
    var primary = usage.rate_limit && usage.rate_limit.primary_window;
    var secondary = usage.rate_limit && usage.rate_limit.secondary_window;
    return {
      five: remainingText(primary),
      fiveReset: resetText(primary && primary.reset_at),
      week: remainingText(secondary),
      weekReset: resetText(secondary && secondary.reset_at)
    };
  } catch (error) {
    return { five: "?", fiveReset: "?", week: "?", weekReset: "?" };
  }
}

function percent(text) {
  var match = String(text || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function warningLevel(value) {
  if (value === null) return null;
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  return null;
}

function warningKey(data) {
  var parts = [];
  var five = warningLevel(percent(data.five));
  var week = warningLevel(percent(data.week));
  if (five !== null) parts.push("5h:" + five);
  if (week !== null) parts.push("week:" + week);
  return parts.length ? parts.join("|") : null;
}

function makeLabel(text, bold, content) {
  var label = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 0, 10, 10));
  label.setStringValue(text);
  label.setBezeled(false);
  label.setBordered(false);
  label.setDrawsBackground(false);
  label.setEditable(false);
  label.setSelectable(false);
  label.setAlignment(2);
  label.setFont(bold ? $.NSFont.boldSystemFontOfSize(13.5) : $.NSFont.systemFontOfSize(13.5));
  content.addSubview(label);
  return label;
}

function setTextColor(labels) {
  var light = isLightMode();
  var muted = light ? $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.263, 0.322, 0.408, 1) : $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.859, 0.898, 0.937, 1);
  var strong = light ? $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.067, 0.094, 0.153, 1) : $.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.961, 0.973, 0.988, 1);
  labels.fiveName.setTextColor(muted);
  labels.fiveReset.setTextColor(muted);
  labels.weekName.setTextColor(muted);
  labels.weekReset.setTextColor(muted);
  labels.fiveValue.setTextColor(strong);
  labels.weekValue.setTextColor(strong);
}

function applyLayout(pet, labels, content) {
  var scale = Math.max(0.78, Math.min(1.6, Number(pet.height) / 87));
  var labelWidth = Math.round(44 * scale);
  var valueWidth = Math.round(50 * scale);
  var resetWidth = Math.round(82 * scale);
  var rowHeight = Math.round(24 * scale);
  var fontSize = Math.round(13.5 * scale * 10) / 10;
  layoutWidth = labelWidth + valueWidth + resetWidth;
  layoutHeight = rowHeight * 2;

  labels.fiveName.setFrame($.NSMakeRect(0, rowHeight, labelWidth, rowHeight));
  labels.fiveValue.setFrame($.NSMakeRect(labelWidth, rowHeight, valueWidth, rowHeight));
  labels.fiveReset.setFrame($.NSMakeRect(labelWidth + valueWidth, rowHeight, resetWidth, rowHeight));
  labels.weekName.setFrame($.NSMakeRect(0, 0, labelWidth, rowHeight));
  labels.weekValue.setFrame($.NSMakeRect(labelWidth, 0, valueWidth, rowHeight));
  labels.weekReset.setFrame($.NSMakeRect(labelWidth + valueWidth, 0, resetWidth, rowHeight));

  labels.fiveName.setFont($.NSFont.systemFontOfSize(fontSize));
  labels.fiveReset.setFont($.NSFont.systemFontOfSize(fontSize));
  labels.weekName.setFont($.NSFont.systemFontOfSize(fontSize));
  labels.weekReset.setFont($.NSFont.systemFontOfSize(fontSize));
  labels.fiveValue.setFont($.NSFont.boldSystemFontOfSize(fontSize));
  labels.weekValue.setFont($.NSFont.boldSystemFontOfSize(fontSize));
  content.setFrame($.NSMakeRect(0, 0, layoutWidth, layoutHeight));
}

function positionWindow(panel, labels, content) {
  var pet = getPetBounds();
  if (!pet) return false;
  applyLayout(pet, labels, content);
  var frame = mainScreenFrame();
  var leftTop = Math.max(0, Math.min(pet.x + pet.width / 2 - layoutWidth / 2, Number(frame.size.width) - layoutWidth));
  var top = Math.max(0, Math.min(pet.y + pet.height + 2 - layoutHeight * 0.1, Number(frame.size.height) - layoutHeight));
  var cocoaY = Number(frame.size.height) - top - layoutHeight;
  panel.setFrameDisplay($.NSMakeRect(leftTop, cocoaY, layoutWidth, layoutHeight), true);
  return true;
}

function updateTexts(labels, data) {
  labels.fiveValue.setStringValue(data.five);
  labels.fiveReset.setStringValue(data.fiveReset);
  labels.weekValue.setStringValue(data.week);
  labels.weekReset.setStringValue(data.weekReset);
}

function cleanupAndExit() {
  try {
    scriptApp.doShellScript([
      "/bin/launchctl bootout gui/$(/usr/bin/id -u) " + shellQuote(launchAgentPath) + " >/dev/null 2>&1 || true",
      "/bin/rm -f " + shellQuote(launchAgentPath),
      "(/bin/sleep 1; /bin/rm -rf " + shellQuote(appHome) + ") >/dev/null 2>&1 &"
    ].join("; "));
  } catch (error) {}
  $.exit(0);
}

function run() {
  var packageDir = getPackageDir();
  var quota = null;
  var lastQuotaFetch = 0;
  var lastHoverShow = 0;
  var lastWarningKey = null;
  var lastWarningAt = 0;
  var wasDown = false;
  var isHovering = false;
  var downStartedOnPet = false;
  var downX = 0;
  var downY = 0;
  var maxMove = 0;
  var visibleUntil = 0;
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(appHome, true, $(), $());
  var processInfo = objcValue($.NSProcessInfo, "processInfo");
  writeText(pidPath, String(Number(objcValue(processInfo, "processIdentifier"))));

  $.NSApplication.sharedApplication.setActivationPolicy(1);
  $.NSApplication.sharedApplication.finishLaunching;

  var panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, 230, 78), 0, 2, false);
  panel.setOpaque(false);
  panel.setBackgroundColor($.NSColor.clearColor);
  panel.setIgnoresMouseEvents(true);
  panel.setHasShadow(false);
  panel.setLevel(3);
  panel.setCollectionBehavior(17);

  var content = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 230, 78));
  panel.setContentView(content);

  var labels = {
    fiveName: makeLabel("5h", false, content),
    fiveValue: makeLabel("...", true, content),
    fiveReset: makeLabel("...", false, content),
    weekName: makeLabel("Week", false, content),
    weekValue: makeLabel("...", true, content),
    weekReset: makeLabel("...", false, content)
  };

  function localFetchQuota() {
    quota = fetchQuota();
    lastQuotaFetch = nowMs();
    return quota;
  }

  function localEnsureQuota() {
    if (!quota || nowMs() - lastQuotaFetch > 60000) return localFetchQuota();
    return quota;
  }

  function hideQuota() {
    panel.orderOut($());
    visibleUntil = 0;
  }

  function showQuota() {
    setTextColor(labels);
    if (!positionWindow(panel, labels, content)) return;
    updateTexts(labels, localEnsureQuota());
    panel.setAlphaValue(1);
    panel.orderFrontRegardless();
    visibleUntil = nowMs() + 7000;
  }

  localFetchQuota();

  while (true) {
    if (packageDir && !fileExists(packageDir)) cleanupAndExit();

    var current = nowMs();
    if (!quota || current - lastQuotaFetch > 60000) {
      var data = localFetchQuota();
      var key = warningKey(data);
      if (key && (key !== lastWarningKey || current - lastWarningAt > 30 * 60 * 1000)) {
        lastWarningKey = key;
        lastWarningAt = current;
        showQuota();
      }
    }

    var pet = getPetBounds();
    var hit = clickBounds(pet);
    var point = mousePoint();
    var hover = pointInBounds(point, hit);
    var down = (pressedButtons() & 1) !== 0;

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
      if (downStartedOnPet && maxMove <= 10) showQuota();
      downStartedOnPet = false;
    }
    if (hover && !isHovering && current - lastHoverShow > 7000) {
      lastHoverShow = current;
      showQuota();
    }
    isHovering = hover;
    wasDown = down;

    if (visibleUntil && current > visibleUntil) hideQuota();
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.12));
  }
}

try {
  run();
} catch (error) {
  logFatal(error);
  throw error;
}
