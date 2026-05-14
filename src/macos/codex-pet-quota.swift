import AppKit
import Foundation
import QuartzCore

let home = FileManager.default.homeDirectoryForCurrentUser.path
let codexHome = "\(home)/.codex"
let statePath = "\(codexHome)/.codex-global-state.json"
let authPath = "\(codexHome)/auth.json"
let appHome = "\(home)/.codex-pet-quota"
let pidPath = "\(appHome)/app.pid"
let configPath = "\(appHome)/config.json"
let launchAgentPath = "\(home)/Library/LaunchAgents/com.kname1.codex-pet-quota.plist"

struct Quota {
  var five: String = "?"
  var fiveReset: String = "?"
  var week: String = "?"
  var weekReset: String = "?"
}

final class QuotaOverlay {
  private let panel: NSPanel
  private let content = NSView(frame: NSRect(x: 0, y: 0, width: 230, height: 78))
  private let fiveName = NSTextField(labelWithString: "5h")
  private let fiveValue = NSTextField(labelWithString: "...")
  private let fiveReset = NSTextField(labelWithString: "...")
  private let weekName = NSTextField(labelWithString: "Week")
  private let weekValue = NSTextField(labelWithString: "...")
  private let weekReset = NSTextField(labelWithString: "...")
  private var quota = Quota()
  private var lastQuotaFetch = Date.distantPast
  private var lastHoverShow = Date.distantPast
  private var lastWarningKey: String?
  private var lastWarningAt = Date.distantPast
  private var wasDown = false
  private var isHovering = false
  private var downStartedOnPet = false
  private var downPoint = CGPoint.zero
  private var maxMove: CGFloat = 0
  private var visibleUntil: Date?
  private var layoutSize = CGSize(width: 176, height: 48)
  private let packageDir: String?

  init(packageDir: String?) {
    self.packageDir = packageDir
    panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 230, height: 78),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.ignoresMouseEvents = true
    panel.hasShadow = false
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.level = .screenSaver
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
    panel.contentView = content

    [fiveName, fiveValue, fiveReset, weekName, weekValue, weekReset].forEach {
      $0.alignment = .center
      $0.isSelectable = false
      content.addSubview($0)
    }
  }

  func start() {
    quota = fetchQuota()
    lastQuotaFetch = Date()
    Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
      self?.tick()
    }
  }

  private func tick() {
    if let packageDir = packageDir, !FileManager.default.fileExists(atPath: packageDir) {
      cleanupAndExit()
      return
    }

    let now = Date()
    if now.timeIntervalSince(lastQuotaFetch) > 60 {
      quota = fetchQuota()
      lastQuotaFetch = now
      if let key = warningKey(quota), key != lastWarningKey || now.timeIntervalSince(lastWarningAt) > 1800 {
        lastWarningKey = key
        lastWarningAt = now
        showQuota(animated: true)
      }
    }

    let pet = petBounds()
    let hit = clickBounds(for: pet)
    let point = mousePoint()
    let hover = hit.map { $0.contains(point) } ?? false
    let down = (NSEvent.pressedMouseButtons & 1) != 0

    if down && !wasDown {
      downPoint = point
      maxMove = 0
      downStartedOnPet = hover
    }
    if down && wasDown {
      maxMove = max(maxMove, max(abs(point.x - downPoint.x), abs(point.y - downPoint.y)))
      if maxMove > 8 && downStartedOnPet {
        hideQuota()
      }
    }
    if !down && wasDown {
      if downStartedOnPet && maxMove <= 10 {
        showQuota(animated: false)
      }
      downStartedOnPet = false
    }
    if hover && !isHovering && now.timeIntervalSince(lastHoverShow) > 7 {
      lastHoverShow = now
      showQuota(animated: false)
    }
    isHovering = hover
    wasDown = down

    if let visibleUntil = visibleUntil, now > visibleUntil {
      hideQuota()
    }
  }

  private func showQuota(animated: Bool) {
    setTextColor()
    guard positionWindow() else {
      hideQuota()
      return
    }
    updateTexts()
    panel.alphaValue = 1
    panel.orderFrontRegardless()
    visibleUntil = Date().addingTimeInterval(7)

    if animated {
      content.layer?.removeAllAnimations()
      content.wantsLayer = true
      content.layer?.anchorPoint = CGPoint(x: 0.5, y: 0.5)
      content.layer?.setAffineTransform(CGAffineTransform(scaleX: 1.25, y: 1.25))
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.42
        context.timingFunction = CAMediaTimingFunction(name: .easeOut)
        content.animator().layer?.setAffineTransform(.identity)
      }
    }
  }

  private func hideQuota() {
    panel.orderOut(nil)
    visibleUntil = nil
  }

  private func updateTexts() {
    fiveValue.stringValue = quota.five
    fiveReset.stringValue = quota.fiveReset
    weekValue.stringValue = quota.week
    weekReset.stringValue = quota.weekReset
  }

  private func setTextColor() {
    let darkMode = UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark"
    let muted = darkMode ? NSColor(calibratedRed: 0.859, green: 0.898, blue: 0.937, alpha: 1) : NSColor(calibratedRed: 0.263, green: 0.322, blue: 0.408, alpha: 1)
    let strong = darkMode ? NSColor(calibratedRed: 0.961, green: 0.973, blue: 0.988, alpha: 1) : NSColor(calibratedRed: 0.067, green: 0.094, blue: 0.153, alpha: 1)
    [fiveName, fiveReset, weekName, weekReset].forEach { $0.textColor = muted }
    [fiveValue, weekValue].forEach { $0.textColor = strong }
  }

  private func positionWindow() -> Bool {
    guard let pet = petBounds() else { return false }
    applyLayout(pet: pet)
    let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let anchorX = pet.midX
    let top = pet.maxY + 2 - layoutSize.height * 0.1
    let x = min(max(screenFrame.minX, anchorX - layoutSize.width / 2), screenFrame.maxX - layoutSize.width)
    let y = screenFrame.maxY - min(max(screenFrame.minY, top), screenFrame.maxY - layoutSize.height) - layoutSize.height
    panel.setFrame(NSRect(x: x, y: y, width: layoutSize.width, height: layoutSize.height), display: true)
    return true
  }

  private func applyLayout(pet: CGRect?) {
    let scale = min(1.6, max(0.78, (pet?.height ?? 87) / 87))
    let labelWidth = round(44 * scale)
    let valueWidth = round(50 * scale)
    let resetWidth = round(82 * scale)
    let rowHeight = round(24 * scale)
    let fontSize = round(13.5 * scale * 10) / 10
    layoutSize = CGSize(width: labelWidth + valueWidth + resetWidth, height: rowHeight * 2)

    fiveName.frame = NSRect(x: 0, y: rowHeight, width: labelWidth, height: rowHeight)
    fiveValue.frame = NSRect(x: labelWidth, y: rowHeight, width: valueWidth, height: rowHeight)
    fiveReset.frame = NSRect(x: labelWidth + valueWidth, y: rowHeight, width: resetWidth, height: rowHeight)
    weekName.frame = NSRect(x: 0, y: 0, width: labelWidth, height: rowHeight)
    weekValue.frame = NSRect(x: labelWidth, y: 0, width: valueWidth, height: rowHeight)
    weekReset.frame = NSRect(x: labelWidth + valueWidth, y: 0, width: resetWidth, height: rowHeight)
    [fiveName, fiveReset, weekName, weekReset].forEach { $0.font = .systemFont(ofSize: fontSize, weight: .semibold) }
    [fiveValue, weekValue].forEach { $0.font = .boldSystemFont(ofSize: fontSize) }
    content.frame = NSRect(origin: .zero, size: layoutSize)
  }
}

func readJSON(_ path: String) -> Any? {
  guard let data = FileManager.default.contents(atPath: path) else { return nil }
  return try? JSONSerialization.jsonObject(with: data)
}

func configPackageDir() -> String? {
  guard let config = readJSON(configPath) as? [String: Any] else { return nil }
  return config["packageDir"] as? String
}

func fetchQuota() -> Quota {
  guard
    let auth = readJSON(authPath) as? [String: Any],
    let tokens = auth["tokens"] as? [String: Any],
    let token = tokens["access_token"] as? String,
    let url = URL(string: "https://chatgpt.com/backend-api/wham/usage")
  else {
    return Quota()
  }

  let process = Process()
  let output = Pipe()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
  process.arguments = [
    "-sS",
    "--max-time",
    "20",
    "-H",
    "Authorization: Bearer \(token)",
    "-H",
    "Accept: application/json",
    "-H",
    "User-Agent: codex-pet-quota",
    url.absoluteString
  ]
  process.standardOutput = output
  process.standardError = Pipe()
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    return Quota()
  }
  guard process.terminationStatus == 0 else { return Quota() }
  let responseData = output.fileHandleForReading.readDataToEndOfFile()

  guard
    let usage = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
    let rateLimit = usage["rate_limit"] as? [String: Any]
  else {
    return Quota()
  }

  let primary = rateLimit["primary_window"] as? [String: Any]
  let secondary = rateLimit["secondary_window"] as? [String: Any]
  return Quota(
    five: remainingText(primary),
    fiveReset: resetText(primary?["reset_at"]),
    week: remainingText(secondary),
    weekReset: resetText(secondary?["reset_at"])
  )
}

func remainingText(_ window: [String: Any]?) -> String {
  guard let window = window else { return "?" }
  if let value = window["remaining_percent"] as? NSNumber {
    return "\(Int(round(value.doubleValue)))%"
  }
  if let value = window["used_percent"] as? NSNumber {
    return "\(max(0, Int(round(100 - value.doubleValue))))%"
  }
  return "?"
}

func resetText(_ value: Any?) -> String {
  guard let number = value as? NSNumber else { return "?" }
  let date = Date(timeIntervalSince1970: number.doubleValue)
  let formatter = DateFormatter()
  formatter.dateFormat = "M.d HH:mm"
  return formatter.string(from: date)
}

func warningKey(_ quota: Quota) -> String? {
  var parts: [String] = []
  if let level = warningLevel(quota.five) { parts.append("5h:\(level)") }
  if let level = warningLevel(quota.week) { parts.append("week:\(level)") }
  return parts.isEmpty ? nil : parts.joined(separator: "|")
}

func warningLevel(_ text: String) -> Int? {
  guard let match = text.range(of: #"\d+"#, options: .regularExpression), let value = Int(text[match]) else { return nil }
  if value <= 5 { return 5 }
  if value <= 10 { return 10 }
  if value <= 20 { return 20 }
  return nil
}

func petBounds() -> CGRect? {
  guard let state = readJSON(statePath) else { return nil }
  if let dict = state as? [String: Any] {
    let atom = dict["electron-persisted-atom-state"] as? [String: Any] ?? dict
    let overlay = atom["electron-avatar-overlay-bounds"] ?? dict["electron-avatar-overlay-bounds"]
    return normalizePetBounds(overlay) ?? findPetBounds(dict, depth: 0)
  }
  return nil
}

func normalizePetBounds(_ value: Any?) -> CGRect? {
  guard let dict = value as? [String: Any] else { return nil }
  if let mascot = dict["mascot"] as? [String: Any] {
    let width = number(mascot["width"])
    let height = number(mascot["height"])
    if reasonableSize(width, height) {
      return CGRect(
        x: number(dict["x"]) + number(mascot["left"]),
        y: number(dict["y"]) + number(mascot["top"]),
        width: width,
        height: height
      )
    }
  }
  let width = number(dict["width"])
  let height = number(dict["height"])
  if dict["x"] != nil && dict["y"] != nil && reasonableSize(width, height) {
    return CGRect(x: number(dict["x"]), y: number(dict["y"]), width: width, height: height)
  }
  return nil
}

func findPetBounds(_ value: Any, depth: Int) -> CGRect? {
  if depth > 8 { return nil }
  if let normalized = normalizePetBounds(value) { return normalized }
  if let dict = value as? [String: Any] {
    for child in dict.values {
      if let found = findPetBounds(child, depth: depth + 1) { return found }
    }
  } else if let array = value as? [Any] {
    for child in array {
      if let found = findPetBounds(child, depth: depth + 1) { return found }
    }
  }
  return nil
}

func number(_ value: Any?) -> CGFloat {
  if let value = value as? NSNumber { return CGFloat(truncating: value) }
  if let value = value as? Double { return CGFloat(value) }
  if let value = value as? Int { return CGFloat(value) }
  return 0
}

func reasonableSize(_ width: CGFloat, _ height: CGFloat) -> Bool {
  width >= 20 && width <= 360 && height >= 20 && height <= 360
}

func clickBounds(for pet: CGRect?) -> CGRect? {
  guard let pet = pet else { return nil }
  let pad = max(10, round(pet.height * 0.28))
  return pet.insetBy(dx: -pad, dy: -pad)
}

func mousePoint() -> CGPoint {
  let point = NSEvent.mouseLocation
  let frame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
  return CGPoint(x: point.x, y: frame.height - point.y)
}

func cleanupAndExit() {
  let command = [
    "/bin/launchctl bootout gui/$(/usr/bin/id -u) '\(launchAgentPath)' >/dev/null 2>&1 || true",
    "/bin/rm -f '\(launchAgentPath)'",
    "(/bin/sleep 1; /bin/rm -rf '\(appHome)') >/dev/null 2>&1 &"
  ].joined(separator: "; ")
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/bin/sh")
  process.arguments = ["-c", command]
  try? process.run()
  NSApp.terminate(nil)
}

try? FileManager.default.createDirectory(atPath: appHome, withIntermediateDirectories: true)
try? "\(ProcessInfo.processInfo.processIdentifier)".write(toFile: pidPath, atomically: true, encoding: .utf8)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.finishLaunching()

let overlay = QuotaOverlay(packageDir: configPackageDir())
overlay.start()
app.run()
