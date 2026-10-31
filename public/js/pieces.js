// A plan in three shareable pieces, each its own file:
//   School Year       — shared by a department: the year, schools, grades, instruments, events,
//                       outcomes & evals and both calendars.
//   Teacher Schedule  — one teacher's year: Lesson Schedule, lesson order, reports, lesson-copy folder,
//                       and that teacher's grade/instrument colors. Points at the other two pieces.
//   Teacher Resources — one teacher's library, kept across years: lesson templates and images.
//
// The app still works on one combined copy of the data (`composeState`), so pages need not know about
// pieces; saving splits it again (`splitState`). A piece that is missing is simply empty: links into it
// are never tidied away, so everything reconnects when it comes back.
//
// Pure logic, shared by the browser app and the Node tests.

import { COLLECTIONS, emptyState, normalize, PALETTE, SCHEMA_VERSION } from './model.js';

export const PIECE_NAMES = ['schoolYear', 'schedule', 'resources'];

/** Which piece every collection is saved in. */
export const PIECES = {
  schoolYear: {
    kind: 'lesson-planner-school-year',
    label: 'School Year',
    collections: ['years', 'instruments', 'schools', 'grades', 'outcomes', 'criteria', 'placements', 'instrumentBlocks', 'holidays'],
  },
  schedule: {
    kind: 'lesson-planner-schedule',
    label: 'Teacher Schedule',
    collections: ['weekLessons', 'criterionLessons'],
  },
  resources: {
    kind: 'lesson-planner-resources',
    label: 'Teacher Resources',
    collections: ['lessons', 'deckFolders', 'imageFolders', 'images', 'tagGroups', 'tags', 'localRoots'],
  },
};

/** Fields of School Year records that belong to the teacher instead (their own look and settings). */
export const TEACHER_FIELDS = { years: ['output', 'reports'], grades: ['color'], instruments: ['color'] };

/** Records in these pieces don't carry their year in the file: the School Year they're opened with gives it. */
const YEARLESS = ['schedule', 'resources'];

export function pieceOf(collection) {
  return PIECE_NAMES.find((name) => PIECES[name].collections.includes(collection)) ?? null;
}

export function pieceKind(raw) {
  return PIECE_NAMES.find((name) => raw?.kind === PIECES[name].kind) ?? null;
}

/** An empty piece of the given kind. */
export function emptyPiece(name, meta = {}) {
  const piece = { kind: PIECES[name].kind, schemaVersion: SCHEMA_VERSION, meta: { ...meta } };
  for (const c of PIECES[name].collections) piece[c] = [];
  if (name === 'schedule') Object.assign(piece, { settings: {}, yearSettings: {}, looks: { grades: {}, instruments: {} } });
  return piece;
}

// ---------- combined data → pieces ----------

/**
 * One year's planner data → { schoolYear, schedule, resources }. `meta` (links, owner…) is kept from
 * `previous` pieces when given, so saving never loses it.
 */
export function splitState(state, previous = {}) {
  const pieces = {};
  for (const name of PIECE_NAMES) {
    const piece = emptyPiece(name, previous[name]?.meta);
    for (const c of PIECES[name].collections) piece[c] = state[c].map((r) => fileRecord(name, c, r));
    pieces[name] = piece;
  }
  Object.assign(pieces.schedule, { settings: structuredClone(state.settings ?? {}), ...teacherFields(state, previous.schedule) });
  const year = state.years.find((y) => y.id === state.activeYearId);
  if (year) pieces.schedule.meta.year = { id: year.id, name: year.name };
  return pieces;
}

/**
 * The teacher's own settings that sit on School Year records. Without the School Year (no access,
 * offline) there's nothing to read them from, so the ones saved before are kept.
 */
function teacherFields(state, previous) {
  const year = state.years.find((y) => y.id === state.activeYearId) ?? state.years[0];
  if (!year) {
    return {
      yearSettings: structuredClone(previous?.yearSettings ?? {}),
      looks: structuredClone(previous?.looks ?? { grades: {}, instruments: {} }),
    };
  }
  return {
    yearSettings: pick(year, TEACHER_FIELDS.years),
    looks: { grades: colorsOf(state.grades), instruments: colorsOf(state.instruments) },
  };
}

function fileRecord(piece, collection, record) {
  const out = structuredClone(record);
  for (const field of TEACHER_FIELDS[collection] ?? []) delete out[field];
  if (YEARLESS.includes(piece)) delete out.yearId;
  return out;
}

function pick(record, fields) {
  const out = {};
  for (const f of fields) if (record?.[f] !== undefined) out[f] = structuredClone(record[f]);
  return out;
}

function colorsOf(records) {
  return Object.fromEntries(records.filter((r) => r.color).map((r) => [r.id, r.color]));
}

// ---------- pieces → combined data ----------

/**
 * The combined planner data the app works on. Any piece may be missing (null): its collections are
 * empty. Records of the teacher's pieces get the School Year's year; grade/instrument colors are the
 * teacher's own, or a default color.
 */
export function composeState(pieces = {}) {
  const state = emptyState();
  for (const name of PIECE_NAMES) Object.assign(state, collectionsOf(name, pieces[name]));
  const teacher = normalizePiece('schedule', pieces.schedule ?? {});
  const yearId = state.years[0]?.id ?? teacher.meta.year?.id ?? null;
  stampYear(state, yearId);
  if (state.years[0]) Object.assign(state.years[0], structuredClone(teacher.yearSettings));
  applyLooks(state, teacher.looks);
  state.settings = structuredClone(teacher.settings);
  const out = normalize(state);
  // Without the School Year there's no year record, but the teacher's pieces still belong to their year.
  out.activeYearId = yearId;
  return out;
}

function collectionsOf(name, piece) {
  return Object.fromEntries(PIECES[name].collections.map((c) => [c, structuredClone(piece?.[c] ?? [])]));
}

function stampYear(state, yearId) {
  const yearly = YEARLESS.flatMap((name) => PIECES[name].collections).filter((c) => COLLECTIONS[c].includes('yearId'));
  for (const c of yearly) state[c].forEach((r) => { r.yearId = yearId; });
}

function applyLooks(state, looks = {}) {
  for (const [collection, colors] of [['grades', looks.grades], ['instruments', looks.instruments]]) {
    for (const r of state[collection]) {
      if (colors?.[r.id]) r.color = colors[r.id];
      else delete r.color;
    }
  }
  // Instruments have no color filled in by normalize(); give the missing ones a default.
  state.instruments.forEach((r, i) => { if (!r.color) r.color = PALETTE[i % PALETTE.length]; });
}

// ---------- files ----------

/** The text saved in a piece's file. */
export function toPieceFile(piece) {
  return JSON.stringify(piece);
}

/** Read a piece's file. Throws Error('not_a_piece') for anything else. */
export function fromPieceFile(text, expected = null) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('not_a_piece'); }
  const name = pieceKind(raw);
  if (!name || (expected && name !== expected)) throw new Error('not_a_piece');
  return normalizePiece(name, raw);
}

/** Fill in anything missing, so older or hand-made piece files keep loading. */
export function normalizePiece(name, raw) {
  const piece = { ...emptyPiece(name), ...raw, meta: { ...(raw.meta ?? {}) } };
  for (const c of PIECES[name].collections) if (!Array.isArray(piece[c])) piece[c] = [];
  if (name === 'schedule') piece.looks = { grades: {}, instruments: {}, ...(piece.looks ?? {}) };
  return piece;
}

/** Which pieces differ between two splits (to save only those). */
export function changedPieces(before, after) {
  return PIECE_NAMES.filter((name) => toPieceFile(before[name]) !== toPieceFile(after[name]));
}

// ---------- pieces you can only look at ----------

/**
 * A change to the combined data, with whatever it did to view-only pieces taken back out.
 * `readOnly` = names of pieces that can't be changed (shared as "Viewer", or missing).
 * Returns { state, changed, blocked }: `changed` = pieces to save, `blocked` = view-only pieces the
 * change tried to touch (to tell the teacher when nothing else changed).
 */
export function keepViewOnly(before, after, readOnly, previous = {}) {
  const was = splitState(before, previous);
  const now = splitState(after, previous);
  const changed = changedPieces(was, now);
  const blocked = changed.filter((name) => readOnly.includes(name));
  if (!blocked.length) return { state: after, changed, blocked };
  for (const name of blocked) now[name] = was[name];
  return { state: composeState(now), changed: changed.filter((name) => !blocked.includes(name)), blocked };
}

/** The Drive file name of a piece, e.g. "School Year 2026–27". */
export function pieceFileName(name, year) {
  const yearName = year?.name ? ` ${year.name}` : '';
  if (name === 'schoolYear') return `School Year${yearName}`;
  if (name === 'schedule') return `Lesson Schedule${yearName}`;
  return 'Teacher Resources';
}
