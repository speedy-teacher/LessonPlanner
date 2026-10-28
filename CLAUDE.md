# Lesson Planner — notes for Claude

A browser app for a (non-technical) elementary music teacher to plan a school year of music lessons.
`README.md` has the screens and developer commands; this file holds the design decisions and working agreements.

## Run, test, check
- Launch: `Start Lesson Planner.bat` → `node server.js` → http://localhost:5178 (always `localhost`, not 127.0.0.1 — Google sign-in is registered for it).
- Node 24 is a per-user winget install; in Git Bash prepend
  `~/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64` to PATH.
- `npm test` (node --test, black-box regression tests — add one for every requested behavior), `npm run lint`
  (ESLint complexity 10, cognitive 14, max-params 5, max-lines 800 + `scripts/quality.js` function-length rule).
- Server-side changes (`server.js`, `googleAuth.js`) need the running server restarted; browser files only need a page refresh.
- Verify in the browser against the user's real data, then undo test edits and confirm the saved file is unchanged.

## Data model (`public/js/model.js`, shared by browser and tests)
- One JSON file (`data/lesson-planner.json`, autosaved, daily backups; `data/` is gitignored) of flat collections linked by id.
- Everything is per academic year (`yearId`); a new year copies `ROLLOVER` collections with `copiedFromId`; calendars start empty.
- Essential outcome (code, `color`) → eval criteria (`gradeIds[]`) → `criterionLessons` (ordered: lessonId, position) → `lessons`.
- **A lesson is one slide deck**: name, category, `autoFields[]`, `instrumentIds[]`. Decks are reusable across evals.
  "Used in the following content" traverses deck → steps → criteria → grades/outcome.
- Calendars: `placements` (criterion for school+grade, date range, colored by outcome) and `instrumentBlocks`
  (instrument@school, date range). Warnings when a placement's decks need an instrument the school lacks that day.
- `RELATIONS` drives cascading deletes. `settings` = app-wide values. `schemaVersion` + `migrate()` — back up the data file
  to `data/backups/before-<change>.json` before any migration. Design data for expandability and reuse.

## UI patterns (`public/js/`)
- `commit(mutate)` for every data change (undo/redo, autosave); `setUi(patch)` for view state; `refresh()` to redraw.
- `h()` DOM helper, full re-render per change. CSS variables only via `style.setProperty` (`setStyles`).
- `views/calendarGrid.js`: whole year as one continuous Mon–Fri scroll, sticky month header. `views/barCalendar.js`: stretchable
  multi-day bars. Switching school/grade must keep the calendar position (for comparing).
- Reusable bottom-left notices: `notices.js` `showNotice({ id, tone, title, message, actions, seconds })`. `data-tip` tooltips.
- Style: cute and comfy, earthy + royal palette tokens in `public/css/app.css` `:root`. Easy UX first.

## Google Drive (no IT approval needed — piloted and working)
- User-owned Google Cloud project in **testing** mode (school email is a test user); scopes `drive.file` + `drive.readonly`
  (readonly is needed to list inside picked folders — `drive.file` alone can't); origin `http://localhost:5178`.
  The token's granted `scope` is passed to the page (`canReadFolders()`); older sign-ins are asked to sign in again.
  Guide: `docs/google-drive-setup.md`.
- Stay signed in: GIS code flow → `googleAuth.js` keeps the refresh token + client secret in `data/google-auth.json` and serves
  1-hour access tokens. Testing mode ends the sign-in ~weekly → bottom-left "Sign in" notice + top-bar pill.
  The client secret never reaches the page or lesson data.
- Deck import (`library.js` pure + tested, `drive.js` browser-only Drive calls, `views/deckImport.js`, `views/deckTree.js`):
  all reading of files/Drive happens in the browser; only deck details are saved, never file contents.
  Watched Drive folders are re-listed every 10 min while connected; `seenDriveIds` stops deleted decks returning.
- Workspace-ready locations (`locations.js`): decks/folders keep `locations[]` (Drive `https://drive.google.com/open?id=…`,
  computer `local:<rootId>/<path>` pointing at a `localRoots` picked folder). Goal: the whole data file becomes a workspace
  saved in Drive; each computer reconnects its own copy of a `localRoot` (handle kept in that browser only). Reachability is
  checked at run time, never saved; unreachable → warning label, never removed. `lastSeenAt` updates at most daily.
  No Google Drive for Desktop (blocked by IT).
- Next on the roadmap: copy decks to a Drive folder and fill `{{School}}`-style
  placeholders via the Slides API → optional data backup to Drive.

## Working agreements
- Feature work on a `feature/...` branch, commit at milestones, then recommend merging to `main` (fast-forward, delete branch).
- Talk to the user in plain, non-technical language; give a recommendation and its practical consequence.
- Privacy: no real names, school names, emails or Google codes in code, tests, commits or chat — use obvious fakes.
  Never open files whose name contains "roster".
