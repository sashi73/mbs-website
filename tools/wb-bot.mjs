// A simple autopilot for Wonder Bird, used by the tests: plays a level with the real rules and returns the attempt
// (launch + flap frames) exactly as the game page would send it.
import * as C from '../assets/wb-core.mjs';

export function playLevel(level, salt, { crash = false } = {}) {
  const cfg = C.levelConfig(level), S = C.newWorld(cfg, salt);
  const launch = { x: 40, y: 320, dx: 60, dy: -20 };
  C.applyLaunch(S, cfg, launch);
  const flaps = [];
  while (!S.dead && !S.cleared && S.frame < C.FRAME_CAP) {
    const p = S.pilot, next = S.obstacles.find((o) => o.x + o.width > p.x - p.radius);
    const target = crash ? 10 : next ? next.top + cfg.gap / 2 + 8 : C.H / 2;
    const f = crash ? p.vy > -1 : p.y > target && p.vy > -1;
    C.step(S, cfg, f); if (f) flaps.push(S.frame);
  }
  return { attempt: { level, launch, flaps }, stats: C.statsOf(S) };
}
// play a run with a seed: clears up to `levels`, then crashes until out of lives
export function playRun(seed, levels) {
  const attempts = []; let lvl = 1, crashes = 0;
  while (crashes < C.START_LIVES && lvl <= C.TOTAL_LEVELS) {
    const r = playLevel(lvl, C.saltFor(seed, attempts.length), { crash: lvl > levels });
    attempts.push(r.attempt);
    if (r.stats.cleared) lvl++; else crashes++;
  }
  return attempts;
}
