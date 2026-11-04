// Wonder Bird sound (v102): an original spy-thriller cue in 5/4, made live in the browser (Web Audio), sound effects,
// and Mr. Fixit's voice ("Mister Fixit!") dropped in at intervals. The music is our own composition in that style
// (minor key, 5/4 groove, ticking hats, bongos, brass stabs, flute line); it does not use any film theme's melody.

let A = null;                 // the audio graph, made on the first tap or key press (browsers require a gesture)
const ST = { music: true, voice: true, level: 1, flying: false, bar: 0, step: 0, next: 0, timer: null, lastVoice: 0 };
try { const s = JSON.parse(localStorage.getItem('mbsWonderBird.sound') || '{}'); if (s.music === false) ST.music = false; if (s.voice === false) ST.voice = false; } catch (e) {}
function keep() { try { localStorage.setItem('mbsWonderBird.sound', JSON.stringify({ music: ST.music, voice: ST.voice })); } catch (e) {} }

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const c = new AC();
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(c.destination);
  const master = c.createGain(); master.gain.value = 0.8; master.connect(comp);
  const music = c.createGain(); music.gain.value = ST.music ? 0.55 : 0;
  const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1400;   // muffled between flights, open while flying
  music.connect(tone); tone.connect(master);
  const sfx = c.createGain(); sfx.gain.value = 0.5; sfx.connect(master);
  const voice = c.createGain(); voice.gain.value = 1; voice.connect(master);
  // a small room: noise burst impulse response
  const rev = c.createConvolver(), len = Math.floor(c.sampleRate * 1.6), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  rev.buffer = ir; const wet = c.createGain(); wet.gain.value = 0.22; rev.connect(wet); wet.connect(music);
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate); { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return { c, master, music, tone, sfx, voice, rev, noise };
}

/* ---------------- instruments ---------------- */
function env(g, t, a, peak, d, sus, r, end) {
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sus), t + a + d);
  g.gain.setValueAtTime(Math.max(0.0002, sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r);
}
function osc(type, f, t, end, dest, detune) { const o = A.c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (detune) o.detune.value = detune; o.connect(dest); o.start(t); o.stop(end + 0.6); return o; }
function bass(n, t, dur) {
  const g = A.c.createGain(), f = A.c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.18);
  g.connect(A.music); f.connect(g); env(g, t, 0.003, 0.62, 0.09, 0.14, 0.04, t + dur * 0.75);
  osc('sawtooth', midi(n), t, t + dur, f); osc('square', midi(n - 12), t, t + dur, f);
}
function hat(t, open, lvl) {
  const s = A.c.createBufferSource(); s.buffer = A.noise;
  const f = A.c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
  const g = A.c.createGain(); s.connect(f); f.connect(g); g.connect(A.music);
  env(g, t, 0.001, lvl || 0.09, open ? 0.18 : 0.035, 0.0003, 0.02, t + (open ? 0.2 : 0.04)); s.start(t); s.stop(t + 0.3);
}
function bongo(t, hi) {
  const g = A.c.createGain(); g.connect(A.music); env(g, t, 0.002, 0.32, 0.12, 0.0004, 0.02, t + 0.13);
  const o = A.c.createOscillator(); o.type = 'sine'; const f0 = hi ? 330 : 220;
  o.frequency.setValueAtTime(f0 * 1.6, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.04); o.connect(g); o.start(t); o.stop(t + 0.2);
}
function rim(t) {
  const g = A.c.createGain(); g.connect(A.music); env(g, t, 0.001, 0.16, 0.03, 0.0003, 0.01, t + 0.035);
  osc('triangle', 1750, t, t + 0.05, g); osc('square', 820, t, t + 0.04, g);
}
function stab(notes, t, dur, lvl) {
  const g = A.c.createGain(), f = A.c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(700, t + dur);
  f.connect(g); g.connect(A.music); g.connect(A.rev); env(g, t, 0.012, lvl || 0.13, 0.15, 0.05, 0.12, t + dur);
  notes.forEach((n) => [-9, 0, 9].forEach((d) => osc('sawtooth', midi(n), t, t + dur, f, d)));
}
function flute(n, t, dur) {
  const g = A.c.createGain(); g.connect(A.music); g.connect(A.rev); env(g, t, 0.04, 0.2, 0.2, 0.13, 0.12, t + dur * 0.92);
  const o = osc('sine', midi(n), t, t + dur, g); const o2 = osc('triangle', midi(n), t, t + dur, g, 2);
  const lfo = A.c.createOscillator(), dep = A.c.createGain(); lfo.frequency.value = 5.4; dep.gain.setValueAtTime(0, t); dep.gain.linearRampToValueAtTime(midi(n) * 0.006, t + Math.min(0.35, dur));
  lfo.connect(dep); dep.connect(o.frequency); dep.connect(o2.frequency); lfo.start(t); lfo.stop(t + dur + 0.6);
  const s = A.c.createBufferSource(); s.buffer = A.noise; const bp = A.c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = midi(n) * 2; bp.Q.value = 3;
  const bg = A.c.createGain(); s.connect(bp); bp.connect(bg); bg.connect(A.music); env(bg, t, 0.01, 0.05, 0.06, 0.004, 0.05, t + dur * 0.6); s.start(t); s.stop(t + dur + 0.2);
}
function strings(notes, t, dur) {
  const g = A.c.createGain(), f = A.c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
  const trem = A.c.createGain(); trem.gain.value = 0.5; const lfo = A.c.createOscillator(), dep = A.c.createGain(); lfo.frequency.value = 11; dep.gain.value = 0.5;
  lfo.connect(dep); dep.connect(trem.gain); lfo.start(t); lfo.stop(t + dur + 0.6);
  f.connect(trem); trem.connect(g); g.connect(A.music); g.connect(A.rev); env(g, t, 0.25, 0.07, 0.3, 0.06, 0.3, t + dur);
  notes.forEach((n) => [-6, 6].forEach((d) => osc('sawtooth', midi(n), t, t + dur, f, d)));
}

function fuse(t, dur) {   // a lit fuse: crackling, hissing noise that sweeps up
  const s = A.c.createBufferSource(); s.buffer = A.noise; s.loop = true;
  const f = A.c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(2500, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
  const g = A.c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.2); g.gain.setValueAtTime(0.12, t + dur - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(A.music); s.start(t); s.stop(t + dur + 0.1);
  for (let k = 0; k < dur * 22; k++) { const tt = t + Math.random() * dur; hat(tt, false, 0.03 + Math.random() * 0.05); }   // crackles
}
function timp(t, n, lvl) {   // timpani: a low boom with a little pitch drop
  const g = A.c.createGain(); g.connect(A.music); g.connect(A.rev); env(g, t, 0.004, lvl || 0.5, 0.35, 0.002, 0.2, t + 0.45);
  const o = A.c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(midi(n) * 1.25, t); o.frequency.exponentialRampToValueAtTime(midi(n), t + 0.08); o.connect(g); o.start(t); o.stop(t + 0.9);
  const s = A.c.createBufferSource(); s.buffer = A.noise; const lp = A.c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; const ng = A.c.createGain(); s.connect(lp); lp.connect(ng); ng.connect(A.music); env(ng, t, 0.002, 0.25, 0.08, 0.001, 0.05, t + 0.1); s.start(t); s.stop(t + 0.3);
}
function horn(n, t, dur) {   // warm brass for the heroic tune
  const g = A.c.createGain(), f = A.c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1; f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(1900, t + 0.12);
  f.connect(g); g.connect(A.music); g.connect(A.rev); env(g, t, 0.06, 0.16, 0.2, 0.12, 0.15, t + dur * 0.92);
  [-7, 0, 7].forEach((d) => osc('sawtooth', midi(n), t, t + dur, f, d)); osc('sawtooth', midi(n - 12), t, t + dur, f, 3);
}
function gallop(n, t, e) {   // low strings, short-short-long, the sailing-ship stride
  [[0, 0.45], [1, 0.45], [2, 0.9]].forEach(([k, l]) => { const g = A.c.createGain(), f = A.c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300; f.connect(g); g.connect(A.music); env(g, t + k * e / 1.5, 0.01, 0.11, 0.08, 0.05, 0.05, t + k * e / 1.5 + l * e); [-5, 5].forEach((d) => osc('sawtooth', midi(n), t + k * e / 1.5, t + k * e / 1.5 + l * e, f, d)); });
}
function swell(t, dur) {   // cymbal roll that rises into the next part
  const s = A.c.createBufferSource(); s.buffer = A.noise; s.loop = true; const f = A.c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
  const g = A.c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
  s.connect(f); f.connect(g); g.connect(A.music); s.start(t); s.stop(t + dur + 0.3);
}
function trill(n, t, dur) {   // fast flute trill, then hold the note
  const e = eighth() / 3, half = dur * 0.5;
  for (let x = 0, k = 0; x < half; x += e, k++) flute(k % 2 ? n + 2 : n, t + x, e * 1.1);
  flute(n, t + half, dur - half);
}

/* ---------------- the score ----------------
   5/4, ten eighth notes a bar, grouped 2+3+2+3. D minor.
   Sections: intro (2 bars) → A (8 bars, flute tune) → B (4 bars, brass and strings, "Mister Fixit!") → A' (8 bars, tune an octave down
   with stabs) → B → round again. Each part is our own. */
const BASS = [[0, 38, 1], [1, 38, 1], [2, 45, 2], [5, 38, 1], [6, 41, 1], [7, 43, 1], [8, 44, 1], [9, 45, 1]];
const TUNE = [
  [2, 69, 2], [4, 72, 1], [5, 74, 3], [8, 77, 1], [9, 76, 1],
  [10, 74, 4], [14, 69, 1], [15, 70, 2], [17, 69, 3],
  [22, 77, 2], [24, 76, 1], [25, 74, 2], [27, 73, 3],
  [30, 74, 6],
  [42, 81, 2], [44, 79, 1], [45, 77, 2], [47, 76, 1], [48, 74, 2],
  [50, 76, 2], [52, 77, 1], [53, 79, 2], [55, 82, 2], [57, 81, 3],
  [62, 86, 1], [63, 84, 1], [64, 82, 1], [65, 81, 2], [67, 79, 1], [68, 77, 1], [69, 76, 1],
  [70, 74, 6], [76, 69, 2], [78, 74, 2]
];
const B_BASS = [0, 0, 5, 7];
// the B part's heroic horn tune (our own), over four bars of ten eighths
const HORN = [[0, 62, 3], [3, 69, 2], [5, 65, 1], [6, 67, 1], [7, 69, 3], [10, 70, 3], [13, 69, 2], [15, 67, 2], [17, 65, 3], [20, 67, 2], [22, 69, 1], [23, 70, 2], [25, 72, 2], [27, 74, 3], [30, 76, 2], [32, 73, 3], [35, 69, 5]];                       // B section: the riff steps up (D, D, G, A)
const B_STABS = [[62, 65, 69, 76], [62, 65, 69, 76], [67, 70, 74, 77], [69, 73, 76, 79]];
const FORM = [['intro', 2], ['A', 8], ['B', 4], ['A2', 8], ['B', 4]];
const FORM_BARS = FORM.reduce((s, x) => s + x[1], 0);
function sectionAt(bar) {
  if (bar < 2) return ['intro', bar];
  let b = (bar - 2) % (FORM_BARS - 2) + 2;
  for (const [name, n] of FORM) { if (b < n) return [name, b]; b -= n; }
  return ['A', 0];
}
const eighth = () => 60 / Math.min(148, 126 + (ST.level - 1) * 0.25) / 2;   // a steady, heavy stride

function playStep(t) {
  const pos = ST.step % 10, bar = ST.bar, [sec, sb] = sectionAt(bar), e = eighth(), busy = ST.level >= 3;
  const shift = sec === 'B' ? B_BASS[sb % 4] : 0;
  for (const [p, n, l] of BASS) if (p === pos) bass(n + shift, t, l * e);
  if (bar === 0 && pos === 0) fuse(t, e * 20);                       // the fuse is lit
  if ([0, 2, 5, 7].includes(pos)) hat(t, false, 0.08);
  if (pos === 5 && sec !== 'B') rim(t);
  if (pos === 3 || pos === 8) bongo(t, true);
  if (busy && pos === 9) bongo(t, false);
  if (pos === 0 && sec !== 'intro') timp(t, 38, sec === 'B' ? 0.55 : 0.35);
  if (sec === 'A' || sec === 'A2') {
    const at = sb * 10 + pos;
    for (const [p, n, l] of TUNE) if (p === at) (l >= 3 ? trill : flute)(sec === 'A2' ? n - 12 : n, t, l * e);
    if (pos === 0 && sb % 2 === 0) strings([50, 57], t, e * 20);
    if ((sb === 3 || sb === 7) && [4, 6, 8].includes(pos)) { const k = [4, 6, 8].indexOf(pos); stab([74 - k * 2, 77 - k * 2, 81 - k * 2], t, e * 0.9, 0.13); }   // brass answers the flute
    if (sec === 'A2' && pos === 0 && sb % 2 === 0) stab([62, 65, 69], t, e * 1.5, 0.09);
  }
  if (sec === 'B') {
    if (pos === 0) { stab(B_STABS[sb], t, e * 2, 0.1); strings(B_STABS[sb].map((n) => n - 12), t, e * 10); }
    if (pos === 0 || pos === 5) gallop(B_STABS[sb][0] - 24, t, e);
    if (pos === 5) timp(t, 38 + B_BASS[sb % 4], 0.45);
    const at = sb * 10 + pos;
    for (const [p, n, l] of HORN) if (p === at) horn(n, t, l * e);
    if (sb === 3 && pos === 0) swell(t, e * 9);
    if (sb === 3 && pos === 6) say('tag');               // "Mister Fixit!" on the last bar of every B section
  }
}
function tick() {
  if (!A || !ST.music) return;
  const now = A.c.currentTime;
  if (ST.next < now) ST.next = now + 0.05;
  while (ST.next < now + 0.25) {
    playStep(ST.next);
    ST.next += eighth(); ST.step++;
    if (ST.step % 10 === 0) ST.bar++;
  }
}

/* ---------------- Mr. Fixit's voice ----------------
   The site's own voice (Azure, Australian "William") when it is set up; otherwise the device's voice. */
const LINES = {
  tag: ['Mister Fixit!'],
  start: ['Mister Fixit here. Pull back and let her fly!', 'Mister Fixit says: steady hands, big score!'],
  stab: ['Mister Fixit to the rescue!'],
  clear: ['Nice flying! Mister Fixit approves.', 'Level done. Mister Fixit is impressed!'],
  best: ['New personal best! Mister Fixit is proud of you.'],
  over: ['Bad luck, mate. Mister Fixit says: one more go!'],
  podium: ['You are on the podium! Mister Fixit says: hang on to it!']
};
const clips = {};   // text → AudioBuffer from the site voice, when available
let serverVoice = null;
function fetchClip(text) {
  if (serverVoice === false || clips[text]) return Promise.resolve(clips[text] || null);
  return fetch('/.netlify/functions/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'en', text }) })
    .then((r) => { if (!r.ok) { if ([404, 405, 503].includes(r.status)) serverVoice = false; return null; } serverVoice = true; return r.arrayBuffer(); })
    .then((b) => b && A ? new Promise((res) => A.c.decodeAudioData(b, res, () => res(null))) : null)
    .then((buf) => { if (buf) clips[text] = buf; return buf; }).catch(() => null);
}
function deviceSay(text) {
  const S = window.speechSynthesis; if (!S) return;
  const u = new SpeechSynthesisUtterance(text), vs = S.getVoices();
  const v = vs.find((x) => /en-AU/i.test(x.lang) && /male|william|lee|james/i.test(x.name)) || vs.find((x) => /en-AU/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang));
  if (v) u.voice = v; u.lang = v ? v.lang : 'en-AU'; u.rate = 1.02; u.pitch = 0.85; u.volume = 1;
  S.cancel(); S.speak(u);
}
function duck(t, len) {
  if (!A) return; const g = A.music.gain, lv = ST.music ? 0.55 : 0;
  g.cancelScheduledValues(t); g.setValueAtTime(lv, t); g.linearRampToValueAtTime(lv * 0.3, t + 0.08); g.setValueAtTime(lv * 0.3, t + len); g.linearRampToValueAtTime(lv, t + len + 0.4);
}
export function say(kind) {
  if (!ST.voice || !A) return;
  const now = A.c.currentTime; if (now - ST.lastVoice < (kind === 'tag' ? 20 : 3)) return;   // not too often
  ST.lastVoice = now;
  const L = LINES[kind] || [kind], text = L[Math.floor(Math.random() * L.length)];
  fetchClip(text).then((buf) => {
    if (!ST.voice) return;
    if (buf) { const s = A.c.createBufferSource(); s.buffer = buf; s.connect(A.voice); duck(A.c.currentTime, buf.duration); s.start(); }
    else { duck(A.c.currentTime, 1.6); deviceSay(text); }
  });
}

/* ---------------- sound effects ---------------- */
function blip(type, f, t, d, lvl, to) {
  const g = A.c.createGain(); g.connect(A.sfx); env(g, t, 0.004, lvl, d * 0.6, lvl * 0.3, 0.05, t + d);
  const o = A.c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d); o.connect(g); o.start(t); o.stop(t + d + 0.1);
}
function whoosh(t, d, lvl, f0, f1) {
  const s = A.c.createBufferSource(); s.buffer = A.noise; const f = A.c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + d);
  const g = A.c.createGain(); s.connect(f); f.connect(g); g.connect(A.sfx); env(g, t, 0.02, lvl, d * 0.5, lvl * 0.2, 0.05, t + d); s.start(t); s.stop(t + d + 0.2);
}
export const sfx = {
  flap() { if (A) whoosh(A.c.currentTime, 0.14, 0.35, 900, 400); },
  coin() { if (!A) return; const t = A.c.currentTime; blip('triangle', 1568, t, 0.07, 0.18); blip('triangle', 2093, t + 0.06, 0.16, 0.16); },
  gem() { if (!A) return; const t = A.c.currentTime; [1047, 1319, 1568, 2093].forEach((f, k) => blip('sine', f, t + k * 0.05, 0.2, 0.15)); },
  stab() { if (!A) return; const t = A.c.currentTime; blip('sawtooth', 220, t, 0.5, 0.12, 880); say('stab'); },
  stabEnd() { if (A) blip('sine', 880, A.c.currentTime, 0.3, 0.1, 330); },
  crash() { if (!A) return; const t = A.c.currentTime; whoosh(t, 0.4, 0.6, 400, 80); blip('sine', 140, t, 0.35, 0.4, 50); },
  launch() { if (A) whoosh(A.c.currentTime, 0.35, 0.5, 300, 1600); },
  win() { if (!A) return; const t = A.c.currentTime; [62, 66, 69, 74].forEach((n, k) => blip('triangle', midi(n + 12), t + k * 0.09, 0.3, 0.16)); }
};

/* ---------------- controls ---------------- */
export function unlock() {
  if (!A) { A = build(); if (!A) return; ST.next = A.c.currentTime + 0.1; ST.timer = setInterval(tick, 50); }
  if (A.c.state === 'suspended') A.c.resume();
  ['tag', 'start', 'stab', 'clear', 'best', 'over', 'podium'].forEach((k) => LINES[k].forEach((t, i) => i === 0 && fetchClip(t)));   // fetch early so they are ready
}
export function setLevel(n) { ST.level = n; }
export function setFlying(on) {
  ST.flying = on; if (!A) return;
  A.tone.frequency.cancelScheduledValues(A.c.currentTime); A.tone.frequency.setTargetAtTime(on ? 16000 : 1400, A.c.currentTime, 0.25);
}
export function setMusic(on) { ST.music = on; keep(); if (A) { A.music.gain.cancelScheduledValues(A.c.currentTime); A.music.gain.setTargetAtTime(on ? 0.55 : 0, A.c.currentTime, 0.05); } }
export function setVoice(on) { ST.voice = on; keep(); if (!on && window.speechSynthesis) window.speechSynthesis.cancel(); }
export function pause(on) { if (!A) return; if (on) A.c.suspend(); else A.c.resume(); }
export const state = () => ({ music: ST.music, voice: ST.voice, started: !!A });
