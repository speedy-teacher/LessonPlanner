// Reports as Google Sheets (see reportPlan.js for what they say). Each report file carries hidden
// labels (Drive "appProperties") naming its year, kind ('weekly' or 'manual'), key and contents
// fingerprint, so the planner finds it again from any computer and only rewrites it when it changed.
// Rewriting replaces every tab in one go (new tabs in, old tabs out), so a report is never half-written.

import { reportRows, reportWidth, showsColumnNames } from './reportPlan.js';

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SHEETS = 'application/vnd.google-apps.spreadsheet';
export const REPORT_LABEL = 'lessonPlannerReport';
const FIELDS = 'id,name,parents,appProperties';

const NUMBER_WIDTH = 90;
const LESSON_WIDTH = 420;
const COLUMN_WIDTH = 220; // an extra column

/** Column widths (pixels): lesson number, extra columns left, the lesson, extra columns right. */
function columnWidths(tab) {
  const extra = (list) => (list ?? []).map(() => COLUMN_WIDTH);
  return [NUMBER_WIDTH, ...extra(tab.columns?.left), LESSON_WIDTH, ...extra(tab.columns?.right)];
}

/** '#5b3f8c' → Google's { red, green, blue } (0–1). */
function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

// The planner's own colors (app.css), so reports look like the planner.
const INK = rgb('#3f3127');
const INK_SOFT = rgb('#7a6a5c');
const ROYAL = rgb('#5b3f8c');
const ROYAL_SOFT = rgb('#ece4f6');
const SAGE = rgb('#6b8f5e');
const CREAM = rgb('#fff8ec');

const text = (format) => ({ foregroundColor: INK, ...format });
const STYLES = {
  heading: { backgroundColor: ROYAL, textFormat: text({ bold: true, fontSize: 18, foregroundColor: CREAM }) },
  subheading: { backgroundColor: ROYAL_SOFT, textFormat: text({ italic: true, foregroundColor: ROYAL }) },
  week: { backgroundColor: SAGE, textFormat: text({ bold: true, fontSize: 12, foregroundColor: CREAM }) },
  label: { textFormat: text({ bold: true, foregroundColor: INK_SOFT }) },
  instruments: { textFormat: text({}) },
  number: { horizontalAlignment: 'CENTER', textFormat: text({ foregroundColor: INK_SOFT }) },
  lesson: { textFormat: text({}) },
  column: { textFormat: text({}) },
  columnHead: { backgroundColor: ROYAL_SOFT, textFormat: text({ bold: true, foregroundColor: ROYAL }) },
  extra: { textFormat: text({ fontSize: 9, foregroundColor: INK_SOFT }) },
  empty: { textFormat: text({ italic: true, foregroundColor: INK_SOFT }) },
  note: { textFormat: text({ italic: true, fontSize: 9, foregroundColor: INK_SOFT }) },
};

/** A style with the cell's own background (`color`) and text (`ink`) colors, when it has them. */
function withColors(style, { color, ink }) {
  if (!color) return style;
  return { ...style, backgroundColor: rgb(color), textFormat: { ...style.textFormat, foregroundColor: rgb(ink ?? '#3f3127') } };
}

const linkFormat = (format, uri) => ({ ...format, underline: true, foregroundColor: ROYAL, link: { uri } });

/**
 * One cell for Google Sheets: its text, look, and link — the whole text links (e.g. to the copy), or
 * with `linkText` only that part of the text does.
 */
export function sheetCell(cell) {
  const style = withColors(STYLES[cell.style] ?? {}, cell);
  const text = cell.text ?? '';
  // Google only keeps a link that's in a text run (a link in the cell's own format is ignored).
  const linkAt = cell.url ? text.indexOf(cell.linkText ?? text) : -1;
  return {
    userEnteredValue: { stringValue: text },
    userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', ...style },
    ...(linkAt >= 0 ? { textFormatRuns: linkRuns(text, linkAt, { ...cell, linkText: cell.linkText ?? text }, style.textFormat ?? {}) } : {}),
  };
}

/** Text runs where only `cell.linkText` (starting at `at`) is a link. */
function linkRuns(text, at, cell, format) {
  const end = at + cell.linkText.length;
  return [
    ...(at > 0 ? [{ startIndex: 0, format }] : []), // run start indexes must all differ
    { startIndex: at, format: linkFormat(format, cell.url) },
    ...(end < text.length ? [{ startIndex: end, format }] : []),
  ];
}

/** Tab names must differ: a second "Grade 1" becomes "Grade 1 (2)". */
function uniqueTitles(tabs) {
  const seen = new Map();
  return tabs.map((tab) => {
    const n = (seen.get(tab.title) ?? 0) + 1;
    seen.set(tab.title, n);
    return n === 1 ? tab.title : `${tab.title} (${n})`;
  });
}

/** Merges for cells that cover more than one column (`span`). */
function merges(sheetId, rows) {
  return rows.flatMap((row, r) => {
    let column = 0;
    return row.flatMap((cell) => {
      const start = column;
      column += cell.span ?? 1;
      return (cell.span ?? 1) > 1
        ? [{ mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: start, endColumnIndex: column }, mergeType: 'MERGE_ALL' } }]
        : [];
    });
  });
}

function tabRequests(sheetId, title, { tab, rows }) {
  return [
    { updateSheetProperties: { properties: { sheetId, title }, fields: 'title' } },
    { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: rows.map((r) => ({ values: r.map(sheetCell) })), fields: 'userEnteredValue,userEnteredFormat,textFormatRuns' } },
    ...merges(sheetId, rows),
    ...columnWidths(tab).map((pixelSize, i) => ({
      updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: 'pixelSize' },
    })),
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
  ];
}

/**
 * The Sheets batchUpdate that makes a spreadsheet show `tabs`: add a fresh tab for each (ids `newIds`),
 * take the old tabs (`oldIds`) out, then name and fill the new ones.
 */
export function sheetRequests(oldIds, tabs, newIds) {
  const parts = tabs.map((tab) => ({ tab, rows: reportRows(tab) }));
  const titles = uniqueTitles(tabs);
  return [
    ...parts.map(({ tab, rows }, i) => ({
      addSheet: {
        properties: {
          sheetId: newIds[i], title: `new ${newIds[i]}`, index: i,
          // the title, the dates and (with extra columns) the column titles stay in view
          gridProperties: { rowCount: rows.length + 5, columnCount: reportWidth(tab), frozenRowCount: showsColumnNames(tab) ? 3 : 2 },
        },
      },
    })),
    ...oldIds.map((sheetId) => ({ deleteSheet: { sheetId } })),
    ...parts.flatMap((part, i) => tabRequests(newIds[i], titles[i], part)),
  ];
}

/** Tab ids not already used by the spreadsheet. */
function freshIds(count, used, random) {
  const ids = [];
  while (ids.length < count) {
    const id = 1 + Math.floor(random() * 2_000_000_000);
    if (!used.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const jsonInit = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const quote = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function haveFrom(file) {
  const p = file.appProperties ?? {};
  return { id: file.id, key: p.reportKey, hash: p.hash, place: p.place ?? '', kind: p.reportKind, name: file.name, parentId: file.parents?.[0] ?? null };
}

/**
 * Report files of a year in Google Drive. `send(url, init)` = one Drive/Sheets call (exportDrive.js
 * `driveSender`). Returns { list, create, update, remove }.
 */
export function driveReports({ send, yearId, random = Math.random }) {
  const labels = (kind, want) => ({ [REPORT_LABEL]: yearId, reportKind: kind, reportKey: want.key, hash: want.hash, place: want.place ?? '' });

  /** Report files of one kind ('weekly' or 'manual'), optionally only those in a folder. */
  async function list(kind, { folderId = null } = {}) {
    const q = [`appProperties has { key='${REPORT_LABEL}' and value=${quote(yearId)} }`, `appProperties has { key='reportKind' and value=${quote(kind)} }`, 'trashed = false'];
    if (folderId) q.push(`${quote(folderId)} in parents`);
    const found = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: q.join(' and '), fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await (await send(`${DRIVE}?${params}`)).json();
      found.push(...(body.files ?? []));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return found.map(haveFrom);
  }

  /** Put the report's tabs into the spreadsheet. */
  async function write(fileId, tabs) {
    const id = encodeURIComponent(fileId);
    const info = await (await send(`${SHEETS_API}/${id}?fields=${encodeURIComponent('sheets.properties(sheetId)')}`)).json();
    const oldIds = (info.sheets ?? []).map((s) => s.properties.sheetId);
    const requests = sheetRequests(oldIds, tabs, freshIds(tabs.length, new Set(oldIds), random));
    try {
      await send(`${SHEETS_API}/${id}:batchUpdate`, jsonInit('POST', { requests }));
    } catch (err) {
      err.api = 'Google Sheets API';
      throw err;
    }
  }

  /** A new Google Sheet in folder `parentId`, filled in. */
  async function create(kind, want, parentId) {
    const meta = { name: want.name, mimeType: SHEETS, parents: [parentId], appProperties: { ...labels(kind, want), hash: 'new' } };
    const file = await (await send(`${DRIVE}?supportsAllDrives=true&fields=${FIELDS}`, jsonInit('POST', meta))).json();
    try {
      await write(file.id, want.tabs);
    } catch (err) {
      await remove(haveFrom(file)).catch(() => {}); // never leave an empty report behind
      throw err;
    }
    return relabel(file.id, { ...labels(kind, want), name: want.name });
  }

  async function relabel(fileId, { name, ...appProperties }, params = new URLSearchParams()) {
    params.set('supportsAllDrives', 'true');
    params.set('fields', FIELDS);
    const res = await send(`${DRIVE}/${encodeURIComponent(fileId)}?${params}`, jsonInit('PATCH', { name, appProperties }));
    return haveFrom(await res.json());
  }

  /** Rewrite a report that changed, and move or rename it when needed. */
  async function update(kind, have, want, parentId) {
    if (have.hash !== want.hash) await write(have.id, want.tabs);
    const params = new URLSearchParams();
    if (parentId && parentId !== have.parentId) {
      params.set('addParents', parentId);
      if (have.parentId) params.set('removeParents', have.parentId);
    }
    return relabel(have.id, { ...labels(kind, want), name: want.name }, params);
  }

  /** Put a report in Drive's trash (it can be brought back from there for 30 days). */
  async function remove(have) {
    try {
      await send(`${DRIVE}/${encodeURIComponent(have.id)}?supportsAllDrives=true&fields=id`, jsonInit('PATCH', { trashed: true }));
    } catch (err) {
      if (err.message !== 'not_found') throw err;
    }
  }

  return { list, create, update, remove };
}

/** The address that opens a report. */
export const reportUrl = (fileId) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`;
