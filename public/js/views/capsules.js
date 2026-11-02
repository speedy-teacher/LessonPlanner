// Little capsules saying which file a page's data is kept in and whether it's shared (shareStatus.js),
// and "Just yours" on settings that are each teacher's own even on a shared page. Only for plans in
// pieces — an older one-file plan has nothing shared in parts.

import { h } from '../dom.js';
import { partCapsule } from '../shareStatus.js';
import { pieces } from '../workspace.js';

/** Names the tutorials light up (written out, so the tutorial test can find them). */
const TOURS = { schoolYear: { tour: 'capsule-schoolYear' }, schedule: { tour: 'capsule-schedule' }, resources: { tour: 'capsule-resources' } };

/** "🧺 School Year · Shared" for a part of the open plan (its owner's name while looking at someone's). */
export function pieceCapsule(name) {
  if (!pieces) return null;
  const c = partCapsule(name, pieces.recs[name], { whose: pieces.viewing?.[name]?.name ?? '' });
  return h('span', { class: `piece-capsule ${c.tone}`, 'data-tip': c.tip, 'data-tour': TOURS[name].tour },
    h('span', { 'aria-hidden': 'true' }, c.icon), ` ${c.label} · `, h('strong', {}, c.word));
}

/** "🔒 Just yours" beside a setting kept in your own Lesson Schedule (colleagues don't see or change it). */
export function yoursCapsule(what, { label = 'Just yours' } = {}) {
  if (!pieces) return null;
  return h('span', {
    class: 'piece-capsule mine small', 'data-tour': 'capsule-yours',
    'data-tip': `${what} ${what.endsWith('s') ? 'are' : 'is'} kept in your own Lesson Schedule: colleagues sharing this School Year don’t see or change ${what.endsWith('s') ? 'them' : 'it'}.`,
  }, h('span', { 'aria-hidden': 'true' }, '🔒'), ` ${label}`);
}
