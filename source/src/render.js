/* =====================================================================
   MODULE 2 — RENDERER  (canvas only; reads Core.state, never mutates it)
   ---------------------------------------------------------------------
   Baked once per scenario into offscreen layers:
     ground    – whole neighborhood at GS px/cell: lawns, streets, drives,
                 fences, hedges, trees, sheds, parked cars, neighbor roofs
     interior  – target-house floors, walls, windows, furniture (CS px/cell)
     blueprint – cyan line-plan for rooms known only from intel
     roof      – target-house hip roofs (hide unknown rooms)
   Per frame: doors / storm doors / charges, fog, gas haze, vision tint,
   lights, cruisers, units with cover shields, plans, overwatch cones, fx.
   ===================================================================== */
const Render = (function () {
'use strict';
const CS = 40, GS = 22;              // px per cell: house layers / neighborhood ground layer
let cv, ctx, VW = 0, VH = 0, dpr = 1;
const cam = { x: 0, y: 0, z: 1 };
let safe = { l: 0, t: 0, r: 0, b: 0 };
const L = {};
let builtWV = -1, builtSeed = -1, compKey = '', dynVer = -1, planVer = -1, plans = new Map();
let anims = [], seenFx = 0;
const prev = new Map(); let tickT0 = 0, tickDur = 280, animating = false;
const view = { sel: null, mode: 'move', hoverDoor: null, hoverRoom: null, hint: null, hover: null };
const COL = { cyan: '#38c8ff', cyan2: '#7fe3ff', team: '#2f9bff', red: '#ff3b4e', amber: '#ffb020', green: '#3ef0a0', violet: '#b48cff', patrol: '#9fb7d0', gas: '#d8ecc0' };

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function rr(g, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = Math.round(Math.min(255, r * f)); g = Math.round(Math.min(255, g * f)); b = Math.round(Math.min(255, b * f)); return `rgb(${r},${g},${b})`; }
function edgeIter(x0, y0, x1, y1, fn) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < x1) { const e = Core.edge(x, y, x + 1, y); fn(e, x, y, x + 1, y, x + 1, y, x + 1, y + 1); }
    if (y < y1) { const e = Core.edge(x, y, x, y + 1); fn(e, x, y, x, y + 1, x, y + 1, x + 1, y + 1); }
  }
}
/** Generic hip roof for a rect q (cells) at scale cs. */
const TRAILER_COL = ['#d9dde2', '#e4dccb', '#cfd8d4', '#dfe3ea', '#d8cfc4'];
/** Mobile-home roof: flat, light metal with ribs; 'small' = neighbor scale. */
function flatRoof(g, q, k, col, small) { const x = q.x * k, y = q.y * k, w = q.w * k, h = q.h * k;
  g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = small ? 6 : 10; g.shadowOffsetX = 4; g.shadowOffsetY = 6; g.fillStyle = col; g.fillRect(x, y, w, h); g.restore();
  const horiz = q.w >= q.h; g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1; g.beginPath();
  if (horiz) for (let yy = y + k * 0.5; yy < y + h; yy += k * 0.5) { g.moveTo(x + 2, yy); g.lineTo(x + w - 2, yy); } else for (let xx = x + k * 0.5; xx < x + w; xx += k * 0.5) { g.moveTo(xx, y + 2); g.lineTo(xx, y + h - 2); }
  g.stroke(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 2, y + 2, w - 4, k * 0.18); }
/** Mobile home: skirting band around the footprint plus wooden steps / porch at each door (ground layer). */
function trailerBase(g, H, X, k) { for (const q of H.parts) { const x = q.x * k, y = q.y * k, w = q.w * k, h = q.h * k; g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - k * 0.22 + 3, y - k * 0.22 + 4, w + k * 0.44, h + k * 0.44);
    g.fillStyle = '#9a9184'; g.fillRect(x - k * 0.2, y - k * 0.2, w + k * 0.4, h + k * 0.4); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.beginPath(); for (let xx = x; xx < x + w; xx += k * 0.3) { g.moveTo(xx, y - k * 0.2); g.lineTo(xx, y); g.moveTo(xx, y + h); g.lineTo(xx, y + h + k * 0.2); } g.stroke(); }
  for (const s of X.steps || []) { const x = s.x * k, y = s.y * k, w = s.w * k, h = s.h * k; g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + 3, y + 4, w, h);
    g.fillStyle = s.porch ? '#8a6a48' : '#7a5c3e'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.beginPath(); for (let xx = x + k * 0.25; xx < x + w; xx += k * 0.25) { g.moveTo(xx, y); g.lineTo(xx, y + h); } g.stroke();
    if (s.porch) { g.strokeStyle = '#5a4430'; g.lineWidth = 2.5; g.strokeRect(x + 1, y + 1, w - 2, h - 2); } } }
function hipRoof(g, q, ov, cols, cs, r, shadow) {
  const x0 = (q.x - ov) * cs, y0 = (q.y - ov) * cs, x1 = (q.x + q.w + ov) * cs, y1 = (q.y + q.h + ov) * cs, w = x1 - x0, h = y1 - y0;
  const horiz = w >= h, rr2 = Math.min(w, h) / 2; const ra = horiz ? [x0 + rr2, (y0 + y1) / 2] : [(x0 + x1) / 2, y0 + rr2], rb = horiz ? [x1 - rr2, (y0 + y1) / 2] : [(x0 + x1) / 2, y1 - rr2];
  let faces = [[[x0, y0], [x1, y0], rb, ra, 0], [[x1, y1], [x0, y1], ra, rb, 1], [[x0, y1], [x0, y0], ra, null, 2], [[x1, y0], [x1, y1], rb, null, 3]];
  if (!horiz) faces = [[[x0, y0], [x1, y0], ra, null, 0], [[x1, y1], [x0, y1], rb, null, 1], [[x0, y1], [x0, y0], ra, rb, 2], [[x1, y0], [x1, y1], rb, ra, 3]];
  if (shadow !== false) { g.save(); g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = cs * 0.5; g.shadowOffsetX = cs * 0.25; g.shadowOffsetY = cs * 0.4; g.fillStyle = '#1b1e24'; g.fillRect(x0, y0, w, h); g.restore(); }
  for (const [p1, p2, p3, p4, k] of faces) { g.save(); g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); if (p4) g.lineTo(p4[0], p4[1]); g.closePath(); g.clip();
    const gr = k === 0 ? g.createLinearGradient(0, y0, 0, (y0 + y1) / 2) : k === 1 ? g.createLinearGradient(0, y1, 0, (y0 + y1) / 2) : k === 2 ? g.createLinearGradient(x0, 0, (x0 + x1) / 2, 0) : g.createLinearGradient(x1, 0, (x0 + x1) / 2, 0);
    gr.addColorStop(0, shade(cols[k], 0.8)); gr.addColorStop(1, shade(cols[k], 1.12)); g.fillStyle = gr; g.fillRect(x0, y0, w, h);
    const row = cs * 0.26, tab = cs * 0.42; g.lineWidth = 1;
    if (k < 2) { for (let yy = y0, i = 0; yy < y1; yy += row, i++) { g.strokeStyle = 'rgba(0,0,0,.30)'; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
        if (cs >= 30) for (let xx = x0 + (i % 2) * tab / 2; xx < x1; xx += tab) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.05})`; g.fillRect(xx, yy, tab - 1, row - 1); } } }
    else { for (let xx = x0, i = 0; xx < x1; xx += row, i++) { g.strokeStyle = 'rgba(0,0,0,.30)'; g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, y1); g.stroke();
        if (cs >= 30) for (let yy = y0 + (i % 2) * tab / 2; yy < y1; yy += tab) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.05})`; g.fillRect(xx, yy, row - 1, tab - 1); } } }
    g.restore(); }
  g.strokeStyle = 'rgba(200,215,235,.28)'; g.lineWidth = Math.max(1.2, cs * 0.06); g.beginPath(); g.moveTo(x0, y0); g.lineTo(ra[0], ra[1]); g.lineTo(x0, y1); g.moveTo(x1, y0); g.lineTo(rb[0], rb[1]); g.lineTo(x1, y1); g.moveTo(ra[0], ra[1]); g.lineTo(rb[0], rb[1]); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = Math.max(1, cs * 0.05); g.strokeRect(x0, y0, w, h);
}
const ROOFS = [['#3c4250', '#4a5162', '#424858', '#353a47'], ['#4a3a34', '#5a463e', '#523f38', '#41332d'], ['#2f3c3a', '#3b4a47', '#354441', '#2a3533'], ['#45403a', '#554f47', '#4d4740', '#3c3732'], ['#38394a', '#46475b', '#3f4052', '#323343']];
const CAR_COL = ['#7a2a30', '#2a4a7a', '#c9ccd2', '#2a2d33', '#5a6a3a', '#8a7a5a', '#3a5a6a'];
/* =====================================================================
   NEIGHBORHOOD GROUND (GS px per cell)
   ===================================================================== */
const PAVE = { 1: '#16191f', 2: '#30343b', 3: '#27292c', 4: '#2b2f36', 5: '#383c43', 6: '#353038' };
function bakeGround() {
  const S = Core.state, X = S.ext, H = S.house, G = S.geo, MW = Core.MAP_W, MH = Core.MAP_H, k = GS;
  const c = mk(MW * k, MH * k), g = c.getContext('2d'), r = rng(S.seed * 7 + 3);
  // lawns, with a slightly different tone per lot
  g.fillStyle = '#18291f'; g.fillRect(0, 0, c.width, c.height);
  for (const lot of (G.lots || [])) { g.fillStyle = shade('#1a2c22', 0.85 + (lot.lawn || 0.5) * 0.3); g.fillRect(lot.x0 * k, lot.y0 * k, (lot.x1 - lot.x0 + 1) * k, (lot.y1 - lot.y0 + 1) * k); }
  for (let i = 0; i < MW * MH * 3; i++) { const px = r() * MW * k, py = r() * MH * k; g.strokeStyle = `rgba(${r() < 0.5 ? '90,140,90' : '10,25,15'},${0.08 + r() * 0.14})`; g.lineWidth = 1; g.beginPath(); g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * 2, py - 1.5 - r() * 3); g.stroke(); }
  for (let i = 0; i < MW * MH * 0.05; i++) { const px = r() * MW * k, py = r() * MH * k, rad = (0.8 + r() * 2.4) * k; const rg = g.createRadialGradient(px, py, 0, px, py, rad); rg.addColorStop(0, `rgba(${r() < 0.5 ? '40,70,45' : '6,16,10'},0.2)`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); }
  // paving per cell
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const p = S.paved[Core.idx(x, y)]; if (!p) continue; g.fillStyle = PAVE[p] || '#2b2f36'; g.fillRect(x * k, y * k, k + 0.5, k + 0.5);
    if (p === 2 && x % 2 === 0) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x * k, y * k, 1, k); }
    if (p === 5 || p === 6) { g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.strokeRect(x * k + 0.5, y * k + 0.5, k / 2, k / 2); g.strokeRect(x * k + k / 2, y * k + k / 2, k / 2 - 0.5, k / 2 - 0.5); }
    if (p === 3) { g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`; g.fillRect(x * k + r() * k, y * k + r() * k, 2, 2); } }
  for (let i = 0; i < 5000; i++) { const x = Math.floor(r() * MW), y = Math.floor(r() * MH); if (S.paved[Core.idx(x, y)] !== 1) continue; g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`; g.fillRect((x + r()) * k, (y + r()) * k, 1.5, 1.5); }
  // street markings and curbs
  const my = (G.ST + G.streetW / 2) * k; g.strokeStyle = 'rgba(214,170,60,.5)'; g.lineWidth = 2; g.setLineDash([k * 0.9, k * 0.8]); g.beginPath(); g.moveTo(k, my); g.lineTo((MW - 1) * k, my); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#4a505a'; const curb = (y, gap) => { if (!gap) { g.fillRect(k, y, (MW - 2) * k, 3); return; } g.fillRect(k, y, (gap.x0 - 2) * k, 3); g.fillRect((gap.x1 + 1) * k, y, (MW - gap.x1 - 2) * k, 3); };
  curb(G.ST * k - 2, G.side); curb((G.ST + G.streetW) * k - 1, G.cross);
  if (G.side) { const sx = (G.side.x0 + 3) * k; g.strokeStyle = 'rgba(214,170,60,.5)'; g.lineWidth = 2; g.setLineDash([k * 0.9, k * 0.8]); g.beginPath(); g.moveTo(sx, (G.rear.road1 + 1) * k); g.lineTo(sx, G.SW * k); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#4a505a'; g.fillRect((G.side.x0 - 1) * k, (G.rear.road1 + 1) * k, 3, (G.SW - G.rear.road1 - 1) * k); g.fillRect((G.side.x1 + 2) * k - 3, (G.rear.road1 + 1) * k, 3, (G.SW - G.rear.road1 - 1) * k); }
  if (G.rear) { const ry = (G.rear.road0 + (G.rear.road1 - G.rear.road0 + 1) / 2) * k; g.strokeStyle = 'rgba(214,170,60,.4)'; g.lineWidth = 2; g.setLineDash([k * 0.9, k * 0.8]); g.beginPath(); g.moveTo(k, ry); g.lineTo((MW - 1) * k, ry); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#4a505a'; g.fillRect(k, G.rear.walk0 * k - 1, (MW - 2) * k, 3); }
  if (G.cross) { const cx = (G.cross.x0 + 3) * k; g.strokeStyle = 'rgba(214,170,60,.5)'; g.setLineDash([k * 0.9, k * 0.8]); g.beginPath(); g.moveTo(cx, (G.SS + 2) * k); g.lineTo(cx, (MH - 1) * k); g.stroke(); g.setLineDash([]); }
  // driveway oil stains
  for (const d of X.drives) for (let i = 0; i < 3; i++) { const px = (d.x + 0.5 + r() * (d.w - 1)) * k, py = (d.y + 0.5 + r() * (d.h - 1)) * k, rad = k * (0.6 + r() * 0.6); const rg = g.createRadialGradient(px, py, 0, px, py, rad); rg.addColorStop(0, 'rgba(0,0,0,.25)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); }
  // target house drop shadow (its roof/interior is drawn from the house layers)
  g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = k * 0.9; g.shadowOffsetX = k * 0.35; g.shadowOffsetY = k * 0.5; g.fillStyle = '#000';
  for (const q of H.parts.concat(H.garage ? [H.garage] : [])) g.fillRect((q.x - 0.3) * k, (q.y - 0.3) * k, (q.w + 0.6) * k, (q.h + 0.6) * k); g.restore();
  // fences (cell edges marked F)
  g.lineCap = 'round';
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    if (Core.edge(x, y, x + 1, y).t === 'F') fenceSeg(g, (x + 1) * k, y * k, (x + 1) * k, (y + 1) * k, k);
    if (Core.edge(x, y, x, y + 1).t === 'F') fenceSeg(g, x * k, (y + 1) * k, (x + 1) * k, (y + 1) * k, k); }
  g.lineCap = 'butt';
  // hedges
  for (const q of X.hedges) { for (let yy = q.y; yy < q.y + q.h; yy++) for (let xx = q.x; xx < q.x + q.w; xx++) bush(g, (xx + 0.5) * k, (yy + 0.5) * k, k * (0.62 + r() * 0.12), r); }
  // mailboxes
  // utility boxes (procedural hard cover at perimeter posts): green steel cabinets
  for (const b of X.boxes || []) { const px = b.x * k, py = b.y * k; g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(px + k * 0.16, py + k * 0.2, k * 0.8, k * 0.76); g.fillStyle = '#4f6b55'; rr(g, px + k * 0.08, py + k * 0.1, k * 0.8, k * 0.74, 2); g.fill(); g.fillStyle = '#6f8f76'; g.fillRect(px + k * 0.12, py + k * 0.14, k * 0.72, k * 0.12); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + k * 0.48, py + k * 0.3); g.lineTo(px + k * 0.48, py + k * 0.8); g.stroke(); }
  for (const m of X.mail) { const px = (m.x + 0.5) * k, py = (m.y + 0.5) * k; g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(px - k * 0.18 + 2, py - k * 0.12 + 3, k * 0.36, k * 0.3); g.fillStyle = '#3d4654'; rr(g, px - k * 0.2, py - k * 0.14, k * 0.4, k * 0.28, 3); g.fill(); g.fillStyle = '#c03030'; g.fillRect(px + k * 0.12, py - k * 0.22, 2, k * 0.14); }
  // sheds
  for (const q of X.sheds) hipRoof(g, q, 0.1, ROOFS[(q.hue || 0) % ROOFS.length].map(cc => shade(cc, 0.9)), k, r);
  // neighbor houses (impassable, block sight): roof plus a porch light
  for (const nb of X.nb) { const cols = ROOFS[(nb.roof || 0) % ROOFS.length]; if (nb.trailer) { for (const q of nb.parts) flatRoof(g, q, k, TRAILER_COL[(nb.body || 0) % TRAILER_COL.length], true); continue; } if (nb.garage) hipRoof(g, nb.garage, 0.3, cols.map(cc => shade(cc, 0.92)), k, r); for (const q of nb.parts) hipRoof(g, q, 0.45, cols, k, r);
    if (nb.storeys > 1) { const q = nb.parts[0]; g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(q.x * k, q.y * k, q.w * k, q.h * k); } }
  if (H.dgarage) hipRoof(g, H.dgarage, 0.3, ROOFS[0].map(cc => shade(cc, 0.92)), k, r);
  if (H.trailer) trailerBase(g, H, X, k);
  // trees (canopy over everything on the ground)
  for (const t of X.trees) { const cx = (t.x + 0.5) * k, cy = (t.y + 0.5) * k, rad = Math.min(t.r, 2.2) * k * 0.75;
    g.fillStyle = 'rgba(0,0,0,.42)'; g.beginPath(); g.ellipse(cx + rad * 0.3, cy + rad * 0.4, rad, rad * 0.92, 0, 0, 7); g.fill();
    const base = t.hue < 0.5 ? [28, 64, 44] : [36, 58, 38];
    for (let n = 0; n < 7; n++) { const a = r() * 6.28, d = r() * rad * 0.42, px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d, pr = rad * (0.55 + r() * 0.3);
      const rg = g.createRadialGradient(px - pr * 0.35, py - pr * 0.4, 1, px, py, pr); rg.addColorStop(0, `rgb(${base[0] + 26},${base[1] + 30},${base[2] + 20})`); rg.addColorStop(1, `rgb(${base[0] - 14},${base[1] - 26},${base[2] - 18})`);
      g.fillStyle = rg; g.beginPath(); g.arc(px, py, pr, 0, 7); g.fill(); }
    g.fillStyle = '#3a2a1e'; g.beginPath(); g.arc(cx, cy, Math.max(2, k * 0.12), 0, 7); g.fill(); }
  // parked cars and the SWAT truck
  for (const car of X.cars) drawParked(g, car, k);
  if (X.van) drawTruck(g, X.van, k);
  // street lamps
  for (const l of X.lamps) { const px = (l.x + 0.5) * k, py = (l.y + 0.5) * k; g.fillStyle = '#20252c'; g.beginPath(); g.arc(px, py, k * 0.18, 0, 7); g.fill(); g.strokeStyle = '#59606b'; g.lineWidth = 1.5; g.stroke(); }
  // staging marker
  const st = X.staging; g.save(); g.strokeStyle = 'rgba(56,200,255,.6)'; g.setLineDash([6, 5]); g.lineWidth = 2; rr(g, (st.x - 3) * k, (st.y - 1.5) * k, 7 * k, 3.4 * k, 8); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(56,200,255,.06)'; g.fill(); g.fillStyle = 'rgba(127,227,255,.8)'; g.font = `700 ${k * 0.5}px system-ui,Segoe UI,sans-serif`; g.textAlign = 'left'; g.fillText('PRIMARY STAGING · EQUIPMENT', (st.x - 2.8) * k, (st.y + 1.6) * k); g.restore();
  const s2 = X.staging2; if (s2) { g.save(); g.strokeStyle = 'rgba(150,230,170,.6)'; g.setLineDash([6, 5]); g.lineWidth = 2; rr(g, (s2.x - 2.5) * k, (s2.y - 1.5) * k, 6 * k, 3.4 * k, 8); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(120,220,150,.06)'; g.fill(); g.fillStyle = 'rgba(170,240,190,.85)'; g.font = `700 ${k * 0.5}px system-ui,Segoe UI,sans-serif`; g.textAlign = 'left'; g.fillText('SECONDARY STAGING · ON FOOT', (s2.x - 2.3) * k, (s2.y + 1.6) * k); g.restore(); }
  L.ground = c;
}
function fenceSeg(g, x1, y1, x2, y2, k) { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = k * 0.24; g.beginPath(); g.moveTo(x1 + 2, y1 + 3); g.lineTo(x2 + 2, y2 + 3); g.stroke();
  g.strokeStyle = '#6b5d4d'; g.lineWidth = k * 0.16; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.fillStyle = '#3d352d'; g.fillRect(x1 - 2, y1 - 2, 4, 4); }
function bush(g, x, y, rad, r) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 2, y + 3, rad, 0, 7); g.fill(); const rg = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 1, x, y, rad); rg.addColorStop(0, '#30603c'); rg.addColorStop(1, '#122719'); g.fillStyle = rg; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); }
function drawParked(g, car, k) { const x = car.x * k, y = car.y * k, w = car.w * k, h = car.h * k, col = CAR_COL[(car.color || 0) % CAR_COL.length];
  g.save(); g.translate(x + w / 2, y + h / 2); if (car.vert) g.rotate(Math.PI / 2); if (car.flip) g.rotate(Math.PI); const L2 = car.vert ? h : w, W2 = car.vert ? w : h, T = car.type || 'sedan';
  g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = k * 0.5; g.shadowOffsetY = k * 0.2; g.fillStyle = col; const inset = T === 'van' || T === 'suv' ? 2 : 3; rr(g, -L2 / 2 + 2, -W2 / 2 + inset, L2 - 4, W2 - inset * 2, k * (T === 'van' ? 0.22 : 0.35)); g.fill(); g.shadowColor = 'transparent';
  const glass = 'rgba(20,30,40,.85)'; g.fillStyle = glass; // front of the vehicle is +x
  if (T === 'pickup') { rr(g, L2 * 0.06, -W2 / 2 + 5, L2 * 0.12, W2 - 10, 3); g.fill(); g.fillStyle = shade(col, 1.12); rr(g, -L2 * 0.08, -W2 / 2 + 6, L2 * 0.14, W2 - 12, 3); g.fill();
    g.fillStyle = shade(col, 0.55); rr(g, -L2 / 2 + 5, -W2 / 2 + 6, L2 * 0.4, W2 - 12, 2); g.fill(); g.strokeStyle = shade(col, 0.4); g.lineWidth = 1; for (let i = 1; i < 4; i++) { const xx = -L2 / 2 + 5 + i * L2 * 0.1; g.beginPath(); g.moveTo(xx, -W2 / 2 + 7); g.lineTo(xx, W2 / 2 - 7); g.stroke(); } }
  else if (T === 'van') { rr(g, L2 * 0.28, -W2 / 2 + 4, L2 * 0.1, W2 - 8, 3); g.fill(); g.fillStyle = shade(col, 1.1); rr(g, -L2 / 2 + 5, -W2 / 2 + 5, L2 * 0.7, W2 - 10, 3); g.fill(); g.strokeStyle = shade(col, 0.75); g.lineWidth = 1; g.beginPath(); g.moveTo(-L2 * 0.1, -W2 / 2 + 5); g.lineTo(-L2 * 0.1, W2 / 2 - 5); g.stroke(); }
  else if (T === 'suv') { rr(g, L2 * 0.12, -W2 / 2 + 4, L2 * 0.14, W2 - 8, 3); g.fill(); rr(g, -L2 * 0.42, -W2 / 2 + 5, L2 * 0.08, W2 - 10, 2); g.fill(); g.fillStyle = shade(col, 1.15); rr(g, -L2 * 0.3, -W2 / 2 + 5, L2 * 0.4, W2 - 10, 3); g.fill();
    g.strokeStyle = 'rgba(30,30,30,.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-L2 * 0.26, -W2 / 2 + 7); g.lineTo(L2 * 0.06, -W2 / 2 + 7); g.moveTo(-L2 * 0.26, W2 / 2 - 7); g.lineTo(L2 * 0.06, W2 / 2 - 7); g.stroke(); }
  else if (T === 'hatch') { rr(g, L2 * 0.04, -W2 / 2 + 5, L2 * 0.2, W2 - 10, 3); g.fill(); rr(g, -L2 * 0.4, -W2 / 2 + 6, L2 * 0.1, W2 - 12, 3); g.fill(); g.fillStyle = shade(col, 1.15); rr(g, -L2 * 0.28, -W2 / 2 + 6, L2 * 0.3, W2 - 12, 3); g.fill(); }
  else { rr(g, -L2 * 0.18, -W2 / 2 + 5, L2 * 0.2, W2 - 10, 3); g.fill(); rr(g, L2 * 0.12, -W2 / 2 + 6, L2 * 0.12, W2 - 12, 3); g.fill(); g.fillStyle = shade(col, 1.15); rr(g, -L2 * 0.38, -W2 / 2 + 6, L2 * 0.18, W2 - 12, 3); g.fill(); }
  g.fillStyle = 'rgba(255,240,200,.7)'; g.fillRect(L2 / 2 - 3.5, -W2 / 2 + inset + 1.5, 1.8, 3); g.fillRect(L2 / 2 - 3.5, W2 / 2 - inset - 4.5, 1.8, 3); g.restore(); }
function drawTruck(g, v, k) { const x = v.x * k, y = v.y * k, w = v.w * k, h = v.h * k;
  g.save(); g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = k * 0.6; g.shadowOffsetY = k * 0.25; g.fillStyle = '#1a2436'; rr(g, x + 1, y + 1, w - 2, h - 2, 6); g.fill(); g.restore();
  g.fillStyle = '#243250'; rr(g, x + k * 0.3, y + k * 0.25, w - k * 1.6, h - k * 0.5, 4); g.fill(); g.fillStyle = '#0d131d'; rr(g, x + w - k * 1.1, y + k * 0.25, k * 0.6, h - k * 0.5, 3); g.fill();
  g.fillStyle = 'rgba(127,227,255,.85)'; g.font = `800 ${h * 0.36}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SWAT', x + (w - k) / 2, y + h / 2 + 1); }
function hbox() { const H = Core.state.house; return { x: H.x0 - 2, y: H.y0 - 2, w: H.x1 - H.x0 + 5, h: H.y1 - H.y0 + 5 }; }
const FLOOR = { living: ['wood', '#5a4636'], dining: ['wood', '#56412f'], hall: ['wood', '#4f3d2e'], bed: ['carpet', '#3c4456'], kitchen: ['tile', '#5f6670'], bath: ['tile', '#55707e'], garage: ['concrete', '#383b41'] };
function drawFloor(g, rm, r) {
  const [kind, base] = FLOOR[rm.type] || ['carpet', '#444444']; const x = rm.x * CS, y = rm.y * CS, w = rm.w * CS, h = rm.h * CS;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = base; g.fillRect(x, y, w, h);
  if (kind === 'wood') { const ph = CS * 0.28; for (let yy = y; yy < y + h; yy += ph) { let xx = x - r() * CS * 2; while (xx < x + w) { const len = CS * (1.6 + r() * 1.8); g.fillStyle = shade(base, 0.85 + r() * 0.3); g.fillRect(xx, yy, len - 1, ph - 1); xx += len; } } }
  else if (kind === 'tile') { const ts = CS * 0.5; for (let yy = y; yy < y + h; yy += ts) for (let xx = x; xx < x + w; xx += ts) { g.fillStyle = shade(base, 0.93 + r() * 0.12); g.fillRect(xx + 1, yy + 1, ts - 2, ts - 2); } }
  else if (kind === 'carpet') { for (let i = 0; i < rm.w * rm.h * 40; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},.05)`; g.fillRect(x + r() * w, y + r() * h, 2, 2); } }
  else { for (let i = 0; i < 8; i++) { const px = x + r() * w, py = y + r() * h, rad = CS * (0.5 + r()); const rg = g.createRadialGradient(px, py, 0, px, py, rad); rg.addColorStop(0, 'rgba(0,0,0,.25)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); }
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke(); }
  const rg = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.7); rg.addColorStop(0, 'rgba(255,225,170,.10)'); rg.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = rg; g.fillRect(x, y, w, h);
  g.restore();
}
function drawFurn(g, f, r) {
  const x = f.x * CS, y = f.y * CS, w = f.w * CS, h = f.h * CS, s = f.side;
  const sh = (fn) => { g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 8; g.shadowOffsetX = 2; g.shadowOffsetY = 3; fn(); g.restore(); };
  const wood = '#6e5139', woodL = '#86664a';
  const strip = (d) => s === 'n' ? [x, y, w, d] : s === 's' ? [x, y + h - d, w, d] : s === 'w' ? [x, y, d, h] : s === 'e' ? [x + w - d, y, d, h] : [x, y, w, d];
  switch (f.kind) {
    case 'rug': g.fillStyle = 'rgba(120,70,70,.55)'; rr(g, x + 2, y + 2, w - 4, h - 4, 4); g.fill(); g.strokeStyle = 'rgba(220,180,140,.35)'; g.lineWidth = 2; rr(g, x + 7, y + 7, w - 14, h - 14, 3); g.stroke(); break;
    case 'sofa': case 'armchair': { const col = f.kind === 'sofa' ? '#55657a' : '#6a5a72'; sh(() => { g.fillStyle = col; rr(g, x + 2, y + 2, w - 4, h - 4, 7); g.fill(); });
      const b = strip(CS * 0.3); g.fillStyle = shade(col, 0.75); rr(g, b[0] + 2, b[1] + 2, b[2] - 4, b[3] - 4, 5); g.fill();
      g.strokeStyle = shade(col, 0.7); g.lineWidth = 1.5; if (f.kind === 'sofa') { const horiz = s === 'n' || s === 's'; for (let k = 1; k < 3; k++) { g.beginPath(); if (horiz) { g.moveTo(x + w * k / 3, y + 4); g.lineTo(x + w * k / 3, y + h - 4); } else { g.moveTo(x + 4, y + h * k / 3); g.lineTo(x + w - 4, y + h * k / 3); } g.stroke(); } } break; }
    case 'tv': { const b = strip(CS * 0.22); sh(() => { g.fillStyle = '#101317'; g.fillRect(b[0], b[1], b[2], b[3]); }); g.fillStyle = 'rgba(90,160,255,.35)'; g.fillRect(b[0] + 3, b[1] + 3, b[2] - 6, b[3] - 6); break; }
    case 'coffee': sh(() => { g.fillStyle = wood; rr(g, x + 5, y + 6, w - 10, h - 12, 4); g.fill(); }); g.fillStyle = 'rgba(200,230,255,.15)'; g.fillRect(x + 9, y + 10, w - 18, 4); break;
    case 'plant': sh(() => { g.fillStyle = '#4a3a2c'; g.beginPath(); g.arc(x + w / 2, y + h / 2, CS * 0.28, 0, 7); g.fill(); }); g.fillStyle = '#2f6a40'; for (let k = 0; k < 6; k++) { const a = k * 1.05 + r(); g.beginPath(); g.ellipse(x + w / 2 + Math.cos(a) * 7, y + h / 2 + Math.sin(a) * 7, 8, 4, a, 0, 7); g.fill(); } break;
    case 'counter': { sh(() => { g.fillStyle = '#7d848d'; g.fillRect(x, y, w, h); }); g.fillStyle = '#9aa2ab'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      const horiz = w > h; const n = horiz ? f.w : f.h; const sink = Math.floor(n / 3), stove = Math.floor(2 * n / 3);
      const at = (i) => horiz ? [x + i * CS, y] : [x, y + i * CS];
      { const [sx, sy] = at(sink); g.fillStyle = '#5c646e'; rr(g, sx + 6, sy + 7, CS - 12, CS - 14, 5); g.fill(); g.fillStyle = '#c9d2dc'; g.beginPath(); g.arc(sx + CS / 2, sy + 9, 2.5, 0, 7); g.fill(); }
      { const [sx, sy] = at(stove); g.fillStyle = '#1b1e22'; g.fillRect(sx + 3, sy + 3, CS - 6, CS - 6); g.strokeStyle = '#555c66'; g.lineWidth = 2; for (const [ox, oy] of [[.3, .3], [.7, .3], [.3, .7], [.7, .7]]) { g.beginPath(); g.arc(sx + ox * CS, sy + oy * CS, 5, 0, 7); g.stroke(); } } break; }
    case 'fridge': sh(() => { g.fillStyle = '#cfd5dc'; g.fillRect(x + 3, y + 3, w - 6, h - 6); }); g.strokeStyle = '#8f98a2'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + w / 2, y + 5); g.lineTo(x + w / 2, y + h - 5); g.stroke(); break;
    case 'island': sh(() => { g.fillStyle = '#8f969f'; rr(g, x + 2, y + 6, w - 4, h - 12, 3); g.fill(); }); g.fillStyle = '#5a4a3c'; for (let k = 0; k < f.w; k++) { g.beginPath(); g.arc(x + (k + 0.5) * CS, y + h + 2, 5, 0, 7); g.fill(); } break;
    case 'table': { g.fillStyle = '#4a3a2c'; const chairs = []; for (let k = 0; k < f.w; k++) chairs.push([x + (k + 0.5) * CS, y - 4], [x + (k + 0.5) * CS, y + h + 4]); for (const [cx, cy] of chairs) { rr(g, cx - 7, cy - 6, 14, 12, 3); g.fill(); }
      sh(() => { g.fillStyle = woodL; rr(g, x + 3, y + 4, w - 6, h - 8, 5); g.fill(); }); g.strokeStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.moveTo(x + 8, y + h / 2); g.lineTo(x + w - 8, y + h / 2); g.stroke(); break; }
    case 'sideboard': case 'dresser': case 'nightstand': { const b = f.kind === 'nightstand' ? [x + 5, y + 5, w - 10, h - 10] : strip(CS * 0.7); sh(() => { g.fillStyle = wood; g.fillRect(b[0], b[1], b[2], b[3]); });
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.strokeRect(b[0] + 3, b[1] + 3, b[2] - 6, b[3] - 6);
      if (f.kind === 'nightstand') { g.fillStyle = 'rgba(255,220,150,.85)'; g.beginPath(); g.arc(x + w / 2, y + h / 2, 5, 0, 7); g.fill(); } break; }
    case 'bed': { sh(() => { g.fillStyle = '#4a3a2e'; rr(g, x + 2, y + 2, w - 4, h - 4, 4); g.fill(); }); g.fillStyle = '#d8dbe2'; rr(g, x + 5, y + 5, w - 10, h - 10, 4); g.fill();
      const pil = s === 'n' ? [[x + 8, y + 8, (w - 22) / 2, 16], [x + w / 2 + 3, y + 8, (w - 22) / 2, 16]] : s === 's' ? [[x + 8, y + h - 24, (w - 22) / 2, 16], [x + w / 2 + 3, y + h - 24, (w - 22) / 2, 16]] : s === 'w' ? [[x + 8, y + 8, 16, (h - 22) / 2], [x + 8, y + h / 2 + 3, 16, (h - 22) / 2]] : [[x + w - 24, y + 8, 16, (h - 22) / 2], [x + w - 24, y + h / 2 + 3, 16, (h - 22) / 2]];
      g.fillStyle = '#f2f3f6'; pil.forEach(q => { rr(g, q[0], q[1], q[2], q[3], 5); g.fill(); });
      const bl = s === 'n' ? [x + 5, y + h * 0.38, w - 10, h * 0.62 - 5] : s === 's' ? [x + 5, y + 5, w - 10, h * 0.62 - 5] : s === 'w' ? [x + w * 0.38, y + 5, w * 0.62 - 5, h - 10] : [x + 5, y + 5, w * 0.62 - 5, h - 10];
      const col = ['#3e5f8a', '#7a4a5a', '#4f6e5a', '#6a5a8a'][Math.floor(r() * 4)]; g.fillStyle = col; rr(g, bl[0], bl[1], bl[2], bl[3], 4); g.fill(); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2; g.stroke(); break; }
    case 'tub': sh(() => { g.fillStyle = '#e8ecf0'; rr(g, x + 2, y + 2, w - 4, h - 4, 10); g.fill(); }); g.fillStyle = '#a9c4d6'; rr(g, x + 7, y + 7, w - 14, h - 14, 8); g.fill(); break;
    case 'toilet': sh(() => { g.fillStyle = '#eef1f4'; g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 0.26, h * 0.32, 0, 0, 7); g.fill(); }); { const b = strip(CS * 0.25); g.fillStyle = '#dfe4ea'; g.fillRect(b[0] + 4, b[1] + 2, Math.max(8, b[2] - 8), Math.max(8, b[3] - 4)); } break;
    case 'vanity': sh(() => { g.fillStyle = '#d8d0c4'; g.fillRect(x + 3, y + 3, w - 6, h - 6); }); g.fillStyle = '#9fb8c8'; g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 0.25, h * 0.2, 0, 0, 7); g.fill(); break;
    case 'car': sh(() => { g.fillStyle = '#5a2a30'; rr(g, x + 4, y + 2, w - 8, h - 4, 14); g.fill(); }); g.fillStyle = '#1e2a36'; rr(g, x + 9, y + h * 0.22, w - 18, h * 0.16, 5); g.fill(); rr(g, x + 9, y + h * 0.68, w - 18, h * 0.12, 5); g.fill();
      g.fillStyle = '#6e3840'; rr(g, x + 9, y + h * 0.4, w - 18, h * 0.26, 4); g.fill(); break;
    case 'workbench': { const b = strip(CS * 0.8); sh(() => { g.fillStyle = '#6a5440'; g.fillRect(b[0], b[1], b[2], b[3]); }); g.fillStyle = '#8a9099'; g.fillRect(b[0] + 8, b[1] + 6, 14, 5); g.fillStyle = '#b04a3a'; g.fillRect(b[0] + 30, b[1] + 8, 10, 8); break; }
    case 'shelves': { const b = strip(CS * 0.6); sh(() => { g.fillStyle = '#4d535c'; g.fillRect(b[0], b[1], b[2], b[3]); }); g.fillStyle = '#8a7356'; for (let k = 0; k < 3; k++) g.fillRect(b[0] + 4 + k * (b[2] - 8) / 3, b[1] + 4, (b[2] - 8) / 3 - 3, b[3] - 8); break; }
  }
}
function wallPass(g, box, color, wExt, wInt, glassCol) {
  const segs = [], wins = [], doors = [];
  edgeIter(box.x, box.y, box.x + box.w - 1, box.y + box.h - 1, (e, ax, ay, bx, by, x1, y1, x2, y2) => {
    const ra = Core.roomAt(ax, ay), rb = Core.roomAt(bx, by); if (ra < 0 && rb < 0) return; const ext = ra < 0 || rb < 0;
    if (e.t === 'X') segs.push([x1, y1, x2, y2, ext]); else if (e.t === 'W') wins.push([x1, y1, x2, y2]); else if (e.t === 'D') doors.push([x1, y1, x2, y2, ext]);
  });
  g.lineCap = 'square';
  for (const pass of [0, 1]) for (const [x1, y1, x2, y2, ext] of segs) { g.strokeStyle = pass ? color : 'rgba(0,0,0,.85)'; g.lineWidth = (ext ? wExt : wInt) + (pass ? 0 : 3); g.beginPath(); g.moveTo(x1 * CS, y1 * CS); g.lineTo(x2 * CS, y2 * CS); g.stroke(); }
  g.lineCap = 'butt';
  for (const [x1, y1, x2, y2] of wins) { g.beginPath(); g.moveTo(x1 * CS, y1 * CS); g.lineTo(x2 * CS, y2 * CS); g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = wExt + 3; g.stroke();
    g.strokeStyle = color; g.lineWidth = wExt; g.stroke(); g.strokeStyle = glassCol; g.lineWidth = Math.max(1.5, wExt * 0.4); g.stroke(); }
  for (const [x1, y1, x2, y2, ext] of doors) { const w = ext ? wExt : wInt; g.fillStyle = color;
    if (x1 === x2) { g.fillRect(x1 * CS - w / 2, y1 * CS - 1, w, 4); g.fillRect(x1 * CS - w / 2, y2 * CS - 3, w, 4); } else { g.fillRect(x1 * CS - 1, y1 * CS - w / 2, 4, w); g.fillRect(x2 * CS - 3, y1 * CS - w / 2, 4, w); } }
}
function bakeInterior() {
  const S = Core.state, b = hbox(), c = mk(b.w * CS, b.h * CS), g = c.getContext('2d'), r = rng(S.seed * 13 + 1);
  g.translate(-b.x * CS, -b.y * CS);
  for (const rm of S.rooms) drawFloor(g, rm, r);
  for (const f of S.furn) if (f.kind === 'rug') drawFurn(g, f, r);
  for (const f of S.furn) if (f.kind !== 'rug') drawFurn(g, f, r);
  wallPass(g, b, '#cdd3dc', 9, 6, '#8fd8ff');
  L.interior = c;
}
function bakeBlueprint() {
  const S = Core.state, b = hbox(), c = mk(b.w * CS, b.h * CS), g = c.getContext('2d');
  g.translate(-b.x * CS, -b.y * CS);
  for (const rm of S.rooms) { const x = rm.x * CS, y = rm.y * CS, w = rm.w * CS, h = rm.h * CS; g.fillStyle = '#0a1d33'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(79,209,255,.08)'; g.lineWidth = 1; for (let xx = x; xx <= x + w; xx += CS / 2) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); } for (let yy = y; yy <= y + h; yy += CS / 2) { g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); } }
  g.save(); g.shadowColor = 'rgba(79,209,255,.7)'; g.shadowBlur = 8; wallPass(g, b, '#59d2ff', 5, 3, '#0a1d33'); g.restore();
  for (const f of S.furn) { if (f.kind === 'rug') continue; g.strokeStyle = 'rgba(89,210,255,.22)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeRect(f.x * CS + 4, f.y * CS + 4, f.w * CS - 8, f.h * CS - 8); g.setLineDash([]); }
  L.blueprint = c;
}
function bakeRoof() {
  const S = Core.state, H = S.house, b = hbox(), c = mk(b.w * CS, b.h * CS), g = c.getContext('2d'), r = rng(S.seed * 31 + 5);
  g.translate(-b.x * CS, -b.y * CS);
  const cols = ROOFS[S.seed % ROOFS.length];
  if (H.garage) hipRoof(g, H.garage, 0.45, cols.map(q => shade(q, 0.92)), CS, r);
  const parts = H.parts.slice().sort((p, q) => p.w * p.h - q.w * q.h); // largest last so the main ridge sits on top
  if (H.trailer) { for (const q of parts) flatRoof(g, q, CS, TRAILER_COL[S.seed % TRAILER_COL.length], false); if (H.trailer === 'double') { const q = parts[parts.length - 1], mid = (q.y + q.h / 2) * CS; g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 2; g.beginPath(); g.moveTo(q.x * CS, mid); g.lineTo((q.x + q.w) * CS, mid); g.stroke(); } L.roof = c; return; }
  for (const q of parts) hipRoof(g, q, 0.6, cols, CS, r);
  if (H.duplex) { const px = H.duplex.partyX * CS; g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6; g.fillStyle = '#6e6a66'; g.fillRect(px - 4, (H.y0 - 0.5) * CS, 8, (H.y1 - H.y0 + 2) * CS); g.restore(); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(px - 4, (H.y0 - 0.5) * CS, 2, (H.y1 - H.y0 + 2) * CS); }
  const m = parts[parts.length - 1], ch = { x: m.x + Math.floor(m.w * (r() < 0.5 ? 0.3 : 0.7)), y: m.y + 1 };
  g.save(); g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 10; g.shadowOffsetX = 6; g.shadowOffsetY = 8; g.fillStyle = '#5a3c34'; g.fillRect(ch.x * CS, ch.y * CS, CS * 1.2, CS * 0.9); g.restore();
  g.fillStyle = '#1a1a1a'; g.fillRect(ch.x * CS + 6, ch.y * CS + 6, CS * 1.2 - 12, CS * 0.9 - 12);
  for (let k = 0; k < 3; k++) { const vx = (m.x + 2 + r() * (m.w - 4)) * CS, vy = (m.y + m.h * (0.65 + r() * 0.2)) * CS; g.fillStyle = '#2a2e35'; g.beginPath(); g.arc(vx, vy, 5, 0, 7); g.fill(); }
  L.roof = c;
}
function knowledgeKey() { const S = Core.state; return S.rooms.map(q => q.explored ? 2 : q.known ? 1 : 0).join(''); }
function buildComp() {
  const S = Core.state, b = hbox(); const c = L.comp || mk(b.w * CS, b.h * CS); if (c.width !== Math.ceil(b.w * CS) || c.height !== Math.ceil(b.h * CS)) { c.width = b.w * CS; c.height = b.h * CS; }
  const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  const rect = (q, pad) => [(q.x - b.x - pad) * CS, (q.y - b.y - pad) * CS, (q.w + 2 * pad) * CS, (q.h + 2 * pad) * CS];
  for (const rm of S.rooms) { if (!rm.known) continue; const src = rm.explored ? L.interior : L.blueprint; const [x, y, w, h] = rect(rm, 0.16); g.drawImage(src, x, y, w, h, x, y, w, h); }
  // roof with known rooms cut away
  const roof = L.roofTmp || (L.roofTmp = mk(c.width, c.height)); roof.width = c.width; roof.height = c.height; const rg = roof.getContext('2d');
  rg.drawImage(L.roof, 0, 0); rg.globalCompositeOperation = 'destination-out'; for (const rm of S.rooms) if (rm.known) { const [x, y, w, h] = rect(rm, 0.12); rg.fillRect(x, y, w, h); }
  rg.globalCompositeOperation = 'source-atop'; rg.strokeStyle = 'rgba(56,200,255,.75)'; rg.lineWidth = 3; for (const rm of S.rooms) if (rm.known) { const [x, y, w, h] = rect(rm, 0.12); rg.strokeRect(x, y, w, h); }
  rg.globalCompositeOperation = 'source-over'; g.drawImage(roof, 0, 0);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const rm of S.rooms) { if (!rm.known) continue; const cx = (rm.x - b.x + rm.w / 2) * CS, cy = (rm.y - b.y + 0.42) * CS; const t = rm.name.toUpperCase(); g.font = `700 ${CS * 0.27}px system-ui,Segoe UI,sans-serif`; const tw = g.measureText(t).width + 12;
    g.fillStyle = rm.explored ? 'rgba(6,14,26,.7)' : 'rgba(6,20,40,.75)'; rr(g, cx - tw / 2, cy - 9, tw, 18, 5); g.fill(); g.fillStyle = rm.explored ? 'rgba(220,235,250,.9)' : 'rgba(127,227,255,.9)'; g.fillText(t, cx, cy + 1); }
  L.comp = c; compKey = knowledgeKey();
}
function rebake() { bakeGround(); bakeInterior(); bakeBlueprint(); bakeRoof(); const MW = Core.MAP_W, MH = Core.MAP_H; L.fog = mk(MW, MH); L.tint = mk(MW, MH); L.gas = mk(MW, MH); L.expo = mk(MW, MH);
  builtSeed = Core.state.seed; builtWV = (Core.state.duplex && Core.state.duplex.wallV) || 0; compKey = ''; dynVer = -1; planVer = -1; anims = []; seenFx = Core.state.fxSeq || 0; }
let gasAny = false, peekAny = false;
/** Line-of-sight reveal: indoor cells seen through open doors/doorways in rooms not yet explored. Lit while in view, dim once out of view. */
function buildPeek() {
  const S = Core.state, b = hbox(), seen = S.seenCell; peekAny = false; if (!seen || !L.interior) return;
  const c = L.peek || (L.peek = mk(b.w * CS, b.h * CS)); if (c.width !== Math.ceil(b.w * CS) || c.height !== Math.ceil(b.h * CS)) { c.width = b.w * CS; c.height = b.h * CS; }
  const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = Core.idx(x, y), rm = S.room[i]; if (rm < 0 || !seen[i] || S.rooms[rm].explored) continue;
    peekAny = true; const px = (x - b.x) * CS, py = (y - b.y) * CS; g.drawImage(L.interior, px, py, CS, CS, px, py, CS, CS);
    if (!S.vis[i]) { g.fillStyle = 'rgba(4,10,20,.62)'; g.fillRect(px, py, CS, CS); } }
}
function updateDyn() {
  const S = Core.state, MW = Core.MAP_W, MH = Core.MAP_H;
  const fg = L.fog.getContext('2d'), fi = fg.createImageData(MW, MH), tg = L.tint.getContext('2d'), ti = tg.createImageData(MW, MH), gg = L.gas.getContext('2d'), gi = gg.createImageData(MW, MH);
  const teamVis = new Uint8Array(MW * MH);
  for (const u of S.units) if (u.vis && u.status === 'ok') for (const c of u.vis) teamVis[c] = Math.max(teamVis[c], u.kind === 'patrol' || u.kind === 'cruiser' ? 1 : 2);
  gasAny = false;
  for (let i = 0; i < MW * MH; i++) { const rm = S.room[i]; const p = i * 4;
    if (rm >= 0 && S.rooms[rm].explored && !S.vis[i]) { fi.data[p] = 4; fi.data[p + 1] = 10; fi.data[p + 2] = 20; fi.data[p + 3] = 165; }
    if (teamVis[i]) { ti.data[p] = 56; ti.data[p + 1] = 200; ti.data[p + 2] = 255; ti.data[p + 3] = teamVis[i] === 2 ? (rm >= 0 ? 34 : 18) : 10; }
    // CS gas: live concentration where we have eyes, last-seen value elsewhere (never leaks unseen spread)
    const gv = S.vis[i] ? S.gas[i] : (S.gasSeen ? S.gasSeen[i] : 0);
    if (gv > 0.03) { gasAny = true; gi.data[p] = 214; gi.data[p + 1] = 236; gi.data[p + 2] = 196; gi.data[p + 3] = Math.min(220, 40 + gv * 190) * (S.vis[i] ? 1 : 0.6); } }
  fg.putImageData(fi, 0, 0); tg.putImageData(ti, 0, 0); gg.putImageData(gi, 0, 0); dynVer = S.version;
  buildPeek();
}

/* =====================================================================
   CAMERA  (cam.x/y in world px at CS scale; z = screen px per world px)
   ===================================================================== */
/** v11: viewport size from the layout viewport (iOS can report stale sizes right after a rotate; callers re-measure later too).
 *  The canvas CSS box is set explicitly in px and the backing store is exactly CSS × dpr, so x and y always share ONE scale. */
function viewportSize() { const vv = window.visualViewport, iw = window.innerWidth || 0, ih = window.innerHeight || 0, de = document.documentElement;
  let w = iw || (de && de.clientWidth) || 1, h = ih || (de && de.clientHeight) || 1;
  if (vv && vv.width > 0 && vv.height > 0 && (vv.scale || 1) <= 1.01) { w = Math.min(w, Math.round(vv.width)) || w; h = Math.min(h, Math.round(vv.height)) || h; }
  return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))]; }
let userCam = false, lastSize = '';
function resize(force) { if (!cv) return; const odpr = dpr, [w, h] = viewportSize(); dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = w + 'x' + h + '@' + dpr; if (!force && key === lastSize && cv.width === Math.round(w * dpr) && cv.height === Math.round(h * dpr)) return false;
  const had = VW > 0 && VH > 0 && lastSize !== ''; let wc = null; if (had) { const [vx, vy] = viewCenter(); wc = toCell(vx, vy); }
  VW = w; VH = h; cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); lastSize = key;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); compKey = ''; // cached layers are world-space; force a recompose / redraw anyway
  if (had && wc && userCam) centerOn(wc[0], wc[1]); else if (had && Core.state) fit('house'); else clampCam();
  window.__debugScale = debugScale(); return true; }
/** Test hook: CSS px per backing px on each axis (must be equal), and the world→screen scale (one value). */
function debugScale() { if (!cv) return null; const r = cv.getBoundingClientRect(); return { x: r.width / cv.width * dpr, y: r.height / cv.height * dpr, zx: cam.z, zy: cam.z, dpr, css: [r.width, r.height], backing: [cv.width, cv.height], VW, VH }; }
function setSafe(s) { safe = Object.assign({ l: 0, t: 0, r: 0, b: 0 }, s); }
function viewCenter() { return [safe.l + (VW - safe.l - safe.r) / 2, safe.t + (VH - safe.t - safe.b) / 2]; }
/** fit(): 'house' (default) frames the target house plus the street in front; 'all' frames the whole neighborhood. */
function fit(what) { if (!Core.state) return; userCam = false; const S = Core.state, H = S.house, G = S.geo; let box;
  if (what === 'all') box = { x: 0, y: 0, w: Core.MAP_W, h: Core.MAP_H };
  else if (what === 'rear' && G.rear) box = { x: H.x0 - 24, y: G.rear.road0 - 1, w: H.x1 - H.x0 + 49, h: H.y1 + 3 - G.rear.road0 };
  else { const north = H.side !== 's' && H.y1 < G.ST; const y0 = north ? H.y0 - 3 : G.ST - 1, y1 = north ? G.SB + 2 : H.y1 + 3; box = { x: H.x0 - 5, y: y0, w: H.x1 - H.x0 + 11, h: y1 - y0 }; }
  const aw = Math.max(120, VW - safe.l - safe.r), ah = Math.max(120, VH - safe.t - safe.b);
  cam.z = Math.min(aw / (box.w * CS), ah / (box.h * CS)); const [vx, vy] = viewCenter(); cam.x = (box.x + box.w / 2) * CS - (vx - VW / 2) / cam.z; cam.y = (box.y + box.h / 2) * CS - (vy - VH / 2) / cam.z; clampCam(); }
function clampCam() { cam.z = Math.max(0.08, Math.min(3, cam.z)); const W = Core.MAP_W * CS, H = Core.MAP_H * CS; cam.x = Math.max(0, Math.min(W, cam.x)); cam.y = Math.max(0, Math.min(H, cam.y)); }
function centerOn(cx, cy) { const [vx, vy] = viewCenter(); cam.x = cx * CS - (vx - VW / 2) / cam.z; cam.y = cy * CS - (vy - VH / 2) / cam.z; clampCam(); }
function toScreen(cx, cy) { return [(cx * CS - cam.x) * cam.z + VW / 2, (cy * CS - cam.y) * cam.z + VH / 2]; }
function toCell(sx, sy) { return [((sx - VW / 2) / cam.z + cam.x) / CS, ((sy - VH / 2) / cam.z + cam.y) / CS]; }
function pan(dx, dy) { userCam = true; cam.x -= dx / cam.z; cam.y -= dy / cam.z; clampCam(); }
function zoomAt(sx, sy, f) { userCam = true; const [a, b] = toCell(sx, sy); cam.z *= f; clampCam(); const [c, d] = toCell(sx, sy); cam.x += (a - c) * CS; cam.y += (b - d) * CS; clampCam(); }
const sz = () => Math.max(0.7, Math.min(1.25, 0.6 + cam.z * 0.6));
function viewRect() { const [a, b] = toCell(0, 0), [c, d] = toCell(VW, VH); return { x: a, y: b, w: c - a, h: d - b }; }

/* =====================================================================
   ANIMATION BRIDGE — UI calls snapshot() before each Core.stepTick()
   ===================================================================== */
function snapshot(dur) { const S = Core.state; prev.clear(); for (const u of S.units) prev.set(u.uid, [u.x, u.y, u.dir]); for (const sp of (Core.suspList ? Core.suspList() : [S.suspect])) prev.set('S' + (sp.key || 'S'), [sp.x, sp.y, sp.dir]); tickT0 = performance.now(); tickDur = dur || 280; animating = true; }
function endAnim() { animating = false; prev.clear(); }
function posOf(id, x, y) { const p = prev.get(id); if (!p || !animating) return [x, y]; const t = ease(Math.min(1, (performance.now() - tickT0) / tickDur)); return [lerp(p[0], x, t), lerp(p[1], y, t)]; }
function dirOf(id, d) { const p = prev.get(id); if (!p || !animating || p[2] == null) return d; const t = ease(Math.min(1, (performance.now() - tickT0) / tickDur)); let a = p[2], dd = d - a; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; return a + dd * t; }
function syncFx() { const S = Core.state; for (const f of S.fx) if (f.id > seenFx) { seenFx = f.id; anims.push(Object.assign({ t0: performance.now() }, f)); } if (S.fx.length > 200) S.fx.splice(0, S.fx.length - 100); }

/* =====================================================================
   FRAME — world layers then screen-space overlays
   ===================================================================== */
const ICON = { move: '➜', clear: '▣', breach: '✸', polecam: '◉', bang: '✦', gas: '☁', hold: '■', drone: '✈', robot: '⛭', shoot: '⊕', overwatch: '◎', board: '⇲', exit: '⇱', detonate: '✹', mask: 'M' };
function wpx(c) { return (c + 0.5) * CS; }
// staging labels stay readable when zoomed out (the ground-layer text gets too small)
function drawStageTags(g) { const S = Core.state, X = S && S.ext; if (!X || !X.staging || CS * 0.5 * cam.z >= 9) return;
  const tags = [[X.staging, 'PRIMARY STAGING', 'rgba(127,227,255,.95)', -3], [X.staging2, 'SECONDARY STAGING', 'rgba(170,240,190,.95)', -2.5]];
  g.save(); g.font = '700 9px system-ui,Segoe UI,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (const [p, txt, col] of tags) { if (!p) continue; const [sx, sy] = toScreen(p.x + 0.5, p.y + 2); const w = g.measureText(txt).width + 8; const cx = Math.max(w / 2 + (VW > 600 ? 78 : 6), Math.min(VW - w / 2 - 4, sx));
    g.fillStyle = 'rgba(5,10,18,.75)'; g.fillRect(cx - w / 2, sy, w, 13); g.fillStyle = col; g.fillText(txt, cx, sy + 2); }
  g.restore(); }
/** v15: house address labels in screen space (legible at any zoom / orientation): target address RED, duplex neighbour unit GREEN. */
function drawAddrTags(g) { const S = Core.state; if (!S || !S.house || !Core.addrLabels) return; const L = Core.addrLabels(); if (!L.length) return;
  const fs = Math.max(10, Math.min(15, CS * 0.36 * cam.z)); g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const t of L) { g.font = `800 ${fs}px system-ui,Segoe UI,sans-serif`; const [sx, sy0] = toScreen(t.x + 0.5, t.box.y0 + 0.15), w = g.measureText(t.text).width + 14, h = fs + 8;
    if (sx < -w || sx > VW + w || sy0 < -h || sy0 > VH + h) continue; const sy = Math.max(h / 2 + 2, Math.min(VH - h / 2 - 2, sy0));
    g.fillStyle = t.target ? 'rgba(40,4,8,.88)' : 'rgba(4,30,14,.86)'; rr(g, sx - w / 2, sy - h / 2, w, h, 5); g.fill(); g.strokeStyle = t.color; g.lineWidth = t.target ? 2 : 1.5; g.stroke();
    g.fillStyle = t.color; g.fillText(t.text, sx, sy + 1); }
  g.restore(); }
function frame(now) { if (cv) { const [w, h] = viewportSize(); if (w !== VW || h !== VH || cv.width !== Math.round(w * Math.min(2, window.devicePixelRatio || 1))) resize(); } // self-heal a missed or stale rotate event
  const S = Core.state; if (!S || !cv) return;
  if (builtSeed !== S.seed || builtWV !== ((S.duplex && S.duplex.wallV) || 0)) { rebake(); }
  if (knowledgeKey() !== compKey) buildComp();
  if (dynVer !== S.version) updateDyn();
  syncFx();
  const g = ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#05080d'; g.fillRect(0, 0, VW, VH);
  g.save(); g.translate(VW / 2, VH / 2); g.scale(cam.z, cam.z); g.translate(-cam.x, -cam.y);
  g.imageSmoothingEnabled = true;
  g.drawImage(L.ground, 0, 0, Core.MAP_W * CS, Core.MAP_H * CS);
  lights(g, now, 'under');
  if (view.sel && S.phase === 'planning') drawExpo(g);
  const b = hbox(); g.drawImage(L.comp, b.x * CS, b.y * CS);
  if (peekAny && L.peek) g.drawImage(L.peek, b.x * CS, b.y * CS);
  g.save(); g.beginPath(); for (const rm of S.rooms) if (rm.explored) g.rect(rm.x * CS, rm.y * CS, rm.w * CS, rm.h * CS); g.clip(); g.imageSmoothingEnabled = false; g.drawImage(L.fog, 0, 0, Core.MAP_W * CS, Core.MAP_H * CS); g.restore();
  drawDoors(g, now); drawStruct(g, now);
  drawCruisers(g, now);
  drawCones(g, now);
  g.globalCompositeOperation = 'lighter'; g.imageSmoothingEnabled = false; g.drawImage(L.tint, 0, 0, Core.MAP_W * CS, Core.MAP_H * CS); g.imageSmoothingEnabled = true; g.globalCompositeOperation = 'source-over';
  if (gasAny) drawGas(g, now);
  lights(g, now, 'over');
  worldFx(g, now);
  g.restore();
  // ---- screen space ----
  drawContain(g, now); drawPerches(g, now); drawPlans(g, now); drawAim(g, now); drawMarkers(g, now); drawStageTags(g); drawAddrTags(g); drawUnits(g, now); screenFx(g, now);
  const vg = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
}
function glow(g, x, y, rad, col, a) { const rg = g.createRadialGradient(x, y, 0, x, y, rad); rg.addColorStop(0, col.replace('A', a)); rg.addColorStop(1, col.replace('A', 0)); g.fillStyle = rg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
/** Faint red wash over the suspect's lines of fire (outside the house) while a unit is being planned. */
function drawExpo(g) { const S = Core.state; if (!S.expo) return; const MW = Core.MAP_W, MH = Core.MAP_H;
  if (L.expoVer !== S.expoKey) { const eg = L.expo.getContext('2d'), ei = eg.createImageData(MW, MH);
    for (let i = 0; i < MW * MH; i++) { if (S.room[i] >= 0 || S.block[i]) continue; const e = S.expo[i]; if (e >= 0.6) { ei.data[i * 4] = 255; ei.data[i * 4 + 1] = 50; ei.data[i * 4 + 2] = 60; ei.data[i * 4 + 3] = 34; } else if (e >= 0.15) { ei.data[i * 4] = 255; ei.data[i * 4 + 1] = 170; ei.data[i * 4 + 2] = 40; ei.data[i * 4 + 3] = 16; } }
    eg.putImageData(ei, 0, 0); L.expoVer = S.expoKey; }
  g.imageSmoothingEnabled = false; g.drawImage(L.expo, 0, 0, MW * CS, MH * CS); g.imageSmoothingEnabled = true; }
/** CS gas haze: smoothed concentration field drawn twice with slow drift for a moving, layered look. */
function drawGas(g, now) { const W = Core.MAP_W * CS, H = Core.MAP_H * CS, t = now / 1000;
  g.save(); g.imageSmoothingEnabled = true;
  g.globalAlpha = 0.55; g.drawImage(L.gas, Math.sin(t * 0.5) * CS * 0.25, Math.cos(t * 0.4) * CS * 0.2, W, H);
  g.globalAlpha = 0.4; g.drawImage(L.gas, -W * 0.02 + Math.cos(t * 0.3) * CS * 0.3, -H * 0.02 + Math.sin(t * 0.35) * CS * 0.3, W * 1.04, H * 1.04);
  g.globalAlpha = 0.25 + 0.08 * Math.sin(t * 1.3); g.drawImage(L.gas, W * 0.0125, H * 0.0125, W * 0.975, H * 0.975); // uniform inset keeps the aspect
  g.restore(); }
function lights(g, now, layer) {
  const S = Core.state, X = S.ext;
  g.save(); g.globalCompositeOperation = 'lighter';
  if (layer === 'under') {
    for (const l of X.lamps) glow(g, wpx(l.x), wpx(l.y), CS * 4.5, 'rgba(255,200,120,A)', 0.16);
    for (const w of S.windows) { if (S.rooms[w.room].explored) continue; for (const [cx, cy, ox, oy] of w.edges) { const px = (Math.max(cx, ox) + (cx === ox ? 0.5 : 0)) * CS, py = (Math.max(cy, oy) + (cy === oy ? 0.5 : 0)) * CS;
      const dx = ox - cx, dy = oy - cy; glow(g, px + dx * CS * 0.6, py + dy * CS * 0.6, CS * 1.3, 'rgba(255,190,110,A)', 0.16); } }
    glow(g, wpx(X.staging.x), wpx(X.staging.y), CS * 4, 'rgba(56,200,255,A)', 0.08);
  } else {
    const blink = Math.floor(now / 260) % 2;
    for (const c of S.units) { if (c.kind !== 'cruiser' || c.disabled) continue; const [ux, uy] = posOf(c.uid, c.x, c.y); const px = wpx(ux), py = wpx(uy);
      glow(g, px, py, CS * (blink ? 3 : 1.6), 'rgba(255,40,60,A)', blink ? 0.4 : 0.08); glow(g, px, py, CS * (blink ? 1.6 : 3), 'rgba(40,110,255,A)', blink ? 0.08 : 0.4); }
    if (X.van) { const px = (X.van.x + X.van.w / 2) * CS, py = (X.van.y + X.van.h / 2) * CS; glow(g, px, py, CS * 2.2, blink ? 'rgba(40,110,255,A)' : 'rgba(255,40,60,A)', 0.2); }
    for (const u of S.units) { if (u.status !== 'ok' || (u.kind !== 'team' && u.kind !== 'robot')) continue; if (u.kind === 'team' && !u.deployed) continue; if (u.perch) continue;
      const [ux, uy] = posOf(u.uid, u.x, u.y); const px = wpx(ux), py = wpx(uy), d = dirOf(u.uid, u.dir || 0); const rad = CS * (u.kind === 'team' ? 6 : 4);
      g.save(); g.beginPath(); g.moveTo(px, py); g.arc(px, py, rad, d - 0.45, d + 0.45); g.closePath();
      const rg = g.createRadialGradient(px, py, 0, px, py, rad); rg.addColorStop(0, 'rgba(230,245,255,.20)'); rg.addColorStop(1, 'rgba(230,245,255,0)'); g.fillStyle = rg; g.fill(); g.restore(); }
  }
  g.restore();
}
/** Patrol cruisers: dynamic, movable, take hits (marks), occupants badge. */
function drawCruisers(g, now) { const S = Core.state, blink = Math.floor(now / 260) % 2;
  for (const c of S.units) { if (c.kind !== 'cruiser') continue; const [ux, uy] = posOf(c.uid, c.x, c.y); const d = dirOf(c.uid, c.dir || 0); const px = wpx(ux), py = wpx(uy);
    const Ln = CS * (c.armored ? 3.5 : 2.85), Wd = CS * (c.armored ? 1.9 : 1.45), sel = view.sel === c.uid;
    g.save(); g.translate(px, py); g.rotate(d);
    if (c.armored) drawBearCat(g, c, Ln, Wd, blink); else {
    g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = CS * 0.5; g.shadowOffsetX = CS * 0.12; g.shadowOffsetY = CS * 0.22;
    g.fillStyle = c.disabled ? '#2a2c30' : '#e6e9ee'; rr(g, -Ln / 2, -Wd / 2, Ln, Wd, CS * 0.32); g.fill(); g.shadowColor = 'transparent';
    g.fillStyle = c.disabled ? '#1a1b1e' : '#13161c'; rr(g, -Ln * 0.22, -Wd / 2 + 2, Ln * 0.42, Wd - 4, 6); g.fill(); // black doors band
    g.fillStyle = 'rgba(30,45,60,.95)'; rr(g, Ln * 0.08, -Wd / 2 + 5, Ln * 0.16, Wd - 10, 4); g.fill(); rr(g, -Ln * 0.3, -Wd / 2 + 6, Ln * 0.1, Wd - 12, 3); g.fill(); // windshield / rear glass
    g.fillStyle = 'rgba(190,220,255,.18)'; g.fillRect(Ln * 0.1, -Wd / 2 + 6, Ln * 0.05, Wd - 12);
    g.fillStyle = c.disabled ? '#333' : blink ? '#ff4458' : '#3a7bff'; g.fillRect(-CS * 0.08, -Wd * 0.38, CS * 0.16, Wd * 0.36); g.fillStyle = c.disabled ? '#333' : blink ? '#3a7bff' : '#ff4458'; g.fillRect(-CS * 0.08, Wd * 0.02, CS * 0.16, Wd * 0.36);
    g.fillStyle = 'rgba(255,250,220,.85)'; g.fillRect(Ln / 2 - 4, -Wd / 2 + 4, 3, 6); g.fillRect(Ln / 2 - 4, Wd / 2 - 10, 3, 6);
    g.fillStyle = 'rgba(20,30,60,.9)'; g.font = `800 ${CS * 0.26}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POLICE', -Ln * 0.38 + CS * 0.05, 0); }
    // impact marks (abstract dents/sparks, no injuries depicted)
    for (const m of c.marks || []) { const mx = m.dx * CS * 0.9, my = m.dy * CS * 0.5; g.strokeStyle = 'rgba(30,30,30,.85)'; g.lineWidth = 1.5; g.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 0.785 + (m.t || 0); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a) * 5, my + Math.sin(a) * 5); } g.stroke(); g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(mx, my, 2, 0, 7); g.fill(); }
    g.restore();
    if (sel) { g.strokeStyle = '#ffffff'; g.lineWidth = 2 / cam.z; g.setLineDash([6 / cam.z, 4 / cam.z]); g.beginPath(); g.ellipse(px, py, Ln * 0.62, Ln * 0.62, 0, 0, 7); g.stroke(); g.setLineDash([]); }
  } }
/** Top-down navy-blue BearCat: boxy armored hull, sloped hood, roof hatch with a rotating turret ring, short ram and a shield port. Bigger than a cruiser. */
function drawBearCat(g, c, Ln, Wd, blink) { const dis = c.disabled;
  g.fillStyle = dis ? '#1c2230' : '#1d2f5c'; rr(g, -Ln / 2, -Wd / 2, Ln, Wd, CS * 0.14); g.fill(); g.shadowColor = 'transparent'; // hull
  g.strokeStyle = dis ? '#2a3040' : '#0c1630'; g.lineWidth = 2; rr(g, -Ln / 2 + 2, -Wd / 2 + 2, Ln - 4, Wd - 4, CS * 0.1); g.stroke();
  g.fillStyle = dis ? '#232a38' : '#28427a'; g.beginPath(); g.moveTo(Ln * 0.2, -Wd / 2 + 3); g.lineTo(Ln / 2 - 3, -Wd * 0.36); g.lineTo(Ln / 2 - 3, Wd * 0.36); g.lineTo(Ln * 0.2, Wd / 2 - 3); g.closePath(); g.fill(); // sloped hood
  g.strokeStyle = 'rgba(10,18,40,.9)'; g.lineWidth = 1.2; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(Ln * 0.3, k * Wd * 0.12); g.lineTo(Ln * 0.44, k * Wd * 0.12); g.stroke(); } // grille louvres
  g.fillStyle = 'rgba(90,130,180,.55)'; g.fillRect(Ln * 0.13, -Wd * 0.38, Ln * 0.06, Wd * 0.76); // narrow armored windshield
  g.fillStyle = '#9aa3ad'; g.fillRect(Ln / 2 - 1, -Wd * 0.3, CS * 0.32, Wd * 0.6); g.fillStyle = '#6b737c'; g.fillRect(Ln / 2 + CS * 0.22, -Wd * 0.42, CS * 0.12, Wd * 0.84); // push bar / ram
  g.fillStyle = dis ? '#2a3040' : '#15244a'; rr(g, -Ln * 0.42, -Wd * 0.4, Ln * 0.5, Wd * 0.8, 4); g.fill(); // raised roof
  g.fillStyle = 'rgba(12,20,40,.9)'; g.fillRect(-Ln * 0.44, -Wd * 0.47, Ln * 0.08, Wd * 0.2); g.fillRect(-Ln * 0.44, Wd * 0.27, Ln * 0.08, Wd * 0.2); // rear doors / shield ports
  const tr = Wd * 0.27; g.fillStyle = dis ? '#333a48' : '#2e4b8c'; g.beginPath(); g.arc(-Ln * 0.12, 0, tr, 0, 7); g.fill(); g.strokeStyle = '#0a1226'; g.lineWidth = 2; g.stroke(); // roof hatch turret ring
  g.fillStyle = '#0a1226'; g.beginPath(); g.arc(-Ln * 0.12, 0, tr * 0.45, 0, 7); g.fill(); g.fillStyle = '#8a95a3'; g.fillRect(-Ln * 0.12 + tr * 0.4, -CS * 0.06, tr * 1.35, CS * 0.12); // hatch + short barrel/port
  g.fillStyle = dis ? '#333' : blink ? '#ff4458' : '#3a7bff'; g.fillRect(Ln * 0.07, -Wd * 0.46, CS * 0.12, CS * 0.12); g.fillStyle = dis ? '#333' : blink ? '#3a7bff' : '#ff4458'; g.fillRect(Ln * 0.07, Wd * 0.46 - CS * 0.12, CS * 0.12, CS * 0.12);
  g.fillStyle = 'rgba(255,250,220,.85)'; g.fillRect(Ln / 2 - 5, -Wd / 2 + 3, 3, 5); g.fillRect(Ln / 2 - 5, Wd / 2 - 8, 3, 5);
  g.fillStyle = 'rgba(220,230,255,.9)'; g.font = `800 ${CS * 0.24}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SWAT', -Ln * 0.34, 0);
  if (c.draco || c.dracoProg) drawDraco(g, c, Ln, Wd); }
/** v9 Draco arm: hydraulic boom on the BearCat's FRONT (+x) ending in a claw. Ghosted while being installed (with progress);
 *  swung out toward the opening during a Draco breach this turn. */
function drawDraco(g, c, Ln, Wd) { const S = Core.state, inst = !c.draco, act = !inst && c.dracoOut === S.turn && c.dracoAim !== undefined;
  let rel = 0; if (act) { rel = c.dracoAim - (c.dir || 0); while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI; rel = Math.max(-0.9, Math.min(0.9, rel)); }
  const bx = Ln * 0.28, L = act ? Ln * 0.22 + CS * 1.9 : Ln * 0.22 + CS * 1.05; g.save(); if (inst) { g.globalAlpha = 0.45; g.setLineDash([4, 3]); }
  g.fillStyle = '#d9a21a'; g.beginPath(); g.arc(bx, 0, Wd * 0.17, 0, 7); g.fill(); g.strokeStyle = '#3a2a05'; g.lineWidth = 1.5; g.stroke(); // turret / pivot
  g.translate(bx, 0); g.rotate(rel);
  g.fillStyle = '#e8b322'; g.strokeStyle = '#3a2a05'; g.lineWidth = 1.5; g.beginPath(); g.rect(0, -CS * 0.13, L, CS * 0.26); g.fill(); g.stroke(); // boom
  g.fillStyle = '#9aa3ad'; g.fillRect(L * 0.15, -CS * 0.05, L * 0.6, CS * 0.1); // hydraulic ram
  g.translate(L, 0); g.strokeStyle = '#c9ced6'; g.lineWidth = CS * 0.11; g.lineCap = 'round'; const o = act ? 0.55 : 0.35;
  for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(0, sg * CS * 0.08); g.lineTo(CS * 0.32, sg * CS * (0.14 + o * 0.3)); g.lineTo(CS * 0.55, sg * CS * 0.06); g.stroke(); } // claw tines
  g.restore();
  if (inst) { const f = Math.min(1, (c.dracoProg || 0) / Core.installTicks()); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(-Ln * 0.4, -Wd / 2 - CS * 0.32, Ln * 0.8, CS * 0.18);
    g.fillStyle = '#e8b322'; g.fillRect(-Ln * 0.4, -Wd / 2 - CS * 0.32, Ln * 0.8 * f, CS * 0.18); } }
/** Overwatch sight-line cones for perched marksmen. */
function drawCones(g, now) { const S = Core.state;
  for (const u of S.units) { if (u.kind !== 'team' || u.status !== 'ok' || !u.perch) continue; const c = Core.owCone(u); if (!c) continue; const [ux, uy] = posOf(u.uid, c.x, c.y);
    const px = wpx(ux), py = wpx(uy), rad = c.range * CS, sel = view.sel === u.uid; const d = dirOf(u.uid, c.dir);
    g.save(); g.beginPath(); g.moveTo(px, py); g.arc(px, py, rad, d - c.half, d + c.half); g.closePath();
    const rg = g.createRadialGradient(px, py, 0, px, py, rad); rg.addColorStop(0, `rgba(62,240,160,${sel ? 0.22 : 0.14})`); rg.addColorStop(1, 'rgba(62,240,160,0.02)'); g.fillStyle = rg; g.fill();
    g.strokeStyle = `rgba(62,240,160,${sel ? 0.8 : 0.45})`; g.lineWidth = 1.5 / cam.z; g.setLineDash([8 / cam.z, 6 / cam.z]); g.lineDashOffset = -now / 60; g.stroke(); g.setLineDash([]);
    g.strokeStyle = `rgba(160,255,210,${0.3 + 0.2 * Math.sin(now / 400)})`; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(d) * rad, py + Math.sin(d) * rad); g.stroke(); g.restore(); } }
function doorGeom(d) { // returns {x,y,len,vert,ox,oy} in px for the line of cell edges; (ox,oy) points outward/away from the first room side
  const xs = [], ys = []; let vert = false, ox = 0, oy = 0;
  for (const [p, q] of d.cells) { const pin = Core.roomAt(p[0], p[1]) >= 0, qin = Core.roomAt(q[0], q[1]) >= 0; const out = pin && !qin ? q : (!pin && qin ? p : q), inn = out === q ? p : q; ox = Math.sign(out[0] - inn[0]); oy = Math.sign(out[1] - inn[1]);
    if (p[0] !== q[0]) { vert = true; xs.push(Math.max(p[0], q[0])); ys.push(p[1], p[1] + 1); } else { ys.push(Math.max(p[1], q[1])); xs.push(p[0], p[0] + 1); } }
  if (vert) return { x: xs[0] * CS, y: Math.min(...ys) * CS, len: (Math.max(...ys) - Math.min(...ys)) * CS, vert, ox, oy };
  return { x: Math.min(...xs) * CS, y: ys[0] * CS, len: (Math.max(...xs) - Math.min(...xs)) * CS, vert, ox, oy };
}
function doorMidCell(d) { const G = doorGeom(d); return [(G.x + (G.vert ? 0 : G.len / 2)) / CS, (G.y + (G.vert ? G.len / 2 : 0)) / CS]; }
function doorVisible(d) { const S = Core.state; return d.exterior || d.rooms.some(q => q >= 0 && S.rooms[q].known); }
function safeRing(g, d, now, planned) { const [mx, my] = doorMidCell(d), R = (Core.CHARGE_SAFE + 0.5) * CS; g.save(); g.strokeStyle = planned ? 'rgba(255,176,32,.55)' : `rgba(255,90,60,${0.55 + 0.3 * Math.sin(now / 200)})`; g.lineWidth = 2 / cam.z; g.setLineDash([7 / cam.z, 5 / cam.z]);
  g.beginPath(); g.arc(mx * CS, my * CS, R, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = planned ? 'rgba(255,176,32,.04)' : 'rgba(255,80,50,.06)'; g.fill();
  g.fillStyle = 'rgba(255,200,140,.85)'; g.font = `700 ${Math.max(9, 11 / cam.z)}px system-ui,sans-serif`; g.textAlign = 'center'; g.fillText('SAFE STANDOFF ' + Core.CHARGE_SAFE + ' m', mx * CS, my * CS - R - 4 / cam.z); g.restore(); }
/** v13 structure overlays: bars, cameras, duplex unit B tag and party-wall hole (world space). */
function drawStruct(g, now) { const S = Core.state, H = S.house;
  for (const w of S.windows) { if (!w.barred) continue; for (const [cx, cy, ox, oy] of w.edges) { const vert = cx !== ox, px = (Math.max(cx, ox) + (vert ? 0 : 0.5)) * CS, py = (Math.max(cy, oy) + (vert ? 0.5 : 0)) * CS, nx = (ox - cx) * 7, ny = (oy - cy) * 7;
    g.strokeStyle = '#2b2f36'; g.lineWidth = 3; g.beginPath(); for (let k = -2; k <= 2; k++) { const t = k * CS * 0.18; const bx = px + (vert ? 0 : t), by = py + (vert ? t : 0); g.moveTo(bx, by); g.lineTo(bx + nx, by + ny); } g.stroke();
    g.strokeStyle = '#8c939c'; g.lineWidth = 1.4; g.stroke(); } }
  if (S.cams) { const dark = S.power && S.power.cut; for (const c of S.cams) { const x = (c.x + 0.5) * CS, y = (c.y + 0.5) * CS, a = Math.atan2(c.dy, c.dx);
    if (!dark) { g.fillStyle = c.seen ? 'rgba(255,59,78,.13)' : 'rgba(255,59,78,.07)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, c.range * CS, a - c.fov / 2, a + c.fov / 2); g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,59,78,.3)'; g.setLineDash([4, 6]); g.lineWidth = 1.2; g.stroke(); g.setLineDash([]); }
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#1b1f26'; g.strokeStyle = dark ? '#6b7380' : '#ff3b4e'; g.lineWidth = 1.5; rr(g, -7, -5, 14, 10, 2); g.fill(); g.stroke(); g.fillStyle = dark ? '#3a3f47' : (Math.floor(now / 500) % 2 ? '#ff3b4e' : '#7a1520'); g.beginPath(); g.arc(4, 0, 2.5, 0, 7); g.fill(); g.restore(); } }
  const D = S.duplex; if (H.duplex && D) { const B = S.rooms.filter(q => q.unitB); if (B.length) { const x0 = Math.min(...B.map(q => q.x)), x1 = Math.max(...B.map(q => q.x + q.w)), y0 = Math.min(...B.map(q => q.y));
      const t = 'UNIT B · ' + (D.evac === 'empty' ? 'EMPTY' : D.evac === 'done' ? 'EVACUATED' : D.evac === 'moving' ? 'EVACUATING…' : D.residents + ' RESIDENT' + (D.residents > 1 ? 'S' : '') + ' HOME');
      const cx = (x0 + x1) / 2 * CS, cy = (y0 + 1.3) * CS; g.font = `800 ${CS * 0.3}px system-ui,Segoe UI,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; const tw = g.measureText(t).width + 14;
      g.fillStyle = 'rgba(6,14,26,.82)'; rr(g, cx - tw / 2, cy - 11, tw, 22, 6); g.fill(); g.strokeStyle = D.evac === 'done' || D.evac === 'empty' ? '#3ddc84' : D.evac === 'moving' ? '#ffb020' : '#ff8a3d'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = g.strokeStyle; g.fillText(t, cx, cy + 1); }
    if (D.hole) { const hx = (D.hole.x + 1) * CS, ys = D.hole.ys, ya = Math.min(...ys) * CS, yb = (Math.max(...ys) + 1) * CS;
      g.fillStyle = 'rgba(30,22,16,.9)'; g.fillRect(hx - 6, ya + 3, 12, yb - ya - 6); g.fillStyle = '#9a8f80'; for (let k = 0; k < 14; k++) { const a = k * 2.39, rd = 5 + (k * 5) % 15; g.fillRect(hx + Math.cos(a) * rd, (ya + yb) / 2 + Math.sin(a) * rd * 1.4, 3 + (k % 3), 2 + (k % 2)); }
      g.strokeStyle = '#ffb020'; g.lineWidth = 2; g.setLineDash([4, 3]); g.strokeRect(hx - 7, ya + 2, 14, yb - ya - 4); g.setLineDash([]);
      const t = 'PARTY WALL BREACHED'; g.font = `800 ${CS * 0.26}px system-ui,Segoe UI,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; const tw = g.measureText(t).width + 12, ty = ya - CS * 0.45;
      g.fillStyle = 'rgba(60,20,10,.88)'; rr(g, hx - tw / 2, ty - 10, tw, 20, 5); g.fill(); g.fillStyle = '#ffb020'; g.fillText(t, hx, ty + 1); } }
}
function drawDoors(g, now) {
  const S = Core.state;
  const cand = view.sel && (view.mode === 'breach' || view.mode === 'polecam' || view.mode === 'charge' || view.mode === 'detonate');
  for (const d of S.doors) { if (!doorVisible(d)) continue; const G = doorGeom(d);
    if (d.charge) safeRing(g, d, now, false);
    g.save(); g.translate(G.x, G.y); let oy = G.vert ? -G.ox : G.oy; if (G.vert) { g.rotate(Math.PI / 2); } // door along +x, len px; oy = outward normal in local coords
    const L2 = G.len;
    if (d.kind === 'garage') { if (d.state === 'breached') { g.strokeStyle = '#ffb020'; g.setLineDash([6, 5]); g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(L2, 0); g.stroke(); g.setLineDash([]); }
      else { g.fillStyle = '#8b939e'; g.fillRect(0, -5, L2, 10); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; for (let x = 8; x < L2; x += 10) { g.beginPath(); g.moveTo(x, -5); g.lineTo(x, 5); g.stroke(); } } }
    else if (d.state === 'closed') { g.fillStyle = d.steel ? '#6f7882' : d.barricaded && d.known ? '#8a5a3a' : '#a37b55'; g.fillRect(1, -4, L2 - 2, 8); if (d.steel) { g.fillStyle = 'rgba(255,255,255,.25)'; for (let x = 5; x < L2 - 3; x += 7) g.fillRect(x, -3, 1.5, 1.5), g.fillRect(x, 1.5, 1.5, 1.5); } g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5; g.strokeRect(1, -4, L2 - 2, 8);
      if (d.locked && d.known) { g.fillStyle = '#ffd36b'; g.beginPath(); g.arc(L2 - 7, 0, 2.5, 0, 7); g.fill(); }
      if (d.barricaded && d.known) { g.strokeStyle = '#5a3a22'; g.lineWidth = 3; g.beginPath(); g.moveTo(4, -oy * 8 - 3); g.lineTo(L2 - 4, -oy * 8 + 3); g.moveTo(4, -oy * 8 + 3); g.lineTo(L2 - 4, -oy * 8 - 3); g.stroke(); } }
    else if (d.state === 'open') { g.strokeStyle = 'rgba(190,160,120,.35)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.arc(0, 0, L2 - 2, 0, Math.PI / 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#a37b55'; g.fillRect(-3, 0, 6, L2 - 2); }
    else { g.strokeStyle = '#ffb020'; g.lineWidth = 3; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(0, 0); g.lineTo(L2, 0); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#7a5a3e'; for (let k = 0; k < 7; k++) { const a = k * 2.1, rd = 6 + (k * 7) % 14; g.fillRect(L2 / 2 + Math.cos(a) * rd, Math.sin(a) * rd, 4, 3); } }
    // storm / security screen door on the outside face, once revealed
    if (d.storm && d.stormKnown) { const yy = oy * 8; if (d.stormState === 'breached' || d.stormState === 'open') { g.strokeStyle = 'rgba(160,180,200,.5)'; g.setLineDash([3, 3]); g.lineWidth = 2; g.beginPath(); g.moveTo(2, yy); g.lineTo(L2 - 2, yy); g.stroke(); g.setLineDash([]); }
      else { g.strokeStyle = '#9fb0c2'; g.lineWidth = 2.5; g.strokeRect(2, yy - 2.5, L2 - 4, 5); g.strokeStyle = 'rgba(159,176,194,.5)'; g.lineWidth = 1; for (let x = 6; x < L2 - 3; x += 4) { g.beginPath(); g.moveTo(x, yy - 2.5); g.lineTo(x, yy + 2.5); g.stroke(); } } }
    if (d.charge) { const cx = L2 / 2, cy = oy * 11; g.fillStyle = '#2a1a10'; g.strokeStyle = '#ffb020'; g.lineWidth = 2; rr(g, cx - 9, cy - 6, 18, 12, 2); g.fill(); g.stroke();
      g.fillStyle = Math.floor(now / 300) % 2 ? '#ff3b4e' : '#5a1010'; g.beginPath(); g.arc(cx + 5, cy - 1, 2.5, 0, 7); g.fill(); g.strokeStyle = '#ffb020'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 6, cy); g.lineTo(cx + 1, cy); g.stroke(); }
    if (cand && d.state === 'closed') { const p = 0.5 + 0.5 * Math.sin(now / 220); g.strokeStyle = `rgba(255,176,32,${0.4 + 0.5 * p})`; g.lineWidth = 2.5; g.beginPath(); g.arc(L2 / 2, 0, CS * (0.55 + 0.15 * p), 0, 7); g.stroke(); }
    if (view.hoverDoor === d.id) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(L2 / 2, 0, CS * 0.7, 0, 7); g.stroke(); }
    g.restore(); }
  for (const w of S.windows) { if (!w.broken) continue; for (const [cx, cy, ox, oy] of w.edges) { const px = (Math.max(cx, ox) + (cx === ox ? 0.5 : 0)) * CS, py = (Math.max(cy, oy) + (cy === oy ? 0.5 : 0)) * CS;
    if (w.cleared) { const vert = cx !== ox; g.fillStyle = 'rgba(20,14,8,.95)'; g.fillRect(px - (vert ? 3 : CS / 2), py - (vert ? CS / 2 : 3), vert ? 6 : CS, vert ? CS : 6); g.strokeStyle = '#ffb020'; g.lineWidth = 1.5; g.strokeRect(px - (vert ? 3 : CS / 2), py - (vert ? CS / 2 : 3), vert ? 6 : CS, vert ? CS : 6); } // torn-out opening (Draco)
    g.fillStyle = 'rgba(180,230,255,.7)'; for (let k = 0; k < 6; k++) g.fillRect(px + Math.cos(k * 1.7) * (4 + k * 2), py + Math.sin(k * 1.7) * (4 + k * 2), 3, 2); } }
}
function worldFx(g, now) {
  for (const a of anims) { const t = (now - a.t0) / 1000; if (t < 0) continue; const px = wpx(a.x), py = wpx(a.y); // queued fx (staggered start) not yet playing
    switch (a.type) {
      case 'shot': if (t < 0.35) { const c = a.friendly ? '160,220,255' : '255,220,120'; g.strokeStyle = `rgba(${c},${1 - t / 0.35})`; g.lineWidth = 2.5; g.beginPath(); g.moveTo(px, py); g.lineTo(wpx(a.tx), wpx(a.ty)); g.stroke(); } break;
      case 'muzzle': if (t < 0.25) { g.save(); g.globalCompositeOperation = 'lighter'; glow(g, px, py, CS * 1.3, a.friendly ? 'rgba(170,220,255,A)' : 'rgba(255,200,90,A)', 0.8 * (1 - t / 0.25)); g.restore(); } break;
      case 'impact': if (t < 0.5) { g.save(); g.globalCompositeOperation = 'lighter'; for (let k = 0; k < 8; k++) { const ang = k * 0.8 + a.id, d = CS * (0.2 + t * 2.2) * (0.6 + (k % 3) * 0.2); g.fillStyle = `rgba(255,${190 + k * 8},90,${1 - t / 0.5})`; g.fillRect(px + Math.cos(ang) * d, py + Math.sin(ang) * d, 3, 3); } g.restore(); } break;
      case 'hitflash': if (t < 0.5) { g.save(); g.globalCompositeOperation = 'lighter'; glow(g, px, py, CS * (0.8 + t * 2), 'rgba(255,255,255,A)', 0.7 * (1 - t / 0.5)); g.restore(); } break;
      case 'taser': if (t < 0.4) { g.strokeStyle = `rgba(255,226,90,${1 - t / 0.4})`; g.lineWidth = 3; g.beginPath(); g.moveTo(wpx(a.fromX), wpx(a.fromY)); g.lineTo(px, py); g.stroke(); } break;
      case 'll': if (t < 0.4) { g.strokeStyle = `rgba(180,140,255,${1 - t / 0.4})`; g.lineWidth = 3; g.beginPath(); g.moveTo(wpx(a.fromX), wpx(a.fromY)); g.lineTo(px, py); g.stroke(); } break;
      case 'flash': { if (t < 0.25) { const k = t / 0.25; g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(lerp(wpx(a.fromX), px, k), lerp(wpx(a.fromY), py, k), 4, 0, 7); g.fill(); }
        else if (t < 1.2) { const k = (t - 0.25) / 0.95; g.save(); g.globalCompositeOperation = 'lighter'; glow(g, px, py, CS * (2 + 5 * k), 'rgba(255,255,240,A)', 0.95 * (1 - k)); g.restore(); } break; }
      case 'gas': if (t < 0.3) { const k = t / 0.3; g.fillStyle = '#c8d8a0'; g.beginPath(); g.arc(lerp(wpx(a.fromX), px, k), lerp(wpx(a.fromY), py, k), 4, 0, 7); g.fill(); } else if (t < 1.4) { glow(g, px, py, CS * (1 + 2 * t), 'rgba(216,236,196,A)', 0.4 * (1 - t / 1.4)); } break;
      case 'breach': if (t < 1.0) { g.save(); g.globalCompositeOperation = 'lighter'; glow(g, px, py, CS * (1 + 3 * t), 'rgba(255,170,60,A)', 0.8 * (1 - t)); g.restore();
          g.strokeStyle = `rgba(255,190,90,${1 - t})`; g.lineWidth = 2; g.beginPath(); g.arc(px, py, CS * (0.5 + 2.5 * t), 0, 7); g.stroke(); } break;
      case 'blast': if (t < 1.4) { const R = (a.r || 5) * CS; g.save(); g.globalCompositeOperation = 'lighter'; if (t < 0.5) glow(g, px, py, R * (0.4 + t * 1.4), 'rgba(255,230,170,A)', 1 - t / 0.5); g.restore();
          for (let k = 0; k < 2; k++) { const tt = t - k * 0.15; if (tt < 0) continue; g.strokeStyle = `rgba(255,235,200,${Math.max(0, 0.9 - tt / 1.2)})`; g.lineWidth = (6 - k * 3) * (1 - tt / 1.4) + 1; g.beginPath(); g.arc(px, py, R * Math.min(1.4, tt * 1.6), 0, 7); g.stroke(); } } break;
      case 'thud': case 'glass': if (t < 0.6) { g.strokeStyle = `rgba(200,230,255,${0.8 * (1 - t / 0.6)})`; g.lineWidth = 2; g.beginPath(); g.arc(px, py, CS * (0.4 + 1.6 * t), 0, 7); g.stroke(); } break;
      case 'flyby': if (t < 2.2) { const H = Core.state.house, k = t / 2.2; const x = lerp((H.x0 - 4) * CS, (H.x1 + 5) * CS, k), y = ((H.y0 + H.y1) / 2) * CS + Math.sin(k * 6) * CS * 2;
          g.fillStyle = 'rgba(127,227,255,.9)'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.save(); g.globalCompositeOperation = 'lighter'; glow(g, x, y, CS * 3, 'rgba(56,200,255,A)', 0.35); g.restore(); } break;
    } }
  anims = anims.filter(a => now - a.t0 < 2500);
}
function drawRoadblocks(g, now) { const S = Core.state, G = S.geo, s = sz(); if (!S.roadblocks) return;
  for (const b of S.roadblocks) { const held = Core.roadblockHeld(b), bx = b.side === 'W' ? b.x - 2.6 : b.x + 3.6;
    const [x0, y0] = toScreen(bx, G.ST), [x1, y1] = toScreen(bx + 0.5, G.SB + 1); const hgt = y1 - y0, wd = Math.max(4, x1 - x0);
    g.save(); g.globalAlpha = held ? 0.95 : 0.35; g.beginPath(); g.rect(x0, y0, wd, hgt); g.clip(); const st = Math.max(6, wd * 1.4);
    for (let i = -2; i * st < hgt + wd; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#e8401c'; g.beginPath(); g.moveTo(x0, y0 + i * st); g.lineTo(x0 + wd, y0 + i * st - wd); g.lineTo(x0 + wd, y0 + (i + 1) * st - wd); g.lineTo(x0, y0 + (i + 1) * st); g.fill(); }
    g.restore();
    if (cam.z > 0.22) { const t = held ? 'TRAFFIC BLOCKED' : 'STREET OPEN'; g.font = `800 ${9 * s}px system-ui,sans-serif`; const tw = g.measureText(t).width + 10, tx = x0 + wd / 2, ty = y0 - 10 * s;
      g.fillStyle = 'rgba(8,12,18,.85)'; rr(g, tx - tw / 2, ty - 7 * s, tw, 14 * s, 3); g.fill(); g.fillStyle = held ? '#ffd0c0' : '#ffb020'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, tx, ty); } } }
function drawContain(g, now) {
  const S = Core.state; const s = sz(); drawRoadblocks(g, now);
  for (const c of S.contain) if (c.q === 'cruiser' && c.car && !c.covered) { // ghost cruiser outline: where a car must be parked to screen this post
    const [gx, gy] = toScreen(c.car.x + 0.5, c.car.y + 0.5), L = 3 * CS * cam.z, W = 1.5 * CS * cam.z; g.save(); g.translate(gx, gy); g.strokeStyle = c.screened ? 'rgba(62,240,160,.7)' : 'rgba(127,227,255,' + (0.55 + 0.3 * Math.sin(now / 350)) + ')'; g.lineWidth = 1.6; g.setLineDash([5, 4]);
    rr(g, -L / 2, -W / 2, L, W, 4 * s); g.stroke(); g.setLineDash([]); if (cam.z > 0.4) { g.fillStyle = 'rgba(127,227,255,.85)'; g.font = `700 ${7.5 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PARK CRUISER', 0, 0); } g.restore(); }
  // v8: no contain-post markers on the map (status lives in the Building Info panel and the Status Check)
}
/** Sniper perches (neighbor rooftops / windows) shown while choosing an overwatch spot. */
function drawPerches(g, now) { const S = Core.state; if (view.mode !== 'overwatch' || !view.sel || S.phase !== 'planning') return; const s = sz();
  for (const p of S.perches) { const [x, y] = toScreen(p.x + 0.5, p.y + 0.5); const pul = 0.5 + 0.5 * Math.sin(now / 300 + p.id);
    g.strokeStyle = `rgba(62,240,160,${0.6 + 0.4 * pul})`; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 13 * s, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x - 18 * s, y); g.lineTo(x + 18 * s, y); g.moveTo(x, y - 18 * s); g.lineTo(x, y + 18 * s); g.stroke();
    g.fillStyle = 'rgba(4,20,14,.85)'; g.font = `700 ${10 * s}px system-ui,sans-serif`; const t = p.name.toUpperCase(); const tw = g.measureText(t).width + 10; rr(g, x - tw / 2, y + 16 * s, tw, 15 * s, 4); g.fill(); g.fillStyle = '#9ff5cf'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 16 * s + 7.5 * s); } }
function drawPlans(g, now) {
  const S = Core.state; if (S.phase === 'over') return; const s = sz();
  if (planVer !== S.version) { plans.clear(); for (const u of S.units) if (u.orders && u.orders.length && u.status === 'ok') plans.set(u.uid, Core.planFor(u)); planVer = S.version; }
  if (S.phase !== 'planning') return;
  for (const [uid, pl] of plans) { const u = Core.unit(uid); if (!u) continue; const selected = view.sel === uid; const base = u.kind === 'patrol' || u.kind === 'cruiser' ? '159,183,208' : u.kind === 'team' ? '56,200,255' : '180,140,255';
    pl.forEach((p, i) => { const col = p.ok ? `rgba(${base},${selected ? 0.95 : 0.6})` : 'rgba(255,59,78,.9)';
      const pts = [p.start].concat(p.path || []); const dp = p.dpath ? [p.start].concat(p.dpath) : null;
      const line = (arr, dash, ex) => { if (arr.length < 2) return; g.save(); g.lineWidth = (selected ? 3 : 2) * s; g.setLineDash(dash); g.lineDashOffset = -now / 40;
        for (let k = 1; k < arr.length; k++) { const e = ex && p.ok ? (ex[k - 1] || 0) : 0; g.strokeStyle = e >= 0.6 ? `rgba(255,59,78,${selected ? 1 : 0.8})` : e >= 0.15 ? `rgba(255,176,32,${selected ? 1 : 0.75})` : col;
          const [x0, y0] = toScreen(arr[k - 1][0] + 0.5, arr[k - 1][1] + 0.5), [x1, y1] = toScreen(arr[k][0] + 0.5, arr[k][1] + 0.5); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); } g.restore(); };
      line(pts, [2 * s, 7 * s], p.expo); if (dp) line(dp, [8 * s, 6 * s], null);
      const o = p.order; let tx = null, ty = null;
      if ((o.type === 'breach' || o.type === 'polecam' || o.type === 'detonate') && S.doors[o.door]) { [tx, ty] = doorMidCell(S.doors[o.door]); if (o.type === 'breach' && (o.method === 'charge' || o.hangOnly)) { g.save(); g.translate(VW / 2, VH / 2); g.scale(cam.z, cam.z); g.translate(-cam.x, -cam.y); safeRing(g, S.doors[o.door], now, true); g.restore(); } }
      else if ((o.type === 'bang' || o.type === 'gas') && S.rooms[o.room]) { const rm = S.rooms[o.room]; tx = rm.x + rm.w / 2; ty = rm.y + rm.h / 2; }
      else if (o.type === 'shoot') { tx = o.x + 0.5; ty = o.y + 0.5; }
      const end = p.ok ? p.end : (o.x != null ? [o.x, o.y] : p.start); const dend = dp ? dp[dp.length - 1] : end;
      const [ex, ey] = toScreen(dend[0] + 0.5, dend[1] + 0.5);
      if (tx != null) { const [qx, qy] = toScreen(tx, ty); g.save(); g.strokeStyle = o.type === 'breach' || o.type === 'detonate' ? 'rgba(255,176,32,.9)' : o.type === 'gas' ? 'rgba(200,230,150,.9)' : o.type === 'shoot' ? 'rgba(255,90,100,.9)' : 'rgba(255,255,255,.9)'; g.lineWidth = 2 * s; g.setLineDash([3 * s, 4 * s]);
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(qx, qy); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(qx, qy, 8 * s, 0, 7); g.stroke(); g.restore(); }
      const r = 10 * s; g.fillStyle = p.ok ? 'rgba(6,18,34,.92)' : 'rgba(60,8,14,.92)'; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(ex, ey, r, 0, 7); g.fill(); g.stroke();
      g.fillStyle = p.ok ? '#e6f7ff' : '#ffd0d5'; g.font = `700 ${11 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ICON[o.type] || '•', ex, ey + 0.5);
      g.fillStyle = col; g.font = `700 ${9 * s}px system-ui,sans-serif`; g.fillText(String(i + 1), ex + r + 4 * s, ey - r + 2 * s);
      if (o.type === 'move' && o.exposed) { g.fillStyle = '#ff3b4e'; g.beginPath(); g.moveTo(ex + r * 0.9, ey - r * 1.9); g.lineTo(ex + r * 1.9, ey - r * 0.2); g.lineTo(ex - r * 0.1, ey - r * 0.2); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.font = `900 ${9 * s}px system-ui`; g.fillText('!', ex + r * 0.9, ey - r * 0.75); g.fillStyle = '#ff8b97'; g.font = `800 ${10 * s}px system-ui,sans-serif`; g.fillText('⚠ EXPOSED', ex, ey - r - 12 * s); }
      if (p.ok && p.expo && p.expo.some(e => e >= 0.6) && (selected || o.routeExposed) && !o.exposed) { g.fillStyle = '#ff8b97'; g.font = `700 ${10 * s}px system-ui,sans-serif`; g.fillText('EXPOSED ROUTE', ex, ey + r + 10 * s); }
      if (!p.ok && selected) { g.fillStyle = '#ff8b97'; g.font = `600 ${11 * s}px system-ui,sans-serif`; g.fillText(p.reason || 'invalid', ex, ey + r + 10 * s); } }); }
}
/** Aim preview: line from the shooter to the hovered target with the hit-chance readout. */
function drawAim(g, now) { const a = view.aim; if (!a || !view.sel) return; const u = Core.unit(view.sel); if (!u) return; const s = sz();
  const [x0, y0] = toScreen(a.fx + 0.5, a.fy + 0.5), [x1, y1] = toScreen(a.x + 0.5, a.y + 0.5); g.save(); g.strokeStyle = a.p > 0 ? 'rgba(255,90,100,.85)' : 'rgba(150,150,160,.7)'; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.arc(x1, y1, 12 * s, 0, 7); g.moveTo(x1 - 17 * s, y1); g.lineTo(x1 + 17 * s, y1); g.moveTo(x1, y1 - 17 * s); g.lineTo(x1, y1 + 17 * s); g.stroke();
  const t = a.p > 0 ? `HIT ${Math.round(a.p * 100)}%` : (a.why || 'no shot').toUpperCase(); g.font = `800 ${12 * s}px system-ui,sans-serif`; const tw = g.measureText(t).width + 12; g.fillStyle = 'rgba(30,4,8,.9)'; rr(g, x1 + 16 * s, y1 - 24 * s, tw, 18 * s, 4); g.fill(); g.fillStyle = '#ffd0d5'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, x1 + 22 * s, y1 - 15 * s); g.restore(); }
function drawMarkers(g, now) {
  const S = Core.state, s = sz();
  drawCasualties(g, now, s);
  const L_ = Core.suspList ? Core.suspList() : [S.suspect], multi = L_.length > 1;
  for (const sp of L_) drawSuspectMark(g, now, s, S, sp, multi);
  drawHide(g, s, S);
}
/** Parole hide (attic hatch / basement door): shown once its room has been seen or the hide was found. */
function drawHide(g, s, S) { const H = S.hide; if (!H || !(H.found || (S.rooms[H.room] && S.rooms[H.room].explored) || S.phase === 'over')) return;
  const [x, y] = toScreen(H.x + 0.5, H.y + 0.5), w = 14 * s; g.save(); g.strokeStyle = '#d8b46a'; g.lineWidth = 2; g.fillStyle = 'rgba(40,30,10,.75)'; g.fillRect(x - w / 2, y - w / 2, w, w); g.strokeRect(x - w / 2, y - w / 2, w, w);
  g.beginPath(); if (H.kind === 'attic') { g.moveTo(x - w / 2, y - w / 2); g.lineTo(x + w / 2, y + w / 2); g.moveTo(x + w / 2, y - w / 2); g.lineTo(x - w / 2, y + w / 2); } else { for (let i = 1; i < 4; i++) { g.moveTo(x - w / 2, y - w / 2 + i * w / 4); g.lineTo(x + w / 2, y - w / 2 + i * w / 4); } } g.stroke();
  g.fillStyle = '#e8cf95'; g.font = `700 ${9 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(H.kind === 'attic' ? 'ATTIC HATCH' : 'BASEMENT', x, y - w / 2 - 7 * s); g.restore(); }
/** One suspect marker (v11: drawn for every suspect; letters in multi-suspect calls). */
function drawSuspectMark(g, now, s, S, sp, multi) {
  if (sp.mode === 'escaped' && !sp.visible) return;
  if (sp.heat && !sp.visible) { const [x, y] = toScreen(sp.heat.x + 0.5, sp.heat.y + 0.5); const p = 0.5 + 0.5 * Math.sin(now / 300); const R = Math.min(60, 26 * s * cam.z + 10); const rg = g.createRadialGradient(x, y, 0, x, y, R);
    rg.addColorStop(0, `rgba(255,120,40,${0.55 + 0.2 * p})`); rg.addColorStop(0.5, 'rgba(255,60,30,.25)'); rg.addColorStop(1, 'rgba(255,60,30,0)'); g.fillStyle = rg; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
    g.fillStyle = '#ffb38a'; g.font = `700 ${10 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.fillText('HEAT', x, y - 18 * s); }
  if (sp.lastKnown && !sp.visible) { const [x, y] = toScreen(sp.lastKnown.x + 0.5, sp.lastKnown.y + 0.5); g.strokeStyle = 'rgba(255,59,78,.6)'; g.setLineDash([4, 4]); g.lineWidth = 2; g.beginPath(); g.arc(x, y, 12 * s, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,120,130,.8)'; g.font = `600 ${9 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.fillText('LAST SEEN', x, y + 22 * s); }
  if (sp.visible || S.phase === 'over' && sp.mode !== 'escaped') { const [px, py] = posOf('S' + (sp.key || 'S'), sp.x, sp.y); const [x, y] = toScreen(px + 0.5, py + 0.5); const hostile = ['barricaded', 'alert', 'fleeing'].includes(sp.mode);
    const col = hostile ? '#ff3b4e' : sp.mode === 'detained' ? '#3ef0a0' : '#ffb020'; const r = 11 * s;
    g.save(); g.shadowColor = col; g.shadowBlur = 16; g.fillStyle = 'rgba(30,4,8,.9)'; g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5); g.strokeStyle = col; g.lineWidth = 2.5; g.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5); g.restore();
    g.fillStyle = col; g.font = `800 ${11 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y + 0.5);
    if (sp.maskSeen) badge(g, x - r - 2, y - r - 2, 'M', '#ffb020', '#2a1a04', s);
    if ((sp.impair || 0) > 0.2 && !(sp.maskOn)) badge(g, x + r + 2, y - r - 2, '☁', '#cfe8b0', '#1a2a10', s);
    const nm = multi && sp.label ? 'SUSPECT ' + sp.label : 'SUSPECT', tag0 = sp.injured && ['barricaded', 'alert'].includes(sp.mode) ? nm + ' · INJURED' : sp.walk && sp.mode === 'surrendered' ? (sp.walk.stage === 'kneel' ? 'KNEELING · HANDS UP' : 'WALKING OUT') : sp.deceased ? 'DECEASED' : { barricaded: nm + (sp.weapon === 'none' ? '' : ' · ARMED'), alert: nm + ' · ALERT', fleeing: nm + ' · FLEEING', surrendered: 'SURRENDERED', incapacitated: 'INCAPACITATED', detained: 'IN CUSTODY' }[sp.mode] || nm;
    const tag = multi && sp.label && !tag0.startsWith('SUSPECT') ? sp.label + ' · ' + tag0 : tag0;
    g.font = `700 ${10 * s}px system-ui,sans-serif`; const tw = g.measureText(tag).width + 10; g.fillStyle = 'rgba(20,4,8,.85)'; rr(g, x - tw / 2, y + r + 4, tw, 16 * s, 4); g.fill(); g.fillStyle = col; g.fillText(tag, x, y + r + 4 + 8 * s); }
}
/** Casualties (✚ + critical countdown, '?' when status unknown), memorial plaques, EMS point, walk-out spot. No gore: neutral symbols only. */
function drawCasualties(g, now, s) { const S = Core.state, sp = S.suspect; g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
  if (S.ems) { const [x, y] = toScreen(S.ems.x + 0.5, S.ems.y + 0.5); const w = 26 * s, h = 14 * s; g.fillStyle = '#f2f5f8'; g.strokeStyle = '#3aa0ff'; g.lineWidth = 2; rr(g, x - w / 2, y - h / 2, w, h, 3); g.fill(); g.stroke();
    g.fillStyle = '#1f6fd6'; g.fillRect(x - 2 * s, y - 5 * s, 4 * s, 10 * s); g.fillRect(x - 5 * s, y - 2 * s, 10 * s, 4 * s);
    const n = (S.cas || []).filter(c => c.state === 'transport').length; g.fillStyle = '#9fd0ff'; g.font = `700 ${9 * s}px system-ui,sans-serif`; g.fillText('EMS' + (n ? ` · ${n} LOADING` : ''), x, y + h / 2 + 8 * s); }
  if (['barricaded', 'alert'].includes(sp.mode) && (S.nego && (S.nego.contact || S.surrSpot)) || sp.walk && sp.walk.stage !== 'kneel') { const sp_ = Core.surrSpot(); if (sp_) { const [x, y] = toScreen(sp_[0] + 0.5, sp_[1] + 0.5); g.strokeStyle = 'rgba(62,240,160,.8)'; g.setLineDash([4, 3]); g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11 * s, 0, 7); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(x, y, 3 * s, 0, 7); g.fillStyle = 'rgba(62,240,160,.9)'; g.fill(); g.font = `700 ${8.5 * s}px system-ui,sans-serif`; g.fillText('WALK-OUT', x, y - 18 * s); } }
  for (const c of S.cas || []) { if (c.who === 'suspect' && c.state !== 'lost' && c.state !== 'kia') continue; const [x, y] = toScreen(c.x + 0.5 + (c.who === 'officer' ? 0.6 : 0), c.y + 0.5 - (c.who === 'officer' ? 0.6 : 0));
    if (c.state === 'kia' || c.state === 'lost') { if (!c.known && c.who === 'suspect') continue; const w = 16 * s, h = 12 * s; g.fillStyle = '#4a5260'; g.strokeStyle = '#aab4c2'; g.lineWidth = 1.5; rr(g, x - w / 2, y - h / 2, w, h, 2); g.fill(); g.stroke();
      star(g, x, y, 4 * s, '#e6eef7'); if (cam.z > 0.35) { g.fillStyle = 'rgba(200,210,222,.85)'; g.font = `600 ${8 * s}px system-ui,sans-serif`; g.fillText(c.name.split(' ').pop(), x, y + h / 2 + 7 * s); } continue; }
    if (!Core.casActive(c)) continue;
    if (!c.known) { g.fillStyle = 'rgba(40,46,56,.9)'; g.strokeStyle = '#9aa6b5'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 8 * s, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#d8e0ea'; g.font = `800 ${10 * s}px system-ui,sans-serif`; g.fillText('?', x, y + 0.5);
      if (cam.z > 0.3) { g.font = `600 ${8 * s}px system-ui,sans-serif`; g.fillText('NO RESPONSE', x, y + 15 * s); } continue; }
    const crit = !c.stable && c.crit <= 2, col = c.stable ? '#3ef0a0' : c.state === 'mobile' ? '#ffb020' : crit ? '#ff6a3a' : '#ffd24a'; const pul = crit ? 0.5 + 0.5 * Math.sin(now / 200) : 0;
    g.fillStyle = '#10161f'; g.strokeStyle = col; g.lineWidth = 2 + pul; g.beginPath(); g.arc(x, y, 9 * s, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#f4f7fa'; g.fillRect(x - 1.6 * s, y - 5 * s, 3.2 * s, 10 * s); g.fillRect(x - 5 * s, y - 1.6 * s, 10 * s, 3.2 * s);
    const t = (c.state === 'mobile' ? 'MOBILE' : 'IMMOBILE') + (c.stable ? ' · STABLE' : ` · CRIT ${Core.tDur(c.crit)}`) + (c.carrier ? ' · MOVING' : '');
    if (cam.z > 0.3) { g.font = `700 ${8.5 * s}px system-ui,sans-serif`; const tw = g.measureText(t).width + 8; g.fillStyle = 'rgba(8,12,18,.85)'; rr(g, x - tw / 2, y + 11 * s, tw, 13 * s, 3); g.fill(); g.fillStyle = col; g.fillText(t, x, y + 17.5 * s); } }
  g.restore(); }
function star(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr_ = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr_, y + Math.sin(a) * rr_); } g.closePath(); g.fill(); }
function badge(g, x, y, t, fg, bg, s) { g.fillStyle = bg; g.strokeStyle = fg; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 7.5 * s, 0, 7); g.fill(); g.stroke(); g.fillStyle = fg; g.font = `800 ${9 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 0.5); }
const COVER_COL = { cover: '#3ef0a0', partial: '#ffb020', open: '#ff3b4e' };
/** Small cover shield: green = in cover, amber = partial, red = open. */
function coverBadge(g, x, y, ci, s) { if (!ci || ci.level === 'inside') return; const c = COVER_COL[ci.level]; const w = 12 * s, h = 14 * s;
  g.save(); shieldPath(g, x, y, w, h); g.fillStyle = 'rgba(4,10,18,.9)'; g.fill(); g.strokeStyle = c; g.lineWidth = 1.8; g.stroke();
  if (ci.level === 'cover') { shieldPath(g, x, y, w * 0.55, h * 0.55); g.fillStyle = c; g.fill(); } else if (ci.level === 'partial') { g.fillStyle = c; g.fillRect(x - w * 0.25, y - h * 0.1, w * 0.5, h * 0.3); } else { g.fillStyle = c; g.font = `900 ${9 * s}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y + 1); } g.restore(); }
function shieldPath(g, x, y, w, h) { g.beginPath(); g.moveTo(x, y - h / 2); g.quadraticCurveTo(x + w * 0.35, y - h * 0.36, x + w / 2, y - h * 0.4); g.lineTo(x + w / 2, y - h * 0.02); g.quadraticCurveTo(x + w * 0.45, y + h * 0.3, x, y + h / 2); g.quadraticCurveTo(x - w * 0.45, y + h * 0.3, x - w / 2, y - h * 0.02); g.lineTo(x - w / 2, y - h * 0.4); g.quadraticCurveTo(x - w * 0.35, y - h * 0.36, x, y - h / 2); g.closePath(); }
/** Officers tuck toward their cover object: offset the marker 0.28 cell toward it. */
function tuck(u, ux, uy) { if (u.kind !== 'team' && u.kind !== 'patrol') return [ux, uy]; if (animating) return [ux, uy]; const ci = Core.coverInfo(u.x, u.y); if (!ci || !ci.dx && !ci.dy) return [ux, uy]; return [ux + ci.dx * 0.28, uy + ci.dy * 0.28]; }
const formCache = new Map();
function formOf(u) { const S = Core.state, key = `${S.seed}|${u.x},${u.y}|${(u.dir || 0).toFixed(2)}|${S.version}|${S.tick}|${S.phase}|${u.perch ? 1 : 0}`; const c = formCache.get(u.uid); if (c && c.key === key) return c.f;
  const f = Core.formationFor ? Core.formationFor(u) : null; formCache.set(u.uid, { key, f }); return f; }
function teamShield(u) { const s = sz(); let [ux, uy] = posOf(u.uid, u.x, u.y); [ux, uy] = u.inCar && inCarPos(u) ? inCarPos(u) : tuck(u, ux, uy); const [x, y] = toScreen(ux + 0.5, uy + 0.5); const lift = cam.z < 0.4 ? 26 : 40; return { x, y, sx: x, sy: y - lift * s, s }; }
/** v8: an occupant's chip rides on its vehicle (offset by seat) — the chip is how the vehicle is commanded. */
function inCarPos(u) { const c = Core.unit(u.inCar); if (!c) return null; const i = Math.max(0, c.occ.indexOf(u.uid)), n = c.occ.length; const [cx, cy] = posOf(c.uid, c.x, c.y);
  return [cx + (i - (n - 1) / 2) * 1.1, cy - (u.kind === 'team' ? 0.2 : 0)]; }
function onFootVisible(u) { return !(u.kind === 'patrol' && u.inCar) && !(u.kind === 'team' && !u.deployed && false); }
function drawUnits(g, now) {
  const S = Core.state, s = sz(), plan = S.phase === 'planning';
  for (const u of S.units) { if (u.kind === 'team' || u.kind === 'cruiser') continue; if (u.kind === 'patrol' && u.inCar && !inCarPos(u)) continue;
    let [ux, uy] = posOf(u.uid, u.x, u.y); [ux, uy] = u.inCar ? inCarPos(u) : tuck(u, ux, uy); const [x, y] = toScreen(ux + 0.5, uy + 0.5); const sel = view.sel === u.uid; const down = u.status !== 'ok';
    if (u.kind === 'patrol' && down) continue; // shown as a casualty marker instead
    if (u.kind === 'patrol') { const r = 11 * s; if (sel) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 5, 0, 7); g.stroke(); }
      g.save(); g.shadowColor = 'rgba(159,183,208,.7)'; g.shadowBlur = down ? 0 : 10; g.fillStyle = down ? '#3a1a20' : '#1d2a3a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore();
      g.strokeStyle = down ? '#ff3b4e' : u.panic > 0 ? '#ffb020' : COL.patrol; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      if (!down) { const d = dirOf(u.uid, u.dir || 0); g.fillStyle = COL.patrol; g.beginPath(); g.moveTo(x + Math.cos(d) * (r + 6), y + Math.sin(d) * (r + 6)); g.lineTo(x + Math.cos(d + 0.4) * (r + 1), y + Math.sin(d + 0.4) * (r + 1)); g.lineTo(x + Math.cos(d - 0.4) * (r + 1), y + Math.sin(d - 0.4) * (r + 1)); g.fill(); }
      g.fillStyle = '#e6eef7'; g.font = `700 ${10 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P' + u.num, x, y + 0.5);
      if (!down && !u.inCar) { coverBadge(g, x + r + 2, y + r - 2, Core.coverInfo(u.x, u.y), s); if ((u.impair || 0) > 0.05) badge(g, x - r - 2, y - r, '☁', '#cfe8b0', '#1a2a10', s); }
      if (!down && cam.z > 0.3) { const tag = u.panic > 0 ? 'PANIC' : (u.impair || 0) > 0.3 ? 'COUGHING' : u.retreating ? 'FALLING BACK' : ''; if (tag) { g.fillStyle = u.panic > 0 ? '#ffb020' : '#cfe8b0'; g.font = `700 ${9 * s}px system-ui,sans-serif`; g.fillText(tag, x, y - r - 9 * s); } } }
    else { if (down) continue; const r = 9 * s; g.save(); g.shadowColor = COL.violet; g.shadowBlur = 12; g.fillStyle = '#1e1636'; g.strokeStyle = COL.violet; g.lineWidth = 2;
      if (u.kind === 'drone') { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); for (const a of [0.785, 2.356, 3.927, 5.498]) { g.beginPath(); g.arc(x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2, r * 0.45, 0, 7); g.stroke(); } }
      else { rr(g, x - r, y - r * 0.8, r * 2, r * 1.6, 3); g.fill(); g.stroke(); }
      g.restore(); g.fillStyle = '#e8dcff'; g.font = `700 ${9 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(u.kind === 'drone' ? 'D' : 'R', x, y + 0.5);
      g.fillStyle = 'rgba(232,220,255,.8)'; g.font = `600 ${8 * s}px system-ui,sans-serif`; g.fillText('⚡' + u.battery, x, y + r + 9 * s);
      if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 7, 0, 7); g.stroke(); } } }
  // cruiser occupant badges
  for (const c of S.units) { if (c.kind !== 'cruiser') continue; const [ux, uy] = posOf(c.uid, c.x, c.y); const [x, y] = toScreen(ux + 0.5, uy + 0.5); const n = (c.occ || []).length;
    if (cam.z > 0.25) { const t = c.name.toUpperCase() + (n ? '' : ' · EMPTY · COVER') + (c.disabled ? ' · DISABLED' : ''); g.font = `700 ${9 * s}px system-ui,sans-serif`; const tw = g.measureText(t).width + 10; g.fillStyle = 'rgba(4,12,24,.85)'; rr(g, x - tw / 2, y + 22 * s * Math.max(1, cam.z), tw, 14 * s, 4); g.fill(); g.fillStyle = c.disabled ? '#ff8b97' : '#cfe0f0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y + 22 * s * Math.max(1, cam.z) + 7 * s); }
  }
  const teams = S.units.filter(u => u.kind === 'team'); teams.sort((a, b) => (view.sel === a.uid) - (view.sel === b.uid));
  for (const u of teams) { if (!u.deployed && u.status === 'ok' && !Core.teamOk(u).length) continue; const T = teamShield(u), { x, y, sx, sy } = T; const sel = view.sel === u.uid; const down = u.status !== 'ok'; const n = Core.teamOk(u).length; const col = down ? '#ff3b4e' : sel ? '#7fe3ff' : u.perch ? '#3ef0a0' : '#38c8ff';
    const F = down || u.inCar ? null : formOf(u);
    if (F && F.pts.length) { // one blue dot per team member, laid out in the context formation (stack / column / fan / cover line)
      const rd = Math.max(3.2, Math.min(7, 0.14 * CS * cam.z)), k = CS * cam.z; g.save(); g.shadowColor = col; g.shadowBlur = 6;
      F.pts.forEach(([dx, dy], i) => { const px = x + dx * k, py = y + dy * k; g.fillStyle = i === 0 ? '#bff1ff' : col; g.beginPath(); g.arc(px, py, rd, 0, 7); g.fill(); g.lineWidth = 1; g.strokeStyle = '#06203f'; g.stroke(); });
      g.restore(); if (cam.z > 0.55) { g.fillStyle = 'rgba(191,241,255,.75)'; g.font = `700 ${7.5 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(F.kind.toUpperCase(), x, y + Math.max(rd * 2.2, 0.75 * k)); } }
    else { g.save(); g.shadowColor = col; g.shadowBlur = 10; g.fillStyle = col; g.beginPath(); g.arc(x, y, 5 * s, 0, 7); g.fill(); g.restore(); }
    if (u.slice && u.slice.active) { const [px, py] = toScreen(u.slice.px + 0.5, u.slice.py + 0.5); g.save(); g.strokeStyle = '#ffd36b'; g.lineWidth = 2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, y); g.lineTo(px, py); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffd36b'; g.font = `800 ${9 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.fillText(`◩ ${u.slice.cut * 45}°`, px, py - 8 * s); g.restore(); }
    if (!down) { const d = dirOf(u.uid, u.dir || 0); g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x + Math.cos(d - 0.6) * 9 * s, y + Math.sin(d - 0.6) * 9 * s); g.lineTo(x + Math.cos(d) * 13 * s, y + Math.sin(d) * 13 * s); g.lineTo(x + Math.cos(d + 0.6) * 9 * s, y + Math.sin(d + 0.6) * 9 * s); g.stroke(); }
    g.strokeStyle = `rgba(56,200,255,${sel ? 0.9 : 0.55})`; g.lineWidth = 1.5; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(x, y - 6 * s); g.lineTo(sx, sy + 16 * s); g.stroke(); g.setLineDash([]);
    const w = 30 * s, h = 34 * s;
    g.save(); g.shadowColor = col; g.shadowBlur = sel ? 24 : 14; shieldPath(g, sx, sy, w, h); const gr = g.createLinearGradient(0, sy - h / 2, 0, sy + h / 2); gr.addColorStop(0, down ? '#5a1a24' : u.perch ? '#1b8a5a' : '#1b6fd6'); gr.addColorStop(1, down ? '#2a0a10' : u.perch ? '#0a3a24' : '#0a2a5a'); g.fillStyle = gr; g.fill(); g.restore();
    shieldPath(g, sx, sy, w, h); g.strokeStyle = col; g.lineWidth = sel ? 2.5 : 1.8; g.stroke(); shieldPath(g, sx, sy, w * 0.78, h * 0.78); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#ffffff'; g.font = `800 ${15 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(u.num), sx, sy - 1 * s);
    const bx = sx + w / 2 - 1, by = sy - h / 2 + 3; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(bx, by, 7.5 * s, 0, 7); g.fill(); g.strokeStyle = '#0a2a5a'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#06203f'; g.font = `800 ${9.5 * s}px system-ui,sans-serif`; g.fillText(String(n), bx, by + 0.5);
    if (!down && u.deployed) { // status badges: mask, gas impairment, dazed, cover
      let bxx = sx - w / 2 + 1; const byy = sy - h / 2 + 3;
      if (u.mask === 'on') { badge(g, bxx, byy, 'M', '#9ff5cf', '#08261a', s); bxx -= 15 * s; } else if (u.mask === 'donning') { badge(g, bxx, byy, '…', '#ffd36b', '#2a1a04', s); bxx -= 15 * s; }
      if ((u.impair || 0) > 0.05) { badge(g, bxx, byy, '☁', '#cfe8b0', '#1a2a10', s); bxx -= 15 * s; }
      if ((u.stun || 0) > 0) { badge(g, bxx, byy, '✷', '#ffd080', '#2a1a04', s); }
      coverBadge(g, sx + w / 2 + 4 * s, sy + h / 2 - 6 * s, Core.coverInfo(u.x, u.y), s); }
    const tag = u.name.toUpperCase() + (down ? ' · OUT OF ACTION' : !u.deployed ? ' · FORMING' : (u.stun || 0) > 0 ? ' · DAZED' : u.perch ? ' · OVERWATCH' : u.orders.length && plan ? ` · ${u.orders.length} ORD` : '');
    g.font = `700 ${9 * s}px system-ui,sans-serif`; const tw = g.measureText(tag).width + 10; g.fillStyle = 'rgba(4,12,24,.85)'; rr(g, sx - tw / 2, sy + h / 2 + 2, tw, 14 * s, 4); g.fill(); g.fillStyle = col; g.fillText(tag, sx, sy + h / 2 + 2 + 7 * s); }
}
function screenFx(g, now) {
  for (const a of anims) { const t = (now - a.t0) / 1000; const [x, y] = toScreen(a.x + 0.5, a.y + 0.5); const s = sz();
    if (a.type === 'text' && t < 1.8) { g.globalAlpha = Math.min(1, 2 * (1.8 - t)); g.fillStyle = a.color || '#fff'; g.font = `800 ${14 * s}px system-ui,sans-serif`; g.textAlign = 'center'; g.save(); g.shadowColor = a.color || '#fff'; g.shadowBlur = 10; g.fillText(a.text, x, y - 24 * s - t * 22); g.restore(); g.globalAlpha = 1; }
    if (a.type === 'down' && t < 1.5) { g.strokeStyle = `rgba(255,176,32,${1 - t / 1.5})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 10 + t * 40, 0, 7); g.stroke(); }
    if (a.type === 'blast' && t < 0.3) { g.fillStyle = `rgba(255,240,220,${0.3 * (1 - t / 0.3)})`; g.fillRect(0, 0, VW, VH); }
    if (a.type === 'flash' && t > 0.25 && t < 0.6) { const vis = Core.state.vis[Core.idx(a.x, a.y)]; if (vis) { g.fillStyle = `rgba(255,255,255,${0.25 * (1 - (t - 0.25) / 0.35)})`; g.fillRect(0, 0, VW, VH); } } }
}

/* =====================================================================
   PICKING (screen → game objects) and OVERVIEW MAP
   ===================================================================== */
function pickUnit(sx, sy) {
  const S = Core.state; let best = null, bd = 1e9;
  for (const u of S.units) { if (u.status !== 'ok' && u.kind !== 'team') continue; if (u.kind === 'cruiser') continue; // v8: vehicles are not selectable — command them through an occupant's chip
    if (u.kind === 'team') { const T = teamShield(u); const d1 = Math.hypot(sx - T.sx, sy - T.sy), d2 = Math.hypot(sx - T.x, sy - T.y); const d = Math.min(d1 < 22 * T.s ? d1 : 1e9, d2 < 14 * T.s ? d2 : 1e9); if (d < bd) { bd = d; best = u.uid; } }
    else if (u.kind === 'cruiser') { const [x, y] = toScreen(u.x + 0.5, u.y + 0.5); const d = Math.hypot(sx - x, sy - y) + 6; if (d < Math.max(22 * sz(), 1.5 * CS * cam.z) && d < bd) { bd = d; best = u.uid; } }
    else { let [ux, uy] = posOf(u.uid, u.x, u.y); if (u.inCar && !inCarPos(u)) continue; [ux, uy] = u.inCar ? inCarPos(u) : tuck(u, ux, uy); const [x, y] = toScreen(ux + 0.5, uy + 0.5); const d = Math.hypot(sx - x, sy - y); if (d < 18 * sz() && d < bd) { bd = d; best = u.uid; } } }
  return best;
}
/** Vehicle under a tap (Get In target only — vehicles themselves are never selected). */
function pickCar(sx, sy) { const S = Core.state; let best = null, bd = 1e9; for (const u of S.units) { if (u.kind !== 'cruiser') continue; const [x, y] = toScreen(u.x + 0.5, u.y + 0.5); const d = Math.hypot(sx - x, sy - y); if (d < Math.max(26 * sz(), (u.armored ? 1.9 : 1.5) * CS * cam.z) && d < bd) { bd = d; best = u.uid; } } return best; }
function pickDoor(cx, cy) { const S = Core.state; let best = null, bd = 1e9;
  for (const d of S.doors) { if (!doorVisible(d)) continue; const [mx, my] = doorMidCell(d); const dd = Math.hypot(cx - mx, cy - my);
    if (dd < (d.kind === 'garage' ? 2.2 : 1.2) && dd < bd) { bd = dd; best = d.id; } }
  return best; }
function pickWindow(cx, cy) { const S = Core.state; let best = null, bd = 1.4;
  S.windows.forEach((w, i) => { if (w.cleared) return; for (const [a, b, c, d] of w.edges) { const mx = (a + c) / 2 + 0.5, my = (b + d) / 2 + 0.5, dd = Math.hypot(cx - mx, cy - my); if (dd < bd) { bd = dd; best = i; } } });
  return best; }
function pickRoom(cx, cy) { const r = Core.roomAt(Math.floor(cx), Math.floor(cy)); if (r < 0) return null; return Core.state.rooms[r].known ? r : null; }
function pickPerch(cx, cy) { const S = Core.state; let best = null, bd = 2.2; for (const p of S.perches) { const d = Math.hypot(cx - p.x - 0.5, cy - p.y - 0.5); if (d < bd) { bd = d; best = p.id; } } if (best == null) { const p = Core.perchAt(Math.floor(cx), Math.floor(cy)); if (p) best = p.id; } return best; }
/** Overview map (#ovw): the whole neighborhood, the target house, units and the current viewport rectangle. */
function ovwGeom(c) { const W = c._lw || c.width, Hh = c._lh || c.height, k = Math.min(W / Core.MAP_W, Hh / Core.MAP_H); return { k, ox: (W - Core.MAP_W * k) / 2, oy: (Hh - Core.MAP_H * k) / 2 }; }
/* MINIMAP / overview thumbnail (#ovw in the side panel, #ovw2 in the phone ▦ panel): whole neighborhood + viewport rectangle; tap/drag jumps the camera (see ovwJump). */
function drawMini(c) {
  const S = Core.state; if (!S || !c || !L.ground) return; const g = c.getContext('2d'); miniSize(c); const W = c._lw, Hh = c._lh; const { k, ox, oy } = ovwGeom(c);
  g.setTransform(c._md, 0, 0, c._md, 0, 0); g.fillStyle = '#05080d'; g.fillRect(0, 0, W, Hh);
  g.globalAlpha = 0.85; g.drawImage(L.ground, ox, oy, Core.MAP_W * k, Core.MAP_H * k); g.globalAlpha = 1;
  const H = S.house; g.fillStyle = 'rgba(20,24,32,.95)'; for (const q of H.parts.concat(H.garage ? [H.garage] : [])) g.fillRect(ox + q.x * k, oy + q.y * k, q.w * k, q.h * k);
  for (const rm of S.rooms) if (rm.known) { g.fillStyle = rm.explored ? 'rgba(56,200,255,.45)' : 'rgba(56,200,255,.2)'; g.fillRect(ox + rm.x * k, oy + rm.y * k, rm.w * k, rm.h * k); }
  g.strokeStyle = 'rgba(255,90,100,.8)'; g.lineWidth = 1.2; g.strokeRect(ox + H.x0 * k - 1, oy + H.y0 * k - 1, (H.x1 - H.x0 + 1) * k + 2, (H.y1 - H.y0 + 1) * k + 2);
  if (gasAny) { g.globalAlpha = 0.8; g.drawImage(L.gas, ox, oy, Core.MAP_W * k, Core.MAP_H * k); g.globalAlpha = 1; }
  for (const sp of (Core.suspList ? Core.suspList() : [S.suspect])) { if (['detained', 'escaped'].includes(sp.mode)) continue; const spot = sp.visible ? sp : sp.heat; if (spot) { g.fillStyle = sp.visible ? '#ff3b4e' : '#ff8a3a'; g.beginPath(); g.arc(ox + (spot.x + 0.5) * k, oy + (spot.y + 0.5) * k, 3.5, 0, 7); g.fill(); } }
  for (const u of S.units) { if (u.status !== 'ok') continue; if (u.kind === 'patrol' && u.inCar) continue; const px = ox + (u.x + 0.5) * k, py = oy + (u.y + 0.5) * k;
    if (u.kind === 'cruiser') { const A = u.armored ? 1.25 : 1; g.fillStyle = u.armored ? '#3a5ca8' : '#e6e9ee'; g.save(); g.translate(px, py); g.rotate(u.dir || 0); g.fillRect(-1.5 * k * A, -0.7 * k * A, 3 * k * A, 1.4 * k * A); g.restore(); continue; }
    g.fillStyle = u.kind === 'team' ? (u.perch ? '#3ef0a0' : '#7fe3ff') : u.kind === 'patrol' ? '#c9d6e4' : '#b48cff'; g.beginPath(); g.arc(px, py, u.kind === 'team' ? 3 : 2.2, 0, 7); g.fill(); if (view.sel === u.uid) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(px, py, 5, 0, 7); g.stroke(); } }
  if (S.ems) { g.fillStyle = '#f2f5f8'; g.fillRect(ox + S.ems.x * k - 2.5, oy + S.ems.y * k - 2, 5, 4); g.fillStyle = '#1f6fd6'; g.fillRect(ox + S.ems.x * k - 0.6, oy + S.ems.y * k - 2, 1.2, 4); }
  for (const c of S.cas || []) { if (c.who === 'suspect' || !(Core.casActive(c) || c.state === 'kia' || c.state === 'lost')) continue; const px = ox + (c.x + 0.5) * k, py = oy + (c.y + 0.5) * k;
    if (!Core.casActive(c)) { g.fillStyle = '#8d97a6'; g.fillRect(px - 2, py - 1.5, 4, 3); continue; } g.fillStyle = !c.known ? '#9aa6b5' : c.stable ? '#3ef0a0' : '#ffb020'; g.fillRect(px - 0.8, py - 2.8, 1.6, 5.6); g.fillRect(px - 2.8, py - 0.8, 5.6, 1.6); }
  for (const b of S.roadblocks || []) { const px = ox + (b.side === 'W' ? b.x - 2.6 : b.x + 3.6) * k, held = Core.roadblockHeld(b); g.fillStyle = held ? '#e8401c' : 'rgba(255,176,32,.5)'; g.fillRect(px - 1.2, oy + S.geo.ST * k, 2.4, (S.geo.SB - S.geo.ST + 1) * k); }
  for (const c of S.contain) { const px = ox + (c.x + 0.5) * k, py = oy + (c.y + 0.5) * k; if (c.q === 'cruiser' && c.car && !c.screened) { g.strokeStyle = 'rgba(127,227,255,.8)'; g.lineWidth = 1; g.strokeRect(ox + (c.car.x - 1) * k, oy + c.car.y * k, 3 * k, 1.4 * k); } }
  const v = viewRect(); g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(ox + v.x * k, oy + v.y * k, v.w * k, v.h * k); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(ox + v.x * k, oy + v.y * k, v.w * k, v.h * k);
}
/** v11: the minimap backing store follows its CSS box (× dpr) so the neighborhood is never stretched; drawing is in CSS px. */
function miniSize(c) { const r = c.getBoundingClientRect(), md = Math.min(2, window.devicePixelRatio || 1); if (!(r.width > 0 && r.height > 0)) { c._lw = c._lw || c.width; c._lh = c._lh || c.height; c._md = c._md || 1; return; }
  const bw = Math.round(r.width * md), bh = Math.round(r.height * md); if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; } c._lw = r.width; c._lh = r.height; c._md = md; }
/** Jump the camera so the overview point (canvas px) becomes the view centre. */
function ovwJump(c, px, py) { const m = c._md || 1; px /= m; py /= m; const { k, ox, oy } = ovwGeom(c); centerOn((px - ox) / k, (py - oy) / k); }

function init(canvas) { cv = canvas; ctx = cv.getContext('2d'); resize(true); }
function invalidate() { compKey = ''; dynVer = -1; planVer = -1; L.expoVer = null; }
return { init, resize, debugScale, viewportSize, frame, fit, pan, zoomAt, toCell, toScreen, setSafe, snapshot, endAnim, pickUnit, pickCar, pickDoor, pickWindow, pickRoom, pickPerch, drawMini, ovwJump, centerOn, viewRect, view, cam, invalidate, CS, get animating() { return animating; } };
})();
