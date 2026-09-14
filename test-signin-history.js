/* Does a returning user get their own work back?

   Writes a known history straight into the server's store for one user — cards
   at known boxes, specific counts on specific days, a streak, and a run of past
   sessions — then signs in as that user in a real browser and checks that the
   figures on the page are those figures and not defaults.

   Requires playwright-core and the preinstalled Chromium; skips if absent. */
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { console.log('playwright-core not installed — skipping.'); process.exit(0); }
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!fs.existsSync(CHROME)) { console.log('no Chromium at ' + CHROME + ' — skipping.'); process.exit(0); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-signin-'));
process.env.DATA_DIR = TMP;
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ||
  '000000000000-e2etest.apps.googleusercontent.com';
const server = require('./server.js');

let failures = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => console.log('OK   ' + name))
    .catch(e => { failures++; console.log('FAIL ' + name + ' -> ' + e.message); });
}
function ok(cond, what) { if (!cond) throw new Error(what); }

/* Real card ids, read out of the subject app the same way the accuracy suites
   do, so the seeded progress refers to cards that actually exist. */
function cardIds(subject, n) {
  const html = fs.readFileSync(path.join(__dirname, 'subjects', subject + '.html'), 'utf8');
  const body = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
    .find(b => b.includes('(function(){'));
  const code = body.replace(/\n  render\(\);[\s\S]*?\n\}\)\(\);\s*$/,
    '\n  window.__IDS__ = ALL_ITEMS.map(function(i){ return i.id; });\n})();');
  const sandbox = {
    window: { scrollTo() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    document: {
      head: { appendChild() {} },
      querySelector() { return { innerHTML: '', appendChild() {} }; },
      createElement() {
        return { className: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} },
                 appendChild() {}, addEventListener() {}, setAttribute() {} };
      }
    }
  };
  const prev = { w: global.window, l: global.localStorage, d: global.document };
  global.window = sandbox.window; global.localStorage = sandbox.localStorage; global.document = sandbox.document;
  try { eval(code); } finally {
    global.window = prev.w; global.localStorage = prev.l; global.document = prev.d;
  }
  return sandbox.window.__IDS__.slice(0, n);
}

function dayKey(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Distinctive figures, so nothing here could pass by coincidence.
const KNOWN = 23;          // cards at a box that counts as known
const LEARNING = 11;       // cards met but not yet known
const DAY_COUNTS = [41, 27, 33, 19, 46, 28, 37];   // six days ago .. today
const STREAK = 9;
const SESSION_PCTS = [52, 61, 58, 70, 77, 84, 91];

function seed(subject) {
  const ids = cardIds(subject, KNOWN + LEARNING);
  const items = {};
  ids.forEach((id, i) => {
    const known = i < KNOWN;
    items[id] = {
      box: known ? 4 : 1,
      seen: known ? 6 : 2,
      correct: known ? 5 : 1,
      incorrect: 1,
      due: dayKey(known ? 9 : 1)
    };
  });
  const days = {};
  DAY_COUNTS.forEach((n, i) => { days[dayKey(i - 6)] = n; });
  const history = SESSION_PCTS.map((pct, i) => ({
    ts: Date.now() - (SESSION_PCTS.length - i) * 86400000,
    date: dayKey(i - 6), mode: 'Drill', label: 'Drill',
    correct: Math.round(pct / 10), total: 10, pct: pct
  }));

  const file = server.progressPath('returning-user', subject);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    items, days, history, streak: { count: STREAK, last: dayKey(0) }, settings: {}
  }));
  return ids;
}

(async () => {
  const listener = server.app.listen(0);
  await new Promise(r => listener.once('listening', r));
  const base = 'http://127.0.0.1:' + listener.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });

  for (const subject of ['aphg', 'spanish']) {
    seed(subject);

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const sid = server.__testCreateSession({ sub: 'returning-user', email: 'returning@example.com', name: 'Returning User' });
    await ctx.addCookies([{ name: 'hub_session', value: sid, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();

    const calls = [];
    page.on('request', r => { if (r.url().includes('/api/')) calls.push(r.method() + ' ' + r.url().replace(base, '')); });

    await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    const consoleText = () => page.evaluate(() => document.querySelector('#app').innerText);
    const openPage = label => page.evaluate(l => {
      const b = Array.from(document.querySelectorAll('.tabs button, .rail button.nav, .bottombar button'))
        .find(x => (x.textContent || '').trim().endsWith(l));
      if (b) b.click();
    }, label);

    await check(subject + ': the page asks the server for this user\'s progress', async () => {
      ok(calls.some(c => c.includes('/api/progress?subject=' + subject)),
        'never requested progress; saw: ' + calls.join(', '));
    });

    const home = await consoleText();

    await check(subject + ': the console reports the cards this user actually knows', async () => {
      ok(home.includes(String(KNOWN)),
        'expected ' + KNOWN + ' known cards on the console, got:\n' + home.slice(0, 400));
    });

    await check(subject + ': the streak is this user\'s streak', async () => {
      ok(new RegExp('\\b' + STREAK + '\\b').test(home),
        'expected a ' + STREAK + '-day streak somewhere on the console');
    });

    await check(subject + ': the week\'s bars are this user\'s days', async () => {
      const shown = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.fcval')).map(e => Number(e.textContent.trim())));
      ok(shown.length === 7, 'expected 7 bars, got ' + shown.length);
      ok(JSON.stringify(shown) === JSON.stringify(DAY_COUNTS),
        'bars read ' + JSON.stringify(shown) + ', seeded ' + JSON.stringify(DAY_COUNTS));
    });

    await check(subject + ': the session trend is this user\'s sessions', async () => {
      const first = SESSION_PCTS[0], last = SESSION_PCTS[SESSION_PCTS.length - 1];
      ok(home.includes(first + '%'), 'trend does not show the first session (' + first + '%)');
      ok(home.includes(last + '%'), 'trend does not show the latest session (' + last + '%)');
    });

    await check(subject + ': the study calendar is filled in, not blank', async () => {
      const filled = await page.evaluate(() =>
        document.querySelectorAll('.dgcell.l1, .dgcell.l2, .dgcell.l3, .dgcell.l4').length);
      ok(filled >= DAY_COUNTS.length,
        'only ' + filled + ' days shaded in the calendar, seeded ' + DAY_COUNTS.length);
    });

    await check(subject + ': the Progress page agrees with the console', async () => {
      await openPage('Progress');
      await page.waitForTimeout(400);
      const prog = await consoleText();
      ok(prog.includes(String(KNOWN)), 'Progress page does not show ' + KNOWN + ' known cards');
      ok(new RegExp('\\b' + STREAK + '\\b').test(prog), 'Progress page does not show the streak');
    });

    await check(subject + ': finishing a session reports it for the spreadsheet mirror', async () => {
      calls.length = 0;
      await openPage('Blast');
      await page.waitForTimeout(600);
      // Ten questions, each followed by a pause before the next appears. Keep
      // answering whenever an enabled box is on screen, until the round ends.
      let done = false;
      for (let i = 0; i < 90 && !done; i++) {
        done = await page.evaluate(() => {
          if (document.querySelector('.bover')) return true;
          const b = document.querySelector('.bbox:not([disabled])');
          if (b) b.click();
          return false;
        });
        await page.waitForTimeout(400);
      }
      ok(done, 'the Blast round never reached its results screen');
      ok(calls.some(c => c.startsWith('POST /api/session-complete')),
        'no session-complete after finishing a round; saw: ' + calls.join(', '));
    });

    await ctx.close();
  }

  await browser.close();
  listener.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? '\n' + failures + ' SIGN-IN CHECK(S) FAILED' : '\nALL SIGN-IN CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('RUNNER FAILED', e); process.exit(2); });
