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

  function build() {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'champChatBtn'; btn.className = 'cc-btn'; btn.setAttribute('aria-label', 'Ask Champ, the Project Champ assistant'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<img src="' + ASSET + 'gkh-globe.webp" alt="" class="gkh-globe" width="40" height="40"><span>Ask Champ</span>';
    if (ls('champChatSeen') !== '1') btn.classList.add('cc-glow');
    var box = document.createElement('section');
    box.id = 'champChat'; box.className = 'cc-box'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Champ assistant');
    box.innerHTML =
      '<header class="cc-h"><img src="' + ASSET + 'gkh-globe.webp" alt="" class="gkh-globe" width="38" height="38"><div><b>Champ</b><small>AI assistant</small></div>' +
      '<select class="cc-lang" aria-label="Language">' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="cc-voice" aria-pressed="' + voiceOn + '" title="Read Champ’s answers aloud">🔊 Voice</button>' +
      '<button type="button" class="cc-x" aria-label="Close">✕</button></header>' +
      '<div class="cc-log" aria-live="polite"></div>' +
      '<div class="cc-chips"></div>' +
      '<form class="cc-f"><textarea rows="1" maxlength="1200" placeholder="Ask Champ anything about projects…" aria-label="Your question"></textarea><button type="submit" aria-label="Send">➤</button></form>' +
      '<p class="cc-foot">AI answers can be wrong; check important details. <button type="button" class="cc-clear">New chat</button></p>';
    document.body.appendChild(btn); document.body.appendChild(box);
    var log = box.querySelector('.cc-log'), chips = box.querySelector('.cc-chips'), ta = box.querySelector('textarea'), sel = box.querySelector('.cc-lang');

    function bubble(role, html, cls) {
      var d = document.createElement('div'); d.className = 'cc-m cc-' + role + (cls ? ' ' + cls : '');
      d.innerHTML = html; if (RTL[lang] && role === 'bot') d.dir = 'auto';
      log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
    }
    function stopVoice() { if (audio) { try { audio.pause(); } catch (e) {} audio = null; } if (speakingBtn) { speakingBtn.classList.remove('on'); speakingBtn.textContent = '🔊 Listen'; speakingBtn = null; } }
    function speak(text, L, b) {
      stopVoice(); if (!voiceOk || NOVOICE[L]) return;
      if (b) { speakingBtn = b; b.classList.add('on'); b.textContent = '■ Stop'; }
      fetch('/.netlify/functions/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: L }) })
        .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 503) { voiceOk = false; log.querySelectorAll('.cc-say').forEach(function (x) { x.remove(); }); box.querySelector('.cc-voice').hidden = true; } throw new Error(j.error || 'Voice unavailable'); }); return r.blob(); })
        .then(function (bl) { if (b && speakingBtn !== b) return; audio = new Audio(URL.createObjectURL(bl)); audio.onended = stopVoice; return audio.play(); })
        .catch(function (e) { stopVoice(); bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err'); });
    }
    function sayBtn(bb, text, L) {
      if (!voiceOk || NOVOICE[L]) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cc-say'; b.textContent = '🔊 Listen'; b.setAttribute('aria-label', 'Read this answer aloud');
      b.onclick = function () { if (speakingBtn === b) stopVoice(); else speak(text, L || 'en', b); };
      bb.appendChild(b);
    }
    function draw() {
      log.innerHTML = '';
      bubble('bot', md(HELLO[lang] || HELLO.auto));
      msgs.forEach(function (m) { if (m.role === 'user') bubble('user', '<p>' + esc(m.content) + '</p>'); else sayBtn(bubble('bot', md(m.content)), m.content, m.lang); });
      chips.innerHTML = msgs.length ? '' : CHIPS.map(function (c) { return '<button type="button">' + esc(c) + '</button>'; }).join('');
      chips.querySelectorAll('button').forEach(function (b) { b.onclick = function () { ask(b.textContent); }; });
      box.dir = RTL[lang] ? 'rtl' : 'ltr';
    }
    function ask(q) {
      q = String(q || '').trim(); if (!q || busy) return;
      busy = true; msgs.push({ role: 'user', content: q }); ss('champChat', JSON.stringify(msgs.slice(-24)));
      chips.innerHTML = ''; bubble('user', '<p>' + esc(q) + '</p>'); ta.value = ''; ta.style.height = '';
      var wait = bubble('bot', '<span class="cc-dots"><i></i><i></i><i></i></span>', 'cc-wait');
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs.slice(-12).map(function (m) { return { role: m.role, content: m.content }; }), lang: lang, where: where }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'The assistant is unavailable right now.'); return j; }); })
        .then(function (j) { wait.remove(); var L = j.lang || (lang === 'auto' ? 'en' : lang); msgs.push({ role: 'assistant', content: j.reply, lang: L }); ss('champChat', JSON.stringify(msgs.slice(-24))); var bb = bubble('bot', md(j.reply)); sayBtn(bb, j.reply, L); if (voiceOn) speak(j.reply, L, bb.querySelector('.cc-say')); })
        .catch(function (e) { wait.remove(); msgs.pop(); ss('champChat', JSON.stringify(msgs)); bubble('bot', '<p>' + esc(e.message) + '</p>', 'cc-err'); })
        .then(function () { busy = false; ta.focus(); });
    }
    function open(on) {
      box.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false'); document.body.classList.toggle('cc-open', on);
      if (on) { btn.classList.remove('cc-glow'); ls('champChatSeen', '1'); } else stopVoice();
      if (on) { draw(); setTimeout(function () { ta.focus(); }, 50); }
    }
    btn.onclick = function () { open(box.hidden); };
    box.querySelector('.cc-x').onclick = function () { open(false); btn.focus(); };
    box.querySelector('.cc-clear').onclick = function () { msgs = []; ss('champChat', '[]'); draw(); };
    sel.onchange = function () { lang = sel.value; ls('champChatLang', lang); draw(); window.dispatchEvent(new CustomEvent('champ:chatlang', { detail: lang })); };
    window.addEventListener('champ:lang', function (e) { lang = e.detail; sel.value = lang; if (!box.hidden) draw(); });
    var vb = box.querySelector('.cc-voice');
    vb.onclick = function () { voiceOn = !voiceOn; ls('champVoice', voiceOn ? '1' : '0'); vb.setAttribute('aria-pressed', String(voiceOn)); if (!voiceOn) stopVoice(); };
    box.querySelector('form').onsubmit = function (e) { e.preventDefault(); ask(ta.value); };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(ta.value); } });
    ta.addEventListener('input', function () { ta.style.height = ''; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) open(false); });
    window.ChampChat = { open: function () { open(true); }, ask: function (q) { open(true); ask(q); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
