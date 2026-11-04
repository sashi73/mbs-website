// Wonder Bird (v102): the game page of the MBS website. Rules in wb-core.mjs (shared with the server), sound in wb-audio.mjs.
// A rainbow lorikeet flies past the world's wonders: drag it back on the slingshot, let go, then tap to flap through the gaps
// between sandstone pillars. 99 levels, 3 lives a run. Players who entered the weekly draw (Mr. Fixit, "🎁 Win $50") get their
// runs checked and scored by the server and go on the weekly leaderboard: 1st $50, 2nd $30, 3rd $20 MBS vouchers.
import * as C from './wb-core.mjs';
import * as AU from './wb-audio.mjs';
import { heroFor, drawHero } from './wb-heroes.mjs';
import { shaderSky } from './wb-sky.mjs';

const { W, H } = C;
const $ = (s) => document.querySelector(s);
const canvas = $('#wbCanvas'), ctx = canvas.getContext('2d');
const API = '/.netlify/functions/promo';
const KEY = 'mbsWonderBird.v1';
const fmt = (n) => Math.round(n || 0).toLocaleString('en-AU');

/* ---------------- who is playing ---------------- */
let me = null;   // { id, token, first }
function readMe() {
  let x = null; try { x = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  const q = new URLSearchParams(location.search), wb = q.get('wb');
  if (wb && /^WB-\d{6}\.[a-f0-9]{32}$/.test(wb)) {
    x = { id: wb.split('.')[0], first: q.get('name') || (x && x.first) || '', play: location.pathname + '?wb=' + wb + '&name=' + encodeURIComponent(q.get('name') || '') };
    try { localStorage.setItem(KEY, JSON.stringify(x)); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.hash);   // the private link doesn't stay in the address bar
  }
  const m = x && x.play && String(x.play).match(/[?&]wb=(WB-\d{6})\.([a-f0-9]{32})/);
  me = m ? { id: m[1], token: m[2], first: x.first || '' } : null;
}
readMe();
const PREVIEW = Math.max(0, Math.min(99, parseInt(new URLSearchParams(location.search).get('level') || '0', 10) || 0));
window.addEventListener('mbs:wb-entered', () => { readMe(); G.playsLeft = null; refreshBoard(); if (G.state !== 'flight') newRun(); toast('You’re in the draw, ' + (me ? me.first : '') + '! Your runs now count.'); });
function post(body) {
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error || 'Error ' + r.status)))));
}

/* ---------------- game state ---------------- */
const G = {
  state: 'ready', cfg: C.levelConfig(1), S: null, lives: C.START_LIVES, score: 0, cleared: 0, flaps: 0,
  run: null, seed: null, attempts: [], cur: null, pending: false, award: null, last: null, best: 0, rank: 0, board: null,
  hero: heroFor(1), mood: 'normal', moodT: 0, bubble: null, spin: 0,
  charging: false, pull: 0, aim: 25 * Math.PI / 180, dragging: false, t: 0, flapPulse: 0, wing: 0, sparks: [], feathers: [], shake: 0, msg: ''
};
try { G.best = Number(localStorage.getItem('mbsWonderBird.best') || 0); } catch (e) {}

function newRun() {
  Object.assign(G, { lives: C.START_LIVES, score: 0, cleared: 0, flaps: 0, attempts: [], run: null, seed: null, award: null, msg: '' });
  clearTimeout(G.homeT); G.home = 0;
  if (me && G.playsLeft === 0) { G.state = 'locked'; goHome(10); hud(); return; }
  if (me) {
    G.pending = true; G.state = 'ready';
    post({ action: 'start', id: me.id, token: me.token }).then((r) => { G.run = r.run; G.seed = r.seed; G.play = r.play; G.playsLeft = r.playsLeft; G.pending = false; initLevel(1); hud(); })
      .catch((e) => {
        G.pending = false;
        if (/play for today/.test(e.message)) { G.playsLeft = 0; G.state = 'locked'; goHome(10); hud(); return; }
        G.seed = 'guest-' + Math.random().toString(36).slice(2); G.run = null; G.msg = 'Offline: this play won’t count (' + e.message + ')'; initLevel(1);
      });
  } else { G.seed = 'guest-' + Math.random().toString(36).slice(2); G.run = null; initLevel(PREVIEW || 1); }   // a guest can preview a level with ?level=N (never counts)
  hud();
}
// after a play ends (or with no plays left) the page goes back to the MBS website, unless they play their next go
function goHome(sec) {
  clearTimeout(G.homeT); G.home = Date.now() + sec * 1000;
  G.homeT = setTimeout(() => { if (G.home && Date.now() >= G.home - 50) location.href = 'index.html'; }, sec * 1000);
}
function initLevel(n) {
  G.cfg = C.levelConfig(n); G.hero = heroFor(n); G.mood = 'normal'; G.moodT = 0; G.bubble = null;
  G.cur = { level: G.cfg.n, launch: null, flaps: [] };
  G.S = C.newWorld(G.cfg, C.saltFor(G.seed, G.attempts.length));
  G.state = 'sling'; G.charging = false; G.pull = 0; G.dragging = false; G.sparks = []; G.feathers = []; G.pendingFlap = false;
  scene = makeScene(G.cfg);
  AU.setLevel(n); AU.setFlying(false);
  hud();
}
function launch(dx, dy) {
  const p = G.S.pilot;
  if (dx < 12) { p.x = C.SLING.x; p.y = C.SLING.y; return; }
  G.cur.launch = { x: C.q3(p.x), y: C.q3(p.y), dx: C.q3(dx), dy: C.q3(dy) };
  if (!C.launchOk(G.cur.launch)) { p.x = C.SLING.x; p.y = C.SLING.y; return; }
  C.applyLaunch(G.S, G.cfg, G.cur.launch);
  G.state = 'flight'; AU.setFlying(true); AU.sfx.launch();
  if (G.cfg.n === 1 && G.attempts.length === 0) AU.say('start');
}
function mood(m, frames, text) { G.mood = m; G.moodT = frames; if (text) G.bubble = { text, life: 80 }; }
function pickLine() { const L = G.hero.line; return L[Math.floor(Math.random() * L.length)]; }
// worried when the stonework is close, or falling fast
function autoMood() {
  if (G.moodT > 0) { G.moodT--; return G.mood; }
  if (G.state !== 'flight' || !G.S) return 'normal';
  const p = G.S.pilot, o = G.S.obstacles.find((x) => x.x + x.width > p.x - p.radius && x.x < p.x + 90);
  if (p.vy > 6.5 || p.y < 30 || p.y > C.H - 40) return 'worried';
  if (o && (p.y - o.top < 26 || o.top + G.cfg.gap - p.y < 26)) return 'worried';
  return 'normal';
}
function flap() { if (G.state !== 'flight') return; G.pendingFlap = true; G.flapPulse = 1; G.wing = 1; AU.sfx.flap(); }

function step() {
  G.t++; G.flapPulse *= 0.88; G.spin += 0.25 + G.wing * 0.8; G.curMood = autoMood(); if (G.bubble && --G.bubble.life <= 0) G.bubble = null; G.wing *= 0.9; G.shake *= 0.85;
  for (let i = G.sparks.length - 1; i >= 0; i--) { const s = G.sparks[i]; s.y -= 0.8; if (--s.life <= 0) G.sparks.splice(i, 1); }
  for (let i = G.feathers.length - 1; i >= 0; i--) { const f = G.feathers[i]; f.vy += 0.05; f.x += f.vx; f.y += f.vy; f.r += f.vr; if (--f.life <= 0) G.feathers.splice(i, 1); }
  scene.drift += G.state === 'flight' ? G.S.speed : 0.6;
  if (G.state === 'sling' && G.charging) {
    G.pull = Math.min(C.MAX_PULL, G.pull + 2.5);
    G.S.pilot.x = C.SLING.x - Math.cos(G.aim) * G.pull; G.S.pilot.y = C.SLING.y + Math.sin(G.aim) * G.pull;
  }
  if (G.state !== 'flight') return;
  const f = G.pendingFlap; G.pendingFlap = false;
  const evs = C.step(G.S, G.cfg, f);
  if (f) { G.cur.flaps.push(G.S.frame); G.flaps++; }
  for (const e of evs) {
    if (e.t === 'pick') {
      if (e.kind === 'coin') { G.sparks.push({ x: e.x, y: e.y, life: 45, text: '+' + C.COIN_POINTS, col: '#F2D98B' }); AU.sfx.coin(); mood('happy', 30, Math.random() < 0.18 ? pickLine() : null); }
      else if (e.kind === 'gem') { G.sparks.push({ x: e.x, y: e.y, life: 60, text: '+' + C.GEM_POINTS, col: '#8fd3ff' }); AU.sfx.gem(); mood('wow', 55, ['Ooh, shiny!', 'A gem!', 'Jackpot!'][G.t % 3]); }
      else { G.sparks.push({ x: e.x, y: e.y, life: 80, text: 'MR. FIXIT AUTOPILOT', col: '#F2D98B' }); AU.sfx.stab(); mood('wow', 60, 'Mr. Fixit!'); }
    } else if (e.t === 'stabEnd') AU.sfx.stabEnd();
  }
  if (evs.length) hud();
  if (G.S.dead) crash(); else if (G.S.cleared) cleared();
}
function endAttempt() { G.attempts.push(G.cur); AU.setFlying(false); }
function crash() {
  endAttempt(); AU.sfx.crash(); G.shake = 10; G.lives--; mood('ouch', 99999, ['Ouch!', 'My nose!', 'Who put that there?!', 'Oof!'][G.t % 4]);
  const p = G.S.pilot;
  for (let i = 0; i < 14; i++) G.feathers.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.2, life: 70 + Math.random() * 40, c: ['#2f9e44', '#1c7ed6', '#f76707', '#fab005'][i % 4] });
  if (G.lives <= 0) { G.state = 'over'; if (me && G.run && G.playsLeft != null) G.playsLeft = Math.max(0, G.playsLeft); submit(true); AU.say('over'); goHome(me ? 8 : 12); } else G.state = 'crashed';
  hud();
}
function cleared() {
  endAttempt();
  const st = C.replay({ level: G.cfg.n, salt: C.saltFor(G.seed, G.attempts.length - 1), launch: G.cur.launch, flaps: G.cur.flaps });   // only checked numbers count
  G.award = C.scoreFrom(G.cfg, st); G.last = st;
  G.score += G.award.total; G.cleared++;
  AU.sfx.win(); mood('happy', 99999, ['Woo-hoo!', 'Too easy!', pickLine()][G.t % 3]);
  if (G.cfg.n >= C.TOTAL_LEVELS) { G.state = 'won'; submit(true); goHome(15); } else { G.state = 'levelup'; submit(false); AU.say('clear'); }
  if (G.score > G.best) { G.best = G.score; try { localStorage.setItem('mbsWonderBird.best', String(G.best)); } catch (e) {} }
  hud();
}
// the run so far goes to the server, which replays it and keeps the score
function submit(final) {
  if (!me || !G.run || !G.score && !final) return;
  const before = G.rank;
  post({ action: 'run', id: me.id, token: me.token, run: G.run, attempts: G.attempts }).then((r) => {
    G.rank = r.rank;
    if (r.score !== G.score) G.msg = 'Score checked by the server: ' + fmt(r.score);
    if (r.rank && r.rank <= 3 && (!before || before > 3)) { toast('🏆 You’re #' + r.rank + ' this week: on the voucher podium!'); AU.say('podium'); }
    else if (before && r.rank && r.rank < before) toast('⬆ Up to #' + r.rank + ' this week');
    if (final && r.best === r.score && r.score > 0) AU.say('best');
    refreshBoard();
  }).catch((e) => { G.msg = 'Couldn’t save this run: ' + e.message; });
}

/* ---------------- input ---------------- */
function posOf(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; }
function press(p) {
  AU.unlock();
  if (G.state === 'sling') { const b = G.S.pilot; if (Math.hypot(p.x - b.x, p.y - b.y) < 70) { G.dragging = true; G.charging = false; G.pull = 0; } }
  else if (G.state === 'flight') flap();
  else if (G.state === 'crashed') initLevel(G.cfg.n);
  else if (G.state === 'levelup') initLevel(G.cfg.n + 1);
  else if ((G.state === 'over' || G.state === 'won') && !me) newRun();
  else if (G.state === 'over' || G.state === 'won' || G.state === 'locked') location.href = 'index.html';
}
function drag(p) {
  if (!G.dragging) return;
  const dx = p.x - C.SLING.x, dy = p.y - C.SLING.y, d = Math.hypot(dx, dy), b = G.S.pilot;
  if (d > C.MAX_PULL) { const a = Math.atan2(dy, dx); b.x = C.SLING.x + Math.cos(a) * C.MAX_PULL; b.y = C.SLING.y + Math.sin(a) * C.MAX_PULL; } else { b.x = p.x; b.y = p.y; }
}
function release() { if (G.state !== 'sling' || !G.dragging) return; G.dragging = false; launch(C.SLING.x - G.S.pilot.x, C.SLING.y - G.S.pilot.y); }
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {} press(posOf(e)); });
canvas.addEventListener('pointermove', (e) => { if (G.dragging) { e.preventDefault(); drag(posOf(e)); } });
canvas.addEventListener('pointerup', (e) => { e.preventDefault(); release(); });
canvas.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
  if ($('.fx-panel.open') || $('.wb-pop.open')) return;   // chatting to Mr. Fixit or reading a panel
  if (e.code === 'KeyM') { toggleMusic(); return; }
  if (!['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) return;
  e.preventDefault(); AU.unlock();
  if (G.state === 'sling') {
    if (e.code === 'ArrowUp') G.aim = Math.min(1.05, G.aim + 0.05);
    if (e.code === 'ArrowDown') G.aim = Math.max(-0.25, G.aim - 0.05);
    if (e.code === 'Space' && !G.dragging) G.charging = true;
  } else if (G.state === 'flight') { if (!e.repeat && e.code !== 'ArrowDown') flap(); }
  else if (!e.repeat && e.code === 'Space') press({ x: -999, y: -999 });
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !G.charging) return;
  G.charging = false; launch(Math.cos(G.aim) * G.pull, -Math.sin(G.aim) * G.pull); G.pull = 0;
});
document.addEventListener('visibilitychange', () => AU.pause(document.hidden));

/* ---------------- the look: natural light, real materials ---------------- */
const LIGHT = [   // sunrise, morning, afternoon, sunset, twilight, midnight
  { sky: ['#34406e', '#e3968a', '#ffdca6'], sun: { x: 170, y: 368, r: 40, c: '#ffe2ac', glow: 'rgba(255,170,110,0.6)' }, haze: [226, 176, 150], far: [120, 128, 120], near: [74, 92, 64], ground: ['#4d6a36', '#324a22'], stone: 0.88, tint: 'rgba(255,150,100,0.10)', cloud: [255, 212, 190], stars: 0 },
  { sky: ['#3f78bd', '#8fbde6', '#f4e3c6'], sun: { x: 655, y: 92, r: 30, c: '#fff6da', glow: 'rgba(255,240,200,0.55)' }, haze: [184, 205, 224], far: [126, 150, 128], near: [83, 112, 72], ground: ['#5c7f3f', '#3d5a2a'], stone: 1, tint: null, cloud: [255, 255, 255], stars: 0 },
  { sky: ['#2a68bb', '#78ade6', '#d9eaf6'], sun: { x: 430, y: 52, r: 27, c: '#fffbea', glow: 'rgba(255,252,235,0.5)' }, haze: [200, 216, 232], far: [132, 156, 132], near: [88, 118, 74], ground: ['#62853f', '#40602b'], stone: 1.06, tint: null, cloud: [255, 255, 255], stars: 0 },
  { sky: ['#232f58', '#a4566a', '#f3a55c'], sun: { x: 560, y: 352, r: 44, c: '#ffd59a', glow: 'rgba(255,150,80,0.6)' }, haze: [196, 128, 120], far: [94, 72, 88], near: [60, 52, 64], ground: ['#3a2f30', '#231c1e'], stone: 0.8, tint: 'rgba(255,120,50,0.13)', cloud: [255, 196, 170], stars: 0 },
  { sky: ['#0f1533', '#35305f', '#86597a'], sun: { x: 620, y: 452, r: 14, c: '#ffb48c', glow: 'rgba(210,120,150,0.35)' }, haze: [96, 84, 124], far: [56, 54, 80], near: [36, 36, 56], ground: ['#232236', '#15141f'], stone: 0.58, tint: 'rgba(70,45,120,0.22)', cloud: [170, 140, 185], stars: 0.45 },
  { sky: ['#02050d', '#0b1530', '#1e2c4f'], sun: { x: 630, y: 82, r: 20, c: '#f4f1e6', glow: 'rgba(200,215,255,0.22)', moon: true }, haze: [40, 52, 82], far: [28, 36, 56], near: [18, 24, 40], ground: ['#151b2b', '#0b0f19'], stone: 0.45, tint: 'rgba(20,35,90,0.28)', cloud: [120, 135, 170], stars: 1 }
];
const rgb = (a, k = 1, al = 1) => `rgba(${Math.round(a[0] * k)},${Math.round(a[1] * k)},${Math.round(a[2] * k)},${al})`;
// where each wonder stands: the land colours change with it (lit by the time of day)
const BIOME_OF = { 'Giza Pyramids': 'desert', 'Great Sphinx': 'desert', 'Petra': 'desert', 'Persepolis': 'desert', 'Shibam Towers': 'desert', 'Burj Khalifa': 'desert', 'Mesa Verde': 'desert', 'Cappadocia Spires': 'desert',
  'Uluru': 'outback', 'Sydney Opera House': 'water', 'Sydney Harbour Bridge': 'water', 'Golden Gate Bridge': 'water', 'Mount Fuji': 'snow', 'Potala Palace': 'snow' };
const BIOMES = {
  green: { far: [126, 150, 128], near: [83, 112, 72], ground: [92, 127, 63] },
  desert: { far: [214, 180, 128], near: [196, 156, 98], ground: [204, 164, 104], dunes: true },
  outback: { far: [196, 120, 74], near: [172, 92, 52], ground: [180, 96, 54], dunes: true },
  water: { far: [104, 132, 120], near: [52, 104, 140], ground: [44, 88, 120], water: true },
  snow: { far: [150, 168, 182], near: [96, 122, 98], ground: [88, 118, 76] }
};
const TIME_K = [{ k: 0.86, mix: [255, 150, 110, 0.18] }, { k: 1, mix: null }, { k: 1.05, mix: null }, { k: 0.78, mix: [255, 120, 70, 0.22] }, { k: 0.5, mix: [80, 60, 140, 0.3] }, { k: 0.34, mix: [40, 60, 130, 0.35] }];
function landCol(col, time) { const t = TIME_K[time]; let c = col.map((v) => v * t.k); if (t.mix) c = c.map((v, i) => v * (1 - t.mix[3]) + t.mix[i] * t.mix[3] * t.k * 1.4); return c; }
// the real colours of some wonders (white sails, orange bridge, red rock…)
const WCOL = { 'Sydney Opera House': [238, 234, 222], 'Taj Mahal': [240, 234, 224], 'Golden Gate Bridge': [196, 74, 40], 'Sydney Harbour Bridge': [112, 118, 126], 'Eiffel Tower': [116, 96, 76],
  'Uluru': [196, 92, 52], 'Burj Khalifa': [176, 190, 206], 'Colosseum': [208, 182, 142], 'Petra': [196, 120, 92], 'Great Sphinx': [214, 180, 128], 'Stonehenge': [150, 150, 140], 'Hagia Sophia': [204, 170, 150],
  'Saint Basil Cathedral': [196, 80, 70], 'Tower of Pisa': [236, 230, 216], 'Angkor Wat': [140, 132, 112], 'Borobudur': [120, 116, 104], 'Chichen Itza': [190, 176, 150], 'Alhambra': [200, 140, 100] };
let scene = null;
function off(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function makeScene(cfg) {
  const L0 = LIGHT[cfg.time], rnd = C.mulberry32(C.hashU32('scene' + cfg.n)), bio = BIOMES[BIOME_OF[cfg.wonder] || 'green'];
  const L = Object.assign({}, L0, { far: bio === BIOMES.green ? L0.far : landCol(bio.far, cfg.time), near: bio === BIOMES.green ? L0.near : landCol(bio.near, cfg.time),
    ground: bio === BIOMES.green ? L0.ground : [rgb(landCol(bio.ground, cfg.time)), rgb(landCol(bio.ground, cfg.time), 0.7)], bio });
  // sky, sun or moon, stars
  const sky = off(W * 2, H * 2), s = sky.getContext('2d'); s.scale(2, 2);
  const g = s.createLinearGradient(0, 0, 0, H); g.addColorStop(0, L.sky[0]); g.addColorStop(0.62, L.sky[1]); g.addColorStop(1, L.sky[2]);
  s.fillStyle = g; s.fillRect(0, 0, W, H);
  if (L.stars) for (let i = 0; i < 160 * L.stars; i++) { s.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.7})`; const r = rnd() < 0.08 ? 1.4 : 0.7; s.beginPath(); s.arc(rnd() * W, rnd() * H * 0.7, r, 0, 7); s.fill(); }
  const su = L.sun, gl = s.createRadialGradient(su.x, su.y, su.r * 0.6, su.x, su.y, su.r * 6);
  gl.addColorStop(0, su.glow); gl.addColorStop(1, 'rgba(255,255,255,0)'); s.fillStyle = gl; s.fillRect(0, 0, W, H);
  const core = s.createRadialGradient(su.x, su.y, 0, su.x, su.y, su.r * 1.6); core.addColorStop(0, '#ffffff'); core.addColorStop(0.55, su.c); core.addColorStop(1, 'rgba(255,255,255,0)');
  s.fillStyle = core; s.beginPath(); s.arc(su.x, su.y, su.r * 1.6, 0, 7); s.fill();
  if (su.moon) { s.fillStyle = 'rgba(180,185,200,0.35)'; [[-6, -5, 5], [7, 4, 4], [-2, 9, 3]].forEach(([x, y, r]) => { s.beginPath(); s.arc(su.x + x, su.y + y, r, 0, 7); s.fill(); }); }
  // v105: the realistic sky from the graphics card, when it can (otherwise the canvas sky above stays)
  const biomeKey = BIOME_OF[cfg.wonder] || 'green';
  const gsky = shaderSky(L, W, H, 2, { seed: C.hashU32('sky' + cfg.n) % 1000, cover: [0.5, 0.42, 0.36, 0.55, 0.45, 0.3][cfg.time] * (biomeKey === 'desert' || biomeKey === 'outback' ? 0.6 : 1),
    amp: { green: 0.22, snow: 0.34, water: 0.14, desert: 0.05, outback: 0.04 }[biomeKey], snow: biomeKey === 'snow' ? 1 : biomeKey === 'green' ? 0.25 : 0,
    mount: landCol(biomeKey === 'desert' || biomeKey === 'outback' ? [190, 150, 110] : [92, 108, 128], cfg.time), mount2: landCol(biomeKey === 'desert' ? [200, 160, 105] : biomeKey === 'outback' ? [170, 95, 60] : [78, 98, 80], cfg.time) });
  if (gsky) { s.clearRect(0, 0, W, H); s.drawImage(gsky, 0, 0, W, H); }
  // the wonder, far away in the haze
  const won = off(W, H), w = won.getContext('2d');
  w.fillStyle = rgb(WCOL[cfg.wonder] ? landCol(WCOL[cfg.wonder], cfg.time) : L.far); if (cfg.style === 'pyramid') drawGiza(w, cfg, L); else drawWonder(w, cfg, WCOL[cfg.wonder] ? Object.assign({}, L, { far: landCol(WCOL[cfg.wonder], cfg.time) }) : L);
  w.globalCompositeOperation = 'source-atop';
  const lit = w.createLinearGradient(L.sun.x, 0, L.sun.x - 700, 0); lit.addColorStop(0, rgb(L.cloud, 1, L.stars ? 0.08 : 0.28)); lit.addColorStop(0.5, 'rgba(0,0,0,0)'); lit.addColorStop(1, 'rgba(0,0,0,0.22)');
  w.fillStyle = lit; w.fillRect(0, 0, W, H);
  w.globalCompositeOperation = 'source-over';
  const hz = w.createLinearGradient(0, 0, 0, H); hz.addColorStop(0, rgb(L.haze, 1, 0.0)); hz.addColorStop(1, rgb(L.haze, 1, cfg.style === 'pyramid' ? 0.3 : 0.55));
  w.globalCompositeOperation = 'source-atop'; w.fillStyle = hz; w.fillRect(0, 0, W, H); w.globalCompositeOperation = 'source-over';
  // two rows of hills (seamless every 1600 px)
  const hills = [0, 1].map((k) => {
    const c = off(1600, H), h = c.getContext('2d'), base = H - (k ? 34 : 70), amp = (k ? 26 : 46) * (bio.dunes ? 0.7 : 1), ph = rnd() * 6;
    if (k && bio.water) {   // a harbour instead of near hills: water with light on it
      const wg = h.createLinearGradient(0, H - 60, 0, H); wg.addColorStop(0, rgb(L.near, 1.15)); wg.addColorStop(1, rgb(L.near, 0.55));
      h.fillStyle = wg; h.fillRect(0, H - 60, 1600, 60);
      for (let i = 0; i < 220; i++) { const x = rnd() * 1600, y = H - 58 + Math.pow(rnd(), 1.6) * 56; h.fillStyle = rgb(L.cloud, 1, 0.08 + rnd() * 0.22); h.fillRect(x, y, 6 + rnd() * 26, 1); }
      return c;
    }
    const col = k ? L.near : L.far, gg = h.createLinearGradient(0, base - amp * 2, 0, H);
    gg.addColorStop(0, rgb(col, k ? 1 : 1.05)); gg.addColorStop(1, rgb(col, 0.7));
    h.fillStyle = gg; h.beginPath(); h.moveTo(0, H);
    for (let x = 0; x <= 1600; x += 8) h.lineTo(x, base - amp * (0.55 * Math.sin(x / 1600 * Math.PI * 2 * 3 + ph) + 0.3 * Math.sin(x / 1600 * Math.PI * 2 * 7 + ph * 2) + 0.15 * Math.sin(x / 1600 * Math.PI * 2 * 17)));
    h.lineTo(1600, H); h.closePath(); h.fill();
    if (bio.dunes) {   // wind ripples on the sand, light on the crests
      for (let i = 0; i < 520; i++) { const x = rnd() * 1600, y = base - amp * 0.6 + rnd() * (H - base + amp); h.strokeStyle = rgb(col, rnd() < 0.5 ? 1.18 : 0.82, 0.25); h.lineWidth = 1; h.beginPath(); h.moveTo(x, y); h.quadraticCurveTo(x + 9, y - 2, x + 18 + rnd() * 10, y); h.stroke(); }
      h.globalCompositeOperation = 'source-atop'; const sh = h.createLinearGradient(0, base - amp, 0, base + amp); sh.addColorStop(0, rgb(L.cloud, 1, 0.18)); sh.addColorStop(1, 'rgba(0,0,0,0)'); h.fillStyle = sh; h.fillRect(0, 0, 1600, H); h.globalCompositeOperation = 'source-over';
    } else if (k) for (let i = 0; i < 260; i++) { const x = rnd() * 1600, y = base + 6 + rnd() * 30; h.fillStyle = rgb(col, 0.8 + rnd() * 0.4, 0.5); h.beginPath(); h.arc(x, y, 1 + rnd() * 3, 0, 7); h.fill(); }   // shrubs
    return c;
  });
  // clouds: soft, lit from above
  const clouds = [];
  for (let i = 0; i < (gsky ? 2 : 6); i++) {
    const cw = 160 + rnd() * 160, ch = 60 + rnd() * 30, c = off(cw, ch), cc = c.getContext('2d');
    for (let k = 0; k < 14; k++) {
      const x = cw * 0.15 + rnd() * cw * 0.7, y = ch * 0.45 + rnd() * ch * 0.25, r = ch * (0.22 + rnd() * 0.22);
      const rg = cc.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
      rg.addColorStop(0, rgb(L.cloud, 1, L.stars ? 0.25 : 0.85)); rg.addColorStop(0.7, rgb(L.cloud, 0.9, L.stars ? 0.12 : 0.45)); rg.addColorStop(1, rgb(L.cloud, 0.85, 0));
      cc.fillStyle = rg; cc.beginPath(); cc.arc(x, y, r, 0, 7); cc.fill();
    }
    clouds.push({ c, x: rnd() * 1400, y: 20 + rnd() * 150, k: 0.06 + rnd() * 0.08 });
  }
  // soft focus on the far layers (depth)
  const soft = (src, px) => { const c = off(src.width, src.height), x = c.getContext('2d'); try { x.filter = 'blur(' + px + 'px)'; } catch (e) {} x.drawImage(src, 0, 0); return x.filter && x.filter !== 'none' ? c : src; };
  const wonSoft = soft(won, cfg.style === 'pyramid' ? 0.35 : 1.2), hillsSoft = [soft(hills[0], 0.8), hills[1]];
  // light rays from the sun (not at night)
  const rays = off(W, H), ry = rays.getContext('2d');
  if (!L.stars) {
    ry.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.55 + (rnd() - 0.5) * 1.1, len = 900, wdt = 0.03 + rnd() * 0.05;
      const gr = ry.createRadialGradient(su.x, su.y, 0, su.x, su.y, len); gr.addColorStop(0, rgb(L.cloud, 1, 0.16)); gr.addColorStop(1, rgb(L.cloud, 1, 0));
      ry.fillStyle = gr; ry.beginPath(); ry.moveTo(su.x, su.y); ry.arc(su.x, su.y, len, a - wdt, a + wdt); ry.closePath(); ry.fill();
    }
  }
  // foreground: dark gum leaves and grass passing close to the camera, out of focus
  const fg = off(2400, H), f = fg.getContext('2d');
  try { f.filter = 'blur(2.5px)'; } catch (e) {}
  const leafCol = rgb(L.near, 0.35);
  if (bio.dunes || bio.water) for (let i = 0; i < 18; i++) { const x = rnd() * 2400; f.fillStyle = rgb(L.near, 0.45); f.beginPath(); f.ellipse(x, H - 2, 10 + rnd() * 26, 6 + rnd() * 10, 0, Math.PI, 0); f.fill(); }
  else for (let i = 0; i < 26; i++) {   // grass tufts along the bottom
    const x = rnd() * 2400; f.fillStyle = leafCol;
    for (let k = 0; k < 9; k++) { const bx = x + k * 4 - 18, hgt = 22 + rnd() * 38, lean = (rnd() - 0.5) * 18; f.beginPath(); f.moveTo(bx - 3, H); f.quadraticCurveTo(bx + lean * 0.4, H - hgt * 0.6, bx + lean, H - hgt); f.quadraticCurveTo(bx + lean * 0.4 + 2, H - hgt * 0.5, bx + 3, H); f.fill(); }
  }
  // vignette and a colour grade for the time of day
  const vig = off(W, H), v = vig.getContext('2d');
  const vg = v.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  v.fillStyle = vg; v.fillRect(0, 0, W, H);
  if (L.tint) { v.globalCompositeOperation = 'source-over'; v.fillStyle = L.tint.replace(/[\d.]+\)$/, '0.08)'); v.fillRect(0, 0, W, H); }
  const motes = Array.from({ length: 34 }, () => ({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 1.6, s: 0.15 + rnd() * 0.5, p: rnd() * 6 }));
  return { L, sky, won: wonSoft, hills: hillsSoft, clouds, rays, fg, vig, motes, drift: 0, pillars: new Map() };
}

// Giza: the three pyramids with sunlit and shaded faces, stone courses, the smooth cap on Khafre, small queens' pyramids
// and the Sphinx, standing on the sand
function drawGiza(c, cfg, L) {
  const sand = landCol([222, 186, 128], cfg.time), sunRight = L.sun.x > W / 2, base = H - 62;
  const pyr = (cx, hw, ht, cap) => {
    const ax = cx + hw * 0.08, ay = base - ht, mid = cx + hw * (sunRight ? 0.22 : -0.22);
    const faces = [[cx - hw, mid, sunRight ? 0.62 : 1.04], [mid, cx + hw, sunRight ? 1.04 : 0.62]];
    for (const [x0, x1, k] of faces) {
      c.save(); c.beginPath(); c.moveTo(x0, base); c.lineTo(ax, ay); c.lineTo(x1, base); c.closePath(); c.clip();
      const g = c.createLinearGradient(0, ay, 0, base); g.addColorStop(0, rgb(sand, k * 1.06)); g.addColorStop(1, rgb(sand, k * 0.9)); c.fillStyle = g; c.fillRect(cx - hw - 2, ay - 2, hw * 2 + 4, ht + 4);
      for (let y = ay + 3; y < base; y += 3.2) { c.fillStyle = `rgba(60,40,20,${0.08 + ((y * 7) % 5) * 0.012})`; c.fillRect(cx - hw, y, hw * 2, 0.7); }   // stone courses
      for (let i = 0; i < ht * 1.4; i++) { c.fillStyle = `rgba(${i % 2 ? '70,45,20' : '255,240,210'},0.07)`; c.fillRect(cx - hw + ((i * 37) % (hw * 2)), ay + ((i * 53) % ht), 2, 1.5); }   // worn stones
      if (cap) { c.fillStyle = rgb(sand, k * 1.12); c.beginPath(); c.moveTo(ax - ht * 0.14, ay + ht * 0.16); c.lineTo(ax, ay); c.lineTo(ax + ht * 0.14, ay + ht * 0.16); c.fill(); }   // Khafre's remaining casing
      c.restore();
    }
    c.strokeStyle = 'rgba(40,25,10,0.25)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(mid, base); c.lineTo(ax, ay); c.stroke();
  };
  pyr(W / 2 + 230, 70, 92);            // Menkaure, furthest
  [[W / 2 + 330, 16, 20], [W / 2 + 362, 13, 16], [W / 2 + 390, 11, 13]].forEach(([x, hw, ht]) => pyr(x, hw, ht));   // queens' pyramids
  pyr(W / 2 + 70, 150, 205, true);     // Khafre
  pyr(W / 2 - 150, 165, 222);          // Khufu, the Great Pyramid
  // the Sphinx, low in front
  const sx = W / 2 - 330, sb = base + 2, sk = rgb(sand, 0.8), sl = rgb(sand, 1.02);
  c.fillStyle = sk; c.beginPath(); c.moveTo(sx, sb); c.lineTo(sx + 6, sb - 14); c.lineTo(sx + 70, sb - 16); c.lineTo(sx + 78, sb - 26); c.quadraticCurveTo(sx + 86, sb - 40, sx + 96, sb - 34); c.lineTo(sx + 100, sb - 20); c.lineTo(sx + 118, sb - 6); c.lineTo(sx + 120, sb); c.fill();
  c.fillStyle = sl; c.fillRect(sx + 10, sb - 15, 58, 4); c.fillRect(sx + 98, sb - 5, 22, 3);
  // sand in front, softly lit
  const sg = c.createLinearGradient(0, base - 10, 0, H); sg.addColorStop(0, rgb(sand, 1.02)); sg.addColorStop(1, rgb(sand, 0.8));
  c.fillStyle = sg; c.beginPath(); c.moveTo(0, base + 6); for (let x = 0; x <= W; x += 20) c.lineTo(x, base + 4 + Math.sin(x / 90) * 4); c.lineTo(W, H); c.lineTo(0, H); c.fill();
}

// the wonders, as far-off silhouettes (shapes from the original Wonders Flight)
function drawWonder(c, lc, L) {
  const mid = W / 2 + 60, base = H - 60, j = lc.jitter, tri = (a, b, d, e, f, g) => { c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.lineTo(f, g); c.closePath(); c.fill(); };
  const near = rgb(L.far, 0.88);
  switch (lc.style) {
    case 'pyramid': tri(mid - 170, base, mid - 20, base - 230, mid + 130, base); c.fillStyle = near; tri(mid + 60, base, mid + 170, base - 160, mid + 280, base); break;
    case 'dome': c.fillRect(mid - 140, base - 140, 280, 140); c.beginPath(); c.ellipse(mid, base - 140, 80, 92, 0, Math.PI, 0); c.fill(); c.fillRect(mid - 3, base - 260, 6, 30); c.fillStyle = near; c.fillRect(mid - 186, base - 190, 16, 190); c.fillRect(mid + 170, base - 190, 16, 190); break;
    case 'tower': c.beginPath(); c.moveTo(mid - 90, base); c.quadraticCurveTo(mid - 30, base - 120, mid - 14, base - 270); c.lineTo(mid + 14, base - 270); c.quadraticCurveTo(mid + 30, base - 120, mid + 90, base); c.fill(); c.fillRect(mid - 3, base - 320, 6, 52); break;
    case 'arches': c.fillRect(mid - 190, base - 160, 380, 160); c.globalCompositeOperation = 'destination-out'; for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) { const x = mid - 172 + i * 62, y = base - 20 - r * 72; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 34); c.arc(x + 18, y - 34, 18, Math.PI, 0); c.lineTo(x + 36, y); c.fill(); } c.globalCompositeOperation = 'source-over'; break;
    case 'ziggurat': for (let i = 0; i < 6; i++) { const wd = 320 - i * 50; c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(mid - wd / 2, base - (i + 1) * 34, wd, 34); } break;
    case 'monolith': for (let i = 0; i < 5; i++) { const x = mid - 180 + i * 90, ht = 110 + ((i * 37 + j * 50) % 60); c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(x, base - ht, 44, ht); } c.fillRect(mid - 180, base - 172, 316, 16); break;
    case 'bridge': c.fillRect(0, base - 80, W, 10); c.fillStyle = near; c.fillRect(mid - 170, base - 240, 22, 240); c.fillRect(mid + 148, base - 240, 22, 240); c.strokeStyle = near; c.lineWidth = 3; c.beginPath(); c.moveTo(mid - 159, base - 236); c.quadraticCurveTo(mid, base - 60, mid + 159, base - 236); c.moveTo(mid - 159, base - 236); c.quadraticCurveTo(mid - 330, base - 120, mid - 420, base - 80); c.stroke(); break;
    case 'arch': c.lineWidth = 16; c.strokeStyle = rgb(L.far); c.beginPath(); c.moveTo(mid - 230, base - 70); c.quadraticCurveTo(mid, base - 330, mid + 230, base - 70); c.stroke(); c.fillRect(mid - 300, base - 90, 600, 10); c.fillStyle = near; c.fillRect(mid - 270, base - 120, 34, 120); c.fillRect(mid + 236, base - 120, 34, 120); break;
    case 'pagoda': for (let i = 0; i < 4; i++) { const wd = 250 - i * 50, y = base - (i + 1) * 52; c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(mid - wd / 2 + 12, y, wd - 24, 40); c.beginPath(); c.moveTo(mid - wd / 2 - 16, y + 4); c.quadraticCurveTo(mid, y - 30, mid + wd / 2 + 16, y + 4); c.fill(); } break;
    case 'skyline': for (let i = 0; i < 9; i++) { const x = i * (W / 9), ht = 70 + ((i * 53 + j * 120) % 210); c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(x + 6, base - ht, W / 9 - 12, ht); } c.fillStyle = rgb(L.far); c.beginPath(); c.moveTo(mid - 16, base); c.lineTo(mid - 4, base - 330); c.lineTo(mid + 4, base - 330); c.lineTo(mid + 16, base); c.fill(); break;
    case 'terrace': for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(mid - 210 + i * 18, base - (i + 1) * 30, 420 - i * 36, 30); } tri(mid + 40, base - 180, mid + 170, base - 330, mid + 300, base - 120); break;
    case 'wall': c.fillRect(0, base - 60, W, 60); c.fillStyle = near; for (let i = 0; i < 28; i++) c.fillRect(i * 30, base - 74, 16, 16); for (let i = 0; i < 3; i++) c.fillRect(90 + i * 260, base - 130, 56, 130); break;
    case 'columns': c.fillRect(mid - 220, base - 22, 440, 22); for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(mid - 200 + i * 54, base - 170, 22, 150); } c.fillStyle = near; c.fillRect(mid - 220, base - 190, 440, 20); break;
    case 'mountain': c.beginPath(); c.moveTo(mid - 300, base); c.lineTo(mid - 40, base - 270); c.lineTo(mid + 40, base - 270); c.lineTo(mid + 300, base); c.fill(); c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.moveTo(mid - 92, base - 214); c.lineTo(mid - 40, base - 270); c.lineTo(mid + 40, base - 270); c.lineTo(mid + 96, base - 210); c.lineTo(mid + 50, base - 222); c.lineTo(mid + 10, base - 205); c.lineTo(mid - 30, base - 225); c.fill(); break;
    case 'rock': c.beginPath(); c.moveTo(mid - 300, base); c.bezierCurveTo(mid - 280, base - 120, mid - 200, base - 132, mid - 40, base - 136); c.bezierCurveTo(mid + 160, base - 138, mid + 250, base - 110, mid + 290, base); c.fill(); break;
    case 'sails': for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? near : rgb(L.far, 1.15); c.beginPath(); c.moveTo(mid - 220 + i * 80, base - 20); c.quadraticCurveTo(mid - 200 + i * 80, base - 170 + i * 8, mid - 110 + i * 80, base - 20); c.fill(); } c.fillStyle = near; c.fillRect(mid - 260, base - 22, 470, 22); break;
    case 'castle': c.fillRect(mid - 130, base - 150, 260, 150); c.fillStyle = near; [-150, 108].forEach((dx) => { c.fillRect(mid + dx, base - 230, 42, 230); tri(mid + dx - 8, base - 230, mid + dx + 21, base - 296, mid + dx + 50, base - 230); }); break;
    case 'spires': for (let i = 0; i < 5; i++) { const x = mid - 170 + i * 85, ht = 150 + ((i * 61 + j * 90) % 130); c.fillStyle = i % 2 ? near : rgb(L.far); c.fillRect(x, base - ht, 40, ht); tri(x - 6, base - ht, x + 20, base - ht - 52, x + 46, base - ht); } break;
    default: break;
  }
}

// sandstone pillars, built course by course (Sydney sandstone, like a good retaining wall)
function pillarTex(o, height, top) {
  const key = Math.round(o.width) + '|' + Math.round(o.look * 1000) + '|' + top;
  let c = scene.pillars.get(key); if (c) return c;
  const wd = Math.round(o.width) + 16; c = off(wd, H); const p = c.getContext('2d'), r = C.mulberry32(C.hashU32(key)), L = scene.L;
  const k = L.stone, base = [196, 158, 104];
  const body = (x0, w0) => {
    const g = p.createLinearGradient(x0, 0, x0 + w0, 0);
    g.addColorStop(0, rgb(base, 0.62 * k)); g.addColorStop(0.18, rgb(base, 0.98 * k)); g.addColorStop(0.55, rgb(base, 1.08 * k)); g.addColorStop(1, rgb(base, 0.55 * k));
    p.fillStyle = g; p.fillRect(x0, 0, w0, H);
    for (let y = 0, row = 0; y < H; y += 26, row++) {   // block courses
      const off2 = row % 2 ? w0 / 2 : 0;
      for (let x = x0 - off2; x < x0 + w0; x += w0 / 1.5) { p.fillStyle = `rgba(${r() < 0.5 ? '90,60,30' : '255,240,210'},${0.05 + r() * 0.08})`; p.fillRect(Math.max(x0, x), y, Math.min(w0 / 1.5, x0 + w0 - Math.max(x0, x)), 26); }
      p.fillStyle = 'rgba(60,40,20,0.35)'; p.fillRect(x0, y, w0, 1.6);
      for (let x = x0 - off2 + w0 / 1.5; x < x0 + w0; x += w0 / 1.5) p.fillRect(x, y, 1.4, 26);
    }
    for (let i = 0; i < w0 * 3; i++) { p.fillStyle = `rgba(${r() < 0.5 ? '70,45,20' : '255,245,220'},${r() * 0.12})`; p.fillRect(x0 + r() * w0, r() * H, 1 + r() * 2, 1 + r() * 2); }   // grain
  };
  body(8, wd - 16);
  // cap stones: a wider slab with a shadow under it
  const capY = top ? 0 : H - 24; p.fillStyle = rgb(base, 0.92 * k); p.fillRect(0, capY, wd, 24);
  const cg = p.createLinearGradient(0, capY, 0, capY + 24); cg.addColorStop(0, 'rgba(255,240,210,0.25)'); cg.addColorStop(1, 'rgba(50,30,10,0.35)'); p.fillStyle = cg; p.fillRect(0, capY, wd, 24);
  for (let i = 0; i < wd / 3; i++) { const mx = r() * wd, my = top ? 18 + r() * 6 : H - 24 + r() * 5; p.fillStyle = `rgba(${70 + r() * 40},${100 + r() * 40},${40 + r() * 20},${0.5 + r() * 0.4})`; p.beginPath(); p.arc(mx, my, 1 + r() * 2.6, 0, 7); p.fill(); }   // moss
  const rim = p.createLinearGradient(wd - 14, 0, wd - 8, 0); rim.addColorStop(0, 'rgba(255,230,180,0)'); rim.addColorStop(1, `rgba(255,230,180,${0.22 * k})`); p.fillStyle = rim; p.fillRect(wd - 14, 0, 6, H);
  scene.pillars.set(key, c); return c;
}

function drawPillars() {
  const cfg = G.cfg, L = scene.L;
  for (const o of G.S.obstacles) {
    const bottom = o.top + cfg.gap, top = pillarTex(o, H, true), bot = pillarTex(o, H, false);
    // top pillar: its cap sits at the gap
    ctx.drawImage(top, 0, 0, top.width, 24, o.x - 8, o.top - 24, top.width, 24);
    ctx.drawImage(top, 0, 24, top.width, H - 24, o.x - 8, o.top - H, top.width, H - 24);   // body above the cap
    ctx.drawImage(bot, 0, H - 24, bot.width, 24, o.x - 8, bottom, bot.width, 24);
    ctx.drawImage(bot, 0, 0, bot.width, H - 24, o.x - 8, bottom + 24, bot.width, H - 24);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(o.x - 8, o.top, o.width + 16, 5); ctx.fillRect(o.x - 8, bottom - 4, o.width + 16, 4);   // soft contact shadows
    if (L.tint) { ctx.fillStyle = L.tint; ctx.fillRect(o.x - 8, 0, o.width + 16, o.top); ctx.fillRect(o.x - 8, bottom, o.width + 16, H - bottom); }
  }
}

function drawPickup(type, x, y) {
  const t = G.t;
  ctx.save(); ctx.translate(x, y);
  const gc = type === 'gem' ? '120,190,255' : '242,217,139', glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  glow.addColorStop(0, `rgba(${gc},0.45)`); glow.addColorStop(1, `rgba(${gc},0)`); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
  if (type === 'coin') {
    const sx = Math.max(0.18, Math.abs(Math.cos(t * 0.07 + x * 0.01)));
    ctx.scale(sx, 1);
    const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 11); g.addColorStop(0, '#fff3c4'); g.addColorStop(0.45, '#e6bf55'); g.addColorStop(1, '#8a6a1f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(90,64,16,0.8)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(90,64,16,0.85)'; ctx.font = '900 9px Archivo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', 0, 0.5);
  } else if (type === 'gem') {
    const bob = Math.sin(t * 0.08) * 2; ctx.translate(0, bob);
    const g = ctx.createLinearGradient(-10, -12, 10, 12); g.addColorStop(0, '#d7f1ff'); g.addColorStop(0.5, '#3a8ee6'); g.addColorStop(1, '#173f8a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(11, -3); ctx.lineTo(0, 13); ctx.lineTo(-11, -3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-11, -3); ctx.lineTo(11, -3); ctx.moveTo(-5, -3); ctx.lineTo(0, 13); ctx.lineTo(5, -3); ctx.stroke();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 0.2); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4, -6, 1.6, 0, 7); ctx.fill();
  } else {   // Mr. Fixit autopilot: a gold drill badge
    const pulse = 1 + Math.sin(t * 0.12) * 0.06; ctx.scale(pulse, pulse);
    const g = ctx.createRadialGradient(-4, -4, 2, 0, 0, 16); g.addColorStop(0, '#2a2a2a'); g.addColorStop(1, '#0A0A0A');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill(); ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#D4AF37'; ctx.fillRect(-6, -5, 11, 8); ctx.fillRect(-2, 3, 4, 7); ctx.fillStyle = '#c9c4b8'; ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(12, -1); ctx.lineTo(5, 1); ctx.fill();
  }
  ctx.restore();
}

function drawSling(front) {
  const sx = C.SLING.x, sy = C.SLING.y, p = G.S.pilot;
  if (!front) {
    const wood = ctx.createLinearGradient(sx - 10, 0, sx + 8, 0); wood.addColorStop(0, '#3b2414'); wood.addColorStop(0.5, '#7a4e2a'); wood.addColorStop(1, '#3b2414');
    ctx.strokeStyle = wood; ctx.lineCap = 'round';
    ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(sx - 4, H + 4); ctx.lineTo(sx - 4, sy + 14); ctx.stroke();
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(sx - 4, sy + 16); ctx.quadraticCurveTo(sx - 18, sy, sx - 24, sy - 22); ctx.moveTo(sx - 4, sy + 16); ctx.quadraticCurveTo(sx + 10, sy, sx + 14, sy - 22); ctx.stroke();
    ctx.strokeStyle = '#4a2c18'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx + 14, sy - 20); ctx.lineTo(p.x, p.y); ctx.stroke();   // back band
  } else {
    ctx.strokeStyle = '#5a3620'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx - 24, sy - 20); ctx.lineTo(p.x - 4, p.y); ctx.stroke();
    ctx.fillStyle = '#3d2616'; ctx.beginPath(); ctx.ellipse(p.x - 6, p.y + 2, 6, 9, 0, 0, 7); ctx.fill();   // leather pouch
  }
}

function drawAim() {
  const p = G.S.pilot, dx = (C.SLING.x - p.x) * C.LAUNCH_POWER, dy = (C.SLING.y - p.y) * C.LAUNCH_POWER;
  if (dx < 12 * C.LAUNCH_POWER) return;
  let x = p.x, y = p.y, vx = dx, vy = dy;
  for (let s = 0; s < 60; s++) { vy += G.cfg.gravity; x += vx; y += vy; if (s % 5 === 0) { ctx.fillStyle = `rgba(242,217,139,${0.9 - s / 70})`; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); } }
}

function panel(title, lines, color) {
  ctx.fillStyle = 'rgba(8,8,8,0.6)'; ctx.fillRect(0, 0, W, H);
  const pw = 520, ph = 74 + lines.length * 28, px = (W - pw) / 2, py = (H - ph) / 2;
  ctx.fillStyle = 'rgba(12,12,12,0.92)'; ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, py, pw, ph, 16) : ctx.rect(px, py, pw, ph); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = color || '#F2D98B';
  ctx.font = '900 30px Archivo, sans-serif'; ctx.fillText(title.toUpperCase(), W / 2, py + 44);
  ctx.font = '600 15px Manrope, sans-serif';
  lines.forEach((l, i) => { ctx.fillStyle = l.c || '#EDEAE3'; ctx.fillText(l.t, W / 2, py + 78 + i * 28); });
  ctx.textAlign = 'left';
}

function draw() {
  const L = scene.L, cfg = G.cfg, S = G.S;
  ctx.save();
  if (G.shake > 0.5) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  ctx.drawImage(scene.sky, 0, 0, W, H);
  ctx.globalAlpha = 0.85 + Math.sin(G.t * 0.01) * 0.15; ctx.drawImage(scene.rays, 0, 0, W, H); ctx.globalAlpha = 1;
  for (const c of scene.clouds) { const x = ((c.x - scene.drift * c.k) % 1500 + 1500) % 1500 - 300; ctx.drawImage(c.c, x, c.y); }
  ctx.drawImage(scene.won, -Math.min(120, scene.drift * 0.02), 0, W, H);
  scene.hills.forEach((h, k) => { const x = -((scene.drift * (k ? 0.45 : 0.18)) % 1600); ctx.drawImage(h, x, 0); ctx.drawImage(h, x + 1600, 0); });
  if (G.S && (G.state === 'sling' || G.state === 'ready')) drawSling(false);
  if (S) drawPillars();
  if (S) for (const o of S.obstacles) for (const pk of o.pickups) { if (pk.taken) continue; const px = o.x + o.width / 2 + pk.dx, py = o.top + cfg.gap / 2 + pk.dy; if (px > -30 && px < W + 30) drawPickup(pk.type, px, py); }
  // ground strip
  const gg = ctx.createLinearGradient(0, H - 12, 0, H); gg.addColorStop(0, scene.L.ground[0]); gg.addColorStop(1, scene.L.ground[1]); ctx.fillStyle = gg; ctx.fillRect(0, H - 12, W, 12);
  if (S && S.stab > 0) {
    const p = S.pilot, pu = 1 + Math.sin(G.t * 0.2) * 0.07;
    ctx.strokeStyle = 'rgba(242,217,139,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 32 * pu, 26 * pu, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(W - 186, 16, 166, 30); ctx.fillStyle = '#D4AF37'; ctx.fillRect(W - 180, 36, 154 * S.stab / C.STABILIZER_FRAMES, 5);
    ctx.fillStyle = '#F2D98B'; ctx.font = '800 11px Manrope, sans-serif'; ctx.fillText('MR. FIXIT AUTOPILOT', W - 180, 30);
  }
  if (S) {
    const p = S.pilot;
    if (G.state === 'flight') { ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.2; for (let i = 0; i < 3; i++) { const yy = p.y - 6 + i * 6; ctx.beginPath(); ctx.moveTo(p.x - 30 - i * 6, yy); ctx.lineTo(p.x - 60 - i * 10 - S.speed * 4, yy); ctx.stroke(); } }
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 6; ctx.translate(p.x, p.y); ctx.rotate((p.angle || 0) * 0.7); const sc = 1.32 + G.flapPulse * 0.06; ctx.scale(sc, sc); drawHero(ctx, G.hero, G.curMood, G.t, G.wing, { spin: G.spin }); ctx.restore();
  }
  if (S && G.bubble) {
    const p = S.pilot, txt = G.bubble.text; ctx.font = '800 13px Manrope, sans-serif';
    const w = ctx.measureText(txt).width + 18, bx = Math.min(W - w - 6, p.x + 16), by = Math.max(6, p.y - 58);
    ctx.globalAlpha = Math.min(1, G.bubble.life / 15); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, 26, 13) : ctx.rect(bx, by, w, 26); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx + 12, by + 25); ctx.lineTo(bx + 6, by + 34); ctx.lineTo(bx + 22, by + 25); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillText(txt, bx + 9, by + 18); ctx.globalAlpha = 1;
  }
  if (G.state === 'sling') { drawSling(true); if (G.dragging || G.charging) drawAim(); }
  for (const f of G.feathers) { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r); ctx.globalAlpha = Math.min(1, f.life / 40); ctx.fillStyle = f.c; ctx.beginPath(); ctx.ellipse(0, 0, 6, 2, 0, 0, 7); ctx.fill(); ctx.restore(); }
  { const x = -((scene.drift * 1.35) % 2400); ctx.drawImage(scene.fg, x, 0); ctx.drawImage(scene.fg, x + 2400, 0); }
  for (const m of scene.motes) { const x = ((m.x - scene.drift * m.s) % W + W) % W, y = m.y + Math.sin(G.t * 0.02 + m.p) * 6; ctx.fillStyle = scene.L.stars ? 'rgba(200,220,255,0.35)' : 'rgba(255,240,200,0.45)'; ctx.beginPath(); ctx.arc(x, y, m.r, 0, 7); ctx.fill(); }
  ctx.drawImage(scene.vig, 0, 0, W, H);
  for (const s of G.sparks) { ctx.globalAlpha = Math.min(1, s.life / 30); ctx.fillStyle = s.col; ctx.font = '800 14px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.text, s.x, s.y); ctx.textAlign = 'left'; ctx.globalAlpha = 1; }
  ctx.restore();

  // words on top
  if (G.state === 'sling' && !G.dragging && !G.charging) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(W / 2 - 230, 14, 460, 52);
    ctx.fillStyle = '#F2D98B'; ctx.font = '900 20px Archivo, sans-serif'; ctx.fillText(('Level ' + cfg.n + ' · ' + cfg.title).toUpperCase(), W / 2, 37);
    ctx.fillStyle = '#EDEAE3'; ctx.font = '600 13px Manrope, sans-serif';
    ctx.fillText('Pilot: ' + G.hero.name + ' · ' + (G.cfg.n === 1 && !G.attempts.length ? 'drag back, let go, then tap to flap' : cfg.gates + ' gates · par ' + cfg.par + ' flaps'), W / 2, 57);
    ctx.textAlign = 'left';
  }
  if (G.state === 'sling' && G.charging) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(24, H - 46, 204, 18); ctx.fillStyle = '#D4AF37'; ctx.fillRect(26, H - 44, 200 * G.pull / C.MAX_PULL, 14);
    ctx.fillStyle = '#fff'; ctx.font = '600 13px Manrope, sans-serif'; ctx.fillText('Power · let go of Space to fly · angle ' + Math.round(G.aim * 180 / Math.PI) + '°', 24, H - 54);
  }
  if (G.state === 'ready') panel('Wonder Bird', [{ t: G.pending ? 'Getting your run ready…' : 'Loading…' }]);
  else if (G.state === 'crashed') panel('Ouch! Hit the stonework', [{ t: 'Level ' + cfg.n + ': ' + S.gates + ' of ' + cfg.gates + ' gates' }, { t: '♥ '.repeat(G.lives).trim() + '   ' + G.lives + (G.lives === 1 ? ' life' : ' lives') + ' left   ·   score ' + fmt(G.score), c: '#F2D98B' }, { t: 'Tap or press Space to try this level again', c: '#B9B3A6' }], '#ff8a7a');
  else if (G.state === 'levelup') {
    const a = G.award || { total: 0 };
    panel('Level ' + cfg.n + ' cleared', [{ t: '+' + fmt(a.total) + ' points · ' + (G.last ? G.last.presses : 0) + ' flaps (par ' + cfg.par + ')' + (a.glideBonus ? ' · glide bonus!' : ''), c: '#a9e34b' },
      { t: 'Run score ' + fmt(G.score) + (me ? (G.rank ? '   ·   #' + G.rank + ' this week' : '') : '   ·   guest (not counted)'), c: '#F2D98B' }, { t: 'Tap or press Space for level ' + (cfg.n + 1), c: '#B9B3A6' }]);
  } else if (G.state === 'over' || G.state === 'won') {
    const b = G.board, secs = Math.max(0, Math.ceil((G.home - Date.now()) / 1000));
    const lines = [{ t: 'Score ' + fmt(G.score) + ' · ' + G.cleared + (G.cleared === 1 ? ' level' : ' levels') + '', c: '#F2D98B' }];
    if (!me) lines.push({ t: 'Practice only: enter the draw so your plays count', c: '#a9e34b' });
    else if (b && b.me && b.me.rank) lines.push({ t: 'Best this week: ' + fmt(b.me.best) + ' · #' + b.me.rank + (b.me.rank > 3 && b.me.toPrize ? ' · ' + fmt(b.me.toPrize) + ' to a voucher' : b.me.rank <= 3 ? ' · on the podium!' : ''), c: '#a9e34b' });
    lines.push(me ? { t: 'That was your play for today. Come back tomorrow! Back to the site in ' + secs + 's', c: '#B9B3A6' } : { t: 'Tap to play again · back to the site in ' + secs + 's', c: '#B9B3A6' });
    panel(G.state === 'won' ? 'All 99 wonders flown!' : 'Out of lives', lines, G.state === 'won' ? '#a9e34b' : '#ff8a7a');
  } else if (G.state === 'locked') {
    const b = G.board, secs = Math.max(0, Math.ceil((G.home - Date.now()) / 1000));
    panel('You’ve had today’s play', [{ t: b && b.me && b.me.rank ? 'Your best this week: ' + fmt(b.me.best) + ' · #' + b.me.rank : 'Thanks for playing!', c: '#F2D98B' },
      { t: 'You’re welcome to play again tomorrow. Good luck in the draw!', c: '#a9e34b' }, { t: 'Back to the MBS website in ' + secs + 's (tap to go now)', c: '#B9B3A6' }]);
  }
  if (G.msg) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 26, W, 26); ctx.fillStyle = '#ffd8a8'; ctx.font = '600 12px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(G.msg, W / 2, H - 9); ctx.textAlign = 'left'; }
}

/* ---------------- page bits: score bar, leaderboard, buttons ---------------- */
function hud() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('wbLevel', G.cfg.n); set('wbWonder', G.cfg.title); set('wbGates', (G.S ? G.S.gates : 0) + '/' + G.cfg.gates);
  set('wbLives', '♥'.repeat(Math.max(0, G.lives)) + '♡'.repeat(Math.max(0, C.START_LIVES - G.lives)));
  set('wbScore', fmt(G.score + (G.state === 'flight' && G.S ? G.S.coins * C.COIN_POINTS + G.S.gems * C.GEM_POINTS : 0)));
  set('wbBest', fmt(G.best));
  const who = $('#wbWho');
  if (who) who.innerHTML = me ? 'Playing as <b>' + esc(me.first || me.id) + '</b> · your runs count' : 'Playing as a guest · <button type="button" class="wb-link" data-win>enter the draw</button> to count';
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function refreshBoard() {
  return post(Object.assign({ action: 'board' }, me ? { id: me.id, token: me.token } : {})).then((b) => { G.board = b; if (b.me && b.me.rank) G.rank = b.me.rank; if (b.me && G.playsLeft == null) { G.playsLeft = b.me.playsLeft; if (G.playsLeft === 0 && G.state !== 'flight') { G.state = 'locked'; goHome(10); } hud(); } renderBoard(); }).catch(() => { if (!G.board) document.querySelectorAll('.wb-board-box').forEach((x) => { x.innerHTML = '<h2 class="wb-bh-h">This week’s leaders</h2><p class="wb-small">The leaderboard can’t be reached right now. Your game still works; try again in a minute.</p>'; }); });
}
function left(ms) { const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4); return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm'; }
function renderBoard() {
  const b = G.board, boxes = document.querySelectorAll('.wb-board-box'); if (!boxes.length || !b) return;
  const medal = ['🥇', '🥈', '🥉'];
  const rows = b.top.length ? b.top.map((x) => '<li class="' + (x.me ? 'me ' : '') + (x.rank <= 3 ? 'pod' : '') + '"><span class="r">' + (medal[x.rank - 1] || x.rank) + '</span><span class="n">' + esc(x.name) + '</span>' +
    '<span class="l">L' + esc(x.level) + '</span><span class="s">' + fmt(x.score) + '</span>' + (x.prize ? '<span class="p">$' + x.prize + '</span>' : '<span class="p"></span>') + '</li>').join('')
    : '<li class="empty">No scores yet this week. Be the first!</li>';
  let mine = '';
  if (me && b.me) mine = b.me.rank ? '<p class="wb-mine">You: <b>#' + b.me.rank + '</b> · best ' + fmt(b.me.best) + (b.me.rank > 3 && b.me.toPrize ? ' · <b>' + fmt(b.me.toPrize) + '</b> more to reach the $20 spot' : b.me.rank <= 3 ? ' · you’re on the podium. Hold on to it!' : '') + '</p>' : '<p class="wb-mine">No score yet this week. Clear a level to get on the board.</p>';
  if (me && b.me) mine += '<p class="wb-mine wb-plays">🎮 ' + (b.me.playsLeft ? '<b>Today’s play is ready</b> · 3 lives' : '<b>Today’s play is used</b> · play again tomorrow') + '</p>';
  else if (!me) mine = '<p class="wb-mine">Guest scores aren’t saved. <button type="button" class="wb-link" data-win>Enter the draw</button> to get on the board.</p>';
  const html = '<div class="wb-bh"><h2>This week’s leaders</h2><span class="wb-ends" title="Week ends Sunday midnight, Sydney time">Ends in ' + left(b.endsIn) + '</span></div><ol class="wb-list">' + rows + '</ol>' + mine +
    '<p class="wb-small">' + fmt(b.players) + ' player' + (b.players === 1 ? '' : 's') + ' this week · top 3 win MBS vouchers: $50, $30, $20</p>';
  boxes.forEach((x) => { x.innerHTML = html; });
}
let toastT;
function toast(t) { const e = $('#wbToast'); if (!e) return; e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 3600); }
function toggleMusic() { AU.unlock(); const on = !AU.state().music; AU.setMusic(on); sound(); }
function sound() {
  const s = AU.state(), m = $('#wbMusic'), v = $('#wbVoice');
  if (m) { m.textContent = s.music ? '♪ Music on' : '♪ Music off'; m.setAttribute('aria-pressed', s.music ? 'true' : 'false'); }
  if (v) { v.textContent = s.voice ? '🗣 Mr. Fixit on' : '🗣 Mr. Fixit off'; v.setAttribute('aria-pressed', s.voice ? 'true' : 'false'); }
}
$('#wbMusic') && ($('#wbMusic').onclick = toggleMusic);
$('#wbVoice') && ($('#wbVoice').onclick = () => { AU.unlock(); AU.setVoice(!AU.state().voice); sound(); });
$('#wbFull') && ($('#wbFull').onclick = () => { const s = $('#wbStage'); if (document.fullscreenElement) document.exitFullscreen(); else if (s.requestFullscreen) s.requestFullscreen().catch(() => {}); });

// pop-up panels: How to play and the leaderboard (they slide in over the game, the game pauses behind them)
function openPop(id) {
  document.querySelectorAll('.wb-pop.open').forEach((p) => p.classList.remove('open'));
  const p = document.getElementById('wbPop-' + id); if (!p) return;
  p.classList.add('open'); if (id === 'board') refreshBoard();
  const b = p.querySelector('.wb-x'); if (b) b.focus();
}
function closePop() { AU.unlock(); document.querySelectorAll('.wb-pop.open').forEach((p) => p.classList.remove('open')); canvas.focus({ preventScroll: true }); }
document.addEventListener('click', (e) => {
  const o = e.target.closest && e.target.closest('[data-pop]'); if (o) { e.preventDefault(); openPop(o.getAttribute('data-pop')); return; }
  if (e.target.closest && (e.target.closest('.wb-x') || e.target.classList.contains('wb-pop'))) closePop();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.wb-pop.open')) closePop(); });
try { if (!localStorage.getItem('mbsWonderBird.seenHelp')) { openPop('help'); localStorage.setItem('mbsWonderBird.seenHelp', '1'); } } catch (e) {}
const paused = () => !!$('.wb-pop.open');
function sideShown() { const sd = $('#wbSide'); return !!sd && getComputedStyle(sd).display !== 'none'; }

/* ---------------- sharp on any screen, steady 60 steps a second ---------------- */
function fit() {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
window.addEventListener('resize', fit);
let acc = 0, lastT = performance.now();
function frame(now) {
  acc += Math.min(100, now - lastT); lastT = now;
  let n = 0; if (paused() && G.state === 'flight') acc = 0; while (acc >= 1000 / 60 && n < 5) { step(); acc -= 1000 / 60; n++; }
  if (n === 5) acc = 0;
  if (G.state === 'flight' && G.t % 6 === 0) hud();
  draw();
  requestAnimationFrame(frame);
}
fit(); sound(); scene = makeScene(G.cfg); newRun(); refreshBoard(); setInterval(refreshBoard, 60000);
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(frame));
window.WonderBird = {
  state: () => ({ state: G.state, level: G.cfg.n, score: G.score, lives: G.lives, run: G.run, attempts: G.attempts.length, me: !!me }),
  peek: () => { if (!G.S) return null; const p = G.S.pilot, o = G.S.obstacles.find((x) => x.x + x.width > p.x - p.radius); return { y: p.y, vy: p.vy, target: o ? o.top + G.cfg.gap / 2 + 8 : H / 2 }; }   // for the tests' autopilot
};
