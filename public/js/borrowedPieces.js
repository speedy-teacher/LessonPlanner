// Colleagues' Teacher Resources shared with you, kept beside an open plan so their lesson templates can
// go on your Lesson Schedule (sharedLessons.js). They're only ever read: never saved, never combined.
//
// No browser APIs here: Google Drive and this computer's cache are handed in (like pieceEngine.js), so the
// Node tests can run it against fakes.
//
// Each borrowed file: { fileId, key, owner, rec (cache record, or null), why (null, or why it can't be had) }.

import { fromPieceFile } from './pieces.js';

const keyOf = (fileId) => `drive:${fileId}`;

/** Gone for good (not shared any more, removed): this computer's copy isn't used either. */
const LOST = ['no_access', 'not_found'];
const signature = (file) => JSON.stringify([file.why, file.rec?.rev ?? null]);
const usable = (file) => Boolean(file.rec) && !LOST.includes(file.why);

export class BorrowedResources {
  /** `drive` = { info(fileId), read(fileId), listShared?() } or null; `cache` = { get(key), put(record) }. */
  constructor({ drive = null, cache }) {
    Object.assign(this, { drive, cache });
    this.files = new Map();
    this.listed = []; // [{ fileId, name }] = Teacher Resources shared with you, as Google Drive last said
    this.version = 0; // goes up whenever the templates on offer change
  }

  /**
   * Which files to keep: everyone listed as sharing with you, plus files your schedule already uses
   * (`used` = file ids), never `ownFileIds` (your own Teacher Resources). Loads this computer's copies.
   */
  async want({ listed = this.listed, used = [], ownFileIds = [] } = {}) {
    this.listed = listed;
    const names = new Map(listed.map((p) => [p.fileId, p.name]));
    const ids = [...new Set([...listed.map((p) => p.fileId), ...used])].filter((id) => id && !ownFileIds.includes(id));
    for (const id of [...this.files.keys()].filter((known) => !ids.includes(known))) this.forget(id);
    for (const fileId of ids) await this.keep(fileId, names.get(fileId));
    return this;
  }

  forget(fileId) {
    this.files.delete(fileId);
    this.version += 1;
  }

  /** Start keeping a file (this computer's copy, if any), or just refresh its owner's name. */
  async keep(fileId, name) {
    const known = this.files.get(fileId);
    if (known) {
      known.owner = name || known.owner;
      return;
    }
    const rec = await this.cache.get(keyOf(fileId)).catch(() => null) ?? null;
    this.version += 1;
    this.files.set(fileId, { fileId, key: keyOf(fileId), owner: name || rec?.owner || '', rec, why: rec ? null : 'not_loaded' });
  }

  /** Ask Google Drive again who shares their Teacher Resources with you. Keeps the old list if it can't. */
  async relist() {
    if (!this.drive?.listShared) return this.listed;
    this.listed = await this.drive.listShared().catch(() => this.listed);
    return this.listed;
  }

  /** Bring every borrowed file up to date from Google Drive. Resolves to true when any templates changed. */
  async sync() {
    if (!this.drive) return false;
    const changed = await Promise.all([...this.files.values()].map((file) => this.syncOne(file)));
    return changed.some(Boolean);
  }

  async syncOne(file) {
    const was = signature(file);
    try {
      await this.refresh(file);
      file.why = null;
    } catch (err) {
      file.why = err?.message || 'offline';
    }
    const changed = signature(file) !== was;
    if (changed) this.version += 1;
    return changed;
  }

  async refresh(file) {
    const info = await this.drive.info(file.fileId);
    if (file.rec?.rev !== info.rev) await this.read(file);
    if (!file.owner) file.owner = info.owner ?? '';
  }

  async read(file) {
    const got = await this.drive.read(file.fileId);
    file.rec = {
      key: file.key, piece: 'resources', name: got.name, fileId: got.fileId ?? file.fileId, folderId: got.folderId ?? null, rev: got.rev,
      base: got.text, canEdit: false, changed: false, keptDay: null, savedAt: 0, owner: got.owner || file.owner || '',
      data: fromPieceFile(got.text, 'resources'),
    };
    await this.cache.put(file.rec);
  }

  /**
   * What composeState adds: [{ fileId, owner, lessons }]. While Google Drive can't be reached this
   * computer's copy is used; a file no longer shared with you (or removed) gives no templates.
   */
  list() {
    return [...this.files.values()].map((f) => ({ fileId: f.fileId, owner: f.owner || f.rec?.owner || '', lessons: usable(f) ? f.rec.data.lessons : null }));
  }

  /** { fileId: why } for borrowed files whose templates can't be had right now. */
  status() {
    return Object.fromEntries([...this.files.values()].filter((f) => !usable(f)).map((f) => [f.fileId, f.why ?? 'not_loaded']));
  }
}
