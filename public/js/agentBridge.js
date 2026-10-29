// Lets an AI assistant working in this browser tab (e.g. Claude in Chrome) run
// the planner's commands (agentCommands.js) instead of clicking around:
//
//   lessonPlanner.help()                                   → the commands and what they take
//   lessonPlanner.run('getSchedule', { school, grade })    → one command
//   lessonPlanner.run([{ command, args }, …])              → several, all or nothing
//
// Changes go through commit(), so they're saved like any other change and one
// Undo takes back everything a single run did. A notice says what changed.
// Where the browser supports it (WebMCP, `document.modelContext`), the same
// commands are also offered as tools.

import { commit, store, undo } from './store.js';
import { showNotice } from './notices.js';
import { COMMANDS, CommandError, NEEDS_THE_TEACHER, describeCommands, runCommands } from './agentCommands.js';
import { AUTO_FIELDS, COLLECTIONS } from './model.js';

const GUIDE = 'Lesson Planner commands. Call lessonPlanner.run(name, args) or lessonPlanner.run([{ command, args }, ...]). '
  + 'Things are named as shown in the app (school, grade, lesson, eval) or by id. Weeks are a week number or any date in the week. '
  + 'Dates look like 2026-09-14; positions start at 1. Lists can be arrays of names. Start with "overview". '
  + 'Read before you change things, and do a whole request in one run([...]) so it is one Undo. '
  + 'If a command is missing for something, say so rather than editing data another way.';

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
  window.lessonPlanner = Object.freeze({ help, run, guide: GUIDE });
  offerAsTools();
}
