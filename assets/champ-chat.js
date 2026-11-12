/* GKH Project Champ: "Champ", the assistant. A chat bubble (bottom right) on the website and in the console.
   Answers questions on the product, project, program and portfolio management, in the visitor's language.
   Talks to /.netlify/functions/chat. The conversation is kept for this browser tab only (sessionStorage). */
(function () {
  'use strict';
  if (window.__champChat) return; window.__champChat = true;
  var API = '/.netlify/functions/chat';
  var where = /\/admin\//.test(location.pathname) ? 'console' : 'site';
  var ASSET = where === 'console' ? '../assets/' : 'assets/';
  var LANGS = [['auto', '🌐 Auto (your language)'], ['en', 'English'], ['ms', 'Bahasa Melayu'], ['id', 'Bahasa Indonesia'], ['ta', 'தமிழ்'], ['zh', '简体中文'], ['hi', 'हिन्दी'],
    ['ar', 'العربية'], ['fa', 'فارسی'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['tl', 'Filipino'], ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español'], ['fr', 'Français'],
    ['de', 'Deutsch'], ['pt', 'Português'], ['sw', 'Kiswahili'], ['rw', 'Kinyarwanda']];
  var RTL = { ar: 1, fa: 1 };
  var HELLO = {
    auto: 'Hi, I\'m Champ 👋 Ask me about Project Champ, or anything on project, program and portfolio management. I answer in your language.',
    en: 'Hi, I\'m Champ 👋 Ask me about Project Champ, or anything on project, program and portfolio management.',
    ms: 'Hai, saya Champ 👋 Tanya saya tentang Project Champ, atau apa sahaja mengenai pengurusan projek, program dan portfolio.',
    id: 'Hai, saya Champ 👋 Tanyakan tentang Project Champ, atau apa saja soal manajemen proyek, program, dan portofolio.',
    ta: 'வணக்கம், நான் Champ 👋 Project Champ பற்றியோ, திட்ட, நிகழ்ச்சித் திட்ட மற்றும் போர்ட்ஃபோலியோ மேலாண்மை பற்றியோ கேளுங்கள்.',
    zh: '你好，我是 Champ 👋 欢迎咨询 Project Champ，或项目、项目集和项目组合管理的任何问题。',
    hi: 'नमस्ते, मैं Champ हूँ 👋 Project Champ, या प्रोजेक्ट, प्रोग्राम और पोर्टफोलियो मैनेजमेंट के बारे में कुछ भी पूछिए।',
    ar: 'مرحبًا، أنا Champ 👋 اسألني عن Project Champ أو عن إدارة المشاريع والبرامج والمحافظ.',
    fa: 'سلام، من Champ هستم 👋 درباره Project Champ یا مدیریت پروژه، برنامه و پورتفولیو بپرسید.',
    vi: 'Xin chào, tôi là Champ 👋 Hãy hỏi về Project Champ hoặc quản lý dự án, chương trình và danh mục đầu tư.',
    th: 'สวัสดี ฉันคือ Champ 👋 ถามเกี่ยวกับ Project Champ หรือการบริหารโครงการ โปรแกรม และพอร์ตโฟลิโอได้เลย',
    tl: 'Kumusta, ako si Champ 👋 Magtanong tungkol sa Project Champ, o sa project, program at portfolio management.',
    ja: 'こんにちは、Champ です 👋 Project Champ や、プロジェクト・プログラム・ポートフォリオ管理について何でも聞いてください。',
    ko: '안녕하세요, Champ입니다 👋 Project Champ 또는 프로젝트·프로그램·포트폴리오 관리에 대해 물어보세요.',
    es: 'Hola, soy Champ 👋 Pregúntame sobre Project Champ o sobre gestión de proyectos, programas y portafolios.',
    fr: 'Bonjour, je suis Champ 👋 Posez-moi vos questions sur Project Champ ou sur la gestion de projets, de programmes et de portefeuilles.',
    de: 'Hallo, ich bin Champ 👋 Fragen Sie mich zu Project Champ oder zu Projekt-, Programm- und Portfoliomanagement.',
    pt: 'Olá, sou o Champ 👋 Pergunte sobre o Project Champ ou sobre gestão de projetos, programas e portfólios.',
    sw: 'Habari, mimi ni Champ 👋 Niulize kuhusu Project Champ, au usimamizi wa miradi, programu na portfolio.',
    rw: 'Muraho, ndi Champ 👋 Mumbaze ibyerekeye Project Champ, cyangwa imicungire y\'imishinga, porogaramu na portfolio.'
  };
  var CHIPS = where === 'console'
    ? ['How do I start a new project?', 'How does the Pipeline board work?', 'Explain SPI and CPI', 'How do I set a baseline?']
    : ['What can Project Champ do?', 'Program vs portfolio management?', 'Explain the critical path', 'Agile or waterfall: which fits?'];
  var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var msgs = []; try { msgs = JSON.parse(ss('champChat') || '[]'); } catch (e) { msgs = []; }
  var lang = ls('champChatLang') || (ls('champLang') && ls('champLang') !== 'en' ? ls('champLang') : 'auto');
  var voiceOn = ls('champVoice') === '1', voiceOk = true, audio = null, speakingBtn = null;
  var NOVOICE = { rw: 1 };
  var busy = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(t) {   // **bold**, "- " bullets, links, line breaks; everything else escaped
    var lines = esc(t).split(/\n/), out = [], inList = false;
    lines.forEach(function (l) {
      var b = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (b) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + b[1] + '</li>'); return; }
      if (inList) { out.push('</ul>'); inList = false; }
      if (l.trim()) out.push('<p>' + l + '</p>');
    });
    if (inList) out.push('</ul>');
    return out.join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(>])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)<]|$)/g, '$1<i>$2</i>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
  }

  // ---- words on the chat itself (translated with the page translator's cache) ----
  var UI = { listen: '🔊 Listen', stop: '■ Stop', menu: '☰ Main menu', menuTitle: 'Main menu: what would you like to do?', newchat: 'New chat', ph: 'Ask Champ anything about projects…',
    note: 'AI answers can be wrong; check important details.', voice: '🔊 Voice', sub: 'AI assistant', switching: 'Switching language…',
    listening: 'Listening… tap 🎤 again to send', hearing: 'Working out what you said…', notHeard: 'Sorry, I didn’t catch that. Tap 🎤 and try again.', micBlocked: 'Please allow the microphone to talk to Champ.', voiceLangs: 'Languages Champ listens for', save: 'Save' };
  var MENU = where === 'console'
    ? [['🧭', 'How do I start a new project?'], ['▦', 'How does the Pipeline board work?'], ['📈', 'Explain SPI and CPI'], ['📌', 'How do I set a baseline?'], ['🌐', 'Change language']]
    : [['🧭', 'What is Project Champ?'], ['✨', 'Show me the main features'], ['📐', 'Help with project management'], ['🗂', 'Programs and portfolios explained'],
      ['⚖️', 'Agile or waterfall: which fits my project?'], ['🚀', 'How do I get started?'], ['💬', 'Talk to GKH or book a demo'], ['🎤', 'Voice languages'], ['🌐', 'Change language']];
  var TCACHE = {};
  function cacheOf(L) { if (!TCACHE[L]) { try { TCACHE[L] = JSON.parse(localStorage.getItem('champI18n:' + L) || '{}'); } catch (e) { TCACHE[L] = {}; } } return TCACHE[L]; }
  function saveCache(L) { try { localStorage.setItem('champI18n:' + L, JSON.stringify(TCACHE[L])); } catch (e) {} }
  var concrete = function (L) { return L && L !== 'auto' && L !== 'en'; };
  function T(s) { if (!concrete(lang)) return s; var c = cacheOf(lang); return c[s] != null ? c[s] : s; }
  // translate a list of English (or other) strings into L; resolves when the cache has them
  function ensure(strings, L) {
    if (!L || L === 'auto') return Promise.resolve();
    var c = cacheOf(L), need = strings.filter(function (s, i, a) { return s && c[s] == null && a.indexOf(s) === i; });
    if (!need.length) return Promise.resolve();
    var batches = []; for (var i = 0; i < need.length; i += 80) batches.push(need.slice(i, i + 80));
    return Promise.all(batches.map(function (b) {
      return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'i18n', lang: L, strings: b }) })
        .then(function (r) { return r.json(); }).then(function (j) { Object.keys(j.map || {}).forEach(function (k) { c[k] = j.map[k]; }); });
    })).then(function () { saveCache(L); }).catch(function () {});
  }
  // an answer is translated line by line, so bullets and bold survive
  function pieces(text) {
    var out = [];
    String(text).split('\n').forEach(function (l) {
      var m = /^(\s*(?:[-*•]|\d+[.)])\s+)?(.*)$/.exec(l), body = (m[2] || '').trim();
      if (!body) return;
      if (body.length <= 650) out.push(body); else body.split(/(?<=[.!?。])\s+/).forEach(function (x) { if (x.trim()) out.push(x.trim()); });
    });
    return out;
  }
  function rebuild(text, L) {
    var c = cacheOf(L);
    return String(text).split('\n').map(function (l) {
      var m = /^(\s*(?:[-*•]|\d+[.)])\s+)?(.*)$/.exec(l), pre = m[1] || '', body = (m[2] || '').trim();
      if (!body) return l;
      if (c[body] != null) return pre + c[body];
      return pre + body.split(/(?<=[.!?。])\s+/).map(function (x) { return c[x.trim()] != null ? c[x.trim()] : x; }).join(' ');
    }).join('\n');
  }
  function textOf(m) { if (lang === 'auto' || m.lang === lang) return m.content; return (m.tr && m.tr[lang]) || m.content; }
  function langOf(m) { if (lang !== 'auto' && (m.lang === lang || (m.tr && m.tr[lang]))) return lang; return m.lang || 'en'; }

  function build() {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'champChatBtn'; btn.className = 'cc-btn'; btn.setAttribute('aria-label', 'Ask Champ, the Project Champ assistant'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<img src="' + ASSET + 'gkh-globe.webp" alt="" class="gkh-globe" width="40" height="40"><span>Ask Champ</span>';
    if (ls('champChatSeen') !== '1') btn.classList.add('cc-glow');
    var box = document.createElement('section');
    box.id = 'champChat'; box.className = 'cc-box'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Champ assistant');
    box.innerHTML =
      '<header class="cc-h"><img src="' + ASSET + 'gkh-globe.webp" alt="" class="gkh-globe" width="38" height="38"><div><b>Champ</b><small class="cc-sub">AI assistant</small></div>' +
      '<button type="button" class="cc-menubtn" title="Main menu" aria-label="Main menu">☰</button>' +
      '<select class="cc-lang" aria-label="Language">' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="cc-voice" aria-pressed="' + voiceOn + '" title="Read Champ’s answers aloud">🔊 Voice</button>' +
      '<button type="button" class="cc-x" aria-label="Close">✕</button></header>' +
      '<div class="cc-log" aria-live="polite"></div>' +
      '<form class="cc-f"><button type="button" class="cc-mic" aria-label="Speak to Champ" title="Speak (Champ answers in the language you speak)">🎤</button><textarea rows="1" maxlength="1200" placeholder="Ask Champ anything about projects…" aria-label="Your question"></textarea><button type="submit" aria-label="Send">➤</button></form>' +
      '<p class="cc-foot"><span class="cc-note">AI answers can be wrong; check important details.</span> <button type="button" class="cc-clear">New chat</button></p>';
    document.body.appendChild(btn); document.body.appendChild(box);
    var log = box.querySelector('.cc-log'), ta = box.querySelector('textarea'), sel = box.querySelector('.cc-lang'), speakingIdx = -1;

    function bubble(role, html, cls) {
      var d = document.createElement('div'); d.className = 'cc-m cc-' + role + (cls ? ' ' + cls : '');
      d.innerHTML = html; if (role === 'bot') d.dir = 'auto';
      log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
    }
    function labels() {   // the chat's own words, in the current language
      box.querySelector('.cc-sub').textContent = T(UI.sub); ta.placeholder = T(UI.ph); box.querySelector('.cc-note').textContent = T(UI.note);
      box.querySelector('.cc-clear').textContent = T(UI.newchat); box.querySelector('.cc-voice').textContent = T(UI.voice);
      box.querySelector('.cc-menubtn').title = T(UI.menu).replace('☰ ', '');
    }
    function stopVoice() { if (audio) { try { audio.pause(); } catch (e) {} audio = null; } speakingIdx = -1; if (speakingBtn) { speakingBtn.classList.remove('on'); speakingBtn.textContent = T(UI.listen); speakingBtn = null; } }
    function speak(text, L, b, idx) {
      stopVoice(); if (!voiceOk || NOVOICE[L]) return;
      speakingIdx = idx == null ? -1 : idx;
      if (b) { speakingBtn = b; b.classList.add('on'); b.textContent = T(UI.stop); }
      fetch('/.netlify/functions/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: L }) })
        .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 503) { voiceOk = false; log.querySelectorAll('.cc-say').forEach(function (x) { x.remove(); }); box.querySelector('.cc-voice').hidden = true; } throw new Error(j.error || 'Voice unavailable'); }); return r.blob(); })
        .then(function (bl) { if (b && speakingBtn !== b) return; audio = new Audio(URL.createObjectURL(bl)); audio.onended = stopVoice; return audio.play(); })
        .catch(function (e) {
          stopVoice();
          if (e && e.name === 'NotAllowedError') return;   // the browser wants a click first: the 🔊 Listen button is there for that
          bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err');
        });
    }
    function tools(bb, idx) {   // under each answer: 🔊 Listen and ☰ Main menu
      var row = document.createElement('div'); row.className = 'cc-tools';
      var m = msgs[idx], L = langOf(m);
      if (voiceOk && !NOVOICE[L]) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'cc-say'; b.textContent = T(UI.listen); b.setAttribute('aria-label', 'Read this answer aloud');
        b.onclick = function () { if (speakingBtn === b) stopVoice(); else speak(textOf(msgs[idx]), langOf(msgs[idx]), b, idx); };
        row.appendChild(b);
      }
      var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'cc-mlink'; mb.textContent = T(UI.menu); mb.onclick = showMenu;
      row.appendChild(mb); bb.appendChild(row); return row;
    }
    function showMenu() {
      var old = log.querySelector('.cc-menu'); if (old) old.remove();
      var d = bubble('bot', '<p><b>' + esc(T(UI.menuTitle)) + '</b></p><div class="cc-menu-list">' + MENU.map(function (x, i) {
        return '<button type="button" data-mi="' + i + '"><span aria-hidden="true">' + x[0] + '</span>' + esc(T(x[1])) + '</button>'; }).join('') + '</div>', 'cc-menu');
      d.querySelectorAll('[data-mi]').forEach(function (b) {
        b.onclick = function () {
          var it = MENU[+b.getAttribute('data-mi')];
          if (it[1] === 'Change language') { sel.focus(); try { sel.showPicker(); } catch (e) {} return; }
          if (it[1] === 'Voice languages') { d.remove(); voiceLangsPanel(); return; }
          d.remove(); ask(T(it[1]));
        };
      });
      log.scrollTop = log.scrollHeight;
    }
    function draw() {
      log.innerHTML = '';
      bubble('bot', md(HELLO[lang] || HELLO.auto));
      msgs.forEach(function (m, i) { if (m.role === 'user') bubble('user', '<p>' + esc(m.content) + '</p>'); else tools(bubble('bot', md(textOf(m))), i); });
      if (!msgs.length) showMenu();
      box.dir = RTL[lang] ? 'rtl' : 'ltr'; labels();
    }
    // switch language: translate what is on screen, keep reading aloud in the new language, then show the main menu
    var switching = 0;
    function switchLang(L, fromPage) {
      if (L === lang && !fromPage) return;
      var wasIdx = speakingIdx; stopVoice();
      lang = L; sel.value = L; ls('champChatLang', L);
      if (!fromPage) window.dispatchEvent(new CustomEvent('champ:chatlang', { detail: L }));
      var my = ++switching;
      if (L === 'auto') { if (!box.hidden) { draw(); if (msgs.length) showMenu(); } return; }
      var todo = [], strings = concrete(L) ? Object.keys(UI).map(function (k) { return UI[k]; }).concat(MENU.map(function (x) { return x[1]; })) : [];
      msgs.forEach(function (m) { if (m.role === 'assistant' && m.lang !== L && !(m.tr && m.tr[L])) { todo.push(m); strings = strings.concat(pieces(m.content)); } });
      if (!box.hidden) draw();   // greeting, direction and anything already translated change at once
      if (strings.length) { box.classList.add('cc-switching'); box.querySelector('.cc-sub').textContent = '⏳ ' + UI.switching; }
      ensure(strings, L).then(function () {
        if (my !== switching) return;
        todo.forEach(function (m) { m.tr = m.tr || {}; m.tr[L] = rebuild(m.content, L); });
        ss('champChat', JSON.stringify(msgs.slice(-24)));
        box.classList.remove('cc-switching');
        if (box.hidden) return;
        draw(); if (busy) bubble('bot', '<span class="cc-dots"><i></i><i></i><i></i></span>', 'cc-wait'); else if (msgs.length) showMenu();
        if (wasIdx >= 0 && msgs[wasIdx]) { var bs = log.querySelectorAll('.cc-bot .cc-say'), k = msgs.slice(0, wasIdx + 1).filter(function (m) { return m.role === 'assistant'; }).length - 1; speak(textOf(msgs[wasIdx]), langOf(msgs[wasIdx]), bs[k], wasIdx); }
      });
    }
    function ask(q, spoken) {
      q = String(q || '').trim(); if (!q || busy) return;
      var menu = log.querySelector('.cc-menu'); if (menu) menu.remove();
      busy = true; msgs.push({ role: 'user', content: q }); ss('champChat', JSON.stringify(msgs.slice(-24)));
      bubble('user', '<p>' + esc(q) + '</p>'); ta.value = ''; ta.style.height = '';
      var wait = bubble('bot', '<span class="cc-dots"><i></i><i></i><i></i></span>', 'cc-wait');
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs.slice(-12).map(function (m) { return { role: m.role, content: m.role === 'assistant' ? textOf(m) : m.content }; }), lang: lang, where: where }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'The assistant is unavailable right now.'); return j; }); })
        .then(function (j) {
          log.querySelectorAll('.cc-wait').forEach(function (x) { x.remove(); }); var L = j.lang || (lang === 'auto' ? 'en' : lang);
          msgs.push({ role: 'assistant', content: j.reply, lang: L }); ss('champChat', JSON.stringify(msgs.slice(-24)));
          var i = msgs.length - 1;
          // you wrote (or spoke) in another language: Champ answered in it, so the whole chat follows you there
          if (j.lang && lang !== 'auto' && j.lang !== lang && LANGS.some(function (x) { return x[0] === j.lang; })) {
            busy = false; speakingIdx = voiceOn || spoken ? i : -1; switchLang(j.lang); return;
          }
          var bb = bubble('bot', md(j.reply)), row = tools(bb, i);
          if (voiceOn || spoken) speak(j.reply, L, row.querySelector('.cc-say'), i);
        })
        .catch(function (e) { log.querySelectorAll('.cc-wait').forEach(function (x) { x.remove(); }); msgs.pop(); ss('champChat', JSON.stringify(msgs)); bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err'); })
        .then(function () { busy = false; ta.focus(); });
    }
    // ---- 🎤 Champ's ears: speak in any of your voice languages; Champ switches to it and answers aloud ----
    var STT_ALL = ['en', 'ta', 'ms', 'id', 'fa', 'zh', 'hi', 'ar', 'vi', 'th', 'tl', 'ja', 'ko', 'es', 'fr', 'de', 'sw'];   // Portuguese: “Any language” mode only (refused in a list by Azure in australiaeast)
    function sttAny() { return ls('champSttMode') === 'any'; }
    function sttLangs() { try { var v = JSON.parse(ls('champSttLangs') || 'null'); if (Array.isArray(v) && v.length) return v.filter(function (x) { return STT_ALL.indexOf(x) >= 0; }); } catch (e) {} return ['en', 'ta', 'ms', 'fa']; }
    function voiceLangsPanel() {
      var cur = sttLangs(), name = {}; LANGS.forEach(function (l) { name[l[0]] = l[1]; });
      var d = bubble('bot', '<p><b>🎤 ' + esc(T(UI.voiceLangs)) + '</b></p>' +
        '<div class="cc-vmode"><label><input type="radio" name="ccvm" value="list"' + (sttAny() ? '' : ' checked') + '> <span><b>My languages</b> (most accurate; needed for Tamil, Malay, Persian and other regional languages)</span></label>' +
        '<label><input type="radio" name="ccvm" value="any"' + (sttAny() ? ' checked' : '') + '> <span><b>Any language</b> (big world languages, including Portuguese; Tamil, Malay and Persian are not heard well this way)</span></label></div>' +
        '<p class="cc-small">My languages: pick the ones you speak (up to 6). Fewer is more accurate. Malay and Indonesian sound alike: choose one.</p><div class="cc-vlangs">' +
        STT_ALL.map(function (k) { return '<label><input type="checkbox" value="' + k + '"' + (cur.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(name[k] || k) + '</label>'; }).join('') +
        '</div><button type="button" class="cc-vsave">' + esc(T(UI.save)) + '</button>', 'cc-menu');
      var boxes = d.querySelectorAll('input');
      boxes.forEach(function (b) { if (b.type === 'checkbox') b.onchange = function () { var n = d.querySelectorAll('.cc-vlangs input:checked').length; if (n > 6) b.checked = false; }; });
      d.querySelector('.cc-vsave').onclick = function () {
        var mode = (d.querySelector('[name=ccvm]:checked') || {}).value || 'list';
        var v = [].slice.call(d.querySelectorAll('.cc-vlangs input:checked')).map(function (x) { return x.value; });
        if (mode === 'list' && !v.length) return;
        ls('champSttMode', mode); if (v.length) ls('champSttLangs', JSON.stringify(v)); d.remove(); showMenu();
      };
    }
    var rec = null, recStream = null, recChunks = [], recTimer = null, vad = null, mic = box.querySelector('.cc-mic');
    function micState(st) { mic.classList.toggle('on', st === 'rec'); mic.classList.toggle('busy', st === 'busy'); mic.textContent = st === 'busy' ? '⏳' : '🎤'; ta.placeholder = st === 'rec' ? T(UI.listening) : st === 'busy' ? T(UI.hearing) : T(UI.ph); }
    function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); }
    function cleanRec() { clearTimeout(recTimer); if (vad) { try { vad.ctx.close(); } catch (e) {} vad = null; } if (recStream) recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; }
    function startRec() {
      if (!navigator.mediaDevices || !window.MediaRecorder) { bubble('bot', '<p>' + esc(T(UI.micBlocked)) + '</p>', 'cc-err'); return; }
      stopVoice();
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        recStream = stream; recChunks = [];
        var types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'], mt = types.filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
        rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
        rec.onstop = function () { var type = (rec.mimeType || mt || 'audio/webm').split(';')[0]; cleanRec(); send(new Blob(recChunks, { type: type }), type); };
        rec.start(); micState('rec');
        recTimer = setTimeout(stopRec, 30000);   // a question, not a speech
        // stop by itself after a pause: about 1.4 s of quiet once you have started talking
        try {
          var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), an = ctx.createAnalyser(), buf = new Uint8Array(1024), spoke = false, quietSince = 0, t0 = Date.now();
          ctx.createMediaStreamSource(stream).connect(an); an.fftSize = 1024; vad = { ctx: ctx };
          (function tick() {
            if (!vad || !rec || rec.state === 'inactive') return;
            an.getByteTimeDomainData(buf); var sum = 0; for (var i = 0; i < buf.length; i++) { var x = (buf[i] - 128) / 128; sum += x * x; }
            var rms = Math.sqrt(sum / buf.length), now = Date.now();
            if (rms > 0.035) { spoke = true; quietSince = 0; } else if (spoke) { quietSince = quietSince || now; if (now - quietSince > 1400) return stopRec(); }
            if (!spoke && now - t0 > 8000) return stopRec();   // nothing said
            requestAnimationFrame(tick);
          })();
        } catch (e) {}
      }).catch(function () { micState(''); bubble('bot', '<p>' + esc(T(UI.micBlocked)) + '</p>', 'cc-err'); });
    }
    function send(blob, type) {
      if (!blob.size || blob.size < 1200) { micState(''); bubble('bot', '<p>' + esc(T(UI.notHeard)) + '</p>', 'cc-err'); return; }
      micState('busy');
      fetch('/.netlify/functions/stt?langs=' + (sttAny() ? 'any' : encodeURIComponent(sttLangs().join(','))), { method: 'POST', headers: { 'Content-Type': type }, body: blob })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Voice input is unavailable right now.'); return j; }); })
        .then(function (j) {
          micState('');
          if (!j.text) { bubble('bot', '<p>' + esc(T(UI.notHeard)) + '</p>', 'cc-err'); return; }
          if (j.lang && j.lang !== lang) switchLang(j.lang);   // you spoke Tamil: Champ is now in Tamil
          ask(j.text, true);
        })
        .catch(function (e) { micState(''); bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err'); });
    }
    mic.onclick = function () { if (rec && rec.state === 'recording') stopRec(); else if (!mic.classList.contains('busy')) startRec(); };
    window.ChampEars = { send: send, langs: sttLangs };

    function open(on) {
      box.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false'); document.body.classList.toggle('cc-open', on);
      if (on) { btn.classList.remove('cc-glow'); ls('champChatSeen', '1'); } else { stopVoice(); if (typeof stopRec === 'function') stopRec(); }
      if (on) { draw(); setTimeout(function () { ta.focus(); }, 50); if (concrete(lang)) ensure(Object.keys(UI).map(function (k) { return UI[k]; }).concat(MENU.map(function (x) { return x[1]; })), lang).then(function () { if (!box.hidden) { labels(); var mm = log.querySelector('.cc-menu'); if (mm) showMenu(); } }); }
    }
    btn.onclick = function () { open(box.hidden); };
    box.querySelector('.cc-x').onclick = function () { open(false); btn.focus(); };
    box.querySelector('.cc-menubtn').onclick = showMenu;
    box.querySelector('.cc-clear').onclick = function () { stopVoice(); msgs = []; ss('champChat', '[]'); draw(); };
    sel.onchange = function () { switchLang(sel.value); };
    window.addEventListener('champ:lang', function (e) { switchLang(e.detail, true); });
    var vb = box.querySelector('.cc-voice');
    vb.onclick = function () { voiceOn = !voiceOn; ls('champVoice', voiceOn ? '1' : '0'); vb.setAttribute('aria-pressed', String(voiceOn)); if (!voiceOn) stopVoice(); };
    box.querySelector('form').onsubmit = function (e) { e.preventDefault(); ask(ta.value); };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(ta.value); } });
    ta.addEventListener('input', function () { ta.style.height = ''; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) open(false); });
    window.ChampChat = { open: function () { open(true); }, ask: function (q) { open(true); ask(q); }, lang: function (L) { switchLang(L); }, menu: function () { open(true); showMenu(); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
