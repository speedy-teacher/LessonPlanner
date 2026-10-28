# Lesson Planner

Organize music lesson slides by academic year, school, grade and instrument schedule.

**To open it:** double-click `Start Lesson Planner.bat`. Your browser opens the planner.
Keep the black window open while you work; close it when you're done.
Everything saves automatically to `data/lesson-planner.json` (with a daily copy in `data/backups/`).

## Screens

- **Lesson Calendar** — pick a school and grade, then drag essential outcomes onto days
  (or click an outcome, then click days). Switching school/grade keeps the same month so you can compare.
  ⚠ marks an outcome whose lesson needs an instrument that isn't at that school that day — hover to read why.
  Shortcuts: `[` `]` school, `0`–`5` grade, `←` `→` month, `Esc` stop placing, `Ctrl+Z` undo.
- **Instrument Schedule** — paint which instruments are at which school, color coded.
- **Outcomes & Lessons** — essential outcomes → eval criteria → grades and ordered lesson slides.
- **Templates** — the lesson slide template library: search, categories, which details each template
  fills in automatically, and which slides use it. `↑` `↓` move through the list.
- **Setup** — the year's dates, schools, grades and instruments; start a new year
  (copies last year's lists, outcomes, criteria and slides; calendars start empty).

## Data model

One JSON file of flat collections linked by id (see `public/js/model.js`):
`years`, `instruments`, `schools`, `grades`, `outcomes`, `templates` (year-scoped, copied each new year
with a `copiedFromId` link back), `criteria` → `slides` (belong to an outcome), and the calendars
`placements` and `instrumentBlocks` (year-scoped, never copied).

## For developers

- `npm start` — run the server (http://localhost:5178)
- `npm test` — behavior tests (data rules, save/load, quality check)
- `npm run lint` — ESLint limits + the function-length rule in `scripts/quality.js`
