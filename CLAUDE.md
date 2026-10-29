# Lesson Planner — notes for Claude

A browser app for a (non-technical) elementary music teacher to plan a school year of music lessons.
`README.md` has the screens and developer commands; this file holds the design decisions and working agreements.

## Run, test, check
- **Static website** (`public/`), published to GitHub Pages by `.github/workflows/pages.yml` (`docs/hosting.md`).
  Google Client ID + API key are built in at publish time from repo secrets `GOOGLE_CLIENT_ID`/`GOOGLE_API_KEY`
  (`scripts/write-config.js` → `public/config.js`, gitignored, sets `window.PLANNER_CONFIG`). Users never enter them;
  missing/wrong codes → red error notice + "Drive: not set up" pill (`configProblems`).
- Local: `Start Lesson Planner.bat` → writes config (from env or the old `data/lesson-planner.json` settings) → `node server.js`
  → http://localhost:5178 (always `localhost` — registered with Google). The server only serves files + read-only legacy
  `GET /api/state` (the old data, for "Move my plans to Google Drive").
- Node 24 is a per-user winget install; in Git Bash prepend
  `~/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64` to PATH.
- `npm test` (node --test, black-box regression tests — add one for every requested behavior), `npm run lint`
  (ESLint complexity 10, cognitive 14, max-params 5, max-lines 800 + `scripts/quality.js` function-length rule).
- Server-side changes (`server.js`, `googleAuth.js`) need the running server restarted; browser files only need a page refresh.
- Verify in the browser against the user's real data, then undo test edits and confirm the saved file is unchanged.

## Data model (`public/js/model.js`, shared by browser and tests)
- **One plan (workspace) file per school year** (`workspaceFile.js`, pure + tested): normal planner data holding exactly one year,
  plus `kind: 'lesson-planner-workspace'`. `yearOnly`/`splitYears` (collections with `yearId` filter by it; `criteria`/
  `criterionLessons` follow their parent). New year = `newYearPlan` → a new plan file. Older multi-year files are split on import.
- Where it lives (`workspace.js`): Drive file in a folder the user picks (`views/planFolders.js`, Google folder picker,
  default a "Lesson Planner" folder; "Move to another folder…" = addParents/removeParents), found by property `lessonPlanner=workspace`
  (`driveFiles.js`), or "this computer only". Every plan is cached in IndexedDB (`localCache.js`, + localStorage rescue on
  page close). Saves: cache at once, Drive 2 s later; `syncAction` compares `headRevisionId` → upload / download / ask
  (conflict: "Use the Drive version" keeps mine as a "(my changes)" plan). One Drive revision kept forever per day.
- Per-browser only (`deviceSettings.js`): recent plans, last plan, `driveConnected`. View state in `lesson-planner-ui`.
- Everything is per academic year (`yearId`); a new year copies `ROLLOVER` collections with `copiedFromId`; calendars start empty.
- Essential outcome (code, `color`) → eval criteria (`gradeIds[]`) → `criterionLessons` (ordered: lessonId, position) → `lessons`.
- **A lesson is one slide deck**: name, category, `autoFields[]`, `instrumentIds[]`. Decks are reusable across evals.
  "Used in the following content" traverses deck → steps → criteria → grades/outcome.
- Calendars: `placements` (criterion for school+grade, date range, colored by outcome) and `instrumentBlocks`
  (instrument@school, date range). Warnings when a placement's decks need an instrument the school lacks that day.
- Lesson Schedule: `weekLessons` (class = school+grade, `weekStart` Monday, lessonId, optional criterionId, position) —
  week order only, no days. Pure logic + auto-fill in `weekPlan.js` (tested); view `views/lessonSchedule.js`.
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
  (readonly is needed to list inside picked folders — `drive.file` alone can't); origins `http://localhost:5178` + the Pages site.
  The token's granted `scope` is passed to the page (`canReadFolders()`); older sign-ins are asked to sign in again.
  Guide: `docs/google-drive-setup.md`.
- Sign-in is browser-only: GIS **token** flow (`google.js`), 1-hour token in memory, no client secret. GIS popups need a user
  click, so on open and ~10 min before expiry the next click anywhere renews (`renewOnNextClick`); expired → notice + pill.
  Colleagues using a shared plan must be test users while the project is in testing mode.
- Deck import (`library.js` pure + tested, `drive.js` browser-only Drive calls, `views/deckImport.js`, `views/deckTree.js`):
  all reading of files/Drive happens in the browser; only deck details are saved, never file contents.
  Watched Drive folders are re-listed every 10 min while connected; `seenDriveIds` stops deleted decks returning.
- Workspace-ready locations (`locations.js`): decks/folders keep `locations[]` (Drive `https://drive.google.com/open?id=…`,
  computer `local:<rootId>/<path>` pointing at a `localRoots` picked folder). Goal: the whole data file becomes a workspace
  saved in Drive; each computer reconnects its own copy of a `localRoot` (handle kept in that browser only). Reachability is
  checked at run time, never saved; unreachable → warning label, never removed. `lastSeenAt` updates at most daily.
  No Google Drive for Desktop (blocked by IT).
- Previews (`thumbnails.js`): first slide only, for Drive decks, via Drive `thumbnailLink` in an <img> (Google blocks fetch/CORS);
  addresses kept in memory per visit, never saved. Other decks show "Preview not available".
- **Export bridge (lesson copies)**: every `weekLessons` entry gets a copy of its lesson's template in the year's output folder
  (`year.output` = `{ kind: 'drive', folderId, name, keeperId, keeperName }` or `{ kind: 'local', name, … }` + a folder handle kept
  in that browser), as `<output>/<plan name>/<school>/<grade name>/Week n/<order> - <lesson>`. Reconciles, never replays: `exportPlan.js`
  (pure + tested) works out wanted copies (`hash` = template + filled values, `place` = folder) and `nextStep` = create / move / refill
  (fresh copy, old one trashed) / remove (trash). `exportDrive.js` (copy, fill via Slides/Docs/Sheets `replaceAllText`/`findReplace`,
  move, trash; copies found again by `appProperties`) and `exportLocal.js` (File System Access, `lesson-planner-copies.json` list; no
  fill-in) share that path. `exportBridge.js` runs it in the background after changes (1.5 s), bottom-right queue panel.
  Templates are only ever copied. Shared plans: only the keeper (who chose the folder, by Google `permissionId`) changes copies;
  others get a notice naming the keeper and how many copies are behind. Copies aren't in the plan data, so undo never touches them.

## Images tab (pictures for lesson copies, e.g. bitmojis)
- `imageFolders` + `images` (Drive only) use the same library code as lesson decks: `library.js` "shelves" (`LESSON_SHELF`
  default, `IMAGE_SHELF`), `views/folderTree.js` (shared tree), `views/deckImport.js` `importFromDrive(kind)` + watched folders.
- Tags are user-defined: `tagGroups` → `tags`, `image.tagIds[]`; `image.instrumentIds[]`; `image.when` timing rules.
  `holidays` (one list per year, all schools; rolls over a year later). All roll over with the year.
- `imagePick.js` (pure + tested): port of lesson-organizer `pick_bitmoji.py` (date / holiday windows, priority 4/3/2,
  any time = 1; ties prefer shared, then instrument). Lessons opt in with the `image` auto field (`PICTURE_FIELDS`,
  placeholder = an `IMAGE_ANCHOR` shape, never text-replaced). Placing the picture in copies is the exporter's next step.
- Sharing (`imageSharing.js`): Drive `permissionIds` has `anyoneWithLink` → Google can fetch it into Slides/Docs/Sheets.
  Checked at run time, never saved; warnings on Images and on lessons that use an unshared picture.
- Original bitmoji rules/data: `~/Documents/CodeProjects/lesson-organizer/HANDOFF.md` (+ `bitmoji_tags.json`).
  The user adds the pictures in the app; linking those tags up is a later data step.

## Working agreements
- Feature work on a `feature/...` branch, commit at milestones, then recommend merging to `main` (fast-forward, delete branch).
- Talk to the user in plain, non-technical language; give a recommendation and its practical consequence.
- Privacy: no real names, school names, emails or Google codes in code, tests, commits or chat — use obvious fakes.
  Never open files whose name contains "roster".
