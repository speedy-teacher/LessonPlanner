// A template's suggested name loses the lesson/week numbers and the file ending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestName } from '../public/js/templateMaker/templateName.js';

test('lesson and week numbers and the file ending are taken out of the name', () => {
  assert.equal(suggestName('Week 05 - Rhythm Tree Lesson 1+2'), 'Rhythm Tree');
  assert.equal(suggestName('Beat Buddies Wk 3.pptx'), 'Beat Buddies');
  assert.equal(suggestName('Copy of Week 4 checklist.xlsx'), 'Checklist', 'and starts with a capital letter');
  assert.equal(suggestName('Day 2 - Steady Beat.docx'), 'Steady Beat');
  assert.equal(suggestName('Weekend Songs'), 'Weekend Songs');
});

test('a name that was only numbers becomes “Lesson”', () => {
  assert.equal(suggestName('Week 5 Lesson 2.pptx'), 'Lesson');
});
