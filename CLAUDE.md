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
  The week-by-week Lesson Schedule comes along only when the teacher ticks it in the new-year window
  (`newYearPlan(…, { weeks })` → `weekPlan.js` `carryWeekLessons`: by week number, weeks past the new year's end dropped and counted).
  Later, "📥 Bring last year's weeks…" on the Lesson Schedule (`views/bringWeeks.js`, `lastYearWeeks.js`) does the same into
  weeks still empty only (`weeksFrom(…, { map, onlyEmpty })`, one Undo), from any of the teacher's other plans (cache, else Drive);
  classes/evals matched with `matchToSchoolYear`, templates with `mergeResources`' map.
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

## Plans in pieces (department sharing; plan: `docs/plans/data-split.md`)
- `pieces.js` (pure + tested): `PIECES` says which piece every collection is saved in — **School Year** (years, schools,
  grades, instruments, outcomes, criteria, placements, instrumentBlocks, holidays), **Teacher Schedule** (weekLessons,
  criterionLessons + `yearSettings` {output, reports} + `looks` {grades, instruments} colors + `meta` {links, ownerId, year})
  and **Teacher Resources** (lessons, deckFolders, images, imageFolders, tagGroups, tags, localRoots; no yearId — kept
  across years). `TEACHER_FIELDS` = School Year record fields that are the teacher's own. `splitState`/`composeState`:
  the app still works on one combined state; a missing piece is empty and **links into it are never tidied** (heals when
  it's back). `keepViewOnly` = store guard (`setGuard`) that takes changes to view-only pieces back out.
  A new year keeps carried-over ids (`keepIds`), so a long-lived Resources still matches.
- **New plans are born as pieces** (Welcome, "Start a new school year", file import, older-planner move): `startNewYear` /
  `importPlannerData` → `createPiecePlan`. One Teacher Resources per teacher: `ownResources()` (the open plan's, else find
  the teacher's, else make one; imports reuse the record just made). `pieceFiles.js` (browser-only) makes piece files and
  finds/merges the Resources. Joining a colleague's School Year: `joinSchoolYear(shared, map, { mine, folderId })` — from an
  older plan, from a plan in pieces (old Lesson Schedule kept, renamed "(old – before joining)") or from a new year
  (`mine` = data rolled over from their year); UI `joinFlow` in `views/shareSetup.js`. `joinYear.js` matches by id
  (or `copiedFromId`) first, then by name. `planList.js` (pure) says which cached records are listed, counted as brought
  in, and removed with a plan. Only older one-file plans get the "share with your department" notice.
- `pieceEngine.js` `PiecePlan` (tested against a fake Drive): per-piece cache record (`piece`, `data`, `rev`, `base`…),
  save only changed pieces, per-piece sync/`mergePiece` (planMerge.js; tidies only links inside the piece), `missing` /
  `stale` / `access(name)` ('edit' | 'view' | 'none'), `view({ schedule, resources }, who)`/`viewMine()`/`myState()` for looking at others (`own` = your set-aside schedule + resources, kept current by `put`),
  `rebaseState` for edits made during a sync, `whyUnavailable` for greyed links. Drive labels: `lessonPlanner` =
  schoolYear|schedule|resources, `lpSchoolYear` on a Schedule (people found with `listSchedulesFor` / `listSharedResources`, never stored).
- **"Looking at" is per tab** (`lensRules.js`, pure + tested): `LENS` = lessonSchedule/reports/outcomes → `schedule` (people whose Lesson Schedule
  uses the open School Year and is shared with you; shows their schedule + the Resources it links to, else missing — never yours),
  lessons/images → `resources` (people whose Teacher Resources are shared with you, any year; your own schedule stays); other tabs show
  your own. `lookingAt.js` keeps each tab's pick (this visit, cleared when another plan opens), `follow(pageId)` swaps pieces
  (`flushSave` + `pieces.save` first, fresh undo history; `app.js` shows "Loading…" meanwhile). Whatever is shown merges as usual
  (Editor = both ways, Viewer = guard); your own pieces set aside stay current because every record write goes through `put`.
- **Colleagues' templates on your Lesson Schedule** (`sharedLessons.js` pure + tested, `borrowedPieces.js` `BorrowedResources`
  tested against a fake Drive): Teacher Resources shared with you (`listSharedResources`, re-asked every 10 min, remembered in
  `device.sharedResources`) are read-only "borrowed" files on the PiecePlan; `datas().borrowed` → `composeState` adds their lessons
  stamped `sharedFrom` (file id) + `sharedBy` (Drive display name, never saved); `splitState` drops them. `addWeekLesson` copies
  `sharedFrom` onto the entry so it can say why it's greyed (`sharedWhy`, `entryLessonWhy`). `guard` → `keepBorrowed` (blocked
  'borrowed' = notice). `current('lessons')` = own only (Lessons tab, Outcomes); palette uses `filterLessons` with `author`
  ('' / `MINE` / file id, "From" select `ls-author`). Copies fill in your own year/schedule/pictures; `heldEntries` keeps copies
  of an unavailable shared template untouched. Their template file must be shared with you too (copying needs read access).
- `workspace.js`: `pieces` (null = older one-file plan, still fully supported), `createPiecePlan`, `splitCurrentPlan`,
  `joinSchoolYear` (`joinYear.js` matches by name, tested), `myPlanState()` (exports and
  reports read only this), `copiesWaitFor()` (copies pause while looking, and wait — never trash — while a piece is missing).
- UI: `views/shareSetup.js` (guided move), `views/people.js` (bar under the tabs: "Looking at" + view-only/missing notes;
  `PAGE_PIECES`), `views/viewOnly.js` (`markViewOnly` after each render: `data-piece` zones, edit controls hidden via
  `css/sharing.css`, inputs off except search/filters/`data-look`, `[data-edit]` clicks caught). Mark new edit buttons
  `data-edit` (`'hide'` to hide), personal parts `data-piece="schedule"`, and use `goButton`/`unavailableWhy` (common.js)
  for links to other records.
- Sharing capsules (`views/capsules.js`, words in `shareStatus.js`, pure + tested): the bar shows one per file the page
  shows ("🧺 School Year · Shared / Only you / Shared with you / On this computer"; tip = what's in that file), from Drive's
  `shared` field kept on each piece record (`sharingOf` in pieceEngine; a sharing change redraws after a sync).
  `yoursCapsule(what)` = "🔒 Just yours" beside personal settings on shared pages (Setup colors, lesson-copies folder);
  add it for any new personal (Lesson Schedule) setting shown on a School Year page.

## UI patterns (`public/js/`)
- Pages are listed in `tabInfo.js` (id, label, icon, Setup-menu or tab); `app.js` adds how each is drawn.
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
  Drive: 4 entries at once (each entry one step at a time, a copy another job uses isn't touched/reused),
  "slow down" answers (429/5xx/rate-limit 403) retried after 1/3/8 s and reported (`onSlowDown`) to `copyPace.js`
  (pure + tested): then 1 at a time, +1 every 30 s back up to 4. Local folders 1 at a time. Week folders are
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
  A picture that fails goes **on hold** (`pictureHolds.js`, pure + tested; `bridge.picturesOnHold`, this visit only): wants
  leave it out (`pictureOnHold` target option; `heldHash`/`heldPicture` so copies that already have it stay), one notice per
  picture + problem. Released on the next data change, the 10-min recheck and a renewed sign-in (not `cant_share`), or when
  `imageSharing` finds it shared / it's picked again (`onSharingNews`). The problem stays in `copyStatus().pictures`
  (Setup card, `lessonPlanner.status().lessonCopies`) until a copy gets the picture.
  Background news redraws via `refreshSoon()` (quietRefresh.js), never `refresh()`, so clicks aren't swallowed.
  Not yet tried against real Google (URL `drive.google.com/uc?export=view&id=`, fallback `lh3.googleusercontent.com/d/`).

## Reports (Google Sheets: each week's lessons in order, linked to their copies, + instruments that week)
- Pure: `reportPlan.js` (tested in `test/reports.test.js`): `reportTab` (heading "School · Grade", weeks → `reportWeek`
  { number, dates, instruments ("Drum (all week)" / "Drum (available Sep 8 - Sep 9)"), lessons [{ text, url }] }),
  `reportRows` (cells { text, url, style } — shared by the tab preview and the Sheet), `lessonLabel` (`year.reports.label`,
  default `{{copy_name}}`; also `{{template_name}}` + every auto-field placeholder), `copyFinder(copies)`.
  Extra rows above/below every lesson (`year.reports.above`/`below`, same words; a row whose words are all empty is left out)
  and extra columns before/after it (`left`/`right` = [{ name, value }], `asColumn` turns older plain text into one;
  `columnNames: false` hides the names row; cells carry `span` → Sheet merges + preview colspan).
  The title bar wears the grade's color (`tab.look`, `readableText` for the ink; the dates bar is a soft `tint`).
  Row buttons are hidden on the tab for now (settings + `setReportOptions` still work). Instruments line = `instrumentsLine`:
  "Required: <lessons' instruments> / Also available: <others at the school>". Footer "Automatically maintained by Lesson Planner"
  (`linkText` links only those words to `SITE_URL`, Sheets `textFormatRuns`); `footer: false` leaves it out.
- Settings on the year record: `year.reports = { label, above[], below[], left[], right[], columnNames, footer, weekly (false = off), manual: { fromWeek, toWeek, schoolIds[], gradeIds[]
  (empty = all), layout, direction, perGrade, folder } }` (`reportSettings` fills defaults). Command area `agentReports.js`.
- Layouts (`fileLayout`): 'school' (file per school, tab per grade), 'grade' (file each), 'together' (one file, tab per school, every
  grade on it; `direction` 'down' or 'across' = side by side, each week on the same row, gap column, one footer). A together tab is
  `{ title, heading, direction, footer, parts: [classTab] }` (`reportParts`/`combinedRows`, `frozenRows`). `perGrade` stays in step
  (older planners read it); apart from 'together' it decides. Watched 'together' entries keep layout/direction/schoolIds (empty = all).
- Picture words `{{copy_thumbnail}}`/`{{template_thumbnail}}` (`PICTURE_WORDS`, `thumbnailUrl` = drive.google.com/thumbnail?id=):
  in the label, a column or a row the cell becomes `{ image, link }` (Sheet: `=HYPERLINK(link, IMAGE(url))`, rows 120 px); no Drive
  file = the words as usual. Google fetches IMAGE() without the teacher's sign-in, so private files may show blank in the Sheet
  (the Reports preview gets pictures through `thumbnails.js` `fileThumbnail(imageId)` = the planner's Drive sign-in, since the
  thumbnail address needs the browser itself signed in to Google) — not yet tried against real Google.
- Sheets: `reportSheets.js` `driveReports` (labels `lessonPlannerReport`=yearId, `reportKind` weekly|manual, `reportKey`, `hash`,
  `place`); a rewrite adds fresh tabs, deletes the old ones and fills the new in one batchUpdate (`sheetRequests`); only when `hash` changed.
- Weekly: `reportBridge.js`, run by `exportBridge.js` after the copy queue is empty (same lock, Drive output only): one
  "Week n report" per week folder that has wanted copies (`weeklyReports` + `reportSteps` reconcile create/update/remove).
- Kept up to date: Make with `manual.keepUpToDate` ticked adds each report to `year.reports.watched` ([{ id, name, schoolId, gradeIds, perGrade, fromWeek, toWeek, folder }],
  `watchedEntry`/`withWatched`). `reportBridge.js` remakes every watched report (`watchedReport`; kind `manual`, Drive file found by key = school[+grade] + weeks, so
  another week's report is its own file and never changes an earlier one; `sameReport` also finds an older weekless-key file by its name) after the copies, Drive output only, re-listing the folder before making one (no twins). Remove on the Reports tab only drops it from the
  list (+ notice: the Drive file is kept). Make fetches the copies fresh so every lesson links. Sheet links must be `textFormatRuns` (a link in the
  cell format is ignored); `LAYOUT_VERSION` in `reportHash` rewrites reports when the layout changes.
- Reports tab (`views/reports.js`, `css/reports.css`): weeks range, schools/grades toggles, one file per school (tab per grade)
  or per grade, folder (default the copies' Drive folder), preview, Make (`reportMaker.js`: same key in the same folder = update).
- Not yet tried against real Google (needs the Sheets API on; `drive.file` covers Sheets the planner made).

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

## Tutorials (🎓 at the top right) — every agent adds to these
- `tutorials.js` = the content: `TUTORIALS`, in the order a teacher should learn (each one's end offers the next).
  A tutorial `{ id, icon, title, about, ready?(ctx) → reason it can't start, steps }`; step fields are documented at the
  top of `tutorialPlan.js` (pure + tested: runner, progress, `mergeBoxes`): `target` (data-tour name/s) or `selector`,
  `text`, `skipIf`, `until` (goes on by itself), `click`, `nextWhen` (Next allowed — "add all your schools, then Next"),
  `remember`, `backIf`. Helpers: `goTo(tabId)` (tab, or Setup ▾ → page; skipped when already there), `addOne`/`addSome`,
  `placeDays`. Steps only read `ctx` (`tutorialContext()` in `views/tutorialGuide.js`), never the store directly.
- Parts of the page are named with `tour('name', el)` (dom.js), `'data-tour': 'name'`, or `tour: 'name'` on
  `popMenu`/`menuItem`; tabs are `tab-<id>`, Setup pages `menu-<id>` (`tabInfo.js`). `test/tutorials.test.js` fails if a
  step names a part no code gives out, or a page has no tutorial.
- `views/tutorialGuide.js` draws it: an SVG dim layer with even-odd holes (clicks/drags in holes reach the page; wheel
  over the dim scrolls the page), gold rings, a bubble placed beside the lit parts. Open menus of a lit `details` and
  any open dialog, notice or toast are always holes. A part missing >1.2 s → no dimming + "can't see that part" + Skip.
- `views/tutorialMenu.js`: the 🎓 menu (✓ finished, "New"); dot until the menu is opened, and again when a tutorial is
  added. Progress per browser in localStorage `lesson-planner-tutorials`.
- **Every new feature (or new page) gets tutorial steps** in the right place, data-tour names on its parts, and a test.

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
- **Before every merge/push to `main`: bump the version** (`VERSION` in `public/js/version.js`, `version` in `package.json` and both in `package-lock.json`;
  patch = fixes, minor = features) — confirm `git diff main..HEAD -- public/js/version.js` shows it — and run the personal-info check.
- Talk to the user in plain, non-technical language; give a recommendation and its practical consequence.
- Privacy: no real names, school names, emails or Google codes in code, tests, commits or chat — use obvious fakes.
  Never open files whose name contains "roster".
