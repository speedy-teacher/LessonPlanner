// What this browser on this computer remembers: recently opened plans and
// whether Google Drive was connected. Never put in a plan file.
//
// The Google codes (Client ID, API key) are built into the website when it's
// published (public/config.js, made by scripts/write-config.js) — nobody using
// the planner fills them in.

const KEY = 'lesson-planner-device';

export const device = load();

function load() {
  const empty = { recent: [], lastKey: null, driveConnected: false };
  try { return { ...empty, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return empty; }
}

export function setDevice(patch) {
  Object.assign(device, patch);
  try { localStorage.setItem(KEY, JSON.stringify(device)); } catch { /* storage unavailable */ }
}

const config = () => globalThis.PLANNER_CONFIG || {};

export function clientId() {
  return (config().googleClientId || '').trim();
}

export function apiKey() {
  return (config().googleApiKey || '').trim();
}

/** The Google codes as built into the website. */
export function googleConfig() {
  return { googleClientId: clientId(), googleApiKey: apiKey() };
}

/** This website was published with a usable Client ID (needed for anything Drive). */
export function driveAvailable() {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId());
}
