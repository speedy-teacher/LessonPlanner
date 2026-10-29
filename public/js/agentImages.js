// Assistant commands for the Images tab: pictures' details, tags, instruments, the lessons
// that always get them, and when to use them (imagePick.js). See agentCommands.js.

import { add, find, remove, update } from './model.js';
import { addTag, chooseImageLesson, editImage, folderPath, IMAGE_SHELF, tagsByGroup } from './library.js';
import { PRIORITIES, weekRanges, weeksImageFits, windowSentence } from './imagePick.js';
import { yearEvents } from './schoolEvents.js';
import {
  fail, idsOf, image, instrument, lesson, namesOf, ofYear, patchFrom, pick, tag, tagGroup, text, year,
} from './agentHelpers.js';

const tagLabel = (state, id) => {
  const t = find(state, 'tags', id);
  return t ? `${find(state, 'tagGroups', t.groupId)?.name ?? ''}: ${t.name}` : null;
};

function imageInfo(state, i) {
  return {
    id: i.id, name: i.name, description: i.description,
    folder: folderPath(state, i.folderId, IMAGE_SHELF).map((f) => f.name).join(' › ') || null,
    tags: i.tagIds.map((id) => tagLabel(state, id)).filter(Boolean),
    instruments: namesOf(state, 'instruments', i.instrumentIds),
    alwaysForLessons: namesOf(state, 'lessons', i.lessonIds),
    ...(i.isNew ? { isNew: true } : {}),
  };
}

function timingInfo(state, i) {
  const { when } = i;
  return {
    times: when.windows.map((w, n) => ({ number: n + 1, inWords: windowSentence(w), ...w })),
    priority: PRIORITIES.find((p) => p.value === when.priority)?.label ?? when.priority,
    alsoAnyOtherWeek: when.anytime,
    fitsWeeks: weekRanges(weeksImageFits(state, i).map((w) => w.number)) || 'none',
  };
}

function priorityOf(value) {
  const p = PRIORITIES.find((x) => x.value === Number(value) || x.label.toLowerCase() === String(value).toLowerCase());
  return p ? p.value : fail(`priority should be one of: ${PRIORITIES.map((x) => x.label).join(', ')}.`);
}

const MMDD = /^\d{2}-\d{2}$/;
const monthDay = (v, what) => (MMDD.test(v ?? '') ? v : fail(`${what} should look like 12-01 (month-day).`));
const days = (v) => Math.max(0, Number(v) || 0);

/** A new "when it fits" time: dates every year, or around one of the year's events. */
function newWindow(state, a) {
  if (a.event) {
    const event = pick(yearEvents(state, year(state).id), a.event, 'event');
    if (a.anchor && !['start', 'end'].includes(a.anchor)) fail('anchor should be "start" or "end".');
    return { type: 'holiday', holiday: event.name, anchor: a.anchor ?? 'start', daysBefore: days(a.daysBefore), daysAfter: days(a.daysAfter) };
  }
  if (!a.from) fail('Give either an event, or from and to dates like 12-01.');
  return { type: 'date', from: monthDay(a.from, 'from'), to: monthDay(a.to ?? a.from, 'to'), startByEnd: a.startByEnd === true };
}

/** Make the picture's chosen lessons exactly `lessonIds` (adding one ticks its "Picture" detail). */
function setChosenLessons(state, i, lessonIds) {
  i.lessonIds.filter((id) => !lessonIds.includes(id)).forEach((id) => chooseImageLesson(state, i.id, id, false));
  lessonIds.forEach((id) => chooseImageLesson(state, i.id, id, true));
}

function changeTags(state, i, a) {
  const base = a.tags === undefined ? i.tagIds : idsOf(state, a.tags, tag);
  const off = new Set(idsOf(state, a.removeTags, tag));
  return [...new Set([...base, ...idsOf(state, a.addTags, tag)])].filter((id) => !off.has(id));
}

const IMAGE = ['Picture name', true];

export const IMAGE_COMMANDS = {
  listImages: {
    summary: 'Pictures (e.g. bitmojis), optionally only those with a tag, an instrument, words in the name/description, or not looked at yet.',
    params: { search: ['Words in the name or description'], tag: ['Tag name (or "Category: tag")'], instrument: ['Instrument name'], onlyNew: ['true for pictures not looked at yet'] },
    run: (state, a) => {
      const tagId = a.tag ? tag(state, a.tag).id : null;
      const instrumentId = a.instrument ? instrument(state, a.instrument).id : null;
      const words = String(a.search ?? '').trim().toLowerCase();
      return ofYear(state, 'images')
        .filter((i) => (!tagId || i.tagIds.includes(tagId)) && (!instrumentId || i.instrumentIds.includes(instrumentId)))
        .filter((i) => (!words || `${i.name} ${i.description}`.toLowerCase().includes(words)) && (a.onlyNew !== true || i.isNew))
        .map((i) => imageInfo(state, i));
    },
  },
  getImage: {
    summary: 'Everything about one picture, including when it\'s used and the school weeks it fits.',
    params: { image: IMAGE },
    run: (state, a) => {
      const i = image(state, a.image);
      return { ...imageInfo(state, i), ...timingInfo(state, i) };
    },
  },
  editImage: {
    summary: 'Change a picture: name, description, tags, instruments, or the lessons that always get it.',
    changes: true,
    params: {
      image: IMAGE, name: ['New name'], description: ['New description'],
      tags: ['Full list of tags (replaces them)'], addTags: ['Tags to add'], removeTags: ['Tags to take off'],
      instruments: ['Full list of instruments it shows'], alwaysForLessons: ['Full list of lessons that always get it'],
    },
    run: (state, a) => {
      const i = image(state, a.image);
      const patch = patchFrom(a, { name: (v) => text(v, 'name'), description: String });
      patch.tagIds = changeTags(state, i, a);
      if (a.instruments !== undefined) patch.instrumentIds = idsOf(state, a.instruments, instrument);
      editImage(state, i.id, patch);
      if (a.alwaysForLessons !== undefined) setChosenLessons(state, i, idsOf(state, a.alwaysForLessons, lesson));
      return imageInfo(state, i);
    },
  },
  setImageTiming: {
    summary: 'How special a picture\'s times are (Greeting, Holiday or Season) and whether it may also be used in any other week.',
    changes: true,
    params: { image: IMAGE, priority: [`${PRIORITIES.map((p) => p.label).join(', ')}`], alsoAnyOtherWeek: ['true or false'] },
    run: (state, a) => {
      const i = image(state, a.image);
      editImage(state, i.id, (img) => {
        if (a.priority !== undefined) img.when.priority = priorityOf(a.priority);
        if (a.alsoAnyOtherWeek !== undefined) img.when.anytime = a.alsoAnyOtherWeek === true;
      });
      return timingInfo(state, i);
    },
  },
  addImageTime: {
    summary: 'Add a time a picture fits: dates every year (from/to like 12-01), or around an event (event name, anchor start/end, daysBefore, daysAfter).',
    changes: true,
    params: {
      image: IMAGE, from: ['Month-day, e.g. 12-01'], to: ['Month-day, e.g. 12-13'], startByEnd: ['true: the lesson must start by the "to" day'],
      event: ['An event name from listEvents'], anchor: ['"start" (default) or "end" of the event'], daysBefore: ['Days before'], daysAfter: ['Days after'],
    },
    run: (state, a) => {
      const i = image(state, a.image);
      const win = newWindow(state, a);
      editImage(state, i.id, (img) => { img.when.windows.push(win); });
      return timingInfo(state, i);
    },
  },
  removeImageTime: {
    summary: 'Remove one of a picture\'s times (its number from getImage).',
    changes: true,
    params: { image: IMAGE, number: ['The time\'s number', true] },
    run: (state, a) => {
      const i = image(state, a.image);
      const n = Number(a.number);
      if (!(n >= 1 && n <= i.when.windows.length)) fail(`${i.name} has ${i.when.windows.length} time(s); pick a number from that list.`);
      editImage(state, i.id, (img) => { img.when.windows.splice(n - 1, 1); });
      return timingInfo(state, i);
    },
  },
  deleteImage: {
    summary: 'Remove a picture from the planner (its file in Google Drive is not touched).',
    changes: true,
    params: { image: IMAGE },
    run: (state, a) => {
      const i = image(state, a.image);
      remove(state, 'images', i.id);
      return { done: `Removed ${i.name}.` };
    },
  },
  listTags: {
    summary: 'Tag categories and their tags.',
    params: {},
    run: (state) => tagsByGroup(state, year(state).id).map(({ group, tags }) => ({ id: group.id, category: group.name, tags: tags.map((t) => ({ id: t.id, name: t.name })) })),
  },
  addTagCategory: {
    summary: 'Add a tag category (e.g. Season).',
    changes: true,
    params: { name: ['Category name', true] },
    run: (state, a) => ({ id: add(state, 'tagGroups', { yearId: year(state).id, name: text(a.name, 'name') }).id, done: `Added ${a.name}.` }),
  },
  addTag: {
    summary: 'Add a tag to a category (e.g. "winter" in Season).',
    changes: true,
    params: { category: ['Category name', true], name: ['Tag name', true] },
    run: (state, a) => {
      const t = addTag(state, { yearId: year(state).id, groupId: tagGroup(state, a.category).id, name: text(a.name, 'name') });
      return { id: t.id, done: `Added the tag ${t.name}.` };
    },
  },
  renameTagOrCategory: {
    summary: 'Rename a tag (tag: name or "Category: tag") or a tag category (category: name).',
    changes: true,
    params: { tag: ['The tag'], category: ['The category'], name: ['New name', true] },
    run: (state, a) => {
      const [collection, item] = a.tag ? ['tags', tag(state, a.tag)] : ['tagGroups', tagGroup(state, a.category)];
      update(state, collection, item.id, { name: text(a.name, 'name') });
      return { done: `Renamed ${item.name} to ${a.name}.` };
    },
  },
  deleteTagOrCategory: {
    summary: 'Delete a tag, or a tag category with all its tags; they come off every picture.',
    changes: true,
    params: { tag: ['The tag'], category: ['The category'] },
    run: (state, a) => {
      const [collection, item] = a.tag ? ['tags', tag(state, a.tag)] : ['tagGroups', tagGroup(state, a.category)];
      remove(state, collection, item.id);
      return { done: `Deleted ${item.name}.` };
    },
  },
};
