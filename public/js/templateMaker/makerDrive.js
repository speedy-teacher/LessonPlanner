// The Google calls the Template Maker window makes: Drive (files, folders, copies, pictures)
// and reading/changing Slides, Docs and Sheets. Everything goes through googleApi.js `client`.
// Files Template Maker makes carry the label `templateMaker` (draft | template | picture), so half-made
// drafts can be tidied away and saved pictures found again (by `tmHash`, a fingerprint of the picture).
//
// Works with any fetch (the browser's, or a fake Google Drive in the tests).

import { jsonBody } from './googleApi.js';
import { FOLDER_MIME, KINDS } from './fileKinds.js';
import { SHEETS_FIELDS } from './scanSheets.js';

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const ALL = 'supportsAllDrives=true';
export const LABEL = 'templateMaker';
export const HASH_LABEL = 'tmHash';
const DRAFT = 'template-maker-draft';
// Lesson Planner's own Drive label: a file carrying it is never brought in from a watched folder (library.js).
const PIECE_LABEL = 'lessonPlanner';
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,headRevisionId,trashed,ownedByMe,capabilities(canEdit,canAddChildren),owners(displayName),appProperties';

const q = (text) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const id = encodeURIComponent;

/** `client` = googleApi.js googleClient. Returns the calls. */
export function driveCalls(client) {
  const { json, send } = client;
  const list = async (query) => {
    const params = new URLSearchParams({ q: `${query} and trashed = false`, fields: `files(${FILE_FIELDS})`, orderBy: 'modifiedTime desc', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    return (await json(`${DRIVE}?${params}`)).files ?? [];
  };

  return {
    fileInfo: (fileId) => json(`${DRIVE}/${id(fileId)}?fields=${FILE_FIELDS}&${ALL}`),
    /** Copy a file into a folder; giving a Google `mimeType` turns a Word/Excel/PowerPoint file into Google's kind. */
    // A draft also carries Lesson Planner's own label, which tells Lesson Planner not to bring it in from a watched folder.
    copyFile: (fileId, { name, folderId, mimeType = null, label }) => json(`${DRIVE}/${id(fileId)}/copy?fields=${FILE_FIELDS}&${ALL}`, jsonBody('POST', {
      name, parents: [folderId], ...(mimeType ? { mimeType } : {}), appProperties: { [LABEL]: label },
      ...(label === 'template' ? {} : { properties: { [PIECE_LABEL]: DRAFT } }),
    })),
    // Until the teacher keeps it ('template'), a copy keeps the planner's label, so watched folders skip it.
    renameFile: (fileId, { name, label }) => json(`${DRIVE}/${id(fileId)}?fields=${FILE_FIELDS}&${ALL}`, jsonBody('PATCH', {
      name, appProperties: { [LABEL]: label }, properties: { [PIECE_LABEL]: label === 'template' ? null : DRAFT },
    })),
    /** Move a file from one folder to another. */
    moveFile: (fileId, { from, to }) => json(`${DRIVE}/${id(fileId)}?addParents=${id(to)}&removeParents=${id(from)}&fields=${FILE_FIELDS}&${ALL}`, jsonBody('PATCH', {})),
    trashFile: (fileId) => json(`${DRIVE}/${id(fileId)}?fields=id&${ALL}`, jsonBody('PATCH', { trashed: true })),
    /** Half-made drafts this tool left behind (a closed tab), to tidy away. */
    listDrafts: async () => [
      ...await list(`appProperties has { key='${LABEL}' and value='draft' }`),
      ...await list(`appProperties has { key='${LABEL}' and value='review' }`),
    ],
    /** A picture of one slide, drawn by Google now (Drive's own thumbnails can be minutes behind). */
    slideThumbnail: async (fileId, pageId) => (await json(`https://slides.googleapis.com/v1/presentations/${id(fileId)}/pages/${id(pageId)}/thumbnail?thumbnailProperties.thumbnailSize=MEDIUM`)).contentUrl ?? null,
    /** A picture saved before with the same fingerprint, in that folder. */
    findPicture: async (folderId, hash) => (await list(`appProperties has { key='${HASH_LABEL}' and value='${q(hash)}' } and '${q(folderId)}' in parents`))[0] ?? null,
    exportFile: async (fileId, mimeType) => new Uint8Array(await (await send(`${DRIVE}/${id(fileId)}/export?mimeType=${id(mimeType)}`)).arrayBuffer()),
    download: async (fileId) => new Uint8Array(await (await send(`${DRIVE}/${id(fileId)}?alt=media&${ALL}`)).arrayBuffer()),
    uploadPicture: ({ name, mimeType, bytes, folderId, hash }) => uploadPicture(json, { name, mimeType, bytes, folderId, hash }),
    readFile: (kind, fileId) => json(READ[kind](id(fileId))),
    changeFile: (kind, fileId, requests) => (requests.length ? json(WRITE[kind](id(fileId)), jsonBody('POST', { requests })) : null),
    isFolder: (file) => file?.mimeType === FOLDER_MIME,
  };
}

const READ = {
  slides: (fileId) => `https://slides.googleapis.com/v1/presentations/${fileId}`,
  docs: (fileId) => `https://docs.googleapis.com/v1/documents/${fileId}`,
  sheets: (fileId) => `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?includeGridData=true&fields=${id(SHEETS_FIELDS)}`,
};
const WRITE = {
  slides: (fileId) => `https://slides.googleapis.com/v1/presentations/${fileId}:batchUpdate`,
  docs: (fileId) => `https://docs.googleapis.com/v1/documents/${fileId}:batchUpdate`,
  sheets: (fileId) => `https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`,
};

function uploadPicture(json, { name, mimeType, bytes, folderId, hash }) {
  const boundary = `templateMaker${Date.now()}`;
  const meta = { name, mimeType, parents: [folderId], appProperties: { [LABEL]: 'picture', [HASH_LABEL]: hash } };
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const body = new Blob([head, bytes, `\r\n--${boundary}--\r\n`]);
  return json(`${UPLOAD}?uploadType=multipart&fields=${FILE_FIELDS}&${ALL}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
}

/** The Office kind a Google file is exported as, to get its pictures out (officePackage.js). */
export const officeTypeOf = (kind) => KINDS[kind].office;
