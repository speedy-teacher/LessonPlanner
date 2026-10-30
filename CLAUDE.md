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
  page close). Saves: cache at once, Drive 2 s later; `syncAction` compares `headRevisionId` → upload / download / combine.
  Combine (`planMerge.js`, pure + tested): three-way merge by record id against `base` (the file text at `rev`, kept in
  the cached record only, never in Drive); id lists merged item by item, locations by `uri`, `lastSeenAt` newest wins,
  positions renumbered, dangling links tidied via `RELATIONS`. Differing edits / delete-vs-edit keep mine, one notice
  offers "Use the other computer's" (`useTheirs`, a normal undoable commit). Records cached before `base` existed
  still get the old ask ("Use the Drive version" keeps mine as a "(my changes)" plan). One Drive revision kept forever per day.
- Per-browser only (`deviceSettings.js`): recent plans, last plan, `driveConnected`. View state in `lesson-planner-ui`.
- Everything is per academic year (`yearId`); a new year copies `ROLLOVER` collections with `copiedFromId`; calendars start empty.
- Essential outcome (code, `color`) → eval criteria (`gradeIds[]`) → `criterionLessons` (ordered: lessonId, position) → `lessons`.
  **Each grade of an eval has its own lesson order** (`criterionLessons.gradeId`; null = eval has no grades yet; schema v6
  copied the old shared order to every grade). Always pass the grade: `stepsFor(state, critId, gradeId)` (a grade the eval
  isn't for falls back to its first order; no grade = all steps). `addStep` without a grade adds to every grade;
  `toggleGrade`/`setGrades` copy the first order to a new grade; `copyOrder` = "Use X's order for every grade".
  The Outcomes page switches grades with pills that share `ui.gradeId` with the Lesson Schedule.
- Grades have a `color` (`GRADE_PALETTE`, filled in on load like outcome colors; picker in Setup). Grade buttons use
  `gradePills()` (tinted) and `--grade` on `.grade-toggle`. Calendar "All" (`ui.planAllGrades`, key A): every grade's
  placements, bar = grade color, outcome code keeps the outcome color. Its side list shows every eval under its
  outcome, colored by the eval's grade; dragging/clicking the eval places it for that grade, its grade badges for
  any of its grades (`ui.armedGradeId`). `evalLabel()` = "Eval (K, 1, 2)" for lists that mix grades.
- Eval main grade (`criteria.mainGradeId`, `evalGrade.js`): ★ on hover over a chosen grade toggle. `evalGradeId` = main
  grade, else the only grade, else null; that grade's color = the eval's title banner (`readableText` picks ink/white)
  and its color on the calendar's All list. Cleared when that grade leaves the eval. Command: `editEval mainGrade`.
  Don't name CSS classes `main` (the page's `<main class="main">` styles would apply).
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
  fill-in) share that path. `exportBridge.js` runs it in the background, bottom-right queue panel: a minute after your
  last data change (`SETTLE_MS`, `store.editedAt` = commit/undo/redo only; a change mid-run pauses the queue), with a
  countdown + "Update now"; opening/loading a plan, signing in or choosing a folder update after 1.5 s.
  Drive: 4 entries at once (`JOBS`; each entry one step at a time, a copy another job uses isn't touched/reused),
  "slow down" answers (429/5xx/rate-limit 403) retried after 1/3/8 s; local folders 1 at a time. Week folders are
  looked up once per path (promise cache); same-name twins are combined into the oldest (`combineInto`, contents moved,
  twin trashed). One computer/tab per plan works at a time (`copyLock.js`, pure + tested): note `lpWorker`/`lpWorkerUntil`
  on the plan's folder, 3-min claim renewed every minute, read back after 1.5 s; a fresh claim re-lists the copies;
  others show "Your other computer is updating the lesson copies" and look again in a minute.
  Templates are only ever copied. Shared plans: only the keeper (who chose the folder, by Google `permissionId`) changes copies;
  others get a notice naming the keeper and how many copies are behind. Copies aren't in the plan data, so undo never touches them.

- **Copies are updated in place** (`exportFill.js`, pure + tested): each copy's labels remember what was typed in
  (`v_<placeholder>`, `pic`, `tpl`); the template still has its placeholders, so the copy must read template-filled-with-old
  values at every placeholder spot, and exactly those spots are swapped (Slides deleteText/insertText, Docs
  deleteContentRange/insertText, Sheets updateCells). Any mismatch (teacher edited that spot, template changed, Office
  template, header/footer placeholders) → `NotInPlace` → fresh copy + old one trashed. A schedule entry that needs a copy
  first reuses a "spare" copy of the same lesson whose entry left the schedule (`sparesFor`, step `adopt`). Only lessons
  truly gone are trashed.
- **Pictures** (`exportGoogle.js`): Slides copies only; `createImage` on `IMAGE_ANCHOR` spots (anchor deleted, picture id
  `lpPicture…`), later `replaceImage`. The picture is shared "anyone with the link" only while Google fetches it, then that
  permission is deleted (untouched if it was already shared). Refused → copy kept without picture, notice, ⚠ on Images.
  A picture that fails goes **on hold** (`bridge.picturesOnHold`, this visit only): wants leave it out (`pictureOnHold`
  target option; `heldHash`/`heldPicture` so copies that already have it stay), one notice per picture. Released on
  the next data change (not for `cant_share`) or when `imageSharing` finds it shared / it's picked again (`onSharingNews`).
  Background news redraws via `refreshSoon()` (quietRefresh.js), never `refresh()`, so clicks aren't swallowed.
  Not yet tried against real Google (URL `drive.google.com/uc?export=view&id=`, fallback `lh3.googleusercontent.com/d/`).

## Images tab (pictures for lesson copies, e.g. bitmojis)
- `imageFolders` + `images` (Drive only) use the same library code as lesson decks: `library.js` "shelves" (`LESSON_SHELF`
  default, `IMAGE_SHELF`), `views/folderTree.js` (shared tree), `views/deckImport.js` `importFromDrive(kind)` + watched folders.
- Tags are user-defined: `tagGroups` → `tags`, `image.tagIds[]`; `image.instrumentIds[]`; `image.when` timing rules.
  Events (`schoolEvents.js` `yearEvents`): first/last day of school (from the year's dates) + U.S. holidays inside the
  year are computed, never stored; the user's own events are the `holidays` collection (one list, all schools; rolls over
  a year later) and one with a built-in's name replaces it. All of the Images data rolls over with the year.
- `imagePick.js` (pure + tested): port of lesson-organizer `pick_bitmoji.py` (date / holiday windows, priority 4/3/2,
  any time = 1; ties prefer shared, then instrument). Lessons opt in with the `image` auto field (`PICTURE_FIELDS`,
  placeholder = an `IMAGE_ANCHOR` shape, never text-replaced). Placing the picture in copies is the exporter's next step.
- Sharing (`imageSharing.js`): Drive `permissionIds` has `anyoneWithLink` → Google can fetch it into Slides/Docs/Sheets.
  Checked at run time, never saved; warnings on Images and on lessons that use an unshared picture.
- Original bitmoji rules/data: `~/Documents/CodeProjects/lesson-organizer/HANDOFF.md` (+ `bitmoji_tags.json`).
  The user adds the pictures in the app; linking those tags up is a later data step.

## Assistant commands (Claude, later Gemini, controlling the open app)
- The teacher asks an assistant to do anything in the planner. Claude in Chrome is blocked on their computer, so Claude Code
  opens the live site in its **built-in browser** (`mcp__Claude_Browser__*`) and runs JavaScript in the page; the user-level
  skill `~/.claude/skills/lesson-planner/SKILL.md` walks any session through it. The plan comes from Drive, so the teacher's
  own Chrome tab picks up the changes (it re-checks Drive when the tab is shown again and every minute).
- Use the page's `window.lessonPlanner` instead of clicking: `lessonPlanner.status()` (plan open? signed in? saved? + `nextStep`),
  `lessonPlanner.help()` lists every command by area; a hidden `#assistant-note` + `<meta name="ai-assistant">` point there;
  `lessonPlanner.run(name, args)` or `run([{ command, args }, …])` (all or nothing, one Undo step). Start with `overview`.
- `agentCommands.js` (pure + tested) gathers the areas: `agentSchedule.js` (schedule + both calendars), `agentSetup.js`
  (year, schools/grades/instruments, events), `agentOutcomes.js` (outcomes, evals, lesson order), `agentLessons.js`
  (templates, folders), `agentImages.js` (pictures, tags, timing); `findRecords` reads anything else. Shared lookups/checks in
  `agentHelpers.js`: things named as the app shows them or by id, active year only, weeks by number or any date in the week,
  1-based positions, friendly `CommandError`s that list the choices.
- `agentBridge.js` commits the changed copy, shows "✨ Your assistant made changes" with Undo, and registers every command as a
  WebMCP tool (`document.modelContext`, fallback `navigator.modelContext`) for Gemini in Chrome once Google enables it
  (Oct 2026: not yet, and its auto browse is off for school-managed accounts).
- Not possible by command (Google needs the teacher's click): signing in, importing decks/pictures, choosing the copies folder,
  new year / opening plans — `NEEDS_THE_TEACHER`.
- **Every new feature that changes data needs a command too** (in its area file) + a test in `test/agentCommands*.test.js`.

## Working agreements
- Feature work on a `feature/...` branch, commit at milestones, then recommend merging to `main` (fast-forward, delete branch).
- Talk to the user in plain, non-technical language; give a recommendation and its practical consequence.
- Privacy: no real names, school names, emails or Google codes in code, tests, commits or chat — use obvious fakes.
  Never open files whose name contains "roster".
