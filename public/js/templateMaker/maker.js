// Making the templates, one file at a time (several files at once, see googleApi.js runPool):
//   prepare — read the file (a Word/Excel/PowerPoint file is first copied into the templates folder as
//             Google's kind of file, a "draft"), find its lesson/week numbers and first-page pictures
//   make    — copy it into the templates folder (a draft is simply renamed), type the chosen placeholders in,
//             save the chosen pictures to the pictures folder (Slides: swapped for picture spots)
//   (then session.js adds every template and picture to the open plan — addToPlan.js).
// The teacher's original files are never changed.
//
// Works with driveCalls (drive.js) on the real Google Drive or the fake one in the tests.

import { isGoogleFile, KINDS, kindOf, openUrl } from './fileKinds.js';
import { GoogleError } from './googleApi.js';
import { documentPictures, matchPictures, pictureFile, slidePictures, zipEntries } from './officePackage.js';
import { chosen, defaultChoices, editRequests, fieldsUsed, scanFile } from './scan.js';
import { suggestName } from './templateName.js';

/** Read a picked file: { source, kind, draft, name, scan, choices }. `step(text)` tells how it's going. */
export async function prepareFile(calls, source, { setup, step = () => {} }) {
  const kind = kindOf(source.mimeType);
  if (!kind) throw new GoogleError('not_supported');
  const name = suggestName(source.name);
  let draft = null;
  if (!isGoogleFile(source.mimeType)) {
    step(`Turning it into ${KINDS[kind].label}…`);
    draft = await calls.copyFile(source.id, { name, folderId: setup.templateFolder.driveId, mimeType: KINDS[kind].google, label: 'draft' });
  }
  step('Reading…');
  const scan = scanFile(kind, await calls.readFile(kind, (draft ?? source).id), { pictures: picturesWanted(kind, setup) });
  return { source, kind, draft, name, scan, choices: defaultChoices(scan) };
}

const picturesWanted = (kind, setup) => Boolean(setup.imageFolder) && KINDS[kind].pictures;

/** A prepared file the teacher took out again: its draft goes to the trash. */
export async function dropFile(calls, prepared) {
  if (prepared?.draft) await calls.trashFile(prepared.draft.id);
}

/**
 * Make the template. `shared` = { pictures: Map } is passed to every file of one run (the same picture in
 * several files is saved once). Returns { lesson, images, failedPictures, link }.
 */
export async function makeTemplate(calls, prepared, { setup, shared, step = () => {} }) {
  const { kind, source, draft } = prepared;
  const name = prepared.name.trim() || suggestName(source.name);
  step('Copying into your templates folder…');
  const copy = draft
    ? await calls.renameFile(draft.id, { name, label: 'template' })
    : await calls.copyFile(source.id, { name, folderId: setup.templateFolder.driveId, label: 'template' });
  step('Finding the numbers in the copy…');
  const picked = chosen(scanFile(kind, await calls.readFile(kind, copy.id), { pictures: picturesWanted(kind, setup) }), prepared.choices);
  const saved = picked.pictures.length
    ? (step('Saving pictures…'), await savePictures(calls, { prepared, pictures: picked.pictures, setup, shared, name }))
    : { placed: [], images: [], failed: [] };
  step('Typing in the placeholders…');
  await calls.changeFile(kind, copy.id, editRequests(kind, picked, saved.placed));
  const info = await calls.fileInfo(copy.id);
  return {
    lesson: { fileId: copy.id, mimeType: info.mimeType, modifiedTime: info.modifiedTime ?? null, name, folderId: setup.templateFolder.id, fields: fieldsUsed(kind, picked, saved.placed) },
    images: saved.images, failedPictures: saved.failed, link: openUrl(copy.id, info.mimeType), changes: picked.matches.length,
  };
}

/** The file as a PowerPoint/Word zip (Google's files are exported; Office files are already one). */
async function packageOf(calls, { source, kind }) {
  const bytes = isGoogleFile(source.mimeType) ? await calls.exportFile(source.id, KINDS[kind].office) : await calls.download(source.id);
  return zipEntries(bytes);
}

/** The zip, or null when Google couldn't make one (then the pictures can't be saved; the template still can). */
async function packageOrNull(calls, prepared) {
  try {
    return await packageOf(calls, prepared);
  } catch (err) {
    if (err instanceof GoogleError && err.message !== 'failed') throw err;
    return null;
  }
}

async function savePictures(calls, { prepared, pictures, setup, shared, name }) {
  const out = { placed: [], images: [], failed: [] };
  const zip = await packageOrNull(calls, prepared);
  if (!zip) return { ...out, failed: pictures.map((p) => ({ key: p.key, why: 'unreadable' })) };
  const found = prepared.kind === 'slides' ? await slidePictures(zip) : await documentPictures(zip);
  const pairs = matchPictures(pictures, found);
  for (const [i, picture] of pictures.entries()) {
    const file = pairs.has(picture.key) ? await pictureFile(zip, pairs.get(picture.key)) : null;
    if (!file) { out.failed.push({ key: picture.key, why: pairs.has(picture.key) ? 'kind' : 'not_found' }); continue; }
    const drive = await savedPicture(calls, { file, title: pictureTitle(picture, i, pictures.length, name), folder: setup.imageFolder, shared });
    out.placed.push(picture);
    out.images.push({ fileId: drive.id, mimeType: drive.mimeType, modifiedTime: drive.modifiedTime ?? null, name: drive.name.replace(/\.[a-z0-9]{2,5}$/i, ''), folderId: setup.imageFolder.id });
  }
  return out;
}

/** The picture's alt text, else "Rhythm Tree picture" (numbered when a file has several). */
const pictureTitle = (picture, i, count, name) => picture.title || (count > 1 ? `${name} picture ${i + 1}` : `${name} picture`);

/** The picture's Drive file: one saved before with the same fingerprint, or a new upload. */
function savedPicture(calls, { file, title, folder, shared }) {
  return fingerprint(file.bytes).then((hash) => {
    if (!shared.pictures.has(hash)) {
      shared.pictures.set(hash, (async () => await calls.findPicture(folder.driveId, hash)
        ?? calls.uploadPicture({ name: `${title}.${file.extension}`, mimeType: file.mimeType, bytes: file.bytes, folderId: folder.driveId, hash }))());
    }
    return shared.pictures.get(hash);
  });
}

/** A short fingerprint of a picture's bytes (the same picture always gets the same one). */
export async function fingerprint(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

/** Drafts left behind more than an hour ago (a tab closed halfway): to trash. */
export function staleDrafts(files, now = Date.now()) {
  return files.filter((f) => f.appProperties?.templateMaker === 'draft' && now - Date.parse(f.modifiedTime ?? 0) > 60 * 60 * 1000);
}
