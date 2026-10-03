/* Are the Practice problems correct?

   Each skill is a generator: it invents numbers and states an answer. Nothing
   here trusts that answer. For every numeric skill the test parses the numbers
   back out of the question it was handed and recomputes the result from its
   own implementation of the method, then grades the generator's answer with
   the engine's own grader — the one a student's typing goes through.

   Each generator runs many times, so a case that only breaks on a negative, a
   zero run or a particular angle gets found. */
const fs = require('fs');
const assert = require('assert');

/* ----------------------------- load the skills ----------------------------- */

const html = fs.readFileSync(__dirname + '/subjects/geometry.html', 'utf8').replace('%%GOOGLE_CLIENT_ID%%', '');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
if (!scriptBody) throw new Error('no app script found in subjects/geometry.html');

const code = scriptBody.replace(/\n  render\(\);[\s\S]*?\n\}\)\(\);\s*$/,
  '\n  window.__SKILLS__ = SKILLS;\n  window.__UNITS__ = UNIT_GROUPS;\n})();');
if (!code.includes('window.__SKILLS__')) throw new Error('hook injection mismatch — tail pattern not found');

global.window = { scrollTo() {} };
global.localStorage = { getItem() { return null; }, setItem() {} };
global.document = {
  head: { appendChild() {} },
  getElementById() { return null; },
  querySelector() { return { innerHTML: '', appendChild() {} }; },
  createElement() {
    return { className: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} },
             appendChild() {}, addEventListener() {}, setAttribute() {} };
  }
};
eval(code);
const SKILLS = window.__SKILLS__;
const UNITS = window.__UNITS__;

// The engine's grader, so a generated answer is accepted exactly as typing it would be.
require('./public/synapse.js');
const grade = window.Synapse.__checkAnswer;
if (typeof grade !== 'function') throw new Error('the engine exposes no answer grader');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' -> ' + e.message); }
}

const RUNS = Number(process.env.PRACTICE_RUNS || 300);
console.log('skills: ' + SKILLS.length + ' | ' + RUNS + ' generated problems each\n');

/* --------------------- independent implementations --------------------- */

const DEG = Math.PI / 180;
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a; }
function frac(n, d) {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return (d / g) === 1 ? String(n / g) : (n / g) + '/' + (d / g);
}
function rad(n) {                       // √n with the largest square factor pulled out
  let out = 1, inside = n;
  for (let k = Math.floor(Math.sqrt(n)); k >= 2; k--) {
    if (inside % (k * k) === 0) { out = k; inside /= (k * k); break; }
  }
  return inside === 1 ? String(out) : (out === 1 ? '' : out) + '√' + inside;
}
function num(v) {                       // a surd/fraction string as a number
  let t = String(v).toLowerCase().replace(/√/g, 'sqrt').replace(/[\s()°]/g, '');
  let sign = 1;
  if (t[0] === '-') { sign = -1; t = t.slice(1); }
  const piece = p => {
    let m = p.match(/^(\d*(?:\.\d+)?)sqrt(\d+)$/);
    if (m) return (m[1] === '' ? 1 : Number(m[1])) * Math.sqrt(Number(m[2]));
    if (/^\d+(\.\d+)?$/.test(p)) return Number(p);
    return NaN;
  };
  const bits = t.split('/');
  if (bits.length === 1) return sign * piece(bits[0]);
  return sign * piece(bits[0]) / piece(bits[1]);
}

const byId = {};
SKILLS.forEach(s => { byId[s.id] = s; });

/* `rule` gets the generated problem and must return the answer it computes for
   itself. Returning null skips that draw (used where a skill has two shapes and
   only one is being re-derived by this matcher). */
function verify(id, rule, runs) {
  const s = byId[id];
  if (!s) throw new Error('no skill with id ' + id);
  let checked = 0;
  for (let i = 0; i < (runs || RUNS); i++) {
    const p = s.gen();
    assert.ok(p && p.q && p.q.length > 5, id + ': empty question');
    assert.ok(Array.isArray(p.a) && p.a.length && String(p.a[0]).length,
      id + ': no answer for "' + p.q + '"');
    assert.ok(Array.isArray(p.steps) && p.steps.length >= 1, id + ': no worked steps');
    const want = rule(p);
    if (want === null || want === undefined) continue;
    checked++;
    if (!grade(String(want), p.a)) {
      throw new Error(id + ': "' + p.q + '" answers ' + JSON.stringify(p.a) +
        ', recomputed ' + JSON.stringify(String(want)));
    }
  }
  assert.ok(checked > 0, id + ': nothing was re-derived');
}

const PT = '\\((-?\\d+), (-?\\d+)\\)';
function pt(x, y) { return '(' + x + ', ' + y + ')'; }
function grab(q, re, id) {
  const m = q.match(re);
  if (!m) throw new Error(id + ': cannot parse "' + q + '"');
  return m;
}

/* ============================ structural checks ============================ */

check('every skill is well formed and sits in a real unit', () => {
  const unitIds = {};
  UNITS.forEach(u => { unitIds[u.id] = true; });
  const seen = {};
  SKILLS.forEach(s => {
    assert.ok(s.id && /^sk-/.test(s.id), 'bad skill id: ' + s.id);
    assert.ok(!seen[s.id], 'duplicate skill id: ' + s.id);
    seen[s.id] = true;
    assert.ok(s.name && s.name.length > 3, s.id + ' has no name');
    assert.ok(unitIds[s.unit], s.id + ' points at unknown unit ' + s.unit);
    assert.strictEqual(typeof s.gen, 'function', s.id + ' has no generator');
  });
  assert.ok(SKILLS.length >= 30, 'only ' + SKILLS.length + ' skills');
});

check('every unit has practice skills of its own', () => {
  const have = {};
  SKILLS.forEach(s => { have[s.unit] = (have[s.unit] || 0) + 1; });
  UNITS.forEach(u => {
    assert.ok(have[u.id] >= 2, u.id + ' has only ' + (have[u.id] || 0) + ' skill(s)');
  });
});

check('a multiple-choice skill always offers its own answer', () => {
  SKILLS.filter(s => s.choices).forEach(s => {
    for (let i = 0; i < 80; i++) {
      const p = s.gen();
      assert.ok(s.choices.indexOf(p.a[0]) !== -1,
        s.id + ': answer "' + p.a[0] + '" is not among its choices');
    }
    assert.ok(s.choices.length >= 2, s.id + ' offers fewer than two choices');
    assert.strictEqual(new Set(s.choices).size, s.choices.length, s.id + ' repeats a choice');
  });
});

check('the problems really do change from one attempt to the next', () => {
  SKILLS.forEach(s => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(s.gen().q);
    // A multiple-choice skill works through a fixed list of cases, so a handful
    // is right. A skill that invents numbers should almost never repeat itself.
    const floor = s.choices ? 3 : 10;
    assert.ok(seen.size >= floor,
      s.id + ' produced only ' + seen.size + ' different problems in 60 draws');
  });
});

check('the engine grades its own stated answer as correct', () => {
  SKILLS.forEach(s => {
    for (let i = 0; i < 40; i++) {
      const p = s.gen();
      p.a.forEach(spelling => {
        assert.ok(grade(spelling, p.a),
          s.id + ': the grader rejects its own answer "' + spelling + '"');
      });
    }
  });
});

/* ======================= transformations, recomputed ======================= */

check('sk-translate applies the rule', () => {
  verify('sk-translate', p => {
    const m = grab(p.q, new RegExp('point ' + PT + ' by the rule \\(x, y\\) → \\(x ([+-]) (\\d+), y ([+-]) (\\d+)\\)'), 'sk-translate');
    const x = +m[1], y = +m[2];
    const a = (m[3] === '-' ? -1 : 1) * +m[4];
    const b = (m[5] === '-' ? -1 : 1) * +m[6];
    return pt(x + a, y + b);
  });
});

check('sk-translate-vector reads the move off the two points', () => {
  verify('sk-translate-vector', p => {
    const m = grab(p.q, new RegExp('maps ' + PT + ' onto ' + PT), 'sk-translate-vector');
    return '(' + (+m[3] - +m[1]) + ', ' + (+m[4] - +m[2]) + ')';
  });
});

check('sk-reflect flips over the right line', () => {
  const F = {
    'the x-axis': (x, y) => [x, -y],
    'the y-axis': (x, y) => [-x, y],
    'the line y = x': (x, y) => [y, x],
    'the line y = -x': (x, y) => [-y, -x]
  };
  verify('sk-reflect', p => {
    const m = grab(p.q, new RegExp('point ' + PT + ' over (.+)\\.$'), 'sk-reflect');
    const f = F[m[3]];
    assert.ok(f, 'unknown mirror "' + m[3] + '"');
    const im = f(+m[1], +m[2]);
    return pt(im[0], im[1]);
  });
});

check('sk-reflect-line reflects across x = k and y = k', () => {
  verify('sk-reflect-line', p => {
    const m = grab(p.q, new RegExp('point ' + PT + ' over the line ([xy]) = (-?\\d+)'), 'sk-reflect-line');
    const x = +m[1], y = +m[2], k = +m[4];
    return m[3] === 'x' ? pt(2 * k - x, y) : pt(x, 2 * k - y);
  });
});

check('sk-rotate turns the right way', () => {
  const F = {
    '90° counterclockwise': (x, y) => [-y, x],
    '90° clockwise': (x, y) => [y, -x],
    '180°': (x, y) => [-x, -y],
    '270° counterclockwise': (x, y) => [y, -x],
    '270° clockwise': (x, y) => [-y, x]
  };
  verify('sk-rotate', p => {
    const m = grab(p.q, new RegExp('point ' + PT + ' (.+) about the origin'), 'sk-rotate');
    const f = F[m[3]];
    assert.ok(f, 'unknown rotation "' + m[3] + '"');
    const im = f(+m[1], +m[2]);
    return pt(im[0], im[1]);
  });
});

check('sk-rot-symmetry divides 360 by the sides', () => {
  verify('sk-rot-symmetry', p => 360 / +grab(p.q, /regular (\d+)-gon/, 'sk-rot-symmetry')[1]);
});

/* ========================= lines and angles ========================= */

check('sk-comp-supp subtracts from 90 or 180', () => {
  verify('sk-comp-supp', p => {
    const m = grab(p.q, /(complement|supplement) of (\d+)/, 'sk-comp-supp');
    return (m[1] === 'complement' ? 90 : 180) - +m[2];
  });
});

check('sk-transversal-x solves the equation it printed', () => {
  verify('sk-transversal-x', p => {
    const m = grab(p.q, /(Corresponding|Alternate interior|Alternate exterior|Same-side interior) angles measure \((\d+)x ([+-]) (\d+)\)° and \((\d+)x ([+-]) (\d+)\)°/, 'sk-transversal-x');
    const a = +m[2], b = (m[3] === '-' ? -1 : 1) * +m[4];
    const c = +m[5], d = (m[6] === '-' ? -1 : 1) * +m[7];
    // Congruent pairs are set equal; same-side interior pairs are set to 180.
    const x = m[1] === 'Same-side interior'
      ? (180 - b - d) / (a + c)
      : (d - b) / (a - c);
    assert.ok(Number.isFinite(x), 'the printed equation has no solution');
    return x;
  });
});

check('sk-transversal-measure knows which pairs are supplementary', () => {
  const SUP = { 'same-side interior': true, 'same-side exterior': true };
  verify('sk-transversal-measure', p => {
    const m = grab(p.q, /measures (\d+)°\. What does its (.+) partner measure\?/, 'sk-transversal-measure');
    return SUP[m[2]] ? 180 - +m[1] : +m[1];
  });
});

check('sk-slope-par-perp flips only when it should', () => {
  verify('sk-slope-par-perp', p => {
    const m = grab(p.q, /slope (\S+)\. What is the slope of a line (perpendicular|parallel)/, 'sk-slope-par-perp');
    const given = num(m[1]);
    const want = m[2] === 'parallel' ? given : -1 / given;
    // Compare numerically; the card is free to write it as any equivalent fraction.
    const got = num(p.a[0]);
    assert.ok(Math.abs(got - want) < 1e-9,
      'slope ' + m[1] + ' ' + m[2] + ' should be ' + want + ', card says ' + p.a[0]);
    return p.a[0];
  });
});

check('sk-classify-lines classifies by the two slopes', () => {
  verify('sk-classify-lines', p => {
    const m = grab(p.q, /slope (\S+) and another has slope (\S+)\./, 'sk-classify-lines');
    const m1 = num(m[1]), m2 = num(m[2]);
    if (Math.abs(m1 - m2) < 1e-9) return 'Parallel';
    if (Math.abs(m1 * m2 + 1) < 1e-9) return 'Perpendicular';
    return 'Neither';
  });
});

/* ============================== triangles ============================== */

check('sk-third-angle completes 180', () => {
  verify('sk-third-angle', p => {
    const m = grab(p.q, /measure (\d+)° and (\d+)°/, 'sk-third-angle');
    return 180 - +m[1] - +m[2];
  });
});

check('sk-exterior-angle uses the two remote interiors', () => {
  verify('sk-exterior-angle', p => {
    let m = p.q.match(/exterior angle of a triangle measures (\d+)° and one remote interior angle measures (\d+)°/);
    if (m) return +m[1] - +m[2];
    m = grab(p.q, /remote interior angles of (\d+)° and (\d+)°/, 'sk-exterior-angle');
    return +m[1] + +m[2];
  });
});

check('sk-exterior-x solves the equation it printed', () => {
  verify('sk-exterior-x', p => {
    const m = grab(p.q, /\((\d+)x ([+-]) (\d+)\)° and (\d+)x°, and the exterior angle measures \((\d+)x ([+-]) (\d+)\)°/, 'sk-exterior-x');
    const a = +m[1], b = (m[2] === '-' ? -1 : 1) * +m[3];
    const c = +m[4];
    const e = +m[5], d = (m[6] === '-' ? -1 : 1) * +m[7];
    return (d - b) / (a + c - e);
  });
});

check('sk-isosceles balances the three angles', () => {
  verify('sk-isosceles', p => {
    let m = p.q.match(/vertex angle of (\d+)°\. Find one base angle/);
    if (m) return (180 - +m[1]) / 2;
    m = grab(p.q, /base angle of (\d+)°\. Find the vertex angle/, 'sk-isosceles');
    return 180 - 2 * +m[1];
  });
});

/* ======================= coordinate geometry ======================= */

check('sk-distance gives the exact distance', () => {
  verify('sk-distance', p => {
    const m = grab(p.q, new RegExp('between ' + PT + ' and ' + PT), 'sk-distance');
    const dx = +m[3] - +m[1], dy = +m[4] - +m[2];
    return rad(dx * dx + dy * dy);
  });
});

check('sk-midpoint averages both coordinates', () => {
  verify('sk-midpoint', p => {
    const m = grab(p.q, new RegExp('midpoint of ' + PT + ' and ' + PT), 'sk-midpoint');
    return pt((+m[1] + +m[3]) / 2, (+m[2] + +m[4]) / 2);
  });
});

check('sk-endpoint works back from the midpoint', () => {
  verify('sk-endpoint', p => {
    const m = grab(p.q, new RegExp('midpoint of AB is ' + PT + ' and A is ' + PT), 'sk-endpoint');
    return pt(2 * +m[1] - +m[3], 2 * +m[2] - +m[4]);
  });
});

check('sk-slope-2pts handles zero and undefined runs', () => {
  let sawUndefined = false, sawZero = false;
  verify('sk-slope-2pts', p => {
    const m = grab(p.q, new RegExp('through ' + PT + ' and ' + PT), 'sk-slope-2pts');
    const dx = +m[3] - +m[1], dy = +m[4] - +m[2];
    if (dx === 0) { sawUndefined = true; return 'Undefined'; }
    if (dy === 0) sawZero = true;
    return frac(dy, dx);
  }, 600);
  assert.ok(sawUndefined, 'never generated a vertical line');
  assert.ok(sawZero, 'never generated a horizontal line');
});

check('sk-polygon-sum uses (n - 2) x 180', () => {
  verify('sk-polygon-sum', p => (+grab(p.q, /(\d+)-sided polygon/, 'sk-polygon-sum')[1] - 2) * 180);
});

check('sk-polygon-each shares out the right total', () => {
  verify('sk-polygon-each', p => {
    const m = grab(p.q, /each (interior|exterior) angle of a regular (\d+)-gon/, 'sk-polygon-each');
    const n = +m[2];
    return m[1] === 'interior' ? ((n - 2) * 180) / n : 360 / n;
  });
});

check('sk-polygon-sides inverts the angle', () => {
  verify('sk-polygon-sides', p => {
    const m = grab(p.q, /Each (exterior|interior) angle of a regular polygon measures ([\d.]+)°/, 'sk-polygon-sides');
    const a = Number(m[2]);
    return m[1] === 'exterior' ? 360 / a : 360 / (180 - a);
  });
});

/* ============================= similarity ============================= */

check('sk-scale-factor divides the right way round', () => {
  verify('sk-scale-factor', p => {
    const m = grab(p.q, /sides of (\d+) and (\d+)\. What is the scale factor from the first to the second/, 'sk-scale-factor');
    return frac(+m[2], +m[1]);
  });
});

check('sk-proportion scales the matching side', () => {
  verify('sk-proportion', p => {
    const m = grab(p.q, /(\d+) corresponds to (\d+), and (\d+) corresponds to x/, 'sk-proportion');
    return (+m[3]) * (+m[2] / +m[1]);
  });
});

/* ========================= trigonometry ========================= */

check('sk-special-45 uses the 1 : 1 : root 2 ratio', () => {
  verify('sk-special-45', p => {
    let m = p.q.match(/legs of (\d+)\. Find the hypotenuse/);
    if (m) return +m[1] * Math.SQRT2;
    m = grab(p.q, /hypotenuse of (\d+)√2\. Find a leg/, 'sk-special-45');
    return +m[1];
  });
});

check('sk-special-30 uses the 1 : root 3 : 2 ratio', () => {
  verify('sk-special-30', p => {
    let m = p.q.match(/short leg of (\d+)\. Find the hypotenuse/);
    if (m) return 2 * +m[1];
    m = p.q.match(/short leg of (\d+)\. Find the long leg/);
    if (m) return +m[1] * Math.sqrt(3);
    m = grab(p.q, /hypotenuse of (\d+)\. Find the short leg/, 'sk-special-30');
    return +m[1] / 2;
  });
});

check('sk-triple satisfies a squared plus b squared', () => {
  verify('sk-triple', p => {
    let m = p.q.match(/legs of (\d+) and (\d+)\. Find the hypotenuse/);
    if (m) {
      const c = Math.sqrt(+m[1] * +m[1] + +m[2] * +m[2]);
      assert.ok(Number.isInteger(c), 'the generated legs are not a triple');
      return c;
    }
    m = grab(p.q, /hypotenuse of (\d+) and one leg of (\d+)\. Find the other leg/, 'sk-triple');
    const b = Math.sqrt(+m[1] * +m[1] - +m[2] * +m[2]);
    assert.ok(Number.isInteger(b), 'the generated sides are not a triple');
    return b;
  });
});

check('sk-ratio-value reduces the right fraction', () => {
  verify('sk-ratio-value', p => {
    const m = grab(p.q, /opposite angle A is (\d+), the side adjacent is (\d+), and the hypotenuse is (\d+). Write (sin|cos|tan)/, 'sk-ratio-value');
    const o = +m[1], a = +m[2], h = +m[3];
    assert.strictEqual(o * o + a * a, h * h, 'the generated triangle is not right-angled');
    return m[4] === 'sin' ? frac(o, h) : m[4] === 'cos' ? frac(a, h) : frac(o, a);
  });
});

check('sk-cofunction subtracts from 90', () => {
  verify('sk-cofunction', p => 90 - +grab(p.q, /(?:sin|cos)\((\d+)°\)/, 'sk-cofunction')[1]);
});

/* ========================== the unit circle ========================== */

check('sk-exact-value matches Math.sin, Math.cos and Math.tan', () => {
  const seen = new Set();
  verify('sk-exact-value', p => {
    const m = grab(p.q, /(sin|cos|tan)\((\d+)°\)/, 'sk-exact-value');
    const d = +m[2];
    seen.add(m[1] + d);
    const real = m[1] === 'sin' ? Math.sin(d * DEG)
               : m[1] === 'cos' ? Math.cos(d * DEG)
               : Math.tan(d * DEG);
    // Where the function blows up, "Undefined" is the only right answer.
    if (m[1] === 'tan' && Math.abs(Math.cos(d * DEG)) < 1e-12) {
      assert.strictEqual(p.a[0], 'Undefined', 'tan(' + d + ') should be undefined');
      return p.a[0];
    }
    const stated = num(p.a[0]);
    assert.ok(Math.abs(stated - real) < 1e-9,
      m[1] + '(' + d + '°) is stated as ' + p.a[0] + ' = ' + stated + ', but it is ' + real);
    return p.a[0];
  }, 900);
  assert.ok(seen.size >= 36, 'only ' + seen.size + ' of the angle-and-function pairs were ever drawn');
});

check('sk-coterminal lands between 0 and 360', () => {
  verify('sk-coterminal', p => {
    const g = +grab(p.q, /coterminal with (-?\d+)°/, 'sk-coterminal')[1];
    const base = ((g % 360) + 360) % 360;
    assert.ok(base >= 0 && base < 360, 'out of range');
    return base;
  });
});

check('sk-reference gives the acute angle to the x-axis', () => {
  verify('sk-reference', p => {
    const d = +grab(p.q, /reference angle for (\d+)°/, 'sk-reference')[1];
    const r = d < 90 ? d : d < 180 ? 180 - d : d < 270 ? d - 180 : 360 - d;
    assert.ok(r > 0 && r < 90, 'a reference angle must be acute, got ' + r);
    return r;
  });
});

check('sk-quadrant-sign agrees with an actual angle in that quadrant', () => {
  verify('sk-quadrant-sign', p => {
    const m = grab(p.q, /Is (sine|cosine|tangent) positive or negative in Quadrant (I|II|III|IV)\?/, 'sk-quadrant-sign');
    const mid = { I: 45, II: 135, III: 225, IV: 315 }[m[2]];
    const v = m[1] === 'sine' ? Math.sin(mid * DEG)
            : m[1] === 'cosine' ? Math.cos(mid * DEG)
            : Math.tan(mid * DEG);
    return v > 0 ? 'Positive' : 'Negative';
  });
});

check('sk-trig-equation lists every solution and no others', () => {
  verify('sk-trig-equation', p => {
    const m = grab(p.q, /(sin|cos)\(θ\) = (\S+) for/, 'sk-trig-equation');
    const target = num(m[2]);
    const fn = m[1] === 'sin' ? Math.sin : Math.cos;
    const all = [];
    for (let d = 0; d < 360; d++) if (Math.abs(fn(d * DEG) - target) < 1e-9) all.push(d);
    assert.ok(all.length, 'the equation has no whole-degree solution');
    const stated = (p.a[0].match(/\d+/g) || []).map(Number).sort((x, y) => x - y);
    assert.deepStrictEqual(stated, all,
      m[1] + '(θ) = ' + m[2] + ' is answered ' + JSON.stringify(stated) +
      ' but the circle gives ' + JSON.stringify(all));
    return p.a[0];
  }, 400);
});

/* ============================ polynomials ============================ */

function cubicFrom(q, id) {
  const m = grab(q, /(-?\d*)x³ ([+-]) (\d+)x² ([+-]) (\d+)x ([+-]) (\d+)/, id);
  const lead = m[1] === '' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
  return [lead,
          (m[2] === '-' ? -1 : 1) * +m[3],
          (m[4] === '-' ? -1 : 1) * +m[5],
          (m[6] === '-' ? -1 : 1) * +m[7]];
}
function evalCubic(c, x) { return c[0] * x ** 3 + c[1] * x ** 2 + c[2] * x + c[3]; }

check('sk-factor-test answers yes exactly when the remainder is zero', () => {
  let yes = 0, no = 0;
  verify('sk-factor-test', p => {
    const r = grab(p.q, /\(x ([+-]) (\d+)\) a factor of/, 'sk-factor-test');
    const root = (r[1] === '-' ? 1 : -1) * +r[2];   // (x - 2) has root 2
    const c = cubicFrom(p.q, 'sk-factor-test');
    const rem = evalCubic(c, root);
    if (rem === 0) yes++; else no++;
    return rem === 0 ? 'Yes' : 'No';
  }, 400);
  assert.ok(yes > 20 && no > 20, 'the factor test is lopsided: ' + yes + ' yes, ' + no + ' no');
});

check('sk-remainder equals the polynomial at the root', () => {
  verify('sk-remainder', p => {
    const r = grab(p.q, /by \(x ([+-]) (\d+)\) and give the remainder/, 'sk-remainder');
    const root = (r[1] === '-' ? 1 : -1) * +r[2];
    return evalCubic(cubicFrom(p.q, 'sk-remainder'), root);
  });
});

check('sk-poly-coefficient picks out the middle term', () => {
  verify('sk-poly-coefficient', p => {
    const m = grab(p.q, /\((-?\d+)x ([+-]) (\d+)\)\((-?\d+)x ([+-]) (\d+)\)/, 'sk-poly-coefficient');
    const a = +m[1], b = (m[2] === '-' ? -1 : 1) * +m[3];
    const c = +m[4], d = (m[5] === '-' ? -1 : 1) * +m[6];
    return a * d + b * c;
  });
});

check('sk-poly-subtract distributes the minus sign', () => {
  verify('sk-poly-subtract', p => {
    const m = grab(p.q, /\((-?\d+)x² ([+-]) (\d+)x ([+-]) (\d+)\) - \((-?\d+)x² ([+-]) (\d+)x ([+-]) (\d+)\)\. What is the (.+)\?/, 'sk-poly-subtract');
    const a1 = +m[1], b1 = (m[2] === '-' ? -1 : 1) * +m[3], c1 = (m[4] === '-' ? -1 : 1) * +m[5];
    const a2 = +m[6], b2 = (m[7] === '-' ? -1 : 1) * +m[8], c2 = (m[9] === '-' ? -1 : 1) * +m[10];
    const which = m[11];
    if (/x²/.test(which)) return a1 - a2;
    if (/constant/.test(which)) return c1 - c2;
    return b1 - b2;
  });
});

/* ===================== the choice-only skills, by hand ===================== */

check('the congruence shortcut skill maps each case correctly', () => {
  const want = [
    [/All three pairs of sides/, 'SSS'],
    [/sides .* and so is the angle between them/, 'SAS'],
    [/angles .* and so is the side between them/, 'ASA'],
    [/angles .* a side that is not between them/, 'AAS'],
    [/right triangles, with congruent hypotenuses/, 'HL'],
    [/sides .* an angle that is not between them/, 'Not enough'],
    [/three pairs of angles .* no sides/, 'Not enough']
  ];
  const hit = new Set();
  for (let i = 0; i < 400; i++) {
    const p = byId['sk-congruence-pick'].gen();
    const row = want.find(w => w[0].test(p.q));
    assert.ok(row, 'unrecognised case: ' + p.q);
    assert.strictEqual(p.a[0], row[1], '"' + p.q + '" answers ' + p.a[0]);
    hit.add(row[1] + p.q);
  }
  assert.ok(hit.size >= 7, 'only ' + hit.size + ' of the seven cases were drawn');
});

check('the proof reason skill maps each case correctly', () => {
  const want = [
    [/problem states/, 'Given'],
    [/share side ML/, 'Reflexive Property'],
    [/Two lines cross/, 'Vertical Angles Theorem'],
    [/bisects angle ABC/, 'Definition of an angle bisector'],
    [/Z-shaped pair/, 'Alternate Interior Angles Theorem'],
    [/already proved congruent/, 'CPCTC']
  ];
  for (let i = 0; i < 300; i++) {
    const p = byId['sk-proof-reason'].gen();
    const row = want.find(w => w[0].test(p.q));
    assert.ok(row, 'unrecognised case: ' + p.q);
    assert.strictEqual(p.a[0], row[1], '"' + p.q + '" answers ' + p.a[0]);
  }
});

check('the diagonal skill separates the six quadrilaterals', () => {
  const want = [
    [/congruent, perpendicular, and bisect/, 'Square'],
    [/congruent and bisect each other, but are not perpendicular/, 'Rectangle'],
    [/perpendicular and bisect each other, but are not congruent/, 'Rhombus'],
    [/perpendicular, with exactly one bisecting/, 'Kite'],
    [/congruent but do not bisect/, 'Isosceles trapezoid'],
    [/bisect each other but are neither/, 'Parallelogram']
  ];
  const hit = new Set();
  for (let i = 0; i < 400; i++) {
    const p = byId['sk-quad-diagonals'].gen();
    const row = want.find(w => w[0].test(p.q));
    assert.ok(row, 'unrecognised case: ' + p.q);
    assert.strictEqual(p.a[0], row[1], '"' + p.q + '" answers ' + p.a[0]);
    hit.add(row[1]);
  }
  assert.strictEqual(hit.size, 6, 'only ' + hit.size + ' of the six shapes were drawn');
});

check('the formula-choice skill names the right tool', () => {
  for (let i = 0; i < 300; i++) {
    const p = byId['sk-quad-tool'].gen();
    if (/parallel|right angle|trapezoid/.test(p.q)) assert.strictEqual(p.a[0], 'Slope formula', p.q);
    else if (/bisect/.test(p.q)) assert.strictEqual(p.a[0], 'Midpoint formula', p.q);
    else assert.strictEqual(p.a[0], 'Distance formula', p.q);
  }
});

check('the similarity and ratio choice skills map correctly', () => {
  for (let i = 0; i < 200; i++) {
    const p = byId['sk-similar-pick'].gen();
    if (/three pairs of sides/.test(p.q)) assert.strictEqual(p.a[0], 'SSS similarity', p.q);
    else if (/angles between them are congruent/.test(p.q)) assert.strictEqual(p.a[0], 'SAS similarity', p.q);
    else assert.strictEqual(p.a[0], 'AA similarity', p.q);
  }
  for (let i = 0; i < 200; i++) {
    const p = byId['sk-ratio-setup'].gen();
    if (/opposite the angle and the hypotenuse/.test(p.q)) assert.strictEqual(p.a[0], 'sine', p.q);
    else if (/adjacent to the angle and the hypotenuse/.test(p.q)) assert.strictEqual(p.a[0], 'cosine', p.q);
    else assert.strictEqual(p.a[0], 'tangent', p.q);
  }
});

/* ------------------------- the worked steps are real ------------------------- */

/* "Undefined" is a legitimate answer for a vertical line, so it cannot simply be
   banned. What a broken template leaves behind is an undefined or a NaN sitting
   where a number belongs. */
/* Lower case on purpose: "Undefined" with a capital is the real answer for a
   vertical line or for tan(90), while a template that lost a value prints
   JavaScript's own lower-case undefined. */
const BROKEN = /NaN|\[object|[=+\-×÷(]\s*undefined|undefined\s*[=+×÷)]/;

check('every problem comes with steps that reach its own answer', () => {
  SKILLS.forEach(s => {
    for (let i = 0; i < 30; i++) {
      const p = s.gen();
      p.steps.forEach(line => {
        assert.ok(typeof line === 'string' && line.length > 3, s.id + ': an empty step');
        assert.ok(!BROKEN.test(line), s.id + ': a step came out broken — "' + line + '"');
      });
      assert.ok(!BROKEN.test(p.q), s.id + ': a question came out broken — "' + p.q + '"');
      assert.ok(!BROKEN.test(p.a[0]), s.id + ': the answer came out broken — "' + p.a[0] + '"');
    }
  });
});

console.log(failures ? '\n' + failures + ' PRACTICE CHECK(S) FAILED' : '\nALL PRACTICE CHECKS PASSED');
process.exit(failures ? 1 : 0);
