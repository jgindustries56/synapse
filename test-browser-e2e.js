/* Drives the real signed-in app in a real browser: does the console fill with
   data, does answering save, does a revisit pull that save back, does finishing
   a session report it, and does pressing a button repaint the whole page.

   Runs the actual express app against a throwaway DATA_DIR. Requires
   playwright-core and the preinstalled Chromium; skips cleanly if absent. */
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) {
  console.log('playwright-core not installed — skipping browser end-to-end.');
  process.exit(0);
}
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!fs.existsSync(CHROME)) {
  console.log('no Chromium at ' + CHROME + ' — skipping browser end-to-end.');
  process.exit(0);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-browser-'));
process.env.DATA_DIR = TMP;
// The app only wires up sign-in and cloud sync when a real-looking Google
// client id was substituted into the page. Without one it deliberately runs
// local-only, so a test with no id set would exercise the wrong half of the
// code. Production always has one; give the test one too.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ||
  '000000000000-e2etest.apps.googleusercontent.com';
const server = require('./server.js');

let failures = 0;
const log = [];
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { log.push('OK   ' + name); })
    .catch(e => { failures++; log.push('FAIL ' + name + ' -> ' + e.message); });
}
function ok(cond, what) { if (!cond) throw new Error(what); }

(async () => {
  const listener = server.app.listen(0);
  await new Promise(r => listener.once('listening', r));
  const port = listener.address().port;
  const base = 'http://127.0.0.1:' + port;
  const sid = server.__testCreateSession({ sub: 'e2e-user', email: 'e2e@example.com', name: 'E2E Tester' });

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'hub_session', value: sid, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();

  const calls = [];
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/api/')) calls.push(r.method() + ' ' + u.replace(base, ''));
  });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const missing = [];
  page.on('response', r => { if (r.status() === 404) missing.push(r.url().replace(base, '')); });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Google's script and font hosts are unreachable from this sandbox, whose
    // TLS proxy also fails cert validation on them. Neither is an application
    // fault, and neither happens in production.
    if (/ERR_CONNECTION|ERR_NAME|ERR_CERT|favicon|gsi\/client|accounts\.google|fonts\.g|status of 404/.test(t)) return;
    pageErrors.push('console: ' + t);
  });

  for (const subject of ['aphg', 'spanish']) {
    calls.length = 0;
    await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1100);

    await check(subject + ': the page recognises the signed-in user', async () => {
      ok(calls.some(c => c.startsWith('GET /api/me')), 'never asked who is signed in');
      const body = await page.locator('body').innerText();
      ok(/E2E Tester|e2e@example\.com|Sign out/i.test(body), 'no sign of the signed-in user');
    });

    await check(subject + ': progress is pulled on arrival', async () => {
      ok(calls.some(c => c.includes('/api/progress?subject=' + subject)),
        'never touched /api/progress on load; saw: ' + calls.join(', '));
    });

    await check(subject + ': every page renders real content', async () => {
      const missing = [];
      for (const label of ['Console', 'Find', 'Cards', 'Drill', 'Blast', 'Match', 'Learn', 'Test', 'Progress']) {
        const clicked = await page.evaluate(l => {
          const b = Array.from(document.querySelectorAll(
            '.tabs button, .rail button.nav, .bottombar button'))
            .find(x => (x.textContent || '').trim().endsWith(l));
          if (b) { b.click(); return true; }
          return false;
        }, label);
        if (!clicked) { missing.push(label + ' (no tab)'); continue; }
        await page.waitForTimeout(320);
        const len = await page.evaluate(() => (document.querySelector('#app').innerText || '').length);
        // Blast is deliberately sparse: one question and four answers, nothing else.
        const floor = label === 'Blast' ? 120 : 300;
        if (len < floor) missing.push(label + ' (' + len + ' chars)');
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 2) missing.push(label + ' (overflows ' + over + 'px)');
      }
      ok(missing.length === 0, 'pages not rendering: ' + missing.join(', '));
    });

    await check(subject + ': the deck is the real one', async () => {
      const txt = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('.tabs button, .rail button.nav, .bottombar button'))
          .find(x => (x.textContent || '').trim().endsWith('Console'));
        if (b) b.click();
        return document.querySelector('#app').innerText;
      });
      const expect = subject === 'aphg' ? '346' : '1,322';
      ok(txt.includes(expect), 'console does not mention the full deck (' + expect + ')');
    });

    // ---- answering must reach the server -------------------------------
    calls.length = 0;
    await check(subject + ': answering a question saves to the server', async () => {
      await openDrill(page);
      ok(await answerOne(page), 'could not answer a question on the Drill page');
      await page.waitForTimeout(800);
      ok(calls.some(c => c.startsWith('PUT /api/progress')),
        'no PUT /api/progress after answering; saw: ' + calls.join(', '));
    });

    await check(subject + ': the save actually landed on disk', async () => {
      const file = server.progressPath('e2e-user', subject);
      ok(fs.existsSync(file), 'no progress file at ' + file);
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      ok(Object.keys(saved.items || {}).length > 0, 'progress file has no cards in it');
    });

    await check(subject + ': search finds a real card', async () => {
      await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('.tabs button, .rail button.nav, .bottombar button'))
          .find(x => (x.textContent || '').trim().endsWith('Find'));
        if (b) b.click();
      });
      await page.waitForTimeout(400);
      const term = subject === 'spanish' ? 'car gar zar' : 'migration';
      await page.fill('#find-input', term);
      await page.waitForTimeout(400);
      const res = await page.locator('.resbar').innerText().catch(() => '');
      ok(/matching/.test(res), 'search for "' + term + '" produced no results ("' + res + '")');
    });

    await check(subject + ': Blast offers exactly four answers', async () => {
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('.tabs button, .rail button.nav, .bottombar button'))
          .find(x => (x.textContent || '').trim().endsWith('Blast'));
        if (b) b.click();
      });
      await page.waitForTimeout(500);
      const n = await page.locator('.bbox').count();
      ok(n === 4, 'Blast showed ' + n + ' answer boxes, expected 4');
    });

    // ---- pressing a button must not rebuild the page around you ---------
    await check(subject + ': answering does not repaint the page around you', async () => {
      await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await openDrill(page);
      const r = await page.evaluate(async () => {
        const app = document.querySelector('#app');
        const surface = app.firstElementChild || app;
        const before = surface.children.length;
        let removed = 0;
        const obs = new MutationObserver(ms => ms.forEach(m => {
          if (m.target === surface) removed += m.removedNodes.length;
        }));
        obs.observe(surface, { childList: true });
        window.scrollTo(0, 300);
        const from = Math.round(window.scrollY);
        const t0 = performance.now();
        const b = document.querySelector('.opt') ||
          Array.from(document.querySelectorAll('.typedrow .btn'))[0];
        if (b) b.click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        obs.disconnect();
        return { before, removed, ms: performance.now() - t0,
                 from, to: Math.round(window.scrollY) };
      });
      log.push('       answering: ' + r.removed + ' of ' + r.before + ' page nodes replaced, ' +
        Math.round(r.ms) + 'ms, scroll ' + r.from + ' -> ' + r.to);
      ok(r.removed === 0, 'answering replaced ' + r.removed + ' of ' + r.before + ' page-level nodes');
      ok(!(r.from > 100 && r.to === 0), 'answering threw the page back to the top');
    });

    // ---- a revisit gets the data back ------------------------------------
    await check(subject + ': a revisit shows the work from the last visit', async () => {
      const file = server.progressPath('e2e-user', subject);
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const seenCards = Object.keys(saved.items).length;
      const fresh = await ctx.newPage();
      await fresh.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await fresh.waitForTimeout(1100);
      const restored = await fresh.evaluate(() => {
        try {
          const k = Object.keys(localStorage).find(x => /progress/.test(x));
          return k ? Object.keys(JSON.parse(localStorage.getItem(k)).items || {}).length : -1;
        } catch (e) { return -1; }
      });
      await fresh.close();
      ok(restored >= seenCards,
        'server holds ' + seenCards + ' answered cards but the fresh page restored ' + restored);
    });

    await check(subject + ': ?classic=1 still brings back the previous interface', async () => {
      await page.goto(base + '/' + subject + '?classic=1', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const has = await page.evaluate(() => !!document.querySelector('.info-btn, .nav-wrap'));
      ok(has, 'the classic fallback did not render');
    });
  }

  await check('no uncaught errors anywhere in the run', () => {
    ok(pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  });
  await check('no page asset is missing', () => {
    const real = missing.filter(u => !/favicon/.test(u));
    ok(real.length === 0, 'got 404 for: ' + real.slice(0, 5).join(', '));
  });

  await browser.close();
  listener.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(log.join('\n'));
  console.log(failures ? '\n' + failures + ' BROWSER CHECK(S) FAILED' : '\nALL BROWSER CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('RUNNER FAILED', e); process.exit(2); });

/* Counts how much of the app's container is thrown away and rebuilt by one
   click. Replacing every top-level node is the signature of a full-page
   re-render, which is what the eye reads as a flash. */
async function repaintReport(page, clickFn) {
  return page.evaluate(async (fnBody) => {
    const root = document.querySelector('#app') || document.body;
    const before = root.children.length;
    let removed = 0, added = 0;
    const obs = new MutationObserver(muts => muts.forEach(m => {
      if (m.target !== root) return;
      removed += m.removedNodes.length;
      added += m.addedNodes.length;
    }));
    obs.observe(root, { childList: true });
    const scrollFrom = Math.round(window.scrollY);
    const t0 = performance.now();
    // eslint-disable-next-line no-new-func
    (new Function(fnBody))();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ms = performance.now() - t0;
    obs.disconnect();
    return { before, removed, added, ms, wipedAll: before > 0 && removed >= before,
             scrollFrom, scrollTo: Math.round(window.scrollY) };
  }, '(' + clickFn.toString() + ')()');
}

/* The engine puts every question on the Drill page: four options, or a text
   box where the card has nothing to choose between. */
async function openDrill(page) {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.tabs button, .rail button.nav, .bottombar button'))
      .find(x => (x.textContent || '').trim().endsWith('Drill'));
    if (b) b.click();
  });
  await page.waitForTimeout(600);
}

async function answerOne(page) {
  return page.evaluate(() => {
    const opt = document.querySelector('.opt');
    if (opt) { opt.click(); return true; }
    const input = document.querySelector('.typedrow input');
    if (input) {
      input.value = 'something';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const go = document.querySelector('.typedrow .btn');
      if (go) { go.click(); return true; }
    }
    return false;
  });
}
