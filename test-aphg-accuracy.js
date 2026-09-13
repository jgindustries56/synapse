const fs = require('fs');
const html = fs.readFileSync(__dirname + '/subjects/aphg.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
let code = scriptBody.replace(/\n  applyDisplaySettings\(\);[\s\S]*?\n\}\)\(\);\s*$/, `
window.__T__={VOCAB_CORE:VOCAB_CORE,DTM_STAGES:DTM_STAGES,EPI_STAGES:EPI_STAGES,RNI_CALC_ITEMS:RNI_CALC_ITEMS,
FORMULA_SHEET:FORMULA_SHEET,DENSITY_FORMULAS:DENSITY_FORMULAS,POLICY_CASES:POLICY_CASES,LIFE_EXP_EXTREMES:LIFE_EXP_EXTREMES,
CENSUS_FACTS:CENSUS_FACTS,MALTHUS_FACTS:MALTHUS_FACTS,PYRAMID_SHAPES:PYRAMID_SHAPES,MIGRATION_VOCAB:MIGRATION_VOCAB,
UNIT_GROUPS:UNIT_GROUPS,TOPICS:TOPICS,CATEGORIES:CATEGORIES,ALL_ITEMS:ALL_ITEMS,
normalize:normalize,distractorCount:distractorCount,prepQuestion:prepQuestion};
})();`);
if (!code.includes('window.__T__')) throw new Error('hook injection mismatch');
global.window = { scrollTo(){} };
global.localStorage = { getItem(){return null;}, setItem(){} };
global.document = { head:{appendChild(){}}, querySelector(){return {innerHTML:'',appendChild(){}};}, createElement(){return {className:'',innerHTML:'',style:{},classList:{add(){},remove(){}},appendChild(){},addEventListener(){}};} };
eval(code);
const T = window.__T__;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.log('FAIL', name, '->', e.message); }
}

console.log('--- Chapter 2 vocabulary ---');
check('vocabulary list has exactly the 28 chapter terms, no duplicates', () => {
  if (T.VOCAB_CORE.length !== 28) throw new Error('expected 28 terms, got ' + T.VOCAB_CORE.length);
  const seen = new Set();
  T.VOCAB_CORE.forEach(w => { if (seen.has(w.term)) throw new Error('duplicate term: ' + w.term); seen.add(w.term); });
});

console.log('--- Demographic Transition Model ---');
check('DTM has exactly 5 stages, numbered 1-5, each fully specified', () => {
  if (T.DTM_STAGES.length !== 5) throw new Error('expected 5 stages, got ' + T.DTM_STAGES.length);
  T.DTM_STAGES.forEach((s, i) => {
    if (s.n !== i + 1) throw new Error('stage out of order at index ' + i);
    ['name','cbr','cdr','rni','examples','why'].forEach(k => { if (!s[k]) throw new Error('stage ' + s.n + ' missing ' + k); });
    if (!s.examples.length) throw new Error('stage ' + s.n + ' has no example countries');
  });
});
check('DTM stage 2 is the widest CBR/CDR gap (highest RNI), matching the model\'s shape', () => {
  const s2 = T.DTM_STAGES.find(s => s.n === 2);
  if (!/very high/i.test(s2.rni)) throw new Error('stage 2 should be described as very high RNI');
});
check('DTM stage 5 is the only stage with a negative RNI', () => {
  const s5 = T.DTM_STAGES.find(s => s.n === 5);
  if (!/negative/i.test(s5.rni)) throw new Error('stage 5 should be described as negative RNI');
  T.DTM_STAGES.filter(s => s.n !== 5).forEach(s => {
    if (/negative/i.test(s.rni)) throw new Error('only stage 5 should show negative RNI, but stage ' + s.n + ' does too');
  });
});

console.log('--- Epidemiologic transition ---');
check('epidemiologic transition has exactly 5 stages, numbered 1-5', () => {
  if (T.EPI_STAGES.length !== 5) throw new Error('expected 5 stages, got ' + T.EPI_STAGES.length);
  T.EPI_STAGES.forEach((s, i) => {
    if (s.n !== i + 1) throw new Error('stage out of order at index ' + i);
    ['name','cause','example'].forEach(k => { if (!s[k]) throw new Error('stage ' + s.n + ' missing ' + k); });
  });
});
check('epidemiologic stages 1-4 map to the same-numbered DTM stage; stage 5 is unmapped (proposed addition)', () => {
  T.EPI_STAGES.forEach(s => {
    if (s.n <= 4 && s.dtm !== s.n) throw new Error('epi stage ' + s.n + ' should map to DTM stage ' + s.n);
    if (s.n === 5 && s.dtm !== null) throw new Error('epi stage 5 should have no fixed DTM match (it\'s the contested addition)');
  });
});

console.log('--- RNI and doubling-time calculations ---');
check('every CBR/CDR calculation in the prompt matches its stated RNI answer', () => {
  T.RNI_CALC_ITEMS.forEach(it => {
    const m = it.prompt.match(/CBR\s*=\s*(-?\d+(?:\.\d+)?),\s*CDR\s*=\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return; // not a CBR/CDR-style prompt (e.g. a doubling-time-only item)
    const cbr = parseFloat(m[1]), cdr = parseFloat(m[2]);
    const expectedRni = (cbr - cdr) / 10;
    const stated = parseFloat(String(it.answer[0]).replace('%', '').replace('−', '-'));
    if (Math.abs(expectedRni - stated) > 0.01) {
      throw new Error('CBR ' + cbr + ', CDR ' + cdr + ' -> RNI should be ' + expectedRni + '%, item says ' + stated + '%');
    }
  });
});
check('every doubling-time calculation matches the Rule of 70', () => {
  T.RNI_CALC_ITEMS.forEach(it => {
    const m = it.prompt.match(/RNI of (-?\d+(?:\.\d+)?)%.*doubling time/i);
    if (!m) return;
    const rni = parseFloat(m[1]);
    const expectedYears = Math.round(70 / rni);
    const stated = parseFloat(String(it.answer[0]));
    if (Math.abs(expectedYears - stated) > 0.5) {
      throw new Error('RNI ' + rni + '% -> doubling time should be ~' + expectedYears + ' years, item says ' + stated);
    }
  });
});

console.log('--- Formula sheet ---');
check('formula sheet has exactly the 10 chapter formulas, no duplicates', () => {
  if (T.FORMULA_SHEET.length !== 10) throw new Error('expected 10 formulas, got ' + T.FORMULA_SHEET.length);
  const seen = new Set();
  T.FORMULA_SHEET.forEach(f => { if (seen.has(f.name)) throw new Error('duplicate formula name: ' + f.name); seen.add(f.name); });
});
check('density formulas (arithmetic/physiological/agricultural) are internally consistent with the formula sheet', () => {
  T.DENSITY_FORMULAS.forEach(df => {
    const sheetEntry = T.FORMULA_SHEET.find(f => f.name === df.name);
    if (!sheetEntry) throw new Error(df.name + ' from density-measures data is missing from the formula sheet');
  });
});

console.log('--- Population pyramids ---');
check('the three pyramid shapes map to three distinct DTM stages', () => {
  const stages = T.PYRAMID_SHAPES.map(p => p.dtm);
  if (new Set(stages).size !== stages.length) throw new Error('two pyramid shapes claim the same DTM stage');
});

console.log('--- Multiple-choice answer keys ---');
check('every fixed-choice item across the whole app has its answer literally present among its choices', () => {
  T.ALL_ITEMS.forEach(it => {
    if (it.choices && it.choices.indexOf(it.answer[0]) === -1) {
      throw new Error(it.id + ': answer "' + it.answer[0] + '" not found in choices ' + JSON.stringify(it.choices));
    }
  });
});
check('every choices array is free of exact duplicate options', () => {
  T.ALL_ITEMS.forEach(it => {
    if (!it.choices) return;
    const seen = new Set();
    it.choices.forEach(c => { if (seen.has(c)) throw new Error(it.id + ' has a duplicate choice: ' + c); seen.add(c); });
  });
});

console.log('--- Topics / categories ---');
check('every topic belongs to a declared category', () => {
  const catIds = new Set(T.CATEGORIES.map(c => c.id));
  T.TOPICS.forEach(t => { if (!catIds.has(t.cat)) throw new Error(t.id + ' has undeclared category ' + t.cat); });
});

console.log('--- Chapter 3 vocabulary (Migration) ---');
const CHAPTER_3_SHEET_TERMS = [
  'Migration','Chain migration','Voluntary migration','Internal migration','Step migration',
  'Counter migration','Immigration','Emigration','Push factors','Pull factors','Gravity Model',
  'Ethnic neighborhoods','Asylum seekers','Refugees','Internally Displaced Persons (IDP)',
  'Remittances','Intervening opportunity','Intervening obstacle','Brain Drain','Brain Gain',
  'Guest workers','Unauthorized immigrant','Selective immigration'
];
check('vocabulary list has exactly the 23 terms from the handout, no duplicates', () => {
  if (T.MIGRATION_VOCAB.length !== 23) throw new Error('expected 23 terms, got ' + T.MIGRATION_VOCAB.length);
  const seen = new Set();
  T.MIGRATION_VOCAB.forEach(w => { if (seen.has(w.term)) throw new Error('duplicate term: ' + w.term); seen.add(w.term); });
});
check('every term numbered on the handout is present, spelled the same way', () => {
  const have = new Set(T.MIGRATION_VOCAB.map(w => w.term));
  CHAPTER_3_SHEET_TERMS.forEach(term => { if (!have.has(term)) throw new Error('handout term missing or renamed: ' + term); });
});
check('no term beyond the 23 on the handout was added', () => {
  const allowed = new Set(CHAPTER_3_SHEET_TERMS);
  T.MIGRATION_VOCAB.forEach(w => { if (!allowed.has(w.term)) throw new Error('term not on the handout: ' + w.term); });
});
check('every definition is a distinct, non-empty sentence', () => {
  const seen = new Set();
  T.MIGRATION_VOCAB.forEach(w => {
    if (!w.def || w.def.length < 10) throw new Error(w.term + ' has no real definition');
    if (seen.has(w.def)) throw new Error('two terms share an identical definition: ' + w.term);
    seen.add(w.def);
  });
});
check('refugees, asylum seekers, and IDPs are kept distinct (the classic mix-up)', () => {
  const byTerm = {}; T.MIGRATION_VOCAB.forEach(w => { byTerm[w.term] = w.def; });
  if (!/border/i.test(byTerm['Refugees'])) throw new Error('Refugees should be defined by crossing an international border');
  if (!/own country|within/i.test(byTerm['Internally Displaced Persons (IDP)'])) throw new Error('IDP should be defined as staying inside their own country');
  if (!/not yet|has not|whose claim/i.test(byTerm['Asylum seekers'])) throw new Error('Asylum seekers should be defined as not-yet-confirmed refugees');
});

console.log('--- Unit grouping ---');
check('every topic is grouped into exactly one unit, and every grouped id is a real topic', () => {
  const topicIds = T.TOPICS.map(t => t.id);
  const grouped = [].concat(...T.UNIT_GROUPS.map(g => g.topicIds));
  topicIds.forEach(id => { if (grouped.indexOf(id) === -1) throw new Error(id + ' is not in any unit group'); });
  grouped.forEach(id => { if (topicIds.indexOf(id) === -1) throw new Error('unit group references unknown topic id: ' + id); });
  const seen = new Set();
  grouped.forEach(id => { if (seen.has(id)) throw new Error(id + ' appears in more than one unit group'); seen.add(id); });
});
check('migration-vocab sits in Chapter 3, not folded into Chapter 2', () => {
  const ch3 = T.UNIT_GROUPS.find(g => g.id === 'chapter-3');
  if (!ch3 || ch3.topicIds.indexOf('migration-vocab') === -1) throw new Error('migration-vocab is not in the Chapter 3 unit group');
});

console.log('--- Fairness of the questions themselves ---');
check('a decimal answer is not graded the same as the number ten times larger', () => {
  // RNI 1.4% and a rate of 14% differ by a factor of ten. normalize() used to
  // strip the decimal point, so "14%" was accepted for "1.4%" both as a typed
  // answer and as a clicked option — in the one topic where dividing by ten is
  // the entire skill being tested.
  const pairs = [['1.4%','14%'], ['2.5%','25%'], ['1.25%','125%'], ['0.5%','5%']];
  pairs.forEach(([a, b]) => {
    if (T.normalize(a) === T.normalize(b)) {
      throw new Error(a + ' and ' + b + ' both normalize to "' + T.normalize(a) + '"');
    }
  });
  // ...while the forms a student might reasonably type are still equivalent.
  if (T.normalize('1.4%') !== T.normalize('1.4')) throw new Error('1.4% should still match 1.4');
});

check('no question shows an option that is also a correct answer to it', () => {
  // Several topics built their wrong options from the same list the answer came
  // from, so every option displayed was correct and only one was accepted.
  const byPrompt = {};
  T.ALL_ITEMS.forEach(i => {
    if (!i.pool) return;
    const k = i.topic + '||' + String(i.prompt).replace(/<[^>]*>/g, '').trim();
    (byPrompt[k] = byPrompt[k] || []).push(i);
  });
  Object.entries(byPrompt).forEach(([k, group]) => {
    group.forEach(item => {
      const mine = new Set(item.answer.map(T.normalize));
      group.forEach(sib => {
        if (sib === item) return;
        const sibAns = T.normalize(sib.answer[0]);
        if (mine.has(sibAns)) return;
        if (item.pool.some(p => T.normalize(p) === sibAns)) {
          throw new Error(item.id + ' can show "' + sib.answer[0] + '", which is the accepted answer for ' + sib.id);
        }
      });
    });
  });
});

check('no item is asked as multiple choice with nothing to choose between', () => {
  T.ALL_ITEMS.forEach(i => {
    if (T.distractorCount(i) >= 1) return;
    const q = T.prepQuestion(i, null);
    if (q.mode === 'mc') throw new Error(i.id + ' renders as multiple choice with no wrong option');
  });
});

check('every rendered multiple choice offers at least two options', () => {
  T.ALL_ITEMS.forEach(i => {
    const q = T.prepQuestion(i, 'mc');
    if (q.mode === 'mc' && q.opts.length < 2) {
      throw new Error(i.id + ' renders ' + q.opts.length + ' option(s)');
    }
  });
});

check('no prompt that can be asked typed has more than one accepted answer', () => {
  // A shared prompt is fine while the options are on screen — "which of these
  // is a common factor" legitimately has five right answers, and each card
  // offers one of them against genuinely wrong ones. It stops being fine the
  // moment the card is asked typed, because then nothing on screen says which
  // of the five is wanted. Items declared type:'mc' always render as choices,
  // so only the rest are at risk.
  const seen = {};
  T.ALL_ITEMS.forEach(i => {
    if (i.type === 'mc') return;
    const k = i.topic + '||' + T.normalize(String(i.prompt).replace(/<[^>]*>/g, ''));
    (seen[k] = seen[k] || []).push(i);
  });
  Object.entries(seen).forEach(([k, g]) => {
    if (g.length < 2) return;
    const answers = new Set(g.map(x => T.normalize(x.answer[0])));
    if (answers.size > 1) {
      throw new Error('typed prompt "' + k.split('||')[1].slice(0, 60) + '" accepts ' + answers.size +
        ' different answers across ' + g.map(x => x.id).join(', '));
    }
  });
});

console.log(failures === 0 ? 'ALL ACCURACY CHECKS PASSED' : (failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
