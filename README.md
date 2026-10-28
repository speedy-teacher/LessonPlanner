# Lesson Planner

Organize music lesson slides by academic year, school, grade and instrument schedule.

**To open it:** go to the planner's website (see `docs/hosting.md`), or on this computer double-click
`Start Lesson Planner.bat`.

Each school year is one **plan**: a file in a **Lesson Planner** folder in your Google Drive (or kept on one computer only).
The 📒 plan button at the top switches plans, starts a new school year, opens a plan shared with you, brings in a file,
downloads a copy, and shows (and moves) the Drive folder the plan is in. New plans can go in any folder you pick. Changes save on the computer at once and to Drive a moment later; if the plan changed on another
computer meanwhile, the planner asks which to keep. Drive keeps one version per day.

## Screens

Both calendars show the whole school year as one continuous scroll (month buttons jump to a month).
Hold a bar's end, or anything you're dragging, near the top or bottom edge to scroll into other months.

- **Outcome & Eval Calendar** — pick a school and grade, then drag eval criteria (grouped and colored by
  essential outcome) onto a day, and drag either end of the bar to stretch it over several days
  (or click an eval, then click days). Switching school/grade keeps the same month so you can compare.
  ⚠ marks an eval whose lesson needs an instrument that isn't at that school on some of its days — hover to read why.
  Shortcuts: `[` `]` school, `0`–`5` grade, `←` `→` month, `Shift`+`←` `→` shorten/lengthen the selected bar,
  `Esc` stop placing, `Ctrl+Z` undo.
- **Instrument Schedule** — drag an instrument for a school onto its first day, then drag the end of the bar
  to its last day. Bars are colored by instrument and labeled `Instrument@School`; "Show" narrows to one school.
  Same moves as the Outcome & Eval Calendar (Ctrl to copy, `Shift`+`←` `→`, `Delete`).
- **Lesson Schedule** — every school week as a row (week number + dates) for a school + grade. Drag lesson decks
  (with first-slide previews; search and filter by grade, outcome, eval, category) from the right into a week; drag
  to reorder, move to another week, or back to the list to take off. Rows show that week's evals (outcome colors)
  and instruments (dashed = part of the week); ⚠ = a deck's instrument isn't there that week.
  "✨ Fill from Outcome & Eval Calendar" spreads each eval's lessons, in order, over the weeks it's on the calendar.
  The ✨ at the top right of a week fills just that week.
- **Outcomes, Evals & Lesson Order** — essential outcomes → eval criteria → grades and the lesson decks for each eval, in teaching order
  (each eval's lesson list starts closed — click its heading to open it).
- **Lesson Templates** — the library of lessons (one slide deck each), organized in folders (click to open/close, drag decks
  and folders onto a folder, `⋯` to rename/delete). **+ Add** makes a new deck or folder, or brings in slide files or a whole
  folder (folders inside folders too) from the computer or Google Drive. Drive folders are watched: decks added there later
  appear with a ❗ (also shown on every folder above them) until you change any of their details.
  Each deck has its instruments, the details it fills in automatically (including week number and the class's lesson number)
  with the `{{…}}` text to type in the slides for each (click to copy), and which evals teach it (**+ Add to an eval** right there).

Click any instrument (a bar on the Instrument Schedule, or a tag) for a menu: **Lessons that use …** opens Lesson Templates
showing only those lessons (**× Show all** to clear). `↑` `↓` move through the list.
- **Setup ▾** — a menu of three pages: **School Year**, **Outcomes, Evals & Lesson Order** and **Lesson Templates**.
- **School Year** — the year's dates, schools, grades and instruments; start a new year
  (copies last year's lists, lesson decks, outcomes, criteria and lesson order; calendars start empty).
  The **Google Drive** card connects to Drive — see `docs/google-drive-setup.md`.

The top bar shows a Drive status pill (click to sign in or open settings). Notices pop up in the bottom-left corner (`public/js/notices.js` — reusable: message, buttons, auto-hide).

## Data model

One JSON file of flat collections linked by id (see `public/js/model.js`):
`years`, `instruments`, `schools`, `grades`, `outcomes`, `deckFolders`, `lessons` (slide decks with their `instrumentIds`,
`folderId` and the `locations` of its file — Drive and/or a picked computer folder in `localRoots`;
all year-scoped, copied each new year
with a `copiedFromId` link back), `criteria` (belong to an outcome) → `criterionLessons` (the lessons
of an eval in teaching order, by `position`), and the calendars
`placements` (an eval criterion for a school + grade from `startDate` to `endDate`) and
`instrumentBlocks` (year-scoped, never copied). Outcomes carry a `color` shared by all their evals.
Older saved files are upgraded automatically when loaded (`schemaVersion`).

## For developers

The planner is a static website (`public/`). Published to GitHub Pages by `.github/workflows/pages.yml`,
with the Google codes built in from repository secrets (`scripts/write-config.js` → `public/config.js`, not in git).

- `npm start` — build `public/config.js` and serve the site locally (http://localhost:5178)
- `npm test` — behavior tests (data rules, save/load, quality check)
- `npm run lint` — ESLint limits + the function-length rule in `scripts/quality.js`
