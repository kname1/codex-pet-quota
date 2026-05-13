const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const stateDir = path.join(os.homedir(), ".codex-pet-quota");
const configPath = path.join(stateDir, "config.json");
const pidPath = path.join(stateDir, "app.pid");

const defaults = {
  autoStart: true,
  refreshIntervalMs: 300000,
  bubbleDismissMs: 7000,
  hotspot: {
    enabled: true,
    padding: 6
  }
};

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function readConfig() {
  ensureStateDir();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      ...defaults,
      ...userConfig,
      hotspot: {
        ...defaults.hotspot,
        ...(userConfig.hotspot || {})
      }
    };
  } catch {
    return defaults;
  }
}

module.exports = {
  configPath,
  defaults,
  ensureStateDir,
  pidPath,
  readConfig,
  stateDir
};
