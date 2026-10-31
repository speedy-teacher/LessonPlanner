# Browser tests: new plans are born as pieces

Run the real app in a real browser, through its buttons, on this computer only (no Google Drive).
The cases are described in `docs/plans/new-plans-as-pieces-e2e.md`; the code is `newPlans.e2e.js`.

## Safety first
Always use **http://127.0.0.1:5178/**, never `localhost`. Browser storage is per address, so 127.0.0.1 holds none of the
teacher's cached plans, and Google sign-in cannot connect there (only `localhost` is registered), so nothing can reach
Drive. The tests refuse to run anywhere else. Never click "Connect Google Drive" while testing.

## How to run
1. Start the dev server (`.claude/launch.json` config `lesson-planner`, port 5178; restart it after changing `server.js`).
   It serves this folder at `/e2e/` (local server only; the published website never has it).
2. In the browser open `http://127.0.0.1:5178/`.
3. For **each** case (every case starts on a fresh computer):
   - `const t = await import('/e2e/newPlans.e2e.js'); await t.reset();`
   - reload the page
   - `const t = await import('/e2e/newPlans.e2e.js'); await t.run({ only: 'E1' })`
   It returns `{ passed, failed, results: [{ name, ok, error }] }`. A case that is not started on a fresh computer fails
   straight away with a message saying so.
4. Two cases come in two parts, because the page has to reload in the middle:
   - **E2**: `E2a` → reload (no reset) → `E2b`.
   - **E6**: `E6a` (makes the plan; keeps its download text in `window.name`) → reset → reload → `E6b`.
5. All cases must pass. Also check `read_console_messages` for errors (each case also fails on any script error,
   unhandled rejection or `console.error` while it runs).

Cases make their data with the app's own commands (`window.lessonPlanner.run`) and its buttons, using made-up names only.

## What each case proves
| Case | Proves |
| --- | --- |
| E1 | A first plan on a fresh computer is three pieces (School Year, Lesson Schedule, Teacher Resources), linked, none an older one-file plan; no sharing offer. |
| E2a / E2b | Edits land in the right piece, and all of it is there after a reload. |
| E3 | A new school year (copying) reuses the same Teacher Resources; same ids, same lesson order, grade color kept; schedule and calendar start empty; the first year is unchanged. |
| E4 | A new year without copying starts empty but still keeps the templates; still one Teacher Resources. |
| E5 | Importing an older two-year file makes two School Years and Schedules and one Resources holding each template once. |
| E6a / E6b | A downloaded copy of a plan in pieces imports as pieces with the same contents. |
| E7 | An older one-file plan still works, saves to its own record, and converts to pieces (old plan kept and renamed). |
| E8 | The "on this computer" list shows only plans (Lesson Schedules and older plans), not pieces. |
| E9 | Removing a local plan removes its Schedule and School Year, never the Teacher Resources or the other year. |
| E10 | With no Drive, the plans menu and new-year window offer no Drive-only buttons. |
