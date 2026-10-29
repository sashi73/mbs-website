/* Mr. Fixit — the MBS website assistant.
   - Answers most questions instantly from window.MBS_KB (public site info).
   - Unusual questions go to our own server function (/.netlify/functions/chat),
     which holds the AI key in an environment variable. No keys in this file.
   - Collects job details, asks what time suits, then sends them to staff
     by email and Telegram via /.netlify/functions/lead.
   - When it helps, asks for up to 3 photos of the problem. Photos are shrunk
     in the browser and go to the team only (never to the AI). */
(function () {
  'use strict';

  var KB = window.MBS_KB;
  if (!KB) return;
  var API = '/.netlify/functions';
  var STORE = 'mbsFixit.v1';

  /* ================= state ================= */
  // v35: "Start again" bumps gen, so any reply still on its way from an older conversation is dropped.
  var gen = 0, sending = false;
  var S = { open: false, busy: false, log: [], chips: [], flow: null, lead: null, sent: false, greeted: false, mode: null };
  try {
    var saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (saved && Array.isArray(saved.log)) { S = Object.assign(S, saved); S.open = false; S.busy = false; }
  } catch (e) {}
  // Photos for the team (kept apart from the chat so the chat state stays small)
  var PHOTO_STORE = 'mbsFixit.photos';
  var MAX_PHOTOS = 3;
  var PHOTOS = [];
  try { PHOTOS = JSON.parse(sessionStorage.getItem(PHOTO_STORE) || '[]') || []; } catch (e) { PHOTOS = []; }
  function savePhotos() { try { sessionStorage.setItem(PHOTO_STORE, JSON.stringify(PHOTOS)); } catch (e) {} }
  function clearPhotos() { PHOTOS = []; try { sessionStorage.removeItem(PHOTO_STORE); } catch (e) {} }
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ log: S.log, chips: S.chips, flow: S.flow, lead: S.lead, sent: S.sent, greeted: S.greeted, mode: S.mode, lastQ: S.lastQ, tipClosed: S.tipClosed })); } catch (e) {}
  }

  /* ================= Mr. Fixit artwork ================= */
  var svgCount = 0;
  function fixitSVG(cls) {
    var uid = 'fx' + (++svgCount);
    return fixitMarkup(cls, uid);
  }
  function fixitMarkup(cls, uid) {
    return '' +
      '<svg class="' + cls + '" viewBox="0 0 120 120" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="' + uid + 'Body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2D98B"/><stop offset=".55" stop-color="#D4AF37"/><stop offset="1" stop-color="#8A6A1F"/></linearGradient>' +
      '<pattern id="' + uid + 'Bit" width="6" height="8" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)"><rect width="6" height="8" fill="#D9D5CC"/><rect width="2.4" height="8" fill="#8F8B83"/></pattern>' +
      '</defs>' +
      '<g class="fx-all">' +
        '<g class="fx-bit"><rect x="4" y="41" width="28" height="7" rx="2.5" fill="url(#' + uid + 'Bit)" class="fx-bit-fill"/><path d="M2 44.5 L6 41 V48 Z" fill="#B9B5AC"/></g>' +
        '<rect x="28" y="35" width="15" height="19" rx="4" fill="#232323" stroke="#D4AF37" stroke-width="1.5"/>' +
        '<path d="M32 36v17M36 36v17M40 36v17" stroke="#3A3A3A" stroke-width="1.2"/>' +
        '<rect x="66" y="60" width="26" height="36" rx="7" fill="#1A1A1A" stroke="#D4AF37" stroke-width="1.5"/>' +
        '<rect class="fx-trigger" x="60" y="64" width="9" height="14" rx="3.5" fill="#D4AF37"/>' +
        '<rect x="40" y="20" width="72" height="46" rx="15" fill="url(#' + uid + 'Body)"/>' +
        '<rect x="50" y="27" width="54" height="32" rx="9" fill="#0A0A0A"/>' +
        '<rect x="50" y="27" width="54" height="32" rx="9" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/>' +
        '<g class="fx-face">' +
          '<g class="fx-eyes"><ellipse class="fx-eye" cx="66" cy="41" rx="4.2" ry="5.2" fill="#F2D98B"/><ellipse class="fx-eye" cx="88" cy="41" rx="4.2" ry="5.2" fill="#F2D98B"/></g>' +
          '<path class="fx-mouth" d="M70 50 Q77 55.5 84 50" fill="none" stroke="#F2D98B" stroke-width="2.4" stroke-linecap="round"/>' +
        '</g>' +
        '<rect x="58" y="94" width="42" height="19" rx="6" fill="#121212" stroke="#D4AF37" stroke-width="1.5"/>' +
        '<g class="fx-leds"><rect x="65" y="101.5" width="7" height="4" rx="1" fill="#D4AF37"/><rect x="75.5" y="101.5" width="7" height="4" rx="1" fill="#D4AF37"/><rect x="86" y="101.5" width="7" height="4" rx="1" fill="#D4AF37"/></g>' +
      '</g>' +
      '</svg>';
  }

  /* ================= DOM helpers ================= */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* ================= UI ================= */
  // the round button, with "NEED AN ANSWER? · ASK ME!" glowing in a ring around it
  var launcher = el('button', { type: 'button', class: 'fx-launch', 'aria-label': 'Need an answer? Ask Mr. Fixit', 'aria-expanded': 'false',
    html: fixitSVG('fx-art') + '<svg class="fx-ring" viewBox="0 0 160 160" aria-hidden="true" focusable="false"><defs><path id="fxRingPath" d="M80,80 m-64,0 a64,64 0 1,1 128,0 a64,64 0 1,1 -128,0"/></defs><circle class="fx-ring-band" cx="80" cy="80" r="62"/><circle class="fx-ring-rim" cx="80" cy="80" r="75"/><text><textPath href="#fxRingPath" textLength="398" lengthAdjust="spacing">NEED AN ANSWER? · ASK ME! · NEED AN ANSWER? · ASK ME! ·</textPath></text></svg>' });
  var tip = el('div', { class: 'fx-tip', role: 'status' }, [el('b', { text: 'Mr. Fixit' }), 'Need an answer? Ask me!',
    el('button', { type: 'button', class: 'fx-tip-x', 'aria-label': 'Hide this message', text: '×', onclick: function (e) {
      e.stopPropagation(); tip.classList.remove('show'); S.tipClosed = true; save();
    } })]);
  var list = el('div', { class: 'fx-list', 'aria-live': 'polite' });
  var chipsBox = el('div', { class: 'fx-chips' });
  var input = el('textarea', { class: 'fx-input', rows: '1', placeholder: 'Type your question…', 'aria-label': 'Your message to Mr. Fixit', maxlength: '1000' });
  var sendBtn = el('button', { type: 'submit', class: 'fx-send', 'aria-label': 'Send',
    html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' });
  var fileInput = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', class: 'fx-file', tabindex: '-1', 'aria-hidden': 'true' });
  var form = el('form', { class: 'fx-form' }, [input, sendBtn, fileInput]);
  // v35: clear the chat and go back to the main menu (asks first, so a half-finished enquiry isn't lost by accident)
  var restartBtn = el('button', { type: 'button', class: 'fx-restart', title: 'Clear this chat and go back to the main menu',
    html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Start again</span>' });
  var confirmBar = el('div', { class: 'fx-confirm', role: 'alertdialog', 'aria-label': 'Start again?', hidden: 'hidden' }, [
    el('span', { text: 'Clear this chat and start again from the main menu?' }),
    el('button', { type: 'button', class: 'fx-cbtn primary fx-yes', text: 'Yes, start again', onclick: function () { startAgain(); } }),
    el('button', { type: 'button', class: 'fx-cbtn fx-no', text: 'Keep chatting', onclick: function () { askRestart(false); } })
  ]);
  var closeBtn = el('button', { type: 'button', class: 'fx-close', 'aria-label': 'Close chat',
    html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' });

  /* ---- read replies out loud (sound on/off toggle, off by default) ----
     The chat text always stays in English. When another language is picked,
     each reply is translated by our server (DeepSeek) for reading out only. */
  var SYNTH = window.speechSynthesis;
  var VOICE_KEY = 'mbsFixit.voice', LANG_KEY = 'mbsFixit.lang';
  var RATE = 1.15;                                   // speaking speed (1 = normal)
  var LANGS = [
    { code: 'en', short: 'EN', eng: 'English', name: 'English',    tts: /^en[-_](AU|GB|US)|^en/i, bcp: 'en-AU' },
    { code: 'pl', short: 'PL', eng: 'Polish', name: 'Polski',     tts: /^pl/i, bcp: 'pl-PL' },
    { code: 'ta', short: 'TA', eng: 'Tamil', name: 'தமிழ்',       tts: /^ta/i, bcp: 'ta-IN' },
    { code: 'hi', short: 'HI', eng: 'Hindi', name: 'हिन्दी',       tts: /^hi/i, bcp: 'hi-IN' },
    { code: 'zh', short: '中文', eng: 'Chinese', name: '中文 (普通话)', tts: /^(zh|cmn)/i, bcp: 'zh-CN' },
    { code: 'ar', short: 'AR', eng: 'Arabic', name: 'العربية',     tts: /^ar/i, bcp: 'ar-SA' },
    { code: 'vi', short: 'VI', eng: 'Vietnamese', name: 'Tiếng Việt', tts: /^vi/i, bcp: 'vi-VN' },
    { code: 'el', short: 'EL', eng: 'Greek', name: 'Ελληνικά',   tts: /^el/i, bcp: 'el-GR' },
    { code: 'fa', short: 'FA', eng: 'Persian', name: 'فارسی',     tts: /^fa/i, bcp: 'fa-IR' },
    { code: 'ms', short: 'MS', eng: 'Malay', name: 'Bahasa Melayu', tts: /^ms/i, bcp: 'ms-MY' }
  ];
  var voiceOn = false, lang = LANGS[0];
  try {
    voiceOn = localStorage.getItem(VOICE_KEY) === '1';
    var savedLang = localStorage.getItem(LANG_KEY);
    LANGS.forEach(function (l) { if (l.code === savedLang) lang = l; });
  } catch (e) {}
  var ICON_ON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  var ICON_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  var soundBtn = el('button', { type: 'button', class: 'fx-close fx-sound' });
  var langBtn = el('button', { type: 'button', class: 'fx-langbtn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
  var langMenu = el('div', { class: 'fx-langmenu', role: 'listbox', 'aria-label': 'Voice language' });
  var langWrap = el('div', { class: 'fx-lang' }, [langBtn, langMenu]);

  function voiceFor(l) {
    if (!SYNTH) return null;
    var vs = SYNTH.getVoices() || [];
    if (l.code === 'en') {
      // An Aussie voice if the device has one, otherwise British, then any English voice
      var order = [/^en[-_]AU/i, /^en[-_]GB/i, /^en[-_]US/i, /^en/i];
      for (var k = 0; k < order.length; k++) for (var i = 0; i < vs.length; i++) if (order[k].test(vs[i].lang)) return vs[i];
      return null;
    }
    for (var j = 0; j < vs.length; j++) if (l.tts.test(vs[j].lang)) return vs[j];
    return null;
  }
  function speakable(t, l) {
    t = String(t || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
    if (l.code === 'en') t = t.replace(/\bMBS\b/g, 'M B S').replace(/0420 494 990/g, '0 4 2 0, 4 9 4, 9 9 0');
    return t;
  }

  // Translations are fetched in parallel but always spoken in order.
  var cache = {}, queue = Promise.resolve(), gen = 0, missingShown = {};
  function translate(text, l) {
    if (l.code === 'en') return Promise.resolve(text);
    var key = l.code + '|' + text;
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetch(API + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'translate', lang: l.code, text: text }) })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { if (j && j.text) { cache[key] = j.text; return j.text; } return null; })
      .catch(function () { return null; });
  }
  function utter(text, l) {
    var u = new SpeechSynthesisUtterance(text);
    var v = voiceFor(l);
    u.lang = v ? v.lang : l.bcp;
    if (v) { try { u.voice = v; } catch (e) {} }
    u.rate = RATE; u.pitch = 1;
    u.onstart = function () { panel.classList.add('speaking'); };
    u.onend = u.onerror = function () { if (!SYNTH.speaking) panel.classList.remove('speaking'); };
    SYNTH.speak(u);
  }
  function note(text) { S.log.push({ who: 'note', text: text }); save(); render(); }

  // Server voice: DeepSeek translates, Azure Speech reads it out (works on every device).
  // null = not tried yet, true = working, false = not set up (then the device's own voices are used).
  var serverVoice = null, serverReason = '', currentAudio = null;
  function fetchServerAudio(text, l) {
    var key = 'audio|' + l.code + '|' + text;
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetch(API + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: l.code, text: text }) })
      .then(function (r) {
        if (r.ok) return r.blob().then(function (b) { serverVoice = true; return (cache[key] = URL.createObjectURL(b)); });
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 503 || r.status === 404 || r.status === 405) serverVoice = false;   // not set up on this server
          serverReason = j.reason || ('error ' + r.status);
          return null;
        });
      })
      .catch(function () { serverReason = 'the local server could not be reached'; return null; });
  }
  function playServer(url) {
    return new Promise(function (resolve) {
      var a = new Audio(url);
      currentAudio = a;
      a.onplay = function () { panel.classList.add('speaking'); };
      a.onended = a.onerror = a.onpause = function () { if (currentAudio === a) currentAudio = null; panel.classList.remove('speaking'); resolve(); };
      a.play().catch(function () { resolve(); });
    });
  }
  function setupHint() {
    var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (local && serverReason) S.log.push({ who: 'tip', text: 'Setup tip: voices in other languages need AZURE_SPEECH_KEY in .env (' + serverReason + '). See README: READ ALOUD AND LANGUAGES.' });
  }
  function speak(t) {
    if (!voiceOn || !S.open) return;
    var l = lang, my = gen;
    var text = speakable(t, LANGS[0]);
    if (!text) return;
    var deviceHas = SYNTH && voiceFor(l);
    var useServer = serverVoice !== false && (l.code !== 'en' || !deviceHas);
    var job;
    if (useServer) {
      var english = speakable(t, LANGS[0]).replace(/0 4 2 0, 4 9 4, 9 9 0/g, '0420 494 990');
      var pending = fetchServerAudio(english, l);
      job = function () {
        return pending.then(function (url) {
          if (my !== gen || !voiceOn) return;
          if (url) return playServer(url);
          return deviceSpeak(t, l, my);                       // server voice not available: fall back
        });
      };
    } else {
      job = function () { return deviceSpeak(t, l, my); };
    }
    queue = queue.then(job).catch(function () {});
  }
  // The device's own voices (translation text from DeepSeek, then the browser speaks it)
  function deviceSpeak(t, l, my) {
    if (!SYNTH) return;
    if (l.code !== 'en' && !voiceFor(l)) {
      if (!missingShown[l.code]) {
        missingShown[l.code] = true;
        note('Sorry, the ' + l.eng + ' voice isn’t available right now, so I’ll read in English.');
        setupHint(); save(); render();
      }
      l = LANGS[0];
    }
    return translate(speakable(t, l), l).then(function (said) {
      if (my !== gen || !voiceOn) return;
      if (said) utter(said, l); else utter(speakable(t, LANGS[0]), LANGS[0]);
    });
  }
  function stopSpeaking() {
    gen++;
    if (SYNTH) SYNTH.cancel();
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
    queue = Promise.resolve();
    panel.classList.remove('speaking');
  }
  function drawSound() {
    soundBtn.innerHTML = voiceOn ? ICON_ON : ICON_OFF;
    soundBtn.setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
    soundBtn.setAttribute('aria-label', voiceOn ? 'Sound on: Mr. Fixit reads his replies out loud. Turn sound off' : 'Sound off. Turn sound on to hear Mr. Fixit');
    soundBtn.title = voiceOn ? 'Sound on' : 'Sound off';
    soundBtn.classList.toggle('on', voiceOn);
    langBtn.textContent = lang.short;
    langBtn.title = 'Voice language: ' + lang.name;
    langBtn.setAttribute('aria-label', 'Voice language: ' + lang.name + '. Change language');
    langWrap.classList.toggle('on', voiceOn);
    langMenu.innerHTML = '';
    LANGS.forEach(function (l) {
      langMenu.appendChild(el('button', { type: 'button', role: 'option', class: 'fx-langopt' + (l === lang ? ' sel' : ''),
        'aria-selected': l === lang ? 'true' : 'false', lang: l.bcp, text: l.code === 'en' ? 'English' : l.name + '  ·  ' + l.eng, onclick: function () { chooseLang(l); } }));
    });
  }
  function menu(open) {
    langWrap.classList.toggle('open', open);
    langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function chooseLang(l) {
    menu(false);
    stopSpeaking();
    lang = l;
    voiceOn = true;                                          // picking a language means "read it to me"
    try { localStorage.setItem(LANG_KEY, l.code); localStorage.setItem(VOICE_KEY, '1'); } catch (e) {}
    drawSound();
    var canSpeakIt = serverVoice !== false || voiceFor(l);
    speak(l.code === 'en' || !canSpeakIt ? 'Sound on. I’ll read my replies out loud.' : 'Sound on. I’ll read my replies out loud in ' + l.eng + '. The text stays in English.');
    langBtn.focus();
  }
  if (!SYNTH && !window.Audio) { soundBtn.style.display = 'none'; langWrap.style.display = 'none'; }
  else if (SYNTH && SYNTH.onvoiceschanged !== undefined) SYNTH.onvoiceschanged = function () {};   // loads voices in Chrome
  soundBtn.addEventListener('click', function () {
    voiceOn = !voiceOn;
    try { localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0'); } catch (e) {}
    drawSound();
    if (voiceOn) speak('Sound on. I’ll read my replies out loud.');
    else stopSpeaking();
  });
  langBtn.addEventListener('click', function (e) { e.stopPropagation(); menu(!langWrap.classList.contains('open')); });
  langWrap.addEventListener('keydown', function (e) { if (e.key === 'Escape' && langWrap.classList.contains('open')) { e.stopPropagation(); menu(false); langBtn.focus(); } });
  document.addEventListener('click', function (e) { if (!langWrap.contains(e.target)) menu(false); });

  var panel = el('div', { class: 'fx-panel', role: 'dialog', 'aria-label': 'Mr. Fixit, the MBS assistant' }, [
    el('div', { class: 'fx-head' }, [
      el('div', { class: 'fx-head-art', html: fixitSVG('fx-art fx-art-lg') }),
      el('div', { class: 'fx-head-txt' }, [
        el('b', { text: 'Mr. Fixit' }),
        el('small', { text: 'MBS helper · answers in seconds' })
      ]),
      langWrap,
      soundBtn,
      closeBtn
    ]),
    el('div', { class: 'fx-screen' }, [list, chipsBox]),
    confirmBar,
    form,
    el('div', { class: 'fx-foot' }, [restartBtn, el('span', {}, ['Prefer to talk? ', el('a', { href: KB.tel, text: 'Call ' + KB.phone })])])   // v32c: Start again on the left
  ]);

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  function mood(m) {
    panel.classList.remove('thinking', 'listening', 'happy');
    launcher.classList.remove('thinking', 'happy');
    if (m) { panel.classList.add(m); if (m !== 'listening') launcher.classList.add(m); }
  }

  /* ================= rendering ================= */
  function bubble(m) {
    var b = el('div', { class: 'fx-msg ' + (m.who === 'me' ? 'me' : 'bot') });
    String(m.text).split('\n').forEach(function (line, i) {
      if (i) b.appendChild(el('br'));
      // turn the phone number into a tap-to-call link
      var parts = line.split(KB.phone);
      parts.forEach(function (p, j) {
        if (j) b.appendChild(el('a', { href: KB.tel, text: KB.phone }));
        if (p) b.appendChild(document.createTextNode(p));
      });
    });
    return b;
  }

  function summaryCard() {
    var L = S.lead;
    var rows = [['Name', L.name], ['Phone', L.phone], ['Email', L.email], ['Suburb', L.suburb ? L.suburb + (L.postcode ? ' ' + L.postcode : '') : ''],
      ['Job', L.service], ['Details', L.details], ['Urgency', L.urgency], ['Best time to call', L.best_time],
      ['Job scope', (L.scope || []).map(function (x) { return x.q + ' ' + x.a; }).join(' · ')],
      ['Photos', L.photos]]
      .filter(function (r) { return r[1]; });
    var dl = el('dl', { class: 'fx-dl' });
    rows.forEach(function (r) { dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { text: r[1] })); });
    return el('div', { class: 'fx-card' + (S.sent ? ' sent' : '') }, [
      el('b', { class: 'fx-card-title', text: S.sent ? 'Sent to the MBS team ✓' : 'Your job for the MBS team' }),
      dl
    ]);
  }

  function photoBubble(m) {
    var shown = PHOTOS.slice(m.from || 0, m.to || PHOTOS.length);
    var b = el('div', { class: 'fx-msg me fx-photos' });
    if (!shown.length) { b.textContent = '📷 Photo added'; return b; }
    shown.forEach(function (p) { b.appendChild(el('img', { src: p.data, alt: 'Your photo', loading: 'lazy' })); });
    return b;
  }

  // v36: no extra "Main menu" button: the chips are just the ones Mr. Fixit offers (↺ Start again, at the bottom, goes back to the main menu)
  function chipEl(c) {
    return el('button', { type: 'button', class: 'fx-chip' + (c.primary ? ' primary' : ''), text: c.label, onclick: function () { pick(c); } });
  }
  function renderChips() {
    chipsBox.innerHTML = '';
    S.chips.forEach(function (c) { chipsBox.appendChild(chipEl(c)); });
  }
  function render() {
    list.innerHTML = '';
    S.log.forEach(function (m) {
      if (m.who === 'card') { if (S.lead) list.appendChild(summaryCard()); }
      else if (m.who === 'photos') list.appendChild(photoBubble(m));
      else if (m.who === 'projects') { /* project cards were removed in v20e */ }
      else if (m.who === 'note') list.appendChild(el('div', { class: 'fx-setup fx-note', role: 'note', text: m.text }));
      else if (m.who === 'tip') list.appendChild(el('div', { class: 'fx-setup', role: 'note', text: m.text }));
      else list.appendChild(bubble(m));
    });
    if (S.busy) list.appendChild(el('div', { class: 'fx-msg bot fx-typing', 'aria-label': 'Mr. Fixit is typing' }, [el('i'), el('i'), el('i')]));
    chipsBox.innerHTML = '';
    if (!S.busy) S.chips.forEach(function (c) { chipsBox.appendChild(chipEl(c)); });
    restartBtn.disabled = sending;   // never in the middle of sending their details to the team
    requestAnimationFrame(function () { list.scrollTop = list.scrollHeight; });
  }

  /* Bot speaks with a short "thinking" pause so it feels alive */
  function say(lines, chips, done) {
    if (!Array.isArray(lines)) lines = [lines];
    S.busy = true; S.chips = []; mood('thinking'); render();
    var i = 0, g = gen;
    (function next() {
      var t = lines[i];
      var delay = Math.min(1100, 380 + String(t).length * 9);
      setTimeout(function () {
        if (g !== gen) return;   // the customer started again: this belongs to the old chat
        if (t === '__CARD__') S.log.push({ who: 'card' });
        else { S.log.push({ who: 'bot', text: t }); speak(t); }
        i++;
        if (i < lines.length) { render(); next(); return; }
        S.busy = false; S.chips = chips || []; mood(null); save(); render();
        if (done) done();
      }, delay);
    })();
  }

  /* ================= understanding ================= */
  function norm(t) { return ' ' + String(t).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9@+.' ]+/g, ' ').replace(/\s+/g, ' ') + ' '; }
  function has(t, words) { for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) !== -1) return true; return false; }

  function findService(t) {
    var best = null, score = 0;
    KB.services.forEach(function (s) {
      var sc = 0;
      s.keys.forEach(function (k) { if (t.indexOf(k) !== -1) sc += k.length; });
      if (sc > score) { score = sc; best = s; }
    });
    return best;
  }

  var CALL_CHIPS = [{ label: 'Yes, call me', act: 'flow', primary: true }, { label: 'Ask another question', act: 'more' }];
  var EXPERT_CHIPS = [
    { label: 'Yes, send it to the team', act: 'concern', primary: true },
    { label: 'Ask another repair question', act: 'expert_more' },
    { label: 'Main menu', act: 'exit_expert' }
  ];
  var START_CHIPS = [
    { label: 'Ask a repair question', act: 'expert' },
    { label: 'I have a leak', act: 'text' }, { label: 'Something else is broken', act: 'text' },
    { label: 'Get a free quote', act: 'flow', primary: true },
    { label: 'What do you do?', act: 'text' }, { label: 'How much does it cost?', act: 'text' }
  ];
  var PROBLEM_CHIPS = ['I have a leak', 'Electrical problem', 'Cracks in walls', 'Storm damage',
    'Rotten or loose deck', 'Door or window sticking', 'Hole in a wall or ceiling']
    .map(function (l) { return { label: l, act: 'text' }; })
    .concat([{ label: 'Something else', act: 'flow', primary: true }]);

  function servicesText() {
    var groups = {};
    KB.services.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s.name); });
    return Object.keys(groups).map(function (g) { return g + ': ' + groups[g].join(', ') + '.'; }).join('\n');
  }

  // Returns {lines, chips, startFlow?: {service, urgency}} or null if not understood
  function answer(raw) {
    var t = norm(raw);

    if (has(t, [' past project', ' previous project', ' projects', ' portfolio', ' your work', ' previous work', ' past work',
                ' jobs you', ' work you have done', ' what have you done', ' case stud'])) {
      return { lines: ['You can see photos of our work on the Projects page (in the menu at the top).', 'Would you like a free quote for your own job?'],
        chips: [{ label: 'Get a free quote', act: 'flow', primary: true }, { label: 'Main menu', act: 'more' }] };
    }

    if (has(t, [' emergenc', ' urgent', ' flooding', ' flooded', ' burst', ' collaps', ' sagging', ' dangerous', ' water pouring', ' right now', ' asap '])) {
      return { lines: ['If it’s an emergency, call ' + KB.phone + ' now. If anyone is in danger, call 000.', 'I can also send your details to the team straight away so they call you.'],
        chips: [{ label: 'Send my details now', act: 'flow', urgency: 'Emergency', primary: true }, { label: 'Ask another question', act: 'more' }] };
    }
    /* ---- common problems ---- */
    if (has(t, [' electric', ' power point', ' powerpoint', ' socket', ' spark', ' tripping', ' trips ', ' keeps tripping', ' circuit breaker', ' safety switch', ' no power', ' power out', ' power is out', ' flicker', ' wiring', ' electric shock', ' got a shock', ' burning smell', ' fuse'])) {
      return { lines: [
          'Safety first with anything electrical: if you see sparks, smell burning or got a shock, switch the power off at the switchboard if it’s safe to do so, and call 000 if there’s smoke or fire.',
          'Electrical work must be done by a licensed electrician. If it’s part of a repair or renovation, our team can talk it through and let you know how we can help.'],
        chips: [{ label: 'Get the team to call me', act: 'flow', service: 'Electrical issue', ask: 'What’s happening with the electrics, and where in the home?', primary: true },
                { label: 'Ask another question', act: 'more' }] };
    }
    if (has(t, [' storm', ' hail', ' wind damage', ' tree fell', ' fallen tree', ' tree came down', ' blown off', ' blew off', ' fence down', ' fence fell', ' fence blew'])) {
      return { lines: [
          'Sorry about the storm damage. If there’s any danger, like fallen power lines or something unstable, stay well clear and call 000. For emergency storm help, the NSW SES is on 132 500.',
          'Once it’s safe, we repair roofs, gutters, fences, decks and water damage inside the home. Want the team to call you?'],
        chips: [{ label: 'Yes, call me', act: 'flow', service: 'Storm damage repair', ask: 'What was damaged? (For example: roof tiles, gutters, fence, ceiling inside)', primary: true },
                { label: 'Ask another question', act: 'more' }] };
    }
    if (has(t, [' rotten', ' rotting', ' spongy', ' soft spot', ' loose railing', ' wobbly', ' loose balustrade', ' balustrade', ' termite', ' loose step', ' loose stairs', ' deck is loose'])) {
      var termite = has(t, [' termite']) ? ' If you think termites are the cause, get a pest inspection first, then we can repair the damage.' : '';
      return { lines: [
          'A spongy or rotten deck, loose steps or a wobbly railing can give way, so please keep off that area until it’s checked.' + termite,
          'We repair and rebuild decks, stairs and balustrades. Want the team to take a look?'],
        chips: [{ label: 'Yes, call me', act: 'flow', service: 'Deck, stair or railing repair', ask: 'Which part is rotten or loose (boards, steps, railing), and roughly how big is the area?', primary: true },
                { label: 'Ask another question', act: 'more' }] };
    }
    if (has(t, [' crack', ' cracking', ' cracked wall', ' concrete cancer', ' spalling', ' rust stain', ' cracks']) && !has(t, [' glass', ' window', ' windscreen'])) {
      return { lines: [
          'Cracks are worth checking early. Fine hairline cracks are often cosmetic, but cracks that keep growing, or doors and windows that start sticking nearby, can be a sign of movement or concrete cancer.',
          'Our team can inspect it and tell you what it needs. Is the crack getting bigger?'],
        chips: [{ label: 'Yes, it’s getting bigger', act: 'flow', service: 'Crack repair', urgency: 'This week', ask: 'Where is the crack (inside wall, outside, ceiling, concrete or balcony), and roughly how long and wide is it?', primary: true },
                { label: 'Not sure, or it’s small', act: 'flow', service: 'Crack repair', ask: 'Where is the crack (inside wall, outside, ceiling, concrete or balcony), and roughly how long and wide is it?' },
                { label: 'Ask another question', act: 'more' }] };
    }
    if (has(t, [' sticking', ' sticks', ' jammed', " won't close", ' wont close', " doesn't close", ' doesnt close', " won't lock", ' wont lock', ' hard to open', ' hard to close', ' draught', ' drafty', ' broken window', ' broken glass', ' cracked glass', ' door stuck', ' window stuck'])) {
      return { lines: [
          'Doors and windows that stick or won’t close properly are common, usually from swelling, worn hardware or the house moving a little.',
          'We adjust, repair and replace doors and windows. Want the team to call you?'],
        chips: [{ label: 'Yes, call me', act: 'flow', service: 'Door or window repair', ask: 'Which door or window is it, and what’s happening? (For example: sticking, won’t lock, broken glass)', primary: true },
                { label: 'Ask another question', act: 'more' }] };
    }
    if (has(t, [' hole in', ' holes in', ' dent in', ' damaged wall', ' damaged ceiling', ' ceiling damage', ' wall damage', ' bubbling paint', ' peeling paint', ' cornice', ' plaster is'])) {
      return { lines: [
          'We patch and replace damaged plasterboard (gyprock), then paint so the repair blends in.',
          'If a ceiling is sagging or bulging, stay out from under it and call ' + KB.phone + ' straight away. Otherwise, want the team to call you?'],
        chips: [{ label: 'Yes, call me', act: 'flow', service: 'Wall or ceiling repair', ask: 'Where is the damage, and roughly how big is it? Is there any water staining?', primary: true },
                { label: 'Ask another question', act: 'more' }] };
    }

    if (has(t, [' leak', ' leaking', ' drip', ' water coming', ' water stain', ' damp', ' mould', ' mold', ' water damage', ' wet patch'])) {
      return { lines: ['Sorry to hear about the leak. We find exactly where the water is getting in with water leak testing, fix roof leaks, and redo waterproofing in bathrooms and balconies.', 'Is water coming in right now?'],
        chips: [{ label: 'Yes, right now', act: 'flow', service: 'Leak', urgency: 'Emergency', primary: true },
                { label: 'No, but it keeps happening', act: 'flow', service: 'Leak' }] };
    }
    if (has(t, [' price', ' cost', ' how much', ' expensive', ' cheap', ' rate', ' rates', ' charge', ' estimate', ' ballpark', ' budget', ' fee'])) {
      return { lines: ['Every job is different, so we don’t guess prices online. We come out, look at the job and give you a clear quote for free, with no obligation.', 'Want me to get someone to call you to book that?'], chips: CALL_CHIPS };
    }
    if (has(t, [' quote', ' book', ' booking', ' appointment', ' come out', ' come and', ' inspect', ' site visit', ' call me', ' ring me', ' contact me', ' call back', ' callback', ' someone to call'])) {
      var qs = findService(t);
      // "Can I get a quote to paint my house?" -> the job is already described, go straight to the questions
      if (qs || t.trim().split(' ').length >= 6) return { lines: [], startFlow: { service: qs ? qs.name : '', details: String(raw).trim().slice(0, 600) } };
      return { lines: [], startFlow: {} };
    }
    if (has(t, [' are you a robot', ' are you real', ' are you human', ' are you ai', ' bot', ' who are you', ' your name'])) {
      return { lines: ['I’m Mr. Fixit, the MBS website helper (an AI assistant). I answer questions and pass your job to our team, and a real person calls you back.'], chips: CALL_CHIPS };
    }
    if (has(t, [' licen', ' qualified', ' certified', ' registered', ' legit'])) {
      return { lines: ['Yes. Modern Building Solutions is a licensed builder, licence number ' + KB.licence + '.'], chips: CALL_CHIPS };
    }
    if (has(t, [' insur'])) {
      return { lines: ['The team can share insurance details with your quote. MBS is a licensed builder, licence ' + KB.licence + '.'], chips: CALL_CHIPS };
    }
    if (has(t, [' warrant', ' guarantee'])) {
      return { lines: ['We check every detail with you before we finish. The team will confirm the warranty for your job in your quote.'], chips: CALL_CHIPS };
    }
    if (has(t, [' suburb', ' area', ' do you come', ' come to', ' service my', ' travel', ' location', ' where are you', ' near me', ' local'])) {
      var a = KB.area ? 'We work across ' + KB.area + '. ' : '';
      return { lines: [a + 'Tell me your suburb and I’ll get the team to confirm and call you.'], chips: CALL_CHIPS };
    }
    if (has(t, [' hours', ' open', ' weekend', ' saturday', ' sunday', ' what time', ' when are you'])) {
      var h = KB.hours ? 'We work ' + KB.hours + '. ' : '';
      return { lines: [h + 'You can call ' + KB.phone + ', or leave your details here and the team will call you at a time that suits you.'], chips: CALL_CHIPS };
    }
    if (has(t, [' phone', ' number', ' email', ' contact', ' reach you', ' get in touch'])) {
      return { lines: ['Call ' + KB.phone + ' or email ' + KB.email + '.', 'Or I can get one of the team to call you.'], chips: CALL_CHIPS };
    }
    if (has(t, [' how does it work', ' process', ' steps', ' what happens', ' how do i start', ' how it works'])) {
      return { lines: ['Here’s how it works:\n' + KB.process.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n')], chips: CALL_CHIPS };
    }
    if (has(t, [' what do you do', ' services', ' service ', ' offer', ' what can you', ' list', ' do you do ', ' help with', ' what work'])) {
      var svc = findService(t);
      if (!svc) return { lines: ['Here’s everything we do:', servicesText(), 'And everything else needed to keep your home in good condition. What’s your job?'], chips: CALL_CHIPS };
    }
    var s = findService(t);
    // "I want to paint my entire house" -> treat it as a quote request
    if (s && has(t, [' i want', ' i need', ' need to', ' want to', ' looking to', ' like to', ' get my', ' need my', ' wanting to', ' planning to', ' thinking of', ' thinking about'])) {
      return { lines: [], startFlow: { service: s.name, details: String(raw).trim().slice(0, 600) } };
    }
    if (s) {
      return { lines: [s.name + '? Yes, we do that. ' + s.desc, 'Want me to get one of the team to call you about it?'],
        chips: [{ label: 'Yes, call me', act: 'flow', service: s.name, primary: true }, { label: 'Ask another question', act: 'more' }] };
    }
    if (has(t, [' something else is broken', ' broken', ' broke ', ' problem', ' issue', ' fix ', ' fixing', ' repair', ' damaged', ' not working', ' fault'])) {
      return { lines: ['No worries, we fix most things around the home. What kind of problem is it?'], chips: PROBLEM_CHIPS };
    }
    if (has(t, [' thank', ' cheers', ' legend', ' awesome', ' great '])) {
      return { lines: ['No worries! Anything else I can help with?'], chips: START_CHIPS };
    }
    if (has(t, [' hi ', ' hello', ' hey ', " g'day", ' gday', ' morning', ' afternoon'])) {
      return { lines: ['G’day! What can I help you fix today?'], chips: START_CHIPS };
    }
    if (has(t, [' bye', ' see ya', ' that is all', " that's all", ' nothing else'])) {
      return { lines: ['Thanks for stopping by! Call ' + KB.phone + ' any time.'], chips: [] };
    }
    return null;
  }

  /* ================= collecting the job ================= */
  var STEPS = ['details', 'suburb', 'urgency', 'name', 'phone', 'email', 'time', 'confirm'];
  var URGENCY_CHIPS = ['Emergency', 'This week', 'This month', 'Flexible'].map(function (u) { return { label: u, act: 'answer' }; });

  // "Best time to call" choices that still make sense right now (Sydney time).
  //   before 7am: Urgent, This morning, This afternoon, This evening, Anytime
  //   7-11am:  Right now, (Later) this morning, This afternoon, This evening, Tomorrow morning, Anytime
  //   11am-4pm: Right now, (Later) this afternoon, This evening, Tomorrow morning, Tomorrow afternoon, Anytime
  //   4-7:30pm: Right now, This evening, Tomorrow morning, Tomorrow afternoon, Tomorrow after 5pm, Anytime
  //   after 7:30pm: Tomorrow morning, Tomorrow afternoon, Tomorrow after 5pm, Urgent - call now
  function callTimeChoices(now) {
    var h = 12, m = 0;
    try {
      var f = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now || new Date());
      f.forEach(function (p) { if (p.type === 'hour') h = +p.value % 24; if (p.type === 'minute') m = +p.value; });
    } catch (e) { var d = now || new Date(); h = d.getHours(); m = d.getMinutes(); }
    var t = h * 60 + m;
    if (t < 7 * 60) return ['Urgent – call now', 'This morning', 'This afternoon', 'This evening', 'Anytime'];
    if (t < 11 * 60) return ['Right now', t >= 9 * 60 ? 'Later this morning' : 'This morning', 'This afternoon', 'This evening', 'Tomorrow morning', 'Anytime'];
    if (t < 16 * 60) return ['Right now', t >= 14 * 60 ? 'Later this afternoon' : 'This afternoon', 'This evening', 'Tomorrow morning', 'Tomorrow afternoon', 'Anytime'];
    if (t < 19 * 60 + 30) return ['Right now', 'This evening', 'Tomorrow morning', 'Tomorrow afternoon', 'Tomorrow after 5pm', 'Anytime'];
    return ['Tomorrow morning', 'Tomorrow afternoon', 'Tomorrow after 5pm', 'Urgent – call now'];
  }
  function timeChips() { return callTimeChoices().map(function (u) { return { label: u, act: 'answer' }; }); }

  /* ---- suburb suggestions: type 3 letters (or a postcode) and pick "Box Hill 2765" ---- */
  var SUBURB_URL = (function () {
    var src = (document.currentScript && document.currentScript.src) || '';
    return src ? src.replace(/fixit\.js(\?.*)?$/, 'suburbs-sydney.json') : 'assets/suburbs-sydney.json';
  })();
  var SUBURBS = null, suburbsLoading = null, autoPickTimer = null;
  function loadSuburbs() {
    if (SUBURBS || suburbsLoading) return suburbsLoading;
    suburbsLoading = fetch(SUBURB_URL).then(function (r) { return r.json(); })
      .then(function (j) { SUBURBS = (j && j.suburbs) || []; return SUBURBS; })
      .catch(function () { SUBURBS = []; return SUBURBS; });
    return suburbsLoading;
  }
  function matchSuburbs(q, max) {
    q = String(q || '').toLowerCase().replace(/\s+nsw\b/, '').replace(/\s+/g, ' ').trim();
    if (!SUBURBS || q.length < 3) return [];
    var pc = (q.match(/\b(2\d{0,3})$/) || [])[1];
    var words = pc ? q.replace(pc, '').trim() : q;
    var a = [], b = [], c = [];
    SUBURBS.forEach(function (s) {
      var n = s[0].toLowerCase();
      if (pc && s[1].indexOf(pc) !== 0) return;
      if (!words) { a.push(s); return; }
      if (n.indexOf(words) === 0) a.push(s);
      else if ((' ' + n).indexOf(' ' + words) !== -1) b.push(s);
      else if (n.indexOf(words) !== -1) c.push(s);
    });
    return a.concat(b, c).slice(0, max || 6);
  }
  function suburbChips(q, list) {
    return (list || matchSuburbs(q)).map(function (s, i) { return { label: s[0] + ' ' + s[1], act: 'suburb_pick', sub: s, primary: i === 0 }; });
  }
  function askSuburb() {
    S.flow.step = 'suburb'; save();
    loadSuburbs();
    input.placeholder = 'Start typing your suburb, e.g. Box Hill';
    return say('Which suburb is the property in? Type the first 3 letters and I’ll find it.', []);
  }
  // after the suburb: the quote asks urgency next, the repair question goes to the phone number
  function afterSuburb() {
    var d = S.flow.data;
    if (S.flow.type === 'concern') {
      S.flow.step = 'phone'; save();
      return say('Great. What’s the best phone number to reach you, ' + firstName(d) + '?', []);
    }
    return ask(d.urgency ? 'name' : 'urgency');
  }
  function suburbInput(d, t) {
    var all = matchSuburbs(t, 12), lower = t.toLowerCase().replace(/\s+nsw\b/, '').replace(/\s+/g, ' ').trim();
    var exact = all.filter(function (x) { var n = x[0].toLowerCase(); return n === lower || n + ' ' + x[1] === lower || x[1] === lower; });
    if (exact.length === 1) { setSuburb(d, exact[0]); return afterSuburb(); }
    if (exact.length > 1) return say('Which one is it?', suburbChips('', exact));
    if (all.length === 1) { setSuburb(d, all[0]); return afterSuburb(); }
    if (all.length > 1) return say('Which one is it?', suburbChips('', all.slice(0, 6)));
    // not in our list (or the list didn't load): keep what they typed
    d.suburb = t.replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 60);
    var pcm = t.match(/\b(2\d{3})\b/); if (pcm) d.postcode = pcm[1];
    input.placeholder = 'Type your question…';
    return afterSuburb();
  }
  function setSuburb(d, s) {
    d.suburb = s[0]; d.postcode = s[1]; d.lat = s[2]; d.lng = s[3];
    input.placeholder = 'Type your question…';
  }

  /* ---- name and service area: asked first, before any job details go to the team ---- */
  var AREA_CHIPS = [{ label: 'Yes', act: 'answer', primary: true }, { label: 'No', act: 'answer' }];
  function cleanName(t) {
    return t.replace(/^(hi|hello|hey)[,!.\s]+/i, '').replace(/^(i'?m|i am|my name is|my name'?s|it'?s|this is|name is)\s+/i, '')
      .replace(/[.!]+$/, '').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 60);
  }
  function firstName(d) { return d && d.name ? d.name.split(' ')[0] : ''; }
  function askArea(d) {
    return say('Thanks ' + firstName(d) + '! Is the property in Sydney or one of the nearby suburbs?', AREA_CHIPS);
  }
  // Yes -> true, No -> false, anything else -> null (ask again)
  function areaAnswer(t) {
    if (/^(y|yes|yeah|yep|yup|sure|correct|it is|i am|we are)\b/i.test(t) || /\bsydney\b/i.test(t) && !/\b(not|no|outside)\b/i.test(t)) return true;
    if (/^(n|no|nope|nah|not)\b/i.test(t) || /\b(outside|not in|interstate)\b/i.test(t)) return false;
    return null;
  }
  function outOfArea(d, emergency) {
    var name = firstName(d);
    S.flow = null; clearPhotos(); save();
    var lines = ['I’m really sorry' + (name ? ', ' + name : '') + '. We currently only work in Sydney and the surrounding suburbs, so we’re not able to help with this job. Please accept our apologies, and thank you for thinking of Modern Building Solutions.'];
    if (emergency) lines.push('If anyone is in danger, or there’s a gas smell, smoke or fire, please call 000 now.');
    lines.push('Is there anything else I can help you with?');
    return say(lines, START_CHIPS);
  }

  function startFlow(opts) {
    opts = opts || {};
    S.sent = false;
    S.lead = null;
    S.flow = { step: 'details', data: { service: opts.service || '', urgency: opts.urgency || '', name: opts.name || '', inArea: !!opts.inArea } };
    S.flow.opts = { details: opts.details || '', ask: opts.ask || '' };
    if (!S.flow.data.name) {
      S.flow.step = 'who'; save();
      return say(['Great, let’s get this to the team. It only takes a minute.', 'First, what’s your name?'], []);
    }
    if (!S.flow.data.inArea) { S.flow.step = 'area'; save(); return askArea(S.flow.data); }
    return startJob();
  }
  function startJob() {
    var opts = S.flow.opts || {};
    S.flow.step = 'details';
    if (opts.details) {
      // The customer already told us the job: go straight to the quote questions
      S.flow.data.details = opts.details;
      return say(['Great, let’s get you a free quote. It only takes a minute.'], [],
        function () { if (S.flow.data.urgency !== 'Emergency') startScope(); else afterDetails(); });
    }
    var q = opts.ask || (S.flow.data.service === 'Leak'
      ? 'Where is the leak, and when does it happen? (For example: ceiling in the lounge, after heavy rain)'
      : 'Tell me a bit about the job: what needs doing and where in the home?');
    say(['Great, ' + firstName(S.flow.data) + ', you’re in our area.', q], []);
  }

  function ask(step) {
    var d = S.flow.data;
    S.flow.step = step;
    switch (step) {
      case 'suburb':  return askSuburb();
      case 'urgency': return say('How soon do you need it done?', URGENCY_CHIPS);
      case 'name':    if (d.name) return ask('phone'); return say('Thanks. What’s your name?', []);
      case 'who':     return say('What’s your name?', []);
      case 'area':    return askArea(d);
      case 'phone':   return say('And the best phone number for the team to call, ' + d.name.split(' ')[0] + '?', []);
      case 'email':   return say('Would you like a copy by email? Type your email, or skip.', [{ label: 'Skip', act: 'answer' }]);
      case 'time':
        return say(['Thanks ' + d.name.split(' ')[0] + '! When’s the best time for one of our team to call you?'], timeChips());
      case 'confirm':
        S.lead = buildLead();
        return say(['Here’s what I’ll send to the team:', '__CARD__', 'All correct?'],
          [{ label: 'Yes, send it', act: 'send', primary: true }, { label: 'Start again', act: 'restart' }]);
    }
  }

  /* ---- quote questions: DeepSeek asks up to 5 smart questions, like an estimator ---- */
  var SCOPE_MAX = 5;
  function startScope() {
    S.flow.data.scope = [];
    S.flow.step = 'scope';
    S.flow.scopeIntro = true;
    save();
    askScope();
  }
  function askScope() {
    var d = S.flow.data, g = gen;
    S.busy = true; S.chips = []; mood('thinking'); render();
    fetch(API + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'scope', job: (d.service ? d.service + ': ' : '') + (d.details || ''), qa: d.scope || [] }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok ? j : { done: true, failed: true, status: r.status, reason: j.reason || j.error }; }); })
      .catch(function () { return { done: true, failed: true, status: 0 }; })
      .then(function (j) {
        if (g !== gen) return;
        S.busy = false;
        if (!S.flow || S.flow.step !== 'scope') return render();
        if (j.failed) {
          // Never blocks the customer: the quote questions are skipped. On your own computer, say why.
          var tip = setupTip({ status: j.status, reasons: j.reason ? { ai: j.reason } : null });
          if (tip) S.log.push({ who: 'tip', text: tip.replace('Setup tip:', 'Setup tip (quote questions skipped):') });
        }
        if (j.done || !j.question) return scopeDone();
        S.flow.pendingQ = j.question;
        var n = (d.scope || []).length + 1;
        var chips = (j.options || []).map(function (o) { return { label: o, act: 'answer' }; });
        chips.push({ label: 'Skip questions', act: 'scope_skip' });
        var lines = [];
        if (S.flow.scopeIntro) { S.flow.scopeIntro = false; lines.push('Thanks! A few quick questions so the team can give you an accurate quote.'); }
        lines.push(j.question);
        save();
        say(lines, chips);
      });
  }
  function scopeDone() {
    if (!S.flow) return;
    S.flow.pendingQ = null;
    var had = (S.flow.data.scope || []).length;
    if (had) S.log.push({ who: 'bot', text: 'Perfect, that gives the team a clear picture.' });
    return afterDetails();
  }
  function afterDetails() {
    var d = S.flow.data;
    if (photoWorthy(d.service + ' ' + d.details) && PHOTOS.length < MAX_PHOTOS) return askPhotos('suburb');
    return ask('suburb');
  }

  /* ---- photos: only asked when a picture would help the team ---- */
  var PHOTO_WORTHY = /leak|drip|water|damp|mou?ld|stain|crack|storm|hail|tree|damage|broke|rot|termite|hole|dent|door|window|glass|stick|jam|paint|peel|bubbl|flak|til|grout|roof|gutter|downpipe|deck|fence|pergola|stair|step|rail|wall|ceiling|floor|sag|render|concrete|plaster|gyprock|rust|repair|fix|replace|loose|lift/i;
  function photoWorthy(text) { return PHOTO_WORTHY.test(String(text || '')); }

  function askPhotos(after) {
    S.flow.photoNext = after;
    S.flow.step = 'photos';
    save();
    return say(['If you have a photo of the problem, it helps our team see it before they come out (up to ' + MAX_PHOTOS + '). It’s optional: no photo is fine too.'],
      [{ label: '📷 Add a photo', act: 'photo_add' }, { label: 'No photo, continue', act: 'photo_done', primary: true }]);
  }

  function photoChips() {
    var c = [];
    if (PHOTOS.length < MAX_PHOTOS) c.push({ label: '📷 Add ' + (PHOTOS.length ? 'another' : 'a photo'), act: 'photo_add', primary: !PHOTOS.length });
    c.push({ label: PHOTOS.length ? 'Done, continue' : 'No photo, continue', act: 'photo_done', primary: !!PHOTOS.length });
    return c;
  }

  function photoDone() {
    var next = S.flow && S.flow.photoNext;
    if (!next) return;
    S.flow.photoNext = null;
    if (S.flow.type === 'concern') { S.flow.step = next; return say('And your email address?', [{ label: 'Skip', act: 'answer' }]); }
    return ask(next);
  }

  // Shrink a photo in the browser (max 1600px, JPEG) so it sends quickly from a phone
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type)) return resolve(null);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ name: String(file.name || 'photo').slice(0, 80), data: c.toDataURL('image/jpeg', 0.82) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileInput.files || [], 0, MAX_PHOTOS - PHOTOS.length);
    fileInput.value = '';
    if (!files.length || !S.flow || S.flow.step !== 'photos') return;
    S.busy = true; S.chips = []; mood('thinking'); render();
    Promise.all(files.map(shrink)).then(function (out) {
      var good = out.filter(Boolean);
      var from = PHOTOS.length;
      PHOTOS = PHOTOS.concat(good).slice(0, MAX_PHOTOS);
      savePhotos();
      S.busy = false;
      if (!good.length) return say('Sorry, I couldn’t open that one. Please try a JPG or PNG photo.', photoChips());
      S.log.push({ who: 'photos', from: from, to: PHOTOS.length }); save();
      say(PHOTOS.length >= MAX_PHOTOS
        ? 'Thanks, that’s ' + MAX_PHOTOS + ' photos. The team will see them with your message.'
        : 'Got it, ' + PHOTOS.length + ' photo' + (PHOTOS.length > 1 ? 's' : '') + ' added. Add another, or carry on?', photoChips());
    });
  });

  function photoPayload() { return PHOTOS.map(function (p) { return { name: p.name, data: p.data }; }); }

  function phoneOk(p) {
    var d = p.replace(/[^\d+]/g, '').replace(/^\+61/, '0').replace(/^61(?=[2-478]\d{8}$)/, '0');
    if (!/^0[2-478]\d{8}$/.test(d)) return null;
    return /^04/.test(d) ? d.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : d.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3');
  }

  function buildLead() {
    var d = S.flow.data;
    var job = d.service === 'Leak' ? 'Leak repair' : (d.service || 'General enquiry');
    var parts = [d.name + (d.suburb ? ' in ' + d.suburb + (d.postcode ? ' ' + d.postcode : '') : '') + ' needs help with ' + (d.service ? job.toLowerCase() : 'a job') + '.'];
    if (d.details) parts.push('Details: ' + d.details.replace(/\s*$/, '') + (/[.!?]$/.test(d.details.trim()) ? '' : '.'));
    if (d.urgency) parts.push('Urgency: ' + d.urgency + '.');
    if (d.best_time) parts.push('Best time to call: ' + d.best_time + '.');
    return { name: d.name, phone: d.phone, email: d.email || '', suburb: d.suburb, postcode: d.postcode || '',
      lat: d.lat === undefined ? '' : d.lat, lng: d.lng === undefined ? '' : d.lng, service: job,
      details: d.details, urgency: d.urgency || '', best_time: d.best_time || '', summary: parts.join(' '),
      photos: PHOTOS.length ? PHOTOS.length + ' attached' : '', scope: d.scope || [] };
  }

  /* ---- "Send my question to the team" (after an Ask Mr. Fixit answer) ---- */
  function startConcern() {
    S.sent = false; S.lead = null;
    S.flow = { type: 'concern', step: 'name', data: { question: S.lastQ || '' } };
    save();
    say(['Happy to. I just need a few details so the team can get back to you.', 'What’s your name?'], []);
  }

  function concernInput(t) {
    var d = S.flow.data, step = S.flow.step;
    switch (step) {
      case 'name':
        d.name = cleanName(t);
        if (!d.name) return say('What’s your name?', []);
        S.flow.step = 'area'; save();
        return askArea(d);
      case 'area':
        var inSyd = areaAnswer(t);
        if (inSyd === false) return outOfArea(d, false);
        if (inSyd === null) return say('Sorry, I didn’t catch that. Is the property in Sydney or a nearby suburb? Just tap Yes or No.', AREA_CHIPS);
        d.inArea = true;
        return askSuburb();
      case 'suburb':
        return suburbInput(d, t);
      case 'phone':
        var p = phoneOk(t);
        if (!p) return say('Hmm, that doesn’t look like an Australian number. Could you check it? For example 0412 345 678.', []);
        d.phone = p;
        S.flow.step = 'time'; save();
        return say('Thanks ' + firstName(d) + '! When’s the best time for one of our team to call you?', timeChips());
      case 'time':
        d.best_time = t.slice(0, 60);
        if (photoWorthy(d.question) && PHOTOS.length < MAX_PHOTOS) return askPhotos('email');
        S.flow.step = 'email'; save();
        return say('And your email address?', [{ label: 'Skip', act: 'answer' }]);
      case 'photos':
        if (/^(no|nah|nope|skip|done|continue|no thanks|that'?s it)/i.test(t)) return photoDone();
        return say('Tap “Add a photo” to choose one, or carry on without one.', photoChips());
      case 'email':
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
          d.email = t.toLowerCase(); S.flow.step = 'copy';
          return say('Would you like a copy of this conversation sent to ' + d.email + '?',
            [{ label: 'Yes, email me a copy', act: 'answer', primary: true }, { label: 'No thanks', act: 'answer' }]);
        }
        if (/^(skip|no|nah|none|no thanks|nope)\.?$/i.test(t)) { d.email = ''; d.copy = false; return sendConcern(); }
        return say('That email doesn’t look quite right. Try again, or tap Skip.', [{ label: 'Skip', act: 'answer' }]);
      case 'copy':
        d.copy = /^y/i.test(t);
        return sendConcern();
    }
  }

  function sendConcern() {
    var d = S.flow.data;
    var q = d.question ? '“' + d.question + '”' : 'a repair question';
    S.lead = { name: d.name, phone: d.phone, email: d.email || '', suburb: d.suburb || '', postcode: d.postcode || '',
      lat: d.lat === undefined ? '' : d.lat, lng: d.lng === undefined ? '' : d.lng, service: 'Repair question (Ask Mr. Fixit)',
      details: d.question || '', urgency: '', best_time: d.best_time || '',
      summary: d.name + (d.suburb ? ' in ' + d.suburb + (d.postcode ? ' ' + d.postcode : '') : '') + ' asked Mr. Fixit ' + q + ' and would like the team to follow up.' + (d.best_time ? ' Best time to call: ' + d.best_time + '.' : '') + (d.copy ? ' Customer asked for a copy of the conversation.' : '') };
    S.busy = true; S.chips = []; mood('thinking'); render();
    var info = { status: 0, reasons: null, saved: false };
    sending = true;
    fetch(API + '/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead: S.lead, channels: ['email', 'telegram'], source: 'chat', send_copy: !!d.copy, photos: photoPayload(),
        transcript: S.log.filter(function (m) { return m.who === 'me' || m.who === 'bot'; }).map(function (m) { return { role: m.who === 'me' ? 'user' : 'assistant', content: m.text }; }) })
    }).then(function (r) {
        info.status = r.status;
        return r.json().catch(function () { return {}; }).then(function (j) {
          info.reasons = j.reasons || null; info.saved = !!j.saved; info.prejob = j.prejob_no || '';
          return { ok: r.ok && j.ok, reasons: j.reasons || {} };
        });
      })
      .then(function (res) {
        S.busy = false; sending = false;
        if (!res.ok) throw new Error('send');
        var nPhotos = PHOTOS.length;
        S.sent = true; S.flow = null; S.mode = null; mood('happy'); clearPhotos();
        var first = d.name.split(' ')[0];
        var copyLine = d.copy
          ? (res.reasons.customer_copy === 'sent' ? ' A copy of our conversation is on its way to ' + d.email + '.' : ' I couldn’t email you a copy just now, but the team has your details.')
          : '';
        say(['Thanks ' + first + '! I’ve sent your question' + (nPhotos ? ' and photo' + (nPhotos > 1 ? 's' : '') : '') + ' to our team and they’ll be in touch soon.' + (info.prejob ? ' Your reference number is ' + info.prejob + '.' : '') + copyLine,
             callLine(),
             'Is there anything else I can help you with?'],
          [{ label: 'Yes', act: 'yes_more', primary: true }, { label: 'No', act: 'no_more' }],
          function () { setTimeout(function () { mood(null); }, 2500); });
      })
      .catch(function () {
        S.busy = false; sending = false; mood(null);
        var tip = setupTip(info);
        say(['Sorry, I couldn’t reach the team from here. Please call ' + KB.phone + ' and they’ll sort it out straight away.'],
          [{ label: 'Try sending again', act: 'send_concern', primary: true }],
          function () { if (tip) { S.log.push({ who: 'tip', text: tip }); save(); render(); } });
      });
  }

  function flowInput(text) {
    if (S.flow && S.flow.type === 'concern') return concernInput(text.trim());
    var d = S.flow.data, step = S.flow.step, t = text.trim();
    // A question in the middle of the form: answer it, then carry on.
    if (/\?\s*$/.test(t) && step !== 'details' && step !== 'scope' && step !== 'who') {
      var a = answer(t);
      if (a && a.lines.length && !a.startFlow) return say(a.lines.concat(['Now, back to your job.']), [], function () { ask(step); });
    }
    switch (step) {
      case 'who':
        d.name = cleanName(t);
        if (!d.name) return ask('who');
        S.flow.step = 'area'; save();
        return askArea(d);
      case 'area':
        var inSyd = areaAnswer(t);
        if (inSyd === false) return outOfArea(d, d.urgency === 'Emergency');
        if (inSyd === null) return say('Sorry, I didn’t catch that. Is the property in Sydney or a nearby suburb? Just tap Yes or No.', AREA_CHIPS);
        d.inArea = true; save();
        return startJob();
      case 'details':
        d.details = t.slice(0, 600);
        if (!d.service) { var s = findService(norm(t)); d.service = s ? s.name : (/leak/i.test(t) ? 'Leak' : ''); }
        // Not for emergencies: get the team moving straight away
        if (d.urgency !== 'Emergency') return startScope();
        return afterDetails();
      case 'scope':
        d.scope = (d.scope || []).concat([{ q: S.flow.pendingQ || '', a: t.slice(0, 300) }]);
        S.flow.pendingQ = null;
        return d.scope.length >= SCOPE_MAX ? scopeDone() : askScope();
      case 'photos':
        if (/^(no|nah|nope|skip|done|continue|no thanks|that'?s it)/i.test(t)) return photoDone();
        return say('Tap “Add a photo” to choose one from your phone or computer, or carry on without one.', photoChips());
      case 'suburb': return suburbInput(d, t);
      case 'urgency': d.urgency = t.slice(0, 40); return ask('name');
      case 'name':
        d.name = t.replace(/^(i'?m|my name is|it'?s|this is)\s+/i, '').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 60);
        return ask('phone');
      case 'phone':
        var p = phoneOk(t);
        if (!p) return say('Hmm, that doesn’t look like an Australian number. Could you check it? For example 0412 345 678.', []);
        d.phone = p; return ask('time');
      case 'email':
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) { d.email = t.toLowerCase(); return ask('confirm'); }
        if (/^(skip|no|nah|none|no thanks|nope)\.?$/i.test(t)) { d.email = ''; return ask('confirm'); }
        return say('That email doesn’t look quite right. Try again, or tap Skip.', [{ label: 'Skip', act: 'answer' }]);
      case 'time': d.best_time = t.slice(0, 60); return ask('email');
      case 'confirm':
        if (/^y|send|correct|right|ok/i.test(t)) return sendLead();
        return ask('confirm');
    }
  }

  /* Setup tips: only shown when testing on your own computer, never to customers */
  function setupTip(info) {
    var local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!local) return '';
    if (location.protocol === 'file:')
      return 'Setup tip: the site was opened by double-clicking a file. Start it with start-windows.bat or start-mac.command, then use http://localhost:8888';
    if (!info.status)
      return 'Setup tip: the local server isn’t running. Start it with start-windows.bat or start-mac.command and keep that window open.';
    if (info.status === 404 || info.status === 405 || info.status === 501)
      return 'Setup tip: this page isn’t being served by the MBS local server, so the send function is missing. Start the site with start-windows.bat or start-mac.command.';
    var parts = [];
    if (info.reasons) Object.keys(info.reasons).forEach(function (k) {
      parts.push((k === 'email' ? 'Email' : k === 'ai' ? 'AI (DeepSeek)' : k === 'customer_copy' ? 'Copy to customer' : 'Telegram') + ': ' + info.reasons[k]);
    });
    var msg = 'Setup tip: ' + (parts.length ? parts.join(' | ') : 'the server answered with error ' + info.status + '.');
    if (info.saved) msg += ' (The enquiry was saved in leads/leads.jsonl.)';
    return msg + ' Run the setup check to fix it.';
  }

  function sendLead() {
    S.busy = true; S.chips = []; mood('thinking'); render();
    var info = { status: 0, reasons: null, saved: false };
    sending = true;
    fetch(API + '/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead: S.lead, channels: ['email', 'telegram'], source: 'chat', photos: photoPayload(),
        transcript: S.log.filter(function (m) { return m.who === 'me' || m.who === 'bot'; }).map(function (m) { return { role: m.who === 'me' ? 'user' : 'assistant', content: m.text }; }) })
    }).then(function (r) {
        info.status = r.status;
        return r.json().catch(function () { return {}; }).then(function (j) {
          info.reasons = j.reasons || null; info.saved = !!j.saved; info.prejob = j.prejob_no || '';
          return { ok: r.ok && j.ok };
        });
      })
      .then(function (res) {
        S.busy = false; sending = false;
        if (!res.ok) throw new Error('send');
        var nPhotos = PHOTOS.length;
        S.sent = true; S.flow = null; mood('happy'); clearPhotos();
        say(['Done! Your job' + (nPhotos ? ' and photo' + (nPhotos > 1 ? 's are' : ' is') : ' is') + ' with the MBS team, ' + S.lead.name.split(' ')[0] + '. One of our staff will call you on ' + S.lead.phone + (S.lead.best_time ? ' (' + S.lead.best_time.toLowerCase().replace(/^urgent – call now$/, 'as soon as possible') + ')' : '') + '.' + (info.prejob ? ' Your reference number is ' + info.prejob + '.' : ''),
             'Is there anything else I can help you with?'],
          [{ label: 'Yes', act: 'yes_more', primary: true }, { label: 'No', act: 'no_more' }],
          function () { mood('happy'); setTimeout(function () { mood(null); }, 2500); });
      })
      .catch(function () {
        S.busy = false; sending = false; mood(null);
        var tip = setupTip(info);
        say(['Sorry, I couldn’t reach the team from here. Please call ' + KB.phone + ' and they’ll sort it out straight away.'],
          [{ label: 'Try sending again', act: 'send', primary: true }],
          function () { if (tip) { S.log.push({ who: 'tip', text: tip }); save(); render(); } });
      });
  }

  /* ================= free-form questions via our server ================= */
  function askServer(text, mode) {
    var expert = mode === 'expert';
    if (expert) { S.lastQ = String(text).slice(0, 600); }
    S.busy = true; S.chips = []; mood('thinking'); render();
    var g = gen;
    var history = S.log.filter(function (m) { return m.who === 'me' || m.who === 'bot'; }).slice(expert ? -6 : -12)
      .map(function (m) { return { role: m.who === 'me' ? 'user' : 'assistant', content: m.text }; });
    var info = { status: 0, reasons: null, saved: false };
    fetch(API + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, mode: expert ? 'expert' : 'general' }) })
      .then(function (r) {
        info.status = r.status;
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (j.reason) info.reasons = { ai: j.reason };
          return { ok: r.ok, j: j };
        });
      })
      .then(function (res) {
        if (g !== gen) return;
        S.busy = false;
        if (!res.ok || !res.j.reply) throw new Error('no reply');
        if (expert) return say([res.j.reply, callLine()], EXPERT_CHIPS);
        say([res.j.reply], CALL_CHIPS);
      })
      .catch(function () {
        if (g !== gen) return;
        S.busy = false;
        var tip = setupTip(info);
        var showTip = function () { if (tip) { S.log.push({ who: 'tip', text: tip }); save(); render(); } };
        if (expert) return say(['Sorry, I can’t reach my toolbox right now, so I can’t answer that one.', 'Want one of the team to call you about it instead?'], EXPERT_CHIPS, showTip);
        say(['Good question! I’ll get one of the team to answer that properly.', 'Want them to give you a call?'], CALL_CHIPS, showTip);
      });
  }

  // a different "call us" line each time, so Mr. Fixit doesn't sound like a recording
  var CALL_LINES = [
    'Or if you’d rather talk it through, give us a ring on {p}.',
    'You can always call us on {p} too.',
    'Easier to explain on the phone? We’re on {p}.',
    'Prefer a chat? Call {p} anytime.',
    'If it’s getting worse, just ring us on {p}.'
  ], lastCall = -1;
  function callLine() {
    var i; do { i = Math.floor(Math.random() * CALL_LINES.length); } while (i === lastCall && CALL_LINES.length > 1);
    lastCall = i;
    return CALL_LINES[i].replace('{p}', KB.phone);
  }

  function startExpert(intro) {
    S.mode = 'expert'; save();
    say(intro || ['Sure! Ask me anything about home repairs, maintenance or restoration.',
      'For example: “Why is my paint peeling?” or “How do I fix a squeaky floorboard?”'], []);
  }

  var EMERGENCY_WORDS = [' emergenc', ' urgent', ' flooding', ' flooded', ' burst', ' collaps', ' sagging', ' dangerous', ' water pouring', ' spark', ' burning smell', ' smoke', ' fire ', ' gas leak', ' smell gas', ' electric shock', ' got a shock'];

  /* ================= input handling ================= */
  function userSays(text) {
    text = String(text || '').trim();
    if (!text || S.busy) return;
    S.log.push({ who: 'me', text: text.slice(0, 1000) });
    S.chips = []; save(); render();
    if (/^(start (again|over)|restart|reset|clear( (the )?chat)?|new chat)[.!]*$/i.test(text)) return startAgain();
    if (/^(main )?menu[.!]*$|^(go )?(back )?(to )?(the )?main menu[.!]*$/i.test(text)) return toMenu();
    if (/^(cancel|stop|never ?mind|quit)$/i.test(text) && S.flow) { S.flow = null; clearPhotos(); return say('No problem, cancelled. Anything else?', START_CHIPS); }
    if (S.flow) return flowInput(text);
    if (S.mode === 'expert') {
      // Safety first even in Q&A mode
      if (has(norm(text), EMERGENCY_WORDS)) {
        return say(['That sounds urgent. If anyone is in danger, or there’s smoke, fire or a gas smell, call 000 now. Otherwise call us on ' + KB.phone + '.',
          'For gas leaks, turn off the gas at the meter if it’s safe, open windows, and call your gas distributor’s emergency line.'],
          [{ label: 'Send my details now', act: 'flow', urgency: 'Emergency', primary: true }, { label: 'Main menu', act: 'exit_expert' }]);
      }
      return askServer(text, 'expert');
    }
    var a = answer(text);
    if (a && a.startFlow) return startFlow(a.startFlow);
    if (a) return say(a.lines, a.chips);
    askServer(text);
  }

  function pick(c) {
    if (S.busy) return;
    switch (c.act) {
      case 'flow':
        S.log.push({ who: 'me', text: c.label }); S.mode = null; save();
        return startFlow({ service: c.service, urgency: c.urgency, ask: c.ask });
      case 'more':
        S.log.push({ who: 'me', text: c.label }); save();
        return say('Sure, what would you like to know?', START_CHIPS);
      case 'expert':
        S.log.push({ who: 'me', text: c.label }); save();
        return startExpert();
      case 'concern':
        S.log.push({ who: 'me', text: c.label }); save();
        return startConcern();
      case 'send_concern':
        S.log.push({ who: 'me', text: c.label }); save();
        return S.flow && S.flow.type === 'concern' ? sendConcern() : startConcern();
      case 'expert_more':
        S.log.push({ who: 'me', text: c.label }); save();
        S.mode = 'expert';
        return say('Go ahead, what else needs fixing?', [{ label: 'Main menu', act: 'exit_expert' }]);
      case 'exit_expert':
        S.log.push({ who: 'me', text: c.label }); S.mode = null; save();
        return say('No worries. What can I help you with?', START_CHIPS);
      case 'yes_more':
        S.log.push({ who: 'me', text: 'Yes' }); save();
        return say('Sure, what would you like to know?', START_CHIPS);
      case 'no_more':
        S.log.push({ who: 'me', text: 'No' }); save();
        var first = S.lead && S.lead.name ? ', ' + S.lead.name.split(' ')[0] : '';
        mood('happy');
        return say(['Thanks' + first + '! The team will call you soon.', 'Have a great day!'], [],
          function () { mood('happy'); setTimeout(function () { mood(null); }, 2500); });
      case 'photo_add':
        if (!S.flow || S.flow.step !== 'photos') return;
        return fileInput.click();
      case 'suburb_pick':
        if (!S.flow || !c.sub) return;
        S.log.push({ who: 'me', text: c.label }); input.value = ''; save();
        clearTimeout(autoPickTimer);
        setSuburb(S.flow.data, c.sub);
        return afterSuburb();
      case 'scope_skip':
        S.log.push({ who: 'me', text: c.label }); save();
        return S.flow && S.flow.step === 'scope' ? scopeDone() : null;
      case 'photo_done':
        S.log.push({ who: 'me', text: c.label }); save();
        return photoDone();
      case 'cancel':
        S.log.push({ who: 'me', text: 'Cancel' }); S.flow = null; clearPhotos(); save();
        return say('No problem, cancelled. Anything else?', START_CHIPS);
      case 'restart':
        S.log.push({ who: 'me', text: c.label }); clearPhotos(); save();
        var was = S.flow && S.flow.data ? S.flow.data : {};
        return startFlow({ name: was.name, inArea: was.inArea });
      case 'send':
        S.log.push({ who: 'me', text: c.label }); save();
        return sendLead();
      default:
        return userSays(c.label);
    }
  }

  /* ================= v35: main menu and start again ================= */
  // Main menu: keeps the chat on screen, stops whatever was going on (an enquiry, Q&A) and shows the main choices
  function toMenu() {
    S.flow = null; S.mode = null; clearTimeout(autoPickTimer); clearPhotos(); askRestart(false); save();
    return say('No worries. Here’s the main menu. What can I help you with?', START_CHIPS);
  }
  // Start again: asks first if there's a conversation worth keeping, then clears it all
  function askRestart(show) {
    if (show && !S.log.some(function (m) { return m.who === 'me'; })) return startAgain();
    confirmBar.hidden = !show; panel.classList.toggle('confirming', !!show);
    if (show) { var y = confirmBar.querySelector('.fx-yes'); if (y) y.focus(); }
  }
  function startAgain() {
    if (sending) return;
    gen++;   // drop anything still on its way from the old chat
    stopSpeaking(); clearTimeout(autoPickTimer); askRestart(false);
    S.log = []; S.chips = []; S.flow = null; S.mode = null; S.lastQ = ''; S.busy = false;
    clearPhotos(); input.value = ''; input.style.height = ''; mood(null); save(); render();
    say(['Fresh start! I’m Mr. Fixit.', 'What can I help you with?'], START_CHIPS);
    setTimeout(function () { input.focus(); }, 200);
  }
  restartBtn.addEventListener('click', function () { if (!sending) askRestart(confirmBar.hidden); });

  /* ================= open / close ================= */
  function setOpen(v) {
    S.open = v;
    panel.classList.toggle('open', v);
    launcher.classList.toggle('hide', v);
    tip.classList.remove('show');
    launcher.setAttribute('aria-expanded', v ? 'true' : 'false');
    if (v) {
      render();
      if (!S.greeted) {
        S.greeted = true;
        say(['G’day! I’m Mr. Fixit from Modern Building Solutions.', 'Ask me anything about our building, repair and waterproofing work. When you’re ready, I’ll pass your job to the team and one of our staff will call you.'], START_CHIPS);
      }
      setTimeout(function () { input.focus(); }, 200);
    }
  }

  launcher.addEventListener('click', function () { setOpen(true); });
  tip.addEventListener('click', function () { setOpen(true); });
  closeBtn.addEventListener('click', function () { stopSpeaking(); setOpen(false); launcher.focus(); });
  drawSound();
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!confirmBar.hidden) { askRestart(false); restartBtn.focus(); return; } stopSpeaking(); setOpen(false); launcher.focus(); } });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = input.value; input.value = ''; input.style.height = '';
    mood(null);
    userSays(t);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    if (!S.busy) mood(input.value ? 'listening' : null);
    // live suburb suggestions while the customer types
    if (S.flow && S.flow.step === 'suburb' && !S.busy) {
      var v = input.value;
      var show = function () {
        if (!(S.flow && S.flow.step === 'suburb' && !S.busy && input.value === v)) return;
        var found = v.trim().length >= 3 ? matchSuburbs(v) : [];
        S.chips = suburbChips('', found); renderChips();
        clearTimeout(autoPickTimer);
        if (found.length === 1) autoPickTimer = setTimeout(function () {   // only one suburb fits: pick it for them
          if (S.flow && S.flow.step === 'suburb' && !S.busy && input.value === v) { input.value = ''; pick(S.chips[0]); }
        }, 900);
      };
      if (SUBURBS) show(); else { var p = loadSuburbs(); if (p) p.then(show); }
    }
  });

  // Any element with data-chat opens Mr. Fixit
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-chat]');
    if (t) { e.preventDefault(); setOpen(true); }
  });

  // Lets the page open Mr. Fixit, e.g. from the "Ask Mr. Fixit" section on the home page
  window.MrFixit = {
    open: function () { setOpen(true); },
    ask: function (q) {
      q = String(q || '').trim().slice(0, 1000);
      S.flow = null;
      var go = function () {
        if (S.busy) return setTimeout(go, 300);
        S.mode = 'expert'; save();
        if (q) userSays(q); else startExpert();
      };
      var fresh = !S.log.length;
      if (!S.open) { S.greeted = true; setOpen(true); }
      if (fresh) say(['G’day! I’m Mr. Fixit. Let’s sort out your repair question.'], [], go);
      else go();
    }
  };

  // Friendly nudge once per visit, after the intro has finished
  function nudge() {
    if (S.greeted || S.open || S.tipClosed) return;
    if (document.getElementById('intro')) return setTimeout(nudge, 1500);
    setTimeout(function () {
      if (S.open || S.greeted || S.tipClosed) return;
      tip.classList.add('show');          // stays (glowing) until they open the chat or close the bubble
    }, 2500);
    // fade it out while the footer is on screen, so it never covers the footer text
    var fb = document.querySelector('.fbar');
    if (fb && window.IntersectionObserver) new IntersectionObserver(function (es) {
      tip.classList.toggle('away', es[0].isIntersecting);
    }).observe(fb);
  }
})();
