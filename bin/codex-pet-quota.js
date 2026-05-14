#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const packageJson = require(path.join(rootDir, "package.json"));
const stateDir = path.join(os.homedir(), ".codex-pet-quota");
const runtimeDir = path.join(stateDir, "runtime");
const pidFile = path.join(stateDir, "app.pid");
const configFile = path.join(stateDir, "config.json");

const windowsSource = path.join(rootDir, "src", "windows", "codex-pet-quota.ps1");
const windowsRuntime = path.join(runtimeDir, "codex-pet-quota.ps1");
const windowsAutostartScript = path.join(stateDir, "start.vbs");
const windowsRunKeyName = "CodexPetQuota";

const macSource = path.join(rootDir, "src", "macos", "codex-pet-quota.jxa.js");
const macRuntime = path.join(runtimeDir, "codex-pet-quota.jxa.js");
const macLaunchAgentId = "com.kname1.codex-pet-quota";
const macLaunchAgentPath = path.join(os.homedir(), "Library", "LaunchAgents", `${macLaunchAgentId}.plist`);

function ensureStateDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

function ensureConfig() {
  ensureStateDir();
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      JSON.stringify(
        {
          autoStart: true,
          refreshIntervalMs: 60000,
          bubbleDismissMs: 7000,
          hotspot: {
            enabled: true,
            padding: 10
          }
        },
        null,
        2
      )
    );
  }
}

function readPid() {
  try {
    return Number(fs.readFileSync(pidFile, "utf8").trim());
  } catch {
    return null;
  }
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function unsupportedLinux() {
  console.log("Linux support will be added after Codex for Linux is available.");
}

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteVbs(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function prepareWindowsRuntime() {
  ensureStateDir();
  fs.copyFileSync(windowsSource, windowsRuntime);
}

function prepareMacRuntime() {
  ensureStateDir();
  fs.copyFileSync(macSource, macRuntime);
}

function stopPid({ quiet = false } = {}) {
  const pid = readPid();
  if (!isRunning(pid)) {
    if (!quiet) console.log("Codex Pet Quota is not running.");
    return false;
  }
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: quiet ? "ignore" : "inherit", windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
    if (!quiet) console.log("Stop requested.");
    return true;
  } catch (error) {
    if (!quiet) console.error(`Could not stop process ${pid}: ${error.message}`);
    process.exitCode = 1;
    return false;
  }
}

function stopWindowsProcesses({ quiet = false } = {}) {
  if (process.platform !== "win32") return;
  const escapedSource = windowsSource.replace(/'/g, "''");
  const escapedRuntime = windowsRuntime.replace(/'/g, "''");
  const command = `$source = '${escapedSource}'; $runtime = '${escapedRuntime}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $source + '*') -or $_.CommandLine -like ('*' + $runtime + '*') -or $_.CommandLine -like '*codex-pet-quota.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: quiet ? "ignore" : "inherit",
    windowsHide: true
  });
}

function writeWindowsAutostart() {
  const command = `${quoteVbs(process.execPath)} ${quoteVbs(__filename)} __start`;
  fs.writeFileSync(
    windowsAutostartScript,
    ['Set shell = CreateObject("WScript.Shell")', `shell.Run ${quoteVbs(command)}, 0, False`].join("\r\n")
  );
  spawnSync(
    "reg",
    [
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      windowsRunKeyName,
      "/t",
      "REG_SZ",
      "/d",
      `wscript.exe "${windowsAutostartScript}"`,
      "/f"
    ],
    { stdio: "ignore", windowsHide: true }
  );
}

function deleteWindowsAutostart() {
  spawnSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", windowsRunKeyName, "/f"], {
    stdio: "ignore",
    windowsHide: true
  });
}

function launchWindows(args = []) {
  if (isRunning(readPid())) {
    console.log(`Codex Pet Quota is already running (pid ${readPid()}).`);
    console.log(`State: ${stateDir}`);
    return;
  }
  prepareWindowsRuntime();
  const runtimeArgs = ["--package-dir", rootDir, ...args];
  const psArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Start-Process -FilePath powershell.exe -WorkingDirectory ${quotePs(stateDir)} -WindowStyle Hidden -ArgumentList @('-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',${quotePs(windowsRuntime)}${runtimeArgs.map((arg) => `,${quotePs(arg)}`).join("")})`
  ];
  const result = spawnSync("powershell.exe", psArgs, { stdio: "inherit", windowsHide: true });
  if (result.status && result.status !== 0) {
    process.exitCode = result.status;
    return;
  }
  console.log("Codex Pet Quota started.");
  console.log(`State: ${stateDir}`);
}

function macGuiTarget() {
  return `gui/${process.getuid()}`;
}

function writeMacLaunchAgent() {
  fs.mkdirSync(path.dirname(macLaunchAgentPath), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(macLaunchAgentId)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-l</string>
    <string>JavaScript</string>
    <string>${escapeXml(macRuntime)}</string>
    <string>--package-dir</string>
    <string>${escapeXml(rootDir)}</string>
    <string>--install</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(stateDir, "macos.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(stateDir, "macos-error.log"))}</string>
</dict>
</plist>
`;
  fs.writeFileSync(macLaunchAgentPath, plist);
}

function unloadMacLaunchAgent() {
  if (process.platform !== "darwin") return;
  spawnSync("launchctl", ["bootout", macGuiTarget(), macLaunchAgentPath], { stdio: "ignore" });
}

function loadMacLaunchAgent() {
  unloadMacLaunchAgent();
  spawnSync("launchctl", ["bootstrap", macGuiTarget(), macLaunchAgentPath], { stdio: "ignore" });
  spawnSync("launchctl", ["kickstart", "-k", `${macGuiTarget()}/${macLaunchAgentId}`], { stdio: "ignore" });
}

function launchMac(args = []) {
  if (isRunning(readPid())) {
    console.log(`Codex Pet Quota is already running (pid ${readPid()}).`);
    console.log(`State: ${stateDir}`);
    return;
  }
  prepareMacRuntime();
  const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", macRuntime, "--package-dir", rootDir, ...args], {
    cwd: stateDir,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  console.log("Codex Pet Quota started.");
  console.log(`State: ${stateDir}`);
}

function install() {
  if (process.platform === "linux") {
    unsupportedLinux();
    return;
  }
  ensureConfig();
  stop({ quiet: true });
  if (process.platform === "win32") {
    prepareWindowsRuntime();
    writeWindowsAutostart();
    launchWindows(["--install"]);
    return;
  }
  if (process.platform === "darwin") {
    prepareMacRuntime();
    writeMacLaunchAgent();
    loadMacLaunchAgent();
    setTimeout(() => {
      if (!isRunning(readPid())) launchMac(["--install"]);
    }, 250);
    console.log("Codex Pet Quota started.");
    console.log(`State: ${stateDir}`);
    return;
  }
  console.error(`Unsupported platform: ${process.platform}`);
  process.exitCode = 1;
}

function stop(options = {}) {
  const quiet = Boolean(options.quiet);
  if (process.platform === "linux") {
    if (!quiet) unsupportedLinux();
    return;
  }
  stopPid({ quiet });
  if (process.platform === "win32") {
    stopWindowsProcesses({ quiet });
  } else if (process.platform === "darwin") {
    unloadMacLaunchAgent();
  }
}

function uninstall() {
  const quiet = process.argv.includes("--quiet");
  if (process.platform === "linux") {
    if (!quiet) unsupportedLinux();
    return;
  }
  if (process.platform === "win32") deleteWindowsAutostart();
  if (process.platform === "darwin") {
    unloadMacLaunchAgent();
    try {
      fs.rmSync(macLaunchAgentPath, { force: true });
    } catch {}
  }
  stop({ quiet });
  try {
    fs.rmSync(stateDir, { recursive: true, force: true });
  } catch {}
  if (!quiet) {
    console.log("");
    console.log("Codex Pet Quota stopped.");
    console.log("Autostart and local state removed.");
  }
}

function status() {
  if (process.platform === "linux") {
    unsupportedLinux();
    return;
  }
  const pid = readPid();
  if (isRunning(pid)) {
    console.log(`Codex Pet Quota is running (pid ${pid}).`);
  } else {
    console.log("Codex Pet Quota is not running.");
  }
  console.log(`State: ${stateDir}`);
}

function help() {
  console.log(`codex-pet-quota

Usage:
  codex-pet-quota install      Enable startup and launch in the background
  codex-pet-quota status       Show process status
  codex-pet-quota stop         Stop the background app
  codex-pet-quota uninstall    Stop, disable startup, and remove local state
  codex-pet-quota -h           Show this help
  codex-pet-quota --version    Show version

Quick start:
  npm install -g codex-pet-quota
  codex-pet-quota install
`);
}

function postinstall() {
  console.log("");
  console.log("Codex Pet Quota installed.");
  console.log("Run this once to launch it and enable auto-start:");
  console.log("  codex-pet-quota install");
  console.log("");
}

const command = process.argv[2] || "help";

switch (command) {
  case "install":
    install();
    break;
  case "__start":
    if (process.platform === "win32") launchWindows(["--install"]);
    else if (process.platform === "darwin") launchMac(["--install"]);
    else unsupportedLinux();
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  case "uninstall":
    uninstall();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(packageJson.version);
    break;
  case "postinstall":
    postinstall();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
