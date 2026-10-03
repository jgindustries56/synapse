/* Is the Geometry content actually correct?

   The content test above proves the deck is well-formed. This one proves it is
   true. Nothing here trusts the page: every coordinate rule is parsed out of
   the card and evaluated against an independent implementation of the same
   transformation, and every numeric answer is recomputed from scratch. A
   transposed sign in a rotation rule, or an arithmetic slip in a worked
   answer, fails here. */
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(__dirname + '/subjects/geometry.html', 'utf8').replace('%%GOOGLE_CLIENT_ID%%', '');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptBody = blocks.find(b => b.includes('(function(){'));
if (!scriptBody) throw new Error('no app script found in subjects/geometry.html');

const code = scriptBody.replace(/\n  render\(\);[\s\S]*?\n\}\)\(\);\s*$/, `
window.__T__ = {ALL_ITEMS:ALL_ITEMS, TOPICS:TOPICS, TOPIC_MAP:TOPIC_MAP, ITEMS_BY_TOPIC:ITEMS_BY_TOPIC,
  TERM_LISTS:TERM_LISTS, APPLIED:APPLIED};
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

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' -> ' + e.message); }
}

/* ------------------------------ lookup ------------------------------ */

function applied(topic, needle) {
  const rows = (T.APPLIED[topic] || []).filter(r => r.prompt.indexOf(needle) !== -1);
  if (!rows.length) throw new Error('no question in ' + topic + ' matching "' + needle + '"');
  if (rows.length > 1) throw new Error(rows.length + ' questions in ' + topic + ' match "' + needle + '"');
  return rows[0];
}

function term(topic, name) {
  const rows = (T.TERM_LISTS[topic] || []).filter(r => r.term === name);
  if (rows.length !== 1) throw new Error(topic + ' should hold exactly one "' + name + '", found ' + rows.length);
  return rows[0].def;
}

function expect(topic, needle, wanted) {
  const got = applied(topic, needle).answer;
  if (String(got) !== String(wanted)) {
    throw new Error('"' + needle + '" answers ' + JSON.stringify(got) + ', computed ' + JSON.stringify(wanted));
  }
}

/* ------------------- evaluating a coordinate rule -------------------
   A rule card reads "(x, y) → (-y, x)". Pull the image pair out, check it is
   made only of the symbols a rule may contain, and evaluate it. The test then
   compares the result against its own implementation of that transformation,
   so the page's rule has to agree with arithmetic, not with my typing. */
const ARROW = '→';

function ruleFn(ruleText) {
  const i = ruleText.indexOf(ARROW);
  if (i === -1) throw new Error('not a coordinate rule: ' + ruleText);
  const m = ruleText.slice(i).match(/\(([^()]*)\)/);
  if (!m) throw new Error('no image pair in: ' + ruleText);
  // "2a - x" is how the notes write it; JavaScript needs the multiplication
  // sign put back before it will read the same thing.
  const parts = m[1].split(',')
    .map(s => s.trim().replace(/(\d)([xyab])/g, '$1*$2'));
  if (parts.length !== 2) throw new Error('image pair is not a pair: ' + ruleText);
  parts.forEach(p => {
    if (!/^[-+0-9xyab\s*]+$/.test(p)) throw new Error('unexpected symbols in rule "' + ruleText + '": ' + p);
  });
  // eslint-disable-next-line no-new-func
  const f = new Function('x', 'y', 'a', 'b', 'return [' + parts[0] + ', ' + parts[1] + '];');
  return (x, y, a, b) => f(x, y, a, b);
}

const SAMPLES = [[3, 7], [-2, 5], [0, -4], [6, 0], [-1, -9]];

/* Independent implementations. These are the authority the cards are checked
   against; they are written from the geometry, not copied from the page. */
const REFERENCE = {
  'Reflection over the x-axis':                   (x, y) => [x, -y],
  'Reflection over the y-axis':                   (x, y) => [-x, y],
  'Reflection over the line y = x':               (x, y) => [y, x],
  'Reflection over the line y = -x':              (x, y) => [-y, -x],
  'Reflection in the origin (a point reflection)': (x, y) => [-x, -y],
  'Rotation 90° counterclockwise about the origin':  (x, y) => [-y, x],
  'Rotation 180° about the origin':                  (x, y) => [-x, -y],
  'Rotation 270° counterclockwise about the origin': (x, y) => [y, -x],
  'Translation left a units':                     (x, y, a) => [x - a, y],
  'Translation right a units':                    (x, y, a) => [x + a, y],
  'Translation up b units':                       (x, y, a, b) => [x, y + b],
  'Translation down b units':                     (x, y, a, b) => [x, y - b],
  'Translation by the vector ⟨a, b⟩':   (x, y, a, b) => [x + a, y + b],
  'Translation right 3 and up 5':                 (x, y) => [x + 3, y + 5],
  'Translation left 2 and down 6':                (x, y) => [x - 2, y - 6],
  'Reflection over the vertical line x = a':      (x, y, a) => [2 * a - x, y],
  'Reflection over the horizontal line y = b':    (x, y, a, b) => [x, 2 * b - y]
};

check('every coordinate rule on a card computes what it claims to', () => {
  const topics = ['tr-translate', 'tr-reflect', 'tr-rotate'];
  let checked = 0;
  topics.forEach(topic => {
    (T.TERM_LISTS[topic] || []).forEach(row => {
      const ref = REFERENCE[row.term];
      if (!ref) return;              // prose cards in the same list
      const got = ruleFn(row.def);
      SAMPLES.forEach(([x, y]) => {
        [[5, 3], [-2, 4]].forEach(([a, b]) => {
          const mine = ref(x, y, a, b);
          const theirs = got(x, y, a, b);
          assert.deepStrictEqual(theirs, mine,
            row.term + ' on (' + x + ', ' + y + ') with a=' + a + ', b=' + b +
            ' gives ' + JSON.stringify(theirs) + ', should be ' + JSON.stringify(mine));
        });
      });
      checked++;
    });
  });
  if (checked !== Object.keys(REFERENCE).length) {
    throw new Error('checked ' + checked + ' rules, expected ' + Object.keys(REFERENCE).length +
      ' — a rule card was renamed or lost');
  }
});

check('every rule the course needs is actually on a card', () => {
  Object.keys(REFERENCE).forEach(name => {
    const where = ['tr-translate', 'tr-reflect', 'tr-rotate']
      .filter(t => (T.TERM_LISTS[t] || []).some(r => r.term === name));
    if (where.length !== 1) throw new Error(name + ' appears in ' + where.length + ' topics');
  });
});

/* ------------------- worked transformation answers ------------------- */

function pt(p) { return '(' + p[0] + ', ' + p[1] + ')'; }

check('the worked reflection answers are right', () => {
  expect('tr-reflect', 'P(3, 7) over the x-axis', pt(REFERENCE['Reflection over the x-axis'](3, 7)));
  expect('tr-reflect', 'P(3, 7) over the y-axis', pt(REFERENCE['Reflection over the y-axis'](3, 7)));
  expect('tr-reflect', 'P(-2, 5) over the line y = x', pt(REFERENCE['Reflection over the line y = x'](-2, 5)));
  expect('tr-reflect', 'P(-2, 5) over the line y = -x', pt(REFERENCE['Reflection over the line y = -x'](-2, 5)));
  // Over x = 3: the image sits as far the other side of the mirror.
  expect('tr-reflect', 'P(1, 4) over the line x = 3', pt([2 * 3 - 1, 4]));
  expect('tr-reflect', 'P(1, 4) over the line y = -1', pt([1, 2 * -1 - 4]));
});

check('the worked rotation answers are right', () => {
  const ccw90 = REFERENCE['Rotation 90° counterclockwise about the origin'];
  const ccw270 = REFERENCE['Rotation 270° counterclockwise about the origin'];
  const half = REFERENCE['Rotation 180° about the origin'];
  expect('tr-rotate', 'P(4, 1) 90° counterclockwise', pt(ccw90(4, 1)));
  // 90 clockwise is the same map as 270 counterclockwise.
  expect('tr-rotate', 'P(4, 1) 90° clockwise', pt(ccw270(4, 1)));
  expect('tr-rotate', 'P(-3, 2) 180°', pt(half(-3, 2)));
  expect('tr-rotate', 'P(5, -2) 270° counterclockwise', pt(ccw270(5, -2)));
});

check('the worked translation answers are right', () => {
  expect('tr-translate', 'A(2, -3)', "A′" + pt([2 - 5, -3 + 1]));
  expect('tr-translate', 'B(-4, 6)', "B′" + pt([-4 + 5, 6 - 9]));
});

check('clockwise and counterclockwise rotations are paired correctly', () => {
  const ccw90 = REFERENCE['Rotation 90° counterclockwise about the origin'];
  const ccw270 = REFERENCE['Rotation 270° counterclockwise about the origin'];
  // The card says 90 clockwise matches 270 counterclockwise. Verify on points.
  SAMPLES.forEach(([x, y]) => {
    const cw90 = [y, -x];
    assert.deepStrictEqual(cw90, ccw270(x, y), '90 CW should equal 270 CCW');
    const cw270 = [-y, x];
    assert.deepStrictEqual(cw270, ccw90(x, y), '270 CW should equal 90 CCW');
  });
  assert.strictEqual(term('tr-rotate', 'The clockwise rotation that matches 90° counterclockwise'), '270° clockwise');
  assert.strictEqual(term('tr-rotate', 'The clockwise rotation that matches 270° counterclockwise'), '90° clockwise');
  expect('tr-rotate', '90° clockwise uses the same coordinate rule', '270° counterclockwise');
});

/* ---------------------- coordinate geometry ---------------------- */

function dist(p, q) { return Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2); }
function mid(p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
function slope(p, q) { return q[0] === p[0] ? null : (q[1] - p[1]) / (q[0] - p[0]); }

check('the distance answers are right', () => {
  expect('co-formulas', '(1, 2) and (4, 6)', String(dist([1, 2], [4, 6])));
  expect('co-formulas', '(-2, 1) and (3, 13)', String(dist([-2, 1], [3, 13])));
  expect('co-formulas', '(0, 0) and (6, 8)', String(dist([0, 0], [6, 8])));
  [dist([1, 2], [4, 6]), dist([-2, 1], [3, 13]), dist([0, 0], [6, 8])].forEach(d => {
    assert.ok(Number.isInteger(d), 'a worked distance came out non-integer: ' + d);
  });
});

check('the midpoint answers are right', () => {
  expect('co-formulas', '(2, 4) and (8, 10)', pt(mid([2, 4], [8, 10])));
  expect('co-formulas', '(-3, 5) and (7, -1)', pt(mid([-3, 5], [7, -1])));
  // Working backwards from a midpoint to the far endpoint.
  const A = [1, 3], M = [4, 5];
  expect('co-formulas', 'midpoint of AB is M(4, 5)', pt([2 * M[0] - A[0], 2 * M[1] - A[1]]));
});

check('the slope answers are right', () => {
  expect('co-formulas', '(1, 2) and (5, 10)', String(slope([1, 2], [5, 10])));
  expect('co-formulas', '(-2, 4) and (3, 4)', String(slope([-2, 4], [3, 4])));
  assert.strictEqual(slope([6, 1], [6, 9]), null, 'a vertical line has no slope');
  expect('co-formulas', '(6, 1) and (6, 9)', 'Undefined');
  expect('ln-slopes', '(2, 5) and (6, 5)', String(slope([2, 5], [6, 5])));
  expect('ln-slopes', '(3, 1) and (3, 8)', 'Undefined');
});

check('the perpendicular slope answers really multiply to -1', () => {
  const cases = [['slope 3/4. A line perpendicular', 3 / 4], ['slope -5. A line perpendicular', -5]];
  cases.forEach(([needle, m]) => {
    const stated = applied('ln-slopes', needle).answer;
    const value = Number(stated.includes('/')
      ? stated.split('/')[0] / stated.split('/')[1]
      : stated);
    assert.ok(Math.abs(m * value + 1) < 1e-12,
      'slope ' + m + ' paired with ' + stated + ' gives a product of ' + (m * value));
  });
});

check('the parallel slope answer is the same slope', () => {
  assert.strictEqual(applied('ln-slopes', 'slope 3/4. A line parallel').answer, '3/4');
});

/* ---------------------------- angles ---------------------------- */

check('the complement and supplement answers are right', () => {
  expect('ln-pairs', 'complement of 37', (90 - 37) + '°');
  expect('ln-pairs', 'supplement of 128', (180 - 128) + '°');
  expect('ln-pairs', 'complementary and one is twice the other', (90 / 3) + '°');
  // x + (x + 40) = 180, so the larger is x + 40.
  const x = (180 - 40) / 2;
  expect('ln-pairs', 'supplementary and one is 40', (x + 40) + '°');
});

check('the triangle angle answers are right', () => {
  expect('tri-angles', '48° and 71°', (180 - 48 - 71) + '°');
  expect('tri-angles', 'exterior angle measures 115', (115 - 40) + '°');
  expect('tri-angles', 'ratio 1 : 2 : 3', (3 * (180 / 6)) + '°');
  expect('tri-angles', 'exterior angles of any triangle add to', '360°');
});

check('the isosceles angle answers are right', () => {
  expect('tri-isosceles', 'vertex angle of 40', ((180 - 40) / 2) + '°');
  expect('tri-isosceles', 'base angle of 52', (180 - 2 * 52) + '°');
  expect('tri-isosceles', 'vertex angle of 90', ((180 - 90) / 2) + '°');
});

check('the transversal answers follow from the parallel-line theorems', () => {
  expect('ln-transversal', 'Corresponding angles are', 'Congruent');
  expect('ln-transversal', 'Alternate interior angles are', 'Congruent');
  expect('ln-transversal', 'Alternate exterior angles are', 'Congruent');
  expect('ln-transversal', 'Same-side interior angles are', 'Supplementary');
  expect('ln-transversal', 'Same-side exterior angles are', 'Supplementary');
  expect('ln-transversal', 'same-side interior angle measures 110', (180 - 110) + '°');
  expect('ln-transversal', 'corresponding angle measures 73', '73°');
  // The definitions must agree with the questions.
  assert.ok(/congruent/i.test(term('ln-transversal', 'Corresponding Angles Postulate')));
  assert.ok(/congruent/i.test(term('ln-transversal', 'Alternate Interior Angles Theorem')));
  assert.ok(/congruent/i.test(term('ln-transversal', 'Alternate Exterior Angles Theorem')));
  assert.ok(/supplementary/i.test(term('ln-transversal', 'Same-Side Interior Angles Theorem')));
});

check('the angle and segment addition answers are right', () => {
  expect('ln-logic', 'AB = 5 and BC = 9', String(5 + 9));
  expect('ln-logic', 'm∠ ABP = 28', (75 - 28) + '°');
});

/* ------------------------- polygons ------------------------- */

const interiorSum = n => (n - 2) * 180;
const eachInterior = n => interiorSum(n) / n;
const eachExterior = n => 360 / n;
const diagonals = n => n * (n - 3) / 2;

check('the polygon angle answers are right', () => {
  expect('qd-polygon', 'interior angles of a hexagon', interiorSum(6) + '°');
  expect('qd-polygon', 'interior angles of a decagon', interiorSum(10) + '°');
  expect('qd-polygon', 'interior angle of a regular octagon', eachInterior(8) + '°');
  expect('qd-polygon', 'exterior angle of a regular pentagon', eachExterior(5) + '°');
  expect('qd-polygon', 'exterior angle of 30', String(360 / 30));
  expect('qd-polygon', 'interior angles add to 1080', String(1080 / 180 + 2));
  expect('qd-polygon', 'exterior angles of a 20-gon', '360°');
  expect('qd-polygon', 'diagonals does a hexagon', String(diagonals(6)));
  expect('qd-polygon', 'interior angle of an equilateral triangle', eachInterior(3) + '°');
  // An interior angle of 150 leaves an exterior angle of 30.
  expect('qd-polygon', 'interior angle of a regular polygon is 150', String(360 / (180 - 150)));
  expect('qd-family', 'angles of any quadrilateral add to', interiorSum(4) + '°');
});

check('the symmetry answers follow 360 ÷ n', () => {
  expect('tr-symmetry', 'regular pentagon', eachExterior(5) + '°');
  expect('tr-symmetry', 'rotational symmetry of an equilateral triangle', eachExterior(3) + '°');
  expect('tr-symmetry', 'lines of symmetry does a regular hexagon', '6');
  expect('tr-symmetry', 'rotational symmetry of a square', '4');
  expect('tr-symmetry', '12 lines of symmetry', '12');
  expect('tr-symmetry', 'lines of symmetry does a rectangle', '2');
  expect('tr-symmetry', 'neither a rectangle nor a rhombus', '0');
});

check('the composition answers double the distance and the angle', () => {
  expect('tr-compose', 'parallel lines 4 cm apart', (2 * 4) + ' cm');
  expect('tr-compose', 'meet at 45', (2 * 45) + '°');
});

/* ---------------- congruence: what is and is not valid ---------------- */

check('SSA and AAA are marked as not shortcuts, and the five real ones are', () => {
  assert.ok(/not a congruence shortcut/i.test(term('tri-congruence', 'SSA')), 'SSA is not flagged');
  assert.ok(/not a congruence shortcut/i.test(term('tri-congruence', 'AAA')), 'AAA is not flagged');
  assert.ok(/similarity/i.test(term('tri-congruence', 'AAA')), 'AAA should mention similarity');
  ['SSS', 'SAS', 'ASA', 'AAS', 'HL'].forEach(k => {
    const def = term('tri-congruence', k);
    assert.ok(!/not a congruence shortcut/i.test(def), k + ' is wrongly flagged invalid');
    assert.ok(/congruen/i.test(def), k + ' does not say what it proves');
  });
  assert.ok(/right triangle/i.test(term('tri-congruence', 'HL')), 'HL must be limited to right triangles');
  assert.ok(/between them/i.test(term('tri-congruence', 'SAS')), 'SAS must say the angle is included');
  assert.ok(/not between them/i.test(term('tri-congruence', 'AAS')), 'AAS must say the side is not included');
  expect('tri-congruence', 'NOT a valid congruence shortcut', 'SSA');
  expect('tri-congruence', 'two sides and the angle between them', 'SAS');
  expect('tri-congruence', 'two angles and the side between them', 'ASA');
  expect('tri-congruence', 'two angles and a side outside them', 'AAS');
  expect('tri-congruence', 'all three sides', 'SSS');
});

check('CPCTC is spelled out and gated behind the congruence proof', () => {
  assert.strictEqual(term('tri-cpctc', 'CPCTC'),
    'Corresponding Parts of Congruent Triangles are Congruent.');
  assert.ok(/after/i.test(term('tri-cpctc', 'When CPCTC may be used')), 'CPCTC should be gated');
  expect('tri-cpctc', 'congruent to BC', 'EF');
  expect('tri-cpctc', 'congruent to angle A', 'Angle D');
});

/* ------------------- quadrilaterals: no contradictions ------------------- */

check('the diagonal properties separate the quadrilaterals', () => {
  const d = {
    rectangle: term('qd-diagonals', 'Diagonals of a rectangle'),
    rhombus: term('qd-diagonals', 'Diagonals of a rhombus'),
    square: term('qd-diagonals', 'Diagonals of a square'),
    kite: term('qd-diagonals', 'Diagonals of a kite'),
    isoTrap: term('qd-diagonals', 'Diagonals of an isosceles trapezoid')
  };
  // A rectangle's diagonals are congruent but not, in general, perpendicular.
  assert.ok(/congruent/i.test(d.rectangle) && !/perpendicular/i.test(d.rectangle), 'rectangle');
  // A rhombus's are perpendicular but not, in general, congruent.
  assert.ok(/perpendicular/i.test(d.rhombus) && !/congruent/i.test(d.rhombus), 'rhombus');
  // A square's are both.
  assert.ok(/congruent/i.test(d.square) && /perpendicular/i.test(d.square), 'square');
  assert.ok(/perpendicular/i.test(d.kite), 'kite');
  assert.ok(/congruent/i.test(d.isoTrap) && /not bisect/i.test(d.isoTrap), 'isosceles trapezoid');
  // Only the rhombus and square bisect the figure's angles.
  assert.ok(/bisect the angles/i.test(d.rhombus) && /bisect the angles/i.test(d.square));
  assert.ok(!/bisect the angles/i.test(d.rectangle));
  expect('qd-diagonals', 'Which quadrilateral has diagonals that are both', 'Square');
  expect('qd-diagonals', 'Perpendicular diagonals that bisect each other', 'A rhombus');
  expect('qd-diagonals', 'Congruent diagonals that bisect each other', 'A rectangle');
  expect('qd-diagonals', 'bisect its angles', 'Rhombus');
});

check('the quadrilateral family nests the right way round', () => {
  assert.ok(/parallelogram/i.test(term('qd-family', 'Rectangle')), 'a rectangle is a parallelogram');
  assert.ok(/parallelogram/i.test(term('qd-family', 'Rhombus')), 'a rhombus is a parallelogram');
  assert.ok(/rectangle/i.test(term('qd-family', 'Square')) && /rhombus/i.test(term('qd-family', 'Square')),
    'a square is both a rectangle and a rhombus');
  assert.ok(/exactly one pair/i.test(term('qd-family', 'Trapezoid')), 'a trapezoid has exactly one pair');
  expect('qd-family', 'Every square is also', 'A rectangle and a rhombus');
  expect('qd-family', 'every rhombus a square', 'No');
  expect('qd-family', 'every rectangle a parallelogram', 'Yes');
  // Midsegment is the mean of the two bases.
  expect('qd-family', 'bases of 10 and 16', String((10 + 16) / 2));
});

check('the parallelogram answers follow from its properties', () => {
  expect('qd-parallelogram', 'Angle C measures', '68°');
  expect('qd-parallelogram', 'Angle B measures', (180 - 68) + '°');
  expect('qd-parallelogram', 'AE = 7', String(2 * 7));
  expect('qd-parallelogram', 'base 12 and height 5', String(12 * 5));
  expect('qd-parallelogram', 'Consecutive angles of a parallelogram add to', '180°');
  assert.ok(/bisect each other/i.test(term('qd-parallelogram', 'Diagonals of a parallelogram')));
  assert.ok(/supplementary/i.test(term('qd-parallelogram', 'Consecutive angles of a parallelogram')));
});

/* ------------------------- transformations, in prose ------------------------- */

check('only the dilation is called non-rigid', () => {
  assert.ok(/not rigid/i.test(term('tr-rigid', 'Dilation')), 'the dilation should be marked non-rigid');
  ['Translation', 'Reflection', 'Rotation'].forEach(k => {
    assert.ok(/rigid/i.test(term('tr-rigid', k)), k + ' should be called rigid');
    assert.ok(!/not rigid/i.test(term('tr-rigid', k)), k + ' is wrongly called non-rigid');
  });
  assert.ok(/distance and angle/i.test(term('tr-rigid', 'Rigid transformation')));
  expect('tr-rigid', 'NOT rigid', 'Dilation');
  expect('tr-rigid', 'preserves which two things', 'Distance and angle measure');
  expect('tr-rigid', 'reverses orientation', 'Reflection');
});

check('the Pythagorean theorem sits behind the distance formula', () => {
  assert.strictEqual(term('co-formulas', 'Pythagorean Theorem'), 'a² + b² = c²');
  assert.ok(/pythagorean/i.test(term('co-formulas', 'Where the distance formula comes from')));
  expect('co-formulas', 'distance formula is really', 'The Pythagorean Theorem on a grid');
});

check('a postulate and a theorem are not confused', () => {
  assert.ok(/without proof/i.test(term('ln-logic', 'Postulate')));
  assert.ok(/proved/i.test(term('ln-logic', 'Theorem')));
  assert.ok(/equivalent/i.test(term('ln-logic', 'Contrapositive')), 'the contrapositive is the equivalent one');
  assert.ok(!/equivalent/i.test(term('ln-logic', 'Converse')), 'the converse is not equivalent');
  expect('ln-logic', 'accepted without proof', 'A postulate');
  expect('ln-logic', 'proved from postulates', 'A theorem');
  expect('ln-logic', 'always logically equivalent', 'The contrapositive');
});

/* ------------------- every note that shows work adds up ------------------- */

check('no explanation contradicts its own answer', () => {
  /* Pull every "<arithmetic> = <number>" out of the explanations and work it
     out independently. The run before the equals sign has to be arithmetic and
     nothing else, has to begin at a token boundary, and has to contain an
     operator -- otherwise "-1/2 x 2 = -1" would be read as the fragment
     "2 = -1", and "180 - 48 - 71 = 61" as "48 - 71 = 61". Anything that will
     not parse (a square root, an unbalanced bracket, an expression in n) is
     passed over rather than guessed at. */
  const RE = /([-0-9(][-0-9\s+*\/().×÷]*)=\s*(-?[0-9]+(?:\.[0-9]+)?)(?![0-9])/g;   // a trailing full stop is punctuation, not a decimal
  let verified = 0;
  Object.keys(T.APPLIED).forEach(topic => {
    T.APPLIED[topic].forEach(r => {
      if (!r.note) return;
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(r.note)) !== null) {
        const before = m.index === 0 ? ' ' : r.note[m.index - 1];
        if (!/[\s:(]/.test(before)) continue;             // mid-token, not an expression
        const expr = m[1].trim();
        if (!/[-+*\/×÷]/.test(expr)) continue;  // a bare number proves nothing
        // Two operands or it is a fragment: "gives n - 2 = 6" must not be
        // read as the sum "- 2 = 6".
        if ((expr.match(/\d+(?:\.\d+)?/g) || []).length < 2) continue;
        // A chained equality such as "4/8 = 6/12 = 8/16" is a run of equal
        // ratios, not a sum: the number after the first equals sign starts the
        // next fraction, so it must not be read as a total.
        if (r.note[m.index + m[0].length] === '/') continue;
        const opens = (expr.match(/\(/g) || []).length;
        const closes = (expr.match(/\)/g) || []).length;
        if (opens !== closes) continue;                   // a fragment of a bracketed expression
        const js = expr.replace(/×/g, '*').replace(/÷/g, '/');
        let real;
        try {
          // eslint-disable-next-line no-new-func
          real = new Function('return (' + js + ');')();
        } catch (e) { continue; }
        if (typeof real !== 'number' || !isFinite(real)) continue;
        const said = Number(m[2]);
        if (Math.abs(real - said) > 1e-9) {
          throw new Error(topic + ' / "' + r.prompt + '": the note says ' +
            expr + ' = ' + said + ', but it is ' + real);
        }
        verified++;
      }
    });
  });
  if (verified < 25) throw new Error('only ' + verified + ' worked sums could be verified');
  console.log('     (verified ' + verified + ' worked sums inside the explanations)');
});


/* ==================================================================
   The material the second pass added: trigonometry, the unit circle,
   similarity and polynomial division. Same rule as above — nothing here
   trusts the card. Radicals are parsed into numbers, angles are evaluated
   with Math.sin and Math.cos, and each polynomial quotient is multiplied
   back out against its divisor.
   ================================================================== */

const RAD = Math.PI / 180;

/* "2√10", "-√3/2", "1/2", "-2√3/3", "7√2" -> a number. */
function value(src) {
  let t = String(src).trim().replace(/\s+/g, '');
  let sign = 1;
  if (t[0] === '-') { sign = -1; t = t.slice(1); }
  const part = p => {
    const m = p.match(/^(\d*)√(\d+)$/);
    if (m) return (m[1] === '' ? 1 : Number(m[1])) * Math.sqrt(Number(m[2]));
    if (/^\d+(\.\d+)?$/.test(p)) return Number(p);
    throw new Error('cannot read "' + src + '"');
  };
  const bits = t.split('/');
  if (bits.length === 2) return sign * part(bits[0]) / part(bits[1]);
  if (bits.length === 1) return sign * part(bits[0]);
  throw new Error('cannot read "' + src + '"');
}

function close(a, b, tol) { return Math.abs(a - b) < (tol || 1e-9); }

check('the radical shorthand on the cards is arithmetically right', () => {
  const pairs = [['2√10', 40], ['2√37', 148], ['6√2', 72], ['3√2', 18],
                 ['2√2', 8], ['4√2', 32], ['7√2', 98], ['7√3', 147],
                 ['6√3', 108], ['25√3', 1875]];
  pairs.forEach(([text, square]) => {
    const v = value(text);
    if (!close(v * v, square, 1e-6)) {
      throw new Error(text + ' squares to ' + (v * v) + ', expected ' + square);
    }
  });
});

check('the worked midpoint and distance answers are right', () => {
  expect('co-worked', 'midpoint of (2, 5) and (-4, 3)', pt(mid([2, 5], [-4, 3])));
  expect('co-worked', 'midpoint of (-1, 7) and (-3, -5)', pt(mid([-1, 7], [-3, -5])));
  const d1 = applied('co-worked', 'distance between (2, 5) and (-4, 3)').answer;
  const d2 = applied('co-worked', 'distance between (-1, 7) and (-3, -5)').answer;
  if (!close(value(d1), dist([2, 5], [-4, 3]), 1e-9)) throw new Error('first distance reads ' + d1);
  if (!close(value(d2), dist([-1, 7], [-3, -5]), 1e-9)) throw new Error('second distance reads ' + d2);
  [['√40 simplifies', 40], ['√148 simplifies', 148], ['√72 simplifies', 72]]
    .forEach(([needle, n]) => {
      const got = value(applied('co-worked', needle).answer);
      if (!close(got, Math.sqrt(n), 1e-9)) throw new Error(needle + ' gives ' + got);
    });
  const diag = value(applied('co-worked', '(0, 0) and (3, 3)').answer);
  if (!close(diag, dist([0, 0], [3, 3]), 1e-9)) throw new Error('(0,0)-(3,3) distance is wrong');
});

check('the four-coordinate example really is a rectangle', () => {
  const E = [-6, -4], F = [-4, -6], G = [0, -2], H = [-2, 0];
  const sides = [[E, F], [F, G], [G, H], [H, E]];
  const slopes = sides.map(([a, b]) => slope(a, b));
  const lengths = sides.map(([a, b]) => dist(a, b));
  // Opposite sides parallel, adjacent sides perpendicular.
  assert.ok(close(slopes[0], slopes[2]) && close(slopes[1], slopes[3]), 'opposite sides are not parallel');
  assert.ok(close(slopes[0] * slopes[1], -1), 'adjacent sides are not perpendicular');
  // Two pairs of congruent sides, and the pairs differ — a rectangle, not a square.
  assert.ok(close(lengths[0], lengths[2]) && close(lengths[1], lengths[3]), 'sides are not congruent in pairs');
  assert.ok(!close(lengths[0], lengths[1]), 'all four sides are equal, so it would be a square');
  expect('co-classify', 'G(0, -2), H(-2, 0) form', 'A rectangle');
  if (!close(value(applied('co-classify', 'EF measures').answer), dist(E, F))) throw new Error('EF is wrong');
  if (!close(value(applied('co-classify', 'EH measures').answer), dist(E, H))) throw new Error('EH is wrong');
});

check('the rearranged line equations are right', () => {
  // x + 4y = 8 and x + 10y = 5, solved for y and checked at two x values.
  [[4, 8, 'x + 4y = 8'], [10, 5, 'x + 10y = 5']].forEach(([b, c, label]) => {
    const stated = applied('ln-distinguish', 'Rearranging ' + label).answer;
    const m = stated.match(/^y = (-?\d+)\/(\d+) x \+ (\d+)(?:\/(\d+))?$/);
    if (!m) throw new Error('cannot read "' + stated + '"');
    const slopeStated = Number(m[1]) / Number(m[2]);
    const interceptStated = m[4] ? Number(m[3]) / Number(m[4]) : Number(m[3]);
    assert.ok(close(slopeStated, -1 / b), label + ' slope reads ' + slopeStated);
    assert.ok(close(interceptStated, c / b), label + ' intercept reads ' + interceptStated);
  });
  expect('ln-distinguish', 'y = 4x + 3 and x + 4y = 8', 'Perpendicular');
  expect('ln-distinguish', 'y = 3x + 2 and x + 10y = 5', 'Neither');
  assert.ok(close(4 * (-1 / 4), -1), 'the perpendicular claim does not hold');
  assert.ok(!close(3 * (-1 / 10), -1) && !close(3, -1 / 10), 'the neither claim does not hold');
});

/* ------------------------------- trigonometry ------------------------------- */

check('every Pythagorean triple on a card really is one', () => {
  const triples = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [6, 8, 10], [9, 12, 15]];
  triples.forEach(([a, b, c]) => {
    assert.strictEqual(a * a + b * b, c * c, a + '-' + b + '-' + c + ' is not a triple');
    expect('trig-triples', 'Legs of ' + a + ' and ' + b, String(c));
  });
  // And the one the card calls a fake really is one.
  expect('trig-triples', 'NOT a Pythagorean triple', '4-5-6');
  assert.notStrictEqual(4 * 4 + 5 * 5, 6 * 6, '4-5-6 would actually be a triple');
  expect('trig-triples', 'hypotenuse of 13 with one leg of 5', '12');
});

check('the special right triangle answers follow the ratios', () => {
  // 45-45-90 is 1 : 1 : root 2, 30-60-90 is 1 : root 3 : 2.
  const isos = leg => leg * Math.SQRT2;
  const halfEq = short => ({ long: short * Math.sqrt(3), hyp: short * 2 });
  const cases = [
    ['legs of 7 has a hypotenuse', isos(7)],
    ['hypotenuse of 8 has legs', 8 / Math.SQRT2],
    ['short leg of 6 has a hypotenuse', halfEq(6).hyp],
    ['short leg of 6 has a long leg', halfEq(6).long],
    ['hypotenuse of 14 has a short leg', 14 / 2],
    ['hypotenuse of 14 has a long leg', halfEq(7).long],
    ['8/√2 rationalised', 8 / Math.SQRT2]
  ];
  cases.forEach(([needle, want]) => {
    const got = value(applied('trig-special', needle).answer);
    if (!close(got, want, 1e-9)) throw new Error('"' + needle + '" gives ' + got + ', computed ' + want);
  });
  assert.strictEqual(term('trig-special', '45-45-90 side ratio'), '1 : 1 : √2');
  assert.strictEqual(term('trig-special', '30-60-90 side ratio'), '1 : √3 : 2');
});

check('the cofunction pairs really are equal', () => {
  const pairs = [['sin(50°) equals', 50, 'cos', 40], ['cos(62°) equals', 62, 'sin', 28],
                 ['sin(30°) equals', 30, 'cos', 60], ['cos(15°) equals', 15, 'sin', 75]];
  pairs.forEach(([needle, from, fn, to]) => {
    const stated = applied('trig-cofunction', needle).answer;
    assert.strictEqual(stated, fn + '(' + to + '°)', needle + ' answers ' + stated);
    assert.strictEqual(from + to, 90, 'the two angles do not add to 90');
    const left = /^sin/.test(needle) ? Math.sin(from * RAD) : Math.cos(from * RAD);
    const right = fn === 'cos' ? Math.cos(to * RAD) : Math.sin(to * RAD);
    assert.ok(close(left, right, 1e-12), needle + ' is not actually an identity');
  });
  expect('trig-cofunction', 'tan(20°) equals', 'cot(70°)');
  assert.ok(close(Math.tan(20 * RAD), 1 / Math.tan(70 * RAD), 1e-12), 'tan/cot pairing fails');
});

check('the reciprocal ratio answers are the reciprocals', () => {
  [['cos(A) = 3/5', 3 / 5, '5/3'], ['cos(A) = 35/37', 35 / 37, '37/35']].forEach(([needle, c, want]) => {
    const stated = applied('trig-ratios', needle).answer;
    assert.strictEqual(stated, want, needle + ' answers ' + stated);
    const bits = stated.split('/');
    assert.ok(close(Number(bits[0]) / Number(bits[1]), 1 / c), needle + ' is not the reciprocal');
  });
});

check('the solve-for-a-side answers are the right rearrangements', () => {
  expect('trig-solve', 'sin(25°) = x/6', '6 sin(25°)');
  expect('trig-solve', 'sin(35°) = 5/x', '5 ÷ sin(35°)');
  // x = 6 sin25 must satisfy sin25 = x/6, and x = 5 / sin35 must satisfy sin35 = 5/x.
  const x1 = 6 * Math.sin(25 * RAD);
  assert.ok(close(Math.sin(25 * RAD), x1 / 6), 'the first rearrangement does not check out');
  const x2 = 5 / Math.sin(35 * RAD);
  assert.ok(close(Math.sin(35 * RAD), 5 / x2), 'the second rearrangement does not check out');
  const stated53 = Number(applied('trig-solve', 'tan(53°) = 89/x').answer);
  assert.ok(close(stated53, 89 / Math.tan(53 * RAD), 5e-4), 'tan(53) case reads ' + stated53);
  const statedAng = applied('trig-solve', 'tan θ = 1456/2640').answer;
  const ang = Number(statedAng.replace('°', '').replace('about ', ''));
  assert.ok(close(ang, Math.atan(1456 / 2640) / RAD, 5e-4), 'the inverse-tangent case reads ' + statedAng);
});

check('the elevation and depression answers recompute', () => {
  const building = 24 / Math.tan(54 * RAD) + 1.65;
  const stated = Number(applied('trig-apps', 'tan(54°) = 24/x').answer);
  assert.ok(close(stated, building, 5e-4), 'building height reads ' + stated + ', computed ' + building);

  const lake = 1500 / Math.tan(37 * RAD) - 1500 / Math.tan(44 * RAD);
  const statedLake = Number(applied('trig-apps', 'tan(37°) = 1500/y').answer.replace(' ft', ''));
  assert.ok(close(statedLake, lake, 5e-4), 'lake width reads ' + statedLake + ', computed ' + lake);

  const wheel = 100 + 100 * Math.sin(45 * RAD);
  const statedWheel = Number(applied('trig-apps', 'ferris wheel').answer.match(/about ([\d.]+)/)[1]);
  assert.ok(close(statedWheel, wheel, 5e-4), 'ferris wheel reads ' + statedWheel + ', computed ' + wheel);

  const area = 0.5 * 10 * 5 * Math.sqrt(3);
  const statedArea = value(applied('trig-apps', 'base 10 km and height').answer.replace(' km²', ''));
  assert.ok(close(statedArea, area, 1e-9), 'the area reads ' + statedArea);
});

/* ------------------------------- the unit circle ------------------------------ */

check('the coterminal and reference angle answers are right', () => {
  [[32 - 360, '32° - 360°'], [32 + 360, '32° + 360°'], [32 + 720, '32° + 720°']]
    .forEach(([want, needle]) => expect('uc-angles', needle, want + '°'));
  expect('uc-angles', '540° reduced', (540 - 360) + '°');
  expect('uc-angles', '585° reduced', (585 - 360) + '°');
  expect('uc-angles', 'reference angle for 225', (225 - 180) + '°');
  expect('uc-angles', 'reference angle for 210', (210 - 180) + '°');
});

check('every unit circle point is where it says it is', () => {
  const rows = { 0: 'The point at 0°', 30: 'The point at 30°', 45: 'The point at 45°',
                 60: 'The point at 60°', 90: 'The point at 90°', 180: 'The point at 180°',
                 210: 'The point at 210°', 225: 'The point at 225°', 270: 'The point at 270°' };
  Object.keys(rows).forEach(deg => {
    const stated = term('uc-values', rows[deg]);
    const m = stated.match(/^\(([^,]+),\s*([^)]+)\)$/);
    if (!m) throw new Error(rows[deg] + ' is not a coordinate pair: ' + stated);
    const x = value(m[1]), y = value(m[2]);
    const d = Number(deg);
    assert.ok(close(x, Math.cos(d * RAD), 1e-9), deg + '° x reads ' + x);
    assert.ok(close(y, Math.sin(d * RAD), 1e-9), deg + '° y reads ' + y);
    assert.ok(close(x * x + y * y, 1, 1e-9), deg + '° is not on the unit circle');
  });
});

check('the unit circle question answers match the circle', () => {
  const cases = [['cos(60°)', Math.cos(60 * RAD)], ['sin(30°)', Math.sin(30 * RAD)],
                 ['cos(45°)', Math.cos(45 * RAD)], ['sin(90°)', Math.sin(90 * RAD)],
                 ['cos(180°)', Math.cos(180 * RAD)], ['sin(180°)', Math.sin(180 * RAD)],
                 ['cos(-60°)', Math.cos(-60 * RAD)], ['sin(225°)', Math.sin(225 * RAD)]];
  cases.forEach(([needle, want]) => {
    const got = value(applied('uc-values', needle + ' equals').answer);
    if (!close(got, want, 1e-9)) throw new Error(needle + ' reads ' + got + ', computed ' + want);
  });
});

check('the reciprocal and undefined evaluations are right', () => {
  const cases = [
    ['csc(225°) equals', 1 / Math.sin(225 * RAD)],
    ['cot(210°) equals', Math.cos(210 * RAD) / Math.sin(210 * RAD)],
    ['tan(225°) equals', Math.tan(225 * RAD)],
    ['csc(-60°) equals', 1 / Math.sin(-60 * RAD)],
    ['tan(540°) equals', Math.tan(180 * RAD)]
  ];
  cases.forEach(([needle, want]) => {
    const got = value(applied('uc-evaluate', needle).answer);
    if (!close(got, want, 1e-9)) throw new Error(needle + ' reads ' + got + ', computed ' + want);
  });
  // tan(90) has a zero denominator, so "undefined" is the only right answer.
  assert.strictEqual(applied('uc-evaluate', 'tan(90°) is').answer, 'Undefined');
  assert.ok(close(Math.cos(90 * RAD), 0, 1e-15), 'cos(90) is not zero, so tan(90) would be defined');
});

check('the trig equation solution sets are complete and correct', () => {
  const sets = [
    ['cos θ = √2/2 on', Math.cos, Math.SQRT2 / 2],
    ['sin θ = √2/2 on', Math.sin, Math.SQRT2 / 2],
    ['cos θ = -1 on', Math.cos, -1],
    ['cos θ = -1/2 on', Math.cos, -0.5],
    ['cos θ = 1/2 on', Math.cos, 0.5]
  ];
  sets.forEach(([needle, fn, target]) => {
    const stated = applied('uc-equations', needle).answer;
    const given = (stated.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (!given.length) throw new Error(needle + ' states no angles');
    // Every angle given must work...
    given.forEach(a => {
      if (!close(fn(a * RAD), target, 1e-9)) {
        throw new Error(needle + ' offers ' + a + '°, where the value is ' + fn(a * RAD));
      }
    });
    // ...and no whole-degree angle in range may be missing.
    const all = [];
    for (let a = 0; a < 360; a++) if (close(fn(a * RAD), target, 1e-9)) all.push(a);
    assert.deepStrictEqual(given.slice().sort((x, y) => x - y), all,
      needle + ' gives ' + JSON.stringify(given) + ', the circle gives ' + JSON.stringify(all));
  });
  expect('uc-equations', 'Factoring 2x² + 3x + 1', '(x + 1)(2x + 1)');
  // (x + 1)(2x + 1) really does expand to 2x^2 + 3x + 1.
  [-2, 0, 1, 3.5].forEach(x => {
    assert.ok(close((x + 1) * (2 * x + 1), 2 * x * x + 3 * x + 1), 'the factorisation is wrong at x = ' + x);
  });
});

/* -------------------------------- similarity -------------------------------- */

check('the similarity answers hold up', () => {
  // 15/3 = (x + 12)/4 has one solution, and the card must give it.
  const x = (15 / 3) * 4 - 12;
  expect('sim-scale', 'Solving 15/3 = (x + 12)/4', String(x));
  assert.ok(close(15 / 3, (x + 12) / 4), 'the stated solution does not satisfy the proportion');
  // Scale factors.
  expect('sim-scale', 'sides 3, 2, 4 and 15, 10, 20', String(15 / 3));
  [[3, 15], [2, 10], [4, 20]].forEach(([a, b]) => assert.ok(close(b / a, 5), 'ratios disagree'));
  expect('sim-scale', 'Sides 4 and 6 correspond to 8 and x', String(6 * (8 / 4)));
  expect('sim-scale', 'scale factor of 3. A side of 7', String(7 * 3));
  // SSS similarity ratio.
  const ratio = applied('sim-shortcuts', 'Sides 4, 6, 8 against 8, 12, 16').answer;
  assert.ok(close(value(ratio), 4 / 8), 'the SSS ratio reads ' + ratio);
  [[4, 8], [6, 12], [8, 16]].forEach(([a, b]) => assert.ok(close(a / b, 0.5), 'SSS ratios disagree'));
  // The "not similar" pair really is not similar.
  const abc = [40, 60, 180 - 40 - 60].sort((a, b) => a - b);
  const def = [40, 70, 180 - 40 - 70].sort((a, b) => a - b);
  assert.notDeepStrictEqual(abc, def, 'those two triangles would in fact be similar');
  expect('sim-shortcuts', 'angles of 40° and 60°', 'Not similar');
});

/* ---------------------------- polynomial division ---------------------------- */

/* Evaluates "3x⁴ - 3x² + 3x - 15" at a value of x. */
function polyEval(src, x) {
  const s = String(src).replace(/⁴/g, '^4').replace(/³/g, '^3')
    .replace(/²/g, '^2').replace(/\s+/g, '');
  const terms = s.replace(/-/g, '+-').split('+').filter(Boolean);
  let total = 0;
  terms.forEach(t => {
    const m = t.match(/^(-?\d*)x?(?:\^(\d+))?$/);
    if (!m) throw new Error('cannot read term "' + t + '" of "' + src + '"');
    const c = (m[1] === '' || m[1] === '-') ? Number(m[1] + '1') : Number(m[1]);
    const p = t.indexOf('x') === -1 ? 0 : (m[2] ? Number(m[2]) : 1);
    total += c * Math.pow(x, p);
  });
  return total;
}

check('every polynomial quotient multiplies back out to its dividend', () => {
  const cases = [
    { label: 'long division, x² + 1',
      dividend: x => x ** 3 + 6 * x ** 2 + x + 4,
      divisor: x => x ** 2 + 1,
      quotient: applied('poly-long', '(x³ + 6x² + x + 4)').answer,
      remainder: Number(applied('poly-long', '...and a remainder of').answer) },
    { label: 'long division, 4x - 1',
      dividend: x => 8 * x ** 3 + 34 * x ** 2 + 27 * x - 9,
      divisor: x => 4 * x - 1,
      quotient: applied('poly-long', '(8x³ + 34x² + 27x - 9)').answer,
      remainder: 0 },
    { label: 'synthetic division, x + 1',
      dividend: x => 3 * x ** 4 - 12 * x + 5,
      divisor: x => x + 1,
      quotient: applied('poly-synthetic', '(3x⁴ - 12x + 5)').answer,
      remainder: Number(applied('poly-synthetic', '...and a remainder of').answer) }
  ];
  cases.forEach(c => {
    [-3, -0.5, 0, 2, 4.5].forEach(x => {
      const rebuilt = c.divisor(x) * polyEval(c.quotient, x) + c.remainder;
      if (!close(rebuilt, c.dividend(x), 1e-6)) {
        throw new Error(c.label + ': quotient "' + c.quotient + '" with remainder ' + c.remainder +
          ' rebuilds to ' + rebuilt + ' at x = ' + x + ', but the dividend is ' + c.dividend(x));
      }
    });
  });
});

check('the factored quotient really is the quotient', () => {
  expect('poly-long', '2x² + 9x + 9 factors', '(2x + 3)(x + 3)');
  [-4, -1, 0, 2.5, 6].forEach(x => {
    assert.ok(close((2 * x + 3) * (x + 3), 2 * x * x + 9 * x + 9),
      'the factorisation fails at x = ' + x);
  });
});

check('synthetic division uses the root, not the constant', () => {
  expect('poly-synthetic', 'Dividing by (x + 1)', '-1');
  expect('poly-synthetic', 'Dividing by (x - 3)', '3');
  assert.ok(/root of the divisor/i.test(term('poly-synthetic', 'The number that goes in the corner')));
  assert.ok(/linear/i.test(term('poly-synthetic', 'When synthetic division may be used')));
});

/* ------------------------------ symmetry counts ------------------------------ */

check('the lines-of-symmetry counts and the arms equation agree', () => {
  expect('tr-symmetry', 'isosceles trapezoid have', '1');
  expect('tr-symmetry', 'circle have', 'Infinitely many');
  expect('tr-symmetry', 'kite have', '1');
  expect('tr-symmetry', 'lines of symmetry does an equilateral triangle', '3');
  expect('tr-symmetry', '8 identical arms has a smallest rotation', (360 / 8) + '°');
  expect('tr-symmetry', 'only works when', 'All the arms are the same');
  expect('tr-symmetry', 'smallest rotation is 360', 'Has no rotational symmetry');
  // The notes' claim about O, I, H and X is repeated, but corrected on the card.
  const letters = term('tr-symmetry', 'O, I, H and X');
  assert.ok(/exactly two/i.test(letters), 'the letters card does not correct the "infinite" claim');
});


/* ==================================================================
   The third batch: proof work, angle algebra, mapping onto itself, and
   the polynomial operations beyond division. Every equation below is
   solved here from its own coefficients and compared with the card.
   ================================================================== */

check('the triangle angle equations solve to what the cards say', () => {
  // (x + 25) + (x + 17) = 3x + 2  ->  2x + 42 = 3x + 2  ->  x = 40
  const x1 = 42 - 2;
  assert.strictEqual(2 * x1 + 42, 3 * x1 + 2, 'the exterior-angle equation does not balance');
  expect('tri-algebra', '(x + 25) and (x + 17)', String(x1));

  // 96 + 2(y - 8) = 180
  const y1 = (180 - 96 + 16) / 2;
  assert.strictEqual(96 + 2 * (y1 - 8), 180, 'the isosceles equation does not balance');
  expect('tri-algebra', 'two congruent angles of (y - 8)', String(y1));

  // y + 32 = 2y, then 2y + 2y + x = 180
  const y2 = 32;
  assert.strictEqual(y2 + 32, 2 * y2, 'y + 32 = 2y does not hold');
  expect('tri-algebra', 'Angles (y + 32) and 2y are congruent', String(y2));
  const x2 = 180 - 2 * (2 * y2);
  assert.strictEqual(2 * y2 + 2 * y2 + x2, 180, 'the third angle does not complete 180');
  expect('tri-algebra', 'the third angle x is', x2 + '°');

  // (3x + 4) + (4x + 4) = 8x - 10
  const x3 = 8 + 10;
  assert.strictEqual(7 * x3 + 8, 8 * x3 - 10, 'the second exterior-angle equation does not balance');
  expect('tri-algebra', '(3x + 4) and (4x + 4)', String(x3));

  expect('tri-algebra', 'exterior angle is 101', (101 - 31) + '°');
  expect('tri-algebra', '28° vertex angle', ((180 - 28) / 2) + '°');
});

check('the transversal equations solve to what the cards say', () => {
  // (4x + 11) + (6x + 19) = 180
  const x1 = (180 - 30) / 10;
  assert.strictEqual((4 * x1 + 11) + (6 * x1 + 19), 180, 'the first pair does not sum to 180');
  expect('ln-algebra', '(4x + 11) and (6x + 19)', String(x1));

  // (2x + 43) + (2x - 3) = 180
  const x2 = (180 - 40) / 4;
  assert.strictEqual((2 * x2 + 43) + (2 * x2 - 3), 180, 'the second pair does not sum to 180');
  expect('ln-algebra', '(2x + 43) and (2x - 3)', String(x2));
  expect('ln-algebra', 'the angle (2x - 3) measures', (2 * x2 - 3) + '°');
  expect('ln-algebra', 'its supplement measures', (180 - (2 * x2 - 3)) + '°');

  expect('ln-algebra', 'measure 2x and 110', String(110 / 2));
  const x3 = (180 - 11 - 46) / 3;
  assert.strictEqual((3 * x3 + 11) + 46, 180, 'the third pair does not sum to 180');
  expect('ln-algebra', '(3x + 11) and 46', String(x3));

  // x^2 + 66 = 76 - 3x
  expect('ln-algebra', 'equal to 76 - 3x gives the equation', 'x² + 3x - 10 = 0');
  expect('ln-algebra', 'x² + 3x - 10 factors to', '(x + 5)(x - 2)');
  [-4, 0, 2, 7].forEach(v => {
    assert.ok(close((v + 5) * (v - 2), v * v + 3 * v - 10), 'the factorisation fails at x = ' + v);
    assert.ok(close(v * v + 3 * v - 10, (v * v + 66) - (76 - 3 * v)), 'the rearrangement is wrong at x = ' + v);
  });
});

check('the mapping answers are right', () => {
  expect('tr-mapping', 'Apply (x - 1, y - 7) to the point (-3, 8)', pt([-3 - 1, 8 - 7]));
  expect('tr-mapping', 'regular pentagon maps onto itself every', (360 / 5) + '°');
  expect('tr-mapping', 'reflect over the x-axis, which coordinate', 'The x-coordinate');
  expect('tr-mapping', 'reflect over the y-axis, which coordinate', 'The y-coordinate');
  // And that agrees with the rules the transformation unit already carries.
  const overX = REFERENCE['Reflection over the x-axis'];
  const overY = REFERENCE['Reflection over the y-axis'];
  SAMPLES.forEach(([x, y]) => {
    assert.strictEqual(overX(x, y)[0], x, 'reflecting over the x-axis moved x');
    assert.strictEqual(overY(x, y)[1], y, 'reflecting over the y-axis moved y');
  });
});

check('the polynomial products and differences expand correctly', () => {
  const stated = applied('poly-multiply', '(2x² + 5)(x² - 11x + 6) equals').answer;
  [-2, -0.5, 0, 1.5, 3].forEach(x => {
    const real = (2 * x * x + 5) * (x * x - 11 * x + 6);
    if (!close(polyEval(stated, x), real, 1e-9)) {
      throw new Error('the product reads ' + stated + ', which is ' + polyEval(stated, x) +
        ' at x = ' + x + ' instead of ' + real);
    }
  });
  const diff = applied('poly-multiply', '(-7x² + 8x - 8) - (3x² + 15x - 3) equals').answer;
  [-3, -1, 0, 2, 4].forEach(x => {
    const real = (-7 * x * x + 8 * x - 8) - (3 * x * x + 15 * x - 3);
    if (!close(polyEval(diff, x), real, 1e-9)) {
      throw new Error('the difference reads ' + diff + ', which is ' + polyEval(diff, x) +
        ' at x = ' + x + ' instead of ' + real);
    }
  });
  expect('poly-multiply', 'two x² terms collect to', '17x²');
  expect('poly-multiply', '-7x² - 3x² gives', '-10x²');
  expect('poly-multiply', '8x - 15x gives', '-7x');
  expect('poly-multiply', '-8 - (-3) gives', String(-8 - (-3)));
  expect('poly-multiply', 'degree of (2x² + 5)(x² - 11x + 6)', '4');
});

check('the shaded area really is outer minus inner', () => {
  const outer = applied('poly-area', '(3x + 2) by (x + 15)').answer;
  const inner = applied('poly-area', '2x by (x + 1)').answer;
  const shaded = applied('poly-area', 'shaded area between those two').answer;
  [-5, 0, 1, 4.5, 9].forEach(x => {
    const o = (3 * x + 2) * (x + 15);
    const i = 2 * x * (x + 1);
    assert.ok(close(polyEval(outer, x), o, 1e-9), 'the outer area is wrong at x = ' + x);
    assert.ok(close(polyEval(inner, x), i, 1e-9), 'the inner area is wrong at x = ' + x);
    assert.ok(close(polyEval(shaded, x), o - i, 1e-9), 'the shaded area is wrong at x = ' + x);
  });
  expect('poly-area', '47x - 2x gives', '45x');
});

check('the factor test divisions check out', () => {
  // (x - 2) into 2x^3 + x^2 - 6x - 8, remainder 0.
  const q1 = applied('poly-factor', 'quotient of that division is').answer;
  [-3, 0, 1, 2.5, 5].forEach(x => {
    const rebuilt = (x - 2) * polyEval(q1, x);
    const dividend = 2 * x ** 3 + x ** 2 - 6 * x - 8;
    assert.ok(close(rebuilt, dividend, 1e-6),
      '(x - 2) times ' + q1 + ' is ' + rebuilt + ' at x = ' + x + ', not ' + dividend);
  });
  expect('poly-factor', 'So (x - 2) is', 'A factor of 2x³ + x² - 6x - 8');

  // x^3 + x divided by x - 1, quotient x^2 + x + 2 remainder 2.
  const q2 = applied('poly-factor', 'x³ + x by x - 1 gives a quotient').answer;
  const r2 = Number(applied('poly-factor', '...and a remainder of').answer);
  [-2, 0, 3, 4.5].forEach(x => {
    const rebuilt = (x - 1) * polyEval(q2, x) + r2;
    assert.ok(close(rebuilt, x ** 3 + x, 1e-6),
      'x³ + x does not rebuild at x = ' + x + ' (got ' + rebuilt + ')');
  });
  expect('poly-factor', 'coefficient row for x³ + x', '1, 0, 1, 0');
});

check('the proof reasons name the right rules', () => {
  assert.ok(/linear pair/i.test(term('pf-theorems', 'What the vertical angle theorem is proved from')));
  assert.ok(/corresponding/i.test(term('pf-theorems', 'What the alternate interior angle theorem is proved from')));
  expect('pf-theorems', 'vertical angle theorem is proved from', 'The linear pair postulate');
  expect('pf-theorems', 'alternate interior angle theorem is proved from', 'The corresponding angle postulate');
  expect('pf-theorems', 'How many congruence shortcuts', '5');
  // The five it means are the five the congruence topic already lists.
  ['SSS', 'SAS', 'ASA', 'AAS', 'HL'].forEach(k => term('tri-congruence', k));

  expect('pf-clues', 'tells you something outright', 'Given');
  expect('pf-clues', 'same segment appears in both triangles', 'The Reflexive Property');
  expect('pf-clues', 'cross and make an X', 'Vertical angles');
  expect('pf-clues', 'Z or N shape', 'Alternate interior angles');
  expect('pf-clues', 'F shape', 'Corresponding angles');
  expect('pf-clues', 'already proved congruent', 'CPCTC');

  expect('pf-worked', 'isosceles proof, the reason for "angle ABD', 'Definition of an angle bisector');
  expect('pf-worked', 'isosceles proof reaches congruent triangles by', 'SAS');
  expect('pf-worked', 'Given angle A, then side AB, then angle B', 'ASA');
  // CPCTC must never be the reason that establishes congruence itself.
  const cpctcRows = (T.APPLIED['pf-worked'] || []).filter(r => r.answer === 'CPCTC');
  assert.ok(cpctcRows.length >= 1, 'no CPCTC step in the worked proofs');
  cpctcRows.forEach(r => {
    assert.ok(/after|finishes|congruent by/i.test(r.prompt),
      'a CPCTC card does not make clear it comes after the congruence: ' + r.prompt);
  });
});

check('the converse example is judged correctly', () => {
  expect('ln-logic', 'If it is Atlanta, then it is in the U.S.', 'True');
  expect('ln-logic', 'If it is in the U.S., then it is Atlanta', 'False');
  expect('ln-logic', 'conditional and its converse', 'Can differ in truth value');
});

console.log(failures ? '\n' + failures + ' GEOMETRY ACCURACY CHECK(S) FAILED' : '\nALL GEOMETRY ACCURACY CHECKS PASSED');
process.exit(failures ? 1 : 0);
