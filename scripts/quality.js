// Function-length check: a function may be longer than 60 lines only if
// its cognitive complexity is 5 or less. ESLint can't express "either/or"
// rules, so this script runs both measurements and combines them.
//
//   node scripts/quality.js [files or folders…]   (default: whole project)

import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

export const MAX_FUNCTION_LINES = 60;
export const SIMPLE_COGNITIVE = 5;

export async function checkFunctionLength(patterns = ['.'], { ignore = true } = {}) {
  const eslint = new ESLint({
    ignore,
    overrideConfig: {
      rules: {
        'max-lines-per-function': ['error', { max: MAX_FUNCTION_LINES }],
        'sonarjs/cognitive-complexity': ['error', 0],
      },
    },
  });
  const results = await eslint.lintFiles(patterns);
  return results.flatMap((r) => violationsIn(r));
}

function violationsIn(result) {
  const cognitiveByLine = new Map();
  for (const m of result.messages) {
    if (m.ruleId !== 'sonarjs/cognitive-complexity') continue;
    const match = /from (\d+) to/.exec(m.message);
    if (match) cognitiveByLine.set(m.line, Number(match[1]));
  }
  return result.messages
    .filter((m) => m.ruleId === 'max-lines-per-function')
    .map((m) => ({ file: result.filePath, line: m.line, message: m.message, cognitive: cognitiveByLine.get(m.line) ?? 0 }))
    .filter((v) => v.cognitive > SIMPLE_COGNITIVE);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const violations = await checkFunctionLength(process.argv.slice(2).length ? process.argv.slice(2) : ['.']);
  for (const v of violations) {
    console.log(`${v.file}:${v.line}  ${v.message} (cognitive complexity ${v.cognitive} > ${SIMPLE_COGNITIVE})`);
  }
  if (violations.length) process.exitCode = 1;
  else console.log('Function length check passed.');
}
