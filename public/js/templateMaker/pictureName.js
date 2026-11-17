// What a picture saved from a lesson is called in the pictures folder (and on the Images tab).
// Pictures pasted in from Bitmoji and the like often carry a computer-made name as their alt text
// ("0a1b2c3d-1234-…-v1.png"), which says nothing about the picture: those are not used. The teacher can type
// a name for each picture in the Template Maker window; otherwise it is named after its template.
//
// Pure logic, shared by the browser and the Node tests.

const FILE_ENDING = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg|emf|wmf)$/i;
const CODE = /[0-9a-f]{8,}|[0-9a-f]{4,}-[0-9a-f]{4,}/i; // long runs of computer-made letters and digits
const PLAIN = /^(image|picture|pic|photo|img|graphic|bitmoji|unnamed|untitled|screenshot)?[\s_-]*\d*$/i;

/** True when an alt text says something about the picture (not a file name, a code or "image 3"). */
export function isUsefulTitle(title = '') {
  const t = title.trim();
  if (!t || FILE_ENDING.test(t) || CODE.test(t) || PLAIN.test(t)) return false;
  return /\p{L}{2,}/u.test(t);
}

/**
 * The name a picture is saved as: what the teacher typed, else a useful alt text, else
 * "<template> picture" (numbered when the template has several).
 */
export function pictureName(picture, { typed = '', template = 'Lesson', index = 0, count = 1 } = {}) {
  const own = typed.trim() || (isUsefulTitle(picture.title) ? picture.title.trim() : '');
  if (own) return own.replace(/[\\/]+/g, '-').slice(0, 120);
  return count > 1 ? `${template} picture ${index + 1}` : `${template} picture`;
}
