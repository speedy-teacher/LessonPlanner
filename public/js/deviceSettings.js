// Settings kept in this browser on this computer only: the Google codes and
// the list of recently opened plans. They are never put in a plan file, so
// sharing a plan never shares them.

const KEY = 'lesson-planner-device';

export const device = load();

function load() {
  const empty = { googleClientId: '', googleApiKey: '', recent: [], lastKey: null };
  try { return { ...empty, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return empty; }
}

export function setDevice(patch) {
  Object.assign(device, patch);
  try { localStorage.setItem(KEY, JSON.stringify(device)); } catch { /* storage unavailable */ }
}

export function clientId() {
  return (device.googleClientId || '').trim();
}

export function apiKey() {
  return (device.googleApiKey || '').trim();
}

/** A link that fills in the Google codes on another computer (#setup=…); they're public ids, not passwords. */
export function setupLink() {
  const codes = btoa(JSON.stringify({ c: clientId(), k: apiKey() }));
  return `${location.origin}${location.pathname}#setup=${encodeURIComponent(codes)}`;
}

/** Fill in the Google codes from a setup link, then tidy the address. Returns true if it did. */
export function applySetupLink() {
  const match = /#setup=([^&]+)/.exec(location.hash);
  if (!match) return false;
  try {
    const { c = '', k = '' } = JSON.parse(atob(decodeURIComponent(match[1])));
    setDevice({ googleClientId: c, googleApiKey: k });
  } catch { return false; }
  history.replaceState(null, '', location.pathname);
  return true;
}
