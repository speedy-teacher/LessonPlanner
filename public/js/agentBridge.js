// Lets an AI assistant working in this browser tab (Claude Code's built-in browser,
// Claude in Chrome, …) run the planner's commands (agentCommands.js) instead of clicking around:
//
//   lessonPlanner.status()                                 → is a plan open, signed in, saved?
//   lessonPlanner.help()                                   → the commands and what they take
//   lessonPlanner.run('getSchedule', { school, grade })    → one command
//   lessonPlanner.run([{ command, args }, …])              → several, all or nothing
//
// Changes go through commit(), so they're saved like any other change and one
// Undo takes back everything a single run did. A notice says what changed.
// Where the browser supports it (WebMCP, `document.modelContext`), the same
// commands are also offered as tools.

import { commit, hasPendingSave, store, undo } from './store.js';
import { google } from './google.js';
import { current, listTeammates, pieces, viewMine, viewTeammate } from './workspace.js';
import { PIECE_NAMES, PIECES } from './pieces.js';
import { showNotice } from './notices.js';
import { copyStatus } from './exportBridge.js';
import { COMMANDS, CommandError, NEEDS_THE_TEACHER, describeCommands, runCommands } from './agentCommands.js';
import { AUTO_FIELDS, COLLECTIONS } from './model.js';

const GUIDE = 'Lesson Planner commands. First call lessonPlanner.status() to see whether a plan is open. Call lessonPlanner.run(name, args) or lessonPlanner.run([{ command, args }, ...]). '
  + 'Things are named as shown in the app (school, grade, lesson, eval) or by id. Weeks are a week number or any date in the week. '
  + 'Dates look like 2026-09-14; positions start at 1. Lists can be arrays of names. Start with "overview". '
  + 'Read before you change things, and do a whole request in one run([...]) so it is one Undo. '
  + 'If a command is missing for something, say so rather than editing data another way. '
  + 'A plan is three parts (status().parts): the School Year (shared by a department), the teacher’s Lesson Schedule and their Teacher Resources. '
  + 'A part shown as "view" or "none" cannot be changed. lessonPlanner.people() lists teammates; lessonPlanner.lookAt(name or "me") shows their schedule, templates and pictures.';

function announce(steps, results) {
  const done = results.map((r) => r?.done).filter(Boolean);
  const message = done.length === 1 ? done[0] : `${steps.length} changes to your plan.`;
  showNotice({ id: 'agent-changes', tone: 'success', title: '✨ Your assistant made changes', message, seconds: 20, actions: [{ label: 'Undo', run: undo }] });
}

/** Run commands; returns their results (one result for one command). Errors come back as { error }. */
function run(nameOrSteps, args = {}) {
  const single = !Array.isArray(nameOrSteps);
  const steps = single ? [{ command: nameOrSteps, args }] : nameOrSteps;
  if (!store.state) return { error: 'No plan is open. Ask the teacher to open one first.' };
  try {
    const outcome = runCommands(store.state, steps);
    const refused = outcome.changed ? viewOnlyParts(outcome.state) : [];
    if (refused.length) return { error: `Nothing was changed: the ${refused.join(' and ')} can only be looked at (shared as Viewer, or not available).` };
    if (outcome.changed) {
      commit((state) => {
        Object.keys(state).forEach((k) => delete state[k]);
        Object.assign(state, outcome.state);
      });
      announce(steps, outcome.results);
    }
    return single ? outcome.results[0] : outcome.results;
  } catch (err) {
    if (err instanceof CommandError) return { error: err.message };
    throw err;
  }
}

/** The view-only parts of the plan a change would touch (all or nothing: the change is refused). */
function viewOnlyParts(next) {
  if (!pieces?.readOnly().length) return [];
  return pieces.guard(store.state, next).blocked.map((name) => PIECES[name].label);
}

/** Each part of a plan in pieces: 'edit', 'view' (look only) or 'none' (not available); plus whose plans are shown. */
function partsStatus() {
  if (!pieces) return null;
  return { ...Object.fromEntries(PIECE_NAMES.map((name) => [name, pieces.access(name)])), lookingAt: pieces.viewing?.name ?? 'me' };
}

/** Teammates whose Lesson Schedules use this School Year and are shared with the teacher. */
async function people() {
  return pieces ? (await listTeammates()).map((p) => p.name) : [];
}

/** Show a teammate's schedule, templates and pictures (by name), or "me" for the teacher's own. */
async function lookAt(name = 'me') {
  if (!pieces) return { error: 'This plan isn’t shared in parts yet (see “Share with your department” in the plan menu).' };
  if (String(name).trim().toLowerCase() === 'me') { await viewMine(); return { lookingAt: 'me' }; }
  const all = await listTeammates();
  const person = all.find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());
  if (!person) return { error: `No teammate called “${name}”. Teammates: ${all.map((p) => p.name).join(', ') || 'none shared yet'}.` };
  await viewTeammate(person);
  return { lookingAt: person.name, parts: partsStatus() };
}

/** What the assistant needs to know before and after changing things: which plan, signed in, saved. */
function status() {
  const plan = current ?? {};
  const facts = {
    planOpen: Boolean(store.state && current), onDrive: Boolean(plan.fileId),
    signedIn: google.status === 'connected' && Boolean(google.token), pending: hasPendingSave() || Boolean(plan.changed),
  };
  return {
    planOpen: facts.planOpen, plan: plan.name ?? null, savedIn: whereSaved(facts),
    signedInToGoogle: facts.signedIn, googleStatus: google.status,
    allChangesSaved: !facts.pending && store.saveStatus !== 'error', saveStatus: store.saveStatus,
    nextStep: nextStepFor(facts),
    lessonCopies: facts.planOpen ? copyStatus() : null, // { state, pictures?: pictures that couldn't be placed, and why }
    parts: partsStatus(), // School Year / Lesson Schedule / Teacher Resources: 'edit' | 'view' | 'none' (null = older one-file plan)
  };
}

function whereSaved({ planOpen, onDrive }) {
  if (!planOpen) return null;
  return onDrive ? 'Google Drive' : 'this browser only';
}

const SIGN_IN = 'Google Drive is not connected. Click the "Connect Google Drive" button (or, if a notice says "Click anywhere to reconnect", '
  + 'click once anywhere): Google only opens its window after a click. If Google asks for a password, the teacher has to type it. '
  + 'Then call status() again.';

function nextStepFor({ planOpen, onDrive, signedIn, pending }) {
  if (google.status === 'working') return 'Google is signing in. Wait a few seconds and call status() again.';
  if (!planOpen) return signedIn ? 'No plan is open yet. Wait a few seconds and call status() again, or ask the teacher which plan to open.' : SIGN_IN;
  if (!onDrive) return 'Ready, but this plan is kept only in this browser — changes will not show up on the teacher’s other computers.';
  if (!signedIn) return SIGN_IN;
  if (pending) return 'Ready. Changes are still being saved to Google Drive — wait until allChangesSaved is true before closing the page.';
  return 'Ready. Call help() for the commands.';
}

function help() {
  return { guide: GUIDE, commands: describeCommands(), onlyTheTeacherCanDo: NEEDS_THE_TEACHER, collections: COLLECTIONS, fillInDetails: AUTO_FIELDS };
}

/** One command as a WebMCP tool. */
function asTool({ name, summary, params }) {
  const properties = Object.fromEntries(Object.keys(params).map((p) => [p, { description: params[p] }]));
  const required = Object.entries(COMMANDS[name].params).filter(([, [, req]]) => req).map(([p]) => p);
  return {
    name: `lessonPlanner_${name}`, description: summary,
    inputSchema: { type: 'object', properties, required },
    execute: async (input) => ({ content: [{ type: 'text', text: JSON.stringify(run(name, input ?? {})) }] }),
  };
}

/**
 * The same commands as WebMCP tools, for browsers that offer them (Chrome's trial puts it on
 * `document.modelContext`; earlier builds used `navigator.modelContext`).
 */
function offerAsTools() {
  const context = document.modelContext ?? navigator.modelContext;
  if (!context) return;
  const tools = describeCommands().map(asTool);
  try {
    if (typeof context.registerTool === 'function') tools.forEach((t) => context.registerTool(t));
    else if (typeof context.provideContext === 'function') context.provideContext({ tools });
  } catch (err) {
    console.warn('Could not offer Lesson Planner tools:', err);
  }
}

export function startAgentBridge() {
  window.lessonPlanner = Object.freeze({ status, help, run, people, lookAt, guide: GUIDE });
  offerAsTools();
}
