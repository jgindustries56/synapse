const fs = require('fs');
const html = fs.readFileSync(__dirname + '/subjects/aphg.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
let code = scriptBody.replace(/\n  applyDisplaySettings\(\);[\s\S]*?\n\}\)\(\);\s*$/, `
window.__T__={VOCAB_CORE:VOCAB_CORE,DTM_STAGES:DTM_STAGES,EPI_STAGES:EPI_STAGES,RNI_CALC_ITEMS:RNI_CALC_ITEMS,
FORMULA_SHEET:FORMULA_SHEET,DENSITY_FORMULAS:DENSITY_FORMULAS,POLICY_CASES:POLICY_CASES,LIFE_EXP_EXTREMES:LIFE_EXP_EXTREMES,
CENSUS_FACTS:CENSUS_FACTS,MALTHUS_FACTS:MALTHUS_FACTS,PYRAMID_SHAPES:PYRAMID_SHAPES,TOPICS:TOPICS,CATEGORIES:CATEGORIES,ALL_ITEMS:ALL_ITEMS};
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

console.log(failures === 0 ? 'ALL ACCURACY CHECKS PASSED' : (failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
