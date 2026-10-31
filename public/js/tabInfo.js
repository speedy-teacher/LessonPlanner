// The planner's pages, in tab order (app.js adds how each one is drawn).
// Pages with `menu: 'setup'` are reached through the "Setup ▾" menu instead of their own tab.
// Kept apart from app.js so the tutorials (and their tests) know the pages too.

export const TAB_INFO = [
  { id: 'plan', label: 'Outcome & Eval Calendar', icon: '📅' },
  { id: 'schedule', label: 'Instrument Schedule', icon: '🎶' },
  { id: 'lessonSchedule', label: 'Lesson Schedule', icon: '📖' },
  { id: 'images', label: 'Images', icon: '🌄' },
  { id: 'reports', label: 'Reports', icon: '📊' },
  { id: 'setup', label: 'School Year', icon: '🧺', menu: 'setup' },
  { id: 'outcomes', label: 'Outcomes, Evals & Lesson Order', icon: '🌱', menu: 'setup' },
  { id: 'lessons', label: 'Lesson Templates', icon: '🖼️', menu: 'setup' },
];
