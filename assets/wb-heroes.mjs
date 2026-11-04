// Wonder Bird's flying cast (v103): a different funny animal each level, after the original Wonders Flight pilots.
// Each one has its own flying gear and a face that reacts: happy when it grabs a coin, amazed at a gem, worried near the
// stonework, dizzy when it crashes. Drawn in the canvas; size and hit area are the same for all of them.

export const CAST = [
  { key: 'lorikeet', name: 'Lori the lorikeet', body: '#2f9e44', body2: '#1d6b2c', belly: '#fd7e14', head: '#3b5bdb', head2: '#24308a', ear: 'none', nose: 'beak', rig: 'wings', tail: 'feather', line: ['Squawk!', 'Shiny!', 'Wheee!'] },
  { key: 'squirrel', name: 'Nutty the squirrel', body: '#c07a3e', body2: '#7a4520', belly: '#f6dfbd', head: '#c98545', head2: '#7a4520', ear: 'tuft', nose: 'snout', rig: 'membrane', tail: 'bushy', line: ['Nuts!', 'Mine!', 'Zoom!'] },
  { key: 'bat', name: 'Count Flapula', body: '#5a4a70', body2: '#2c2340', belly: '#9d8cb5', head: '#64527c', head2: '#2c2340', ear: 'bat', nose: 'pig', rig: 'batwings', tail: 'none', fangs: true, line: ['Bleh!', 'Ooh, sparkly!', 'Night flight!'] },
  { key: 'dog', name: 'Biscuit the pup', body: '#e0a96d', body2: '#9c6633', belly: '#fff1dd', head: '#e8b47a', head2: '#9c6633', ear: 'floppy', nose: 'dog', rig: 'pupwings', tail: 'wag', goggles: true, line: ['Woof!', 'Good boy!', 'Treat!'] },
  { key: 'cat', name: 'Mittens the cat', body: '#8d8f99', body2: '#4f515a', belly: '#f1ece4', head: '#9a9ca6', head2: '#4f515a', ear: 'pointy', nose: 'cat', rig: 'wingsuit', tail: 'cat', stripes: true, line: ['Meow!', 'Purrfect!', 'Nine lives!'] },
  { key: 'bear', name: 'Bruno the bear', body: '#8a5a3c', body2: '#4e2f1c', belly: '#dcb48c', head: '#94623f', head2: '#4e2f1c', ear: 'round', nose: 'bear', rig: 'propeller', tail: 'stub', line: ['Honey!', 'Ha ha!', 'Big bear coming!'] },
  // v103: twenty more
  { key: 'fox', name: 'Foxy Roxy', body: '#e8743b', body2: '#9c3f12', belly: '#fff4ea', head: '#ee7f45', head2: '#9c3f12', ear: 'pointy', nose: 'fox', rig: 'kite', tail: 'foxtail', line: ['Sly moves!', 'Too quick!', 'Hehe!'] },
  { key: 'panda', name: 'Bao the panda', body: '#f4f4f0', body2: '#b9b9b4', belly: '#ffffff', head: '#fbfbf8', head2: '#c9c9c2', earCol: '#1f1f1f', ear: 'round', nose: 'bear', rig: 'balloon', tail: 'stub', panda: true, line: ['Bamboo!', 'Wheee!', 'Nom nom!'] },
  { key: 'koala', name: 'Kip the koala', body: '#9aa0a6', body2: '#5d6268', belly: '#e9ecef', head: '#a4aab0', head2: '#5d6268', ear: 'koala', nose: 'koala', rig: 'leaf', tail: 'none', line: ['G’day!', 'Gum leaves!', 'Sleepy… not now!'] },
  { key: 'roo', name: 'Joey the kangaroo', body: '#b9784a', body2: '#6f4320', belly: '#f1d3b3', head: '#c08050', head2: '#6f4320', ear: 'long', nose: 'snout', rig: 'hangglider', tail: 'roo', line: ['Boing!', 'Hop to it!', 'Strewth!'] },
  { key: 'wombat', name: 'Wally the wombat', body: '#7b6650', body2: '#46392b', belly: '#a99379', head: '#85705a', head2: '#46392b', ear: 'round', nose: 'koala', rig: 'propeller', tail: 'none', line: ['Dig it!', 'Square deal!', 'Crikey!'] },
  { key: 'penguin', name: 'Percy the penguin', body: '#2b2f3a', body2: '#11131a', belly: '#ffffff', head: '#323746', head2: '#11131a', ear: 'none', nose: 'beak', beak: '#ffa94d', rig: 'jetpack', tail: 'none', line: ['Brrr!', 'Ice cool!', 'Waddle on!'] },
  { key: 'owl', name: 'Professor Hoot', body: '#8b6b4a', body2: '#4d3824', belly: '#e9d5b5', head: '#94744f', head2: '#4d3824', ear: 'owl', nose: 'beak', beak: '#e8b04a', rig: 'wings', tail: 'feather', owl: true, line: ['Hoo hoo!', 'Elementary!', 'Wise move!'] },
  { key: 'frog', name: 'Ribbit Rick', body: '#5cb85c', body2: '#2f7a32', belly: '#d8f5c4', head: '#66c266', head2: '#2f7a32', ear: 'none', nose: 'none', rig: 'dragonfly', tail: 'none', frog: true, line: ['Ribbit!', 'Hop hop!', 'Croak!'] },
  { key: 'pig', name: 'Hamlet the pig', body: '#f4a6b8', body2: '#c66a82', belly: '#ffd6df', head: '#f7b0c0', head2: '#c66a82', ear: 'pig', nose: 'pigsnout', rig: 'pupwings', tail: 'curl', line: ['When pigs fly!', 'Oink!', 'Bacon? Never!'] },
  { key: 'rabbit', name: 'Bun Bun', body: '#e9e4dc', body2: '#a8a198', belly: '#ffffff', head: '#f1ece4', head2: '#a8a198', ear: 'long', nose: 'cat', rig: 'umbrella', tail: 'puff', line: ['Carrots!', 'Hop!', 'What’s up?'] },
  { key: 'hedgehog', name: 'Spike the hedgehog', body: '#8a6f5a', body2: '#4a382b', belly: '#efdcc2', head: '#ead3b5', head2: '#8a6f5a', ear: 'round', nose: 'dog', rig: 'hangglider', tail: 'none', spikes: true, line: ['Prickly!', 'Spiky speed!', 'Hehe!'] },
  { key: 'raccoon', name: 'Bandit the raccoon', body: '#8e8e94', body2: '#4c4c52', belly: '#e6e6e9', head: '#9c9ca2', head2: '#4c4c52', ear: 'pointy', nose: 'dog', rig: 'wingsuit', tail: 'ring', mask: true, line: ['Mine now!', 'Sneaky!', 'Snack time!'] },
  { key: 'monkey', name: 'Cheeky the monkey', body: '#8b5a2b', body2: '#4d2f12', belly: '#f0c9a0', head: '#94612f', head2: '#4d2f12', ear: 'monkey', nose: 'monkey', rig: 'balloon', tail: 'curl', line: ['Ooh ooh!', 'Banana!', 'Cheeky!'] },
  { key: 'elephant', name: 'Ellie the elephant', body: '#9aa3ad', body2: '#5c646d', belly: '#c9d0d7', head: '#a3acb6', head2: '#5c646d', ear: 'elephant', nose: 'trunk', rig: 'propeller', tail: 'stub', line: ['Toot toot!', 'Peanuts!', 'Never forget!'] },
  { key: 'lion', name: 'Leo the lion cub', body: '#e0a84c', body2: '#9a6418', belly: '#f8e2b8', head: '#e8b45a', head2: '#9a6418', ear: 'round', nose: 'cat', rig: 'kite', tail: 'tuft', mane: '#b5651d', line: ['Roar!', 'King of the sky!', 'Rawr!'] },
  { key: 'tiger', name: 'Stripes the tiger', body: '#f08c2e', body2: '#a14d08', belly: '#fff3e2', head: '#f39a40', head2: '#a14d08', ear: 'round', nose: 'cat', rig: 'wingsuit', tail: 'cat', stripes: true, line: ['Grrr!', 'Eye of the tiger!', 'Pounce!'] },
  { key: 'sloth', name: 'Snoozy the sloth', body: '#a08a6f', body2: '#5f4d38', belly: '#d9c8ae', head: '#e3d3b9', head2: '#a08a6f', ear: 'none', nose: 'dog', rig: 'leaf', tail: 'none', sloth: true, line: ['Whoa… fast…', 'Five more minutes…', 'Weee… eee…'] },
  { key: 'platypus', name: 'Pip the platypus', body: '#7a5634', body2: '#43301b', belly: '#b08a62', head: '#835d39', head2: '#43301b', ear: 'none', nose: 'bill', bill: '#3d3d3d', rig: 'jetpack', tail: 'beaver', line: ['Quack? No!', 'Splash!', 'One of a kind!'] },
  { key: 'duck', name: 'Dabble the duck', body: '#f5d142', body2: '#c79a10', belly: '#fff3b0', head: '#f8da55', head2: '#c79a10', ear: 'none', nose: 'bill', bill: '#ff922b', rig: 'wings', tail: 'feather', line: ['Quack!', 'Waddle waddle!', 'Ducking!'] },
  { key: 'sheep', name: 'Woolly the sheep', body: '#f6f3ec', body2: '#cfc8ba', belly: '#ffffff', head: '#3b3633', head2: '#1c1917', earCol: '#2a2522', ear: 'sheep', nose: 'none', rig: 'balloon', tail: 'puff', wool: true, line: ['Baa!', 'Ewe wish!', 'Shear speed!'] }
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
  if (h.tail === 'foxtail') { c.save(); c.translate(-12, 4); c.rotate(-0.25 + Math.sin(t * 0.14) * 0.12); ell(c, -10, 0, 12, 5.5, 0, h.body); ell(c, -19, 0, 4, 3.6, 0, '#fff'); c.restore(); }
  if (h.tail === 'ring') { c.save(); c.translate(-12, 3); c.rotate(-0.3 + Math.sin(t * 0.14) * 0.12); ell(c, -10, 0, 12, 4.5, 0, h.body); c.fillStyle = h.body2; for (let k = 0; k < 3; k++) c.fillRect(-18 + k * 6, -4, 2.6, 8); c.restore(); }
  if (h.tail === 'curl') { c.strokeStyle = h.body2; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-12, 4); c.bezierCurveTo(-22, 6, -24, -6, -17, -5); c.bezierCurveTo(-13, -4, -15, 1, -18, 0); c.stroke(); }
  if (h.tail === 'tuft') { c.strokeStyle = h.body; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-12, 4); c.quadraticCurveTo(-22, 8, -26, 0); c.stroke(); ell(c, -27, -1, 3, 3, 0, h.mane || h.body2); }
  if (h.tail === 'roo') { c.fillStyle = h.body; c.beginPath(); c.moveTo(-10, 4); c.quadraticCurveTo(-26, 8, -34, 16); c.quadraticCurveTo(-22, 12, -10, 10); c.fill(); }
  if (h.tail === 'beaver') ell(c, -18, 6, 10, 4, 0.2, h.body2);
  if (h.tail === 'puff') ell(c, -14, 2, 4.5, 4.5, 0, '#ffffff');
  backRig(c, h, wingA, t);

  // ---- body ----
  ell(c, 0, 3, 14, 11.5, 0, shade(c, h.body, h.body2, 0, -8, 0, 14));
  ell(c, 4, 6, 8.5, 7, 0.2, h.belly);
  if (h.wool) for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; ell(c, Math.cos(a) * 11, 3 + Math.sin(a) * 8.5, 5, 5, 0, k % 2 ? '#ffffff' : '#ece7dc'); }
  if (h.spikes) { c.fillStyle = h.body2; for (let k = 0; k < 7; k++) { const a = Math.PI * (0.85 + k * 0.11); const x = Math.cos(a) * 13, y = 3 + Math.sin(a) * 11; c.beginPath(); c.moveTo(x - 3, y + 2); c.lineTo(x * 1.45, y * 1.4 - 4); c.lineTo(x + 3, y); c.fill(); } }
  if (h.panda) { ell(c, 3, 11, 5, 3.5, 0, '#1f1f1f'); ell(c, -8, 9, 4.5, 3.5, 0, '#1f1f1f'); }
  if (h.stripes) { c.strokeStyle = 'rgba(40,40,48,0.45)'; c.lineWidth = 1.6; [-6, -1, 4].forEach((x) => { c.beginPath(); c.moveTo(x, -6); c.quadraticCurveTo(x - 2, 0, x, 4); c.stroke(); }); }
  if (h.key === 'cat' || h.rig === 'wingsuit') { c.fillStyle = '#e03131'; c.beginPath(); c.moveTo(-10, -3); c.lineTo(10, -3); c.lineTo(8, 1); c.lineTo(-10, 2); c.fill(); }   // suit band
  if (h.goggles) { c.fillStyle = '#e03131'; c.beginPath(); c.moveTo(4, -3); c.quadraticCurveTo(-12, -6 + Math.sin(t * 0.4) * 2, -26, -2 + Math.sin(t * 0.3) * 4); c.lineTo(-24, 3 + Math.sin(t * 0.3) * 4); c.quadraticCurveTo(-12, 1, 4, 2); c.fill(); }   // scarf

  // ---- head (big, for charm) ----
  const hx = 8, hy = -9;
  earsBack(c, h, hx, hy, t);
  ell(c, hx, hy, 12.5, 11.5, 0, (() => { const g = c.createRadialGradient(hx + 3, hy - 5, 2, hx, hy, 14); g.addColorStop(0, lighten(h.head)); g.addColorStop(1, h.head2); return g; })());
  earsFront(c, h, hx, hy, t);
  if (h.panda) { ell(c, hx + 2, hy - 1.5, 4, 5, -0.4, '#1f1f1f'); ell(c, hx + 9.5, hy - 2, 3.6, 4.6, 0.3, '#1f1f1f'); }
  if (h.stripes) { c.strokeStyle = 'rgba(40,30,25,0.6)'; c.lineWidth = 1.5; [[-3, -9], [1, -10.5], [5, -10]].forEach(([dx, dy]) => { c.beginPath(); c.moveTo(hx + dx, hy + dy); c.lineTo(hx + dx + 1, hy + dy + 4); c.stroke(); }); c.beginPath(); c.moveTo(hx - 10, hy); c.lineTo(hx - 6, hy + 1); c.moveTo(hx - 10, hy + 3); c.lineTo(hx - 6, hy + 3); c.stroke(); }
  if (h.mask) { c.fillStyle = '#2b2b30'; c.beginPath(); c.ellipse(hx + 6, hy - 2, 9, 4, 0, 0, 7); c.fill(); }
  if (h.owl) { ell(c, hx + 2, hy - 2, 5.2, 5.2, 0, '#f3e3c3'); ell(c, hx + 9.5, hy - 2.5, 5.2, 5.2, 0, '#f3e3c3'); }
  if (h.sloth) { c.fillStyle = '#5f4d38'; c.beginPath(); c.ellipse(hx + 2, hy - 1, 4.4, 2.8, -0.5, 0, 7); c.ellipse(hx + 9.5, hy - 1.5, 4.4, 2.8, 0.5, 0, 7); c.fill(); }
  if (h.frog) { ell(c, hx + 2, hy - 7, 5, 5, 0, h.head); ell(c, hx + 9.5, hy - 7.5, 5, 5, 0, h.head); }
  if (h.wool) for (let k = 0; k < 6; k++) ell(c, hx - 6 + k * 3.2, hy - 10 - (k % 2) * 1.5, 3.4, 3.4, 0, '#f6f3ec');
  // muzzle and nose
  if (h.nose === 'none') { /* frog, sheep: just a mouth */ }
  else if (h.nose === 'bill') { c.fillStyle = h.bill; c.beginPath(); c.moveTo(hx + 9, hy - 1); c.quadraticCurveTo(hx + 24, hy - 2, hx + 23, hy + 4); c.quadraticCurveTo(hx + 16, hy + 7, hx + 9, hy + 5); c.fill(); ell(c, hx + 18, hy + 0.5, 0.9, 0.6, 0, 'rgba(0,0,0,0.5)'); }
  else if (h.nose === 'trunk') { c.strokeStyle = h.head; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(hx + 10, hy + 2); c.quadraticCurveTo(hx + 20, hy + 4 + Math.sin(t * 0.2) * 2, hx + 21, hy - 4 + Math.sin(t * 0.2) * 2); c.stroke(); }
  else if (h.nose === 'pigsnout') { ell(c, hx + 13, hy + 2, 4.5, 3.6, 0, '#f9c4d0'); ell(c, hx + 12, hy + 2, 0.9, 1.2, 0, '#a2445e'); ell(c, hx + 14.5, hy + 2, 0.9, 1.2, 0, '#a2445e'); }
  else if (h.nose === 'koala') { ell(c, hx + 12, hy + 2, 3.6, 4.6, 0, '#2b2b2b'); ell(c, hx + 11, hy, 1, 1.4, 0, 'rgba(255,255,255,0.5)'); }
  else if (h.nose === 'beak') { c.fillStyle = h.beak || '#ff6b2c'; c.beginPath(); c.moveTo(hx + 9, hy - 1); c.quadraticCurveTo(hx + 20, hy, hx + 17, hy + 6); c.quadraticCurveTo(hx + 13, hy + 4, hx + 9, hy + 4); c.fill(); }
  else {
    const mz = h.nose === 'dog' || h.nose === 'bear' || h.nose === 'monkey' ? 6.5 : 5;
    ell(c, hx + 9, hy + 3.5, mz, mz * 0.75, 0, h.key === 'bat' ? '#8e7aa8' : h.nose === 'monkey' ? '#f0c9a0' : '#fff3e2');
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

function earsBack(c, h, hx, hy, t) {
  if (h.mane) for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; ell(c, hx + Math.cos(a) * 11.5, hy + Math.sin(a) * 11, 5.2, 5.2, a, h.mane); }
  if (h.ear === 'bat') { [[-4, -0.35], [5, 0.15]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 8); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-5, 2); c.lineTo(0, -15); c.lineTo(5, 2); c.fill(); c.fillStyle = '#d58fb0'; c.beginPath(); c.moveTo(-2.5, 1); c.lineTo(0, -10); c.lineTo(2.5, 1); c.fill(); c.restore(); }); }
  if (h.ear === 'floppy') ell(c, hx - 8, hy + 1, 4.5, 9, 0.35, h.head2);
  if (h.ear === 'long') [[-3, -0.25], [4, 0.1]].forEach(([dx, r], i) => { c.save(); c.translate(hx + dx, hy - 9); c.rotate(r + (i ? Math.sin(t * 0.2) * 0.1 : 0)); ell(c, 0, -9, 3.6, 10, 0, h.head2); ell(c, 0, -9, 1.8, 7.5, 0, '#f2a7b8'); c.restore(); });
  if (h.ear === 'elephant') { c.save(); c.translate(hx - 5, hy); c.rotate(Math.sin(t * 0.18) * 0.12); ell(c, -4, 2, 10, 12, 0.2, h.head2); ell(c, -3, 2, 7, 9, 0.2, '#d8a7b5'); c.restore(); }
  if (h.ear === 'sheep') ell(c, hx - 9, hy - 2, 6, 3, 0.5, h.earCol);
}
function earsFront(c, h, hx, hy, t) {
  if (h.ear === 'round') { [[-5, -9], [6, -10]].forEach(([dx, dy]) => { ell(c, hx + dx, hy + dy, 4.6, 4.6, 0, h.earCol || h.head2); ell(c, hx + dx, hy + dy, 2.4, 2.4, 0, h.earCol ? '#444' : '#d9a77f'); }); }
  if (h.ear === 'pointy') { [[-5, -0.25], [5, 0.25]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 8); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-4.5, 2); c.lineTo(0, -9); c.lineTo(4.5, 2); c.fill(); c.fillStyle = '#f2a7b8'; c.beginPath(); c.moveTo(-2.2, 1); c.lineTo(0, -5); c.lineTo(2.2, 1); c.fill(); c.restore(); }); }
  if (h.ear === 'tuft') { [[-4, -0.2], [5, 0.3]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 9); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-3.5, 2); c.quadraticCurveTo(-1, -9, 1, -11); c.quadraticCurveTo(2, -6, 3.5, 2); c.fill(); c.restore(); }); }
  if (h.ear === 'koala') [[-8, -6], [7, -10]].forEach(([dx, dy]) => { ell(c, hx + dx, hy + dy, 7, 6.5, 0, h.head2); ell(c, hx + dx, hy + dy, 4.5, 4, 0, '#f1f3f5'); });
  if (h.ear === 'owl') [[-4, -0.5], [7, 0.4]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 9); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-3, 2); c.lineTo(0, -7); c.lineTo(3, 2); c.fill(); c.restore(); });
  if (h.ear === 'pig') [[-5, -0.5], [6, 0.4]].forEach(([dx, r]) => { c.save(); c.translate(hx + dx, hy - 9); c.rotate(r); c.fillStyle = h.head2; c.beginPath(); c.moveTo(-4, 2); c.lineTo(1, -6); c.lineTo(4, 2); c.fill(); c.restore(); });
  if (h.ear === 'monkey') { ell(c, hx - 10, hy - 1, 4.5, 5, 0, h.head2); ell(c, hx - 10, hy - 1, 2.6, 3, 0, '#f0c9a0'); }
  if (h.ear === 'floppy') { c.save(); c.translate(hx + 2, hy - 7); c.rotate(-0.3 + Math.sin(t * 0.25) * 0.2); ell(c, -2, 6, 4, 8.5, 0.2, h.head2); c.restore(); }
}
function face(c, h, mood, hx, hy, t) {
  const eyes = h.frog ? [[hx + 2, hy - 7], [hx + 9.5, hy - 7.5]] : [[hx + 2, hy - 2], [hx + 9, hy - 2.5]];
  const blink = mood === 'normal' && (t % 190 < 6 || (h.sloth && t % 120 < 40));
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
  else if (h.frog) { c.beginPath(); c.moveTo(mx - 9, my - 2); c.quadraticCurveTo(mx, my + 4, mx + 6, my - 2); c.stroke(); }
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
function backRig(c, h, a, t) {
  if (h.rig === 'balloon') { c.strokeStyle = 'rgba(80,60,40,0.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-2, -6); c.lineTo(-10, -38); c.moveTo(4, -6); c.lineTo(-2, -38); c.stroke();
    const g = c.createRadialGradient(-10, -50, 2, -6, -46, 14); g.addColorStop(0, '#ff8787'); g.addColorStop(1, '#c92a2a'); ell(c, -6, -46, 11, 13, 0, g); ell(c, -10, -51, 3, 4, -0.4, 'rgba(255,255,255,0.45)'); }
  if (h.rig === 'kite') { c.strokeStyle = 'rgba(60,40,20,0.7)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(0, -4); c.lineTo(-14, -30); c.stroke(); c.save(); c.translate(-18, -40); c.rotate(Math.sin(t * 0.1) * 0.15); c.fillStyle = '#4dabf7'; c.beginPath(); c.moveTo(0, -12); c.lineTo(9, 0); c.lineTo(0, 12); c.lineTo(-9, 0); c.fill(); c.fillStyle = '#ffd43b'; c.beginPath(); c.moveTo(0, -12); c.lineTo(9, 0); c.lineTo(0, 0); c.fill(); c.beginPath(); c.moveTo(0, 12); c.lineTo(-9, 0); c.lineTo(0, 0); c.fill(); c.restore(); }
  if (h.rig === 'jetpack') { c.fillStyle = '#868e96'; c.fillRect(-16, -6, 7, 14); c.fillStyle = '#495057'; c.fillRect(-16, -6, 7, 3); const fl = 6 + Math.random() * 6; c.fillStyle = '#ff922b'; c.beginPath(); c.moveTo(-16, 8); c.lineTo(-9, 8); c.lineTo(-12.5, 8 + fl); c.fill(); c.fillStyle = '#ffe066'; c.beginPath(); c.moveTo(-15, 8); c.lineTo(-10, 8); c.lineTo(-12.5, 8 + fl * 0.6); c.fill(); }
  c.save(); c.translate(-2, -2);
  if (h.rig === 'dragonfly') { c.fillStyle = 'rgba(190,235,255,0.6)'; [-1, 1].forEach((k) => { c.save(); c.rotate(k * (0.3 + a)); ell(c, -10, -6, 12, 3.5, 0, 'rgba(190,235,255,0.6)'); c.restore(); }); }
  if (h.rig === 'wings') wing(c, -0.4 - a, h.body2, 24);
  if (h.rig === 'batwings') batWing(c, -0.5 - a, h);
  if (h.rig === 'pupwings') wing(c, -0.4 - a, '#e9ecef', 15);
  c.restore();
}
function frontRig(c, h, a) {
  if (h.rig === 'umbrella') { c.strokeStyle = '#5c3b1e'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(6, -4); c.lineTo(2, -32); c.stroke(); c.fillStyle = '#e64980'; c.beginPath(); c.arc(2, -32, 18, Math.PI, 0); c.fill(); c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(2, -32, 18, Math.PI * 1.3, Math.PI * 1.55); c.lineTo(2, -32); c.fill(); }
  if (h.rig === 'hangglider') { c.strokeStyle = '#343a40'; c.lineWidth = 1; c.beginPath(); c.moveTo(-4, -2); c.lineTo(-2, -22); c.moveTo(8, -4); c.lineTo(-2, -22); c.stroke(); c.fillStyle = 'rgba(255,212,59,0.92)'; c.beginPath(); c.moveTo(-34, -22); c.lineTo(26, -26); c.lineTo(-2, -16); c.closePath(); c.fill(); c.fillStyle = 'rgba(230,73,128,0.9)'; c.beginPath(); c.moveTo(-2, -16); c.lineTo(26, -26); c.lineTo(10, -22); c.fill(); }
  if (h.rig === 'leaf') { c.save(); c.translate(-2, -26); c.rotate(-0.1); ell(c, 0, 0, 26, 7, 0, '#4f8a3a'); c.strokeStyle = '#2f5a20'; c.lineWidth = 1; c.beginPath(); c.moveTo(-24, 1); c.lineTo(24, -1); c.stroke(); c.restore(); c.strokeStyle = '#5c3b1e'; c.lineWidth = 1; c.beginPath(); c.moveTo(2, -6); c.lineTo(-2, -20); c.stroke(); }
  c.save(); c.translate(-2, -2);
  if (h.rig === 'wings') wing(c, 0.25 + a, h.body, 24, 'rgba(10,40,15,0.45)');
  if (h.rig === 'batwings') batWing(c, 0.3 + a, h);
  if (h.rig === 'pupwings') wing(c, 0.3 + a, '#ffffff', 15, 'rgba(0,0,0,0.12)');
  if (h.rig === 'membrane') { c.fillStyle = 'rgba(214,160,100,0.85)'; c.beginPath(); c.moveTo(6, -2); c.lineTo(-20, 6 + a * 6); c.lineTo(-8, 12); c.lineTo(10, 8); c.closePath(); c.fill(); }
  if (h.rig === 'wingsuit') { c.fillStyle = 'rgba(224,49,49,0.9)'; c.beginPath(); c.moveTo(8, -1); c.lineTo(-22, 8 + a * 5); c.lineTo(-6, 13); c.lineTo(10, 7); c.closePath(); c.fill(); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-14, 6, 14, 1.5); }
  c.restore();
}
