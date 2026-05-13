const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const codexStatePath = path.join(os.homedir(), ".codex", ".codex-global-state.json");

function readCodexPetBounds() {
  try {
    const raw = fs.readFileSync(codexStatePath, "utf8");
    const state = JSON.parse(raw);
    const atomState = state["electron-persisted-atom-state"] || {};
    const overlay = atomState["electron-avatar-overlay-bounds"] || state["electron-avatar-overlay-bounds"];
    const mascot = overlay && overlay.mascot;

    if (!mascot) return null;

    return {
      x: Math.round((overlay.x || 0) + mascot.left),
      y: Math.round((overlay.y || 0) + mascot.top),
      width: Math.round(mascot.width),
      height: Math.round(mascot.height)
    };
  } catch {
    return null;
  }
}

function bubbleBoundsForPet(petBounds) {
  if (!petBounds) return null;

  const width = Math.round(Math.max(190, Math.min(300, petBounds.width * 2.75)));
  const height = Math.round(Math.max(64, Math.min(96, petBounds.height * 0.86)));
  const gap = Math.round(Math.max(1, petBounds.height * 0.02));
  const centerX = petBounds.x + petBounds.width / 2;

  return {
    x: Math.max(0, Math.round(centerX - width / 2)),
    y: Math.round(petBounds.y + petBounds.height + gap - height * 0.18),
    width,
    height
  };
}

function hotspotBoundsForPet(petBounds, padding = 6) {
  if (!petBounds) return null;

  const size = 28 + padding * 2;

  return {
    x: petBounds.x + petBounds.width + 4,
    y: petBounds.y + petBounds.height - size,
    width: size,
    height: size
  };
}

module.exports = {
  bubbleBoundsForPet,
  codexStatePath,
  hotspotBoundsForPet,
  readCodexPetBounds
};
