/* Structural integrity of the Geometry deck.

   Runs the page's own script under Node with a DOM stub, then inspects the
   deck it built: ids, prompts, answers, options, the unit/section hierarchy,
   and the properties the shared engine relies on (four distinct options for a
   four-box question, enough short pairs for a Match board). */
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(__dirname + '/subjects/geometry.html', 'utf8').replace('%%GOOGLE_CLIENT_ID%%', '');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
if (!scriptBody) throw new Error('no app script found in subjects/geometry.html');

const code = scriptBody.replace(/\n  render\(\);[\s\S]*?\n\}\)\(\);\s*$/, `
window.__T__ = {ALL_ITEMS:ALL_ITEMS, TOPICS:TOPICS, TOPIC_MAP:TOPIC_MAP, ITEMS_BY_TOPIC:ITEMS_BY_TOPIC,
  CATEGORIES:CATEGORIES, CAT_LABELS:CAT_LABELS, UNIT_GROUPS:UNIT_GROUPS, TOPIC_ICONS:TOPIC_ICONS,
  TERM_LISTS:TERM_LISTS, APPLIED:APPLIED, SOURCE_UNITS:SOURCE_UNITS, SOURCE_SECTIONS:SOURCE_SECTIONS,
  engineData:engineData, recordAnswer:recordAnswer, migrateProgress:migrateProgress,
  getProg:getProg, todayStr:todayStr};
})();`);
if (!code.includes('window.__T__')) throw new Error('hook injection mismatch — tail pattern not found');

global.window = { scrollTo() {} };
global.localStorage = { getItem() { return null; }, setItem() {} };
global.document = {
  head: { appendChild() {} },
  querySelector() { return { innerHTML: '', appendChild() {} }; },
  createElement() {
    return { className: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} },
             appendChild() {}, addEventListener() {}, setAttribute() {} };
  }
};
eval(code);
const T = window.__T__;

console.log('items:', T.ALL_ITEMS.length, '| topics:', T.TOPICS.length, '| units:', T.UNIT_GROUPS.length);

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' -> ' + e.message); }
}

/* ---------------------------- the deck ---------------------------- */

check('the deck is a real deck, not a stub', () => {
  assert.ok(T.ALL_ITEMS.length >= 1000, 'only ' + T.ALL_ITEMS.length + ' cards');
  assert.ok(T.TOPICS.length >= 40, 'only ' + T.TOPICS.length + ' topics');
});

check('no duplicate item ids', () => {
  const seen = new Set();
  T.ALL_ITEMS.forEach(it => {
    if (seen.has(it.id)) throw new Error('duplicate id: ' + it.id);
    seen.add(it.id);
  });
});

check('every item has a prompt, an answer array and a known topic', () => {
  T.ALL_ITEMS.forEach(it => {
    if (!it.prompt) throw new Error(it.id + ' has no prompt');
    if (!Array.isArray(it.answer) || !it.answer.length || !it.answer[0]) throw new Error(it.id + ' has no answer');
    if (!T.TOPIC_MAP[it.topic]) throw new Error(it.id + ' points at unknown topic ' + it.topic);
  });
});

check('every topic has at least 8 cards and a known category', () => {
  const catIds = T.CATEGORIES.map(c => c.id);
  T.TOPICS.forEach(t => {
    const n = (T.ITEMS_BY_TOPIC[t.id] || []).length;
    if (n < 8) throw new Error(t.id + ' has only ' + n + ' cards');
    if (catIds.indexOf(t.cat) === -1) throw new Error(t.id + ' has unknown category ' + t.cat);
  });
});

check('every category label is declared for the engine', () => {
  T.CATEGORIES.forEach(c => {
    if (!T.CAT_LABELS[c.id]) throw new Error('no engine label for category ' + c.id);
  });
});

/* -------------------- four-box questions hold up -------------------- */

check('every fixed-choice item offers exactly four distinct options', () => {
  T.ALL_ITEMS.filter(it => it.choices).forEach(it => {
    if (it.choices.length !== 4) throw new Error(it.id + ' offers ' + it.choices.length + ' options');
    if (new Set(it.choices).size !== 4) throw new Error(it.id + ' repeats an option');
  });
});

check('every fixed-choice item includes its own answer', () => {
  T.ALL_ITEMS.filter(it => it.choices).forEach(it => {
    if (it.choices.indexOf(it.answer[0]) === -1) throw new Error(it.id + ' answer is not among its options');
  });
});

check('every pool item includes its own answer in the pool', () => {
  T.ALL_ITEMS.filter(it => it.pool).forEach(it => {
    if (it.pool.indexOf(it.answer[0]) === -1) throw new Error(it.id + ' answer missing from its pool');
  });
});

/* The engine fills a short option list from siblings of the same topic and
   type. So for a card that relies on that — one with no fixed choices of its
   own — a sibling sharing its answer could put the right answer on two boxes
   at once. Cards that ship their own four options are immune, and several of
   them legitimately share an answer: corresponding, alternate interior and
   alternate exterior angles are all simply "Congruent". */
check('no two sibling cards that rely on pooling share an answer', () => {
  const seen = {};
  T.ALL_ITEMS.filter(it => !it.choices).forEach(it => {
    const key = it.topic + '|' + it.type + '|' + it.answer[0];
    if (seen[key]) throw new Error('answer repeated in ' + it.topic + ' (' + it.type + '): ' + it.answer[0]);
    seen[key] = it.id;
  });
});

check('any card sharing an answer with a sibling ships its own options', () => {
  const byKey = {};
  T.ALL_ITEMS.forEach(it => {
    const key = it.topic + '|' + it.type + '|' + it.answer[0];
    (byKey[key] = byKey[key] || []).push(it);
  });
  Object.keys(byKey).forEach(key => {
    if (byKey[key].length < 2) return;
    byKey[key].forEach(it => {
      if (!it.choices) throw new Error(it.id + ' shares an answer but has no fixed options');
    });
  });
});

check('no two cards in one topic and direction share a prompt', () => {
  const seen = {};
  T.ALL_ITEMS.forEach(it => {
    const key = it.topic + '|' + it.type + '|' + it.prompt;
    if (seen[key]) throw new Error('prompt repeated in ' + it.topic + ': ' + it.prompt);
    seen[key] = it.id;
  });
});

check('every topic can build a four-box question', () => {
  T.TOPICS.forEach(t => {
    const mine = T.ITEMS_BY_TOPIC[t.id] || [];
    const ok = mine.some(it => {
      if (it.choices) return it.choices.length >= 4;
      const sibs = mine.filter(o => o.type === it.type && o.id !== it.id &&
        o.answer[0] !== it.answer[0]);
      return sibs.length >= 3;
    });
    if (!ok) throw new Error(t.id + ' cannot fill four boxes');
  });
});

/* ------------------------- both directions ------------------------- */

check('every term is asked in both directions', () => {
  Object.keys(T.TERM_LISTS).forEach(topic => {
    const t2d = (T.ITEMS_BY_TOPIC[topic] || []).filter(it => it.type === 'term2def').length;
    const d2t = (T.ITEMS_BY_TOPIC[topic] || []).filter(it => it.type === 'def2term').length;
    const n = T.TERM_LISTS[topic].length;
    if (t2d !== n || d2t !== n) {
      throw new Error(topic + ': ' + n + ' terms but ' + t2d + ' forward and ' + d2t + ' back');
    }
  });
});

check('every topic carries applied questions, not just definitions', () => {
  T.TOPICS.forEach(t => {
    const applied = (T.ITEMS_BY_TOPIC[t.id] || []).filter(it => it.type === 'mc').length;
    if (applied < 6) throw new Error(t.id + ' has only ' + applied + ' applied questions');
  });
});

/* ---------------------- the paper hierarchy ----------------------- */

check('every topic sits in exactly one unit', () => {
  const count = {};
  T.UNIT_GROUPS.forEach(u => u.topicIds.forEach(id => { count[id] = (count[id] || 0) + 1; }));
  T.TOPICS.forEach(t => {
    if (!count[t.id]) throw new Error(t.id + ' is in no unit');
    if (count[t.id] > 1) throw new Error(t.id + ' is in ' + count[t.id] + ' units');
  });
});

check('no unit lists a topic that does not exist', () => {
  T.UNIT_GROUPS.forEach(u => u.topicIds.forEach(id => {
    if (!T.TOPIC_MAP[id]) throw new Error(u.id + ' lists unknown topic ' + id);
  }));
});

check('every topic declares the printed section it came from', () => {
  T.TOPICS.forEach(t => {
    const sec = T.SOURCE_SECTIONS[t.id];
    if (!sec || !sec[0]) throw new Error(t.id + ' has no section heading');
    if (typeof sec[1] !== 'number') throw new Error(t.id + ' has no section order');
  });
});

check('every unit declares a printed title', () => {
  T.UNIT_GROUPS.forEach(u => {
    if (!T.SOURCE_UNITS[u.id] || !T.SOURCE_UNITS[u.id].title) {
      throw new Error(u.id + ' has no title in SOURCE_UNITS');
    }
  });
});

check('every topic has an icon', () => {
  T.TOPICS.forEach(t => {
    if (!T.TOPIC_ICONS[t.id]) throw new Error(t.id + ' has no icon');
  });
});

/* ---------------------- what the engine gets ---------------------- */

check('engineData hands the engine a complete, well-formed deck', () => {
  const d = T.engineData();
  assert.strictEqual(d.items.length, T.ALL_ITEMS.length, 'item count');
  assert.strictEqual(d.topics.length, T.TOPICS.length, 'topic count');
  assert.strictEqual(d.units.length, T.UNIT_GROUPS.length, 'unit count');
  d.topics.forEach(t => {
    if (!t.source || !t.source.unit) throw new Error(t.id + ' lost its unit');
    if (!t.source.section) throw new Error(t.id + ' lost its section');
    if (t.source.book !== 'Math') throw new Error(t.id + ' has the wrong book');
  });
  d.units.forEach(u => { if (!u.title) throw new Error(u.id + ' lost its title'); });
});

check('the engine can build a Match board', () => {
  const d = T.engineData();
  const pairTypes = { term2def: 1, def2term: 1 };
  const short = d.items.filter(it => pairTypes[it.type] &&
    String(it.prompt).length < 46 && it.answer[0].length < 46);
  if (short.length < 6) throw new Error('only ' + short.length + ' short pairs; Match needs 6');
});

check('every unit can be pinned as its own Blast pool', () => {
  const d = T.engineData();
  d.units.forEach(u => {
    const inUnit = {};
    u.topicIds.forEach(id => { inUnit[id] = true; });
    const playable = d.items.filter(it => inUnit[it.topic] && (it.choices || it.pool));
    if (playable.length < 4) throw new Error(u.id + ' has only ' + playable.length + ' playable cards');
  });
});

/* ------------------------- the scheduler -------------------------- */

check('a correct answer moves a card up a box and pushes its due date out', () => {
  const id = T.ALL_ITEMS[0].id;
  T.recordAnswer(id, true);
  const p = T.getProg(id);
  assert.strictEqual(p.box, 0, 'first correct answer should land in box 0');
  assert.strictEqual(p.seen, 1, 'seen');
  T.recordAnswer(id, true);
  assert.strictEqual(T.getProg(id).box, 1, 'second correct answer should reach box 1');
  assert.notStrictEqual(T.getProg(id).due, T.todayStr(), 'a box-1 card should not be due again today');
});

check('a missed card drops to box 0 and comes back today', () => {
  const id = T.ALL_ITEMS[1].id;
  T.recordAnswer(id, true);
  T.recordAnswer(id, true);
  T.recordAnswer(id, false);
  const p = T.getProg(id);
  assert.strictEqual(p.box, 0, 'box after a miss');
  assert.strictEqual(p.due, T.todayStr(), 'a missed card should be due today');
  assert.strictEqual(p.incorrect, 1, 'incorrect count');
});

console.log(failures ? '\n' + failures + ' GEOMETRY CONTENT CHECK(S) FAILED' : '\nALL GEOMETRY CONTENT CHECKS PASSED');
process.exit(failures ? 1 : 0);
