// Which files can become templates, and what Google calls them. Google's own Slides, Docs and Sheets
// are read straight away; Word, Excel and PowerPoint files kept in Drive (never opened in Google) are
// turned into Google's kind of file when their template copy is made.
//
// Pure logic, shared by the browser and the Node tests.

const G = 'application/vnd.google-apps.';
const OFFICE = 'application/vnd.openxmlformats-officedocument.';

export const KINDS = {
  slides: {
    label: 'Google Slides', google: `${G}presentation`, office: `${OFFICE}presentationml.presentation`,
    others: ['application/vnd.ms-powerpoint', 'application/vnd.oasis.opendocument.presentation'],
    open: (id) => `https://docs.google.com/presentation/d/${id}/edit`, icon: '🖼️', pictures: true,
  },
  docs: {
    label: 'Google Docs', google: `${G}document`, office: `${OFFICE}wordprocessingml.document`,
    others: ['application/msword', 'application/vnd.oasis.opendocument.text'],
    open: (id) => `https://docs.google.com/document/d/${id}/edit`, icon: '📄', pictures: true,
  },
  sheets: {
    label: 'Google Sheets', google: `${G}spreadsheet`, office: `${OFFICE}spreadsheetml.sheet`,
    others: ['application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet'],
    open: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`, icon: '📊', pictures: false,
  },
};

export const FOLDER_MIME = `${G}folder`;

/** 'slides' | 'docs' | 'sheets' for a file kind that can become a template, else null. */
export function kindOf(mimeType) {
  return Object.keys(KINDS).find((k) => [KINDS[k].google, KINDS[k].office, ...KINDS[k].others].includes(mimeType)) ?? null;
}

/** Google's own file (read as it is) rather than an Office file (turned into Google's kind first). */
export function isGoogleFile(mimeType) {
  const kind = kindOf(mimeType);
  return Boolean(kind) && KINDS[kind].google === mimeType;
}

/** Every kind of file the file picker offers. */
export function pickableTypes() {
  return Object.values(KINDS).flatMap((k) => [k.google, k.office, ...k.others]);
}

/** The address that opens a file in its Google editor. */
export function openUrl(fileId, mimeType) {
  const kind = kindOf(mimeType);
  return kind ? KINDS[kind].open(encodeURIComponent(fileId)) : `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/** Points per EMU (Google measures shapes in EMU or points). */
export const EMU_PER_PT = 12700;
export const toEmu = (dimension) => (dimension?.unit === 'PT' ? dimension.magnitude * EMU_PER_PT : dimension?.magnitude ?? 0);
