/* ============================================================
   Synapse — shared view engine.

   One engine renders every subject. It owns no content and no storage: the
   host page hands it the deck it already builds and an adapter over the
   progress and sign-in it already has, so the scheduling, the server sync and
   the content stay exactly where they were and only the interface lives here.

     window.Synapse.mount({
       subject, name, short, tagline, nav: 'top' | 'rail', shell, cats, goal,
       unitWord, speak, lang, rootId,
       data:     { topics, units, icons, items },
       progress: { read, save, record, logSession, reset, setGoal },
       auth:     { user, configured, signOut, mountButton }
     });

   Rendering rule: changing page builds the new page detached and swaps it in
   with one replaceChildren(). Anything that happens inside a page mutates its
   own nodes, so pressing a button never rebuilds the screen around it.
   ============================================================ */
(function () {
  "use strict";

  var PAGES = [
    { id: 'home',     label: 'Console',  icon: '◴' },
    { id: 'search',   label: 'Find',     icon: '⌕' },
    { id: 'cards',    label: 'Cards',    icon: '▧' },
    { id: 'drill',    label: 'Drill',    icon: '✎' },
    { id: 'blast',    label: 'Blast',    icon: '⚡' },
    { id: 'match',    label: 'Match',    icon: '⧉' },
    { id: 'learn',    label: 'Learn',    icon: '◎' },
    { id: 'test',     label: 'Test',     icon: '✓' },
    { id: 'progress', label: 'Progress', icon: '↗' }
  ];

  var INTERVALS = [0, 1, 3, 7, 14, 30];
  var STAGE_WORDS = ['just learned', 'starting to stick', 'sticking', 'solid', 'known'];
  var MASTER_BOX = 3;
  var BOX_COLORS = ['c0', 'c1', 'c2', 'c3'];

  var CFG = null;      // the mounted subject
  var HOST = null;     // the host page's progress adapter
  /* ------------------------------------------------------------------ *
   * Small helpers                                                       *
   * ------------------------------------------------------------------ */

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function txt(tag, cls, t) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (t != null) n.textContent = t;
    return n;
  }
  function button(cls, html, fn) {
    var b = el('button', cls, html);
    b.type = 'button';
    if (fn) b.addEventListener('click', fn);
    return b;
  }
  function frag() { return document.createDocumentFragment(); }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function stripTags(s) { return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pct(n, d) { return d ? Math.round(100 * n / d) : 0; }
  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function shiftDays(d, n) { var c = new Date(d.getTime()); c.setDate(c.getDate() + n); return c; }
  function todayKey() { return dayKey(today()); }
  function prettyDate(d) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  /* Deterministic generator, so the seeded demo history is the same on every
     load rather than a different story each refresh. */
  function seeded(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }


  /* ------------------------------------------------------------------ *
   * Progress — an adapter, not a store                                  *
   *                                                                     *
   * Everything below reads and writes the host page's own progress       *
   * object, the same one it syncs to the server. The engine never         *
   * persists anything itself, so sign-in and cloud sync keep working      *
   * exactly as they did.                                                  *
   * ------------------------------------------------------------------ */

  function load() {
    var P = HOST.read() || {};
    if (!P.items) P.items = {};
    if (!P.days) P.days = {};
    if (!P.starred) P.starred = {};
    if (!P.best) P.best = { match: null, blast: null };
    if (!P.history) P.history = [];
    if (!P.goal) P.goal = CFG.goal || 30;
    return P;
  }
  function save() { HOST.save(); }

  // The trend line reads the session history the host already records rather
  // than keeping a second copy of the same thing.
  function sessionPcts() {
    return load().history
      .map(function (h) { return h.pct; })
      .filter(function (n) { return typeof n === 'number'; });
  }

  /* ------------------------------------------------------------------ *
   * Derived statistics                                                  *
   * ------------------------------------------------------------------ */

  function itemProg(cfg, id) { return load(cfg).items[id] || null; }
  function isKnown(cfg, id) { var p = itemProg(cfg, id); return !!p && p.box >= MASTER_BOX; }
  function isUnseen(cfg, id) { return !itemProg(cfg, id); }

  function dueItems(cfg) {
    var k = todayKey();
    return cfg.data.items.filter(function (it) {
      var p = itemProg(cfg, it.id);
      return p && p.due <= k;
    });
  }
  function overdueCount(cfg) {
    var y = dayKey(shiftDays(today(), -1));
    return cfg.data.items.filter(function (it) {
      var p = itemProg(cfg, it.id);
      return p && p.due <= y;
    }).length;
  }
  function knownCount(cfg) {
    return cfg.data.items.filter(function (it) { return isKnown(cfg, it.id); }).length;
  }
  function unseenCount(cfg) {
    return cfg.data.items.filter(function (it) { return isUnseen(cfg, it.id); }).length;
  }
  function lifetime(cfg) {
    var P = load(cfg), seen = 0, right = 0;
    Object.keys(P.items).forEach(function (id) {
      seen += P.items[id].seen || 0;
      right += P.items[id].right || 0;
    });
    return { seen: seen, right: right, pct: pct(right, seen) };
  }
  function streak(cfg) {
    var P = load(cfg), n = 0, d = today();
    if (!P.days[dayKey(d)]) d = shiftDays(d, -1);
    while (P.days[dayKey(d)]) { n++; d = shiftDays(d, -1); }
    return n;
  }
  function last7(cfg) {
    var P = load(cfg), out = [], t = today();
    for (var i = 6; i >= 0; i--) {
      var d = shiftDays(t, -i);
      out.push({ date: d, key: dayKey(d), n: P.days[dayKey(d)] || 0, isToday: i === 0 });
    }
    return out;
  }
  function weekTotal(cfg, weeksAgo) {
    var P = load(cfg), t = today(), sum = 0;
    for (var i = 0; i < 7; i++) sum += P.days[dayKey(shiftDays(t, -(weeksAgo * 7 + i)))] || 0;
    return sum;
  }
  function topicStats(cfg, topicId) {
    var items = cfg.data.items.filter(function (it) { return it.topic === topicId; });
    var known = items.filter(function (it) { return isKnown(cfg, it.id); }).length;
    var seen = 0;
    items.forEach(function (it) { var p = itemProg(cfg, it.id); if (p) seen += p.seen || 0; });
    return { total: items.length, known: known, pct: pct(known, items.length), seen: seen };
  }
  function catStats(cfg, cat) {
    var ids = {};
    cfg.data.topics.forEach(function (t) { if (t.cat === cat) ids[t.id] = 1; });
    var items = cfg.data.items.filter(function (it) { return ids[it.topic]; });
    var known = items.filter(function (it) { return isKnown(cfg, it.id); }).length;
    return { total: items.length, known: known, pct: pct(known, items.length) };
  }
  function weakTopics(cfg, n) {
    return cfg.data.topics.map(function (t) {
      var s = topicStats(cfg, t.id);
      return { topic: t, s: s };
    }).sort(function (a, b) {
      if (a.s.seen === 0 && b.s.seen > 0) return 1;
      if (b.s.seen === 0 && a.s.seen > 0) return -1;
      return a.s.pct - b.s.pct;
    }).slice(0, n || 5);
  }
  /* "Most work left" is not the same question as "worst score", and Spanish's
     panel asks the first one. Stem-Changing Verbs is 174 cards: at 40% known it
     still has over a hundred outstanding, more than every small topic put
     together, and that is what the next session actually costs. Ranking by
     percentage alone hides exactly the topics that take the longest. */
  function topicsToWorkOn(cfg, n) {
    return cfg.data.topics.map(function (t) {
      var s = topicStats(cfg, t.id);
      return { topic: t, s: s, left: s.total - s.known };
    }).filter(function (r) { return r.left > 0; })
      .sort(function (a, b) {
        if (b.left !== a.left) return b.left - a.left;
        return a.s.pct - b.s.pct;
      }).slice(0, n || 6);
  }

  function goalToday(cfg) {
    var P = load(cfg);
    return { done: P.days[todayKey()] || 0, goal: P.goal };
  }

  /* ------------------------------------------------------------------ *
   * Answering                                                           *
   * ------------------------------------------------------------------ */

  /* The host owns scheduling: it already implements the Leitner boxes, the day
     counter and the streak, and it is what syncs to the server. The engine only
     reports the answer and reads back where the card landed. */
  function record(cfg, item, correct) {
    return HOST.record(item.id, correct) || { from: 0, to: 1, due: todayKey() };
  }

  function logSession(cfg, correct, total, label) {
    HOST.logSession({ correct: correct, total: total,
                      pct: pct(correct, Math.max(total, 1)), mode: label });
  }

  /* Stars live in their own map rather than on the card, so the per-card merge
     that reconciles two devices cannot drop one. */
  function toggleStar(cfg, id) {
    var P = load();
    if (P.starred[id]) delete P.starred[id]; else P.starred[id] = true;
    save();
    return !!P.starred[id];
  }
  function isStarred(id) { return !!load().starred[id]; }

  function normalise(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’']/g, "'")
      .replace(/(\d)\.(\d)/g, '$1$2')
      .replace(/[¿?¡!.,;:%]/g, '')
      .replace(//g, '.')
      .replace(/\s+/g, ' ').trim();
  }
  /* Search has to survive how people actually type a topic name. "-car/-gar/-zar
     Preterite" must be findable as "car gar zar", so punctuation becomes
     whitespace on both sides of the comparison. */
  function searchNorm(s) {
    return normalise(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isCorrectTyped(item, given) {
    var g = normalise(given);
    if (!g) return false;
    return item.answer.some(function (a) { return normalise(a) === g; });
  }

  /* Four options, always. Where an item ships fewer distractors than that, the
     gap is filled from sibling answers in the same topic so a four-box game
     never has to show a blank. */
  function optionsFor(cfg, item, want) {
    want = want || 4;
    var answer = item.answer[0];
    var wrong = [];
    if (item.choices) wrong = item.choices.filter(function (c) { return item.answer.indexOf(c) === -1; });
    else if (item.pool) wrong = item.pool.filter(function (c) { return item.answer.indexOf(c) === -1; });
    wrong = shuffle(wrong);
    if (wrong.length < want - 1) {
      var sibs = cfg.data.items.filter(function (o) {
        return o.topic === item.topic && o.type === item.type && o.id !== item.id;
      });
      shuffle(sibs).forEach(function (o) {
        var v = o.answer[0];
        if (wrong.length >= want - 1) return;
        if (item.answer.indexOf(v) !== -1) return;
        if (wrong.indexOf(v) !== -1) return;
        wrong.push(v);
      });
    }
    if (wrong.length < want - 1) return null;
    return shuffle(wrong.slice(0, want - 1).concat([answer]));
  }

  function canMultipleChoice(cfg, item) { return !!optionsFor(cfg, item, 4); }

  /* ------------------------------------------------------------------ *
   * Speech (Spanish only)                                               *
   * ------------------------------------------------------------------ */

  function speechAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }
  function speak(text, lang) {
    if (!speechAvailable()) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(stripTags(text));
      u.lang = lang || 'es-ES';
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) { /* no voice available */ }
  }
  function speakButton(cfg, text) {
    if (!cfg.speak || !speechAvailable()) return null;
    return button('speak', '▶ Say it', function (ev) {
      ev.stopPropagation();
      speak(text, cfg.lang);
    });
  }

  /* ------------------------------------------------------------------ *
   * Shared components                                                   *
   * ------------------------------------------------------------------ */

  function addSourceFoot(face, c, item) {
    var src = sourceOf(c, item.topic);
    add(face, txt('div', 'cfsrc', src.unit + (src.page ? ' · p.' + src.page : '')));
  }

  function pageHead(eyebrow, title) {
    var h = el('div', 'phead');
    if (eyebrow) add(h, txt('div', 'eyebrow', eyebrow));
    add(h, txt('h1', null, title));
    return h;
  }

  function lead(html, subHtml) {
    var l = el('div', 'lead');
    add(l, el('p', null, html));
    if (subHtml) add(l, el('div', 'sub', subHtml));
    return l;
  }

  function panel() {
    var p = el('div', 'panel');
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]);
    return p;
  }

  function says(say, because) {
    var f = frag();
    add(f, txt('p', 'say', say));
    if (because) add(f, txt('p', 'because', because));
    return f;
  }

  function cell(k, v, small, why, whyCls) {
    var c = el('div', 'cell');
    add(c, txt('div', 'k', k));
    var vv = el('div', 'v');
    vv.appendChild(document.createTextNode(v));
    if (small) add(vv, txt('small', null, ' ' + small));
    add(c, vv);
    if (why) add(c, txt('div', 'why' + (whyCls ? ' ' + whyCls : ''), why));
    return c;
  }

  function meterCell(p) {
    var td = el('td');
    var m = el('span', 'meter');
    var i = el('i');
    i.style.width = Math.max(p, 0) + '%';
    add(m, i);
    add(td, m);
    return td;
  }

  function table(headers, rows) {
    var t = el('table', 'tbl');
    var thead = el('thead'), tr = el('tr');
    headers.forEach(function (h) {
      var th = txt('th', null, h.label || '');
      if (h.width) th.style.width = h.width;
      add(tr, th);
    });
    add(thead, tr); add(t, thead);
    var tb = el('tbody');
    rows.forEach(function (r) { add(tb, r); });
    add(t, tb);
    return t;
  }

  /* Seven bars: how much you actually studied, day by day. Retrospective, not a
     forecast — the thing you can feel proud of rather than dread. */
  function activityBars(cfg) {
    var days = last7(cfg);
    var max = Math.max.apply(null, days.map(function (d) { return d.n; }).concat([1]));
    var wrap = el('div', 'fc');
    days.forEach(function (d) {
      var col = el('div', 'fcday' + (d.isToday ? ' today' : '') + (d.n === 0 ? ' zero' : ''));
      add(col, txt('span', 'fcval m', String(d.n)));
      var bar = el('div', 'fcbar');
      bar.style.height = Math.max(4, Math.round(100 * d.n / max)) + '%';
      add(col, bar);
      add(col, txt('span', 'fclab', d.isToday ? 'Today' :
        d.date.toLocaleDateString(undefined, { weekday: 'short' })));
      wrap.appendChild(col);
    });
    return wrap;
  }

  function sessionSpark(cfg) {
    var s = sessionPcts().slice(-9);
    if (s.length < 2) return txt('p', 'because', 'Finish a couple of sessions and your accuracy trend appears here.');

    var wrap = el('div', 'spark');
    var capTop = el('div', 'sparkcap');
    add(capTop, txt('span', null, 'First: ' + s[0] + '%'));
    add(capTop, txt('span', 'now', 'Latest: ' + s[s.length - 1] + '%'));
    add(wrap, capTop);

    var W = 300, H = 100, top = 8, bot = 92;
    var step = W / (s.length - 1);
    var pts = s.map(function (v, i) {
      return [+(i * step).toFixed(1), +(bot - (v / 100) * (bot - top)).toFixed(1)];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ');
    var half = (bot - 0.5 * (bot - top)).toFixed(1);
    var last = pts[pts.length - 1];
    add(wrap, el('div', null,
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' +
      'Share of answers correct across your last ' + s.length + ' sessions, from ' + s[0] +
      ' percent to ' + s[s.length - 1] + ' percent">' +
      '<line x1="0" y1="' + half + '" x2="' + W + '" y2="' + half + '" stroke="var(--edge)" ' +
      'stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"></line>' +
      '<path d="' + d + '" fill="none" stroke="var(--data)" stroke-width="2.5" stroke-linejoin="round" ' +
      'stroke-linecap="round" vector-effect="non-scaling-stroke"></path>' +
      '<line x1="' + last[0] + '" y1="' + last[1] + '" x2="' + last[0] + '" y2="' + bot + '" ' +
      'stroke="var(--data)" stroke-width="2" vector-effect="non-scaling-stroke"></line>' +
      '</svg>'));

    add(wrap, txt('div', 'sparkfoot', 'The dotted line is half right. Oldest session on the left.'));
    return wrap;
  }

  /* The calendar grid: one square per day, twelve weeks back. Shading is a
     single-hue ramp, so "more" always reads as "darker" without a key lookup. */
  function dayGrid(cfg) {
    var P = load(cfg);
    var wrap = el('div');
    var row = el('div', 'daygrid');
    var dow = el('div', 'dgdow');
    ['M', '', 'W', '', 'F', '', ''].forEach(function (d) { add(dow, txt('span', null, d)); });
    add(row, dow);

    var t = today();
    var back = ((t.getDay() + 6) % 7) + 77;   // start on a Monday, twelve weeks out
    var start = shiftDays(t, -back);
    var tk = todayKey();
    var levels = [0, 1, 12, 25, 45];
    for (var w = 0; w < 12; w++) {
      var col = el('div', 'dgcol');
      for (var i = 0; i < 7; i++) {
        var d = shiftDays(start, w * 7 + i);
        var n = P.days[dayKey(d)] || 0;
        var lvl = 0;
        for (var L = 4; L >= 1; L--) if (n >= levels[L]) { lvl = L; break; }
        var c = el('span', 'dgcell' + (lvl ? ' l' + lvl : '') + (dayKey(d) === tk ? ' today' : ''));
        c.title = prettyDate(d) + ' — ' + (n ? n + ' ' + plural(n, 'card') : 'no study');
        if (d > t) c.style.visibility = 'hidden';
        add(col, c);
      }
      add(row, col);
    }
    add(wrap, row);

    var key = el('div', 'dgkey');
    add(key, txt('span', null, 'Less'));
    ['', 'l1', 'l2', 'l3', 'l4'].forEach(function (c) { add(key, el('span', 'dgcell ' + c)); });
    add(key, txt('span', null, 'More'));
    add(wrap, key);
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Application state and routing                                       *
   * ------------------------------------------------------------------ */

  var state = {
    subject: null,      // null = hub
    page: 'home',
    scopeTopic: null,   // topic id a session was launched from
    scopeLabel: 'Everything due',
    query: '',
    filter: 'all'
  };

  var root = null;   // set by mount()

  function cfg() { return CFG; }

  function go(page, opts) {
    opts = opts || {};
    if (opts.topic !== undefined) {
      state.scopeTopic = opts.topic;
      state.scopeLabel = opts.label || 'Everything due';
    }
    state.page = page;
    render(true);
  }

  function toHub() { window.location.href = '/'; }

  function render(scrollTop) {
    var f = frag();
    add(f, subjectView());
    root.replaceChildren(f);
    if (scrollTop) window.scrollTo({ top: 0 });
  }

  /* ------------------------------------------------------------------ *
   * Subject shell — two genuinely different chromes                     *
   * ------------------------------------------------------------------ */

  function subjectView() {
    var c = cfg();
    var surface = el('div', 'surface');
    surface.setAttribute('data-sub', c.subject);

    var body = pageBody(c);

    if (c.nav === 'top') {
      add(surface, topChrome(c));
      add(surface, body);
    } else {
      var layout = el('div', 'raillayout');
      add(layout, railChrome(c));
      var right = el('div', 'spanishpage');
      add(right, body);
      add(layout, right);
      add(surface, layout);
      add(surface, bottomChrome(c));
    }
    return surface;
  }

  function brand(c) {
    return button('brandbtn', '<span class="dot"></span>' + esc(c.short), toHub);
  }

  /* Sign-in lives in the chrome of both layouts. The engine renders the state
     and the buttons; the host owns the Google flow, because the host is what
     talks to the server. */
  function authArea(c) {
    var wrap = el('div', 'authbox');
    var A = c.auth || {};
    var user = A.user && A.user();
    if (user) {
      var who = el('div', 'whoami');
      if (user.picture) {
        var img = document.createElement('img');
        img.src = user.picture;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        add(who, img);
      }
      add(who, txt('span', 'wn', user.name || user.email || 'Signed in'));
      add(wrap, who);
      add(wrap, button('linkbtn', 'Sign out', function () { A.signOut && A.signOut(); }));
      return wrap;
    }
    if (!A.configured || !A.configured()) {
      add(wrap, txt('span', 'authnote', 'Saving on this device only'));
      return wrap;
    }
    var slot = el('div', 'gbtn');
    add(wrap, slot);
    // Google renders its own button into the slot once its script has loaded.
    if (A.mountButton) setTimeout(function () { A.mountButton(slot); }, 0);
    return wrap;
  }

  function topChrome(c) {
    var bar = el('div', 'topbar');
    var inner = el('div', 'tb-in');
    add(inner, brand(c));
    var tabs = el('div', 'tabs');
    PAGES.forEach(function (p) {
      var b = button(null, esc(p.label), function () { go(p.id); });
      if (state.page === p.id) b.setAttribute('aria-current', 'true');
      add(tabs, b);
    });
    add(inner, tabs);
    add(inner, authArea(c));
    add(bar, inner);
    return bar;
  }

  function railChrome(c) {
    var rail = el('nav', 'rail');
    rail.setAttribute('aria-label', 'Sections');
    add(rail, brand(c));
    PAGES.forEach(function (p) {
      var b = button('nav', '<span class="ic">' + p.icon + '</span>' + esc(p.label), function () { go(p.id); });
      if (state.page === p.id) b.setAttribute('aria-current', 'true');
      add(rail, b);
    });
    add(rail, authArea(c));
    var foot = el('div', 'railfoot');
    var g = goalToday(c);
    add(foot, txt('div', null, g.done + ' of ' + g.goal + ' cards today'));
    add(foot, txt('div', null, streak(c) + '-day streak'));
    add(rail, foot);
    return rail;
  }

  function bottomChrome(c) {
    var bar = el('nav', 'bottombar');
    bar.setAttribute('aria-label', 'Sections');
    PAGES.forEach(function (p) {
      var b = button(null, '<span class="ic">' + p.icon + '</span>' + esc(p.label), function () { go(p.id); });
      if (state.page === p.id) b.setAttribute('aria-current', 'true');
      add(bar, b);
    });
    return bar;
  }

  function pageBody(c) {
    var shell = el('div', c.shell === 'wide' ? 'wide' : 'narrow');
    var view;
    switch (state.page) {
      case 'search':   view = searchView(c); break;
      case 'cards':    view = cardsView(c); break;
      case 'drill':    view = drillView(c); break;
      case 'blast':    view = blastView(c); break;
      case 'match':    view = matchView(c); break;
      case 'learn':    view = learnView(c); break;
      case 'test':     view = testView(c); break;
      case 'progress': view = progressView(c); break;
      default:         view = homeView(c);
    }
    add(shell, view);
    return shell;
  }

  /* ------------------------------------------------------------------ *
   * Home console                                                        *
   * ------------------------------------------------------------------ */

  function homeView(c) {
    return c.nav === 'top' ? homeWide(c) : homeNarrow(c);
  }

  function studyLine(c) {
    var days = last7(c);
    var total = days.reduce(function (a, b) { return a + b.n; }, 0);
    var active = days.filter(function (d) { return d.n > 0; }).length;
    var best = days.slice().sort(function (a, b) { return b.n - a.n; })[0];
    return {
      total: total, active: active,
      say: total === 0 ? 'You have not studied this week yet.' :
        'You have answered ' + total + ' ' + plural(total, 'card') + ' in the last seven days.',
      because: total === 0 ? 'Answer a handful today and the bars below start filling in.' :
        'Across ' + active + ' of the last 7 days' +
        (best && best.n > 0 ? ', with your biggest day being ' +
          (best.isToday ? 'today' : best.date.toLocaleDateString(undefined, { weekday: 'long' })) +
          ' at ' + best.n + '.' : '.')
    };
  }

  function startButton(c, label) {
    return button('btn', esc(label), function () {
      go('drill', { topic: null, label: 'Everything due' });
    });
  }

  function homeWide(c) {
    var f = frag();
    var known = knownCount(c), total = c.data.items.length, due = dueItems(c).length;
    var lt = lifetime(c);

    add(f, pageHead(today().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) +
      ' · day ' + streak(c) + ' in a row', c.name));

    add(f, lead(
      'You know <b>' + known.toLocaleString() + ' of your ' + total.toLocaleString() + ' cards</b>, and <b>' + due +
      ' ' + plural(due, 'card is', 'cards are') + ' ready to review today</b>.',
      (function () {
        var mins = Math.max(1, Math.round(due * 0.45));
        return 'A card counts as known once you have answered it right ' + MASTER_BOX +
          ' sittings in a row. ' + (due
            ? 'About ' + mins + ' ' + plural(mins, 'minute') + ' clears today’s queue.'
            : 'Nothing is due, so anything you do now is getting ahead.');
      })()));

    var row = el('div', 'row3');
    add(row, cell('Answers you get right', lt.pct + '%', null,
      'out of ' + lt.seen.toLocaleString() + ' answers since you started'));
    add(row, cell('Waiting longer than a day', String(overdueCount(c)), 'cards', 'these get shown to you first'));
    add(row, cell('Cards you have not met', String(unseenCount(c)), 'cards', 'all still to come', 'up'));
    add(f, row);

    var g2 = el('div', 'grid2');
    var sl = studyLine(c);
    add(g2, panel(says(sl.say, sl.because), activityBars(c)));
    var s = sessionPcts();
    add(g2, panel(
      says(s.length > 1 && s[s.length - 1] > s[0] ? 'You are getting steadily better.' : 'How your sessions are going.',
        s.length > 1 ? 'Share of answers correct in each of your last ' + Math.min(9, s.length) +
          ' sittings, oldest on the left.' : 'Finish a session to start the trend.'),
      sessionSpark(c)));
    add(f, g2);

    add(f, panel(
      says('You have studied on ' + Object.keys(load(c).days).length + ' days in the last twelve weeks.',
        'One square per day. The darker it is, the more cards you got through. Today is outlined.'),
      dayGrid(c)));

    var cats = Object.keys(c.cats);
    var weakestCat = cats.map(function (k) { return { k: k, s: catStats(c, k) }; })
      .sort(function (a, b) { return a.s.pct - b.s.pct; })[0];
    add(f, panel(
      says(c.cats[weakestCat.k] + ' are your thinnest ground — ' + weakestCat.s.pct + '% known.',
        'Same measure across every kind of card, so the bar lengths are directly comparable.'),
      table(
        [{ label: 'Type of card' }, { label: 'How many' }, { label: 'Share you know', width: '40%' }, { label: '' }],
        cats.map(function (k) {
          var s = catStats(c, k);
          var tr = el('tr');
          add(tr, txt('td', null, c.cats[k]));
          add(tr, txt('td', 'num', String(s.total)));
          add(tr, meterCell(s.pct));
          add(tr, txt('td', 'num', s.pct + '%'));
          return tr;
        })
      )));

    var weak = weakTopics(c, 5);
    add(f, panel(
      says((function () {
        var flagged = weak.filter(function (w) { return w.s.pct < 20 && w.s.seen > 0; }).length;
        if (!flagged) return 'Nothing is badly behind.';
        return flagged + ' ' + plural(flagged, 'topic is', 'topics are') + ' dragging your average down.';
      })(),
        'Sorted weakest first. Anything under 20% known is pulled into your next session automatically.'),
      table(
        [{ label: 'Topic' }, { label: 'Times answered' }, { label: 'Share you know', width: '30%' }, { label: '' }],
        weak.map(function (w) {
          var tr = el('tr');
          var cellName = el('td');
          add(cellName, txt('div', null, w.topic.name));
          add(cellName, txt('div', 'tsrc', sourceLine(c, w.topic.id)));
          add(tr, cellName);
          add(tr, txt('td', 'num', String(w.s.seen)));
          add(tr, meterCell(w.s.pct));
          var last = el('td');
          if (w.s.seen === 0) add(last, txt('span', 'chip new', 'Not started'));
          else if (w.s.pct < 20) add(last, txt('span', 'chip', 'Next session'));
          else add(last, txt('span', 'num', w.s.pct + '%'));
          add(tr, last);
          return tr;
        })
      ),
      (function () {
        var r = el('div', 'btnrow');
        add(r, startButton(c, 'Study these now · ' + due + ' cards'));
        add(r, button('btn ghost', 'Pick a topic instead', function () { go('search'); }));
        return r;
      })()
    ));
    return f;
  }

  /* Spanish's console is a single narrow column that reads top to bottom like a
     daily brief, rather than AP HG's two-column instrument panel. */
  function homeNarrow(c) {
    var f = frag();
    var known = knownCount(c), total = c.data.items.length, due = dueItems(c).length;
    var g = goalToday(c);
    var lt = lifetime(c);

    add(f, pageHead('Hoy · ' + today().toLocaleDateString(undefined, { day: 'numeric', month: 'long' }),
      'Buenos días'));

    add(f, lead(
      g.done >= g.goal
        ? 'Daily goal done — <b>' + g.done + ' cards</b> so far today.'
        : '<b>' + due + ' ' + plural(due, 'card is', 'cards are') + '</b> ready for you, and you are <b>' +
          Math.max(0, g.goal - g.done) + ' short</b> of today’s goal.',
      'You know ' + known.toLocaleString() + ' of ' + total.toLocaleString() + ' cards. Streak: ' + streak(c) + ' ' +
      plural(streak(c), 'day') + '. Lifetime accuracy ' + lt.pct + '%.'));

    var quick = panel();
    add(quick, says('Start where it helps most.', 'Each of these draws from the cards the schedule says are ripest.'));
    var r = el('div', 'btnrow');
    add(r, startButton(c, 'Review ' + due + ' due'));
    add(r, button('btn ghost', 'Flashcards', function () { go('cards'); }));
    add(r, button('btn ghost', 'Blast', function () { go('blast'); }));
    add(quick, r);
    add(f, quick);

    var sl = studyLine(c);
    add(f, panel(says(sl.say, sl.because), activityBars(c)));

    add(f, panel(
      says('Your study calendar.',
        'One square per day over twelve weeks. Darker means more cards. Today is outlined.'),
      dayGrid(c)));

    var cats = Object.keys(c.cats);
    add(f, panel(
      says('Where your Spanish stands.', 'Grammar, verbs and vocabulary scored the same way.'),
      table(
        [{ label: 'Kind' }, { label: 'Cards' }, { label: 'Share you know', width: '40%' }, { label: '' }],
        cats.map(function (k) {
          var s = catStats(c, k);
          var tr = el('tr');
          add(tr, txt('td', null, c.cats[k]));
          add(tr, txt('td', 'num', String(s.total)));
          add(tr, meterCell(s.pct));
          add(tr, txt('td', 'num', s.pct + '%'));
          return tr;
        })
      )));

    var work = topicsToWorkOn(c, 6);
    var wp = panel(says('Topics to work on next.',
      'Ranked by how many cards you have left to learn, biggest job first — not by score, ' +
      'which makes a small topic look more urgent than it is. Tap one to start a session on it.'));
    var list = el('div', 'topiclist');
    work.forEach(function (w) {
      add(list, topicRow(c, w.topic, { stats: w.s, extra: w.left + ' to go', source: true }));
    });
    add(wp, list);
    add(f, wp);

    add(f, panel(
      says('Your sessions so far.', 'Share of answers correct, oldest on the left.'),
      sessionSpark(c)));
    return f;
  }

  function topicRow(c, topic, opts) {
    opts = opts || {};
    var s = opts.stats || topicStats(c, topic.id);
    var row = button('topicrow', null, function () {
      go('drill', { topic: topic.id, label: topic.name });
    });
    add(row, txt('span', 'ti', c.data.icons[topic.id] || '●'));
    var mid = el('div');
    add(mid, txt('div', 'tn', topic.name));
    if (opts.source) add(mid, txt('div', 'tsrc', sourceLine(c, topic.id)));
    add(mid, txt('div', 'tb', topic.blurb || ''));
    add(row, mid);
    var right = el('div', 'tright');
    add(right, txt('span', 'tcount', opts.extra || (s.known + '/' + s.total)));
    var m = el('span', 'meter');
    var i = el('i'); i.style.width = s.pct + '%';
    add(m, i); add(right, m);
    add(row, right);
    return row;
  }

  /* ------------------------------------------------------------------ *
   * Find (search + browse)                                              *
   * ------------------------------------------------------------------ */

  function searchView(c) {
    var f = frag();
    add(f, pageHead('Search every card, or browse by ' + c.unitWord.toLowerCase(), 'Find something to study'));

    var results = el('div');

    var box = el('div', 'searchbox');
    add(box, txt('span', 'mag', '⌕'));
    var input = document.createElement('input');
    input.type = 'search';
    input.id = 'find-input';
    input.placeholder = c.subject === 'spanish'
      ? 'Try “car gar zar”, “preterite”, “fruit”, “ser”…'
      : 'Try “density”, “migration”, “Malthus”, “pyramid”…';
    input.value = state.query;
    input.setAttribute('aria-label', 'Search cards and topics');
    add(box, input);
    add(f, box);

    var filters = el('div', 'filters');
    var opts = [{ k: 'all', l: 'Everything' }]
      .concat(Object.keys(c.cats).map(function (k) { return { k: k, l: c.cats[k] }; }))
      .concat([{ k: 'starred', l: '★ Starred' }, { k: 'weak', l: 'Needs work' }]);
    opts.forEach(function (o) {
      var b = button('fbtn', esc(o.l), function () {
        state.filter = o.k;
        filters.querySelectorAll('.fbtn').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        paint();
      });
      b.setAttribute('aria-pressed', String(state.filter === o.k));
      add(filters, b);
    });
    add(f, filters);
    add(f, results);

    function matchingTopics() {
      var q = searchNorm(state.query);
      return c.data.topics.filter(function (t) {
        if (state.filter !== 'all' && state.filter !== 'starred' && state.filter !== 'weak' && t.cat !== state.filter) return false;
        if (state.filter === 'weak' && topicStats(c, t.id).pct >= 40) return false;
        if (state.filter === 'starred') return false;
        if (!q) return true;
        return searchNorm(t.name + ' ' + (t.blurb || '') + ' ' + t.id).indexOf(q) !== -1;
      });
    }

    function matchingItems() {
      var q = searchNorm(state.query);
      var P = load(c);
      return c.data.items.filter(function (it) {
        var topic = topicOf(c, it.topic);
        if (state.filter === 'starred') { if (!isStarred(it.id)) return false; }
        else if (state.filter === 'weak') { if (topicStats(c, it.topic).pct >= 40) return false; }
        else if (state.filter !== 'all' && topic.cat !== state.filter) return false;
        if (!q) return false;
        return searchNorm(stripTags(it.prompt) + ' ' + it.answer.join(' ')).indexOf(q) !== -1;
      });
    }

    function paint() {
      var kids = frag();
      var topics = matchingTopics();
      var hits = matchingItems();

      if (state.filter === 'starred') {
        var starred = c.data.items.filter(function (it) { return isStarred(it.id); });
        if (state.query) starred = hits;
        if (!starred.length) {
          add(kids, emptyState('Nothing starred yet',
            'Tap the star on any card or search result to keep it here. Starred cards can be drilled on their own.'));
        } else {
          add(kids, txt('div', 'resbar', starred.length + ' starred ' + plural(starred.length, 'card')));
          add(kids, studyStarredButton(c, starred));
          add(kids, hitList(c, starred.slice(0, 80)));
        }
        results.replaceChildren(kids);
        return;
      }

      if (!state.query) {
        add(kids, txt('div', 'resbar',
          topics.length + ' ' + plural(topics.length, 'topic') + ' · ' +
          c.data.items.length.toLocaleString() + ' cards in total'));
        c.data.units.forEach(function (u) {
          var inUnit = u.topicIds.map(function (id) { return topicOf(c, id); })
            .filter(function (t) { return t && topics.indexOf(t) !== -1; });
          if (!inUnit.length) return;

          var cards = inUnit.reduce(function (n, t) { return n + topicStats(c, t.id).total; }, 0);
          var heading = (u.book ? u.book + ' · ' : '') + (u.title || u.name);
          var p = panel(says(heading,
            inUnit.length + ' ' + plural(inUnit.length, 'topic') + ' · ' +
            cards.toLocaleString() + ' cards' + (u.page ? ' · page ' + u.page : '')));

          // Grouped under the section headings printed on the handout, in the
          // order the handout lists them, so the app mirrors the paper.
          var order = [], bySection = {}, rank = {};
          inUnit.forEach(function (t) {
            var src = sourceOf(c, t.id);
            var sec = src.section || 'Other';
            if (!bySection[sec]) { bySection[sec] = []; order.push(sec); rank[sec] = src.order; }
            rank[sec] = Math.min(rank[sec], src.order == null ? 50 : src.order);
            bySection[sec].push(t);
          });
          order.sort(function (x, y) { return rank[x] - rank[y]; });
          order.forEach(function (sec) {
            var head = el('div', 'secthead');
            add(head, txt('span', 'sn', sec));
            add(head, txt('span', 'sc', bySection[sec].length + ' ' + plural(bySection[sec].length, 'topic')));
            add(p, head);
            var list = el('div', 'topiclist');
            bySection[sec].forEach(function (t) { add(list, topicRow(c, t)); });
            add(p, list);
          });
          add(kids, p);
        });
        results.replaceChildren(kids);
        return;
      }

      if (!topics.length && !hits.length) {
        add(kids, emptyState('Nothing matched “' + stripTags(state.query) + '”',
          'Try a shorter word, or clear the filter above.'));
        results.replaceChildren(kids);
        return;
      }

      add(kids, txt('div', 'resbar',
        topics.length + ' matching ' + plural(topics.length, 'topic') + ' · ' +
        hits.length + ' matching ' + plural(hits.length, 'card') +
        (hits.length > 60 ? ' (showing the first 60)' : '')));

      if (topics.length) {
        var tp = panel(says('Topics', 'Tap one to drill the whole topic.'));
        var tl = el('div', 'topiclist');
        topics.slice(0, 12).forEach(function (t) { add(tl, topicRow(c, t, { source: true })); });
        add(tp, tl);
        add(kids, tp);
      }
      if (hits.length) add(kids, hitList(c, hits.slice(0, 60)));
      results.replaceChildren(kids);
    }

    var debounce = null;
    input.addEventListener('input', function () {
      state.query = input.value;
      clearTimeout(debounce);
      debounce = setTimeout(paint, 110);
    });

    paint();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
    return f;
  }

  function studyStarredButton(c, items) {
    var r = el('div', 'btnrow');
    add(r, button('btn', 'Drill these ' + items.length + ' cards', function () {
      go('drill', { topic: '__starred__', label: 'Starred cards' });
    }));
    r.style.marginBottom = '14px';
    return r;
  }

  function hitList(c, items) {
    var wrap = el('div', 'hitlist');
    items.forEach(function (it) {
      var row = el('div', 'hit');
      var left = el('div');
      add(left, el('div', 'hq', it.prompt));
      add(left, txt('div', 'ha', it.answer[0]));
      add(left, txt('div', 'hmeta', sourceLine(c, it.topic) + ' · ' +
        topicOf(c, it.topic).name + ' · ' + stageLabel(c, it.id)));
      add(row, left);

      var right = el('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '4px';
      var sp = speakButton(c, it.answer[0]);
      if (sp) add(right, sp);
      var starred = isStarred(it.id);
      var st = button('star', '★', function () {
        var now = toggleStar(c, it.id);
        st.setAttribute('aria-pressed', String(now));
      });
      st.setAttribute('aria-pressed', String(starred));
      st.setAttribute('aria-label', 'Star this card');
      add(right, st);
      add(row, right);
      add(wrap, row);
    });
    return wrap;
  }

  function stageLabel(c, id) {
    var p = itemProg(c, id);
    if (!p) return 'not met yet';
    var step = Math.min(Math.max(p.box, 1), 5);
    return 'step ' + step + ' of 5 · ' + STAGE_WORDS[step - 1];
  }

  /* Where a card came from on paper. Every screen that shows a card shows this
     too, so material stays attached to the handout section it was taught in
     rather than floating in a flat list of 1,322 cards. */
  function sourceOf(c, topicId) {
    var t = topicOf(c, topicId);
    return t.source || { unit: '', section: t.cat || '', page: null };
  }
  function sourceLine(c, topicId) {
    var src = sourceOf(c, topicId);
    if (!src.unit) return src.section || '';
    return src.unit + ' › ' + src.section;
  }

  function topicOf(c, id) {
    for (var i = 0; i < c.data.topics.length; i++) if (c.data.topics[i].id === id) return c.data.topics[i];
    return { id: id, name: id, cat: '', blurb: '' };
  }

  function emptyState(title, body) {
    var e = el('div', 'empty');
    add(e, txt('b', null, title));
    add(e, txt('div', null, body));
    return e;
  }

  /* ------------------------------------------------------------------ *
   * Queue building                                                      *
   * ------------------------------------------------------------------ */

  function queueFor(c, n) {
    var pool;
    if (state.scopeTopic === '__starred__') {
      var P = load(c);
      pool = c.data.items.filter(function (it) { return isStarred(it.id); });
    } else if (state.scopeTopic) {
      pool = c.data.items.filter(function (it) { return it.topic === state.scopeTopic; });
    } else {
      pool = dueItems(c);
      if (pool.length < 8) {
        pool = pool.concat(shuffle(c.data.items.filter(function (it) { return isUnseen(c, it.id); })).slice(0, 20));
      }
    }
    if (!pool.length) pool = c.data.items;
    return shuffle(pool).slice(0, n || 20);
  }

  function scopeBar(c, onChange) {
    var p = el('div', 'setrow');
    var left = el('div');
    add(left, txt('div', 'sl', 'Studying: ' + state.scopeLabel));
    add(left, txt('div', 'sd', state.scopeTopic
      ? 'Only cards from this selection.'
      : 'Whatever the schedule says is ripest, plus new cards if the queue is short.'));
    add(p, left);
    add(p, button('btn ghost', 'Change', function () { go('search'); }));
    return p;
  }

  /* ------------------------------------------------------------------ *
   * Flashcards                                                          *
   * ------------------------------------------------------------------ */

  function cardsView(c) {
    var f = frag();
    add(f, pageHead(state.scopeLabel, 'Flashcards'));

    var queue = queueFor(c, 16);
    var idx = 0, flipped = false, done = 0, right = 0;

    var bar = el('div', 'prog');
    var barI = el('i'); barI.style.width = '0%';
    add(bar, barI);
    add(f, bar);

    var wrap = el('div', 'cardwrap');
    var flip = el('div', 'cflip');
    var cc = el('div', 'cc');
    var cci = el('div', 'cci');
    var front = el('div', 'cf');
    var back = el('div', 'cf back');
    add(cci, front, back);
    add(cc, cci);
    add(flip, cc);
    add(wrap, flip);

    var rate = el('div', 'rate');
    var noBtn = button(null, 'Not yet', function () { answer(false); });
    var yesBtn = button('yes', 'Got it', function () { answer(true); });
    add(rate, noBtn, yesBtn);
    add(wrap, rate);
    add(wrap, txt('div', 'hint', 'Tap the card to flip it. Rating it decides when it comes back — ' +
      'be honest, guessing right by luck teaches you nothing.'));
    add(f, wrap);

    cc.addEventListener('click', function () {
      flipped = !flipped;
      cc.classList.toggle('flipped', flipped);
    });

    function paint() {
      if (idx >= queue.length) return finish();
      var it = queue[idx];
      var stage = stageLabel(c, it.id);
      flipped = false;
      cc.classList.remove('flipped');

      front.replaceChildren();
      back.replaceChildren();

      var fh = el('div', 'cfh');
      add(fh, txt('span', null, 'Card ' + (idx + 1) + ' of ' + queue.length));
      add(fh, txt('span', null, sourceOf(c, it.topic).section));
      add(front, fh);
      var fb = el('div', 'cfb');
      add(fb, el('div', 'cterm', it.prompt));
      var sp = speakButton(c, stripTags(it.prompt));
      if (sp) { var holder = el('div'); add(holder, sp); add(fb, holder); }
      add(front, fb);

      var bh = el('div', 'cfh');
      add(bh, txt('span', null, topicOf(c, it.topic).name));
      add(bh, txt('span', null, stage));
      add(back, bh);
      var bb = el('div', 'cfb');
      add(bb, txt('div', 'cdef', it.answer.join('  ·  ')));
      if (it.note) add(bb, txt('div', 'cnote', it.note));
      var sp2 = speakButton(c, it.answer[0]);
      if (sp2) { var h2 = el('div'); add(h2, sp2); add(bb, h2); }
      add(back, bb);

      addSourceFoot(front, c, it);
      addSourceFoot(back, c, it);

      barI.style.width = Math.round(100 * idx / queue.length) + '%';
    }

    function answer(ok) {
      if (idx >= queue.length) return;
      record(c, queue[idx], ok);
      done++; if (ok) right++;
      idx++;
      paint();
    }

    function finish() {
      var P = load(c);
      logSession(c, right, Math.max(done, 1), 'Flashcards');
      var res = panel(
        says('Set finished — ' + right + ' of ' + done + ' you knew.',
          'Every card you marked "not yet" comes back today. The rest move a step further out.'));
      var r = el('div', 'btnrow');
      add(r, button('btn', 'Another set', function () { go('cards'); }));
      add(r, button('btn ghost', 'Back to console', function () { go('home'); }));
      add(res, r);
      wrap.replaceChildren(res);
      bar.remove();
    }

    paint();
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Drill                                                               *
   * ------------------------------------------------------------------ */

  function drillView(c) {
    var f = frag();
    add(f, pageHead(state.scopeLabel, 'Drill'));

    var queue = queueFor(c, 12);
    var idx = 0, right = 0;

    var grid = el('div', c.nav === 'top' ? 'qgrid' : '');
    var main = panel();
    var side = panel();
    add(grid, main);
    add(grid, side);
    add(f, grid);

    function paint() {
      if (idx >= queue.length) return finish();
      var it = queue[idx];
      var opts = optionsFor(c, it, 4);
      var answered = false;

      main.replaceChildren();
      add(main, txt('div', 'eyebrow', 'Question ' + (idx + 1) + ' of ' + queue.length + ' · ' +
        topicOf(c, it.topic).name));
      add(main, el('h2', 'qask', it.prompt));

      var verdictHost = el('div');

      if (opts) {
        var wrapOpts = el('div', 'opts');
        opts.forEach(function (o, i) {
          var b = button('opt', null, function () { choose(o, b); });
          add(b, txt('span', 'ok m', 'ABCD'[i]));
          add(b, txt('span', null, o));
          add(wrapOpts, b);
        });
        add(main, wrapOpts);
        function choose(value, node) {
          if (answered) return;
          answered = true;
          var ok = it.answer.indexOf(value) !== -1;
          wrapOpts.querySelectorAll('.opt').forEach(function (x) {
            x.disabled = true;
            var label = x.lastChild.textContent;
            if (it.answer.indexOf(label) !== -1) x.classList.add('correct');
            else if (x === node) x.classList.add('wrong');
          });
          settle(ok);
        }
      } else {
        var row = el('div', 'typedrow');
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'drill-typed';
        inp.autocomplete = 'off';
        inp.placeholder = 'Type your answer';
        inp.setAttribute('aria-label', 'Your answer');
        var go2 = button('btn', 'Check', function () { submit(); });
        add(row, inp, go2);
        add(main, row);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
        function submit() {
          if (answered) return;
          if (!inp.value.trim()) return;
          answered = true;
          inp.disabled = true; go2.disabled = true;
          settle(isCorrectTyped(it, inp.value));
        }
      }

      add(main, verdictHost);

      function settle(ok) {
        if (ok) right++;
        var moved = record(c, it, ok);
        var v = el('div', 'verdict' + (ok ? '' : ' no'));
        add(v, txt('div', 'vh', ok ? 'Right.' : 'Not quite — ' + it.answer[0] + '.'));
        add(v, el('div', null, it.note
          ? esc(it.note)
          : (ok ? 'Moved a step further out in the schedule.'
                : 'Accepted answer' + (it.answer.length > 1 ? 's' : '') + ': <b>' +
                  it.answer.map(esc).join('</b>, <b>') + '</b>.')));
        verdictHost.replaceChildren(v);
        var r = el('div', 'btnrow');
        add(r, button('btn', idx + 1 >= queue.length ? 'See results' : 'Next question', function () {
          idx++; paint();
        }));
        verdictHost.appendChild(r);
        paintSide(it, moved);
      }

      paintSide(it, null);
    }

    function paintSide(it, moved) {
      side.replaceChildren();
      var p = itemProg(c, it.id);
      add(side, says('This card',
        p ? 'Seen ' + p.seen + ' ' + plural(p.seen, 'time') + ', right ' + (p.correct || 0) + '.'
          : 'You have not met this one before.'));
      var t0 = el('div', 'tline');
      add(t0, txt('span', null, 'From'), txt('span', 'tv', sourceOf(c, it.topic).section));
      add(side, t0);
      var t1 = el('div', 'tline');
      add(t1, txt('span', null, 'Topic'), txt('span', 'tv', topicOf(c, it.topic).name));
      add(side, t1);
      var t2 = el('div', 'tline');
      add(t2, txt('span', null, 'Your accuracy here'),
        txt('span', 'tv', p && p.seen ? pct(p.correct || 0, p.seen) + '%' : '—'));
      add(side, t2);

      var box = p ? Math.min(Math.max(p.box, 1), 5) : 0;
      var trk = el('div', 'track');
      var cap = el('div', 'tcap');
      add(cap, txt('span', null, 'New'),
        txt('span', null, 'Step ' + Math.max(box, 1) + ' of 5'),
        txt('span', null, 'Known'));
      add(trk, cap);
      var line = el('div', 'trackline');
      for (var i = 1; i <= 5; i++) {
        add(line, el('span', 'tseg' + (i < box ? ' filled' : (i === box ? ' here' : ''))));
      }
      add(trk, line);
      add(trk, el('div', 'schedmsg', moved
        ? (moved.to > moved.from
            ? 'Up to <b>step ' + moved.to + '</b>. You will not see this card for <b>' +
              INTERVALS[moved.to] + ' days</b> — ' + prettyDate(new Date(moved.due + 'T00:00:00')) + '.'
            : 'Back to <b>step 1</b>. It comes round again <b>today</b>, then tomorrow.')
        : 'Each step you clear, the card waits longer before coming back — a day, three days, a week, two weeks, then a month.'));
      add(side, trk);
    }

    function finish() {
      var P = load(c);
      logSession(c, right, queue.length, 'Drill');
      grid.replaceChildren();
      var res = panel(says(right + ' of ' + queue.length + ' right — ' + pct(right, queue.length) + '%.',
        'Anything you missed is back at step 1 and will come round again today.'));
      var r = el('div', 'btnrow');
      add(r, button('btn', 'Another round', function () { go('drill'); }));
      add(r, button('btn ghost', 'Back to console', function () { go('home'); }));
      add(res, r);
      grid.className = '';
      add(grid, res);
    }

    paint();
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Blast — one question, four big boxes, a clock                       *
   * ------------------------------------------------------------------ */

  function blastView(c) {
    var f = frag();
    add(f, pageHead('Ten questions, twelve seconds each', 'Blast'));

    var pool = c.data.items.filter(function (it) { return canMultipleChoice(c, it); });
    if (state.scopeTopic && state.scopeTopic !== '__starred__') {
      var scoped = pool.filter(function (it) { return it.topic === state.scopeTopic; });
      if (scoped.length >= 10) pool = scoped;
    }
    var queue = shuffle(pool).slice(0, 10);

    var idx = 0, score = 0, combo = 0, bestCombo = 0, correctCount = 0;
    var timer = null, left = 12, answered = false;

    var shell = el('div', 'blast');

    var head = el('div', 'blasthead');
    var sc = el('div', 'bstat');
    var scB = txt('b', null, '0'); add(sc, scB, txt('span', null, 'points'));
    var qn = el('div', 'bstat');
    var qnB = txt('b', null, '1/10'); add(qn, qnB, txt('span', null, 'question'));
    var tw = el('div', 'btimer');
    var ti = el('i');
    add(tw, ti);
    add(head, sc, qn, tw);
    add(shell, head);

    var comboLine = txt('div', 'bcombo', '');
    add(shell, comboLine);

    var qbox = el('div', 'bquestion');
    add(shell, qbox);

    var grid = el('div', 'bgrid');
    add(shell, grid);
    add(f, shell);

    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

    function paint() {
      if (idx >= queue.length) return finish();
      answered = false;
      left = 12;
      var it = queue[idx];
      var opts = optionsFor(c, it, 4);

      qnB.textContent = (idx + 1) + '/' + queue.length;
      qbox.replaceChildren(el('div', 'bq', it.prompt));

      grid.replaceChildren();
      opts.forEach(function (o, i) {
        var b = button('bbox ' + BOX_COLORS[i], null, function () { pick(o, b); });
        b.textContent = o;
        add(grid, b);
      });

      ti.className = '';
      ti.style.width = '100%';
      stopTimer();
      timer = setInterval(function () {
        left -= 0.1;
        if (left <= 0) { left = 0; timeUp(); }
        ti.style.width = Math.max(0, (left / 12) * 100) + '%';
        ti.className = left < 3 ? 'danger' : (left < 6 ? 'warn' : '');
      }, 100);
    }

    function lockBoxes(chosen, it) {
      grid.querySelectorAll('.bbox').forEach(function (x) {
        x.disabled = true;
        if (it.answer.indexOf(x.textContent) !== -1) x.classList.add('reveal');
      });
    }

    function pick(value, node) {
      if (answered) return;
      answered = true;
      stopTimer();
      var it = queue[idx];
      var ok = it.answer.indexOf(value) !== -1;
      lockBoxes(node, it);
      if (ok) {
        correctCount++;
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        // Speed is worth points, but never more than the answer itself — the
        // reward has to track knowing it, not rushing.
        var gained = 100 + Math.round(left * 8) + (combo > 1 ? (combo - 1) * 25 : 0);
        score += gained;
        scB.textContent = String(score);
        comboLine.textContent = combo > 1 ? combo + ' in a row · +' + gained + ' points' : '+' + gained + ' points';
      } else {
        combo = 0;
        comboLine.textContent = 'Streak lost — the answer was "' + it.answer[0] + '"';
      }
      record(c, it, ok);
      setTimeout(function () { idx++; paint(); }, ok ? 750 : 1500);
    }

    function timeUp() {
      if (answered) return;
      answered = true;
      stopTimer();
      var it = queue[idx];
      combo = 0;
      comboLine.textContent = 'Out of time — the answer was "' + it.answer[0] + '"';
      lockBoxes(null, it);
      record(c, it, false);
      setTimeout(function () { idx++; paint(); }, 1500);
    }

    function finish() {
      stopTimer();
      var P = load(c);
      var best = P.best.blast || 0;
      var isBest = score > best;
      if (isBest) P.best.blast = score;
      logSession(c, correctCount, queue.length, 'Blast');

      var over = el('div', 'bover');
      add(over, txt('div', 'score m', String(score)));
      add(over, txt('div', 'sl', 'points · ' + correctCount + ' of ' + queue.length +
        ' right · best run of ' + bestCombo));
      add(over, txt('p', 'say', isBest ? 'New personal best.' : 'Your best is ' + best + '.'));
      add(over, txt('p', 'because',
        'Every answer here still counts towards your schedule — the cards you missed come back today.'));
      var r = el('div', 'btnrow');
      r.style.justifyContent = 'center';
      add(r, button('btn', 'Play again', function () { go('blast'); }));
      add(r, button('btn ghost', 'Back to console', function () { go('home'); }));
      add(over, r);
      shell.replaceChildren(over);
    }

    paint();
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Match — six pairs against the clock                                 *
   * ------------------------------------------------------------------ */

  function matchView(c) {
    var f = frag();
    add(f, pageHead('Six pairs, as fast as you can', 'Match'));

    var pairTypes = { 'term2def': 1, 'vocab-es2en': 1, 'def2term': 1, 'vocab-en2es': 1 };
    var pool = c.data.items.filter(function (it) {
      return pairTypes[it.type] && stripTags(it.prompt).length < 46 && it.answer[0].length < 46;
    });
    if (state.scopeTopic && state.scopeTopic !== '__starred__') {
      var scoped = pool.filter(function (it) { return it.topic === state.scopeTopic; });
      if (scoped.length >= 6) pool = scoped;
    }

    if (pool.length < 6) {
      add(f, panel(says('Not enough short pairs here to build a board.',
        'Match needs six term-and-meaning pairs that fit on a tile. Pick a vocabulary topic and try again.'),
        button('btn', 'Choose a topic', function () { go('search'); })));
      return f;
    }

    var chosen = shuffle(pool).slice(0, 6);
    var tiles = [];
    chosen.forEach(function (it, i) {
      tiles.push({ pair: i, text: stripTags(it.prompt), item: it });
      tiles.push({ pair: i, text: it.answer[0], item: it });
    });
    tiles = shuffle(tiles);

    var started = null, elapsed = 0, solved = 0, misses = 0, tick = null;
    var sel = null;

    var head = el('div', 'blasthead');
    var tstat = el('div', 'bstat');
    var tB = txt('b', null, '0.0'); add(tstat, tB, txt('span', null, 'seconds'));
    var pstat = el('div', 'bstat');
    var pB = txt('b', null, '0/6'); add(pstat, pB, txt('span', null, 'pairs'));
    var mstat = el('div', 'bstat');
    var mB = txt('b', null, '0'); add(mstat, mB, txt('span', null, 'misses'));
    add(head, tstat, pstat, mstat);
    add(f, head);

    var board = el('div', 'matchgrid');
    add(f, board);

    var P = load(c);
    add(f, el('p', 'hint', P.best.match
      ? 'Your best board so far: ' + P.best.match.toFixed(1) + ' seconds.'
      : 'Tap a term, then its meaning. The clock starts on your first tap.'));

    function startClock() {
      if (started) return;
      started = Date.now();
      tick = setInterval(function () {
        elapsed = (Date.now() - started) / 1000;
        tB.textContent = elapsed.toFixed(1);
      }, 100);
    }

    tiles.forEach(function (t) {
      var b = button('mtile', null, function () { tap(t, b); });
      b.textContent = t.text;
      t.node = b;
      add(board, b);
    });

    function tap(t, node) {
      if (node.disabled || node.classList.contains('gone')) return;
      startClock();
      if (!sel) {
        sel = { t: t, node: node };
        node.classList.add('sel');
        return;
      }
      if (sel.node === node) { node.classList.remove('sel'); sel = null; return; }

      var a = sel;
      sel = null;
      a.node.classList.remove('sel');

      if (a.t.pair === t.pair) {
        a.node.classList.add('hit'); node.classList.add('hit');
        a.node.disabled = true; node.disabled = true;
        solved++;
        pB.textContent = solved + '/6';
        record(c, t.item, true);
        setTimeout(function () {
          a.node.classList.add('gone'); node.classList.add('gone');
        }, 260);
        if (solved === 6) finish();
      } else {
        misses++;
        mB.textContent = String(misses);
        a.node.classList.add('miss'); node.classList.add('miss');
        record(c, t.item, false);
        setTimeout(function () {
          a.node.classList.remove('miss'); node.classList.remove('miss');
        }, 420);
      }
    }

    function finish() {
      clearInterval(tick);
      var total = (Date.now() - started) / 1000 + misses * 1.5;
      var prev = load(c).best.match;
      var best = !prev || total < prev;
      if (best) { load(c).best.match = total; save(c); }
      setTimeout(function () {
        var over = el('div', 'bover');
        add(over, txt('div', 'score m', total.toFixed(1)));
        add(over, txt('div', 'sl', 'seconds, including a 1.5s penalty per miss'));
        add(over, txt('p', 'say', best ? 'New personal best.' :
          'Your best is ' + prev.toFixed(1) + ' seconds.'));
        add(over, txt('p', 'because', misses === 0
          ? 'A clean board — no misses at all.'
          : misses + ' ' + plural(misses, 'miss', 'misses') + '. Those cards go back to step 1.'));
        var r = el('div', 'btnrow');
        r.style.justifyContent = 'center';
        add(r, button('btn', 'New board', function () { go('match'); }));
        add(r, button('btn ghost', 'Back to console', function () { go('home'); }));
        add(over, r);
        board.replaceChildren(over);
        board.className = '';
      }, 420);
    }

    return f;
  }

  /* ------------------------------------------------------------------ *
   * Learn — recognise it, then produce it                               *
   * ------------------------------------------------------------------ */

  function learnView(c) {
    var f = frag();
    add(f, pageHead(state.scopeLabel, 'Learn'));

    var picked = queueFor(c, 8);
    // Each card must be cleared twice: once by recognition (four options), then
    // again by recall (typed). Recognition is the easier route in, recall is
    // what actually predicts remembering it later.
    var ring = picked.map(function (it, i) { return { item: it, stage: 0, slot: i }; });
    var retired = 0, attempts = 0, hits = 0;

    var intro = panel(says('Eight cards, two passes each.',
      'First you pick it out of four. Then you have to produce it from memory. A card only retires once ' +
      'you have done both — recognising something is much easier than recalling it, and only the second ' +
      'one predicts whether you will have it in an exam.'));
    add(f, intro);

    var bar = el('div', 'stagebar');
    for (var i = 0; i < picked.length; i++) add(bar, el('i'));
    add(f, bar);

    var host = panel();
    add(f, host);

    function repaintBar() {
      // Painted by the card's original slot, not its current queue position, so
      // the bar does not reshuffle every time a missed card goes to the back.
      var segs = bar.querySelectorAll('i');
      ring.forEach(function (r) {
        segs[r.slot].className = r.stage >= 2 ? 'done' : (r.stage === 1 ? 'at' : '');
      });
    }

    function next() {
      var live = ring.filter(function (r) { return r.stage < 2; });
      if (!live.length) return finish();
      var r = live[0];
      var it = r.item;
      var wantTyped = r.stage === 1;
      var opts = wantTyped ? null : optionsFor(c, it, 4);
      if (!opts && !wantTyped) { r.stage = 1; return next(); }
      var answered = false;

      host.replaceChildren();
      add(host, txt('div', 'eyebrow', (wantTyped ? 'Recall · type it' : 'Recognise · pick it') +
        ' · ' + retired + ' of ' + ring.length + ' retired'));
      add(host, el('h2', 'qask', wantTyped
        ? it.prompt
        : it.prompt));

      var verdictHost = el('div');

      if (wantTyped) {
        var row = el('div', 'typedrow');
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'learn-typed';
        inp.autocomplete = 'off';
        inp.placeholder = 'Type the answer';
        inp.setAttribute('aria-label', 'Your answer');
        var go2 = button('btn', 'Check', submit);
        add(row, inp, go2);
        add(host, row);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
        function submit() {
          if (answered || !inp.value.trim()) return;
          answered = true;
          inp.disabled = true; go2.disabled = true;
          settle(isCorrectTyped(it, inp.value));
        }
      } else {
        var wrapOpts = el('div', 'opts');
        opts.forEach(function (o, i) {
          var b = button('opt', null, function () {
            if (answered) return;
            answered = true;
            var ok = it.answer.indexOf(o) !== -1;
            wrapOpts.querySelectorAll('.opt').forEach(function (x) {
              x.disabled = true;
              if (it.answer.indexOf(x.lastChild.textContent) !== -1) x.classList.add('correct');
              else if (x === b) x.classList.add('wrong');
            });
            settle(ok);
          });
          add(b, txt('span', 'ok m', 'ABCD'[i]));
          add(b, txt('span', null, o));
          add(wrapOpts, b);
        });
        add(host, wrapOpts);
      }
      add(host, verdictHost);

      function settle(ok) {
        attempts++;
        if (ok) hits++;
        record(c, it, ok);
        if (ok) { r.stage++; if (r.stage >= 2) retired++; }
        else { r.stage = 0; }
        // Wrong answers go to the back of the ring rather than repeating
        // immediately: a gap, however short, is what makes the second attempt
        // a retrieval rather than an echo.
        ring.splice(ring.indexOf(r), 1);
        ring.push(r);
        repaintBar();

        var v = el('div', 'verdict' + (ok ? '' : ' no'));
        add(v, txt('div', 'vh', ok
          ? (r.stage >= 2 ? 'Retired — you produced it from memory.' : 'Right. You will type this one next time round.')
          : 'Not quite — ' + it.answer[0] + '.'));
        add(v, el('div', null, it.note ? esc(it.note)
          : (ok ? 'Comes back later in the set to check it stuck.'
                : 'Back to the start for this card. Accepted: <b>' + it.answer.map(esc).join('</b>, <b>') + '</b>.')));
        verdictHost.replaceChildren(v);
        var rr = el('div', 'btnrow');
        add(rr, button('btn', 'Continue', next));
        verdictHost.appendChild(rr);
      }
    }

    function finish() {
      var P = load(c);
      logSession(c, hits, Math.max(attempts, 1), 'Learn');
      intro.remove();
      bar.remove();
      host.replaceChildren();
      add(host, says('All eight retired.',
        'It took you ' + attempts + ' attempts, ' + pct(hits, attempts) + '% of them right. ' +
        'Each of these now sits at least one step further out in the schedule.'));
      var r = el('div', 'btnrow');
      add(r, button('btn', 'Another eight', function () { go('learn'); }));
      add(r, button('btn ghost', 'Back to console', function () { go('home'); }));
      add(host, r);
    }

    repaintBar();
    next();
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Test — build a mock exam                                            *
   * ------------------------------------------------------------------ */

  function testView(c) {
    var f = frag();
    add(f, pageHead('Build a mock exam from anything you have covered', 'Practice test'));

    var opts = { count: 20, format: 'mixed', scope: 'all', timed: true };
    var host = el('div');
    add(f, host);

    function setup() {
      var p = panel(says('Set it up.',
        'Sitting a test you have not prepared for is the single most reliable way to find out what you ' +
        'actually know — the gaps it exposes are worth more than another read-through.'));
      var s = el('div', 'setup');

      s.appendChild(segRow('How many questions', 'Longer tests give a steadier read on where you stand.',
        [['10', 10], ['20', 20], ['30', 30]], function (v) { opts.count = v; }, opts.count));
      s.appendChild(segRow('Question style', 'Typed answers are harder and closer to a real free-response.',
        [['Mixed', 'mixed'], ['Multiple choice', 'mc'], ['Typed', 'typed']],
        function (v) { opts.format = v; }, opts.format));
      s.appendChild(segRow('Which cards', 'Weak topics only is the efficient choice; everything is the honest one.',
        [['Everything', 'all'], ['Weak topics', 'weak'], ['Starred', 'star']],
        function (v) { opts.scope = v; }, opts.scope));
      s.appendChild(segRow('Clock', 'A clock adds pressure closer to the real thing. It never cuts you off.',
        [['On', true], ['Off', false]], function (v) { opts.timed = v; }, opts.timed));
      add(p, s);

      var r = el('div', 'btnrow');
      add(r, button('btn', 'Start the test', run));
      add(p, r);
      host.replaceChildren(p);
    }

    function segRow(label, desc, choices, onPick, current) {
      var row = el('div', 'setrow');
      var left = el('div');
      add(left, txt('div', 'sl', label));
      add(left, txt('div', 'sd', desc));
      add(row, left);
      var seg = el('div', 'seg');
      choices.forEach(function (ch) {
        var b = button(null, esc(String(ch[0])), function () {
          onPick(ch[1]);
          seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', 'true');
        });
        b.setAttribute('aria-pressed', String(ch[1] === current));
        add(seg, b);
      });
      add(row, seg);
      return row;
    }

    function buildQueue() {
      var P = load(c);
      var pool = c.data.items.slice();
      if (opts.scope === 'weak') {
        var weak = {};
        weakTopics(c, 6).forEach(function (w) { weak[w.topic.id] = 1; });
        pool = pool.filter(function (it) { return weak[it.topic]; });
      } else if (opts.scope === 'star') {
        pool = pool.filter(function (it) { return isStarred(it.id); });
      }
      if (opts.format === 'mc') pool = pool.filter(function (it) { return canMultipleChoice(c, it); });
      if (!pool.length) pool = c.data.items.slice();
      return shuffle(pool).slice(0, Math.min(opts.count, pool.length));
    }

    function run() {
      var queue = buildQueue();
      var idx = 0;
      var results = [];
      var started = Date.now();
      var clock = null;

      var head = el('div', 'blasthead');
      var qs = el('div', 'bstat');
      var qsB = txt('b', null, '1/' + queue.length); add(qs, qsB, txt('span', null, 'question'));
      add(head, qs);
      if (opts.timed) {
        var ts = el('div', 'bstat');
        var tsB = txt('b', null, '0:00'); add(ts, tsB, txt('span', null, 'elapsed'));
        add(head, ts);
        clock = setInterval(function () {
          var s = Math.floor((Date.now() - started) / 1000);
          tsB.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        }, 1000);
      }

      var bar = el('div', 'prog');
      var barI = el('i'); barI.style.width = '0%';
      add(bar, barI);

      var card = panel();
      var wrap = el('div');
      add(wrap, head, bar, card);
      host.replaceChildren(wrap);

      function paint() {
        if (idx >= queue.length) return report();
        var it = queue[idx];
        qsB.textContent = (idx + 1) + '/' + queue.length;
        barI.style.width = Math.round(100 * idx / queue.length) + '%';

        var useTyped = opts.format === 'typed' ||
          (opts.format === 'mixed' && (idx % 3 === 2 || !canMultipleChoice(c, it)));
        var choices = useTyped ? null : optionsFor(c, it, 4);
        if (!choices) useTyped = true;
        var answered = false;

        card.replaceChildren();
        add(card, txt('div', 'eyebrow', topicOf(c, it.topic).name +
          ' · ' + (useTyped ? 'write your answer' : 'choose one')));
        add(card, el('h2', 'qask', it.prompt));

        if (useTyped) {
          var row = el('div', 'typedrow');
          var inp = document.createElement('input');
          inp.type = 'text';
          inp.id = 'test-typed';
          inp.autocomplete = 'off';
          inp.placeholder = 'Your answer';
          inp.setAttribute('aria-label', 'Your answer');
          var b = button('btn', idx + 1 >= queue.length ? 'Finish' : 'Next', submit);
          add(row, inp, b);
          add(card, row);
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
          setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
          function submit() {
            if (answered) return;
            answered = true;
            grade(it, inp.value, isCorrectTyped(it, inp.value));
          }
        } else {
          var o = el('div', 'opts');
          choices.forEach(function (ch, i) {
            var b2 = button('opt', null, function () {
              if (answered) return;
              answered = true;
              grade(it, ch, it.answer.indexOf(ch) !== -1);
            });
            add(b2, txt('span', 'ok m', 'ABCD'[i]));
            add(b2, txt('span', null, ch));
            add(o, b2);
          });
          add(card, o);
        }
        // Deliberately no feedback between questions. Knowing how you did as you
        // go changes how you answer the rest; a real test does not tell you.
        add(card, txt('p', 'hint', 'You will see how you did at the end, not as you go.'));
      }

      function grade(it, given, ok) {
        results.push({ item: it, given: String(given), ok: ok });
        record(c, it, ok);
        idx++;
        paint();
      }

      function report() {
        if (clock) clearInterval(clock);
        var right = results.filter(function (r) { return r.ok; }).length;
        var mins = Math.round((Date.now() - started) / 60000);
        var P = load(c);
        logSession(c, right, results.length, 'Practice test');

        var out = frag();
        var top = panel();
        var line = el('div', 'scoreline');
        add(line, txt('div', 'big', pct(right, results.length) + '%'));
        add(line, txt('div', null, right + ' of ' + results.length + ' right' +
          (opts.timed ? ' · ' + (mins < 1 ? 'under a minute' : mins + ' ' + plural(mins, 'minute')) : '')));
        add(top, line);
        add(top, txt('p', 'because',
          right === results.length ? 'A clean sheet. Push the difficulty up next time — typed answers only.'
            : 'The list below is every question, your answer, and the right one. Read the misses; that is where the ' +
              'gain is.'));
        add(out, top);

        var byTopic = {};
        results.forEach(function (r) {
          var t = r.item.topic;
          byTopic[t] = byTopic[t] || { n: 0, ok: 0 };
          byTopic[t].n++;
          if (r.ok) byTopic[t].ok++;
        });
        var rows = Object.keys(byTopic).sort(function (a, b) {
          return (byTopic[a].ok / byTopic[a].n) - (byTopic[b].ok / byTopic[b].n);
        }).map(function (t) {
          var s = byTopic[t];
          var tr = el('tr');
          add(tr, txt('td', null, topicOf(c, t).name));
          add(tr, txt('td', 'num', s.ok + '/' + s.n));
          add(tr, meterCell(pct(s.ok, s.n)));
          add(tr, txt('td', 'num', pct(s.ok, s.n) + '%'));
          return tr;
        });
        add(out, panel(says('How each topic went.', 'Worst first — start your next session at the top.'),
          table([{ label: 'Topic' }, { label: 'Right' }, { label: 'Score', width: '34%' }, { label: '' }], rows)));

        var rev = panel(says('Every question.', 'Your answer against the accepted one.'));
        var list = el('div', 'reviewlist');
        results.forEach(function (r) {
          var d = el('div', 'rev' + (r.ok ? ' right' : ''));
          add(d, el('div', 'rq', r.item.prompt));
          add(d, el('div', 'rr', r.ok
            ? 'You said <b>' + esc(r.given) + '</b> — right.'
            : 'You said <b>' + esc(r.given || '(nothing)') + '</b>. Answer: <b>' + esc(r.item.answer[0]) + '</b>.'));
          add(list, d);
        });
        add(rev, list);
        add(out, rev);

        var r2 = el('div', 'btnrow');
        add(r2, button('btn', 'Another test', setup));
        add(r2, button('btn ghost', 'Back to console', function () { go('home'); }));
        var foot = panel();
        add(foot, r2);
        add(out, foot);

        host.replaceChildren(out);
        window.scrollTo({ top: 0 });
      }

      paint();
    }

    setup();
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Progress                                                            *
   * ------------------------------------------------------------------ */

  function progressView(c) {
    var f = frag();
    var P = load(c);
    var g = goalToday(c);
    var st = streak(c);

    add(f, pageHead('Everything you have done so far', 'Progress'));

    var ringPanel = panel();
    add(ringPanel, says(g.done >= g.goal ? 'Daily goal met.' : 'Daily goal: ' + g.done + ' of ' + g.goal + '.',
      'A small daily target beats a big weekly one — the schedule only works if it runs every day.'));
    var gr = el('div', 'goalring');
    var pctDone = Math.min(100, pct(g.done, g.goal));
    var circ = 2 * Math.PI * 34;
    add(gr, el('div', null,
      '<svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label="Daily goal ' + pctDone + ' percent complete">' +
      '<circle cx="44" cy="44" r="34" fill="none" stroke="var(--edge-soft)" stroke-width="9"></circle>' +
      '<circle cx="44" cy="44" r="34" fill="none" stroke="var(--data)" stroke-width="9" stroke-linecap="round" ' +
      'stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + (circ * (1 - pctDone / 100)).toFixed(1) + '" ' +
      'transform="rotate(-90 44 44)"></circle>' +
      '<text x="44" y="49" text-anchor="middle" fill="var(--ink)" style="font:600 17px var(--mono)">' + pctDone + '%</text>' +
      '</svg>'));
    var gt = el('div', 'goaltext');
    add(gt, txt('div', 'gv', g.done + ' / ' + g.goal));
    add(gt, txt('div', 'gl', 'cards today · ' + st + '-day streak · ' +
      (P.xp || 0).toLocaleString() + ' points all time'));
    add(gr, gt);
    add(ringPanel, gr);
    var gRow = el('div', 'btnrow');
    [20, 30, 40, 60].forEach(function (n) {
      var b = button('btn ghost', String(n) + ' a day', function () {
        P.goal = n; save(c); go('progress');
      });
      if (P.goal === n) { b.className = 'btn'; }
      add(gRow, b);
    });
    add(ringPanel, gRow);
    add(f, ringPanel);

    var row = el('div', 'row3');
    add(row, cell('Cards you know', String(knownCount(c)), 'of ' + c.data.items.length,
      pct(knownCount(c), c.data.items.length) + '% of the whole deck'));
    add(row, cell('Best Blast score', P.best.blast ? String(P.best.blast) : '—', 'points',
      P.best.blast ? 'ten questions, twelve seconds each' : 'play a round to set one'));
    add(row, cell('Fastest Match board', P.best.match ? P.best.match.toFixed(1) : '—', 'sec',
      P.best.match ? 'six pairs, penalties included' : 'play a board to set one'));
    add(f, row);

    add(f, panel(
      says('Your last seven days.', 'Cards answered per day. Today is highlighted.'),
      activityBars(c)));

    add(f, panel(
      says('Twelve weeks at a glance.', 'One square per day; darker means more cards.'),
      dayGrid(c)));

    // An honest leaderboard: a single-player app has nobody else to rank you
    // against, so you are ranked against your own previous weeks.
    var weeks = [0, 1, 2, 3, 4].map(function (w) {
      return { w: w, n: weekTotal(c, w), label: w === 0 ? 'This week' : (w === 1 ? 'Last week' : w + ' weeks ago') };
    });
    var ranked = weeks.slice().sort(function (a, b) { return b.n - a.n; });
    var lbPanel = panel(says('You against your own best weeks.',
      'No strangers here — the only fair comparison is the version of you that studied hardest.'));
    var lb = el('div', 'lb');
    ranked.forEach(function (r, i) {
      var d = el('div', 'lbrow' + (r.w === 0 ? ' you' : ''));
      add(d, txt('span', 'rk', String(i + 1)));
      add(d, txt('span', null, r.label));
      add(d, txt('span', 'pts', r.n + ' cards'));
      add(lb, d);
    });
    add(lbPanel, lb);
    add(f, lbPanel);

    var badges = [
      { i: '●', n: 'First session', d: 'Answered a card', on: lifetime(c).seen > 0 },
      { i: '◆', n: '3-day streak', d: 'Three days running', on: st >= 3 },
      { i: '◈', n: '7-day streak', d: 'A full week', on: st >= 7 },
      { i: '✦', n: '100 answers', d: 'A hundred cards answered', on: lifetime(c).seen >= 100 },
      { i: '▲', n: 'Quarter known', d: '25% of the deck locked in', on: pct(knownCount(c), c.data.items.length) >= 25 },
      { i: '△', n: 'Half known', d: '50% of the deck locked in', on: pct(knownCount(c), c.data.items.length) >= 50 },
      { i: '⚡', n: 'Blast 1000', d: 'A thousand points in one round', on: (P.best.blast || 0) >= 1000 },
      { i: '⧉', n: 'Clean board', d: 'Match under 30 seconds', on: P.best.match != null && P.best.match < 30 }
    ];
    var bp = panel(says('Milestones.',
      badges.filter(function (b) { return b.on; }).length + ' of ' + badges.length + ' earned.'));
    var bg = el('div', 'badges');
    badges.forEach(function (b) {
      var d = el('div', 'badge' + (b.on ? '' : ' locked'));
      add(d, txt('div', 'bi', b.i));
      add(d, txt('div', 'bn', b.n));
      add(d, txt('div', 'bd', b.d));
      add(bg, d);
    });
    add(bp, bg);
    add(f, bp);

    var danger = panel(says('Start over.',
      'This preview opened with about twelve weeks of sample history so the charts had something to show. ' +
      'Clearing it wipes that and your own answers, in this browser, for ' + c.name + ' only.'));
    var dr = el('div', 'btnrow');
    add(dr, button('btn ghost', 'Clear this subject’s history', function () {
      HOST.reset();
      go('progress');
    }));
    add(danger, dr);
    add(f, danger);

    return f;
  }
  /* ------------------------------------------------------------------ *
   * Mounting                                                            *
   * ------------------------------------------------------------------ */

  function mount(ctx) {
    CFG = ctx;
    HOST = ctx.progress;
    root = document.getElementById(ctx.rootId || 'app');
    if (!root) throw new Error('Synapse.mount: nothing to render into');
    root.setAttribute('data-engine', ctx.subject);
    render(false);
  }

  window.Synapse = {
    mount: mount,
    // The host calls this after something changed behind the engine's back —
    // progress arriving from the server, or a sign-in completing.
    refresh: function () { if (CFG && root) render(false); },
    page: function () { return state.page; }
  };
})();
