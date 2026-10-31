// Tutorials (the 🎓 button): the pure part — what a tutorial is, which step comes next,
// and what this browser remembers about them. No page drawing here (that's views/tutorialGuide.js),
// so it can be tested without a browser. The tutorials themselves are in tutorials.js.
//
// A tutorial:  { id, icon, title, about, ready?(ctx) → null | 'why it can't start yet', steps: [step…] }
// A step:
//   text        words in the bubble (or (ctx) => words)
//   title       optional bold first line
//   target      data-tour name(s) of the part(s) of the page to light up ('tab-plan', ['undo', 'redo'])
//   selector    or any CSS selector; `pick: 'all' | 'last'` (default the first match)
//   skipIf      (ctx) => true when there's nothing to do (e.g. already on the right tab) — checked as the step starts
//   remember    (ctx) => value kept while on the step (e.g. how many schools there were), handed to until/nextWhen
//   until       (ctx, remembered) => true when the teacher has done it → the next step starts by itself
//   click       true: the step is done when the teacher clicks the lit-up part
//   nextWhen    (ctx, remembered) => true when "Next" may be clicked (e.g. once there's at least one school).
//               Without until/click the teacher does the step and then clicks Next — good for "add all your schools".
//               Steps with none of until/click/nextWhen just explain something, with a Next button.
//   backIf      (ctx) => true to go back a step (e.g. a menu the step needs was closed)
// `ctx` is whatever the page hands in (see tutorialContext in tutorials.js): the plan data, the view, Google…

export const PROGRESS_KEY = 'lesson-planner-tutorials';

/** Problems with a list of tutorials (empty = fine). Tested for every tutorial in tutorials.js. */
export function tutorialProblems(tutorials) {
  const problems = [];
  const ids = new Set();
  for (const t of tutorials) {
    if (!t.id || ids.has(t.id)) problems.push(`Tutorial id missing or used twice: ${t.id}`);
    ids.add(t.id);
    if (!t.title || !t.about) problems.push(`${t.id}: needs a title and an "about" line`);
    if (!t.steps?.length) problems.push(`${t.id}: has no steps`);
    (t.steps || []).forEach((s, i) => problems.push(...stepProblems(s).map((p) => `${t.id} step ${i + 1}: ${p}`)));
  }
  return problems;
}

function stepProblems(step) {
  const problems = [];
  if (!step.text) problems.push('needs text');
  if (step.click && !step.target && !step.selector) problems.push('a click step needs a target');
  if (step.pick && !['first', 'last', 'all'].includes(step.pick)) problems.push(`unknown pick "${step.pick}"`);
  return problems;
}

/** The data-tour names a step lights up. */
export function targetNames(step) {
  if (!step.target) return [];
  return Array.isArray(step.target) ? step.target : [step.target];
}

/** The tutorial after `id` in the list (null after the last one). */
export function nextTutorial(tutorials, id) {
  const i = tutorials.findIndex((t) => t.id === id);
  return i >= 0 ? tutorials[i + 1] ?? null : null;
}

/**
 * The holes cut in the dimmed page, as { x, y, w, h } boxes. Holes that touch become one box around
 * both: two holes on top of each other would otherwise cancel out (the dimming uses an even-odd fill).
 */
export function mergeBoxes(boxes) {
  const out = [];
  for (const b of boxes) {
    let merged = b;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (overlap(out[i], merged)) merged = around(out.splice(i, 1)[0], merged);
    }
    out.push(merged);
  }
  return out.length === boxes.length ? out : mergeBoxes(out);
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function around(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ---------- what this browser remembers ----------

/** { seen: ids listed when the 🎓 menu was last opened, done: ids finished } */
export function readProgress(text) {
  try {
    const p = JSON.parse(text) || {};
    return { seen: Array.isArray(p.seen) ? p.seen : [], done: Array.isArray(p.done) ? p.done : [] };
  } catch {
    return { seen: [], done: [] };
  }
}

/** The 🎓 shows a dot until its menu has been opened — and again when a new tutorial is added. */
export function hasNews(progress, tutorials) {
  return tutorials.some((t) => !progress.seen.includes(t.id));
}

export function markSeen(progress, tutorials) {
  return { ...progress, seen: [...new Set([...progress.seen, ...tutorials.map((t) => t.id)])] };
}

export function markDone(progress, id) {
  return progress.done.includes(id) ? progress : { ...progress, done: [...progress.done, id] };
}

/** "New" in the menu for tutorials added since the menu was last opened. */
export function isNew(progress, id) {
  return !progress.seen.includes(id);
}

// ---------- running a tutorial ----------

const resolve = (value, ...args) => (typeof value === 'function' ? value(...args) : value);

/**
 * Runs one tutorial at a time. `context()` gives the step checks what they need; `onChange(view)`
 * is told whenever the bubble should change; `onFinish(id)` when a tutorial is finished.
 * The page calls `check()` often (after every redraw), and `clicked()` when a lit-up part is clicked.
 */
export function createRunner({ tutorials, context, onChange = () => {}, onFinish = () => {} }) {
  let run = null; // { tutorial, index, memo, phase: 'step' | 'finished' | 'blocked', reason }

  const step = () => run?.tutorial.steps[run.index];
  const changed = () => onChange(view());

  function enter(index) {
    const ctx = context();
    let i = index;
    while (i < run.tutorial.steps.length && run.tutorial.steps[i].skipIf?.(ctx)) i += 1;
    if (i >= run.tutorial.steps.length) return finish();
    run.index = i;
    run.memo = run.tutorial.steps[i].remember?.(ctx);
    run.skipped = false;
    return changed();
  }

  function finish() {
    run.phase = 'finished';
    onFinish(run.tutorial.id);
    changed();
  }

  function start(id) {
    const tutorial = tutorials.find((t) => t.id === id);
    if (!tutorial) return;
    const reason = tutorial.ready?.(context()) ?? null;
    run = { tutorial, index: 0, memo: undefined, phase: reason ? 'blocked' : 'step', reason };
    if (reason) changed(); else enter(0);
  }

  /** Look again: is the step done, or does it need the one before? */
  function check() {
    if (run?.phase !== 'step') return;
    const s = step();
    const ctx = context();
    if (s.until?.(ctx, run.memo)) enter(run.index + 1);
    else if (!run.skipped && s.backIf?.(ctx) && run.index > 0) back();
  }

  function back() {
    const ctx = context();
    let i = run.index - 1;
    while (i > 0 && run.tutorial.steps[i].skipIf?.(ctx)) i -= 1;
    run.index = i;
    run.memo = run.tutorial.steps[i].remember?.(ctx);
    changed();
  }

  function clicked() {
    if (run?.phase === 'step' && step().click && !step().until) enter(run.index + 1);
  }

  function next() {
    if (run?.phase === 'step' && view().canNext) enter(run.index + 1);
  }

  /** Go on without doing the step. The step skipped to doesn't send the teacher back again. */
  function skip() {
    if (run?.phase !== 'step') return;
    enter(run.index + 1);
    if (run.phase === 'step') run.skipped = true;
  }

  function exit() {
    run = null;
    changed();
  }

  function view() {
    if (!run) return { phase: 'idle' };
    const { tutorial, phase } = run;
    const base = { phase, tutorial, next: nextTutorial(tutorials, tutorial.id) };
    if (phase === 'blocked') return { ...base, reason: run.reason };
    if (phase === 'finished') return base;
    const s = step();
    const ctx = context();
    const auto = Boolean(s.until || s.click);
    return {
      ...base,
      step: s,
      number: run.index + 1,
      total: tutorial.steps.length,
      title: resolve(s.title, ctx),
      text: resolve(s.text, ctx, run.memo),
      waits: auto || Boolean(s.nextWhen), // the teacher has something to do
      auto, // …and the tutorial goes on by itself when it's done
      canNext: s.nextWhen ? Boolean(s.nextWhen(ctx, run.memo)) : !auto,
    };
  }

  return { start, check, clicked, next, skip, exit, view, get running() { return Boolean(run); } };
}
