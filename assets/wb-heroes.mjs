// Wonder Bird's flying cast (v103): a different funny animal each level, after the original Wonders Flight pilots.
// Each one has its own flying gear and a face that reacts: happy when it grabs a coin, amazed at a gem, worried near the
// stonework, dizzy when it crashes. Drawn in the canvas; size and hit area are the same for all of them.

export const CAST = [
  { key: 'lorikeet', name: 'Lori the lorikeet', body: '#2f9e44', body2: '#1d6b2c', belly: '#fd7e14', head: '#3b5bdb', head2: '#24308a', ear: 'none', nose: 'beak', rig: 'wings', tail: 'feather', line: ['Squawk!', 'Shiny!', 'Wheee!'] },
  { key: 'squirrel', name: 'Nutty the squirrel', body: '#c07a3e', body2: '#7a4520', belly: '#f6dfbd', head: '#c98545', head2: '#7a4520', ear: 'tuft', nose: 'snout', rig: 'membrane', tail: 'bushy', line: ['Nuts!', 'Mine!', 'Zoom!'] },
  { key: 'bat', name: 'Count Flapula', body: '#5a4a70', body2: '#2c2340', belly: '#9d8cb5', head: '#64527c', head2: '#2c2340', ear: 'bat', nose: 'pig', rig: 'batwings', tail: 'none', fangs: true, line: ['Bleh!', 'Ooh, sparkly!', 'Night flight!'] },
  { key: 'dog', name: 'Biscuit the pup', body: '#e0a96d', body2: '#9c6633', belly: '#fff1dd', head: '#e8b47a', head2: '#9c6633', ear: 'floppy', nose: 'dog', rig: 'pupwings', tail: 'wag', goggles: true, line: ['Woof!', 'Good boy!', 'Treat!'] },
  { key: 'cat', name: 'Mittens the cat', body: '#8d8f99', body2: '#4f515a', belly: '#f1ece4', head: '#9a9ca6', head2: '#4f515a', ear: 'pointy', nose: 'cat', rig: 'wingsuit', tail: 'cat', stripes: true, line: ['Meow!', 'Purrfect!', 'Nine lives!'] },
  { key: 'bear', name: 'Bruno the bear', body: '#8a5a3c', body2: '#4e2f1c', belly: '#dcb48c', head: '#94623f', head2: '#4e2f1c', ear: 'round', nose: 'bear', rig: 'propeller', tail: 'stub', line: ['Honey!', 'Ha ha!', 'Big bear coming!'] }
];
export const heroFor = (n) => CAST[(n - 1) % CAST.length];

const shade = (c, g0, g1, x0, y0, x1, y1) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, g0); g.addColorStop(1, g1); return g; };
function ell(c, x, y, rx, ry, rot, fill) { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, 7); c.fill(); }

// mood: 'normal' | 'happy' | 'wow' | 'worried' | 'ouch'; t: frame counter; flap: 0..1 wing beat; spin: propeller angle
export function drawHero(c, h, mood, t, flap, opts = {}) {
  const wingA = Math.sin(t * 0.32) * (0.15 + flap * 0.9);
  c.save();
  if (mood === 'ouch') c.rotate(Math.sin(t * 0.3) * 0.15);

  // ---- behind the body: tail and far wing ----
  if (h.tail === 'bushy') { c.save(); c.translate(-12, 2); c.rotate(-0.5 + Math.sin(t * 0.12) * 0.15); ell(c, -6, -8, 9, 14, -0.5, shade(c, h.body, h.body2, 0, -20, 0, 6)); ell(c, -5, -11, 4, 8, -0.5, 'rgba(255,240,215,0.45)'); c.restore(); }
  if (h.tail === 'cat') { c.strokeStyle = h.body2; c.lineWidth = 3.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-12, 4); c.quadraticCurveTo(-24, 2 + Math.sin(t * 0.15) * 6, -24, -10); c.stroke(); }
  if (h.tail === 'wag') { c.save(); c.translate(-13, 0); c.rotate(-0.6 + Math.sin(t * 0.6) * 0.5); ell(c, -4, 0, 7, 3, 0, h.body); c.restore(); }
  if (h.tail === 'feather') { c.fillStyle = h.body; c.beginPath(); c.moveTo(-11, 2); c.quadraticCurveTo(-26, 4, -32, 11); c.quadraticCurveTo(-22, 10, -10, 8); c.fill(); }
  if (h.tail === 'stub') ell(c, -14, 4, 3.5, 3, 0, h.body2);
  backRig(c, h, wingA, t);

  // ---- body ----
  ell(c, 0, 3, 14, 11.5, 0, shade(c, h.body, h.body2, 0, -8, 0, 14));
  ell(c, 4, 6, 8.5, 7, 0.2, h.belly);
  if (h.stripes) { c.strokeStyle = 'rgba(40,40,48,0.45)'; c.lineWidth = 1.6; [-6, -1, 4].forEach((x) => { c.beginPath(); c.moveTo(x, -6); c.quadraticCurveTo(x - 2, 0, x, 4); c.stroke(); }); }
  if (h.key === 'cat' || h.rig === 'wingsuit') { c.fillStyle = '#e03131'; c.beginPath(); c.moveTo(-10, -3); c.lineTo(10, -3); c.lineTo(8, 1); c.lineTo(-10, 2); c.fill(); }   // suit band
  if (h.goggles) { c.fillStyle = '#e03131'; c.beginPath(); c.moveTo(4, -3); c.quadraticCurveTo(-12, -6 + Math.sin(t * 0.4) * 2, -26, -2 + Math.sin(t * 0.3) * 4); c.lineTo(-24, 3 + Math.sin(t * 0.3) * 4); c.quadraticCurveTo(-12, 1, 4, 2); c.fill(); }   // scarf

  // ---- head (big, for charm) ----
  const hx = 8, hy = -9;
  earsBack(c, h, hx, hy, t);
  ell(c, hx, hy, 12.5, 11.5, 0, (() => { const g = c.createRadialGradient(hx + 3, hy - 5, 2, hx, hy, 14); g.addColorStop(0, lighten(h.head)); g.addColorStop(1, h.head2); return g; })());
  earsFront(c, h, hx, hy, t);
  // muzzle and nose
  if (h.nose === 'beak') { c.fillStyle = '#ff6b2c'; c.beginPath(); c.moveTo(hx + 9, hy - 1); c.quadraticCurveTo(hx + 20, hy, hx + 17, hy + 6); c.quadraticCurveTo(hx + 13, hy + 4, hx + 9, hy + 4); c.fill(); }
  else {
    const mz = h.nose === 'dog' || h.nose === 'bear' ? 6.5 : 5;
    ell(c, hx + 9, hy + 3.5, mz, mz * 0.75, 0, h.key === 'bat' ? '#8e7aa8' : '#fff3e2');
    const nc = h.nose === 'cat' ? '#f08aa0' : h.nose === 'pig' ? '#c79ad6' : '#2b2b2b';
    ell(c, hx + 13 + (mz > 6 ? 1.5 : 0), hy + 1.5, h.nose === 'dog' ? 3.2 : 2.2, h.nose === 'dog' ? 2.4 : 1.7, 0, nc);
    ell(c, hx + 12.6, hy + 0.9, 0.9, 0.6, 0, 'rgba(255,255,255,0.7)');
    if (h.nose === 'cat') { c.strokeStyle = 'rgba(60,60,60,0.6)'; c.lineWidth = 0.7; [[-1, -0.3], [1, 0], [3, 0.3]].forEach(([dy, k]) => { c.beginPath(); c.moveTo(hx + 12, hy + 4 + dy); c.lineTo(hx + 22, hy + 3 + dy * 2.5 + k); c.stroke(); }); }
  }
  ell(c, hx + 3, hy + 5, 2.8, 1.8, 0, 'rgba(255,120,140,0.45)');   // blush
  face(c, h, mood, hx, hy, t);
  if (h.goggles) { c.strokeStyle = '#5c3b1e'; c.lineWidth = 2; c.beginPath(); c.moveTo(hx - 11, hy - 6); c.lineTo(hx + 1, hy - 8); c.stroke(); c.strokeStyle = '#c9a227'; c.lineWidth = 1.6; c.beginPath(); c.arc(hx + 2, hy - 10, 3.6, 0, 7); c.stroke(); ell(c, hx + 2, hy - 10, 3, 3, 0, 'rgba(160,220,255,0.6)'); }
  if (h.rig === 'propeller') propeller(c, hx, hy, opts.spin || 0);

  frontRig(c, h, wingA, t);
  if (mood === 'ouch') stars(c, hx, hy - 14, t);
  if (mood === 'worried') { ell(c, hx - 9, hy - 6 + (t % 30) * 0.3, 1.6, 2.4, 0, 'rgba(120,200,255,0.85)'); }   // sweat drop
  c.restore();
}

function lighten(hex) { const n = parseInt(hex.slice(1), 16), r = Math.min(255, (n >> 16) + 50), g = Math.min(255, ((n >> 8) & 255) + 50), b = Math.min(255, (n & 255) + 50); return `rgb(${r},${g},${b})`; }

function earsBack(c, h, hx, hy) {
  if (h.ear === 'bat') { [[-4, -0.35], [5, 0.15]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 8); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-5, 2); c.lineTo(0, -15); c.lineTo(5, 2); c.fill(); c.fillStyle = '#d58fb0'; c.beginPath(); c.moveTo(-2.5, 1); c.lineTo(0, -10); c.lineTo(2.5, 1); c.fill(); c.restore(); }); }
  if (h.ear === 'floppy') ell(c, hx - 8, hy + 1, 4.5, 9, 0.35, h.head2);
}
function earsFront(c, h, hx, hy, t) {
  if (h.ear === 'round') { [[-5, -9], [6, -10]].forEach(([dx, dy]) => { ell(c, hx + dx, hy + dy, 4.6, 4.6, 0, h.head2); ell(c, hx + dx, hy + dy, 2.4, 2.4, 0, '#d9a77f'); }); }
  if (h.ear === 'pointy') { [[-5, -0.25], [5, 0.25]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 8); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-4.5, 2); c.lineTo(0, -9); c.lineTo(4.5, 2); c.fill(); c.fillStyle = '#f2a7b8'; c.beginPath(); c.moveTo(-2.2, 1); c.lineTo(0, -5); c.lineTo(2.2, 1); c.fill(); c.restore(); }); }
  if (h.ear === 'tuft') { [[-4, -0.2], [5, 0.3]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 9); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-3.5, 2); c.quadraticCurveTo(-1, -9, 1, -11); c.quadraticCurveTo(2, -6, 3.5, 2); c.fill(); c.restore(); }); }
  if (h.ear === 'floppy') { c.save(); c.translate(hx + 2, hy - 7); c.rotate(-0.3 + Math.sin(t * 0.25) * 0.2); ell(c, -2, 6, 4, 8.5, 0.2, h.head2); c.restore(); }
}
function face(c, h, mood, hx, hy, t) {
  const eyes = [[hx + 2, hy - 2], [hx + 9, hy - 2.5]];
  const blink = mood === 'normal' && t % 190 < 6;
  c.lineCap = 'round';
  if (mood === 'happy') {
    c.strokeStyle = '#1b1b1b'; c.lineWidth = 1.8;
    eyes.forEach(([x, y]) => { c.beginPath(); c.arc(x, y + 1, 2.8, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); });
  } else if (mood === 'ouch') {
    c.strokeStyle = '#1b1b1b'; c.lineWidth = 1.7;
    eyes.forEach(([x, y]) => { c.beginPath(); c.moveTo(x - 2.4, y - 2.4); c.lineTo(x + 2.4, y + 2.4); c.moveTo(x + 2.4, y - 2.4); c.lineTo(x - 2.4, y + 2.4); c.stroke(); });
  } else if (blink) {
    c.strokeStyle = '#1b1b1b'; c.lineWidth = 1.5; eyes.forEach(([x, y]) => { c.beginPath(); c.moveTo(x - 2.5, y); c.lineTo(x + 2.5, y); c.stroke(); });
  } else {
    const big = mood === 'wow' ? 1.3 : 1, look = mood === 'worried' ? [1, -1.2] : [1, 0];
    eyes.forEach(([x, y]) => {
      ell(c, x, y, 3.3 * big, 3.9 * big, 0, '#fff');
      ell(c, x + look[0], y + look[1], (mood === 'wow' ? 1.6 : 2.1), (mood === 'wow' ? 1.6 : 2.3), 0, '#1b1b1b');
      ell(c, x + look[0] + 0.8, y + look[1] - 1, 0.8, 0.8, 0, '#fff');
      if (mood === 'wow') { ell(c, x - 1.2, y + 1.4, 0.5, 0.5, 0, '#fff'); }
    });
    if (mood === 'worried') { c.strokeStyle = '#1b1b1b'; c.lineWidth = 1.3; eyes.forEach(([x, y], i) => { c.beginPath(); c.moveTo(x - 3, y - 5 + (i ? 1.5 : 0)); c.lineTo(x + 3, y - 5 - (i ? 0 : 1.5)); c.stroke(); }); }
  }
  // mouth
  const mx = h.nose === 'beak' ? hx + 12 : hx + 9, my = h.nose === 'beak' ? hy + 4.5 : hy + 7;
  c.strokeStyle = '#3a1d12'; c.lineWidth = 1.3;
  if (mood === 'happy') { c.fillStyle = '#5a1e1e'; c.beginPath(); c.moveTo(mx - 4, my - 1); c.quadraticCurveTo(mx, my + 6, mx + 4, my - 1); c.closePath(); c.fill(); ell(c, mx, my + 2.4, 2, 1.3, 0, '#ff7b8a'); if (h.fangs) { c.fillStyle = '#fff'; c.beginPath(); c.moveTo(mx - 2.6, my - 0.6); c.lineTo(mx - 1.8, my + 1.6); c.lineTo(mx - 1, my - 0.4); c.fill(); } }
  else if (mood === 'wow') { ell(c, mx, my + 1, 2.2, 2.8, 0, '#5a1e1e'); }
  else if (mood === 'worried') { c.beginPath(); c.moveTo(mx - 4, my + 1); c.quadraticCurveTo(mx - 2, my - 1, mx, my + 1); c.quadraticCurveTo(mx + 2, my + 3, mx + 4, my + 1); c.stroke(); }
  else if (mood === 'ouch') { c.fillStyle = '#5a1e1e'; c.beginPath(); c.ellipse(mx, my + 1, 3, 2, 0, 0, 7); c.fill(); ell(c, mx + 2, my + 3.5, 1.8, 2.6, -0.4, '#ff7b8a'); }
  else { c.beginPath(); c.moveTo(mx - 3, my); c.quadraticCurveTo(mx, my + 2.6, mx + 3, my); c.stroke(); if (h.fangs) { c.fillStyle = '#fff'; c.beginPath(); c.moveTo(mx - 1.6, my + 0.6); c.lineTo(mx - 1, my + 2.6); c.lineTo(mx - 0.3, my + 1); c.fill(); } }
}
function stars(c, x, y, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 0.12 + i * 2.1, sx = x + Math.cos(a) * 12, sy = y + Math.sin(a) * 4;
    c.save(); c.translate(sx, sy); c.rotate(t * 0.2); c.fillStyle = '#ffd43b'; c.beginPath();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? 1.4 : 3.4, aa = k * Math.PI / 5; c.lineTo(Math.cos(aa) * r, Math.sin(aa) * r); }
    c.fill(); c.restore();
  }
}
function propeller(c, hx, hy, spin) {
  ell(c, hx, hy - 9, 9, 4, 0, '#e03131'); ell(c, hx, hy - 10, 9, 2.4, 0, '#ffd43b');
  c.fillStyle = '#555'; c.fillRect(hx - 0.8, hy - 17, 1.6, 6);
  c.save(); c.translate(hx, hy - 17); c.scale(1, 0.35); c.rotate(spin);
  ell(c, -7, 0, 7, 2.2, 0, '#4dabf7'); ell(c, 7, 0, 7, 2.2, 0, '#4dabf7'); c.restore();
}
function wing(c, a, fill, len, dark) {
  c.save(); c.rotate(-a);
  c.fillStyle = fill; c.beginPath(); c.moveTo(4, -2); c.quadraticCurveTo(-6, -12, -len, -7); c.quadraticCurveTo(-len * 0.7, 1, -2, 4); c.closePath(); c.fill();
  if (dark) { c.strokeStyle = dark; c.lineWidth = 0.8; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-5 - i * 4, -5); c.lineTo(-9 - i * 4, 1); c.stroke(); } }
  c.restore();
}
function batWing(c, a, h) {
  c.save(); c.rotate(-a); c.fillStyle = h.body2; c.beginPath(); c.moveTo(4, -2);
  c.lineTo(-6, -14); c.lineTo(-14, -9); c.lineTo(-20, -15); c.lineTo(-26, -6); c.quadraticCurveTo(-20, -2, -16, 0); c.quadraticCurveTo(-10, -3, -6, 2); c.quadraticCurveTo(-2, 0, 0, 4); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(0, 0); c.lineTo(-14, -9); c.moveTo(0, 0); c.lineTo(-20, -15); c.stroke(); c.restore();
}
function backRig(c, h, a) {
  c.save(); c.translate(-2, -2);
  if (h.rig === 'wings') wing(c, -0.4 - a, h.body2, 24);
  if (h.rig === 'batwings') batWing(c, -0.5 - a, h);
  if (h.rig === 'pupwings') wing(c, -0.4 - a, '#e9ecef', 15);
  c.restore();
}
function frontRig(c, h, a) {
  c.save(); c.translate(-2, -2);
  if (h.rig === 'wings') wing(c, 0.25 + a, h.body, 24, 'rgba(10,40,15,0.45)');
  if (h.rig === 'batwings') batWing(c, 0.3 + a, h);
  if (h.rig === 'pupwings') wing(c, 0.3 + a, '#ffffff', 15, 'rgba(0,0,0,0.12)');
  if (h.rig === 'membrane') { c.fillStyle = 'rgba(214,160,100,0.85)'; c.beginPath(); c.moveTo(6, -2); c.lineTo(-20, 6 + a * 6); c.lineTo(-8, 12); c.lineTo(10, 8); c.closePath(); c.fill(); }
  if (h.rig === 'wingsuit') { c.fillStyle = 'rgba(224,49,49,0.9)'; c.beginPath(); c.moveTo(8, -1); c.lineTo(-22, 8 + a * 5); c.lineTo(-6, 13); c.lineTo(10, 7); c.closePath(); c.fill(); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-14, 6, 14, 1.5); }
  c.restore();
}
