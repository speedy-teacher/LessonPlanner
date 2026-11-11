// Google Sheets: finding lesson/week numbers in typed-in cells (every sheet; formulas are left alone), and
// the edits that type the placeholders in (the cell's value is rewritten; its formatting stays).
//
// Pure logic, shared by the browser and the Node tests.

import { applyMatches, findNumbers } from './numberMatch.js';

/** What to ask the Sheets API for (every sheet's typed-in cell values). */
export const SHEETS_FIELDS = 'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue))))';

/** Every typed-in text cell: [{ sheetId, title, rowIndex, columnIndex, text }]. */
export function sheetCells(spreadsheet) {
  const out = [];
  for (const sheet of spreadsheet.sheets ?? []) {
    for (const block of sheet.data ?? []) {
      (block.rowData ?? []).forEach((row, r) => {
        (row.values ?? []).forEach((cell, c) => {
          const text = cell.userEnteredValue?.stringValue;
          if (typeof text !== 'string') return;
          const rowIndex = (block.startRow ?? 0) + r;
          const columnIndex = (block.startColumn ?? 0) + c;
          out.push({ sheetId: sheet.properties?.sheetId ?? 0, title: sheet.properties?.title ?? 'Sheet', rowIndex, columnIndex, text });
        });
      });
    }
  }
  return out;
}

/** "A1"-style name of a cell (column 27 → "AB"). */
export function cellName(rowIndex, columnIndex) {
  let name = '';
  for (let n = columnIndex + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return `${name}${rowIndex + 1}`;
}

/** The lesson/week numbers: [{ key, where, …match, target }]. */
export function sheetsMatches(spreadsheet) {
  return sheetCells(spreadsheet).flatMap((cell) => findNumbers(cell.text).map((m, i) => ({
    ...m, key: `${cell.sheetId}|${cell.rowIndex}:${cell.columnIndex}|${i}`, where: `${cell.title} ${cellName(cell.rowIndex, cell.columnIndex)}`,
    target: { sheetId: cell.sheetId, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex, text: cell.text },
  })));
}

/** The Sheets edits for these matches: one per cell, its text with every chosen match replaced. */
export function sheetsTextRequests(matches) {
  const cells = new Map();
  for (const m of matches) {
    const id = `${m.target.sheetId}|${m.target.rowIndex}|${m.target.columnIndex}`;
    cells.set(id, [...(cells.get(id) ?? []), m]);
  }
  return [...cells.values()].map((list) => {
    const { sheetId, rowIndex, columnIndex, text } = list[0].target;
    return {
      updateCells: {
        start: { sheetId, rowIndex, columnIndex }, fields: 'userEnteredValue',
        rows: [{ values: [{ userEnteredValue: { stringValue: applyMatches(text, list) } }] }],
      },
    };
  });
}
