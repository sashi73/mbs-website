/* GKH Project Champ: the 10-second cinematic opening on the home page (once per visit; ?intro=1 plays it again).
   01 Plan → 02 Schedule (Gantt) → 03 Critical path, with PM tools flying in → the Project Champ title on the big hit.
   The hero score is played live by the browser (Web Audio): no video or music files to download. */
(function () {
  'use strict';
  var force = /[?&]intro=1/.test(location.search);
  var seen = false; try { seen = sessionStorage.getItem('champIntroSeen') === '1'; } catch (e) {}
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!force && (seen || reduce)) return;
  if (!document.body) return;

  var GLOBE = 'assets/gkh-globe.webp';
  var ICON = {
    kanban: '<svg viewBox="0 0 24 24" fill="none" stroke="#F2D98B" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/><path d="M5 8h2M11 8h2M11 11h2M17 8h2M5 11h2" stroke-width="2.4"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="#F2D98B" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M16 14h1M8 17h2" stroke-width="2.4"/></svg>',
    budget: '<svg viewBox="0 0 24 24" fill="none" stroke="#F2D98B" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="M19 4l-3 3 3 3" /></svg>',
    risk: '<svg viewBox="0 0 24 24" fill="none" stroke="#FF8A6B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01" stroke-width="2.4"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="#F2D98B" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.8 6 5.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="#F2D98B" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3"/></svg>'
  };
  var TOOLS = [['kanban', 'Kanban', 7, 15, '-60vw', '-30vh', '-80deg'], ['cal', 'Calendar', 84, 13, '60vw', '-40vh', '90deg'], ['budget', 'Budget', 5, 60, '-70vw', '20vh', '-120deg'],
    ['risk', 'RAID log', 88, 56, '70vw', '10vh', '140deg'], ['team', 'RACI', 24, 74, '-30vw', '60vh', '-60deg'], ['clock', 'Baseline', 70, 76, '30vw', '60vh', '70deg']];
  var ROWS = [['Initiation &amp; charter', 0, 10, 1, 100], ['Requirements &amp; WBS', 8, 16, 1, 100], ['Design', 22, 18, 1, 80], ['Procurement', 26, 22, 0, 45],
    ['Build &amp; develop', 40, 30, 1, 30], ['Training &amp; change', 60, 22, 0, 0], ['Testing &amp; QA', 66, 16, 1, 0], ['Go-live &amp; handover', 82, 12, 1, 0]];
  var NODES = [['S', 60, 230, 'START', 1], ['B', 230, 105, 'Charter · 5d', 1], ['C', 230, 355, 'Procure · 12d', 0], ['D', 420, 165, 'Design · 18d', 1], ['E', 420, 370, 'Training · 9d', 0],
    ['F', 610, 150, 'Build · 30d', 1], ['G', 610, 345, 'Integrate · 8d', 0], ['H', 780, 230, 'Test · 16d', 1], ['T', 920, 230, 'GO-LIVE', 1]];
  var EDGES = [['S', 'B'], ['S', 'C'], ['B', 'D'], ['C', 'D'], ['C', 'E'], ['D', 'F'], ['D', 'G'], ['E', 'G'], ['F', 'H'], ['G', 'H'], ['H', 'T']];
  var at = {}; NODES.forEach(function (n) { at[n[0]] = n; });

  var el = document.createElement('div');
  el.className = 'ci'; el.id = 'champIntro'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'GKH Project Champ intro');
  el.innerHTML =
    '<canvas class="ci-fx" aria-hidden="true"></canvas><div class="ci-vig"></div><i class="ci-lb t"></i><i class="ci-lb b"></i><div class="ci-flare" aria-hidden="true"></div>' +
    '<div class="ci-start"><img src="' + GLOBE + '" alt="" width="150" height="150"><h1>GKH Project <b>Champ</b></h1><p>Every project, from initiation to closing.</p>' +
    '<button type="button" class="ci-go" data-ci-start>▶&nbsp; Tap to enter</button><p>Best with sound · 10 seconds</p></div>' +
    '<div class="ci-cam" aria-hidden="true">' +
      // 01 the plan
      '<div class="ci-scene ci-plan"><div class="ci-sheet"><div><h3>Project plan · AI drafted</h3><h2>Hospital Wing Upgrade</h2><ul class="ci-wbs">' +
        [['Scope &amp; WBS', '42 work packages'], ['Schedule', '128 tasks'], ['Budget', '$4.8M'], ['Risks &amp; issues', '17 logged'], ['Stakeholders', 'RACI ready'], ['Comms plan', 'weekly']].map(function (x, i) {
          return '<li style="transition-delay:' + (0.15 + i * 0.12) + 's"><i>✓</i><span>' + x[0] + '</span><span>' + x[1] + '</span></li>'; }).join('') +
        '</ul></div><div class="ci-kpis">' +
        [['SPI', '1.04', '▲'], ['CPI', '0.98', ''], ['Float', '0 d', ''], ['Phase', 'Planning', '']].map(function (k, i) {
          return '<div class="ci-kpi" style="transition-delay:' + (0.5 + i * 0.12) + 's"><small>' + k[0] + '</small><b>' + k[1] + (k[2] ? '<em>' + k[2] + '</em>' : '') + '</b></div>'; }).join('') +
        '<div class="ci-kpi ci-ring" style="transition-delay:1s"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" stroke="rgba(255,255,255,.1)"/><circle class="rg" cx="40" cy="40" r="32"/></svg><div><small>Plan complete</small><b>74%</b></div></div>' +
      '</div></div></div>' +
      // 02 the Gantt chart
      '<div class="ci-scene ci-gantt"><div class="ci-gbox"><div class="ci-ghead"><div>Task</div><div><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span></div></div>' +
        '<div class="ci-grows"><div class="ci-grid"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
        ROWS.map(function (r, i) {
          return '<div class="ci-gr"><span>' + r[0] + '</span><div><i class="ci-bar' + (r[3] ? ' cr' : '') + '" style="left:' + r[1] + '%;width:' + r[2] + '%;--d:' + (0.25 + i * 0.16) + 's"><u style="--p:' + r[4] + '%"></u></i>' +
            (i === 1 ? '<i class="ci-ms" style="left:24%;--d:1.4s"></i>' : i === 4 ? '<i class="ci-ms" style="left:70%;--d:1.8s"></i>' : i === 7 ? '<i class="ci-ms" style="left:94%;--d:2.1s"></i>' : '') + '</div></div>';
        }).join('') + '<i class="ci-today"></i></div></div></div>' +
      // 03 the critical path
      '<div class="ci-scene ci-net"><svg viewBox="0 0 980 460"><defs><filter id="ciGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
        EDGES.map(function (e, i) { var a = at[e[0]], b = at[e[1]]; return '<path class="ed" pathLength="1" style="--d:' + (0.2 + i * 0.06) + 's" d="M' + a[1] + ' ' + a[2] + ' L' + b[1] + ' ' + b[2] + '"/>'; }).join('') +
        '<path class="cp" pathLength="1" d="M60 230 L230 105 L420 165 L610 150 L780 230 L920 230"/>' +
        NODES.map(function (n, i) { return '<g class="nd' + (n[4] ? ' c' : '') + '" style="--d:' + (0.1 + i * 0.07) + 's"><circle cx="' + n[1] + '" cy="' + n[2] + '" r="' + (n[0] === 'S' || n[0] === 'T' ? 34 : 27) + '"/><text x="' + n[1] + '" y="' + n[2] + '">' + (n[0] === 'S' ? '▶' : n[0] === 'T' ? '★' : n[0]) + '</text><text class="lab" x="' + n[1] + '" y="' + (n[2] + 48) + '">' + n[3] + '</text></g>'; }).join('') +
        '<g class="tag"><rect x="330" y="8" width="320" height="38" rx="19"/><text x="490" y="28" text-anchor="middle" dominant-baseline="central">CRITICAL PATH · 0 DAYS FLOAT</text></g>' +
        '<circle class="ci-pulse" r="8" cx="60" cy="230"/></svg></div>' +
    '</div>' +
    '<div class="ci-tools" aria-hidden="true">' + TOOLS.map(function (t, i) {
      return '<div class="ci-tool" style="left:' + t[2] + '%;top:' + t[3] + '%;--fx:' + t[4] + ';--fy:' + t[5] + ';--fr:' + t[6] + ';--d:' + (0.15 + i * 0.17) + 's;animation-delay:' + (i * -0.5) + 's">' + ICON[t[0]] + '<b>' + t[1] + '</b></div>'; }).join('') + '</div>' +
    '<div class="ci-cap" aria-live="polite"><small></small><span></span><em></em></div>' +
    '<div class="ci-flash"></div>' +
    '<div class="ci-logo"><img src="' + GLOBE + '" alt="" width="170" height="170"><div class="k">Global Knowledge House</div><h2>Project Champ</h2><p>Plan it. Schedule it. <b>Deliver it.</b></p></div>' +
    '<div class="ci-foot"><button type="button" data-ci-mute>🔊 Sound on</button><button type="button" data-ci-skip>Skip intro →</button></div>';
  document.body.insertBefore(el, document.body.firstChild);
  document.documentElement.style.overflow = 'hidden';

  var timers = [], done = false, running = false, hit = false;
  document.body.classList.add('ci-on');
  function later(fn, s) { timers.push(setTimeout(fn, s * 1000)); }
  function cls(c, on) { el.classList.toggle(c, on !== false); }
  var cap = el.querySelector('.ci-cap');
  function caption(n, title, sub) {
    cap.querySelector('small').textContent = n; cap.querySelector('span').textContent = title; cap.querySelector('em').textContent = sub;
    cap.classList.add('on'); cap.classList.remove('swap'); void cap.offsetWidth; cap.classList.add('swap');
  }
  function flare() { var f = el.querySelector('.ci-flare'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

  /* ---------------- dust, light streaks and film grain ---------------- */
  var cv = el.querySelector('.ci-fx'), g2 = cv.getContext('2d'), W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), warp = 0, pts = [], raf = 0;
  function size() { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; g2.setTransform(dpr, 0, 0, dpr, 0, 0); }
  size(); window.addEventListener('resize', size);
  for (var i = 0; i < 160; i++) pts.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), h: Math.random() < 0.18 });
  function frame() {
    g2.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H * 0.46, sp = 0.0016 + warp * 0.03;
    pts.forEach(function (p) {
      var z0 = p.z; p.z -= sp; if (p.z <= 0.02) { p.z = 1; p.x = Math.random() * 2 - 1; p.y = Math.random() * 2 - 1; return; }
      var k = 0.55 / p.z, X = cx + p.x * W * k * 0.5, Y = cy + p.y * H * k * 0.5, a = Math.min(1, (1 - p.z) * 1.4);
      g2.strokeStyle = g2.fillStyle = p.h ? 'rgba(140,190,255,' + a * 0.7 + ')' : 'rgba(242,217,139,' + a * 0.8 + ')';
      if (warp > 0.05) {
        var k0 = 0.55 / z0; g2.lineWidth = 1.2 + warp * 1.5; g2.beginPath(); g2.moveTo(cx + p.x * W * k0 * 0.5, cy + p.y * H * k0 * 0.5); g2.lineTo(X, Y); g2.stroke();
      } else { g2.beginPath(); g2.arc(X, Y, Math.max(0.4, (1 - p.z) * 2.2), 0, 6.283); g2.fill(); }
    });
    for (var n = 0; n < 420; n++) { g2.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)'; g2.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4); }
    raf = requestAnimationFrame(frame);
  }
  frame();

  /* ---------------- the hero score (Web Audio): Dm – B♭ – F – C, then D major on the title ---------------- */
  var ac = null, master = null, bus = null, wet = null, muted = false;
  var mf = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
  function setupAudio() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ac = new AC(); if (ac.state === 'suspended') ac.resume();
    var comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    master = ac.createGain(); master.gain.value = 0.72; comp.connect(master);
    var clip = ac.createWaveShaper(), cv2 = new Float32Array(2048); for (var q = 0; q < 2048; q++) { var x = q / 1023.5 - 1; cv2[q] = Math.tanh(x * 1.6) / Math.tanh(1.6) * 0.92; } clip.curve = cv2;   // soft limiter: no harsh clipping on the big hit
    master.connect(clip); clip.connect(ac.destination);
    bus = ac.createGain(); bus.connect(comp);
    // a hall: 2.6 s of decaying stereo noise
    var len = ac.sampleRate * 2.6, ir = ac.createBuffer(2, len, ac.sampleRate);
    for (var c = 0; c < 2; c++) { var d = ir.getChannelData(c); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    var rev = ac.createConvolver(); rev.buffer = ir; wet = ac.createGain(); wet.gain.value = 0.42; wet.connect(rev); rev.connect(comp);
    return ac;
  }
  function out(node, send) { node.connect(bus); if (send) { var s = ac.createGain(); s.gain.value = send; node.connect(s); s.connect(wet); } }
  function noise(dur) { var b = ac.createBuffer(1, Math.max(1, ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; var s = ac.createBufferSource(); s.buffer = b; return s; }
  // one voice: several oscillators → low-pass with its own envelope → amplitude envelope
  function voice(m, t, dur, o) {
    var g = ac.createGain(), f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q || 0.7;
    f.frequency.setValueAtTime(o.f0 || 800, t); f.frequency.linearRampToValueAtTime(o.f1 || o.f0 || 800, t + (o.fa || 0.1)); f.frequency.linearRampToValueAtTime(o.f2 || o.f0 || 800, t + dur);
    var A = o.a || 0.02, R = o.r || 0.3, v = o.v || 0.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + A); g.gain.setValueAtTime(v, t + Math.max(A, dur)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + R);
    f.connect(g); out(g, o.send);
    (o.waves || ['sawtooth']).forEach(function (w, i) {
      var os = ac.createOscillator(); os.type = w; os.frequency.value = mf(m); os.detune.value = (o.det || [0])[i % (o.det || [0]).length];
      if (o.vib) { var l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5.4; lg.gain.value = o.vib; l.connect(lg); lg.connect(os.detune); l.start(t + 0.15); l.stop(t + dur + R + 0.1); }
      os.connect(f); os.start(t); os.stop(t + dur + R + 0.1);
    });
  }
  var pad = function (m, t, d, v) { voice(m, t, d, { waves: ['sawtooth', 'sawtooth', 'triangle'], det: [-9, 8, 0], a: 0.35, r: 0.9, f0: 500, f1: 1300, fa: d * 0.7, f2: 900, v: v || 0.035, send: 0.8 }); };
  var brass = function (m, t, d, v) { voice(m, t, d, { waves: ['sawtooth', 'square'], det: [-5, 5], a: 0.05, r: 0.35, f0: 350, f1: 2600, fa: 0.12, f2: 1300, q: 1.4, v: v || 0.05, send: 0.5 }); };
  var horn = function (m, t, d, v) { voice(m, t, d, { waves: ['sawtooth', 'sawtooth', 'triangle'], det: [-6, 6, 0], a: 0.07, r: 0.4, f0: 700, f1: 2300, fa: 0.15, f2: 1500, vib: 9, v: v || 0.07, send: 0.65 }); };
  var pluck = function (m, t, v) { voice(m, t, 0.07, { waves: ['sawtooth'], a: 0.004, r: 0.12, f0: 2600, f1: 2600, fa: 0.01, f2: 500, v: v || 0.05, send: 0.25 }); };
  var bass = function (m, t, d, v) { voice(m, t, d, { waves: ['sawtooth', 'sine'], det: [0, 0], a: 0.04, r: 0.4, f0: 220, f1: 420, fa: 0.1, f2: 260, v: v || 0.13 }); };
  function taiko(t, v) {
    var o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    g.gain.setValueAtTime(v || 0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55); o.connect(g); out(g, 0.35); o.start(t); o.stop(t + 0.6);
    var n = noise(0.12), f = ac.createBiquadFilter(), ng = ac.createGain(); f.type = 'lowpass'; f.frequency.value = 900; ng.gain.setValueAtTime((v || 0.7) * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    n.connect(f); f.connect(ng); out(ng, 0.3); n.start(t); n.stop(t + 0.13);
  }
  function tick(t, v) { var n = noise(0.05), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'highpass'; f.frequency.value = 6000; g.gain.setValueAtTime(v || 0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045); n.connect(f); f.connect(g); out(g, 0.15); n.start(t); n.stop(t + 0.06); }
  function braam(m, t, d, v) { [m, m + 12, m + 7].forEach(function (x, i) { voice(x, t, d, { waves: ['sawtooth', 'sawtooth'], det: [-12, 12], a: 0.03, r: 1.2, f0: 120, f1: 1500, fa: 0.25, f2: 300, q: 2, v: (v || 0.09) * (i ? 0.6 : 1), send: 0.7 }); }); }
  function riser(t, d) {
    var n = noise(d + 0.1), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + d); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
    n.connect(f); f.connect(g); out(g, 0.4); n.start(t); n.stop(t + d + 0.1);
  }
  function crash(t) { var n = noise(3), f = ac.createBiquadFilter(), g = ac.createGain(); f.type = 'highpass'; f.frequency.value = 4500; g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8); n.connect(f); f.connect(g); out(g, 0.6); n.start(t); n.stop(t + 3); }
  function boom(t) { var o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.8); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2); o.connect(g); out(g, 0.2); o.start(t); o.stop(t + 2.1); }

  function score(T) {
    var B = 0.5, at2 = function (beat) { return T + beat * B; };
    var CH = [ // bass, pad notes, ostinato [root, fifth, third]
      [38, [50, 53, 57, 62], [50, 57, 65]], [34, [50, 53, 58, 62], [46, 53, 62]], [41, [48, 53, 57, 60], [53, 60, 69]], [36, [48, 52, 55, 60], [48, 55, 64]]];
    braam(26, T, 1.6, 0.08);
    CH.forEach(function (c, bar) {
      var b0 = bar * 4;
      bass(c[0], at2(b0), 1.9, bar ? 0.14 : 0.1);
      c[1].forEach(function (m) { pad(m, at2(b0), 1.95, bar ? 0.034 : 0.026); });
      if (bar) c[1].slice(1).forEach(function (m) { brass(m, at2(b0), 0.35, 0.04); });   // a stab on every chord change
      var pat = [0, 2, 1, 2, 0, 2, 1, 2];
      pat.forEach(function (k, i) { var m = c[2][k] + (k === 2 ? 0 : (i % 2 ? 12 : 0)); pluck(m, at2(b0 + i * 0.5), (bar ? 0.045 : 0.03) * (i % 2 ? 0.8 : 1)); });
    });
    // percussion builds bar by bar
    [0, 3, 3.5].forEach(function (b) { taiko(at2(b), 0.5); });
    [4, 5.5, 6, 7, 8, 9.5, 10, 11, 11.5].forEach(function (b) { taiko(at2(b), 0.62); });
    [12, 13, 14, 14.5, 15, 15.25, 15.5, 15.625, 15.75, 15.875].forEach(function (b, i) { taiko(at2(b), 0.5 + i * 0.04); });
    for (var s = 8; s < 16; s += 0.25) tick(at2(s), 0.03 + (s - 8) * 0.01);
    riser(at2(12), 4 * B);
    // the hero theme on horns
    [[4, 62, 1], [5, 65, 0.5], [5.5, 69, 0.5], [6, 74, 1.9], [8, 72, 1], [9, 69, 0.5], [9.5, 72, 0.5], [10, 77, 1.9], [12, 76, 1.5], [13.5, 74, 0.5], [14, 72, 0.5], [14.5, 76, 1.4]]
      .forEach(function (n) { horn(n[1], at2(n[0]), n[2] * B * 0.95, 0.065); horn(n[1] - 12, at2(n[0]), n[2] * B * 0.95, 0.03); });
    // the title: D major, everything at once
    var H = at2(16);
    boom(H); crash(H); taiko(H, 1); braam(26, H, 2.2, 0.1);
    bass(38, H, 2.2, 0.16);
    [50, 54, 57, 62, 66, 69].forEach(function (m) { pad(m, H, 2.3, 0.032); brass(m, H, 1.6, 0.038); });
    [78, 74, 69].forEach(function (m, i) { horn(m, H, 1.9, i ? 0.04 : 0.07); });
    [17, 17.5, 18].forEach(function (b) { taiko(at2(b), 0.45); });
  }

  /* ---------------- the sequence ---------------- */
  function run() {
    if (running) return; running = true;
    try { if (setupAudio()) score(ac.currentTime + 0.08); } catch (e) {}
    cls('run'); cls('s1'); flare();
    caption('01', 'Plan', 'Scope, WBS, budget and risks: drafted by AI');
    el.querySelectorAll('.ci-wbs li').forEach(function (li, i) { later(function () { li.classList.add('ok'); }, 0.45 + i * 0.2); });
    later(function () { cls('s1', false); cls('s2'); flare(); caption('02', 'Schedule', 'Gantt chart, milestones and baseline'); }, 2.0);
    later(function () { cls('s3'); flare(); caption('03', 'Critical path', 'Zero float. No surprises.'); }, 4.6);
    later(function () { cls('cp'); pulse(); }, 5.6);
    later(function () {
      el.querySelectorAll('.ci-tool').forEach(function (t) { var r = t.getBoundingClientRect(); t.style.setProperty('--cx', (innerWidth / 2 - r.left - r.width / 2) + 'px'); t.style.setProperty('--cy', (innerHeight * 0.46 - r.top - r.height / 2) + 'px'); });
      cls('s4'); cap.classList.remove('on');
      var t0 = performance.now(); (function w() { if (hit) return; warp = Math.min(1, (performance.now() - t0) / 800); if (warp < 1 && !done) requestAnimationFrame(w); })();
    }, 7.2);
    later(function () { hit = true; var t1 = performance.now(); (function d() { warp = Math.max(0, 1 - (performance.now() - t1) / 500); if (warp > 0 && !done) requestAnimationFrame(d); })(); var f = el.querySelector('.ci-flash'); f.classList.add('on'); setTimeout(function () { f.classList.remove('on'); }, 120); cls('s2', false); cls('s3', false); cls('logo'); }, 8.0);
    later(finish, 10.4);
  }
  function pulse() {
    var path = el.querySelector('.ci-net .cp'), dot = el.querySelector('.ci-pulse'), L = path.getTotalLength(), t0 = performance.now();
    (function step() {
      var k = Math.min(1, (performance.now() - t0) / 1700), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, pt = path.getPointAtLength(L * e);
      dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      if (k < 1 && !done) requestAnimationFrame(step);
    })();
  }
  function finish() {
    if (done) return; done = true;
    timers.forEach(clearTimeout);
    try { sessionStorage.setItem('champIntroSeen', '1'); } catch (e) {}
    if (ac) { try { master.gain.cancelScheduledValues(ac.currentTime); master.gain.setValueAtTime(master.gain.value, ac.currentTime); master.gain.linearRampToValueAtTime(0, ac.currentTime + 0.6); } catch (e) {} setTimeout(function () { try { ac.close(); } catch (e) {} }, 900); }
    el.classList.add('gone'); document.documentElement.style.overflow = ''; document.body.classList.remove('ci-on');
    setTimeout(function () { cancelAnimationFrame(raf); window.removeEventListener('resize', size); if (el.parentNode) el.parentNode.removeChild(el); }, 800);
    if (force && history.replaceState) history.replaceState(null, '', location.pathname + location.hash);
  }
  el.querySelector('[data-ci-start]').addEventListener('click', run);
  el.querySelector('[data-ci-skip]').addEventListener('click', finish);
  var mb = el.querySelector('[data-ci-mute]');
  mb.addEventListener('click', function () { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.72; mb.textContent = muted ? '🔇 Sound off' : '🔊 Sound on'; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !done) finish(); });
  window.ChampIntro = { play: run, skip: finish };
  setTimeout(function () { var b = el.querySelector('[data-ci-start]'); if (b && !running) try { b.focus({ preventScroll: true }); } catch (e) {} }, 300);
})();
