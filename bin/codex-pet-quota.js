#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const windowsAppEntry = path.join(rootDir, "src", "windows", "codex-pet-quota.ps1");
const stateDir = path.join(os.homedir(), ".codex-pet-quota");
const pidFile = path.join(stateDir, "app.pid");
const configFile = path.join(stateDir, "config.json");
const autostartScript = path.join(stateDir, "start.vbs");
const runKeyName = "CodexPetQuota";

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
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
  if (detached && !args.includes("--show") && isRunning(readPid())) {
    console.log(`Codex Pet Quota is already running (pid ${readPid()}).`);
    console.log(`State: ${stateDir}`);
    return;
  }
  if (detached) {
    const psArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Start-Process -FilePath powershell.exe -WorkingDirectory ${quotePs(rootDir)} -WindowStyle Hidden -ArgumentList @('-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',${quotePs(windowsAppEntry)}${args.map((arg) => `,${quotePs(arg)}`).join("")})`
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

  spawn("powershell.exe", ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", windowsAppEntry, ...args], {
    cwd: rootDir,
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
  const command = `${quoteVbs(process.execPath)} ${quoteVbs(__filename)} start`;
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

  const child = spawn("reg", command, {
    stdio: "ignore",
    windowsHide: true
  });

  child.on("error", () => {});
}

function install() {
  ensureStateDir();
  stopRunning({ quiet: true });
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
}

function uninstall() {
  runRegistryCommand("delete");
  stop();
  try {
    fs.rmSync(autostartScript, { force: true });
  } catch {}
  console.log("");
  console.log("Autostart disabled.");
  console.log(`You can remove local settings manually: ${stateDir}`);
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
  codex-pet-quota install   Install config, enable login start, and launch
  codex-pet-quota start     Launch in the background
  codex-pet-quota dev       Launch in the foreground
  codex-pet-quota show      Launch and show quota once
  codex-pet-quota stop      Stop the background app
  codex-pet-quota status    Show process status
  codex-pet-quota uninstall Stop and show cleanup path
  codex-pet-quota help      Show this help

Quick start:
  npx codex-pet-quota@latest install
`);
}

function postinstall() {
  console.log("");
  console.log("Codex Pet Quota installed.");
  console.log("Run this once to launch it and enable auto-start:");
  console.log("  codex-pet-quota install");
  console.log("");
}

const command = process.argv[2] || "start";

switch (command) {
  case "install":
    install();
    break;
  case "start":
    launch();
    break;
  case "dev":
    launch(["--dev"], false);
    break;
  case "show":
    launch(["--show"], true);
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
  case "postinstall":
    postinstall();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
