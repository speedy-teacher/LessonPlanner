// "Images": the pictures lesson copies can show (e.g. bitmojis). Left: folders and pictures (the same
// tree as Lesson Templates); middle: a gallery of every picture, by folder; right: the chosen picture's
// tags and when it fits (imageDetails.js). Pictures come from Google Drive; only their details are saved.

import { h, toast } from '../dom.js';
import { find } from '../model.js';
import { decksIn, folderPath, foldersIn, IMAGE_SHELF } from '../library.js';
import { setUi, store } from '../store.js';
import { deckThumbnail, onThumbnail, requestThumbnail, thumbnailFailed } from '../thumbnails.js';
import { driveFileId } from '../locations.js';
import { checkSharing, clearRefused, shareRefused } from '../imageSharing.js';
import { pickPicturesFromDrive } from '../drive.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { google } from '../google.js';
import { recheckCopies } from '../exportBridge.js';
import { current, emptyNote, menuItem, popMenu, year } from './common.js';
import { folderTree, newMark, newTreeFolder, openTreeFolders, treeTarget, visibleItems } from './folderTree.js';
import { importFromDrive, setImageKind } from './deckImport.js';
import { whenVisible } from './lessonPreview.js';
import { imageDetails } from './imageDetails.js';

const UNSHARED_TIP = 'Google didn’t let the planner share this picture for a moment to place it. Share it with “Anyone with the link” in Google Drive.';

function searchWords() {
  return (store.ui.imageSearch || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Search looks at the picture's name, description, tags and folders. */
function matches(image, words) {
  const tags = image.tagIds.map((id) => find(store.state, 'tags', id)?.name ?? '').join(' ');
  const folders = folderPath(store.state, image.folderId, IMAGE_SHELF).map((f) => f.name).join(' ');
  const text = `${image.name} ${image.description} ${tags} ${folders}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

function shownImages() {
  const words = searchWords();
  return current('images').filter((i) => !words.length || matches(i, words));
}

function unsharedMark(image) {
  return shareRefused(image) ? h('span', { class: 'share-warn', 'data-tip': UNSHARED_TIP, 'aria-label': UNSHARED_TIP }, '⚠') : null;
}

const IMAGES = {
  shelf: IMAGE_SHELF,
  keys: { item: 'imageId', folder: 'imageFolderId', open: 'openImageFolderIds' },
  noun: 'picture', icon: '🌄', folderHint: 'e.g. Holidays',
  shown: shownImages,
  filtering: () => searchWords().length > 0,
  extra: unsharedMark,
  emptyText: 'No pictures yet. Use “+ Add” above to bring them in from Google Drive.',
  noMatchText: 'No pictures match your search.',
  onPick: (image) => showInGallery(image.id),
};

const selectImage = (image) => setUi({ imageId: image.id, imageFolderId: image.folderId, imageSearch: '' });
const IMAGE_KIND = setImageKind({ target: () => treeTarget(IMAGES), open: (ids) => openTreeFolders(IMAGES, ids), select: selectImage });

function selectedImage() {
  const image = find(store.state, 'images', store.ui.imageId);
  return image && image.yearId === year().id ? image : visibleItems(IMAGES)[0] ?? shownImages()[0] ?? null;
}

export function renderImages() {
  const images = current('images');
  checkSharing(images);
  const selected = selectedImage();
  return h('div', { class: 'images-layout' },
    h('aside', { class: 'side card deck-side' },
      h('div', { class: 'deck-side-head' },
        h('h3', {}, 'Images', h('span', { class: 'count-badge' }, images.length)),
        addMenu()),
      h('input', {
        class: 'search', type: 'search', placeholder: '🔍 Search pictures or tags…', value: store.ui.imageSearch || '',
        dataset: { key: 'image-search' }, oninput: (e) => setUi({ imageSearch: e.target.value }),
      }),
      sharingSummary(images),
      folderTree(IMAGES, selected)),
    h('section', { class: 'main-col card image-gallery', 'data-tour': 'image-gallery' }, gallery(selected)),
    h('aside', { class: 'card image-side', 'data-tour': 'image-details', dataset: { scrollKey: selected?.id ?? '' } }, selected ? imageDetails(selected) : emptyNote('Pick a picture to tag it.')));
}

function addMenu() {
  const target = treeTarget(IMAGES);
  return popMenu({ label: '+ Add ▾', title: 'Add pictures', summaryClass: 'btn small', menuClass: 'add-menu', tour: 'image-add' },
    h('p', { class: 'menu-note' }, 'Adds to: ', h('strong', {}, target ? `📁 ${target.name}` : 'the top level')),
    menuItem('New folder', () => newTreeFolder(IMAGES, target?.id ?? null), { icon: '📁' }),
    h('div', { class: 'menu-group' }, 'From Google Drive'),
    menuItem('Pictures or folders…', () => importFromDrive(IMAGE_KIND), {
      icon: '☁️', tip: 'Folders inside folders come too, and folders are watched: new pictures added there show up here',
    }));
}

/** "2 pictures couldn't be placed…" above the tree, when Google refused to let the planner share some. */
function sharingSummary(images) {
  const refused = images.filter(shareRefused);
  if (!refused.length) return null;
  return h('div', { class: 'share-summary' },
    h('span', {}, `⚠ ${refused.length} ${refused.length === 1 ? 'picture' : 'pictures'} couldn’t be placed in lesson copies yet: the planner needs your permission to share ${refused.length === 1 ? 'it' : 'them'} for a moment.`),
    h('button', { class: 'btn small', onclick: () => allowPictures(refused[0]) }, 'Let the planner share pictures…'));
}

/**
 * Open Google's picker in the picture's folder so you can select the pictures: that gives the planner
 * permission to share them for a moment while placing them. Then the copies try again.
 */
export async function allowPictures(image) {
  const folder = find(store.state, 'imageFolders', image.folderId);
  const picked = await pickPicturesFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() }, { parentId: driveFileId(folder) }).catch(() => []);
  if (!picked.length) return;
  clearRefused(picked.map((p) => p.id));
  recheckCopies();
  toast(`Thanks — the planner can place ${picked.length === 1 ? 'that picture' : `those ${picked.length} pictures`} now. The lesson copies are being updated.`);
}

// ---------- the gallery ----------

/** Every shown picture, grouped by folder in tree order. */
function galleryGroups() {
  const shown = new Set(shownImages());
  const groups = [];
  const walk = (folderId, names) => {
    const images = decksIn(store.state, year().id, folderId, IMAGE_SHELF).filter((i) => shown.has(i));
    if (images.length) groups.push({ label: names.length ? names.join(' › ') : 'Not in a folder', folderId, images });
    foldersIn(store.state, year().id, folderId, IMAGE_SHELF).forEach((f) => walk(f.id, [...names, f.name]));
  };
  walk(null, []);
  return groups;
}

function gallery(selected) {
  const groups = galleryGroups();
  if (!groups.length) return emptyNote(current('images').length ? 'No pictures match your search.' : 'Pictures you add show up here.');
  return groups.map((g) => h('div', { class: 'gallery-group' },
    h('h4', { class: 'group-head' }, `📁 ${g.label}`, h('span', { class: 'count-badge' }, g.images.length)),
    h('div', { class: 'gallery-grid' }, g.images.map((image) => galleryCard(image, image.id === selected?.id)))));
}

function galleryCard(image, isSelected) {
  return h('button', {
    class: `gallery-card ${isSelected ? 'selected' : ''}`, dataset: { imageCard: image.id },
    title: image.description || image.name,
    onclick: () => setUi({ imageId: image.id, imageFolderId: image.folderId }),
  },
  imageThumb(image),
  h('span', { class: 'gallery-name' }, image.isNew ? newMark('Newly added from Google Drive') : null, image.name, unsharedMark(image)));
}

/** Scroll the gallery to a picture and make it glow for a moment. */
function showInGallery(imageId) {
  const card = document.querySelector(`[data-image-card="${CSS.escape(imageId)}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1200);
}

/** The picture itself (Google Drive's preview of it), loaded when it scrolls into view. */
export function imageThumb(image) {
  const thumb = deckThumbnail(image);
  const el = thumb.status === 'ready'
    ? h('span', { class: 'gallery-thumb' }, h('img', { src: thumb.url, alt: image.description || image.name, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: () => thumbnailFailed(image) }))
    : h('span', { class: 'gallery-thumb empty', 'data-tip': thumb.reason ?? null }, thumb.status === 'none' ? 'No preview' : '…');
  const fileId = driveFileId(image);
  if (fileId) el.dataset.imageFile = fileId;
  if (thumb.status === 'waiting') whenVisible(el, () => requestThumbnail(image));
  return el;
}

// When a picture's preview arrives, update just its own spots.
onThumbnail((fileId) => {
  for (const el of document.querySelectorAll(`[data-image-file="${CSS.escape(fileId)}"]`)) {
    const image = store.state?.images.find((i) => driveFileId(i) === fileId);
    if (image) el.replaceWith(imageThumb(image));
  }
});

/** ↑ ↓ move through the pictures in the tree. */
export function imageKeys(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const list = visibleItems(IMAGES);
  const i = list.findIndex((x) => x.id === selectedImage()?.id);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) { setUi({ imageId: next.id, imageFolderId: next.folderId }); showInGallery(next.id); }
  return true;
}
