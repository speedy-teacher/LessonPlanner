# Plan: "Looking at" per tab — anyone who shared that piece with you

Status: approved by the user. Branch `claude/lesson-planner-data-split-fdf88c` (worktree
`.claude/worktrees/lesson-planner-data-split-fdf88c`), not merged. Background: `CLAUDE.md` "Plans in pieces",
`docs/plans/data-split.md`, `docs/plans/new-plans-as-pieces.md`.

## Goal (the teacher's words)
Teachers can share any of the three files, or not, and it works. Share only your Teacher Resources → a colleague sees
your templates and your image database. Share only your Lesson Schedule → they see your lessons and copies' links.
"Looking at" is specific to the tab: it lists only people who shared, with you, the piece that tab shows.
**All pieces keep merging as before**, so people with Editor access contribute seamlessly (per-piece three-way merge,
`pieceEngine.js` `combine`, `rebaseState` for edits during a sync).

## Decisions (final)
1. **Who each tab lists** (plus "Me", always first):
   | Tab (page id) | Lens | Listed |
   |---|---|---|
   | Lesson Schedule (`lessonSchedule`), Reports (`reports`), Outcomes (`outcomes`, its lesson order) | `schedule` | people whose **Lesson Schedule uses the School Year file you have open** and is shared with you (`listSchedulesFor`, as today) |
   | Lesson Templates (`lessons`), Images (`images`) | `resources` | people whose **Teacher Resources** is shared with you (any year — Resources has no year) |
   | everything else (Calendar, Instrument Schedule, Setup pages…) | none | no picker; always shows your own pieces |
   Drive only returns files shared with you, so nobody appears whose data you can't open.
2. **What a choice shows:**
   - schedule lens, person P: P's Lesson Schedule + **P's Teacher Resources if P shared it with you** (the one P's schedule
     links to); otherwise Resources is "missing" (`no_access` → greyed "Not shared with you"), never your own templates.
     School Year = always your open one.
   - resources lens, person P: **your own** Lesson Schedule + P's Teacher Resources.
   - "Me" / no lens: all your own pieces.
3. **Each tab remembers its own choice** (per page id, in memory for this visit; cleared when another plan opens).
   Going to a tab shows that tab's choice; a tab never chosen shows "Me".
4. **Merging/saving while looking:** whatever piece is shown is saved, synced and merged on its own exactly like your own
   (Editor → editable and merged both ways; Viewer → view only via the guard). Your own pieces set aside while looking
   must never lose an edit: when your own piece is the one shown (e.g. your schedule on the Images tab while looking at
   P's pictures), edits and syncs to it must also update the set-aside copy (see A.2 — this is a real bug to avoid).
5. **Undo history** is cleared whenever the shown pieces change (switching person, or a tab change that swaps pieces)
   — an undo must never apply one person's data to another's. A tab change that doesn't change what's shown keeps it.
6. **Exports/reports** stay from your own plan only (`myPlanState()`, `copiesWaitFor()` = 'looking' whenever any of
   your pieces is set aside) — unchanged.
7. **No flash of the wrong person's data:** when a tab change needs different pieces, the page shows a short
   "Loading…" until they're in place.

## A. Engine — `public/js/pieceEngine.js` (pure, tested against the fake Drive in `test/pieceEngine.test.js`)
1. Generalise `view`: `async view({ schedule = null, resources = 'linked' }, who = {})`
   - `schedule`: a teammate's Lesson Schedule record, or `null` = your own.
   - `resources`: `'linked'` = the Resources the shown schedule links to (from cache, else `not_loaded` → fetched by
     `syncAll`; a fetch refused → `no_access`), a Resources **record** = that one, or `null` = your own.
   - Keeps `this.own = { schedule, resources, missing }` (your own records) the first time anything of yours is set aside.
     If the result is all-your-own, behave as `viewMine()`.
   - `this.viewing = { schedule: who.schedule ?? null, resources: who.resources ?? null }` where each is `{ name, fileId }`
     of the person whose piece is shown, or null for your own. Keep a back-compat getter-free shape: update every reader
     (`people.js`, `agentBridge.js`, `workspace.js`) — grep `viewing`.
   - `link('schoolYear')` keeps using your own schedule (unchanged); `link('resources')` follows the **shown** schedule.
     For the resources lens the shown Resources isn't linked from the shown schedule: store the explicitly chosen
     Resources' `{ key, fileId }` (e.g. `this.chosen.resources`) and make `link('resources')` return it, so `syncAll`
     syncs/fetches it.
2. **Never lose your own edits while looking:** route every write of `this.recs[name] = …` (save, syncPiece, fetch,
   upload, download, combine, trouble) through one helper `put(name, rec)` that also does
   `if (this.own?.[name]?.key === rec.key) this.own[name] = rec`. `viewMine()` then restores the current records.
3. `myDatas()` / `myState()`: your own = `this.own[name] ?? this.recs[name]` for schedule and resources.
4. Tests (add to `test/pieceEngine.test.js`, black-box, fake Drive):
   - resources-only view: shows my schedule + their Resources; `myState()` is mine; `viewMine()` restores.
   - schedule view of someone whose Resources isn't shared: Resources missing with `no_access` after `syncAll`, my own
     templates NOT shown; `whyUnavailable` says "Not shared with you".
   - **edit my own schedule while looking at their Resources, `viewMine()` → my edit is still there** (and was saved/synced).
   - their Resources shared as Editor: I edit it while they edit it in Drive → `syncAll` merges both (conflict-free
     edits both kept), result uploaded; shared as Viewer → my change refused by `guard`.
   - their Lesson Schedule as Editor: same merge check.
   - `syncAll` while looking syncs every shown piece (and fetches a chosen Resources not yet cached).

## B. Pure tab rules
- `public/js/lensRules.js` (pure, tested in `test/lensRules.test.js`):
  - `LENS = { lessonSchedule: 'schedule', reports: 'schedule', outcomes: 'schedule', lessons: 'resources', images: 'resources' }`.
  - `wantedView(pageId, picks)` → `{ lens, schedule: person|null, resources: 'linked'|person|null }` from per-page picks
    (`picks[pageId]` = a person `{ fileId, name, ownerId }` or undefined). No lens → all null.
  - `sameView(a, b)` (compare by fileIds) — decides whether a tab change swaps pieces.
  - `peopleFrom(files, { mineFileId })` → one row per owner (newest file per `ownerId`), excluding your own file and files
    you own (`ownedByMe`), sorted by name: `[{ fileId, name: owner || file name, ownerId }]`.
  - Tests: lens table; picks per page don't leak between pages; resources lens keeps your schedule; duplicates per owner
    collapse to the newest; your own Resources never listed.
- `driveFiles.js`: `listSharedResources(token)` → `has(PIECE_PROPERTY('resources')) and not 'me' in owners`
  (+ a test in `test/driveFiles.test.js` checking the query, like the existing ones).

## C. Browser wiring
- New `public/js/lookingAt.js` (browser; move `listTeammates`, `viewTeammate`, `viewMine` out of `workspace.js`,
  which is ~700 lines): per-page `picks` (cleared when a different plan opens — hook where `openPieces` runs, e.g. an
  exported `onPlanOpened` reset, or compare `current.key`).
  - `peopleFor(pageId)` → schedule lens: `listSchedulesFor` (existing teammates logic) ; resources lens:
    `listSharedResources` → `peopleFrom`. Cache per lens on this computer as today (`device.teammates`), keyed by
    School Year fileId for schedules and `'resources'` for resources, so the list shows at once next time.
  - `pick(pageId, person|null)` → set the pick, then `follow(pageId)`.
  - `follow(pageId)` → if `!sameView(wanted, shown)`: `await flushSave(); await pieces.save(store.state);` then load
    the needed records (cache first: `getPlan(driveKey(fileId))`, else read the file from Drive like
    `readTeammateSchedule` does — for Resources build the record the same way with `fromPieceFile(text, 'resources')`),
    `pieces.view(...)`, `useState(pieces.state())` (fresh undo history), `showWhereSaved()`, `syncNow()`.
    Returns whether it swapped. Concurrent calls: the latest wins (ignore stale completions).
  - Export what `workspace.js`, `people.js` and `agentBridge.js` need; `workspace.js` keeps `myPlanState`/`copiesWaitFor`
    working with the new `own` shape.
- `app.js` render: before drawing a page, `if (pieces && needsSwap(tab.id))` draw `h('p', { class: 'hint' }, 'Loading…')`
  in main and call `follow(tab.id).then(refresh)`; otherwise draw normally. Keep render synchronous.
- `views/people.js`:
  - picker only on pages with a lens; shows that page's pick ("Me" or the person's name);
  - rows from `peopleFor(pageId)`; empty text per lens: schedule → "Nobody has shared their Lesson Schedule for this
    School Year with you yet."; resources → "Nobody has shared their Teacher Resources with you yet.";
    not connected → "Connect Google Drive to see colleagues.";
  - the picker no longer requires a School Year file for the resources lens (today it needs `link('schoolYear').fileId`);
    the schedule lens still does.
  - `pieceName(name)` uses `pieces.viewing[name]?.name` per piece ("Pat’s Teacher Resources").
  - Update the header comment (one choice per tab, who's listed).
  - Keep `PICKER_TIPS`; adjust wording to say the list shows people who shared it with you.
- `agentBridge.js` (assistant commands): `people({ tab })` lists who's available for that tab (default the open tab;
  error with the choices if the tab has no picker); `lookAt({ name, tab })` picks for that tab (default the open tab),
  "me" = own; `partsStatus().lookingAt` = `{ [pageId]: name }` for every page with a pick, plus the open tab's.
  Keep accepting the old single-string argument as the name. Update `lessonPlanner.help()` text. Add tests if these
  helpers' pure parts can be tested (`test/agentCommands*.test.js` cover pure command areas; the bridge is browser-only —
  at least keep `test/assistantAccess.test.js` passing).

## D. Tutorials, docs
- `tutorials.js` `sharing` tutorial "Look at a teammate’s plans" step: say the list on each tab shows only colleagues who
  shared that part with you — their Lesson Schedule on Lesson Schedule/Reports/Outcomes (same School Year), their Teacher
  Resources on Lesson Templates/Images — and each tab remembers its own choice. `test/tutorials.test.js` must pass.
- `shareSetup.js` done step: mention that Lesson Schedule and Teacher Resources can each be shared on their own in Drive.
- `CLAUDE.md` "Plans in pieces": replace the teammate sentence with the per-tab lens rules, `lensRules.js`,
  `lookingAt.js`, `listSharedResources`, `own` kept current by `put`. `README.md` sharing paragraph: one sentence.

## Hazards / rules
- Before replacing `store.state` from pieces: `await flushSave(); await pieces.save(store.state)`.
- A piece you can only view is protected by the store guard; never write to someone else's file without Editor access.
- Lint (complexity 10, cognitive 14, 5 params, 800 lines, function length 60) and `npm test` must pass.
- Node in Git Bash: `export PATH="$HOME/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64:$PATH"`.
- Privacy: made-up names only; never open files with "roster" in the name. Never use Google Drive or the teacher's real
  plans in automated runs.
