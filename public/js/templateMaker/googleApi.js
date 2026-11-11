// Every call to Google goes through here: the sign-in pass is added, Google's "slow down" answers
// (429, 5xx, rate-limit 403) are waited out and tried again after 1, 3 and 8 seconds — and reported, so
// fewer files are worked on at once (copyPace.js, as in Lesson Planner) — and problems get plain names.
// `runPool` works on several files at once, as many as the pace allows right now.
//
// Works with any fetch (the browser's, or a fake Google Drive in the tests).

export const RETRY_WAITS = [1000, 3000, 8000];

/** A problem talking to Google. `message` is a code: offline, signed_out, api_disabled, no_access, not_found, slow_down, failed. */
export class GoogleError extends Error {
  constructor(code, details = {}) {
    super(code);
    Object.assign(this, details);
  }
}

const RATE_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'quotaExceeded'];

/** Google said "slow down": too many calls (429), a busy server (5xx), or a rate-limit 403. */
export function isSlowDown(status, reasons = []) {
  return status === 429 || status >= 500 || (status === 403 && reasons.some((r) => RATE_REASONS.includes(r)));
}

async function problemOf(res) {
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  const err = body.error ?? {};
  const reasons = [...(err.errors ?? []).map((e) => e.reason), ...(err.details ?? []).map((d) => d.reason)].filter(Boolean);
  return { status: res.status, reasons, text: err.message ?? '' };
}

function codeFor({ status, reasons, text }) {
  if (status === 401) return 'signed_out';
  if (status === 404) return 'not_found';
  if (reasons.includes('accessNotConfigured') || reasons.includes('SERVICE_DISABLED') || /has not been used|is disabled/i.test(text)) return 'api_disabled';
  if (status === 403) return 'no_access';
  return 'failed';
}

/** The Google API a disabled-API answer is about ("Google Slides API"), from Google's message. */
const apiName = (text) => /(Google [A-Z][\w ]*? API)/.exec(text)?.[1] ?? 'a Google API';

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * `token()` gives the current sign-in pass. Returns { send(url, init) → Response, json(url, init) }.
 * `onSlowDown()` is told every time Google asks to slow down.
 */
export function googleClient({ token, fetchFn = fetch, sleep = defaultSleep, onSlowDown = () => {} }) {
  async function send(url, init = {}) {
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token()}`, ...init.headers } });
      } catch {
        throw new GoogleError('offline');
      }
      if (res.ok) return res;
      const problem = await problemOf(res);
      if (!isSlowDown(problem.status, problem.reasons)) {
        const code = codeFor(problem);
        throw new GoogleError(code, { status: problem.status, api: code === 'api_disabled' ? apiName(problem.text) : null });
      }
      onSlowDown();
      if (attempt >= RETRY_WAITS.length) throw new GoogleError('slow_down', { status: problem.status });
      await sleep(RETRY_WAITS[attempt]);
    }
  }
  const json = async (url, init) => (await send(url, init)).json();
  return { send, json };
}

/** The same call sent as JSON. */
export const jsonBody = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Work on every item, several at once — as many as `pace.jobs()` allows when each one starts.
 * Returns [{ ok, value } | { ok: false, error }] in the items' order. `worker(item, index)`.
 */
export function runPool(items, worker, { pace }) {
  const results = new Array(items.length);
  let next = 0;
  let active = 0;
  return new Promise((resolve) => {
    const startMore = () => {
      if (next >= items.length && active === 0) { resolve(results); return; }
      while (next < items.length && active < pace.jobs()) {
        const i = next;
        next += 1;
        active += 1;
        Promise.resolve().then(() => worker(items[i], i))
          .then((value) => { results[i] = { ok: true, value }; }, (error) => { results[i] = { ok: false, error }; })
          .finally(() => { active -= 1; startMore(); });
      }
    };
    startMore();
  });
}

/** What went wrong, in the teacher's words. */
export function problemText(err) {
  const words = {
    offline: 'Couldn’t reach Google. Check the internet connection and try again.',
    signed_out: 'Your Google sign-in ran out. Click the Drive button at the top to sign in again, then try again.',
    api_disabled: `${err?.api ?? 'A Google API'} isn’t turned on in the Google project yet (see the setup steps).`,
    no_access: 'Google says you can’t change this file or folder. Ask its owner to share it with you as an Editor.',
    not_found: 'Google couldn’t find this file. It may have been deleted or moved to the trash.',
    slow_down: 'Google is busy right now. Wait a minute and try again.',
  };
  return words[err?.message] ?? 'Something went wrong. Try again in a minute.';
}
