/* GKH Project Champ: 🎙 Ask Champ in the dashboard. A guide to the console, not a chat: tap the microphone (or type), ask
   "how do I make a project charter?" and Champ shows you on the screen: a pointer glides to each place to click, the spot is
   lit up, and a bubble says what to do. Click the real thing (or Next) to go on, or "Show me" and Champ clicks the safe steps
   for you (it never saves, signs or sends anything for you). No language questions: it listens in the console's language. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, $ = function (s) { return document.querySelector(s); };
  var lang = function () { return (window.ChampI18n && window.ChampI18n.get()) || 'en'; };
  var tr = function (list) { return window.ChampI18n && window.ChampI18n.strings && lang() !== 'en' ? window.ChampI18n.strings(list, lang()).catch(function () { return list; }) : Promise.resolve(list); };
  var planHash = function () { var m = location.hash.match(/^#plan\/([^/]+)/); return m ? m[1] : ''; };
  var tab = function (t) { return 'a.tab[href$="/' + t + '"]'; };

  // ---------- the tours: each step points at one thing on the screen ----------
  // go: open a page first · sel: what to point at · say: what to do · click: Champ may click it for you ("Show me")
  // plan: the step needs a project open (Champ asks you to pick one) · end: the last word
  var OPEN = { plan: 1, click: 1, sel: 'tr[data-plan]', say: 'First open a project: click one in the list.' };
  var T = [
    { id: 'charter', t: 'Generate the project charter', k: 'charter|project charter|piagam|சாசன|sign off charter', steps: [OPEN,
      { sel: '[data-dact=charter]', say: 'Press “📜 Generate the charter” in the documents bar at the top of the project.', click: 1 },
      { sel: '.thm, #chPrev', say: 'Pick a colour theme and the language for the document.' },
      { sel: '#chPrev', say: '“👁 Preview” shows it before you download it.' },
      { sel: '#chPdf', say: 'Download it as a PDF, or press Word next to it for an editable copy. Up to 4 pages.' }] },
    { id: 'plandoc', t: 'Generate the project plan document', k: 'project plan document|plan document|20 page|narrative|pelan projek', steps: [OPEN,
      { sel: '[data-dact=plan]', say: 'Press “📘 Generate the project plan”.', click: 1 },
      { sel: '#pdAi', say: '“✨ Write the narrative with AI” writes the text (about 20 pages).' },
      { sel: '#pdPdf', say: 'Then download it as a PDF (or Word).' }] },
    { id: 'bom', t: 'Generate a Bill of Materials (BOM)', k: 'bom|bill of materials|materials|bahan', steps: [OPEN,
      { sel: tab('bom'), say: 'Open the 🧱 BOM tab. (No BOM tab? Switch it on with ⚙ Modules.)', click: 1, alt: '#modBtn' },
      { sel: '#bomAi', say: '“✨ Draft with AI” writes the BOM from the plan. Or “＋ Line” to add your own.' },
      { sel: '.bom-tbl, #bomAdd', say: 'Check each line: quantity, unit price, the task it belongs to, then tick ✓.' },
      { sel: '#bomSign', say: '“✍ Sign off” when every line is checked: the BOM then goes into the Costing as Materials.' }] },
    { id: 'user', t: 'Create a new user (login)', k: 'new user|create user|add user|login|access|password|pengguna', owner: 1, steps: [
      { go: '#users', sel: '#usNew', say: 'In Users & access press “＋ New user”.', click: 1 },
      { sel: '#nuF [name=email]', say: 'Type their email: it is their username.' },
      { sel: '#nuF .us-rpick', say: 'Pick the role: Project director, Contractor or Project personnel.' },
      { sel: '#nuF [name=pw]', say: 'Choose their password (10 characters or more, letters and a number) and type it again.' },
      { sel: '#nuF [type=submit]', say: '“Next: confirm” shows a summary. Check it, press “Confirm and create”, then set the projects and modules they can use.' }] },
    { id: 'project', t: 'Start a new project', k: 'new project|create project|start project|projek baru', steps: [
      { go: '#projects/new', sel: '#champNew [name=progPick]', say: 'Choose the program. Its client, sponsor and contact details fill in by themselves.' },
      { sel: '#champNew [name=name]', say: 'Give the project a name.' },
      { sel: '#champNew [name=summary]', say: 'Say what it is about: the AI uses it to draft the plan.' },
      { sel: '#champNew [type=submit]', say: 'Press “Create project and plan it”, then pick a template, a blank plan or ✨ AI.' }] },
    { id: 'task', t: 'Add a task to the schedule', k: 'add task|new task|level 1|milestone|tugas', steps: [OPEN,
      { sel: tab('schedule'), say: 'Open ▤ Schedule & Gantt.', click: 1 },
      { sel: '[data-addend], #addTask', say: '“＋ Task (level 1)” adds a task at the end; the ＋ next to a task adds one right below it. Fill in days, Qty and Unit $ for its cost.' }] },
    { id: 'note', t: 'Leave a sticky note on a task', k: 'sticky|note|remark|nota', steps: [OPEN,
      { sel: tab('schedule'), say: 'Open ▤ Schedule & Gantt (or the Board).', click: 1 },
      { sel: '.stkb', say: 'Press 🗒 on a task. Write the note, pick red, amber or green, and press Enter to save.' }] },
    { id: 'board', t: 'See the whole Kanban board at once', k: 'kanban|board|full view|picture|papan', steps: [OPEN,
      { sel: tab('board'), say: 'Open ▦ Board.', click: 1 },
      { sel: '#kbFull', say: '“🖼 Full view” shows the whole board as one picture. You can save it as a PNG.', click: 1 }] },
    { id: 'budget', t: 'Work out and approve the costing', k: 'costing|budget|cost|approve budget|kos|bajet', steps: [OPEN,
      { sel: tab('budget'), say: 'Open 💰 Costing: labour from the tasks, materials from the signed-off BOM.', click: 1 },
      { sel: '#bdSet', say: '“Set as approved budget” asks for your name, role and signature.' }] },
    { id: 'risk', t: 'Add a risk', k: 'risk|risiko|threat', steps: [OPEN,
      { sel: tab('risks'), say: 'Open ⚠ Risks.', click: 1 },
      { sel: '#addRisk', say: '“＋ Add risk”: describe it, rate likelihood and impact, and the response.' }] },
    { id: 'critical', t: 'See the critical path', k: 'critical path|critical|laluan kritikal|slack|float', steps: [OPEN,
      { sel: tab('critical'), say: 'Open ⚡ Critical path: the chain of tasks that sets the finish date.', click: 1 }] },
    { id: 'change', t: 'Raise a change request', k: 'change request|change control|change|perubahan', steps: [OPEN,
      { sel: tab('change'), say: 'Open 🔁 Change control to raise and approve changes (every decision is kept as a record).', click: 1 }] },
    { id: 'intel', t: 'Ask Project Intelligence about a project', k: 'project intelligence|ask ai|question about project|analyse', steps: [OPEN,
      { sel: tab('intel'), say: 'Open 🧠 Project Intelligence.', click: 1 },
      { sel: '#piQ', say: 'Type your question about the project and press Ask.' }] },
    { id: 'people', t: 'Add a person to the team', k: 'add person|people|team member|staff|contractor|kakitangan', owner: 1, steps: [
      { go: '#people', sel: '#ppNew', say: 'In People press “＋ Person”: group, role, rate per hour, credentials.', click: 1 }] },
    { id: 'profile', t: 'Fill in my profile, credentials and resume', k: 'my profile|resume|cv|credential|qualification|certification|profil', steps: [
      { go: '#me', sel: '#meEdit', say: 'Press “Edit my profile”: your rate per hour, education, qualifications, certifications and resume.', click: 1 }] },
    { id: 'calendar', t: 'See the team calendar and workload', k: 'calendar|workload|who is busy|kalendar', steps: [
      { go: '#people/calendar', sel: '.pc-t', say: 'The team calendar: who is on what, day by day. Workload is the next tab.' }] },
    { id: 'language', t: 'Change the language of the console', k: 'language|bahasa|மொழி|translate', steps: [
      { sel: '#champLangBtn', say: 'Press the language button and pick a language: the whole console changes.' }] }];

  // ---------- 🔊 Champ's voice (Azure, the same voice as the website): reads replies and every step aloud ----------
  var V = { audio: null, n: 0, on: (function () { try { return localStorage.getItem('cgVoice') !== 'off'; } catch (e) { return true; } })() };
  function hush() { V.n++; if (V.audio) { try { V.audio.pause(); } catch (e) {} V.audio = null; } }
  function speak(text) {
    hush(); if (!V.on || !text) return; var n = V.n, el = $('#cgVoice');
    fetch('/.netlify/functions/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(text).slice(0, 1500), lang: lang() }) })
      .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Champ’s voice is not available right now.'); }); return r.blob(); })
      .then(function (bl) { if (n !== V.n) return; V.audio = new Audio(URL.createObjectURL(bl)); if (el) el.classList.add('talk'); V.audio.onended = function () { if (el) el.classList.remove('talk'); }; return V.audio.play(); })
      .catch(function (e) { if (el) el.classList.remove('talk'); if (n === V.n && !V.warned) { V.warned = true; say('bot', '🔇 ' + (/play|interact|NotAllowed/i.test(e.message) ? 'Tap 🔊 to let me speak.' : e.message)); } });
  }
  function voiceBtn() { var b = $('#cgVoice'); if (b) { b.textContent = V.on ? '🔊' : '🔇'; b.title = V.on ? 'Champ speaks: tap to mute' : 'Muted: tap so Champ speaks'; } }

  // ---------- the pointer, the spotlight and the bubble ----------
  var G = { tour: null, i: 0, auto: false, el: null, off: null, x: innerWidth - 80, y: innerHeight - 80 };
  function ui() {
    if ($('#cgLayer')) return;
    var d = document.createElement('div'); d.id = 'cgLayer';
    d.innerHTML = '<div class="cg-spot" hidden></div><div class="cg-cursor" hidden><svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#1F1D18" stroke="#F5D77A" stroke-width="1.6" stroke-linejoin="round"/></svg><i></i></div>' +
      '<div class="cg-tip" hidden><div class="cg-tip-h"><b id="cgTitle"></b><span id="cgN"></span></div><p id="cgSay"></p><div class="cg-tip-b"><button type="button" class="btn btn-sm" id="cgBack">◀</button><button type="button" class="btn btn-sm" id="cgShow">▶ Show me</button><button type="button" class="btn btn-sm btn-gold" id="cgNext">Next ▶</button><button type="button" class="btn btn-sm" id="cgEnd" title="End the guide">✕</button></div></div>';
    document.body.appendChild(d);
    $('#cgNext').onclick = function () { step(G.i + 1); };
    $('#cgBack').onclick = function () { step(Math.max(0, G.i - 1)); };
    $('#cgEnd').onclick = end;
    $('#cgShow').onclick = function () { G.auto = !G.auto; this.textContent = G.auto ? '⏸ Pause' : '▶ Show me'; if (G.auto) autoGo(); };
    addEventListener('resize', place); addEventListener('scroll', place, true);
  }
  function waitFor(sel, ms) {
    return new Promise(function (res) { var t0 = Date.now(); (function look() {
      var el = null; String(sel).split(/\s*,\s*/).some(function (s) { var x = document.querySelector(s); if (x && x.offsetParent !== null) { el = x; return true; } return false; });
      if (el) return res(el); if (Date.now() - t0 > (ms || 6000)) return res(null); setTimeout(look, 150); })(); });
  }
  function waitHash(re, ms) { return new Promise(function (res) { var t0 = Date.now(); (function look() { if (re.test(location.hash)) return res(true); if (!G.tour || Date.now() - t0 > (ms || 120000)) return res(false); setTimeout(look, 250); })(); }); }
  function place() {
    var el = G.el, sp = $('.cg-spot'), tip = $('.cg-tip'), cur = $('.cg-cursor'); if (!sp || !G.tour) return;
    if (!el || !document.body.contains(el)) { sp.hidden = true; tip.hidden = false; tip.style.left = Math.max(12, innerWidth / 2 - 170) + 'px'; tip.style.top = '90px'; return; }
    var r = el.getBoundingClientRect(), pad = 6;
    sp.hidden = false; sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px'; sp.style.width = (r.width + pad * 2) + 'px'; sp.style.height = (r.height + pad * 2) + 'px';
    var tw = Math.min(340, innerWidth - 24), below = r.bottom + 14 + 170 < innerHeight;
    tip.hidden = false; tip.style.width = tw + 'px'; tip.style.left = Math.max(12, Math.min(innerWidth - tw - 12, r.left + r.width / 2 - tw / 2)) + 'px';
    tip.style.top = (below ? r.bottom + 14 : Math.max(12, r.top - tip.offsetHeight - 14)) + 'px';
    G.x = r.left + Math.min(r.width / 2, 40); G.y = r.top + r.height / 2; cur.style.transform = 'translate(' + G.x + 'px,' + G.y + 'px)';
  }
  function step(i) {
    var tour = G.tour; if (!tour) return; if (G.off) { G.off(); G.off = null; }
    if (i >= tour.steps.length) return finish();
    G.i = i; var s = tour.steps[i], sp = $('.cg-spot'), tip = $('.cg-tip'), cur = $('.cg-cursor');
    $('#cgTitle').textContent = tour.title; $('#cgN').textContent = (i + 1) + ' / ' + tour.steps.length; $('#cgBack').disabled = i === 0;
    $('#cgNext').textContent = i === tour.steps.length - 1 ? 'Done ✓' : 'Next ▶';
    tr([s.say]).then(function (x) { $('#cgSay').textContent = x[0]; place(); speak(x[0]); });
    var go = function () {
      if (s.plan && planHash()) return step(i + 1);   // a project is open already
      if (s.plan) { if (!/^#projects$/.test(location.hash)) location.hash = '#projects'; waitHash(/^#plan\//).then(function (ok) { if (ok && G.tour === tour && G.i === i) setTimeout(function () { step(i + 1); }, 500); }); }
      else if (s.go && location.hash !== s.go) location.hash = s.go;
      waitFor(s.sel, s.plan ? 8000 : 7000).then(function (el) {
        if (G.tour !== tour || G.i !== i) return;
        if (!el && s.alt) return waitFor(s.alt, 1500).then(function (a) { show(a); });
        show(el);
      });
    };
    var show = function (el) {
      G.el = el; cur.hidden = false; sp.hidden = !el;
      if (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } }
      setTimeout(function () { place(); cur.classList.remove('tap'); setTimeout(function () { cur.classList.add('tap'); }, 750); }, 320);
      if (!el) { $('#cgSay').textContent += ' ' + '(It is not on this screen right now: open the page first, or press Next.)'; return; }
      if (s.plan) { if (G.auto) autoGo(); return; }   // opening a project moves the guide on by itself
      // clicking the real thing moves the guide on
      var h = function () { setTimeout(function () { if (G.tour === tour && G.i === i) step(i + 1); }, 450); };
      el.addEventListener('click', h, true); G.off = function () { el.removeEventListener('click', h, true); };
      if (G.auto) autoGo();
    };
    go();
  }
  function autoGo() {
    var tour = G.tour, i = G.i, s = tour && tour.steps[i]; if (!s) return;
    var t0 = Date.now(), go = function () { if (!G.auto || G.tour !== tour || G.i !== i) return;
      if (V.audio && !V.audio.ended && !V.audio.paused && Date.now() - t0 < 15000) return setTimeout(go, 400);   // let Champ finish the sentence
      if (s.click && G.el) G.el.click(); else step(i + 1); };
    setTimeout(go, 2200);
  }
  function start(tour) {
    if (tour.owner && !(M.me || {}).owner) { reply('Only the project manager (super user) can do “' + tour.t + '”. Ask them, or I can show you something else.'); return; }
    ui(); closePanel(); G.tour = { id: tour.id, title: tour.t, steps: tour.steps }; G.auto = false; $('#cgShow').textContent = '▶ Show me';
    tr([tour.t]).then(function (x) { if (G.tour) G.tour.title = x[0]; $('#cgTitle').textContent = x[0]; });
    $('#cgLayer').classList.add('on'); step(0);
  }
  function end() { hush(); if (G.off) { G.off(); G.off = null; } G.tour = null; G.el = null; var l = $('#cgLayer'); if (l) { l.classList.remove('on'); l.querySelectorAll('.cg-spot,.cg-cursor,.cg-tip').forEach(function (x) { x.hidden = true; }); } }
  function finish() { var t = G.tour && G.tour.title; end(); openPanel(); reply('✓ That is how: ' + t + '. Ask me anything else.'); }

  // ---------- the panel: a big microphone (and a box to type in) ----------
  function btn() {
    if ($('#cgBtn') || !document.getElementById('app')) return;
    var b = document.createElement('button'); b.id = 'cgBtn'; b.type = 'button'; b.title = 'Ask Champ: how do I…?'; b.innerHTML = '<img src="../assets/gkh-globe.webp" alt=""><span>Ask Champ</span>';
    b.onclick = function () { if ($('#cgPanel') && !$('#cgPanel').hidden) closePanel(); else openPanel(); };
    document.body.appendChild(b);
  }
  function openPanel() {
    var p = $('#cgPanel');
    if (!p) {
      p = document.createElement('div'); p.id = 'cgPanel';
      var LL = (window.ChampI18n && window.ChampI18n.langs) || [['en', 'English']];
      p.innerHTML = '<div class="cgp-h"><img src="../assets/gkh-globe.webp" alt=""><b>Champ</b><select id="cgLang" title="Champ\'s language (the whole console changes too)">' + LL.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang() ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="cgp-v" id="cgVoice"></button><button type="button" class="cgp-x" title="Close">✕</button></div><div class="cgp-log" id="cgLog"></div>' +
        '<div class="cgp-menu" id="cgMenu" hidden></div>' +
        '<p class="cgp-hint" id="cgHint">Tap 🎙 and ask, or say “menu”.</p>' +
        '<form class="cgp-f" id="cgF"><button type="button" class="cgp-mic" id="cgMic" title="Tap and ask (say “menu” for the list)">🎙</button><input id="cgQ" maxlength="300" placeholder="Ask me anything…"><button class="cgp-send" type="submit" title="Ask">➤</button><button type="button" class="cgp-mbtn" id="cgMenuBtn" title="Menu: everything I can show you">☰</button></form>';
      document.body.appendChild(p);
      p.querySelector('.cgp-x').onclick = closePanel; voiceBtn();
      $('#cgVoice').onclick = function () { V.on = !V.on; try { localStorage.setItem('cgVoice', V.on ? 'on' : 'off'); } catch (e) {} voiceBtn(); if (!V.on) hush(); else { V.warned = false; speak(lastBot || 'Hello!'); } };
      $('#cgLang').onchange = function () { var l = this.value; if (window.ChampI18n) window.ChampI18n.set(l); setTimeout(function () { greet(true); chipsFill(p); }, 600); };
      $('#cgF').onsubmit = function (e) { e.preventDefault(); var q = $('#cgQ').value.trim(); if (q) { $('#cgQ').value = ''; ask(q); } };
      $('#cgMic').onclick = mic; $('#cgMenuBtn').onclick = function () { menu(); };
      chipsFill(p);
    }
    p.hidden = false; greet(false);
  }
  // ☰ the menu: everything Champ can show you, in groups (tap ☰, or say / type "menu")
  var MENU = [['📁 In a project', ['charter', 'plandoc', 'bom', 'task', 'note', 'board', 'budget', 'risk', 'critical', 'change', 'intel']], ['🚀 Getting started', ['project', 'profile', 'language']], ['👥 Team and access', ['user', 'people', 'calendar']]];
  var IC = { charter: '📜', plandoc: '📘', bom: '🧱', task: '＋', note: '🗒', board: '🖼', budget: '💰', risk: '⚠', critical: '⚡', change: '🔁', intel: '🧠', project: '📅', profile: '🙋', language: '🌐', user: '🔐', people: '👥', calendar: '📆' };
  function chipsFill(p) {
    var ids = [].concat.apply([], MENU.map(function (g) { return g[1]; })), tt = ids.map(function (id) { return T.filter(function (x) { return x.id === id; })[0].t; });
    tr(tt.concat(MENU.map(function (g) { return g[0]; }), ['Tap 🎙 and ask, or say “menu”.', 'Ask me anything…', 'Everything I can show you'])).then(function (L) {
      var at = 0, g0 = tt.length;
      $('#cgMenu').innerHTML = '<div class="cgp-mh">' + esc(L[L.length - 1]) + '<button type="button" id="cgMenuX">✕</button></div>' + MENU.map(function (g, gi) {
        return '<p>' + esc(L[g0 + gi]) + '</p><div class="cgp-mg">' + g[1].map(function (id) { var t = L[at++]; return '<button type="button" data-cgt="' + id + '"><i>' + IC[id] + '</i>' + esc(t) + '</button>'; }).join('') + '</div>'; }).join('');
      $('#cgHint').textContent = L[L.length - 3]; $('#cgQ').placeholder = L[L.length - 2];
      p.querySelectorAll('[data-cgt]').forEach(function (b) { b.onclick = function () { $('#cgMenu').hidden = true; start(T.filter(function (x) { return x.id === b.getAttribute('data-cgt'); })[0]); }; });
      $('#cgMenuX').onclick = function () { $('#cgMenu').hidden = true; };
    });
  }
  function menu(spoken) { openPanel(); var m = $('#cgMenu'); m.hidden = spoken ? false : !m.hidden; if (!m.hidden) { m.scrollTop = 0; if (spoken) reply('Here is everything I can show you. Pick one, or just ask.'); } }
  var MENU_WORDS = /^(the )?(menu|main menu|show (me )?(the )?menu|open (the )?menu|options|help|what can you do\??|what can you show me\??|menu utama|tunjuk menu|மெனு|菜单|メニュー|메뉴|منو|القائمة|मेनू|เมนู)[.!? ]*$/i;
  // the hello: once a session (and again in a new language)
  var GREET = 'Hello, I’m Champ! 👋 Think of me as your co-pilot in Project Champ. Ask me how to do anything, like making a charter, a BOM or a new user, and I’ll show you exactly where to click, step by step. I can also answer your project management questions, like what to do when a project runs late. Tap 🎙 and just ask, or say “menu” to see everything I can show you.';
  function greet(again) {
    var k = 'cgHello'; try { if (!again && sessionStorage.getItem(k) === lang()) return; sessionStorage.setItem(k, lang()); } catch (e) {}
    var L = $('#cgLog'); if (L && again) L.innerHTML = ''; reply(GREET);
  }
  function closePanel() { var p = $('#cgPanel'); if (p) p.hidden = true; }
  function say(who, text) { var L = $('#cgLog'); if (!L) return; var d = document.createElement('div'); d.className = 'cgp-m cgp-' + who; d.textContent = text; L.appendChild(d); L.scrollTop = L.scrollHeight; return d; }
  var lastBot = '';
  function reply(text, quiet) { var p = $('#cgPanel'); if (!p || p.hidden) { if (p) p.hidden = false; else openPanel(); } tr([text]).then(function (x) { say('bot', x[0]); lastBot = x[0]; if (!quiet) speak(x[0]); }); }

  // what did they ask for? words first (fast, works offline), then the AI (any language, any wording)
  function local(q) {
    var s = q.toLowerCase(), best = null, top = 0;
    T.forEach(function (t) { var n = 0; t.k.split('|').forEach(function (w) { if (w && s.indexOf(w) >= 0) n += w.length; }); if (n > top) { top = n; best = t; } });
    return top >= 3 ? best : null;
  }
  var HOW = /\b(how|where|show me|guide me|walk me|can i|cara|bagaimana|di mana|tunjuk)\b|எப்படி|எங்கே|如何|怎么|どうやって|어떻게|چگونه|كيف|कैसे|ทำอย่างไร/i;
  function ask(q) {
    openPanel(); say('me', q);
    if (MENU_WORDS.test(q.trim())) return menu(true);
    var hit = (HOW.test(q) || q.split(/\s+/).length <= 4) ? local(q) : null; if (hit) return start(hit);   // "how do I make a charter?": straight to the guide
    var wait = say('bot', '…');
    api('guideAsk', { q: q, page: location.hash.slice(1, 60), core: planHash(), tours: T.map(function (t) { return { id: t.id, t: t.t }; }) }).then(function (r) {
      if (wait) wait.remove();
      var t = T.filter(function (x) { return x.id === r.tour; })[0];
      if (r.answer) { var d = say('bot', r.answer); lastBot = r.answer; if (!(t && r.how)) speak(r.answer);
        if (t && !r.how) tr(['▶ Show me: ' + t.t]).then(function (x) { var b = document.createElement('button'); b.type = 'button'; b.className = 'cgp-show'; b.textContent = x[0]; b.onclick = function () { start(t); }; d.appendChild(b); }); }
      if (t && (r.how || !r.answer)) setTimeout(function () { start(t); }, r.answer ? 900 : 0);
      else if (!r.answer) reply('I can show you how to: ' + T.slice(0, 8).map(function (x) { return x.t.toLowerCase(); }).join(', ') + '. Which one?');
    }).catch(function () { if (wait) wait.remove(); reply('I can show you how to: ' + T.slice(0, 8).map(function (x) { return x.t.toLowerCase(); }).join(', ') + '. Which one?'); });
  }

  // 🎙 tap to talk: records until you stop talking, then Champ's ears (Azure) write it down in the console's language
  var rec = null;
  // the browser's own speech recognition first (Chrome, Edge, Safari: instant, many languages); Azure when the browser has none
  var SRL = { en: 'en-AU', ms: 'ms-MY', id: 'id-ID', ta: 'ta-IN', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-AE', fa: 'fa-IR', vi: 'vi-VN', th: 'th-TH', tl: 'fil-PH', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', sw: 'sw-KE', km: 'km-KH' };
  var sr = null;
  function mic() {
    var m = $('#cgMic'), SR = window.SpeechRecognition || window.webkitSpeechRecognition; hush();
    if (sr) { try { sr.stop(); } catch (e) {} return; }
    if (SR && !mic.azure) {
      var got = '', failed = false; sr = new SR(); sr.lang = SRL[lang()] || 'en-AU'; sr.interimResults = true; sr.maxAlternatives = 1; sr.continuous = false;
      sr.onresult = function (e) { got = Array.prototype.map.call(e.results, function (r) { return r[0].transcript; }).join(' '); $('#cgQ').value = got; };
      sr.onerror = function (e) { failed = true; if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reply('The microphone is blocked. Allow it in the browser (the 🔒 next to the address), or type your question.'); else if (e.error === 'network' || e.error === 'language-not-supported') { mic.azure = true; } };
      sr.onend = function () { sr = null; m.classList.remove('rec'); var q = got.trim(); $('#cgQ').value = ''; if (q) ask(q); else if (mic.azure && failed) mic(); else if (!failed) reply('I did not catch that. Tap the microphone and ask again, or type it.', true); };
      try { sr.start(); m.classList.add('rec'); return; } catch (e) { sr = null; mic.azure = true; }
    }
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) return reply('This browser cannot use the microphone here. Type your question instead.');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var chunks = [], types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'], mt = types.filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
      rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined); m.classList.add('rec');
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); m.classList.remove('rec'); m.classList.add('busy');
        var type = (rec.mimeType || mt || 'audio/webm').split(';')[0], blob = new Blob(chunks, { type: type }), l = lang(), langs = l === 'en' ? 'en' : l + ',en';
        if (blob.size < 1200) { m.classList.remove('busy'); return reply('I did not hear anything. Tap the microphone and ask again.'); }
        fetch('/.netlify/functions/stt?langs=' + encodeURIComponent(langs) + '&prefer=' + encodeURIComponent(l), { method: 'POST', headers: { 'Content-Type': type }, body: blob })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Voice input is not available right now. Type your question instead.'); return j; }); })
          .then(function (j) { m.classList.remove('busy'); if (j.text) ask(j.text); else reply('I did not catch that. Tap the microphone and ask again, or type it.'); })
          .catch(function (e) { m.classList.remove('busy'); reply(e.message); });
      };
      rec.start();
      // stops by itself after you finish talking (about 1.3 s of quiet), or after 12 seconds
      var stopAt = setTimeout(function () { if (rec.state === 'recording') rec.stop(); }, 12000);
      try {
        var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), an = ctx.createAnalyser(), buf = new Uint8Array(1024), spoke = false, quiet = 0, t0 = Date.now(), floor = 0, nf = 0;
        ctx.createMediaStreamSource(stream).connect(an); an.fftSize = 1024;
        (function tick() {
          if (rec.state !== 'recording') { clearTimeout(stopAt); ctx.close && ctx.close(); return; }
          an.getByteTimeDomainData(buf); var sum = 0; for (var i = 0; i < buf.length; i++) { var x = (buf[i] - 128) / 128; sum += x * x; }
          var rms = Math.sqrt(sum / buf.length), now = Date.now();
          if (now - t0 < 350) { floor += rms; nf++; return setTimeout(tick, 40); }
          if (rms > Math.max(0.012, floor / Math.max(1, nf) * 2.5)) { spoke = true; quiet = 0; } else if (spoke) { quiet = quiet || now; if (now - quiet > 1300) { rec.stop(); return; } }
          if (!spoke && now - t0 > 7000) { rec.stop(); return; }
          setTimeout(tick, 40);
        })();
      } catch (e) {}
    }).catch(function () { reply('The microphone is blocked. Allow it in the browser (the 🔒 next to the address), or type your question.'); });
  }

  M.guide = { start: function (id) { var t = T.filter(function (x) { return x.id === id; })[0]; if (t) start(t); }, ask: ask, tours: T };
  new MutationObserver(function () { if (!document.getElementById('app').hidden) btn(); }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
  setTimeout(function () { if (!document.getElementById('app').hidden) btn(); }, 800);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && G.tour) end(); });
})();
