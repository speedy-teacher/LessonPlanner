# End-to-end tests: "Looking at" per tab

Companion to `docs/plans/looking-at-per-tab.md`. Same harness style as `test/e2e/newPlans.e2e.js` (read
`test/e2e/README.md`): run at `http://127.0.0.1:5178` only, `reset()` → reload → `run({ only })`, fail a case on any
script error / unhandled rejection / `console.error`.

## A fake Google Drive inside the page
Colleagues sharing files needs Drive, which these tests must never touch. So the harness gets
`test/e2e/fakeDrive.js`: an in-memory Drive that replaces `window.fetch` for Google Drive URLs only.
- **Never lets a request reach Google:** any URL on `googleapis.com` / `google.com` it doesn't understand throws
  (fails the case); other URLs pass through to the real fetch (the app's own files).
- Implements just what `public/js/driveFiles.js` (and `pieceEngine` via workspace `driveCalls`) send — read that file
  for the exact URLs, query params and bodies: files.list (`q` with `properties has { key='…' and value='…' }`,
  `'me' in owners`, `not 'me' in owners`, `trashed = false`, `and`/`or`/parentheses; `fields`, `orderBy`), files.get
  metadata, `alt=media` content, create (multipart/related upload), content update (PATCH upload), metadata PATCH
  (name, keepForever on revisions, addParents/removeParents), folder lookup/create. Each file: `{ id, name, parents,
  properties, owner: { displayName, permissionId }, ownedByMe, canEdit, text, rev }`; `rev` changes on every content
  write (`headRevisionId`). 403/404 for files not "shared with me" (a `sharedWith` flag per file).
- Test helpers: `fakeDrive.install()` / `uninstall()`, `addFile({ … })` (a colleague's file), `edit(fileId, fn)`
  (a colleague changes their file: parse → fn(data) → save → new rev), `read(fileId)`, `share(fileId, role|null)`.
- Signing in: set the app's Google state to connected with a fake token the way `public/js/google.js` exposes it
  (read it; e.g. `google.status = 'connected'; google.token = 'fake-token'`, expiry far ahead so nothing tries to renew
  through a Google popup). Never call `connectDrive` and never click "Connect Google Drive".
- Colleagues' piece files are built with the app's own `/js/pieces.js` (`splitState`, `toPieceFile`) from
  `/js/seed.js` / `/js/model.js` data, with made-up names ("Pat Example", "Sam Sample", "Lee Placeholder").
- Seed per case: make my plan in pieces through the UI (Start a new school year, with the fake Drive connected, so my
  three files are in the fake Drive), then add colleagues' files linked to my School Year file id
  (`lpSchoolYear` property on their Lesson Schedule) as the case needs.

Add a `test/e2e/README.md` section for these cases. Put the cases in `test/e2e/lookingAt.e2e.js` (same `run`/`reset`
exports). Re-run E1–E10 afterwards; they must still pass.

## Cases (made-up people)
- **L1 Lesson Schedule lists only Lesson Schedules for this School Year.** Pat shares a Lesson Schedule using my
  School Year; Sam shares a Lesson Schedule using a different School Year file; Lee shares only Teacher Resources.
  On Lesson Schedule, Reports and Outcomes the picker lists Me + Pat only.
- **L2 Templates/Images list only Teacher Resources.** Same files + Pat also shares Resources. On Lesson Templates and
  Images the picker lists Me, Lee, Pat (sorted), not Sam; two Resources files owned by Lee → one "Lee" row.
- **L3 Resources-only sharing works.** Pick Lee on Images: Lee's pictures (and tags) show; Lesson Templates still says
  "Me" and shows my templates; Lesson Schedule shows my schedule; Calendar shows mine.
- **L4 Schedule shared without Resources.** Pat shared only the Lesson Schedule. Pick Pat on Lesson Schedule: Pat's
  week entries show; their template names are unavailable with the tip containing "Not shared with you"; none of my
  templates appear; the bar says Pat's Teacher Resources can't be opened.
- **L5 Each tab remembers its own choice.** Pick Pat on Lesson Schedule, go to Images (shows "Me"), pick Lee, back to
  Lesson Schedule (Pat), Images (Lee), Calendar (mine, no picker). Never a stuck "Loading…". Opening another plan
  clears every choice back to "Me".
- **L6 A colleague's Resources as Editor merges both ways.** Lee shared as Editor. While looking at Lee on Images, I
  rename a tag; meanwhile `fakeDrive.edit` adds a picture to Lee's file. After `syncNow()`: Lee's file in the fake Drive
  has both the renamed tag and the new picture; the page shows both.
- **L7 A colleague's Lesson Schedule as Editor merges both ways.** Same as L6 for Pat's schedule (I add a week entry,
  Pat's copy gets another entry) → both kept in Pat's file.
- **L8 Viewer stays view only.** Lee shared as Viewer: edit buttons hidden on Images, a change through
  `lessonPlanner.run(...)` (or `commit`) is refused, Lee's file in the fake Drive unchanged (same rev).
- **L9 My own edits are never lost while looking.** While looking at Lee on Images, add a week entry to MY schedule
  with an assistant command. Back to "Me": the entry is there, my schedule file in the fake Drive has it after sync,
  and Lee's file doesn't.
- **L10 Undo never crosses people.** Edit my resources, switch Images to Lee, press Undo (and `undo()`): nothing of
  Lee's or mine changes; back to Me, my edit is still there.
- **L11 Exports stay mine.** While looking at anyone, `copiesWaitFor()` reports 'looking' and `myPlanState()` holds my
  own schedule and templates, not theirs.
- **L12 Assistant commands per tab.** `lessonPlanner` `people` for tab `images` lists Lee and Pat; for
  `lessonSchedule` lists Pat; `lookAt` Lee on `images` works and leaves Lesson Schedule on "Me"; status reports the
  per-tab choices.
- **L13 Losing access heals.** Lee unshares (`share(id, null)`) while chosen on Images: the page keeps working
  (view only / "Not shared with you", no crash); share again → back after the next sync.
