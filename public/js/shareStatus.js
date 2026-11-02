// What the little sharing capsules say about each part of a plan in pieces: which file a page's data
// is kept in, what's in that file, and whether it's shared in Google Drive ("Shared", "Only you",
// "Shared with you"…). Google Drive is the only judge of sharing; the planner just reads what it says.
//
// Pure logic, shared by the browser app and the Node tests.

/** How each part is called on the page, and what's in it (the capsule's tip). */
export const PART_WORDS = {
  schoolYear: { icon: '🧺', label: 'School Year', holds: 'Schools, grades, instruments, events, outcomes, evals and both calendars.' },
  schedule: { icon: '📖', label: 'Lesson Schedule', holds: 'Weekly lessons, lesson order, grade and instrument colors, the lesson-copies folder and report settings.' },
  resources: { icon: '🖼️', label: 'Teacher Resources', holds: 'Lesson templates and pictures (with their folders and tags), kept from year to year.' },
};

/**
 * The sharing of one part's file: { word, tone, tip }. `rec` = the piece's record (null = missing):
 * fileId (none = on this computer only), shared (true / false / null = not checked yet), ownedByMe, owner, canEdit.
 */
export function sharingOf(rec) {
  if (!rec) return { word: 'Not available', tone: 'missing', tip: 'This part can’t be opened right now.' };
  if (!rec.fileId) return { word: 'On this computer', tone: 'local', tip: 'Only on this computer. Save the plan to Google Drive to share it.' };
  if (rec.ownedByMe === false) {
    const whose = rec.owner ? `${rec.owner} shared this with you` : 'Shared with you';
    return { word: rec.canEdit === false ? 'Shared with you · view only' : 'Shared with you', tone: 'theirs', tip: `${whose}${rec.canEdit === false ? ' to look at' : ''}.` };
  }
  if (rec.shared === true) return { word: 'Shared', tone: 'shared', tip: 'Shared in Google Drive. Open it in Drive to see or change who has it.' };
  if (rec.shared === false) return { word: 'Only you', tone: 'mine', tip: 'Not shared. Share it in Google Drive when you want colleagues to see it.' };
  return { word: 'In Google Drive', tone: 'unknown', tip: 'Checking whether it’s shared…' };
}

/** The whole capsule for a part: { icon, label, word, tone, tip } (tip also says what's in the file). */
export function partCapsule(name, rec, { whose = '' } = {}) {
  const words = PART_WORDS[name];
  const sharing = sharingOf(rec);
  const label = whose ? `${whose}’s ${words.label}` : words.label;
  return { icon: words.icon, label, word: sharing.word, tone: sharing.tone, tip: `${words.label}: ${words.holds} ${sharing.tip}` };
}
