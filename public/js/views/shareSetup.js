// "Share with your department": moves an older one-file plan to the three shareable pieces.
//   1. what changes, and the backup that's kept
//   2. start a new shared School Year from this plan, or join one a colleague shared
//   3. (joining) check anything whose name didn't match
//   4. done: where the files are, and how to share the School Year

import { h, openModal } from '../dom.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { google } from '../google.js';
import { pickPlanFromDrive } from '../drive.js';
import { showNotice } from '../notices.js';
import { MATCH_WORDS, matchToSchoolYear } from '../joinYear.js';
import { current, downloadCopy, joinSchoolYear, myPlanState, pieces, readSchoolYear, splitCurrentPlan } from '../workspace.js';

const PROBLEMS = {
  not_a_school_year: 'That file isn’t a School Year. Ask your colleague which file to pick (its name starts with “School Year”).',
  no_access: 'Google Drive didn’t allow opening that file. Ask your colleague to share it with you.',
  offline: 'Couldn’t reach Google. Check the internet connection and try again.',
  signed_out: 'Google signed you out. Click anywhere to reconnect, then try again.',
};

/** The open plan is an older one-file plan (not yet moved to pieces). */
export const canMoveToPieces = () => Boolean(current) && !pieces;

let offered = false;

/** Once per visit, a notice offering to move an older plan over (on Drive plans only). */
export function offerSharing() {
  if (offered || !canMoveToPieces() || !current.fileId || /\(old – before sharing\)$/.test(current.name)) return;
  offered = true;
  showNotice({
    id: 'share-offer', tone: 'info', title: 'New: share with your department',
    message: 'Share your School Year (calendars, outcomes and evals) with colleagues, while your lesson schedule and templates stay yours.',
    seconds: 30,
    actions: [{ label: 'Show me how', run: openShareSetup }],
  });
}

export function openShareSetup() {
  openModal('Share with your department', (close) => {
    const body = h('div', { class: 'share-setup', 'data-tour': 'share-setup' });
    const step = (...parts) => body.replaceChildren(...parts.filter(Boolean));
    step(...intro(step, close));
    return body;
  });
}

/**
 * Join a School Year a colleague already made: pick their file, match my data to it (checking anything
 * that didn't match), then make my own Lesson Schedule linked to it. `mine` = the data to join with
 * (a new year rolled over; or a function making it from their School Year) in `folderId`; without it,
 * the open plan's own data is used.
 */
export function joinFlow({ title, mine = null, folderId = null }) {
  openModal(title, (close) => {
    const body = h('div', { class: 'share-setup', 'data-tour': 'join-setup' });
    const step = (...parts) => body.replaceChildren(...parts.filter(Boolean));
    pickYear(step, close, { mine, folderId, back: close, backLabel: 'Cancel', onCancel: close });
    return body;
  });
}

// ---------- 1 + 2: what changes, and the choice ----------

function intro(step, close) {
  return [
    h('p', {}, 'Your plan becomes three files in your Google Drive, so each part can be shared on its own:'),
    h('ul', { class: 'share-pieces' },
      h('li', {}, h('strong', {}, '🧺 School Year'), ' — schools, grades, instruments, events, outcomes & evals, and both calendars. ', h('em', {}, 'Share this with your department.')),
      h('li', {}, h('strong', {}, '📖 Lesson Schedule'), ' — your lessons each week, your lesson order, reports and colors. Yours.'),
      h('li', {}, h('strong', {}, '🖼️ Teacher Resources'), ' — your lesson templates and pictures, kept from year to year. Yours. ',
        'If you already moved another year’s plan, its templates and pictures go into the same one (nothing is doubled).')),
    h('p', { class: 'hint' }, 'Nothing is lost: your old plan stays in Google Drive, renamed “(old – before sharing)”, and Drive keeps today’s version forever. ',
      h('button', { class: 'btn small light', onclick: downloadCopy }, '⬇ Also download a copy')),
    h('div', { class: 'share-choices' },
      choice({ icon: '🌱', title: 'Start a new shared School Year', tour: 'share-start',
        text: 'Recommended if you’re the first in your department. Your colleagues join it afterwards.' }, () => run(step, close, splitCurrentPlan)),
      choice({ icon: '🤝', title: 'Join a School Year a colleague shared', tour: 'share-join', disabledWhy: !google.token && 'Connect Google Drive first',
        text: 'Your schools, grades and evals are matched to theirs; you check any that don’t match.' },
      () => pickYear(step, close, { back: () => step(...intro(step, close)), backLabel: 'Back' }))),
    h('div', { class: 'button-row' }, h('button', { class: 'btn light', onclick: close }, 'Not now')),
  ];
}

function choice({ icon, title, text, tour, disabledWhy = null }, onclick) {
  return h('button', { class: 'share-choice', onclick, disabled: Boolean(disabledWhy), 'data-tip': disabledWhy || null, 'data-tour': tour },
    h('span', { class: 'share-choice-icon', 'aria-hidden': 'true' }, icon),
    h('strong', {}, title), h('span', { class: 'hint' }, text));
}

async function run(step, close, action, joined = null) {
  step(h('p', { class: 'hint' }, 'Making your files… (this takes a few seconds)'));
  try {
    await action();
    step(...done(close, joined));
  } catch (err) {
    console.warn(err);
    step(h('p', { class: 'google-status error' }, PROBLEMS[err.message] || 'Something went wrong. Your plan is unchanged — please try again in a minute.'),
      h('div', { class: 'button-row' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  }
}

// ---------- 3: joining ----------

/** `join` = { mine, folderId, back, backLabel, onCancel }: what the join starts from, and where Back goes. */
async function pickYear(step, close, join) {
  const [picked] = await pickPlanFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() });
  if (!picked) return join.onCancel?.();
  step(h('p', { class: 'hint' }, 'Reading the School Year…'));
  try {
    const shared = await readSchoolYear(picked.id);
    const mine = typeof join.mine === 'function' ? join.mine(shared.piece) : join.mine;
    const { map, unmatched } = matchToSchoolYear(mine ?? myPlanState(), shared.piece);
    const joinNow = (chosen) => run(step, close, () => joinSchoolYear(shared, chosen, { mine, folderId: join.folderId }), shared.file.name);
    if (!unmatched.length) return joinNow(map);
    return step(...review({ shared, map, unmatched, joinNow, join }));
  } catch (err) {
    return step(h('p', { class: 'google-status error' }, PROBLEMS[err.message] || 'Couldn’t read that file.'),
      h('div', { class: 'button-row' }, h('button', { class: 'btn', onclick: join.back }, join.backLabel)));
  }
}

/** The things that didn't match: pick the shared one each is, or leave it out. */
function review({ shared, map, unmatched, joinNow, join: { back, backLabel } }) {
  const picks = unmatched.map((u) => ({ u, select: h('select', { 'aria-label': u.label },
    h('option', { value: '' }, '— Leave it out —'),
    u.choices.map((c) => h('option', { value: c.id }, c.label))) }));
  const joinChosen = () => {
    const chosen = { ...map };
    for (const { u, select } of picks) if (select.value) chosen[u.id] = select.value;
    joinNow(chosen);
  };
  return [
    h('p', {}, `These didn’t match anything in “${shared.file.name}”. Pick what each one is called there:`),
    h('div', { class: 'share-review' }, picks.map(({ u, select }) => h('label', { class: 'share-match' },
      h('span', {}, `${MATCH_WORDS[u.collection]}: `, h('strong', {}, u.label || '(no name)')), select))),
    h('p', { class: 'hint' }, 'Anything left out keeps its lessons, shown as “not available” until it’s matched.'),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn light', onclick: back }, backLabel),
      h('button', { class: 'btn', onclick: joinChosen }, 'Join this School Year')),
  ];
}

// ---------- 4: done ----------

function done(close, joined = null) {
  const year = pieces?.recs.schoolYear;
  const link = year?.fileId ? `https://drive.google.com/file/d/${encodeURIComponent(year.fileId)}/view` : null;
  if (joined) return doneJoining(close, joined, link);
  return [
    h('p', {}, link
      ? '🎉 All set! Your plan is now three files in your Drive folder. Everything works just as before.'
      : '🎉 All set! Your plan is now in three parts, kept on this computer. Save it to Google Drive (plan menu) to share the School Year.'),
    link ? h('p', {}, 'To share with your department, open the School Year in Google Drive and click ', h('strong', {}, 'Share'),
      '. Colleagues who should change the calendars need ', h('strong', {}, 'Editor'), '; ', h('strong', {}, 'Viewer'), ' lets them look only.') : null,
    link ? h('p', { class: 'hint' }, 'Your Lesson Schedule and your Teacher Resources can each be shared on their own in Drive too — a colleague then sees just that part when they pick you in “Looking at”.') : null,
    h('div', { class: 'button-row' },
      link ? h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, 'Open the School Year in Drive ↗') : null,
      h('button', { class: 'btn light', onclick: close }, 'Close')),
  ];
}

/** After joining a colleague's School Year. */
function doneJoining(close, name, link) {
  return [
    h('p', {}, `🎉 You’re now using ${name}. Your own lessons, templates and pictures stay yours.`),
    h('div', { class: 'button-row' },
      link ? h('a', { class: 'btn light', href: link, target: '_blank', rel: 'noopener' }, 'Open the School Year in Drive ↗') : null,
      h('button', { class: 'btn', onclick: close }, 'Close')),
  ];
}
