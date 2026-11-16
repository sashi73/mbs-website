/* GKH Project Champ: the backup voice. Champ speaks with Microsoft Azure neural voices; when Azure cannot answer (a key
   that was changed, a subscription that lapsed, the service down) Champ uses the voice built into the browser instead, so it
   never goes silent. After a failure it stays on the backup voice for 10 minutes, then tries Azure again. */
(function () {
  var TAG = { en: 'en-AU', ms: 'ms-MY', id: 'id-ID', ta: 'ta-IN', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-SA', fa: 'fa-IR', vi: 'vi-VN', th: 'th-TH', tl: 'fil-PH', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ru: 'ru-RU', nl: 'nl-NL', tr: 'tr-TR', bn: 'bn-IN', ur: 'ur-PK', pa: 'pa-IN', si: 'si-LK', ne: 'ne-NP', my: 'my-MM', km: 'km-KH', lo: 'lo-LA', sw: 'sw-KE' };
  var down = 0;
  function ok() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }
  function pick(tag) { var vs = window.speechSynthesis.getVoices() || [], b = tag.split('-')[0];
    return vs.find(function (v) { return v.lang === tag && /natural|neural|online|premium|enhanced/i.test(v.name); }) || vs.find(function (v) { return v.lang === tag; }) || vs.find(function (v) { return (v.lang || '').replace('_', '-').indexOf(b) === 0; }) || null; }
  if (ok()) try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}
  window.ChampVoice = {
    azureDown: function () { return Date.now() - down < 10 * 60000; },
    markDown: function (why) { down = Date.now(); if (window.console) console.warn('Champ voice: Azure unavailable (' + (why || '') + '), using the browser voice'); },
    can: ok,
    // say text with the browser's voice; onEnd when finished (or at once when there is no voice); clear: a little slower
    say: function (text, lang, onEnd, clear) {
      if (!ok() || !text) { if (onEnd) onEnd(); return false; }
      try {
        var ss = window.speechSynthesis; ss.cancel(); var tag = TAG[lang] || lang || 'en-AU';
        // long text in sentences: some browsers stop a single long utterance after ~15 seconds
        var parts = String(text).replace(/\s+/g, ' ').replace(/([^0-9][.!?…])\s+/g, '$1\n').split('\n').filter(Boolean), v = pick(tag), i = 0;
        var next = function () { if (i >= parts.length) { if (onEnd) onEnd(); return; } var u = new SpeechSynthesisUtterance(parts[i++]); u.lang = tag; if (v) u.voice = v; u.rate = clear ? 0.95 : 1; u.volume = 1; u.onend = next; u.onerror = function () { if (onEnd) onEnd(); }; ss.speak(u); };
        next(); return true;
      } catch (e) { if (onEnd) onEnd(); return false; }
    },
    stop: function () { try { if (ok()) window.speechSynthesis.cancel(); } catch (e) {} }
  };
})();
