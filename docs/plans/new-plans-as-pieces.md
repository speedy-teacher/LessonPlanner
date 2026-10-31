# Plan: new plans are born as pieces

Status: approved for implementation. Branch `claude/lesson-planner-data-split-fdf88c` (worktree
`.claude/worktrees/lesson-planner-data-split-fdf88c`), not merged to `main`. Background: `CLAUDE.md` ("Plans in pieces"),
`docs/handoffs/new-plans-as-pieces.md`, `docs/plans/data-split.md`.

## Goal
Every way of making a plan makes the three piece files (School Year + Lesson Schedule + Teacher Resources):
the first plan on the Welcome screen, "Start a new school year", "Open a plan file from this computer", and "Move my
plans to Google Drive" (older planner data). Old one-file plans keep working exactly as now and are the only ones that
get the "New: share with your department" notice / "Share with your department…" button.

## Decisions (already made — implement these)
1. **One Teacher Resources per teacher, always reused.** Any new plan links to the teacher's existing Teacher Resources
   (the open plan's own one if a plan in pieces is open, else `myResources()`); a new one is made only when they have none.
   This holds even when "Copy … from last year" is unticked (templates and pictures are kept across years by design).
2. **New school year** (open plan in pieces or not): source data = `myPlanState()` (the teacher's OWN data, never the
   teammate shown by "Looking at"; for a one-file plan it is `store.state`). `newYearPlan(source, fields, { copy })`
   (already uses `keepIds`) → `createPiecePlan(plan.state, { folderId, reuseResources })`. Result: a new School Year file
   (carried-over records keep their ids; calendars empty), a new Lesson Schedule (empty weekly schedule; lesson order,
   colors and `settings` carried over; `output` and `reports` start empty — same as the old behaviour), same Resources.
3. **"Use a School Year a colleague already made"** is a second choice in the new-year window (Drive connected only):
   pick their School Year file → the new year's name/dates come from it → the teacher's data rolled over with
   `newYearPlan` is matched to it (**by id first**, then by name) → the review step (reuse the existing one in
   shareSetup.js) only if something didn't match → own Lesson Schedule + same Resources linked to the colleague's file.
   No School Year file of their own is made.
4. **Joining from a plan already in pieces** ("🤝 Use a colleague's School Year…" in the plans menu, Drive plans in
   pieces only): same match/review → a new Lesson Schedule linked to the colleague's School Year; the teacher's previous
   Lesson Schedule file is kept, renamed `… (old – before joining)` and forgotten from the recent list. Their own old
   School Year file is left alone.
5. **Import** (`importPlannerData`, file button and older-planner move): each year → `createPiecePlan(..., { open: false,
   reuseResources })`. The first year reuses the teacher's Resources (or makes one); every later year in the same import
   reuses **the record just made** (don't rely on Drive's search seeing a file created a second ago). Opens the year that
   was active in the file.
6. **joinYear.js matches by id first** (same `id`, or one's `copiedFromId` is the other's id), then by name as now.
7. **Plans menu for a plan in pieces**: replace "Share or see past versions in Drive ↗" (points at the schedule) with
   "Share the School Year in Drive ↗" (link to `pieces.recs.schoolYear.fileId`, only when it has a fileId and is the
   teacher's own — `canEdit !== false`), plus the "🤝 Use a colleague's School Year…" button. Older one-file plans keep
   their current buttons.
8. Version stays **0.5.0** (main is 0.4.2; this branch's 0.5.0 has never been released). No assistant command:
   new year / opening plans are in `NEEDS_THE_TEACHER` (Google needs the teacher's click).

## Code changes

### A. New module `public/js/pieceFiles.js` (browser-only; move code out of workspace.js, which is ~690/800 lines)
Move these from `workspace.js` unchanged except as noted, and import them back into `workspace.js`:
- `newPieceRecord(name, data, { fileName, folderId, schoolYearFileId })`, `linkTo(rec)`,
  `resourcesFor({ resources, schedule }, { year, folderId, reuse })`, `myResources()`.
- They need `google` (google.js), `newId` (model.js), `createPlanFile`, `listMyResources`, `readPlanFile`,
  `PIECE_PROPERTY`, `SCHOOL_YEAR_PROPERTY` (driveFiles.js), `getPlan`, `putPlan`, `allPlans` (localCache.js),
  `driveKey` (pieceEngine.js), `fromPieceFile`, `toPieceFile`, `pieceFileName` (pieces.js),
  `mergeResources`, `relinkSchedule` (resourceMerge.js). Define `driveReady` locally (same one-liner).
- Change `resourcesFor`'s `reuse`: `false` = always new; `true` = find the teacher's (`myResources()`); **a record** =
  use that Resources record (re-read it from the cache by `key` first: `await getPlan(reuse.key).catch(() => null) ?? reuse`).
- `myResources()` local branch: use `allPlans()` (not `allCachedPlans`, which lives in workspace.js).

### B. `workspace.js`
- `createPiecePlan(state, { open, folderId, reuseResources })`: pass `reuseResources` straight through as `reuse`
  (now may be a record). Also return value: keep returning the schedule record.
- New exported helper `ownResources()` → the open plan's own Resources record when `pieces` is set and
  `pieces.access('resources') !== 'none'` (`(pieces.own ?? pieces.recs).resources`), else `true` (= find it).
  Use it as `reuseResources` everywhere a new plan is made.
- New exported `startNewYear(fields, { copy, folderId })`:
  ```js
  await flushSave(); if (pieces) await pieces.save(store.state);
  const reuse = ownResources();
  const plan = newYearPlan(current ? myPlanState() : null, fields, { copy });
  return createPiecePlan(plan.state, { folderId, reuseResources: reuse });
  ```
  (`newYearPlan` with `copy` false or a null state starts empty.)
- `importPlannerData(state, { folderId })`: for each `splitYears(state)` plan →
  `createPiecePlan(plan.state, { open: false, folderId, reuseResources: reuse })`, where `reuse` starts as `ownResources()`
  and after each year becomes the Resources record just linked: `await getPlan(schedule.data.meta.links.resources.key)`.
  Then open the active year's schedule with `openPieces(rec)` (was `show(active)`). Return the schedule records
  (they have `.name`, used by the toast).
- `joinSchoolYear(shared, map, { mine = null, folderId = null } = {})` — generalise to three callers:
  - one-file plan open and no `mine` (today's path): unchanged behaviour (`settleOldPlan`, `retireOldPlan`).
  - plan in pieces open and no `mine` (menu join): `await flushSave(); await pieces.save(store.state);` (+ `await syncNow()`
    when it's a Drive plan and `driveReady()`), data = `myPlanState()`, folder = own schedule's folderId, reuse =
    `ownResources()`; after the new schedule is made, rename the old own Lesson Schedule file to
    `${name}${OLD_JOIN_SUFFIX}` (`' (old – before joining)'`, `renamePlanFile`, ignore failure), `putPlan` it with the
    new name, and `forgetPlan` it from `device.recent`.
  - `mine` given (new-year join): data = `mine`, folder = `folderId`, reuse = `ownResources()`, nothing retired.
  Keep each function under the lint limits (split into helpers; complexity ≤ 10, cognitive ≤ 14, ≤ 60 lines).
- `computerPlans()`: list only plans a teacher opens — old one-file plans (`!p.piece`) and Lesson Schedules
  (`p.piece === 'schedule'`) with no `fileId`. Put the filter in a pure, tested function (see D).
- `removeComputerPlan(key)`: for a local Lesson Schedule also delete its School Year record when that is local
  (`!fileId`) and no other cached schedule links to it; never delete Teacher Resources (other years use it). Pure helper
  for "which keys to delete" (see D).

### C. Views
- `views/plans.js`
  - `openNewYear`: call `startNewYear(...)` instead of `newYearPlan` + `createPlan`. Remove the now-unused imports.
    Add the School Year choice (Drive connected only; hidden otherwise): two radio buttons
    "🌱 Make a new School Year" (default; shows the copy checkbox) and "🤝 Use one a colleague already made"
    (hides name/dates/copy — they come from the colleague's file — keeps a "Bring my lesson order, templates and pictures
    from <year>" checkbox, default on). On Create with the second choice: close, then call the join flow from
    shareSetup.js (see below) with `mine` = `newYearPlan(myPlanState(), fieldsFromTheirYear, { copy }).state`.
    Update the copy-checkbox wording: "Copy schools, grades, instruments, events and essential outcomes (with evals and
    your lesson order) from <year>. Your templates and pictures always come along." Hint text when Drive connected:
    "It’s saved in your Google Drive as a new School Year (to share with your department) and your Lesson Schedule.
    Calendars start empty; past years stay just as they are." Not connected: keep the "kept on this computer" wording.
    Give the radio group `data-tour: 'new-year-school-year'`.
  - `fileButton` / `bringIn`: toasts unchanged (they read `.name`).
  - `oldPlannerOffer`: years already brought in = years in cached one-file plans (`p.state.years`) **and** in cached
    School Year pieces (`p.data.years`) — today `p.state.years` throws on piece records. Use the pure helper (see D).
  - `thisPlan`: per decision 7. The pieces buttons get `data-tour: 'share-school-year'` and `'use-colleague-year'`.
- `views/shareSetup.js`
  - Export a reusable `joinFlow({ title, mine, folderId })` that opens the picker → `readSchoolYear` →
    `matchToSchoolYear(mine ?? myPlanState(), shared.piece)` → (review if unmatched) → `joinSchoolYear(shared, map, { mine, folderId })`
    → the done step. Reuse the existing `pickYear`/`review`/`run`/`done` code; the old intro's "Join" choice calls it too.
    In the done step for a join, say "You’re now using <file name>. Your own lessons, templates and pictures stay yours."
  - `offerSharing()` and `canMoveToPieces` stay as they are (they already only fire for one-file plans).
- `views/tutorialGuide.js` ctx: add `driveConnected` if not there already (check before adding).

### D. Pure helpers + unit tests (`node --test`)
- `joinYear.js` `matchToSchoolYear`: first pass, for every collection in `MATCHED` order, match a record to a not-yet-taken
  shared record with the same id or a `copiedFromId` link (either direction; for criteria only within the mapped outcome);
  second pass = today's name matching for whatever is left. Tests in `test/joinYear.test.js`:
  - a renamed school (same id, different name) still matches by id;
  - a shared record with my record's name but a different id does not steal a record that matches another by id;
  - matching via `copiedFromId`;
  - next year's School Year made by a colleague with `newYearPlan` from the shared year matches my rolled-over data
    completely (`unmatched` empty).
- `workspaceFile.js` (or a new pure `planList.js`): `listedPlans(records)` (the `computerPlans` filter),
  `broughtInYearIds(records)` (oldPlannerOffer), `keysToRemove(records, scheduleKey)` (removeComputerPlan). Tests:
  pieces' School Year/Resources/`rescue:` records are not listed; year ids come from both formats; removing one of two
  local schedules sharing a Resources keeps the Resources and the other schedule's School Year.
- `test/newYearPieces.test.js` (pure, black-box): from a composed pieces state (`composeState(splitState(seed with a
  week lesson, lesson order, a template with a Drive location, a grade color))`):
  `splitState(newYearPlan(it, fields, { copy: true }).state)` → schedule.weekLessons empty; criterionLessons same
  lessonIds/criterionIds; looks colors kept; school year placements/instrumentBlocks empty; schools/grades/outcomes keep
  their ids; `mergeResources(old.resources, next.resources)` adds nothing and maps every id to itself. With
  `{ copy: false }`: merging its resources into the old leaves the old unchanged.

### E. Docs, tutorials
- `tutorials.js`: `plans` tutorial's new-year step text → "When next school year comes, click “🌱 Start a new school year”.
  It makes a new School Year (copied from this one) and a new Lesson Schedule; your templates and pictures carry on. If
  a colleague already made next year’s School Year, choose “Use one a colleague already made”." Add a step lighting
  `new-year-school-year` only if the tutorial already opens that window (otherwise just the text). `sharing` tutorial:
  for `ctx.inPieces` add steps (skipIf `!ctx.inPieces`): open the plan menu → light `share-school-year` "Share the School
  Year in Drive: colleagues who change calendars need Editor; Viewer lets them look." → light `use-colleague-year`
  "Already have a colleague’s School Year? Use it here; your lessons, templates and pictures stay yours." `welcome`
  tutorial text stays. `test/tutorials.test.js` must still pass (every target is given out by code).
- `CLAUDE.md` "Plans in pieces": add a bullet: new plans (Welcome, new year, import) are born as pieces via
  `startNewYear` / `importPlannerData` → `createPiecePlan`; one Resources per teacher (`ownResources`); join from pieces
  (`joinSchoolYear` `{ mine, folderId }`); `pieceFiles.js`; joinYear matches by id first. `README.md` sharing paragraph:
  one sentence that new plans start shareable. `docs/handoffs/new-plans-as-pieces.md`: mark done, point to this plan.
  Update `docs/plans/data-split.md` status line.

## Hazards / rules
- Anything that replaces `store.state` from pieces must first `await pieces.save(store.state)` (and `flushSave()`).
- Never use `store.state` as the teacher's data while a plan in pieces is open — use `myPlanState()`.
- Keep `createPlan`, `show`, `fromWorkspaceFile`, one-file sync etc. — old plans still open, sync and convert.
- Lint: `npm run lint` must be clean (complexity 10, cognitive 14, max-params 5, max-lines 800, function length 60).
- Node: in Git Bash, `export PATH="$HOME/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64:$PATH"`.
- Privacy: no real names, school names, emails or Google codes anywhere. Never open files with "roster" in the name.
- Never open, sync or change the user's real plans. Do not use Google Drive in automated runs.

## End-to-end tests
Specified separately in `docs/plans/new-plans-as-pieces-e2e.md` (written after the implementation review).
