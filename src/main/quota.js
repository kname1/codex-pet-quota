const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const codexHome = path.join(os.homedir(), ".codex");
const usageCachePath = path.join(codexHome, "usage-limits.json");
const authPath = path.join(codexHome, "auth.json");

function percentLeft(usedPercent) {
  if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function formatReset(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value < 10000000000 ? value * 1000 : value).toISOString();
  if (typeof value === "string") return value;
  return null;
}

function findWindow(raw, names) {
  if (!raw || typeof raw !== "object") return null;

  for (const name of names) {
    if (raw[name]) return raw[name];
  }

  if (raw.rate_limit || raw.rateLimit) {
    const nested = findWindow(raw.rate_limit || raw.rateLimit, names);
    if (nested) return nested;
  }

  const limits = raw.rate_limits || raw.rateLimits || raw.limits || raw.data;
  if (Array.isArray(limits)) {
    return limits.find((item) => names.includes(item.type) || names.includes(item.name) || names.includes(item.window));
  }

  return null;
}

function normalizeWindow(rawWindow) {
  if (!rawWindow) {
    return {
      remainingText: "unknown",
      resetAt: null
    };
  }

  const used =
    rawWindow.used_percent ??
    rawWindow.usedPercent ??
    rawWindow.utilization_percent ??
    rawWindow.utilizationPercent ??
    rawWindow.percent_used ??
    rawWindow.percentUsed;

  const remaining =
    rawWindow.remaining_percent ??
    rawWindow.remainingPercent ??
    rawWindow.percent_remaining ??
    rawWindow.percentRemaining ??
    percentLeft(used);

  const resetAt =
    rawWindow.reset_at ??
    rawWindow.resetAt ??
    rawWindow.resets_at ??
    rawWindow.resetsAt ??
    rawWindow.reset_time ??
    rawWindow.resetTime;

  return {
    remainingText: typeof remaining === "number" ? `${Math.round(remaining)}%` : String(remaining || "unknown"),
    resetAt: formatReset(resetAt)
  };
}

function normalizeUsage(raw, source) {
  const fiveHour = findWindow(raw, ["primary_window", "primaryWindow", "session", "five_hour", "fiveHour"]);
  const weekly = findWindow(raw, ["secondary_window", "secondaryWindow", "week", "weekly", "seven_day", "sevenDay"]);

  return {
    fiveHour: normalizeWindow(fiveHour),
    weekly: normalizeWindow(weekly),
    updatedAt: new Date().toISOString(),
    plan: raw.plan || raw.plan_type || raw.account_plan || raw.accountPlan || null,
    source
  };
}

async function readCachedUsage() {
  const raw = JSON.parse(await fs.readFile(usageCachePath, "utf8"));
  return normalizeUsage(raw, "usage-limits.json");
}

async function readAuthToken() {
  const raw = JSON.parse(await fs.readFile(authPath, "utf8"));
  return raw.tokens && raw.tokens.access_token;
}

async function fetchLiveUsage() {
  const token = await readAuthToken();
  if (!token) throw new Error("No Codex OAuth access token found.");

  const endpoints = [
    "https://chatgpt.com/backend-api/wham/usage",
    "https://chatgpt.com/backend-api/codex/usage"
  ];

  const errors = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "codex-pet-quota"
        }
      });

      if (!response.ok) {
        errors.push(`${endpoint} returned ${response.status}`);
        continue;
      }

      return normalizeUsage(await response.json(), endpoint);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }

  if (process.platform === "win32") {
    try {
      return await fetchLiveUsageWithPowerShell(token, endpoints);
    } catch (error) {
      errors.push(`PowerShell fallback: ${error.message}`);
    }
  }

  throw new Error(errors[0] || "Usage API is unavailable.");
}

function fetchLiveUsageWithPowerShell(token, endpoints) {
  return new Promise((resolve, reject) => {
    const script = `
$ErrorActionPreference = 'Stop'
$headers = @{ Authorization = "Bearer $env:CODEX_PET_QUOTA_TOKEN"; Accept = 'application/json'; 'User-Agent' = 'codex-pet-quota' }
$endpoints = @(${endpoints.map((endpoint) => `'${endpoint.replace(/'/g, "''")}'`).join(",")})
foreach ($endpoint in $endpoints) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $endpoint -Headers $headers -Method Get -TimeoutSec 20
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
      Write-Output $response.Content
      exit 0
    }
  } catch {}
}
exit 1
`;

    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: {
        ...process.env,
        CODEX_PET_QUOTA_TOKEN: token
      },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(stderr.trim() || `PowerShell exited with ${code}`));
        return;
      }

      try {
        resolve(normalizeUsage(JSON.parse(stdout), "chatgpt.com/backend-api/wham/usage"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function readQuota() {
  const errors = [];

  try {
    return await fetchLiveUsage();
  } catch (error) {
    errors.push(error.message);
  }

  try {
    return await readCachedUsage();
  } catch (error) {
    errors.push(error.message);
  }

  return {
    fiveHour: { remainingText: "unknown", resetAt: null },
    weekly: { remainingText: "unknown", resetAt: null },
    updatedAt: new Date().toISOString(),
    source: "unavailable",
    error: errors[0] || "Quota data is unavailable."
  };
}

module.exports = {
  readQuota,
  usageCachePath,
  authPath
};
