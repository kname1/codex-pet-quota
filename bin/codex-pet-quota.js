#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const appEntry = path.join(rootDir, "src", "main", "app.js");
const stateDir = path.join(os.homedir(), ".codex-pet-quota");
const pidFile = path.join(stateDir, "app.pid");
const configFile = path.join(stateDir, "config.json");
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

function electronPath() {
  try {
    return require("electron");
  } catch {
    return null;
  }
}

function launch(args = [], detached = true) {
  const electron = electronPath();
  if (!electron) {
    console.error("Electron is not installed. Run `npm install` or use `npx codex-pet-quota@latest`.");
    process.exit(1);
  }

  ensureStateDir();
  const child = spawn(electron, [appEntry, ...args], {
    cwd: rootDir,
    detached,
    stdio: detached ? "ignore" : "inherit",
    windowsHide: true
  });

  if (detached) {
    child.unref();
    console.log("Codex Pet Quota started.");
    console.log(`State: ${stateDir}`);
  }
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
          `"${process.execPath}" "${__filename}" start`,
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
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      JSON.stringify(
        {
          autoStart: true,
          refreshIntervalMs: 300000,
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
  runRegistryCommand("add");
  launch(["--install"], false);
}

function stop() {
  const pid = readPid();
  if (!isRunning(pid)) {
    console.log("Codex Pet Quota is not running.");
    return;
  }

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit", windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
    console.log("Stop requested.");
  } catch (error) {
    console.error(`Could not stop process ${pid}: ${error.message}`);
    process.exitCode = 1;
  }
}

function uninstall() {
  launch(["--uninstall"], false);
  runRegistryCommand("delete");
  stop();
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
  codex-pet-quota stop      Stop the background app
  codex-pet-quota status    Show process status
  codex-pet-quota uninstall Stop and show cleanup path
  codex-pet-quota help      Show this help

Quick start:
  npx codex-pet-quota@latest install
`);
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
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
