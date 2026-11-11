// A template's suggested name: the file's name without its lesson/week numbers or file ending
// ("Week 05 - 3 Lesson 1+2 Week 5.pptx" → "3"; "Copy of Rhythm Tree Wk 4" → "Rhythm Tree").
// Ported from lesson-organizer templatize.py `template_title`. The teacher can change it before making.
//
// Pure logic, shared by the browser and the Node tests.

const ENDING = /\.(pptx?|pptm|potx|docx?|dotx|xlsx?|xlsm|odp|odt|ods)$/i;
const NUMBERS = /^Week\s*\d+\s*-\s*|(?<![\p{L}])(?:Lessons?|Lsn|Day)\s*[#:]?\s*\d+(?:\s*[+&-]\s*\d+)*|(?<![\p{L}])(?:Weeks?|Wk)\.?(?![\p{L}])\s*[#:]?\s*[\d_]*(?:\s*[+&-]\s*\d+)*/giu;

export function suggestName(fileName = '') {
  const name = fileName.replace(ENDING, '').replace(/^Copy of\s+/i, '')
    .replace(NUMBERS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s_+&-]+$/, '')
    .replace(/^[\s_+&-]+/, '')
    .trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Lesson';
}
