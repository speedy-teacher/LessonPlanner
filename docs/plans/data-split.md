# Plan: splitting a plan into three shareable pieces

Status: **proposal, waiting for approval.** Nothing is built yet.

## 1. The three pieces

| Piece | What's in it | How many | Who edits |
|---|---|---|---|
| **School Year** | year (name, dates), schools, grades (no colors), instruments (no colors), holidays/events, outcomes (with their colors), evals (incl. main grade), Outcome & Eval Calendar (`placements`), Instrument Schedule (`instrumentBlocks`) | one per department per year | everyone the department shares it with (edit) |
| **Teacher Schedule** | Lesson Schedule (`weekLessons`), Lesson Order (`criterionLessons`), reports settings + kept-up-to-date list, lesson-copies output folder, **my grade & instrument colors**, links to its School Year and Teacher Resources | one per teacher per year | that teacher |
| **Teacher Resources** | Lesson Templates (`lessons`, `deckFolders`), Images (`images`, `imageFolders`, `tagGroups`, `tags`), computer folders (`localRoots`) | **one per teacher, kept across years** (see decision A) | that teacher |

Every collection and every field belongs to exactly one piece. A single table (`PIECES` in a new pure
module `pieces.js`) says which, and a test fails if anything is unassigned or lands in two pieces.

### Links between pieces (pointers only, never copied data)
- Teacher Schedule → `{ schoolYear: { fileId, name }, resources: { fileId, name } }`.
- School Year and Teacher Resources point at nothing. Teammates are found through Google Drive instead
  (section 4), so the shared School Year file never lists people.
- Drive labels (appProperties) on each file: `lessonPlanner = schoolYear | schedule | resources`,
  and on a Schedule `lpSchoolYear = <School Year fileId>`, so the planner can find files without opening them.

**Result for the teacher:** they add *one* file — their Teacher Schedule (or a teammate's) — and the
other two come along, as long as Drive lets them see them.

## 2. Working with or without the other pieces (never break, always heal)

- The app still works on **one combined view** of the data in memory (same collections as today), built by
  `compose(pieces)`. Views, assistant commands, the week planner, exports and reports keep working mostly
  unchanged — this keeps the change safe and the app fast.
- A missing piece (no access, deleted, offline with no saved copy) is simply an empty piece. Anything that
  points into it shows as **"not available"** (greyed out, with a tooltip saying why: "Not shared with you",
  "Can't reach Google Drive", "File was removed").
- **Links into another piece are never cleaned up automatically.** Today, a lesson in the schedule whose
  template is gone is deleted; after the change it stays, greyed, and comes back to life the moment the
  template piece reappears (healing). Cleanup inside one piece (e.g. deleting an eval's lesson order with
  the eval) keeps working as today.
- When *you* deliberately delete something (e.g. a template) and your own other piece uses it, the planner
  removes those uses too, in one Undo step — same as today. It never touches a piece you can't edit.
- **Stable ids across years:** today a new year gives schools/grades/instruments/outcomes/evals new ids.
  From now on a new School Year keeps the same ids for things carried over, so a teacher's long-lived
  Resources (instruments on templates and pictures) stay connected year after year.
- Links that open something else (Lesson Schedule → "Open template", template → "Used in…", Images → lesson,
  calendar → eval) go through one helper `linkTo(kind, id)` → `{ ok, why }`; buttons/menu items are greyed
  with the `why` as their tooltip.

## 3. Permissions (robust to anything Drive says)

Each piece remembers what Drive allows: **edit**, **view only**, or **no access**. Then:
- View-only piece → its pages show a small "View only" tag and edit controls are greyed; an attempted change
  (including an assistant command) gets a friendly "you can only look at this" notice and nothing is lost.

### What a view-only piece looks like (e.g. Frank shares his Lesson Schedule with you as "Viewer")
- **Everything is visible, nothing is editable.** The page draws exactly as it does for Frank, with:
  - a soft banner at the top: "👀 You're looking at Frank's Lesson Schedule — view only" (+ "Why?" →
    "Frank shared it as Viewer. Ask Frank for Editor access to make changes.");
  - no drag handles; cards can't be dragged or resized (calendar bars, schedule cards, lesson order);
  - add / delete / rename buttons, color pickers and toggles hidden or greyed (greyed when hiding would
    confuse the layout), each with the tooltip "View only";
  - text fields shown as plain text instead of input boxes;
  - "look" actions still work: open the template (if shared), previews, search, switching grade/school/week,
    the calendar's All view, printing / reports preview.
- Pages that mix pieces only lock the parts from the view-only piece. Example: on Outcomes, a view-only
  School Year locks outcomes/evals but your own Lesson Order stays editable — and the reverse.
- Keyboard shortcuts, Undo/Redo, paste and assistant commands that would change a view-only piece are
  refused with one friendly notice; nothing half-happens.
- How it's built: every piece in memory carries `access: 'edit' | 'view' | 'none'` (from Drive's
  `capabilities.canEdit`). One helper `canChange(collection | record)` is used by the shared building blocks
  (`h()` controls, `barCalendar`, drag helpers, `popMenu` items) so each page gets view-only behaviour
  without hand-editing every button. As a safety net, `commit()` checks the change: if it touches a
  view-only piece, the change is undone at once and the notice shows. Tests: a view-only piece can never be
  changed by any command, and every page renders without edit controls for it.
- Access changes are picked up on the next Drive check: if Frank later makes you an Editor, the banner goes
  away and editing turns on without reopening.

- A teammate's Resources you can open, but whose template/picture files you can't: the list, names, tags and
  timing rules all show (they're in the Resources file); the preview shows a soft "Picture not shared with you"
  tile instead of the image. Same for template previews.
- Access lost while open → the piece keeps showing its last saved copy marked "not up to date", and refreshes
  when access returns.

## 4. "Whose plans am I looking at?" (people picker)

- On Lesson Schedule, Reports, Lesson Templates, Images, and the Lesson Order part of Outcomes, a searchable
  dropdown at the top: **"Looking at: Me ▾"**. One choice shared by all of those pages (pick a teammate once,
  every teacher-page shows theirs). School Year pages (calendars, setup) don't have it — they're shared.
- The list is built from Drive: Teacher Schedules labelled with this School Year that are shared with you,
  named by their Google owner's display name (nothing about people is stored in the School Year file).
  Remembered on this computer so it opens instantly; refreshed in the background.
- Looking at a teammate loads their Schedule + Resources — editable or view only exactly as Drive allows
  (decision B) — on top of the shared School Year. Your own data stays loaded underneath, so exports keep running for you.
- A teammate whose Resources aren't shared with you: their schedule shows lesson names it remembers, but
  "Open template" is greyed ("Their templates aren't shared with you").

## 5. Exports and reports: only your own

- The lesson-copy exporter and weekly/kept-up-to-date reports run **only for your own Teacher Schedule**, and
  only copy templates from **your own Resources** — never from whoever you're looking at.
- "Keeper" today = who chose the output folder. It becomes simply "the owner of the Teacher Schedule" (your
  Google account id saved when the Schedule is created). Someone else opening your Schedule never exports.
- A schedule entry whose template isn't available is skipped (not trashed) and listed as "waiting for template"
  — so a temporary access hiccup never deletes copies.
- The existing per-plan lock (one computer at a time) moves to the Schedule's output folder, unchanged.

## 6. Several people and several computers at once

- Each piece is its own Drive file with its own revision check and the existing three-way combine
  (`planMerge.js`, applied per piece). The School Year is the one most likely to be edited by several
  teachers; their changes combine record by record, and only true clashes (same thing changed two ways) get
  the existing "Use the other version" notice.
- One edit can change two of your pieces (e.g. delete a template + its schedule entries). Undo/redo keeps
  working on the combined view; on save, each piece that actually changed is saved on its own.
- If one piece fails to save and another succeeds, each piece retries independently; nothing waits on the other.
- Copies: only the Schedule owner exports, and the one-computer lock stays — so two clients never fight over copies.

## 7. Moving existing plans over (migration)

- When an old-style plan is opened, a notice: **"New: share your School Year with your department"** →
  a 3-step guided window:
  1. "We'll make a safe backup first" — Drive version kept forever + a downloadable copy.
  2. Choose: **"Start a new shared School Year from my plan"** (recommended for the first teacher in a
     department) or **"Join a School Year someone shared with me"**.
  3. The planner makes the files (School Year, My Lesson Schedule, My Teacher Resources) in the same Drive
     folder and opens the new Schedule. The old file is renamed "(old – before sharing)" and left untouched.
- **Joining** an existing School Year: your schools, grades, instruments, outcomes and evals are matched to the
  department's by name; a short review screen shows anything that didn't match ("Your 'Gr 2' — is this
  department's 'Grade 2'?"). Your schedule, lesson order and templates are then pointed at the department's ones.
- Older years' plan files can be converted the same way later; their templates are folded into the same
  Resources (matched by where the template file lives in Drive, so no duplicates).
- "This computer only" plans keep working: all three pieces are kept on the computer, and "Move to Google
  Drive" moves all three.
- Old file versions stay readable forever (schema migration v6 → v7 is one-way; backup first as always).

## 8. Keeping it snappy

- Every piece is cached on the computer (IndexedDB, as today), so opening is instant; Drive syncing happens behind.
- Only pieces that changed are uploaded (compare each piece's text with what was last saved).
- One Drive "what changed?" call (Drive changes feed) instead of checking each file every minute.
- A teammate's pieces are loaded only when you pick them, then cached.
- Lookups by id are kept in small indexes rebuilt only when a piece changes; the combined view reuses the
  pieces' records (no copying).
- Previews/permission checks stay "on demand, remembered for this visit" like today.

## 9. Other parts that must follow along

- **Assistant commands:** every command knows which piece it changes and refuses view-only/missing ones with
  a friendly message; `status()` reports the three pieces; a command to switch "Looking at".
- **Top bar:** the Drive pill gains three small dots (School Year · Schedule · Resources) — saved / view only /
  not available — with a hover that explains each.
- **Sharing help:** "Share…" opens the file in Google Drive's own share screen (the planner can't show Google's
  share box itself any more), with a short guide on what to share with whom.
- **Tutorials:** new "Share with your department" and "Look at a teammate's plans" tutorials; existing
  tutorials updated for the picker.
- **Docs:** CLAUDE.md data-model section rewritten; README screens.

## 10. Build order (each step tested and committed on a feature branch)

1. **Pieces model (pure + tested):** `pieces.js` (`PIECES`, `split`, `compose`, `linkTo`), soft cross-piece
   links in `RELATIONS`, stable ids on new year, schema v7 migration. Tests: segmentation (nothing leaks),
   round trip split→compose, missing-piece and heal behaviour, cross-piece delete in one undo.
2. **Saving pieces:** `workspace.js` holds several pieces, each with its own cache record, Drive file, revision
   and combine; view-only guard; Drive changes feed.
3. **Migration:** guided window, backup, "start new" and "join + match by name" (pure matcher, tested).
4. **People picker + teammate view:** Drive discovery, searchable dropdown, view-only overlay, greyed links,
   "not shared with you" previews.
5. **Exports & reports:** run only on my own pieces; skip-not-trash for unavailable templates.
6. **Polish:** top-bar status, sharing help, assistant commands, tutorials, docs.
7. **Check in the browser with the real data** (then undo test edits), lint, version bump (minor → 0.4.0),
   personal-info check, then recommend merging to `main`.

Rough size: the biggest change since the Drive move — several sessions of work. Steps 1–3 are invisible to
the teacher until step 3 offers the migration, so the live site keeps working throughout.

## 11. Decisions needed

- **A. Teacher Resources across years** — *Recommended: one library per teacher, kept forever.* Templates and
  pictures are set up once, shared once, and every year uses them. (Alternative: a new library each year like
  today — simpler migration, but you'd re-share and re-tidy every year.)
- **B. Teammates' pages** — *Recommended: follow Google Drive* — Viewer = view only (section 3), Editor = can
  edit, exactly as the owner chose when sharing. Plus a later "Copy to my plans" button (copy a teammate's
  template/lesson order into your own). Their lesson copies are still only ever made by them (section 5).
  (Alternative: always view only, even with Editor access — safest, but blocks co-teachers who plan together.)
- **C. Lesson Order follows the teacher** (as you listed) — so each teacher can teach an eval in their own order,
  and the Outcomes page shows the order of whoever is picked. Confirming this is intended.
- **D. Grade & instrument colors are personal** (stored in the Teacher Schedule) — each teacher sees their own
  colors; outcome colors stay shared. Confirming this is intended.
