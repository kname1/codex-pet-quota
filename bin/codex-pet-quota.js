#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const windowsAppEntry = path.join(rootDir, "src", "windows", "codex-pet-quota.ps1");
const stateDir = path.join(os.homedir(), ".codex-pet-quota");
const runtimeDir = path.join(stateDir, "runtime");
const runtimeAppEntry = path.join(runtimeDir, "codex-pet-quota.ps1");
const pidFile = path.join(stateDir, "app.pid");
const configFile = path.join(stateDir, "config.json");
const autostartScript = path.join(stateDir, "start.vbs");
const runKeyName = "CodexPetQuota";
const packageJson = require(path.join(rootDir, "package.json"));

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function prepareRuntime() {
  ensureStateDir();
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(windowsAppEntry, runtimeAppEntry);
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

function launch(args = [], detached = true) {
  if (process.platform !== "win32") {
    console.error("Codex Pet Quota currently supports Windows. macOS and Linux support is planned.");
    process.exit(1);
  }

  ensureStateDir();
  if (detached && isRunning(readPid())) {
    console.log(`Codex Pet Quota is already running (pid ${readPid()}).`);
    console.log(`State: ${stateDir}`);
    return;
  }
  prepareRuntime();
  const runtimeArgs = ["--package-dir", rootDir, ...args];
  if (detached) {
    const psArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Start-Process -FilePath powershell.exe -WorkingDirectory ${quotePs(stateDir)} -WindowStyle Hidden -ArgumentList @('-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',${quotePs(runtimeAppEntry)}${runtimeArgs.map((arg) => `,${quotePs(arg)}`).join("")})`
    ];
    const result = spawnSync("powershell.exe", psArgs, { stdio: "inherit", windowsHide: true });
    if (result.status && result.status !== 0) {
      process.exitCode = result.status;
      return;
    }
    console.log("Codex Pet Quota started.");
    console.log(`State: ${stateDir}`);
    return;
  }

  spawn("powershell.exe", ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runtimeAppEntry, ...runtimeArgs], {
    cwd: stateDir,
    stdio: "inherit",
    windowsHide: false
  });
}

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteVbs(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function writeAutostartScript() {
  ensureStateDir();
  const command = `${quoteVbs(process.execPath)} ${quoteVbs(__filename)} __start`;
  fs.writeFileSync(
    autostartScript,
    [
      'Set shell = CreateObject("WScript.Shell")',
      `shell.Run ${quoteVbs(command)}, 0, False`
    ].join("\r\n")
  );
}

function runRegistryCommand(action) {
  if (process.platform !== "win32") return;

  const command =
    action === "add"
      ? [
          "add",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
          "/v",
          runKeyName,
          "/t",
          "REG_SZ",
          "/d",
          `wscript.exe "${autostartScript}"`,
          "/f"
        ]
      : ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", runKeyName, "/f"];

  spawnSync("reg", command, {
    stdio: "ignore",
    windowsHide: true
  });
}

function stopWindowsProcesses({ quiet = false } = {}) {
  if (process.platform !== "win32") return;
  const escapedEntry = windowsAppEntry.replace(/'/g, "''");
  const escapedRuntime = runtimeAppEntry.replace(/'/g, "''");
  const command = `$entry = '${escapedEntry}'; $runtime = '${escapedRuntime}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $entry + '*') -or $_.CommandLine -like ('*' + $runtime + '*') -or $_.CommandLine -like '*codex-pet-quota.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: quiet ? "ignore" : "inherit",
    windowsHide: true
  });
}

function install() {
  ensureStateDir();
  stopRunning({ quiet: true });
  stopWindowsProcesses({ quiet: true });
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
  writeAutostartScript();
  runRegistryCommand("add");
  launch(["--install"], true);
}

function stopRunning({ quiet = false } = {}) {
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

function stop() {
  stopRunning({ quiet: false });
  stopWindowsProcesses({ quiet: false });
}

function uninstall() {
  const quiet = process.argv.includes("--quiet");
  runRegistryCommand("delete");
  stopRunning({ quiet });
  stopWindowsProcesses({ quiet });
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
    launch();
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
