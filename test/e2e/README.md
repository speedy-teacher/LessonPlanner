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
| E12 | “Bring last year’s weeks…” on the Lesson Schedule fills empty weeks from another year by week number and keeps weeks already planned. |
| E11 | A new year can bring the week-by-week schedule along by week number; weeks past the new year's end are left out (and counted). |

# Browser tests: "Looking at" per tab

The cases are described in `docs/plans/looking-at-per-tab-e2e.md`; the code is `lookingAt.e2e.js` (the runner) with the
cases in `lookingAtLists.js` (L1-L5, L12), `lookingAtAccess.js` (L6-L8, L13) `lookingAtMine.js` (L9-L11) `signInLate.js` (S1-S3) and `capsules.js` (C1), and the
scenario builders in `lookingAtKit.js`. `helpers.js` holds the helpers both test files share.

## A pretend Google Drive
Colleagues sharing files needs Drive, which the tests must never touch. `fakeDrive.js` is an in-memory Drive inside the
page: it replaces `window.fetch` for Google addresses only, answers exactly what `public/js/driveFiles.js` sends (searches
by label and owner, reading, creating, saving, moving, renaming, keeping a revision), and **refuses anything else on a
Google address** (the case then fails with "a request tried to reach Google"). The sign-in is faked by setting the page's
Google state to connected with a made-up pass; nothing ever opens Google's window. Never click "Connect Google Drive".

Test helpers: `addFile` (a colleague's file, owner by name), `edit(fileId, fn)` (a colleague changes it in Drive),
`share(fileId, 'writer' | 'reader' | null)`, `read`, `revOf`. All names are made up (Pat Example, Sam Sample, Lee Placeholder).

## How to run
Same as above, one case per page load (reset, reload, run), only at `http://127.0.0.1:5178/`:

- `const t = await import('/e2e/lookingAt.e2e.js'); await t.reset();`
- reload the page
- `const t = await import('/e2e/lookingAt.e2e.js'); await t.run({ only: 'L1' })`

Keep only one browser tab open on 127.0.0.1:5178 (`reset()` can wait forever if another tab holds the database open).

| Case | Proves |
| --- | --- |
| L1 | Lesson Schedule, Reports and Outcomes list only Lesson Schedules that use this School Year (and are shared with me). |
| L2 | Lesson Templates and Images list only people who shared Teacher Resources, sorted, one row per person. |
| L3 | Looking at someone's Resources on Images leaves Lesson Templates, Lesson Schedule and the Calendar on mine. |
| L4 | A schedule shared without its Resources shows their entries, "Not shared with you" for templates, none of mine. |
| L5 | Each tab remembers its own choice; opening another plan clears them. |
| L6 | A colleague's Resources shared as Editor merges both ways (my tag rename + their new picture both kept). |
| L7 | A colleague's Lesson Schedule shared as Editor merges both ways. |
| L8 | A Viewer file stays view only: buttons hidden, changes refused, nothing sent. |
| L9 | An edit to my own schedule while looking at someone's Resources is kept, saved, and never sent to them. |
| L10 | Undo never crosses people. |
| L11 | Lesson copies and reports still come from my own plan while looking. |
| L12 | The assistant's `people` / `lookAt` work per tab. |
| L13 | A colleague un-sharing (and sharing again) never breaks the page. |
| S1 | The share window, opened just before Google sign-in finishes, turns on “Join” once signed in. |
| S2 | The “Looking at” list, opened just before sign-in finishes, stays open and finds colleagues once signed in. |
| S3 | The new-year window, opened just before sign-in finishes, offers Google Drive once signed in (typed name kept). |
| C1 | Sharing capsules: “Only you” → “Shared” once I share the School Year, “Shared with you” for a colleague’s, “Just yours” on my own Setup settings. |

## Template Maker window (`templateMaker.e2e.js`)
Fresh computer (reset + reload), then `const t = await import('/e2e/templateMaker.e2e.js'); await t.run()` → `{ passed, errors }`.
A pretend Drive (`templateMaker/fakeGoogle.js`) answers every Google address; the planner gets pretend Google codes and a
pretend file picker (`usePicker`). Proves: + Add → ✨ opens the window, the plan's Drive folder is used, a made-up deck's
lesson/week numbers are found and ticked, Make saves a template copy in that folder and adds it ❗ new, the original is
unchanged, "Show me" selects it. `t.preview()` just opens the window with one lesson read (to look at; reload after).
