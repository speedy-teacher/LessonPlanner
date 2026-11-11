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
import { chosen, defaultChoices, editRequests, fieldsUsed, placeholdersIn, scanFile, SCANNERS } from './scan.js';
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

// Slides: a picture becomes a picture spot even without a pictures folder (it just isn't saved anywhere).
// Docs keep their pictures in place, so there they're only offered for saving to the pictures folder.
const picturesWanted = (kind, setup) => KINDS[kind].pictures && (Boolean(setup.imageFolder) || !SCANNERS[kind].picturesStay);

/** A prepared file the teacher took out again: its draft goes to the trash. */
export async function dropFile(calls, prepared) {
  if (prepared?.draft) await calls.trashFile(prepared.draft.id);
}

/**
 * Make the template. `shared` = { pictures: Map } is passed to every file of one run (the same picture in
 * several files is saved once). Returns { lesson, images, failedPictures, link, changes, pictures, preview }.
 * The copy stays hidden from watched folders until the teacher keeps it (`keepTemplate`) or throws it away.
 */
export async function makeTemplate(calls, prepared, { setup, shared, step = () => {} }) {
  const { kind, source, draft } = prepared;
  const name = prepared.name.trim() || suggestName(source.name);
  step('Copying into your templates folder…');
  const folder = setup.templateFolder;
  const copy = await copyInto(calls, { source, draft, name, folder });
  step('Finding the numbers in the copy…');
  const before = await calls.readFile(kind, copy.id);
  const picked = chosen(scanFile(kind, before, { pictures: picturesWanted(kind, setup) }), prepared.choices);
  const saved = picked.pictures.length
    ? (step('Saving pictures…'), await savePictures(calls, { prepared, pictures: picked.pictures, setup, shared, name }))
    : { placed: [], images: [], failed: [] };
  step('Typing in the placeholders…');
  await calls.changeFile(kind, copy.id, editRequests(kind, picked, saved.placed));
  const after = await calls.readFile(kind, copy.id);
  checkChanged(kind, before, after, picked);
  const info = await calls.fileInfo(copy.id);
  return {
    lesson: { fileId: copy.id, mimeType: info.mimeType, modifiedTime: info.modifiedTime ?? null, name, ...folderOf(folder), fields: fieldsUsed(kind, picked, saved.placed) },
    images: saved.images, failedPictures: saved.failed, link: openUrl(copy.id, info.mimeType), changes: picked.matches.length,
    pictures: saved.placed.length, preview: kind === 'slides' ? after.slides?.[0]?.objectId ?? null : null,
  };
}

/** The template copy in the templates folder: a draft (Office file) is renamed — and moved, if the folder changed since. */
async function copyInto(calls, { source, draft, name, folder }) {
  if (!draft) return calls.copyFile(source.id, { name, folderId: folder.driveId, label: 'review' });
  const copy = await calls.renameFile(draft.id, { name, label: 'review' });
  const from = draft.parents?.[0];
  if (from && from !== folder.driveId) await calls.moveFile(copy.id, { from, to: folder.driveId });
  return copy;
}

/**
 * Where a template goes, as the planner needs it: its folder record (`folderId`), or — for a Drive folder the
 * teacher picked that isn't in the planner yet — that Drive folder (the folder record is made when it's added).
 */
export function folderOf(folder) {
  return { folderId: folder.isNew ? null : folder.id, folderDriveId: folder.driveId, folderName: folder.name };
}

/** Move a made template to another templates folder (the teacher changed it while looking). */
export async function moveTemplate(calls, made, folder) {
  if (made.lesson.folderDriveId === folder.driveId) return;
  await calls.moveFile(made.lesson.fileId, { from: made.lesson.folderDriveId, to: folder.driveId });
  Object.assign(made.lesson, folderOf(folder));
}

/** The copy must now hold a placeholder for every chosen number (else Google didn't take the change). */
function checkChanged(kind, before, after, picked) {
  const added = placeholdersIn(kind, after) - placeholdersIn(kind, before);
  if (added < picked.matches.length) throw new GoogleError('not_changed');
}

/** The template a teacher keeps: from now on it's a normal file in the templates folder. */
export function keepTemplate(calls, made) {
  return calls.renameFile(made.lesson.fileId, { name: made.lesson.name, label: 'template' });
}

/** A picture of the template's first slide (Slides only; null when Google can't draw it). */
export async function previewPicture(calls, made) {
  if (!made.preview) return null;
  try { return await calls.slideThumbnail(made.lesson.fileId, made.preview); } catch { return null; }
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
  if (!setup.imageFolder) return { ...out, placed: pictures };
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

const HOUR = 60 * 60 * 1000;
const LEFT_FOR = { draft: HOUR, review: 24 * HOUR };

/** Drafts left behind more than an hour ago, and templates nobody kept for a day (a tab closed halfway): to trash. */
export function staleDrafts(files, now = Date.now()) {
  return files.filter((f) => LEFT_FOR[f.appProperties?.templateMaker] && now - Date.parse(f.modifiedTime ?? 0) > LEFT_FOR[f.appProperties.templateMaker]);
}
