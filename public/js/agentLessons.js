// Assistant commands for Setup › Lesson Templates (the slide decks) and the folders that
// organize lesson decks and pictures. See agentCommands.js.

import { AUTO_FIELDS, AUTO_FIELD_PLACEHOLDERS, duplicateLesson, editLesson, lessonUsageByGrade, outcomeLabel, remove, update } from './model.js';
import { addDeck, addFolder, decksIn, foldersIn, moveDeck, moveFolder, removeFolder } from './library.js';
import { filterLessons } from './weekPlan.js';
import {
  evalOf, fail, folder, grade, idsOf, image, instrument, lesson, lessonInfo, listOf, outcome, patchFrom, shelfOf, text, year,
} from './agentHelpers.js';

/** Auto-fill details by key ("school") or label ("Week number"). */
function autoFieldKeys(value) {
  return [...new Set(listOf(value).map((v) => {
    const key = Object.keys(AUTO_FIELDS).find((k) => k === v || AUTO_FIELDS[k].toLowerCase() === String(v).toLowerCase());
    return key || fail(`"${v}" isn't a detail that can be filled in. Choices: ${Object.keys(AUTO_FIELDS).join(', ')}.`);
  }))];
}

function lessonDetails(state, l) {
  return {
    ...lessonInfo(state, l),
    filledIn: l.autoFields.map((k) => ({ detail: k, label: AUTO_FIELDS[k], typeInSlides: AUTO_FIELD_PLACEHOLDERS[k] })),
    usedIn: lessonUsageByGrade(state, l.id).map(({ grade: g, outcomes }) => ({
      grade: g?.name ?? 'No grade yet',
      outcomes: outcomes.map(({ outcome: o, evals }) => ({ outcome: outcomeLabel(o), evals: evals.map((e) => e.criterion.title) })),
    })),
    timesOnSchedule: state.weekLessons.filter((e) => e.lessonId === l.id).length,
  };
}

/** A folder (or the top level, for "" / "top" / null) on a shelf. */
const folderOrTop = (state, ref, shelf) => (ref === null || ref === '' || String(ref).toLowerCase() === 'top' ? null : folder(state, ref, shelf).id);

function folderTree(state, shelf, parentId) {
  const yearId = year(state).id;
  return foldersIn(state, yearId, parentId, shelf).map((f) => ({
    id: f.id, name: f.name, watchedInDrive: Boolean(f.watch),
    items: decksIn(state, yearId, f.id, shelf).length, folders: folderTree(state, shelf, f.id),
  }));
}

const KIND = ['"lessons" (default) or "images"'];

export const LESSON_COMMANDS = {
  listLessons: {
    summary: 'Lesson templates (slide decks), optionally narrowed. With grade/outcome/eval, only lessons taught in matching evals, in teaching order.',
    params: { search: ['Words in the lesson name or category'], category: ['Category name'], grade: ['Grade name'], outcome: ['Outcome code or title'], eval: ['Eval title'] },
    run: (state, a) => filterLessons(state, year(state).id, {
      search: a.search ?? '', category: a.category ?? '',
      gradeId: a.grade ? grade(state, a.grade).id : '',
      outcomeId: a.outcome ? outcome(state, a.outcome).id : '',
      criterionId: a.eval ? evalOf(state, a.eval).id : '',
    }).map(({ lesson: l }) => lessonInfo(state, l)),
  },
  getLesson: {
    summary: 'Everything about one lesson template: category, instruments, folder, details filled into its copies, and where it\'s used.',
    params: { lesson: ['Lesson name', true] },
    run: (state, a) => lessonDetails(state, lesson(state, a.lesson)),
  },
  addLesson: {
    summary: 'Add a lesson template with no file yet (decks from Google Drive or the computer are brought in by the teacher with the Add button).',
    changes: true,
    params: { name: ['Lesson name', true], category: ['e.g. Ukulele'], folder: ['Folder name'] },
    run: (state, a) => {
      const l = addDeck(state, {
        yearId: year(state).id, name: text(a.name, 'name'), category: a.category ?? '', folderId: a.folder ? folder(state, a.folder).id : null,
      });
      return { id: l.id, done: `Added the lesson ${l.name}.` };
    },
  },
  editLesson: {
    summary: 'Change a lesson template: name, category, instruments it uses, or which details are filled into its copies.',
    changes: true,
    params: {
      lesson: ['Lesson name', true], name: ['New name'], category: ['New category ("" for none)'],
      instruments: ['The full list of instruments it uses (replaces them)'],
      filledIn: [`The full list of details filled into its copies: ${Object.keys(AUTO_FIELDS).join(', ')}`],
    },
    run: (state, a) => {
      const l = lesson(state, a.lesson);
      const patch = patchFrom(a, { name: (v) => text(v, 'name'), category: String });
      if (a.instruments !== undefined) patch.instrumentIds = idsOf(state, a.instruments, instrument);
      if (a.filledIn !== undefined) patch.autoFields = autoFieldKeys(a.filledIn);
      editLesson(state, l.id, patch);
      return lessonDetails(state, l);
    },
  },
  duplicateLesson: {
    summary: 'Make a copy of a lesson template (named "… (copy)").',
    changes: true,
    params: { lesson: ['Lesson name', true] },
    run: (state, a) => {
      const copy = duplicateLesson(state, lesson(state, a.lesson).id);
      return { id: copy.id, done: `Made ${copy.name}.` };
    },
  },
  deleteLesson: {
    summary: 'Delete a lesson template; it leaves every eval and the Lesson Schedule. Its file is not touched.',
    changes: true,
    params: { lesson: ['Lesson name', true] },
    run: (state, a) => {
      const l = lesson(state, a.lesson);
      remove(state, 'lessons', l.id);
      return { done: `Deleted the lesson ${l.name}.` };
    },
  },
  listFolders: {
    summary: 'The folders of lesson decks or pictures, nested, with how many items each holds.',
    params: { kind: KIND },
    run: (state, a) => folderTree(state, shelfOf(a.kind), null),
  },
  addFolder: {
    summary: 'Add a folder for lesson decks or pictures (inside another folder, or at the top).',
    changes: true,
    params: { name: ['Folder name', true], parent: ['Folder to put it in; default the top'], kind: KIND },
    run: (state, a) => {
      const shelf = shelfOf(a.kind);
      const f = addFolder(state, { yearId: year(state).id, name: text(a.name, 'name'), parentId: a.parent ? folderOrTop(state, a.parent, shelf) : null, shelf });
      return { id: f.id, done: `Added the folder ${f.name}.` };
    },
  },
  editFolder: {
    summary: 'Rename a folder, move it into another folder ("top" for the top), or turn watching its Google Drive folder for new files on or off.',
    changes: true,
    params: { folder: ['Folder name', true], name: ['New name'], parent: ['Folder to move it into, or "top"'], watchDrive: ['true or false'], kind: KIND },
    run: (state, a) => {
      const shelf = shelfOf(a.kind);
      const f = folder(state, a.folder, shelf);
      const patch = patchFrom(a, { name: (v) => text(v, 'name') });
      if (a.watchDrive !== undefined) patch.watch = a.watchDrive === true;
      update(state, shelf.folders, f.id, patch);
      if (a.parent !== undefined && !moveFolder(state, f.id, folderOrTop(state, a.parent, shelf), shelf)) fail('A folder can\'t go inside itself.');
      return { done: `Updated the folder ${f.name}.` };
    },
  },
  deleteFolder: {
    summary: 'Delete a folder with everything in it (its folders and lesson decks or pictures leave the planner). Files in Drive or on the computer are not touched.',
    changes: true,
    params: { folder: ['Folder name', true], kind: KIND },
    run: (state, a) => {
      const shelf = shelfOf(a.kind);
      const f = folder(state, a.folder, shelf);
      const counts = removeFolder(state, f.id, shelf);
      return { ...counts, done: `Deleted the folder ${f.name}.` };
    },
  },
  moveToFolder: {
    summary: 'Move lesson decks or pictures into a folder ("top" for the top level).',
    changes: true,
    params: { items: ['Lesson or picture names', true], folder: ['Folder name, or "top"', true], kind: KIND },
    run: (state, a) => {
      const shelf = shelfOf(a.kind);
      const target = folderOrTop(state, a.folder, shelf);
      const one = shelf.items === 'lessons' ? lesson : image;
      const ids = idsOf(state, a.items, one);
      ids.forEach((id) => moveDeck(state, id, target, shelf));
      return { done: `Moved ${ids.length} item(s).` };
    },
  },
};
