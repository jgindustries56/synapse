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
  expect('tr-symmetry', 'equilateral triangle', eachExterior(3) + '°');
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

console.log(failures ? '\n' + failures + ' GEOMETRY ACCURACY CHECK(S) FAILED' : '\nALL GEOMETRY ACCURACY CHECKS PASSED');
process.exit(failures ? 1 : 0);
