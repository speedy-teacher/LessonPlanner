// An open plan made of piece files (pieces.js): the teacher's Teacher Schedule, and the School Year and
// Teacher Resources it points at. Each piece is kept on this computer and, for Drive plans, in its own
// Drive file — saved, checked and combined on its own (planMerge.js `mergePiece`), so one piece's
// trouble never holds up another.
//
// A piece that can't be had (not shared with you, deleted, not on this computer yet while offline) is
// simply missing: the plan shows without it, and it heals in as soon as it can be loaded.
//
// No browser APIs here: Google Drive and this computer's cache are handed in, so the Node tests can
// run it against fakes. workspace.js connects it to the real ones.
//
// Piece record (kept on this computer): { key, piece, name, fileId, folderId, rev, base, changed,
//   keptDay, canEdit, savedAt, data }. `data` = the piece (pieces.js), `base` = its file text at `rev`.

import {
  changedPieces, composeState, emptyPiece, fromPieceFile, keepViewOnly, PIECE_NAMES, PIECES, pieceOf, splitState, toPieceFile,
} from './pieces.js';
import { mergePiece } from './planMerge.js';
import { shouldKeepRevision, syncAction } from './workspaceFile.js';

export const driveKey = (fileId) => `drive:${fileId}`;

/** Why a piece isn't there: 'not_linked' · 'not_loaded' (not on this computer yet) · 'no_access' · 'not_found' · 'offline'. */
export const MISSING_WORDS = {
  not_linked: 'This plan isn’t connected to one yet.',
  not_loaded: 'Not loaded yet — connect Google Drive to load it.',
  no_access: 'Not shared with you.',
  not_found: 'The file was removed from Google Drive.',
  offline: 'Can’t reach Google Drive right now.',
  signed_out: 'Sign in to Google Drive to load it.',
};

export class PiecePlan {
  /**
   * `drive` = { info(fileId), read(fileId), save(fileId, text), keep(fileId, rev) } (or null: this computer
   * only); `cache` = { get(key), put(record) }; `today()` → 'YYYY-MM-DD'.
   */
  constructor({ drive = null, cache, today = () => new Date().toISOString().slice(0, 10) }) {
    Object.assign(this, { drive, cache, today });
    this.recs = { schoolYear: null, schedule: null, resources: null };
    this.missing = {};
    this.stale = {}; // pieces whose newest version couldn't be loaded (shown from this computer's copy)
    this.own = null; // your own schedule + resources, kept aside while looking at a teammate's
    this.viewing = null; // { schedule, resources }: { name, fileId } of whose piece is shown (null = yours)
    this.chosen = {}; // { resources: { key, fileId } } when a Teacher Resources was picked on its own
  }

  /** Open from the Teacher Schedule's record; the other pieces come from this computer's copies. */
  async load(scheduleRec) {
    this.recs.schedule = scheduleRec;
    for (const name of ['schoolYear', 'resources']) {
      const link = this.link(name);
      this.recs[name] = link ? await this.cache.get(link.key).catch(() => null) ?? null : null;
      this.setMissing(name, link ? (this.recs[name] ? null : 'not_loaded') : 'not_linked');
    }
    return this;
  }

  link(name) {
    // Looking at someone else keeps your own School Year (you share it); the Teacher Resources shown follow
    // the shown Teacher Schedule's link, unless one was chosen on its own.
    if (name === 'resources' && this.chosen.resources) return this.chosen.resources;
    const schedule = name === 'schoolYear' && this.own ? this.own.schedule : this.recs.schedule;
    return schedule?.data.meta.links?.[name] ?? null;
  }

  /** Every write of a piece's record goes through here, so your own pieces set aside stay current too. */
  put(name, rec) {
    this.recs[name] = rec;
    if (this.own?.[name]?.key === rec.key) this.own[name] = rec;
    return rec;
  }

  // ---------- looking at someone else's pieces ----------

  /**
   * Show other people's Teacher Schedule and/or Teacher Resources with your shared School Year. Your own
   * pieces are kept aside (and kept current) until `viewMine()`.
   *   schedule: a teammate's Teacher Schedule record, or null = your own.
   *   resources: 'linked' = the Resources the shown schedule links to · a record (or { key, fileId } not
   *     on this computer yet) = that one · null = your own.
   *   who = { schedule?, resources? }, each { name, fileId } of the person whose piece is shown.
   */
  async view(options, who = {}) {
    const { schedule, resources } = wantedPieces(options);
    if (!schedule && !resources) return this.viewMine();
    this.own ??= { schedule: this.recs.schedule, resources: this.recs.resources, missing: this.missing.resources };
    this.recs.schedule = schedule ?? this.own.schedule;
    await this.showResources(resources);
    this.viewing = viewingOf({ schedule, resources }, who);
    return this;
  }

  async showResources(wanted) {
    this.chosen = {};
    if (wanted === null) {
      this.recs.resources = this.own.resources;
      this.setMissing('resources', this.own.missing ?? null);
      return;
    }
    if (wanted !== 'linked') this.chosen.resources = { key: wanted.key, fileId: wanted.fileId };
    const link = this.link('resources');
    const loaded = wanted.data ? wanted : link ? await this.cache.get(link.key).catch(() => null) ?? null : null;
    this.recs.resources = loaded;
    this.setMissing('resources', link ? (loaded ? null : 'not_loaded') : 'not_linked');
  }

  /** Back to your own Teacher Schedule and Teacher Resources. */
  viewMine() {
    if (!this.own) return this;
    this.recs.schedule = this.own.schedule;
    this.recs.resources = this.own.resources;
    this.setMissing('resources', this.own.missing ?? null);
    this.own = null;
    this.viewing = null;
    this.chosen = {};
    return this;
  }

  /** Your own pieces' data (also while looking at someone else's): what your lesson copies and reports come from. */
  myDatas() {
    const datas = this.datas();
    return this.own ? { ...datas, schedule: this.own.schedule.data, resources: this.own.resources?.data ?? null } : datas;
  }

  myState() {
    return composeState(this.myDatas());
  }

  setMissing(name, why) {
    if (why) this.missing[name] = why;
    else delete this.missing[name];
  }

  datas() {
    return Object.fromEntries(PIECE_NAMES.map((name) => [name, this.recs[name]?.data ?? null]));
  }

  /** The combined data the app works on. */
  state() {
    return composeState(this.datas());
  }

  /** 'edit' · 'view' (shared as Viewer) · 'none' (missing). */
  access(name) {
    const rec = this.recs[name];
    if (!rec) return 'none';
    return rec.canEdit === false ? 'view' : 'edit';
  }

  readOnly() {
    return PIECE_NAMES.filter((name) => this.access(name) !== 'edit');
  }

  /** A change, minus anything it did to pieces that can't be changed. See pieces.js keepViewOnly. */
  guard(before, after) {
    const readOnly = this.readOnly();
    if (!readOnly.length) return { state: after, blocked: [] };
    return keepViewOnly(before, after, readOnly, this.datas());
  }

  /** Keep the combined data's changes on this computer. Returns the names of the pieces that changed. */
  async save(state, now = Date.now()) {
    const before = this.filled();
    const after = splitState(state, before);
    const changed = changedPieces(before, after).filter((name) => this.access(name) === 'edit');
    for (const name of changed) {
      const rec = this.put(name, { ...this.recs[name], data: after[name], changed: Boolean(this.recs[name].fileId), savedAt: now });
      await this.cache.put(rec);
    }
    return changed;
  }

  /** Every piece, with an empty one standing in for a missing piece. */
  filled() {
    return Object.fromEntries(PIECE_NAMES.map((name) => [name, this.recs[name]?.data ?? emptyPiece(name)]));
  }

  /** Pieces with changes Google Drive doesn't have yet. */
  unsaved() {
    return PIECE_NAMES.filter((name) => this.recs[name]?.changed);
  }

  // ---------- Google Drive ----------

  /**
   * Bring every piece up to date with Google Drive, each on its own. Returns one result per piece
   * that has (or should have) a Drive file: { name, action, conflicts?, theirs?, error? }.
   */
  async syncAll() {
    if (!this.drive) return [];
    const names = PIECE_NAMES.filter((name) => this.recs[name]?.fileId || this.link(name)?.fileId);
    const results = await Promise.all(names.map((name) => this.syncPiece(name).catch((err) => this.trouble(name, err))));
    return results;
  }

  async syncPiece(name) {
    const rec = this.recs[name];
    if (!rec) return this.fetch(name);
    const info = await this.drive.info(rec.fileId);
    this.put(name, { ...rec, canEdit: info.canEdit, name: info.name, folderId: info.folderId });
    delete this.stale[name];
    const action = syncAction({ localChanges: rec.changed && info.canEdit, knownRev: rec.rev, remoteRev: info.rev });
    if (action === 'upload') await this.upload(name);
    if (action === 'download') await this.download(name);
    if (action === 'conflict') return { name, action, ...(await this.combine(name)) };
    return { name, action };
  }

  /** A linked piece this computer doesn't have yet: load it from Drive. */
  async fetch(name) {
    const link = this.link(name);
    const file = await this.drive.read(link.fileId);
    this.put(name, {
      key: driveKey(file.fileId), piece: name, name: file.name, fileId: file.fileId, folderId: file.folderId, rev: file.rev,
      base: file.text, canEdit: file.canEdit, changed: false, keptDay: null, savedAt: 0, data: fromPieceFile(file.text, name),
    });
    this.setMissing(name, null);
    await this.cache.put(this.recs[name]);
    return { name, action: 'download' };
  }

  async upload(name) {
    const rec = this.recs[name];
    const text = toPieceFile(rec.data);
    const rev = await this.drive.save(rec.fileId, text);
    // Changes made while sending stay marked as not yet in Drive.
    const latest = this.recs[name];
    const next = this.put(name, { ...latest, rev, base: text, changed: latest.data !== rec.data });
    if (rev && shouldKeepRevision(rec.keptDay, this.today())) {
      await this.drive.keep(rec.fileId, rev).then(() => { next.keptDay = this.today(); }, () => {});
    }
    await this.cache.put(next);
  }

  async download(name) {
    const file = await this.drive.read(this.recs[name].fileId);
    const rec = this.put(name, { ...this.recs[name], name: file.name, rev: file.rev, base: file.text, canEdit: file.canEdit, changed: false, data: fromPieceFile(file.text, name) });
    await this.cache.put(rec);
  }

  /**
   * Both this computer and Drive changed the piece: combine them and save the result. Returns
   * { conflicts, theirs } — `theirs` = the combined data with the other version of this piece.
   */
  async combine(name) {
    const rec = this.recs[name];
    const file = await this.drive.read(rec.fileId);
    const other = fromPieceFile(file.text, name);
    // Without a known starting point, nothing counts as deleted: both sides' records are kept.
    const base = rec.base ? fromPieceFile(rec.base, name) : emptyPiece(name);
    const { state, conflicts } = mergePiece(PIECES[name].collections, base, rec.data, other);
    this.put(name, { ...rec, name: file.name, rev: file.rev, base: file.text, canEdit: file.canEdit, changed: true, data: state });
    await this.cache.put(this.recs[name]);
    await this.upload(name);
    return { conflicts, theirs: composeState({ ...this.datas(), [name]: other }) };
  }

  /** A piece that couldn't be checked: a copy on this computer is still shown (marked not up to date). */
  trouble(name, err) {
    const why = err?.message || 'offline';
    if (this.recs[name]) {
      this.stale[name] = why;
      if (why === 'no_access' || why === 'not_found') this.put(name, { ...this.recs[name], canEdit: false });
    } else {
      this.setMissing(name, why);
    }
    return { name, action: 'none', error: why };
  }
}

/** `view`'s options with the defaults filled in: no schedule = yours; Resources default to the shown schedule's own. */
function wantedPieces({ schedule = null, resources = 'linked' }) {
  return { schedule, resources: resources === 'linked' && !schedule ? null : resources };
}

/** Whose pieces are shown: { schedule, resources } = { name, fileId } of the person, or null for yours. */
function viewingOf({ schedule, resources }, who) {
  const theirResources = resources === 'linked' ? who.resources ?? who.schedule : who.resources;
  return { schedule: schedule ? who.schedule ?? null : null, resources: resources ? theirResources ?? null : null };
}

/**
 * Changes made on the page while pieces were being loaded from Drive (`start` → `mine`), put on top
 * of the freshly loaded pieces (`theirs`), piece by piece. `pieces` = the freshly loaded piece data.
 */
export function rebaseState(start, mine, pieces) {
  const was = splitState(start, pieces);
  const now = splitState(mine, pieces);
  const out = {};
  for (const name of PIECE_NAMES) {
    out[name] = pieces[name] ? mergePiece(PIECES[name].collections, was[name], now[name], pieces[name]).state : null;
  }
  return composeState(out);
}

/**
 * Why a link to a record can't be followed (a button greyed out with this as its tip), or null when it
 * can. `missing` = PiecePlan.missing (pieces that can't be had, and why).
 */
export function whyUnavailable(state, collection, id, missing = {}) {
  if (id && state[collection]?.some((r) => r.id === id)) return null;
  const piece = pieceOf(collection);
  const why = missing[piece];
  if (why && why !== 'not_linked') return `${PIECES[piece].label}: ${MISSING_WORDS[why] ?? 'not available'}`;
  return 'Not in this plan any more.';
}
