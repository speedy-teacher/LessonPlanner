# Lesson Planner

Organize music lesson slides by academic year, school, grade and instrument schedule.

**To open it:** double-click `Start Lesson Planner.bat`. Your browser opens the planner.
Keep the black window open while you work; close it when you're done.
Everything saves automatically to `data/lesson-planner.json` (with a daily copy in `data/backups/`).

## Screens

- **Lesson Calendar** — pick a school and grade, then drag eval criteria (grouped and colored by
  essential outcome) onto a day, and drag either end of the bar to stretch it over several days
  (or click an eval, then click days). Switching school/grade keeps the same month so you can compare.
  ⚠ marks an eval whose lesson needs an instrument that isn't at that school on some of its days — hover to read why.
  Shortcuts: `[` `]` school, `0`–`5` grade, `←` `→` month, `Shift`+`←` `→` shorten/lengthen the selected bar,
  `Esc` stop placing, `Ctrl+Z` undo.
- **Instrument Schedule** — drag an instrument for a school onto its first day, then drag the end of the bar
  to its last day. Bars are colored by instrument and labeled `Instrument@School`; "Show" narrows to one school.
  Same moves as the Lesson Calendar (Ctrl to copy, `Shift`+`←` `→`, `Delete`).
- **Outcomes & Lessons** — essential outcomes → eval criteria → grades and ordered lesson slides.
- **Templates** — the lesson slide template library: search, categories, which details each template
  fills in automatically, and which slides use it. `↑` `↓` move through the list.
- **Setup** — the year's dates, schools, grades and instruments; start a new year
  (copies last year's lists, outcomes, criteria and slides; calendars start empty).

## Data model

One JSON file of flat collections linked by id (see `public/js/model.js`):
`years`, `instruments`, `schools`, `grades`, `outcomes`, `templates` (year-scoped, copied each new year
with a `copiedFromId` link back), `criteria` → `slides` (belong to an outcome), and the calendars
`placements` (an eval criterion for a school + grade from `startDate` to `endDate`) and
`instrumentBlocks` (year-scoped, never copied). Outcomes carry a `color` shared by all their evals.
Older saved files are upgraded automatically when loaded (`schemaVersion`).

## For developers

- `npm start` — run the server (http://localhost:5178)
- `npm test` — behavior tests (data rules, save/load, quality check)
- `npm run lint` — ESLint limits + the function-length rule in `scripts/quality.js`
