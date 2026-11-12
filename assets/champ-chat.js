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
  // ---- the visitor: Champ's welcome questions (language → name → phone → email → confirm → welcome package) ----
  var OB = { greet: 'Greetings! I\u2019m Champ 👋 What language would you be most comfortable with?',
    greetIn: 'Greetings! I\u2019m Champ 👋 I\u2019ll speak with you in {lang}.',
    switchTip: 'You can always switch to English or any other language by saying “switch to …”.',
    sorry: 'Sorry, I don\u2019t speak that language yet. Let\u2019s keep to English.',
    skipWord: 'skip', micTip: '🎤 Tip: switch on your microphone and just talk to me. Say “Hey Champ” any time to wake me up.', micOn: '🎤 Turn on microphone',
    micReady: 'Microphone on. I’m listening.',
    formIntro: 'Lovely! Please type your details in the form below: typing is quicker and more accurate than voice.', skipForm: 'Prefer not to? Just type or say “skip”.',
    formTitle: 'Your details', fFirst: 'First name', fLast: 'Last name', fPhone: 'Phone (with country code)', fEmail: 'Email', fWhy: 'Reason for your visit', fWhyPick: 'Choose one…',
    rProduct: 'Looking for a project management tool', rDemo: 'I’d like a demo', rPrice: 'Pricing and plans', rPartner: 'Partnership or reselling', rTraining: 'Training or consulting', rBrowse: 'Just browsing', rOther: 'Something else',
    fMore: 'Tell us more (optional)', pdpaTitle: '🔒 Your privacy (PDPA)',
    pdpa: 'GKH collects these details only to reply to you and to tell you about GKH Project Champ. We look after them under Malaysia’s Personal Data Protection Act 2010 (PDPA) and Australia’s Privacy Act 1988, never sell them, and you can ask us to see, correct or delete them at any time.',
    pdpaRead: 'Read our Privacy Notice', agree: 'I agree to GKH collecting and using my details as described.', send: 'Send ▶', sending: 'Saving…',
    errName: 'Please type your first and last name.', errPhone: 'Please check your phone number and include the country code, for example +61 412 345 678.', errEmail: 'Please check your email address.',
    errWhy: 'Please choose a reason for your visit.', errAgree: 'Please tick the box to agree to the privacy notice.', errSave: 'Sorry, that didn’t save. Please try again.',
    askWelcome: 'Thank you, {name}! Will it be OK for us to send a welcome pack about our product to your email?', askWelcomeNo: 'Thank you! Will it be OK for us to send a welcome pack about our product to your email?',
    sayYesNo: 'Just say or tap yes or no.',
    yes: 'Yes', no: 'No', yesPlease: 'Yes, please', noThanks: 'No, thanks', skip: 'Skip',
    sent: 'Done! Your welcome package is on its way to {email}.',
    noted: 'Noted! The GKH team will send your welcome package to {email} shortly.',
    thanksName: 'Thank you, {name}! That\u2019s all I needed. Feel free to ask me any question about Project Champ, or about project, program and portfolio management.',
    thanks: 'Thank you! That\u2019s all I needed. Feel free to ask me any question about Project Champ, or about project, program and portfolio management.',
    back: 'Welcome back, {name}! 👋 How can I help you today?', forgot: 'Done. I have forgotten your details.' };
  var vis = {}; try { vis = JSON.parse(ls('champVisitor') || '{}') || {}; } catch (e) { vis = {}; }
  function newId() { var a = new Uint8Array(12); try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 12; i++) a[i] = Math.random() * 256; } return 'v' + Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  if (!vis.id) vis.id = newId();
  if (/^(name|phone|email|confirm)$/.test(vis.step || '')) vis.step = 'form';   // earlier builds asked one question at a time
  function saveVis() { ls('champVisitor', JSON.stringify(vis)); }
  saveVis();
  var LNAMES = { en: ['english', 'inggeris', 'ingles', 'inglés', 'anglais', 'englisch'], ms: ['malay', 'melayu', 'bahasa melayu', 'malaysian'], id: ['indonesian', 'indonesia', 'bahasa indonesia'],
    ta: ['tamil', 'தமிழ்'], zh: ['chinese', 'mandarin', '中文', '普通话', '汉语', '华语', '简体中文'], hi: ['hindi', 'हिन्दी', 'हिंदी'], ar: ['arabic', 'العربية', 'عربي', 'عربية'],
    fa: ['persian', 'farsi', 'فارسی', 'پارسی'], vi: ['vietnamese', 'tiếng việt', 'tieng viet'], th: ['thai', 'ไทย', 'ภาษาไทย'], tl: ['filipino', 'tagalog'], ja: ['japanese', '日本語', 'にほんご'],
    ko: ['korean', '한국어'], es: ['spanish', 'español', 'espanol', 'castellano'], fr: ['french', 'français', 'francais'], de: ['german', 'deutsch'], pt: ['portuguese', 'português', 'portugues'],
    sw: ['swahili', 'kiswahili'], rw: ['kinyarwanda', 'ikinyarwanda'] };
  function langFromText(t) {
    t = String(t || '').toLowerCase().replace(/[.,!?¿¡。、！？:;"“”'’()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.split(' ').length > 6) return '';
    var hit = '';
    Object.keys(LNAMES).forEach(function (k) { if (!hit && LNAMES[k].some(function (n) { return /[a-z]/.test(n) ? (' ' + t + ' ').indexOf(' ' + n + ' ') >= 0 : t.indexOf(n) >= 0; })) hit = k; });
    return hit;
  }
  function yesNo(t) {
    t = String(t || '').trim().toLowerCase().replace(/[.!。！]+$/, '');
    if (/^(y|yes|yeah|yep|yup|sure|ok|okay|correct|right|that'?s (right|correct)|please|yes please|ya|iya|ye|betul|ada|ஆம்|ஆமாம்|சரி|oui|sí|si|ja|sim|da|はい|ええ|네|예|是|是的|对|好|نعم|بله|آره|درسته|हाँ|हां|haan|ha|ndiyo|ndio|vâng|có|ใช่|ครับ|ค่ะ|opo|oo)(?=$|[\s,.!?،。！？])/.test(t)) return 'yes';
    if (/^(n|no|nope|nah|no thanks|not now|wrong|incorrect|tidak|tak|bukan|இல்லை|வேண்டாம்|non|nein|não|nao|いいえ|아니요|아니|不|不是|不用|لا|نه|नहीं|nahi|hapana|không|ไม่|hindi)(?=$|[\s,.!?،。！？])/.test(t)) return 'no';
    if (t === T(OB.yes).toLowerCase() || t === T(OB.yesPlease).toLowerCase()) return 'yes';
    if (t === T(OB.no).toLowerCase() || t === T(OB.noThanks).toLowerCase()) return 'no';
    return '';
  }
  function normPhone(s) { var t = String(s || '').replace(/[^\d+]/g, ''); if (t.indexOf('00') === 0) t = '+' + t.slice(2); if (t[0] !== '+') { if (t[0] === '0') return ''; t = '+' + t; } t = '+' + t.slice(1).replace(/\+/g, ''); var n = t.length - 1; return n >= 8 && n <= 15 && t[1] !== '0' ? t : ''; }
  function normEmail(s) { var t = String(s || '').trim().toLowerCase().replace(/\s+(at|@)\s+/g, '@').replace(/\s+(dot|point)\s+/g, '.').replace(/\s+/g, '').replace(/[.。]+$/, ''); return /^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(t) && t.length <= 120 ? t : ''; }
  function obStrs() { return Object.keys(OB).map(function (k) { return OB[k]; }); }
  function fill(t) { var ln = (LANGS.filter(function (l) { return l[0] === lang; })[0] || [0, 'English'])[1]; return String(t).replace(/\{lang\}/g, ln).replace(/\{name\}/g, vis.name || '').replace(/\{email\}/g, vis.email || ''); }
  function tr(s) { return fill(T(s)); }
  function obActive() { return where === 'site' && !!vis.step && vis.step !== 'done' && ss('champObPause') !== '1'; }
  function obSave(f) {
    var b = { mode: 'visitor', id: vis.id, page: location.pathname }; Object.keys(f).forEach(function (k) { b[k] = f[k]; });
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; if (r.ok) { vis.saved = 1; saveVis(); } return j; }); })
      .catch(function () { return {}; });
  }

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
      ['⚖️', 'Agile or waterfall: which fits my project?'], ['🚀', 'How do I get started?'], ['💬', 'Talk to GKH or book a demo'], ['👋', 'Introduce myself'], ['🎤', 'Voice languages'], ['🌐', 'Change language']];
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
    function speak(text, L, b, idx, done) {
      stopVoice(); if (!voiceOk || NOVOICE[L]) { if (done) done(); return; }
      speakingIdx = idx == null ? -1 : idx;
      if (b) { speakingBtn = b; b.classList.add('on'); b.textContent = T(UI.stop); }
      fetch('/.netlify/functions/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: L }) })
        .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 503) { voiceOk = false; log.querySelectorAll('.cc-say').forEach(function (x) { x.remove(); }); box.querySelector('.cc-voice').hidden = true; } throw new Error(j.error || 'Voice unavailable'); }); return r.blob(); })
        .then(function (bl) { if (b && speakingBtn !== b) return; audio = new Audio(URL.createObjectURL(bl)); audio.onended = function () { stopVoice(); if (done) done(); }; return audio.play(); })
        .catch(function (e) {
          stopVoice(); if (done) done();
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
      if (!m.ob) { var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'cc-mlink'; mb.textContent = T(UI.menu); mb.onclick = menuNow; row.appendChild(mb); }
      bb.appendChild(row); return row;
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
          if (it[1] === 'Introduce myself') { d.remove(); ss('champObPause', ''); vis.step = 'lang'; saveVis(); obPrompt(); return; }
          d.remove(); ask(T(it[1]));
        };
      });
      log.scrollTop = log.scrollHeight;
    }
    function draw() {
      log.innerHTML = '';
      var hasOb = msgs.some(function (m) { return m.ob; });
      if (!hasOb && !obActive()) bubble('bot', md(vis.name && where === 'site' ? tr(OB.back) : (HELLO[lang] || HELLO.auto)));
      msgs.forEach(function (m, i) { if (m.role === 'user') bubble('user', '<p>' + esc(m.content) + '</p>'); else tools(bubble('bot', md(textOf(m))), i); });
      if (obActive()) obButtons(); else if (!msgs.length) showMenu();
      box.dir = RTL[lang] ? 'rtl' : 'ltr'; labels();
    }
    // switch language: translate what is on screen, keep reading aloud in the new language, then show the main menu
    var switching = 0;
    function switchLang(L, fromPage, after) {
      if (L === lang && !fromPage) { if (after) after(); return; }
      var wasIdx = speakingIdx; stopVoice();
      lang = L; sel.value = L; ls('champChatLang', L);
      if (!fromPage) window.dispatchEvent(new CustomEvent('champ:chatlang', { detail: L }));
      var my = ++switching;
      if (L === 'auto') { if (!box.hidden) { draw(); if (msgs.length && !obActive()) showMenu(); } if (after) after(); return; }
      var todo = [], strings = concrete(L) ? Object.keys(UI).map(function (k) { return UI[k]; }).concat(MENU.map(function (x) { return x[1]; })).concat(where === 'site' ? obStrs() : []) : [];
      msgs.forEach(function (m) { if (m.role === 'assistant' && m.lang !== L && !(m.tr && m.tr[L])) { todo.push(m); strings = strings.concat(pieces(m.content)); } });
      if (!box.hidden) draw();   // greeting, direction and anything already translated change at once
      if (strings.length) { box.classList.add('cc-switching'); box.querySelector('.cc-sub').textContent = '⏳ ' + UI.switching; }
      ensure(strings, L).then(function () {
        if (my !== switching) return;
        todo.forEach(function (m) { m.tr = m.tr || {}; m.tr[L] = rebuild(m.content, L); });
        ss('champChat', JSON.stringify(msgs.slice(-24)));
        box.classList.remove('cc-switching');
        if (!box.hidden) { draw(); if (busy) bubble('bot', '<span class="cc-dots"><i></i><i></i><i></i></span>', 'cc-wait'); else if (msgs.length && !obActive() && !after) showMenu(); }
        if (after) { after(); return; }
        if (box.hidden) return;
        if (wasIdx >= 0 && msgs[wasIdx]) { var bs = log.querySelectorAll('.cc-bot .cc-say'), k = msgs.slice(0, wasIdx + 1).filter(function (m) { return m.role === 'assistant'; }).length - 1; speak(textOf(msgs[wasIdx]), langOf(msgs[wasIdx]), bs[k], wasIdx); }
      });
    }
    function ask(q, spoken, after) {
      q = String(q || '').trim(); if (!q || busy) return;
      var menu = log.querySelector('.cc-menu'); if (menu) menu.remove();
      busy = true; msgs.push({ role: 'user', content: q }); ss('champChat', JSON.stringify(msgs.slice(-24)));
      bubble('user', '<p>' + esc(q) + '</p>'); ta.value = ''; ta.style.height = '';
      var wait = bubble('bot', '<span class="cc-dots"><i></i><i></i><i></i></span>', 'cc-wait');
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs.filter(function (m) { return !m.ob; }).slice(-12).map(function (m) { return { role: m.role, content: m.role === 'assistant' ? textOf(m) : m.content }; }), lang: lang, where: where, name: where === 'site' ? (vis.name || '') : '' }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'The assistant is unavailable right now.'); return j; }); })
        .then(function (j) {
          log.querySelectorAll('.cc-wait').forEach(function (x) { x.remove(); }); var L = j.lang || (lang === 'auto' ? 'en' : lang);
          msgs.push({ role: 'assistant', content: j.reply, lang: L }); ss('champChat', JSON.stringify(msgs.slice(-24)));
          var i = msgs.length - 1;
          // you wrote (or spoke) in another language: Champ answered in it, so the whole chat follows you there
          if (j.lang && lang !== 'auto' && j.lang !== lang && LANGS.some(function (x) { return x[0] === j.lang; })) {
            busy = false; speakingIdx = voiceOn || spoken ? i : -1; switchLang(j.lang, false, after); return;
          }
          var bb = bubble('bot', md(j.reply)), row = tools(bb, i);
          if (voiceOn || spoken) speak(j.reply, L, row.querySelector('.cc-say'), i, spoken ? listenNext : null);
          if (after) setTimeout(after, 0);
        })
        .catch(function (e) { log.querySelectorAll('.cc-wait').forEach(function (x) { x.remove(); }); msgs.pop(); ss('champChat', JSON.stringify(msgs)); bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err'); })
        .then(function () { busy = false; ta.focus(); });
    }
    // ---- Champ's welcome: greeting → language (voice or tap) → a typed form (Wonder Bird style, with the PDPA notice) → welcome pack yes/no (voice or tap) ----
    function curL() { return concrete(lang) ? lang : 'en'; }
    function obVoice() { return ls('champVoice') !== '0'; }
    function obSay(text, L) {
      var old = log.querySelector('.cc-obb'); if (old) old.remove();
      msgs.push({ role: 'assistant', content: text, lang: L || curL(), ob: true }); ss('champChat', JSON.stringify(msgs.slice(-24)));
      var i = msgs.length - 1, row = tools(bubble('bot', md(text)), i);
      if (obVoice()) speak(text, L || curL(), row.querySelector('.cc-say'), i, listenNext); else listenNext();
    }
    // hands-free: once the microphone is on, Champ listens after its questions (not while you type the form)
    function handsFree() { return ls('champHandsFree') === '1'; }
    function listenNext() { if (handsFree() && vis.step !== 'form' && !box.hidden && !busy && !(rec && rec.state === 'recording')) setTimeout(function () { if (!box.hidden && !busy && vis.step !== 'form' && !(rec && rec.state === 'recording')) startRec(true); }, 250); }
    function micOn() {
      if (!navigator.mediaDevices) { bubble('bot', '<p>' + esc(T(UI.micBlocked)) + '</p>', 'cc-err'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
        st.getTracks().forEach(function (t) { t.stop(); });
        ls('champHandsFree', '1'); wake.start();
        var o = log.querySelector('.cc-obb'); if (o) o.remove();
        bubble('bot', '<p>' + esc(T(OB.micReady)) + '</p>', 'cc-note-mic'); obButtons(); startRec(true);
      }).catch(function () { bubble('bot', '<p>' + esc(T(UI.micBlocked)) + '</p>', 'cc-err'); });
    }
    function obUser(t) { var m = log.querySelector('.cc-menu:not(.cc-obb)'); if (m) m.remove(); msgs.push({ role: 'user', content: t, ob: true }); ss('champChat', JSON.stringify(msgs.slice(-24))); bubble('user', '<p>' + esc(t) + '</p>'); ta.value = ''; ta.style.height = ''; }
    function obPrompt() {
      var st = vis.step;
      if (st === 'lang') obSay(OB.greet + '\n' + OB.switchTip + (handsFree() ? '' : '\n' + OB.micTip), 'en');
      else if (st === 'form') obSay(tr(OB.formIntro) + ' ' + tr(OB.skipForm));
      else if (st === 'welcome') obSay(tr(vis.name ? OB.askWelcome : OB.askWelcomeNo) + ' ' + tr(OB.sayYesNo));
      obButtons();
    }
    function obButtons() {
      var old = log.querySelector('.cc-obb'); if (old) old.remove();
      if (!obActive()) return;
      var st = vis.step, btns = [];
      if (st === 'form') return obForm();
      if (st === 'lang') btns = LANGS.filter(function (l) { return l[0] !== 'auto'; }).map(function (l) { return ['L:' + l[0], l[1]]; });
      else if (st === 'welcome') btns = [['yes', '🎁 ' + T(OB.yesPlease)], ['no', T(OB.noThanks)]];
      if (!handsFree()) btns.push(['mic', st === 'lang' ? OB.micOn : T(OB.micOn)]);
      var d = bubble('bot', '<div class="cc-ob-btns' + (st === 'lang' ? ' cc-ob-langs' : '') + '">' + btns.map(function (b) { return '<button type="button" data-ob="' + esc(b[0]) + '">' + esc(b[1]) + '</button>'; }).join('') + '</div>', 'cc-obb');
      d.querySelectorAll('[data-ob]').forEach(function (b) {
        b.onclick = function () {
          var v = b.getAttribute('data-ob');
          if (v.indexOf('L:') === 0) { obUser(b.textContent); chooseLang(v.slice(2)); }
          else if (v === 'mic') micOn();
          else { obUser(b.textContent.replace(/^🎁\s*/, '')); obAnswer(v === 'yes' ? 'yes' : 'no', false, '', true); }
        };
      });
      log.scrollTop = log.scrollHeight;
    }
    // the form: typed, because voice gets names, numbers and emails wrong too often
    var REASONS = ['rProduct', 'rDemo', 'rPrice', 'rPartner', 'rTraining', 'rBrowse', 'rOther'];
    function obForm() {
      var F = vis.f = vis.f || {}, d = document.createElement('div');
      d.className = 'cc-m cc-bot cc-obb cc-formb'; d.dir = 'auto';
      var fld = function (k, label, type, auto, ph, max) {
        return '<label class="cc-pf"><span>' + esc(T(label)) + '</span><input name="' + k + '" type="' + type + '" autocomplete="' + auto + '" maxlength="' + max + '" placeholder="' + esc(ph) + '" value="' + esc(F[k] || '') + '"' + (k === 'phone' || k === 'email' ? ' dir="ltr"' : '') + '></label>';
      };
      d.innerHTML = '<form class="cc-form" novalidate><b class="cc-form-t">📝 ' + esc(T(OB.formTitle)) + '</b>' +
        '<div class="cc-pf2">' + fld('first', OB.fFirst, 'text', 'given-name', '', 40) + fld('last', OB.fLast, 'text', 'family-name', '', 40) + '</div>' +
        fld('phone', OB.fPhone, 'tel', 'tel', '+61 412 345 678', 22) + fld('email', OB.fEmail, 'email', 'email', 'you@example.com', 120) +
        '<label class="cc-pf"><span>' + esc(T(OB.fWhy)) + '</span><select name="purpose"><option value="">' + esc(T(OB.fWhyPick)) + '</option>' +
          REASONS.map(function (r) { return '<option value="' + r + '"' + (F.purpose === r ? ' selected' : '') + '>' + esc(T(OB[r])) + '</option>'; }).join('') + '</select></label>' +
        '<label class="cc-pf"><span>' + esc(T(OB.fMore)) + '</span><textarea name="more" rows="2" maxlength="400">' + esc(F.more || '') + '</textarea></label>' +
        '<input type="text" name="website" class="cc-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<div class="cc-pdpa"><b>' + esc(T(OB.pdpaTitle)) + '</b><p>' + esc(T(OB.pdpa)) + ' <a href="privacy.html#champ" target="_blank" rel="noopener">' + esc(T(OB.pdpaRead)) + '</a></p></div>' +
        '<label class="cc-pc"><input type="checkbox" name="consent"' + (F.consent ? ' checked' : '') + '><span>' + esc(T(OB.agree)) + '</span></label>' +
        '<p class="cc-perr" role="alert" hidden></p><button type="submit" class="cc-go">' + esc(T(OB.send)) + '</button></form>';
      log.appendChild(d); log.scrollTop = log.scrollHeight;
      var f = d.querySelector('form'), err = d.querySelector('.cc-perr');
      f.addEventListener('input', function (e) { var t = e.target; if (!t.name || t.name === 'website') return; F[t.name] = t.type === 'checkbox' ? t.checked : t.value; saveVis(); });
      f.addEventListener('change', function (e) { var t = e.target; if (t.name) { F[t.name] = t.type === 'checkbox' ? t.checked : t.value; saveVis(); } });
      f.onsubmit = function (e) {
        e.preventDefault(); if (busy) return;
        var first = String(F.first || '').trim(), last = String(F.last || '').trim(), phone = normPhone(F.phone), email = normEmail(F.email);
        var bad = !first || !last ? OB.errName : !phone ? OB.errPhone : !email ? OB.errEmail : !F.purpose ? OB.errWhy : !F.consent ? OB.errAgree : '';
        if (bad) { err.textContent = T(bad); err.hidden = false; return; }
        err.hidden = true; busy = true; var go = d.querySelector('.cc-go'); go.disabled = true; go.textContent = T(OB.sending);
        obSave({ first: first, last: last, phone: phone, email: email, purpose: OB[F.purpose] || F.purpose, more: String(F.more || '').trim(), consent: true, website: f.website.value })
          .then(function (j) {
            busy = false;
            if (!j.ok) { go.disabled = false; go.textContent = T(OB.send); err.textContent = T(j.status === 422 ? (j.bad && j.bad[0] === 'phone' ? OB.errPhone : j.bad && j.bad[0] === 'email' ? OB.errEmail : OB.errName) : OB.errSave); err.hidden = false; return; }
            vis.name = first; vis.email = email; vis.f = null; vis.step = 'welcome'; saveVis();
            d.remove(); obUser('✓ ' + first + ' ' + last + ' · ' + phone + ' · ' + email);
            obPrompt();
          });
      };
      setTimeout(function () { var x = f.querySelector('input[name=first]'); if (x && !x.value) try { x.focus({ preventScroll: true }); } catch (e2) {} }, 200);
    }
    function chooseLang(L) {
      vis.lang = L; vis.step = 'form'; saveVis(); obSave({ lang: L });
      if (L !== lang) switchLang(L, false, obPrompt);
      else if (concrete(L)) ensure(obStrs(), L).then(obPrompt); else obPrompt();
    }
    function obFinish() {
      vis.step = 'done'; saveVis();
      obSay(tr(vis.name ? OB.thanksName : OB.thanks)); showMenu();
    }
    function isSkip(t) {
      t = String(t || '').trim().toLowerCase().replace(/[.!。！]+$/, '');
      return /^(skip|skip it|skip this|pass|next|not now|no thanks|lewati|langkau|abaikan|தவிர்|தவிர்க்கவும்|அடுத்து|跳过|下一个|छोड़ें|छोड़ो|आगे|تخطى|تخطي|رد|رد شو|بگذر|bỏ qua|ข้าม|laktawan|スキップ|次|건너뛰기|다음|saltar|omitir|passer|suivant|überspringen|weiter|pular|próximo|ruka|ruka swali|simbuka)$/.test(t) || (t && t === T(OB.skipWord).toLowerCase());
    }
    function obSkip(shown) {
      var st = vis.step; if (!shown) obUser(T(OB.skipWord));
      if (st === 'lang') { obSave({ skip: 'lang' }); chooseLang('en'); return; }
      if (st === 'form') { obSave({ skip: 'form' }); vis.f = null; saveVis(); return obFinish(); }
      if (st === 'welcome') { obSave({ welcome: 'no' }); return obFinish(); }
    }
    // true when the onboarding took the answer
    function obAnswer(text, spoken, heard, shown) {
      var st = vis.step, t = String(text || '').trim(); if (!t) return true;
      if (isSkip(t) && st !== 'welcome') { if (!shown) obUser(t); obSkip(true); return true; }
      if (st === 'lang') {
        if (!shown) obUser(t);
        var L = langFromText(t) || (heard && heard !== 'en' && LANGS.some(function (x) { return x[0] === heard; }) ? heard : '');
        if (!L) { obSay(OB.sorry, 'en'); L = 'en'; }
        chooseLang(L); return true;
      }
      if (st === 'form') { ask(t, spoken, function () { if (obActive()) obButtons(); }); return true; }   // a question while the form is open: answer it, keep the form
      if (st === 'welcome') {
        var yn = yesNo(t);
        if (!yn) { if (/[?？؟]\s*$/.test(t)) { ask(t, spoken, function () { if (obActive()) obPrompt(); }); return true; } if (!shown) obUser(t); obSay(tr(OB.sayYesNo)); obButtons(); return true; }
        if (!shown) obUser(t);
        if (yn === 'yes') {
          busy = true;
          obSave({ welcome: 'yes' }).then(function (j) { busy = false; obSay(tr(j.visitor && j.visitor.welcomeStatus === 'sent' ? OB.sent : OB.noted)); obFinish(); });
        } else { obSave({ welcome: 'no' }); obFinish(); }
        return true;
      }
      return false;
    }
    // everything typed or spoken comes here first: "switch to …", "forget me", the welcome questions, then Champ
    function handle(text, spoken, heard) {
      var t = String(text || '').trim(); if (!t || busy) return;
      var sw = /^\s*(?:please\s+)?(?:switch|change|speak|talk)\s+(?:to|into|in)\s+(.+?)\s*[.!]?\s*$/i.exec(t);
      if (sw) {
        obUser(t); var L = langFromText(sw[1]);
        if (!L) { obSay(OB.sorry, 'en'); L = 'en'; }
        if (vis.step === 'lang') { chooseLang(L); return; }
        if (where === 'site' && vis.lang !== L) { vis.lang = L; saveVis(); obSave({ lang: L }); }
        switchLang(L, false, function () { if (obActive()) obPrompt(); else showMenu(); });
        return;
      }
      if (where === 'site' && /^\s*(forget me|delete my (details|data|info(rmation)?)|remove my (details|data))\s*[.!]?\s*$/i.test(t)) {
        obUser(t); obSave({ forget: true }); vis = { id: newId(), step: 'done' }; saveVis(); obSay(T(OB.forgot)); showMenu(); return;
      }
      if (obActive() && obAnswer(t, spoken, heard)) return;
      ask(t, spoken);
    }
    function menuNow() {   // ☰ during the welcome questions: skip the rest
      if (obActive()) { ss('champObPause', '1'); var o = log.querySelector('.cc-obb'); if (o) o.remove(); }   // asked again on the next visit
      showMenu();
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
    var recQuiet = false;
    function startRec(quiet) {
      if (rec && rec.state === 'recording') return;
      recQuiet = !!quiet; wake.pause();
      if (!navigator.mediaDevices || !window.MediaRecorder) { bubble('bot', '<p>' + esc(T(UI.micBlocked)) + '</p>', 'cc-err'); return; }
      stopVoice();
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        recStream = stream; recChunks = [];
        var types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'], mt = types.filter(function (t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
        rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
        rec.onstop = function () { var type = (rec.mimeType || mt || 'audio/webm').split(';')[0]; cleanRec(); send(new Blob(recChunks, { type: type }), type); };
        rec.start(); micState('rec');
        recTimer = setTimeout(stopRec, 15000);   // a question, not a speech (long recordings are slow to hear)
        // stop by itself after a pause: about 1.4 s of quiet once you have started talking
        try {
          var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), an = ctx.createAnalyser(), buf = new Uint8Array(1024), spoke = false, quietSince = 0, t0 = Date.now();
          ctx.createMediaStreamSource(stream).connect(an); an.fftSize = 1024; vad = { ctx: ctx };
          (function tick() {
            if (!vad || !rec || rec.state === 'inactive') return;
            an.getByteTimeDomainData(buf); var sum = 0; for (var i = 0; i < buf.length; i++) { var x = (buf[i] - 128) / 128; sum += x * x; }
            var rms = Math.sqrt(sum / buf.length), now = Date.now();
            if (rms > 0.035) { spoke = true; quietSince = 0; } else if (spoke) { quietSince = quietSince || now; if (now - quietSince > 1400) return stopRec(); }
            if (!spoke && now - t0 > (recQuiet ? 9000 : 8000)) { recNothing = true; return stopRec(); }   // nothing said
            requestAnimationFrame(tick);
          })();
        } catch (e) {}
      }).catch(function () { micState(''); wake.resume(); bubble('bot', '<p>' + esc(T(UI.micBlocked)) + '</p>', 'cc-err'); });
    }
    var recNothing = false;
    function send(blob, type) {
      var quiet = recQuiet, nothing = recNothing; recNothing = false; wake.resume();
      if (nothing && quiet) { micState(''); return; }   // hands-free and nobody spoke: stop listening quietly ("Hey Champ" wakes it again)
      if (!blob.size || blob.size < 1200) { micState(''); if (!quiet) bubble('bot', '<p>' + esc(T(UI.notHeard)) + '</p>', 'cc-err'); return; }
      micState('busy');
      // during the welcome questions Champ knows which language to expect: a name or a phone number is too short for Azure to guess it
      var st = obActive() ? vis.step : '', q;
      if (st && st !== 'lang') q = st === 'email' ? 'en' : (STT_ALL.indexOf(curL()) >= 0 ? curL() : 'en');
      else q = sttAny() ? 'any' : sttLangs().join(',');
      fetch('/.netlify/functions/stt?langs=' + encodeURIComponent(q) + '&prefer=' + encodeURIComponent(STT_ALL.indexOf(curL()) >= 0 ? curL() : 'en'), { method: 'POST', headers: { 'Content-Type': type }, body: blob })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
          if (r.ok && j) return j;
          // no JSON: Netlify cut the function off (about 10 s): Azure was too slow for this recording
          if (!j) throw new Error(r.status === 502 || r.status === 504 ? 'That took too long to hear. Please try a shorter question, or type it.' : 'Voice input is unavailable right now (' + r.status + ').');
          throw new Error((j.error || 'Voice input is unavailable right now.') + (j.reason && !/timeout/i.test(j.reason) ? ' [' + j.reason + ']' : ''));
        }); })
        .then(function (j) {
          micState('');
          if (!j.text) { if (!quiet) bubble('bot', '<p>' + esc(T(UI.notHeard)) + '</p>', 'cc-err'); else listenNext(); return; }
          if (obActive()) { handle(j.text, true, j.lang); return; }   // the welcome questions: no language jumps on a phone number
          if (j.lang && j.lang !== lang) switchLang(j.lang);   // you spoke Tamil: Champ is now in Tamil
          handle(j.text, true, j.lang);
        })
        .catch(function (e) { micState(''); bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err'); });
    }
    // ---- "Hey Champ": the browser's own speech recognition listens for the wake words (Chrome, Edge, Safari) ----
    var wake = (function () {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition, r = null, on = false, paused = false;
      var WORDS = /\b(hey|hi|hello|ok|okay|hay)[\s,.!]*(champ|champs|chomp|champion|camp|shamp|chimp)\b/i;
      function begin() {
        if (!SR || !on || paused || document.hidden || r) return;
        try {
          r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-AU';
          r.onresult = function (e) {
            for (var i = e.resultIndex; i < e.results.length; i++) if (WORDS.test(e.results[i][0].transcript)) { heard(); return; }
          };
          r.onend = function () { r = null; if (on && !paused) setTimeout(begin, 400); };
          r.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') on = false; };
          r.start();
        } catch (e) { r = null; }
      }
      function stop() { if (r) { try { r.onend = null; r.abort(); } catch (e) {} r = null; } }
      function heard() {
        if (audio && !audio.paused) return;   // Champ talking about itself, not you
        stop(); chime();
        if (box.hidden) open(true);
        setTimeout(function () { startRec(true); }, 350);
      }
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else begin(); });
      return { supported: !!SR, start: function () { on = true; paused = false; begin(); }, pause: function () { paused = true; stop(); }, resume: function () { paused = false; setTimeout(begin, 600); } };
    })();
    function chime() {   // a soft two-note "I'm listening"
      try {
        var AC = window.AudioContext || window.webkitAudioContext, c = new AC(), t = c.currentTime;
        [880, 1318.5].forEach(function (f, i) { var o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.3); o.connect(g); g.connect(c.destination); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.35); });
        setTimeout(function () { c.close(); }, 900);
      } catch (e) {}
    }
    // "Hey Champ" works on every page once the microphone has been allowed for this site (even with the chat closed)
    if (where === 'site') {
      if (handsFree()) wake.start();
      else if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: 'microphone' }).then(function (p) { if (p.state === 'granted') { ls('champHandsFree', '1'); wake.start(); } }).catch(function () {});
    }
    mic.onclick = function () {
      if (rec && rec.state === 'recording') return stopRec();
      if (mic.classList.contains('busy')) return;
      if (where === 'site' && !handsFree()) { ls('champHandsFree', '1'); wake.start(); var o = log.querySelector('[data-ob="mic"]'); if (o) o.remove(); }   // you talk to Champ: it keeps listening after each answer
      startRec();
    };
    window.ChampEars = { send: send, langs: sttLangs };

    function open(on) {
      box.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false'); document.body.classList.toggle('cc-open', on);
      if (on) { btn.classList.remove('cc-glow'); ls('champChatSeen', '1'); } else { stopVoice(); if (typeof stopRec === 'function') stopRec(); }
      if (on) {
        if (where === 'site' && vis.step === 'done' && !vis.name && !vis.email && !vis.phone && !ss('champObAsked')) { vis.step = ''; msgs = []; ss('champChat', '[]'); }   // shared nothing last time: greet again on a new visit
        if (where === 'site') ss('champObAsked', '1');
        var fresh = where === 'site' && !vis.step;
        if (fresh) { vis.step = 'lang'; saveVis(); }
        if (where === 'site' && vis.saved && !ss('champVisit')) { ss('champVisit', '1'); obSave({ visit: true }); }
        draw(); setTimeout(function () { ta.focus(); }, 50);
        var picked = ls('champStartLang');
        if (fresh && picked && picked === lang && concrete(lang)) {   // chosen on the intro's start screen: greet in it and go straight to the name
          vis.step = 'form'; vis.lang = lang; saveVis(); obSave({ lang: lang });
          ensure(obStrs(), lang).then(function () { obSay(tr(OB.greetIn) + '\n' + tr(OB.switchTip)); obPrompt(); });
        } else if (fresh || (obActive() && !msgs.some(function (m) { return m.ob; }))) obPrompt();
        if (concrete(lang)) ensure(Object.keys(UI).map(function (k) { return UI[k]; }).concat(MENU.map(function (x) { return x[1]; })).concat(where === 'site' ? obStrs() : []), lang).then(function () { if (!box.hidden) { labels(); var mm = log.querySelector('.cc-menu:not(.cc-obb)'); if (mm && !obActive()) showMenu(); } });
      }
    }
    btn.onclick = function () { open(box.hidden); };
    box.querySelector('.cc-x').onclick = function () { open(false); btn.focus(); };
    box.querySelector('.cc-menubtn').onclick = menuNow;
    box.querySelector('.cc-clear').onclick = function () {
      stopVoice(); msgs = []; ss('champChat', '[]');
      if (where === 'site' && !window.CHAMP_REMEMBER) {   // "New chat" = the next person: start the welcome again
        if (rec && rec.state === 'recording') { recNothing = true; recQuiet = true; stopRec(); }
        vis = { id: newId(), step: 'lang' }; saveVis(); ss('champObPause', ''); try { localStorage.removeItem('champHandsFree'); } catch (e) {} wake.pause();
        if (lang !== 'auto' && lang !== 'en') switchLang('en');
      }
      draw(); if (obActive()) obPrompt();
    };
    sel.onchange = function () { if (obActive() && vis.step === 'lang' && sel.value !== 'auto') { obUser(sel.options[sel.selectedIndex].text); chooseLang(sel.value); } else switchLang(sel.value); };
    window.addEventListener('champ:lang', function (e) { switchLang(e.detail, true); });
    var vb = box.querySelector('.cc-voice');
    vb.onclick = function () { voiceOn = !voiceOn; ls('champVoice', voiceOn ? '1' : '0'); vb.setAttribute('aria-pressed', String(voiceOn)); if (!voiceOn) stopVoice(); };
    box.querySelector('form').onsubmit = function (e) { e.preventDefault(); handle(ta.value); };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handle(ta.value); } });
    ta.addEventListener('input', function () { ta.style.height = ''; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) open(false); });
    window.ChampChat = { open: function () { open(true); }, ask: function (q) { open(true); handle(q); }, visitor: function () { return { id: vis.id, step: vis.step, name: vis.name || '', lang: vis.lang || '' }; }, lang: function (L) { switchLang(L); }, menu: function () { open(true); showMenu(); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
