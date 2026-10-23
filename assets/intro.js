/* MBS — opening intro: loading bar, flying tools, cinematic sound (Web Audio, no files) */
(function () {
  'use strict';

  var intro = document.getElementById('intro');
  if (!intro) return;

  var startPane = intro.querySelector('.istart');
  var loadPane = intro.querySelector('.iload');
  var bar = intro.querySelector('.ibar i');
  var pctEl = intro.querySelector('[data-pct]');
  var logo = intro.querySelector('.icore .ilogo');
  var flash = intro.querySelector('.iflash');
  var muteBtn = intro.querySelector('[data-mute]');
  var skipBtn = intro.querySelector('[data-skip]');
  var tools = intro.querySelectorAll('.tool');

  var ctx = null, master = null, muted = false, done = false;
  var timers = [];
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  /* ---------- sound ---------- */
  function audio() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.85;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  function noiseSrc(dur) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource();
    s.buffer = buf;
    return s;
  }

  /* cinematic riser */
  function riser(dur) {
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(68, t);
    o.frequency.exponentialRampToValueAtTime(520, t + dur);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(5200, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.1);

    var n = noiseSrc(dur + 0.2);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3600, t + dur);
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.26, t + dur * 0.92);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    n.connect(bp); bp.connect(ng); ng.connect(master);
    n.start(t); n.stop(t + dur + 0.2);
  }

  /* tool landing clack */
  function clack(at) {
    var t = ctx.currentTime + at;
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(920, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.08);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.13);

    var n = noiseSrc(0.07);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(hp); hp.connect(ng); ng.connect(master);
    n.start(t); n.stop(t + 0.08);
  }

  /* impact boom */
  function boom() {
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(118, t);
    o.frequency.exponentialRampToValueAtTime(27, t + 1.4);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 1.7);

    var n = noiseSrc(0.5);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 760;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    n.connect(lp); lp.connect(ng); ng.connect(master);
    n.start(t); n.stop(t + 0.5);
  }

  /* construction thud for each build stage */
  function thud(at) {
    var t = ctx.currentTime + at;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.2);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.26);
  }

  /* ---------- sequence (house builds in 4 seconds) ---------- */
  var BUILD = 4.0;
  var FLY = ['flyL', 'flyR', 'flyT', 'flyB', 'flyD'];
  var STAGES = [
    [0.00, 'Foundation'],
    [0.90, 'Framing'],
    [2.10, 'Roof'],
    [2.90, 'Cladding'],
    [3.35, 'Lock-up'],
    [3.80, 'Handover']
  ];
  var house = intro.querySelector('.house');
  var hstage = intro.querySelector('[data-hstage]');

  function run() {
    if (startPane) startPane.style.display = 'none';
    if (loadPane) loadPane.style.display = 'flex';

    var c = audio();
    if (c) {
      riser(BUILD);
      [1.0, 1.25, 1.5, 1.75, 2.0].forEach(function (s) { clack(s); });
      [0.45, 1.8, 2.7, 3.35].forEach(function (s) { thud(s); });
      later(function () { if (ctx) boom(); }, BUILD * 1000);
    }

    Array.prototype.forEach.call(tools, function (el, i) {
      el.style.animation = FLY[i % FLY.length] + ' .9s cubic-bezier(.2,.9,.25,1.15) ' + (0.1 + i * 0.25) + 's both';
    });

    if (house) house.classList.add('go');
    STAGES.forEach(function (s) {
      later(function () { if (hstage) hstage.textContent = s[1]; }, s[0] * 1000);
    });
    later(function () { if (house) house.classList.add('done'); }, 3900);

    var start = performance.now();
    var iv = setInterval(function () {
      var p = Math.min(100, Math.round(((performance.now() - start) / (BUILD * 1000)) * 100));
      if (bar) bar.style.width = p + '%';
      if (pctEl) pctEl.textContent = p + '%';
      if (p >= 100) clearInterval(iv);
    }, 30);
    timers.push(iv);

    later(function () {
      if (logo) logo.classList.add('pop');
      if (flash) flash.style.opacity = '1';
    }, BUILD * 1000);
    later(function () { if (flash) flash.style.opacity = '0'; }, BUILD * 1000 + 300);
    later(finish, BUILD * 1000 + 900);
  }

  function finish() {
    if (done) return;
    done = true;
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    intro.classList.add('gone');
    document.body.style.overflow = '';
    try { sessionStorage.setItem('mbsIntroSeen', '1'); } catch (e) {}
    setTimeout(function () { if (intro && intro.parentNode) intro.parentNode.removeChild(intro); }, 800);
  }

  /* ---------- wiring ---------- */
  var startBtn = intro.querySelector('[data-start]');
  if (startBtn) startBtn.addEventListener('click', run);
  if (skipBtn) skipBtn.addEventListener('click', function (e) { e.preventDefault(); finish(); });
  if (muteBtn) {
    muteBtn.addEventListener('click', function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.85;
      muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
    });
  }

  /* show intro once per browser session; skip on repeat visits */
  var seen = false;
  try { seen = sessionStorage.getItem('mbsIntroSeen') === '1'; } catch (e) {}
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (seen || reduce) {
    intro.parentNode.removeChild(intro);
  } else {
    document.body.style.overflow = 'hidden';
  }
})();
