/* End-to-end exercise of the live sync layer over real HTTP: sign-in state,
   saving, the monotonic merge that protects a second device, pulling progress
   back on a revisit, per-subject and per-user isolation, and session-complete.

   Runs the actual express app on a real socket against a throwaway DATA_DIR, so
   nothing here touches the production volume or a developer's data/ folder. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-e2e-'));
process.env.DATA_DIR = TMP;

const server = require('./server.js');
const { app, progressPath } = server;

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('OK   ' + name))
    .catch(e => { failures++; console.log('FAIL ' + name + ' -> ' + e.message); });
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || 'value') + ': got ' + a + ', expected ' + b);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

let base = '';
function call(method, url, { body, cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(res => res.text().then(text => {
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html route */ }
    return { status: res.status, data, text, headers: res.headers };
  }));
}

function progressFor(items, days) {
  return { items: items || {}, days: days || {}, streak: { count: 1, last: '2026-09-14' } };
}

(async () => {
  const listener = app.listen(0);
  await new Promise(r => listener.once('listening', r));
  base = 'http://127.0.0.1:' + listener.address().port;

  const alice = 'hub_session=' + server.__testCreateSession({ sub: 'alice-sub', email: 'alice@example.com', name: 'Alice' });
  const bob = 'hub_session=' + server.__testCreateSession({ sub: 'bob-sub', email: 'bob@example.com', name: 'Bob' });

  console.log('--- pages are served ---');
  for (const [url, needle] of [['/', 'html'], ['/aphg', 'html'], ['/spanish', 'html'], ['/privacy', 'html']]) {
    await check('GET ' + url + ' returns a page', async () => {
      const r = await call('GET', url);
      eq(r.status, 200, 'status');
      ok(r.text.length > 500, 'page looks empty (' + r.text.length + ' bytes)');
      ok(/<\/html>|<script|<style/i.test(r.text), 'does not look like ' + needle);
    });
  }

  console.log('--- signed-out state ---');
  await check('GET /api/me with no cookie reports nobody signed in', async () => {
    const r = await call('GET', '/api/me');
    eq(r.status, 200, 'status');
    eq(r.data.user, null, 'user');
  });
  await check('GET /api/progress without a session is refused', async () => {
    const r = await call('GET', '/api/progress?subject=aphg');
    eq(r.status, 401, 'status');
  });
  await check('PUT /api/progress without a session is refused', async () => {
    const r = await call('PUT', '/api/progress?subject=aphg', { body: progressFor() });
    eq(r.status, 401, 'status');
  });

  console.log('--- signed-in identity ---');
  await check('GET /api/me with a session returns that user', async () => {
    const r = await call('GET', '/api/me', { cookie: alice });
    eq(r.data.user.sub, 'alice-sub', 'sub');
    eq(r.data.user.email, 'alice@example.com', 'email');
  });

  console.log('--- saving ---');
  await check('a first save lands on disk', async () => {
    const body = progressFor({ 'card-1': { box: 2, seen: 3, correct: 2, incorrect: 1, due: '2026-09-20' } },
      { '2026-09-14': 12 });
    const r = await call('PUT', '/api/progress?subject=aphg', { body, cookie: alice });
    eq(r.status, 200, 'status');
    const file = progressPath('alice-sub', 'aphg');
    ok(fs.existsSync(file), 'no file written at ' + file);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq(saved.items['card-1'].seen, 3, 'saved seen');
    eq(saved.days['2026-09-14'], 12, 'saved day count');
  });

  await check('a revisit pulls the same progress back', async () => {
    const r = await call('GET', '/api/progress?subject=aphg', { cookie: alice });
    eq(r.status, 200, 'status');
    eq(r.data.progress.items['card-1'].box, 2, 'box');
    eq(r.data.progress.items['card-1'].correct, 2, 'correct');
    eq(r.data.progress.days['2026-09-14'], 12, 'day count');
  });

  console.log('--- the merge that protects a second device ---');
  await check('a stale save cannot roll a card backwards', async () => {
    const stale = progressFor({ 'card-1': { box: 1, seen: 1, correct: 1, incorrect: 0, due: '2026-09-15' } });
    await call('PUT', '/api/progress?subject=aphg', { body: stale, cookie: alice });
    const r = await call('GET', '/api/progress?subject=aphg', { cookie: alice });
    eq(r.data.progress.items['card-1'].seen, 3, 'seen should stay at the higher value');
    eq(r.data.progress.items['card-1'].box, 2, 'box should stay at the higher value');
  });

  await check('a newer save does move a card forwards', async () => {
    const fresh = progressFor({ 'card-1': { box: 4, seen: 9, correct: 7, incorrect: 2, due: '2026-10-01' } });
    await call('PUT', '/api/progress?subject=aphg', { body: fresh, cookie: alice });
    const r = await call('GET', '/api/progress?subject=aphg', { cookie: alice });
    eq(r.data.progress.items['card-1'].seen, 9, 'seen');
    eq(r.data.progress.items['card-1'].box, 4, 'box');
  });

  await check('a card only the other device has is kept, not dropped', async () => {
    const other = progressFor({ 'card-2': { box: 1, seen: 1, correct: 1, incorrect: 0, due: '2026-09-16' } });
    await call('PUT', '/api/progress?subject=aphg', { body: other, cookie: alice });
    const r = await call('GET', '/api/progress?subject=aphg', { cookie: alice });
    ok(r.data.progress.items['card-1'], 'card-1 was dropped by the merge');
    ok(r.data.progress.items['card-2'], 'card-2 was not merged in');
  });

  await check('a deliberate wipe (mode=replace) really wipes', async () => {
    await call('PUT', '/api/progress?subject=aphg&mode=replace', { body: progressFor(), cookie: alice });
    const r = await call('GET', '/api/progress?subject=aphg', { cookie: alice });
    eq(Object.keys(r.data.progress.items).length, 0, 'items after wipe');
  });

  console.log('--- isolation ---');
  await check('the two subjects do not share a file', async () => {
    await call('PUT', '/api/progress?subject=aphg', { body: progressFor({ a: { box: 1, seen: 1 } }), cookie: alice });
    await call('PUT', '/api/progress?subject=spanish', { body: progressFor({ s: { box: 5, seen: 8 } }), cookie: alice });
    const g = await call('GET', '/api/progress?subject=aphg', { cookie: alice });
    const s = await call('GET', '/api/progress?subject=spanish', { cookie: alice });
    ok(!g.data.progress.items.s, 'Spanish card leaked into AP HG');
    ok(!s.data.progress.items.a, 'AP HG card leaked into Spanish');
    eq(s.data.progress.items.s.seen, 8, 'Spanish seen');
  });

  await check('one user cannot see another user\'s progress', async () => {
    const r = await call('GET', '/api/progress?subject=aphg', { cookie: bob });
    ok(!r.data.progress || !r.data.progress.items.a, 'Bob can see Alice\'s cards');
  });

  await check('an unknown subject is rejected', async () => {
    const r = await call('GET', '/api/progress?subject=chemistry', { cookie: alice });
    eq(r.status, 400, 'status');
  });

  await check('a malformed payload is rejected', async () => {
    const r = await call('PUT', '/api/progress?subject=aphg', { body: ['not', 'an', 'object'], cookie: alice });
    eq(r.status, 400, 'status');
  });

  console.log('--- finishing a session ---');
  await check('a completed session is accepted', async () => {
    const r = await call('POST', '/api/session-complete', {
      body: { subject: 'aphg', total: 12, correct: 9, pct: 75, mode: 'drill' }, cookie: alice
    });
    eq(r.status, 200, 'status');
    eq(r.data.ok, true, 'ok');
  });
  await check('a session-complete missing its numbers is rejected', async () => {
    const r = await call('POST', '/api/session-complete', { body: { subject: 'aphg' }, cookie: alice });
    eq(r.status, 400, 'status');
  });
  await check('session-complete needs a session', async () => {
    const r = await call('POST', '/api/session-complete', { body: { subject: 'aphg', total: 1, correct: 1, pct: 100 } });
    eq(r.status, 401, 'status');
  });

  console.log('--- signing out ---');
  await check('logout ends the session', async () => {
    const carol = 'hub_session=' + server.__testCreateSession({ sub: 'carol-sub', email: 'c@example.com', name: 'Carol' });
    const before = await call('GET', '/api/me', { cookie: carol });
    eq(before.data.user.sub, 'carol-sub', 'signed in before logout');
    await call('POST', '/api/auth/logout', { cookie: carol });
    const after = await call('GET', '/api/me', { cookie: carol });
    eq(after.data.user, null, 'still signed in after logout');
  });

  listener.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(failures ? '\n' + failures + ' END-TO-END CHECK(S) FAILED' : '\nALL END-TO-END CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
