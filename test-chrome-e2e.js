/* Checks the navigation and the sign-in control across every combination that
   matters: both subjects, phone and desktop width, signed in and signed out.

   These are the cases that broke in use — AP HG had no bottom bar on a phone,
   the Spanish rail hid sign-in along with itself at phone width, and a deferred
   engine script meant signed-out visitors silently got the previous interface.

   Requires playwright-core and the preinstalled Chromium; skips cleanly if
   either is unavailable. */
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { console.log('playwright-core not installed — skipping chrome checks.'); process.exit(0); }
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!fs.existsSync(CHROME)) { console.log('no Chromium at ' + CHROME + ' — skipping.'); process.exit(0); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-chrome-'));
process.env.DATA_DIR = TMP;
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ||
  '000000000000-e2etest.apps.googleusercontent.com';
const server = require('./server.js');

const VIEWPORTS = [{ name: 'phone', width: 390, height: 780 },
                   { name: 'desktop', width: 1280, height: 900 }];

(async () => {
  const listener = server.app.listen(0);
  await new Promise(r => listener.once('listening', r));
  const base = 'http://127.0.0.1:' + listener.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });

  let failures = 0;
  for (const vp of VIEWPORTS) {
    for (const subject of ['aphg', 'spanish']) {
      for (const signedIn of [false, true]) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        if (signedIn) {
          const sid = server.__testCreateSession({ sub: 'chrome-' + subject + vp.name, email: 'c@example.com', name: 'Sam Tester' });
          await ctx.addCookies([{ name: 'hub_session', value: sid, domain: '127.0.0.1', path: '/' }]);
        }
        const page = await ctx.newPage();
        await page.goto(base + '/' + subject, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        const r = await page.evaluate(() => {
          const shown = sel => {
            const e = document.querySelector(sel);
            return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
          };
          return {
            engine: !!document.querySelector('#app[data-engine]'),
            bottomButtons: document.querySelectorAll('.bottombar button').length,
            bottom: shown('.bottombar'), tabs: shown('.tabs'), rail: shown('.rail'),
            auth: [...document.querySelectorAll('.authbox')].some(a =>
              getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 0),
            signIn: [...document.querySelectorAll('.gbtn button, .gbtn iframe, .gbtn div[role=button]')]
              .some(e => e.getBoundingClientRect().width > 0),
            signOut: !!document.querySelector('.linkbtn'),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        });
        await ctx.close();

        const problems = [];
        if (!r.engine) problems.push('the new interface did not mount at all');
        if (vp.name === 'phone') {
          if (!r.bottom) problems.push('no bottom bar');
          if (r.bottomButtons !== 9) problems.push(r.bottomButtons + ' bottom-bar items, expected 9');
          if (r.tabs) problems.push('the top tab strip is still showing alongside it');
          if (r.rail) problems.push('the rail is still showing alongside it');
        } else {
          if (r.bottom) problems.push('the bottom bar is showing on a desktop');
          if (subject === 'aphg' && !r.tabs) problems.push('no top tab strip');
          if (subject === 'spanish' && !r.rail) problems.push('no rail');
        }
        if (!r.auth) problems.push('no sign-in area anywhere on the page');
        else if (signedIn && !r.signOut) problems.push('signed in but no way to sign out');
        else if (!signedIn && !r.signIn) problems.push('signed out but no sign-in control');
        if (r.overflow > 2) problems.push('scrolls sideways by ' + r.overflow + 'px');

        const label = vp.name.padEnd(8) + subject.padEnd(9) + (signedIn ? 'signed-in ' : 'signed-out');
        if (problems.length) { failures++; console.log('FAIL  ' + label + ' -> ' + problems.join('; ')); }
        else console.log('OK    ' + label);
      }
    }
  }

  await browser.close();
  listener.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failures ? '\n' + failures + ' CHROME CHECK(S) FAILED' : '\nALL CHROME CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('RUNNER FAILED', e); process.exit(2); });
