// Writes public/config.js: the Google codes the website uses (Client ID and API key).
// They're built in when the site is published, so people using the planner never fill them in.
//
//   On GitHub: from the repository secrets GOOGLE_CLIENT_ID and GOOGLE_API_KEY (see .github/workflows/pages.yml).
//   On this computer: from those environment variables, or else from the older planner's saved data.
//
// public/config.js is not kept in git (the codes stay out of the public code).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The text of config.js for these codes. */
export function configScript({ googleClientId = '', googleApiKey = '' }) {
  const config = JSON.stringify({ googleClientId: googleClientId.trim(), googleApiKey: googleApiKey.trim() });
  return `// Made by scripts/write-config.js — not kept in git.\nwindow.PLANNER_CONFIG = ${config};\n`;
}

async function savedCodes() {
  try {
    const { settings = {} } = JSON.parse(await readFile(join(ROOT, 'data', 'lesson-planner.json'), 'utf8'));
    return { googleClientId: settings.googleClientId || '', googleApiKey: settings.googleApiKey || '' };
  } catch {
    return {};
  }
}

async function main() {
  const fromEnv = { googleClientId: process.env.GOOGLE_CLIENT_ID || '', googleApiKey: process.env.GOOGLE_API_KEY || '' };
  const codes = fromEnv.googleClientId ? fromEnv : await savedCodes();
  await writeFile(join(ROOT, 'public', 'config.js'), configScript(codes));
  console.log(codes.googleClientId ? 'Wrote public/config.js with the Google codes.' : 'Wrote public/config.js without Google codes (Drive will be off).');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) main();
