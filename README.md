# Lesson Planner

Organize music lesson slides by academic year, school, grade and instrument schedule.

**To open it:** double-click `Start Lesson Planner.bat`. Your browser opens the planner.
Keep the black window open while you work; close it when you're done.
Everything saves automatically to `data/lesson-planner.json` (with a daily copy in `data/backups/`).

## Screens

Both calendars show the whole school year as one continuous scroll (month buttons jump to a month).
Hold a bar's end, or anything you're dragging, near the top or bottom edge to scroll into other months.

- **Lesson Calendar** — pick a school and grade, then drag eval criteria (grouped and colored by
  essential outcome) onto a day, and drag either end of the bar to stretch it over several days
  (or click an eval, then click days). Switching school/grade keeps the same month so you can compare.
  ⚠ marks an eval whose lesson needs an instrument that isn't at that school on some of its days — hover to read why.
  Shortcuts: `[` `]` school, `0`–`5` grade, `←` `→` month, `Shift`+`←` `→` shorten/lengthen the selected bar,
  `Esc` stop placing, `Ctrl+Z` undo.
- **Instrument Schedule** — drag an instrument for a school onto its first day, then drag the end of the bar
  to its last day. Bars are colored by instrument and labeled `Instrument@School`; "Show" narrows to one school.
  Same moves as the Lesson Calendar (Ctrl to copy, `Shift`+`←` `→`, `Delete`).
- **Outcomes & Lessons** — essential outcomes → eval criteria → grades and the lesson decks for each eval, in teaching order.
- **Lesson Decks** — the library of lessons (one slide deck each): search, categories, the instruments it uses,
  which details it fills in automatically, and which evals teach it. `↑` `↓` move through the list.
- **Setup** — the year's dates, schools, grades and instruments; start a new year
  (copies last year's lists, lesson decks, outcomes, criteria and lesson order; calendars start empty).

## Data model

One JSON file of flat collections linked by id (see `public/js/model.js`):
`years`, `instruments`, `schools`, `grades`, `outcomes`, `lessons` (slide decks with their `instrumentIds`;
all year-scoped, copied each new year
with a `copiedFromId` link back), `criteria` (belong to an outcome) → `criterionLessons` (the lessons
of an eval in teaching order, by `position`), and the calendars
`placements` (an eval criterion for a school + grade from `startDate` to `endDate`) and
`instrumentBlocks` (year-scoped, never copied). Outcomes carry a `color` shared by all their evals.
Older saved files are upgraded automatically when loaded (`schemaVersion`).

## For developers

- `npm start` — run the server (http://localhost:5178)
- `npm test` — behavior tests (data rules, save/load, quality check)
- `npm run lint` — ESLint limits + the function-length rule in `scripts/quality.js`
