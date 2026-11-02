// Cases S1-S3 of lookingAt.e2e.js: Google sign-in finishing just after a window was opened. The click
// that opens a window also renews the sign-in, so for a moment the window is drawn signed out; it must
// catch up once the sign-in is in, instead of saying "Connect Google Drive" while signed in.

import { createPlan } from '/js/workspace.js';
import { google } from '/js/google.js';
import { refresh } from '/js/store.js';
import { newYearPlan } from '/js/workspaceFile.js';
import { openNewYear, refreshPlansMenu } from '/js/views/plans.js';
import { openShareSetup, refreshShareSetup } from '/js/views/shareSetup.js';
import { check, modal, text, waitFor } from './helpers.js';
import { addResources, goTo, LEE, seedMine, signIn } from './lookingAtKit.js';
import * as fakeDrive from './fakeDrive.js';

function signOut() {
  Object.assign(google, { status: 'idle', token: null, message: '' });
  refresh();
}

/** Sign-in finishing: what app.js does when Google's connection changes (redraw, plans menu, share window). */
function signInLate() {
  signIn();
  refreshPlansMenu();
  refreshShareSetup();
}

const closeModal = () => [...(modal()?.querySelectorAll('button') ?? [])].find((b) => /Cancel|Not now/.test(b.textContent))?.click();

export const CASES_SIGN_IN = {
  async S1() {
    fakeDrive.install();
    await createPlan(newYearPlan(null, { name: 'Old Test 2030–31', startDate: '2030-08-26', endDate: '2031-06-13' }), { open: true });
    openShareSetup();
    const join = () => document.querySelector('[data-tour="share-join"]');
    await waitFor(() => join(), 3000, 'the share window to open');
    check(join().disabled, 'signed out: joining needs Google Drive');
    signInLate();
    await waitFor(() => !join().disabled, 3000, 'joining to turn on once signed in');
    check(document.querySelector('.share-setup')?.dataset.step === 'intro', 'the window stays on its first step');
    closeModal();
  },

  async S2() {
    await seedMine();
    addResources({ owner: LEE, picture: true });
    signOut();
    await goTo('images');
    const picker = () => document.querySelector('.people-picker');
    picker().querySelector('summary').click();
    await waitFor(() => /Connect Google Drive/.test(text(picker())), 3000, 'the list to say Google Drive isn’t connected');
    signInLate();
    await waitFor(() => picker()?.open && text(picker()).includes(LEE), 5000, 'the list to stay open and find Lee once signed in');
    check(!/Connect Google Drive/.test(text(picker())), 'no "Connect Google Drive" once signed in');
  },

  async S3() {
    fakeDrive.install();
    openNewYear();
    const nameBox = () => [...(modal()?.querySelectorAll('label.field') ?? [])].find((l) => text(l).startsWith('Name'))?.querySelector('input');
    await waitFor(() => nameBox(), 3000, 'the new-year window to open');
    check(!modal().querySelector('[data-tour="new-year-school-year"]'), 'signed out: no colleague choice');
    check(/kept on this computer/.test(text(modal())), 'signed out: says it is kept on this computer');
    nameBox().value = 'Late Test 2032–33';
    signInLate();
    await waitFor(() => modal()?.querySelector('[data-tour="new-year-school-year"]'), 3000, 'the colleague choice to appear once signed in');
    check(/saved in your Google Drive/.test(text(modal())), 'once signed in: says it is saved in Google Drive');
    check(nameBox().value === 'Late Test 2032–33', 'the name typed before signing in is kept');
    closeModal();
  },
};
