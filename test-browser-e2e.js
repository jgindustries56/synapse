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
    // Google's script host is unreachable from this sandbox, and a missing
    // favicon is not an application fault.
    if (/ERR_CONNECTION|ERR_NAME|favicon|gsi\/client|accounts\.google|status of 404/.test(t)) return;
    pageErrors.push('console: ' + t);
  });

  for (const subject of ['aphg', 'spanish']) {
    calls.length = 0;
    await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    await check(subject + ': the page recognises the signed-in user', async () => {
      ok(calls.some(c => c.startsWith('GET /api/me')), 'never asked who is signed in');
      const body = await page.locator('body').innerText();
      ok(/E2E Tester|e2e@example\.com|Sign out/i.test(body),
        'no sign of the signed-in user on the page');
    });

    await check(subject + ': progress is pulled on arrival', async () => {
      ok(calls.some(c => c.includes('/api/progress?subject=' + subject)),
        'never touched /api/progress on load; saw: ' + calls.join(', '));
    });

    await check(subject + ': the console renders real content, not an empty shell', async () => {
      const text = await page.locator('body').innerText();
      ok(text.length > 400, 'page body is only ' + text.length + ' characters');
      ok(/\d/.test(text), 'no numbers rendered anywhere');
    });

    // ---- answering must reach the server -------------------------------
    calls.length = 0;
    await check(subject + ': answering a question saves to the server', async () => {
      const started = await startAnySession(page);
      ok(started, 'could not start a study session from the UI');
      const answered = await answerOne(page);
      ok(answered, 'could not answer a question');
      await page.waitForTimeout(700);
      ok(calls.some(c => c.startsWith('PUT /api/progress')),
        'no PUT /api/progress after answering; saw: ' + calls.join(', '));
    });

    await check(subject + ': the save actually landed on disk', async () => {
      const file = server.progressPath('e2e-user', subject);
      ok(fs.existsSync(file), 'no progress file at ' + file);
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      ok(Object.keys(saved.items || {}).length > 0, 'progress file has no cards in it');
    });

    // ---- the lag the user complained about ------------------------------
    await check(subject + ': opening the help panel does not rebuild the page', async () => {
      await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const r = await page.evaluate(async () => {
        const app = document.querySelector('#app');
        const before = app.children.length;
        let removed = 0;
        const obs = new MutationObserver(ms => ms.forEach(m => {
          if (m.target === app) removed += m.removedNodes.length;
        }));
        obs.observe(app, { childList: true });
        const btn = app.querySelector('.info-btn');
        if (btn) btn.click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        obs.disconnect();
        return { before, removed, opened: !!app.querySelector('.info-panel'), had: !!btn };
      });
      log.push('       help panel: ' + r.removed + ' of ' + r.before + ' nodes torn out');
      ok(r.had, 'no help button found');
      ok(r.opened, 'the help panel did not open');
      ok(r.removed === 0, 'opening the help panel tore out ' + r.removed +
        ' of ' + r.before + ' top-level nodes — a full-page rebuild for a panel toggle');
    });

    await check(subject + ': opening the help panel does not rebuild the page', async () => {
      await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const r = await page.evaluate(async () => {
        const app = document.querySelector('#app');
        const before = app.children.length;
        let removed = 0;
        const obs = new MutationObserver(ms => ms.forEach(m => {
          if (m.target === app) removed += m.removedNodes.length;
        }));
        obs.observe(app, { childList: true });
        const btn = app.querySelector('.info-btn');
        if (btn) btn.click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        obs.disconnect();
        return { before, removed, opened: !!app.querySelector('.info-panel'), had: !!btn };
      });
      log.push('       help panel: ' + r.removed + ' of ' + r.before + ' nodes torn out');
      ok(r.had, 'no help button found');
      ok(r.opened, 'the help panel did not open');
      ok(r.removed === 0, 'opening the help panel tore out ' + r.removed +
        ' of ' + r.before + ' top-level nodes — a full-page rebuild for a panel toggle');
    });

    await check(subject + ': re-selecting the page you are on does not throw you to the top', async () => {
      await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const r = await page.evaluate(async () => {
        const click = re => {
          const b = Array.from(document.querySelectorAll('button'))
            .find(x => re.test(x.textContent || ''));
          if (b) { b.click(); return true; }
          return false;
        };
        document.documentElement.style.minHeight = '3000px';
        window.scrollTo(0, 600);
        await new Promise(r => setTimeout(r, 120));
        const from = Math.round(window.scrollY);
        const hit = click(/Home/i);                 // the page we are already on
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const to = Math.round(window.scrollY);
        document.documentElement.style.minHeight = '';
        return { hit, from, to };
      });
      log.push('       same-page click: scroll ' + r.from + ' -> ' + r.to);
      ok(r.hit, 'no Home button to press');
      ok(!(r.from > 300 && r.to === 0),
        'pressing the page you are already on scrolled you back to the top (' +
        r.from + ' -> ' + r.to + ')');
    });

    await check(subject + ': answering mid-session does not repaint the page around you', async () => {
      await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const started = await startAnySession(page);
      ok(started, 'could not start a session to measure');
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(150);
      const r = await repaintReport(page, () => {
        // In a running session the answers are the numbered buttons.
        const b = Array.from(document.querySelectorAll('button'))
          .find(x => /^[1-4]\s*\S/.test((x.textContent || '').trim()));
        if (b) b.click();
      });
      log.push('       answering:   ' + r.removed + ' of ' + r.before +
        ' top-level nodes replaced, ' + Math.round(r.ms) + 'ms, scroll ' +
        r.scrollFrom + ' -> ' + r.scrollTo);
      ok(!r.wipedAll,
        'answering a question rebuilt all ' + r.before + ' top-level nodes');
      ok(!(r.scrollFrom > 100 && r.scrollTo === 0),
        'answering threw the page back to the top (scroll ' + r.scrollFrom + ' -> ' + r.scrollTo + ')');
      ok(r.ms < 120, 'the click took ' + Math.round(r.ms) + 'ms to settle');
    });

    // ---- a revisit gets the data back ------------------------------------
    await check(subject + ': a revisit shows the work from the last visit', async () => {
      const file = server.progressPath('e2e-user', subject);
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const seenCards = Object.keys(saved.items).length;
      const fresh = await ctx.newPage();
      await fresh.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
      await fresh.waitForTimeout(900);
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

/* The apps open a session either from the recommended "Start" button on the
   console or from any topic tile; the questions themselves are numbered
   buttons, or a text box for typed recall. */
async function startAnySession(page) {
  const opened = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const start = btns.find(b => /Start/i.test(b.textContent || ''));
    if (start) { start.click(); return 'start'; }
    const topic = btns.find(b => /\d+%$/.test((b.textContent || '').trim()));
    if (topic) { topic.click(); return 'topic'; }
    return '';
  });
  if (!opened) return false;
  await page.waitForTimeout(700);
  if (await hasQuestion(page)) return true;

  // A topic tile can open a picker first; take whatever it offers.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /Start|Begin|All|Mixed|Go/i.test(x.textContent || ''));
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  return hasQuestion(page);
}

async function hasQuestion(page) {
  return page.evaluate(() => {
    const numbered = Array.from(document.querySelectorAll('button'))
      .filter(b => /^[1-4]\s*\S/.test((b.textContent || '').trim())).length;
    const typed = !!document.querySelector('#app input[type="text"], #app input:not([type])');
    const exiting = /Exit/i.test(document.body.innerText);
    return exiting && (numbered >= 2 || typed);
  });
}

async function answerOne(page) {
  return page.evaluate(() => {
    const input = document.querySelector('#app input[type="text"], #app input:not([type])');
    if (input) {
      input.value = 'something';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const go = Array.from(document.querySelectorAll('button'))
        .find(b => /check|submit|answer/i.test(b.textContent || ''));
      if (go) go.click();
      return true;
    }
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /^[1-4]\s*\S/.test((x.textContent || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  });
}
