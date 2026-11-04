// Wonder Bird: the game's rules (v102). Shared by the page (assets/wonderbird.js) and the server (netlify/lib/promo.mjs),
// so the server can replay a run from its inputs and work out the score itself. Nothing here draws, plays sound or reads
// the clock, and every random number comes from a seeded generator: the same inputs always give the same result.
// Based on Sashi's "Wonders Flight" engine (slingshot launch, flap, 99 levels, gates, coins, gems, stabiliser).

export const W = 800, H = 450, TOTAL_LEVELS = 99, START_LIVES = 3;
export const GRAVITY = 0.25, FLAP = -5.5, LOCK_X = 180, MAX_PULL = 100, LAUNCH_POWER = 0.12, PILOT_R = 15;
export const FRAME_CAP = 60 * 60 * 6;   // six minutes of frames per level at most
export const COIN_POINTS = 25, GEM_POINTS = 150, STABILIZER_FRAMES = 400;
export const SLING = { x: 100, y: 300 };

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function hashU32(s) {
  s = String(s); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 33 wonders x 3 times of day = 99 levels
export const WONDERS = [
  ['Giza Pyramids', 'pyramid'], ['Taj Mahal', 'dome'], ['Great Wall', 'wall'], ['Machu Picchu', 'terrace'], ['Petra', 'arches'],
  ['Colosseum', 'arches'], ['Chichen Itza', 'ziggurat'], ['Angkor Wat', 'tower'], ['Eiffel Tower', 'tower'], ['Stonehenge', 'monolith'],
  ['Hagia Sophia', 'dome'], ['Mount Fuji', 'mountain'], ['Golden Gate Bridge', 'bridge'], ['Sydney Opera House', 'sails'], ['Borobudur', 'ziggurat'],
  ['Alhambra', 'arches'], ['Neuschwanstein', 'castle'], ['Sagrada Familia', 'spires'], ['Moai of Rapa Nui', 'monolith'], ['Forbidden City', 'pagoda'],
  ['Himeji Castle', 'pagoda'], ['Burj Khalifa', 'skyline'], ['Persepolis', 'columns'], ['Great Sphinx', 'monolith'], ['Saint Basil Cathedral', 'dome'],
  ['Tower of Pisa', 'tower'], ['Mesa Verde', 'terrace'], ['Bagan Temples', 'spires'], ['Potala Palace', 'terrace'], ['Uluru', 'rock'],
  ['Sydney Harbour Bridge', 'arch'], ['Shibam Towers', 'skyline'], ['Cappadocia Spires', 'spires']
].map(([name, style]) => ({ name, style }));
export const TIMES = ['Morning', 'Sunset', 'Night'];

// difficulty climbs all the way to 99
export function levelConfig(n) {
  n = Math.max(1, Math.min(TOTAL_LEVELS, n | 0));
  const wonder = WONDERS[(n - 1) % WONDERS.length];
  const time = Math.floor((n - 1) / WONDERS.length) % TIMES.length;
  const towerWidth = Math.min(96, 62 + (n - 1) * 0.36);
  const gates = Math.min(16, 5 + Math.floor((n - 1) / 5));
  return {
    n, wonder: wonder.name, style: wonder.style, time, timeLabel: TIMES[time], title: wonder.name + ' · ' + TIMES[time],
    jitter: mulberry32(n * 2654435761 >>> 0)(),
    gap: Math.max(96, 170 - (n - 1) * 1.9),
    spacing: Math.max(towerWidth + 150, 312 - (n - 1) * 2.4),
    speed: Math.min(8.4, 3.2 + (n - 1) * 0.055),
    gates, width: towerWidth,
    gravity: Math.min(0.34, 0.25 + (n - 1) * 0.0011),
    sway: n >= 6 ? Math.min(82, (n - 5) * 2.6) : 0,
    swaySpeed: 0.018 + (n % 7) * 0.0015,
    par: Math.round(gates * (3.4 + n * 0.012))
  };
}

export function newWorld(cfg, salt) {
  return {
    rng: mulberry32((hashU32(cfg.n + '|' + salt) ^ 0x9e3779b9) >>> 0),
    frame: 0, pilot: { x: SLING.x, y: SLING.y, radius: PILOT_R, vx: 0, vy: 0, angle: 0 },
    obstacles: [], dist: 0, speed: cfg.speed, gates: 0, coins: 0, gems: 0, presses: 0, stab: 0, dead: false, cleared: false
  };
}
export const q3 = (v) => Math.round(v * 1000) / 1000;   // keeps numbers identical through JSON
export function launchOk(L) {
  return L && [L.x, L.y, L.dx, L.dy].every(Number.isFinite) && L.dx >= 12 && Math.hypot(L.x - SLING.x, L.y - SLING.y) <= MAX_PULL + 1 &&
    Math.hypot(L.dx, L.dy) <= MAX_PULL + 1;
}
export function applyLaunch(S, cfg, L) { S.pilot.x = L.x; S.pilot.y = L.y; S.pilot.vx = L.dx * LAUNCH_POWER; S.pilot.vy = L.dy * LAUNCH_POWER; S.speed = cfg.speed; }

function spawn(S, cfg) {
  const r = S.rng, amp = cfg.sway, minTop = 55 + amp, maxTop = H - cfg.gap - 55 - amp;
  const baseTop = minTop + r() * Math.max(10, maxTop - minTop);
  const o = { x: W + 40, baseTop, top: baseTop, width: cfg.width, phase: r() * Math.PI * 2, passed: false, pickups: [], look: r() };
  const reach = Math.max(18, cfg.gap / 2 - 24), shape = Math.floor(r() * 3), n = 4 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); let dx, dy;
    if (shape === 0) { dx = -70 + t * 150; dy = -Math.sin(t * Math.PI) * reach * 0.7; }
    else if (shape === 1) { dx = -50 + t * 130; dy = 0; }
    else { dx = -60 + t * 140; dy = (t < 0.5 ? t : 1 - t) * 2 * reach * 0.8; }
    o.pickups.push({ dx, dy, type: 'coin', r: 11, taken: false });
  }
  if (r() < 0.35) o.pickups.push({ dx: 10, dy: (r() < 0.5 ? -1 : 1) * reach, type: 'gem', r: 13, taken: false });
  if (r() < 0.13) o.pickups.push({ dx: 150, dy: 0, type: 'stab', r: 15, taken: false });
  S.obstacles.push(o);
}

// one frame (1/60 s). Returns events for sound and effects; the replay ignores them.
export function step(S, cfg, flap) {
  const out = [];
  if (S.dead || S.cleared) return out;
  S.frame++;
  const p = S.pilot;
  if (flap) { p.vy = FLAP; S.presses++; }
  if (S.stab > 0) {
    S.stab--; p.vy *= 0.82;
    const next = S.obstacles.find((o) => o.x + o.width > p.x - 20);
    if (next) p.vy += Math.max(-1.6, Math.min(1.6, (next.top + cfg.gap / 2 - p.y) * 0.06));
    if (S.stab === 0) out.push({ t: 'stabEnd' });
  } else p.vy += cfg.gravity;
  p.y += p.vy;
  p.angle = Math.max(-0.5, Math.min(1.1, p.vy / 12));
  if (p.x < LOCK_X) p.x = Math.min(LOCK_X, p.x + p.vx);
  if (p.y - p.radius < 0 || p.y + p.radius > H) { S.dead = true; out.push({ t: 'crash' }); return out; }
  S.dist += S.speed;
  if (S.dist >= cfg.spacing) { spawn(S, cfg); S.dist = 0; }
  for (let i = S.obstacles.length - 1; i >= 0; i--) {
    const o = S.obstacles[i];
    o.x -= S.speed;
    o.top = o.baseTop + (cfg.sway ? Math.sin(S.frame * cfg.swaySpeed + o.phase) * cfg.sway : 0);
    const bottom = o.top + cfg.gap;
    if (p.x + p.radius > o.x && p.x - p.radius < o.x + o.width && (p.y - p.radius < o.top || p.y + p.radius > bottom)) { S.dead = true; out.push({ t: 'crash' }); return out; }
    for (const pk of o.pickups) {
      if (pk.taken) continue;
      const px = o.x + o.width / 2 + pk.dx, py = o.top + cfg.gap / 2 + pk.dy;
      if (Math.hypot(p.x - px, p.y - py) < p.radius + pk.r) {
        pk.taken = true;
        if (pk.type === 'coin') S.coins++; else if (pk.type === 'gem') S.gems++; else S.stab = STABILIZER_FRAMES;
        out.push({ t: 'pick', kind: pk.type, x: px, y: py });
      }
    }
    if (!o.passed && o.x + o.width < p.x - p.radius) {
      o.passed = true; S.gates++; out.push({ t: 'gate' });
      if (S.gates >= cfg.gates) { S.cleared = true; return out; }
    }
    if (o.x + o.width < -40) S.obstacles.splice(i, 1);
  }
  return out;
}
export const statsOf = (S) => ({ gates: S.gates, coins: S.coins, gems: S.gems, presses: S.presses, frames: S.frame, cleared: !!S.cleared, dead: !!S.dead });

// rebuild one attempt from its inputs alone: { level, salt, launch, flaps: [frame numbers] }
export function replay(a) {
  if (!a || !launchOk(a.launch) || !Array.isArray(a.flaps)) return { gates: 0, coins: 0, gems: 0, presses: 0, frames: 0, cleared: false, dead: true };
  const cfg = levelConfig(a.level), S = newWorld(cfg, a.salt);
  applyLaunch(S, cfg, a.launch);
  const at = new Set(a.flaps);
  while (!S.dead && !S.cleared && S.frame < FRAME_CAP) step(S, cfg, at.has(S.frame + 1));
  return statsOf(S);
}
export function scoreFrom(cfg, st) {
  const gatePoints = cfg.gates * 50, levelPoints = cfg.n * 10, saved = Math.max(0, cfg.par - st.presses);
  const efficiency = saved * 25, glideBonus = st.presses <= Math.ceil(cfg.par / 2) ? 200 : 0, haul = st.coins * COIN_POINTS + st.gems * GEM_POINTS;
  return { gatePoints, levelPoints, saved, efficiency, glideBonus, haul, total: st.cleared ? gatePoints + levelPoints + efficiency + glideBonus + haul : 0 };
}
// the salt for attempt k of a run: the run seed comes from the server, so nobody can pick an easy level layout
export const saltFor = (seed, k) => String(seed) + ':' + k;

// check a whole run: attempts in order. Each level must be cleared before the next one; 3 crashes end the run.
export function scoreRun(seed, attempts) {
  let level = 1, crashes = 0, total = 0, cleared = 0, frames = 0;
  if (!Array.isArray(attempts) || attempts.length > TOTAL_LEVELS + START_LIVES) return { ok: false, why: 'too many attempts' };
  for (let k = 0; k < attempts.length; k++) {
    const a = attempts[k];
    if (crashes >= START_LIVES || level > TOTAL_LEVELS) return { ok: false, why: 'run already over' };
    if (!a || a.level !== level) return { ok: false, why: 'levels out of order' };
    if (!Array.isArray(a.flaps) || a.flaps.length > FRAME_CAP || a.flaps.some((f, i) => !Number.isInteger(f) || f < 1 || (i && f <= a.flaps[i - 1]))) return { ok: false, why: 'bad inputs' };
    const st = replay({ level, salt: saltFor(seed, k), launch: a.launch, flaps: a.flaps });
    frames += st.frames;
    if (st.cleared) { total += scoreFrom(levelConfig(level), st).total; cleared++; level++; }
    else crashes++;
  }
  return { ok: true, score: total, cleared, level, crashes, frames, over: crashes >= START_LIVES || level > TOTAL_LEVELS };
}
