"use strict";
// The Web: every alliance of a VEX season drawn as silk.
//   world: teams at their home towns, one thread per alliance pair, spun in the order the pairs first teamed up
//   orb:   one team's web; ring 1 = its partners, ring 2 = their partners
//   path:  the shortest chain of alliances between two teams
// Data: web.json from the stats site (stats.2360arachnid.com), see vexpredict/web.py.

const $ = s => document.querySelector(s);
const canvas = $("#web");
const ctx = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SOURCES = {
  "push-back": ["data/push-back.json"],
  "override": ["https://stats.2360arachnid.com/data/override/web.json", "data/override.json"],
};
const SEASON_NAMES = { "push-back": "Push Back", "override": "Override" };
const KM_MI = 0.621371;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = n => Math.round(n).toLocaleString();
const shortDate = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

let W = 0, H = 0, DPR = 1;
let D = null;                  // prepared dataset
const cache = {};
const S = {
  season: "push-back", mode: "world", team: -1, path: null,
  view: { s: 1, tx: 0, ty: 0 }, spin: 0, playing: !reduced, speed: 1,
  hover: -1, orb: null, orbT0: 0, pathT0: 0,
};

// ---------- data ----------
async function load(season) {
  if (cache[season]) return cache[season];
  let raw = null;
  for (const url of SOURCES[season]) {
    try { const r = await fetch(url); if (r.ok) { raw = await r.json(); break; } } catch { /* try the next source */ }
  }
  if (!raw) throw new Error("Couldn't load the web data");
  cache[season] = prepare(raw);
  return cache[season];
}

function prepare(raw) {
  const t = raw.t, n = t.num.length;
  const P = Int32Array.from(raw.p), m = P.length / 5;
  const deg = new Int32Array(n);
  for (let k = 0; k < m; k++) { deg[P[k * 5]]++; deg[P[k * 5 + 1]]++; }
  const off = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
  const nb = new Int32Array(off[n]), pk = new Int32Array(off[n]), fill = off.slice(0, n);
  const first = new Int32Array(n).fill(m);
  for (let k = 0; k < m; k++) {
    const a = P[k * 5], b = P[k * 5 + 1];
    nb[fill[a]] = b; pk[fill[a]++] = k;
    nb[fill[b]] = a; pk[fill[b]++] = k;
    if (k < first[a]) first[a] = k;
    if (k < first[b]) first[b] = k;
  }
  // world coordinates: x in [0, 1] across 360 degrees of longitude, y in [0, .5].
  // The map is cut in the mid-Atlantic (30°W), where almost no teams are, so the
  // Pacific sits in the middle and US-Asia alliances cross it the short way.
  const wx = new Float32Array(n), wy = new Float32Array(n), has = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (t.lat[i] == null || t.lon[i] == null) continue;
    wx[i] = ((((t.lon[i] + 30) % 360) + 360) % 360) / 360; wy[i] = (90 - t.lat[i]) / 360; has[i] = 1;
  }
  // thread geometry: a gentle arc between the two home towns, bending the same way every time
  const gx = new Float32Array(m), gy = new Float32Array(m), km = new Float32Array(m), ok = new Uint8Array(m);
  for (let k = 0; k < m; k++) {
    const a = P[k * 5], b = P[k * 5 + 1];
    if (!has[a] || !has[b]) continue;
    const dx = wx[b] - wx[a], dy = wy[b] - wy[a], len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    gx[k] = (wx[a] + wx[b]) / 2 - dy * 0.15; gy[k] = (wy[a] + wy[b]) / 2 + dx * 0.15;
    km[k] = haversine(t.lat[a], t.lon[a], t.lat[b], t.lon[b]); ok[k] = 1;
  }
  const sidx = new Uint8Array(m);
  for (let k = 0; k < m; k++) sidx[k] = km[k] < 400 ? 0 : km[k] < 1600 ? 1 : 2;
  const byNum = new Map(t.num.map((x, i) => [String(x).toUpperCase(), i]));
  let top = 0;
  for (let i = 1; i < n; i++) if (t.r[i] > t.r[top]) top = i;
  return { raw, t, n, P, m, deg, off, nb, pk, first, wx, wy, has, gx, gy, km, ok, sidx, byNum, e: raw.e, champ: raw.champ || [], top };
}

function haversine(la1, lo1, la2, lo2) {
  const r = x => x * Math.PI / 180;
  const h = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const pairOf = k => ({ a: D.P[k * 5], b: D.P[k * 5 + 1], n: D.P[k * 5 + 2], w: D.P[k * 5 + 3], ev: D.P[k * 5 + 4] });
const evName = e => D.e.name[e], evDate = e => D.e.date[e];
function neighbors(i) {
  const out = [];
  for (let q = D.off[i]; q < D.off[i + 1]; q++) out.push({ j: D.nb[q], k: D.pk[q] });
  return out;
}
function bfs(src) {
  const dist = new Int16Array(D.n).fill(-1), prev = new Int32Array(D.n).fill(-1), via = new Int32Array(D.n).fill(-1);
  const queue = new Int32Array(D.n);
  let h = 0, tl = 0;
  dist[src] = 0; queue[tl++] = src;
  while (h < tl) {
    const u = queue[h++];
    // stronger links first, so the chain prefers teams that played together more
    const ns = neighbors(u).sort((x, y) => D.P[y.k * 5 + 2] - D.P[x.k * 5 + 2]);
    for (const { j, k } of ns) {
      if (dist[j] !== -1) continue;
      dist[j] = dist[u] + 1; prev[j] = u; via[j] = k; queue[tl++] = j;
    }
  }
  return { dist, prev, via };
}

// ---------- view ----------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  front.view = null; back.active = false;
  if (D && S.mode !== "orb" && !S.userMoved) fitWorld();
  layerDirty = true;
  if (S.mode === "orb" && S.team >= 0) S.orb = buildOrb(S.team);
}
function fitWorld() {
  // fit the teams' spread (ignoring a few far outliers) with room for the controls
  const xs = [], ys = [];
  for (let i = 0; i < D.n; i++) if (D.has[i]) { xs.push(D.wx[i]); ys.push(D.wy[i]); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a, f) => a[Math.floor(f * (a.length - 1))];
  let x0 = q(xs, .003), x1 = q(xs, .997), y0 = q(ys, .003), y1 = q(ys, .997);
  const padX = (x1 - x0) * .06, padY = (y1 - y0) * .1;
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const top = $(".bar").offsetHeight + 10, bottom = 90;
  const s = Math.min(W / (x1 - x0), (H - top - bottom) / (y1 - y0));
  S.view = { s, tx: (W - s * (x0 + x1)) / 2, ty: top + ((H - top - bottom) - s * (y0 + y1)) / 2 };
  if (H > W * 1.15) {
    // portrait phone: zoom in on where most teams are; the rest of the world is a pan away
    const mx = xs[Math.floor(xs.length * 0.5)], my = ys[Math.floor(ys.length * 0.5)];
    const z = Math.min(3.2, (H - top - bottom) * 0.5 / ((y1 - y0) * s));
    const s2 = s * Math.max(1, z);
    S.view = { s: s2, tx: W / 2 - mx * s2, ty: top + (H - top - bottom) * 0.45 - my * s2 };
  }
}
const sx = x => x * S.view.s + S.view.tx;
const sy = y => y * S.view.s + S.view.ty;

// ---------- world layer: threads drawn progressively onto offscreen canvases ----------
// "front" is shown (re-projected while panning or zooming); after the view changes,
// "back" is redrawn for the new view and swapped in once it has caught up.
const front = { c: document.createElement("canvas"), view: null, drawn: 0 };
const back = { c: document.createElement("canvas"), view: null, drawn: 0, active: false };
let layerDirty = true;
// Normal (not additive) blending: where thousands of threads overlap the colour
// saturates to violet instead of blowing out to white.
const STYLES = [
  { color: "164, 59, 214", a: 0.05 },      // same area (under 400 km)
  { color: "201, 155, 240", a: 0.06 },     // across a region
  { color: "255, 128, 230", a: 0.11 },     // across the country or the world
];
function drawThreads(c, view, from, to) {
  const zoom = Math.min(3, Math.max(1, Math.sqrt(view.s / baseScale())));
  c.lineWidth = 0.7 * DPR;
  for (let st = 0; st < 3; st++) {
    c.beginPath();
    let any = false;
    for (let k = from; k < to; k++) {
      if (!D.ok[k] || D.sidx[k] !== st) continue;
      const a = D.P[k * 5], b = D.P[k * 5 + 1];
      c.moveTo((D.wx[a] * view.s + view.tx) * DPR, (D.wy[a] * view.s + view.ty) * DPR);
      c.quadraticCurveTo((D.gx[k] * view.s + view.tx) * DPR, (D.gy[k] * view.s + view.ty) * DPR,
        (D.wx[b] * view.s + view.tx) * DPR, (D.wy[b] * view.s + view.ty) * DPR);
      any = true;
    }
    if (!any) continue;
    c.strokeStyle = `rgba(${STYLES[st].color}, ${Math.min(0.35, STYLES[st].a * zoom).toFixed(3)})`;
    c.stroke();
  }
}
let _base = 0;
const baseScale = () => _base || 1;
function startBuffer(L) {
  L.c.width = canvas.width; L.c.height = canvas.height;
  const c = L.c.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, L.c.width, L.c.height);
  c.globalCompositeOperation = "source-over";
  L.view = { ...S.view }; L.drawn = 0;
}
function stepLayer(budget) {
  const target = Math.floor(S.spin);
  if (layerDirty) {
    layerDirty = false;
    if (!front.view) startBuffer(front);
    else { startBuffer(back); back.active = true; }
  }
  if (back.active) {
    const to = Math.min(target, back.drawn + budget);
    if (to > back.drawn) { drawThreads(back.c.getContext("2d"), back.view, back.drawn, to); back.drawn = to; }
    if (back.drawn >= target) {             // caught up: swap
      const c = front.c; front.c = back.c; back.c = c;
      front.view = back.view; front.drawn = back.drawn; back.active = false;
    }
    return;
  }
  if (front.drawn > target) { startBuffer(front); }   // rewound: start over
  const to = Math.min(target, front.drawn + budget);
  if (to > front.drawn) { drawThreads(front.c.getContext("2d"), front.view, front.drawn, to); front.drawn = to; }
}

// ---------- frame ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (D) {
    if (S.mode !== "orb") {
      if (S.playing && S.spin < D.m) {
        S.spin = Math.min(D.m, S.spin + D.m / 22 * dt * S.speed);
        if (S.spin >= D.m) setPlaying(false);
      }
      stepLayer(dragging ? 0 : 20000);
      drawWorld(now);
      updateHud();
    } else {
      drawOrb(now);
    }
  }
  requestAnimationFrame(frame);
}

function background() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#07050a";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.7);
  g.addColorStop(0, "rgba(116, 23, 147, 0.20)");
  g.addColorStop(1, "rgba(7, 5, 10, 0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function drawWorld(now) {
  background();
  // graticule: faint lines every 30 degrees
  ctx.strokeStyle = "rgba(196, 139, 234, 0.05)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let q = 0; q <= 12; q++) { const x = sx(q / 12); ctx.moveTo(x, sy(0)); ctx.lineTo(x, sy(0.5)); }
  for (let lat = -60; lat <= 90; lat += 30) { const y = sy((90 - lat) / 360); ctx.moveTo(sx(0), y); ctx.lineTo(sx(1), y); }
  ctx.stroke();
  // threads (the layer was drawn for layerView; while dragging, shift/scale it to follow)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  // dim the web when a chain or a team's own threads are on top of it
  ctx.globalAlpha = S.mode === "path" ? 0.28 : S.team >= 0 ? 0.45 : 1;
  if (front.view) {
    const k = S.view.s / front.view.s;
    const dx = (S.view.tx - front.view.tx * k) * DPR, dy = (S.view.ty - front.view.ty * k) * DPR;
    ctx.drawImage(front.c, dx, dy, front.c.width * k, front.c.height * k);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // teams that have played so far
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  const spin = S.spin, v = S.view;
  const r = Math.min(2.2, 0.9 + v.s / baseScale() * 0.25);
  ctx.fillStyle = "rgba(239, 233, 245, 0.55)";
  for (let i = 0; i < D.n; i++) {
    if (!D.has[i] || D.first[i] > spin) continue;
    const x = D.wx[i] * v.s + v.tx, y = D.wy[i] * v.s + v.ty;
    if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.globalCompositeOperation = "source-over";
  // the chosen team's own threads, and the chain of a "six degrees" search
  if (S.team >= 0 && S.mode === "world") highlightTeam(S.team);
  if (S.mode === "path" && S.path) drawPathWorld(now);
  if (S.hover >= 0) ring(sx(D.wx[S.hover]), sy(D.wy[S.hover]), "#f5c542");
}
function ring(x, y, color, r = 7) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
}
function arc(k, color, width, frac = 1) {
  const a = D.P[k * 5], b = D.P[k * 5 + 1];
  ctx.beginPath();
  const x0 = sx(D.wx[a]), y0 = sy(D.wy[a]), cx = sx(D.gx[k]), cy = sy(D.gy[k]), x1 = sx(D.wx[b]), y1 = sy(D.wy[b]);
  if (frac >= 1) { ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); }
  else {
    ctx.moveTo(x0, y0);
    for (let s = 1; s <= 24 * frac; s++) { const t = s / 24; ctx.lineTo(qb(x0, cx, x1, t), qb(y0, cy, y1, t)); }
  }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
const qb = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
function highlightTeam(i) {
  ctx.globalCompositeOperation = "lighter";
  for (const { k } of neighbors(i)) if (D.ok[k] && k <= S.spin) arc(k, "rgba(245, 197, 66, 0.55)", 1.4);
  ctx.globalCompositeOperation = "source-over";
  if (D.has[i]) ring(sx(D.wx[i]), sy(D.wy[i]), "#f5c542", 9);
}

// ---------- orb web ----------
function orbArea() {
  const panel = $("#panel"), top = $(".bar").offsetHeight;
  if (panel.hidden) return { x: 0, y: top, w: W, h: H - top };
  if (W <= 760) return { x: 0, y: top, w: W, h: H - top - panel.offsetHeight };
  return { x: 0, y: top, w: W - panel.offsetWidth - 32, h: H - top };
}
function buildOrb(c) {
  const area = orbArea();
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const R = Math.max(80, Math.min(area.w, area.h) / 2 - 18);
  const ring1 = neighbors(c).sort((x, y) => x.k - y.k);
  const n1 = ring1.length;
  const inR1 = new Map(ring1.map((x, idx) => [x.j, idx]));
  const best = new Map();          // ring-2 team -> { parent index in ring1, k, count }
  ring1.forEach(({ j }, idx) => {
    for (const { j: j2, k } of neighbors(j)) {
      if (j2 === c || inR1.has(j2)) continue;
      const cnt = D.P[k * 5 + 2];
      const cur = best.get(j2);
      if (!cur || cnt > cur.cnt || (cnt === cur.cnt && k < cur.k)) best.set(j2, { p: idx, k, cnt });
    }
  });
  const groups = ring1.map(() => []);
  for (const [j2, v] of best) groups[v.p].push({ j: j2, k: v.k, cnt: v.cnt });
  const nodes = [{ i: c, ring: 0, x: cx, y: cy, a: 0, r: 0 }];
  const step = n1 ? (Math.PI * 2) / n1 : 0;
  const R1 = R * (n1 > 40 ? 0.46 : 0.42);
  ring1.forEach(({ j, k }, idx) => {
    const a = -Math.PI / 2 + (idx + 0.5) * step;
    nodes.push({ i: j, ring: 1, a, r: R1, x: cx + Math.cos(a) * R1, y: cy + Math.sin(a) * R1, k, parent: 0, idx });
  });
  let total2 = 0;
  groups.forEach((g, idx) => {
    g.sort((x, y) => y.cnt - x.cnt || x.k - y.k);
    total2 += g.length;
    const a0 = -Math.PI / 2 + idx * step + step * 0.06, span = step * 0.88;
    g.forEach((v, q) => {
      const a = a0 + span * ((q + 0.5) / g.length);
      const rr = R * (g.length > 14 ? (q % 2 ? 0.97 : 0.84) : 0.9);
      nodes.push({ i: v.j, ring: 2, a, r: rr, x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, k: v.k, parent: idx + 1 });
    });
  });
  // the capture spiral: decorative silk spun across the spokes
  const spokes = ring1.map((_, idx) => -Math.PI / 2 + (idx + 0.5) * step);
  const minSpokes = 18;
  if (spokes.length < minSpokes) {
    const extra = minSpokes - spokes.length;
    for (let q = 0; q < extra; q++) spokes.push(-Math.PI / 2 + (q + 0.25) * (Math.PI * 2 / extra));
    spokes.sort((x, y) => x - y);
  }
  const spiral = [];
  const loops = 13, r0 = R * 0.1, rEnd = R * 0.99, ns = spokes.length;
  for (let L = 0; L < loops; L++) {
    for (let s = 0; s < ns; s++) {
      const f0 = (L + s / ns) / loops, f1 = (L + (s + 1) / ns) / loops;
      const a0 = spokes[s], a1 = s + 1 < ns ? spokes[s + 1] : spokes[0] + Math.PI * 2;
      const ra = r0 + (rEnd - r0) * f0, rb = r0 + (rEnd - r0) * f1;
      const am = (a0 + a1) / 2, rm = (ra + rb) / 2 * 0.93;     // sag toward the hub, like real silk
      spiral.push([cx + Math.cos(a0) * ra, cy + Math.sin(a0) * ra, cx + Math.cos(am) * rm, cy + Math.sin(am) * rm, cx + Math.cos(a1) * rb, cy + Math.sin(a1) * rb]);
    }
  }
  return { c, cx, cy, R, nodes, spiral, spokes, n1, total2 };
}
function drawOrb(now) {
  const O = S.orb;
  background();
  if (!O) return;
  const t = reduced ? 10 : (now - S.orbT0) / 1000;
  const pSpoke = Math.min(1, t / 0.7), pSpiral = Math.min(1, Math.max(0, (t - 0.45) / 1.6)), pNodes = Math.min(1, Math.max(0, (t - 0.3) / 1.2));
  const ease = x => 1 - Math.pow(1 - x, 3);
  ctx.lineCap = "round";
  // frame spokes, decorative ones fainter
  ctx.strokeStyle = "rgba(239, 233, 245, 0.07)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const a of O.spokes) { ctx.moveTo(O.cx, O.cy); ctx.lineTo(O.cx + Math.cos(a) * O.R * ease(pSpoke), O.cy + Math.sin(a) * O.R * ease(pSpoke)); }
  ctx.stroke();
  // capture spiral, spun from the outside in
  const shown = Math.floor(O.spiral.length * ease(pSpiral));
  ctx.strokeStyle = "rgba(239, 233, 245, 0.13)"; ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let q = O.spiral.length - shown; q < O.spiral.length; q++) {
    const s = O.spiral[q]; ctx.moveTo(s[0], s[1]); ctx.quadraticCurveTo(s[2], s[3], s[4], s[5]);
  }
  ctx.stroke();
  const hl = S.hover >= 0 ? O.nodes[S.hover] : null;
  const hlPath = new Set();
  if (hl) { hlPath.add(S.hover); if (hl.ring === 2) hlPath.add(hl.parent); }
  // ring 1 to ring 2 threads
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(164, 59, 214, 0.32)"; ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const nd of O.nodes) {
    if (nd.ring !== 2) continue;
    const p = O.nodes[nd.parent];
    const f = ease(Math.min(1, Math.max(0, pNodes * 1.4 - 0.4)));
    ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (nd.x - p.x) * f, p.y + (nd.y - p.y) * f);
  }
  ctx.stroke();
  // spokes to partners, thicker for more matches together
  for (const nd of O.nodes) {
    if (nd.ring !== 1) continue;
    const n = D.P[nd.k * 5 + 2], f = ease(pSpoke);
    ctx.strokeStyle = hlPath.has(O.nodes.indexOf(nd)) ? "rgba(245, 197, 66, 0.95)" : "rgba(201, 155, 240, 0.6)";
    ctx.lineWidth = Math.min(4, 0.8 + n * 0.55);
    ctx.beginPath(); ctx.moveTo(O.cx, O.cy); ctx.lineTo(O.cx + (nd.x - O.cx) * f, O.cy + (nd.y - O.cy) * f); ctx.stroke();
  }
  if (hl && hl.ring === 2) {
    const p = O.nodes[hl.parent];
    ctx.strokeStyle = "rgba(245, 197, 66, 0.95)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hl.x, hl.y); ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  // dewdrops
  const champ = new Set(D.champ);
  O.nodes.forEach((nd, q) => {
    if (nd.ring === 0) return;
    const appear = nd.ring === 1 ? pNodes : Math.max(0, pNodes * 1.3 - 0.3);
    if (appear <= 0) return;
    const base = nd.ring === 1 ? 3 + Math.min(6, (D.t.r[nd.i] || 20) / 14) : 1.8;
    const rad = base * ease(Math.min(1, appear)) * (q === S.hover ? 1.6 : 1);
    const gold = champ.has(nd.i) || q === S.hover;
    ctx.beginPath(); ctx.arc(nd.x, nd.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = gold ? "#f5c542" : nd.ring === 1 ? "#e9d6ff" : "rgba(201, 155, 240, 0.85)";
    ctx.shadowColor = gold ? "#f5c542" : "#a43bd6"; ctx.shadowBlur = nd.ring === 1 ? 10 : 4;
    ctx.fill(); ctx.shadowBlur = 0;
  });
  // labels on ring 1 when there's room
  // labels only when there's room between spokes (otherwise hover or tap shows them)
  const gap = O.n1 ? (2 * Math.PI * O.R * 0.44) / O.n1 : 0;
  if (O.n1 && gap >= 17 && pNodes > 0.6) {
    ctx.font = `500 ${gap < 24 ? 9.5 : gap < 34 ? 10.5 : 11.5}px "JetBrains Mono", monospace`;
    ctx.fillStyle = `rgba(239, 233, 245, ${Math.min(1, (pNodes - 0.6) * 2.5) * 0.85})`;
    for (const nd of O.nodes) {
      if (nd.ring !== 1) continue;
      const lx = O.cx + Math.cos(nd.a) * (nd.r + 16), ly = O.cy + Math.sin(nd.a) * (nd.r + 16);
      ctx.textAlign = Math.cos(nd.a) > 0.3 ? "left" : Math.cos(nd.a) < -0.3 ? "right" : "center";
      ctx.textBaseline = "middle";
      ctx.fillText(D.t.num[nd.i], lx, ly);
    }
  }
  // the hub: the team itself, with a spider resting on it
  ctx.beginPath(); ctx.arc(O.cx, O.cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = "#14060f"; ctx.shadowColor = "#a43bd6"; ctx.shadowBlur = 28; ctx.fill(); ctx.shadowBlur = 0;
  drawSpider(O.cx, O.cy, -Math.PI / 2, 15, t);
  ctx.font = `400 ${Math.max(18, Math.min(30, O.R / 9))}px Rye, Georgia, serif`;
  ctx.fillStyle = "#efe9f5"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.shadowColor = "#000"; ctx.shadowBlur = 10;
  ctx.fillText(D.t.num[O.c], O.cx, O.cy + 24);
  ctx.shadowBlur = 0;
}

// a small spider: two body parts and eight legs that step while walking
function drawSpider(x, y, heading, size, t, walking = false) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(heading + Math.PI / 2);
  ctx.strokeStyle = "#efe9f5"; ctx.lineWidth = Math.max(1, size / 11); ctx.lineCap = "round";
  for (let side = -1; side <= 1; side += 2) {
    for (let q = 0; q < 4; q++) {
      const phase = walking ? Math.sin(t * 14 + q * 1.7 + (side > 0 ? Math.PI : 0)) * 0.22 : 0;
      const base = (-0.9 + q * 0.6) + phase;
      const kx = side * Math.cos(base) * size * 0.75, ky = Math.sin(base) * size * 0.75 - size * 0.05;
      const fx = side * Math.cos(base * 1.15) * size * 1.25, fy = Math.sin(base * 1.15) * size * 1.25 + (q - 1.5) * size * 0.18;
      ctx.beginPath(); ctx.moveTo(0, -size * 0.05); ctx.lineTo(kx, ky - size * 0.25); ctx.lineTo(fx, fy); ctx.stroke();
    }
  }
  ctx.fillStyle = "#741793"; ctx.shadowColor = "#a43bd6"; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.ellipse(0, size * 0.32, size * 0.36, size * 0.46, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c99bf0";
  ctx.beginPath(); ctx.arc(0, -size * 0.22, size * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ---------- six degrees ----------
function findPath(a, b) {
  const { dist, prev, via } = bfs(a);
  if (dist[b] < 0) return { a, b, chain: null };
  const chain = [];
  for (let u = b; u !== a; u = prev[u]) chain.push({ i: u, k: via[u] });
  chain.reverse();
  return { a, b, chain: [{ i: a, k: -1 }, ...chain] };
}
function drawPathWorld(now) {
  const chain = S.path.chain;
  if (!chain) return;
  const t = reduced ? 1e3 : (now - S.pathT0) / 1000;
  const per = 1.1, hops = chain.length - 1;
  ctx.globalCompositeOperation = "lighter";
  for (let h = 1; h <= hops; h++) {
    const k = chain[h].k;
    if (!D.ok[k]) continue;
    const f = Math.max(0, Math.min(1, t / per - (h - 1)));
    if (f > 0) { arc(k, "rgba(245, 197, 66, 0.25)", 6, f); arc(k, "rgba(255, 236, 170, 0.95)", 1.8, f); }
  }
  ctx.globalCompositeOperation = "source-over";
  const placed = [];
  chain.forEach(({ i }, h) => {
    if (!D.has[i]) return;
    const x = sx(D.wx[i]), y = sy(D.wy[i]);
    let ly = y - 6;
    while (placed.some(p => Math.abs(p[0] - x) < 60 && Math.abs(p[1] - ly) < 14)) ly += 15;
    placed.push([x, ly]);
    ring(x, y, h === 0 || h === hops ? "#f5c542" : "#e9d6ff", h === 0 || h === hops ? 9 : 6);
    ctx.font = '600 12px "JetBrains Mono", monospace'; ctx.fillStyle = "#efe9f5"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.shadowColor = "#000"; ctx.shadowBlur = 6; ctx.fillText(D.t.num[i], x + 10, ly); ctx.shadowBlur = 0;
  });
  // the spider walks the chain, then rests at the end
  const pos = Math.min(hops, t / per);
  const h = Math.min(hops, Math.floor(pos) + 1), f = pos - (h - 1);
  const k = chain[h]?.k;
  if (k != null && k >= 0 && D.ok[k]) {
    const from = chain[h - 1].i, to = chain[h].i;
    const a = D.P[k * 5], rev = a !== from;
    const tt = rev ? 1 - Math.min(1, f) : Math.min(1, f);
    const x0 = sx(D.wx[D.P[k * 5]]), y0 = sy(D.wy[D.P[k * 5]]), cx = sx(D.gx[k]), cy = sy(D.gy[k]), x1 = sx(D.wx[D.P[k * 5 + 1]]), y1 = sy(D.wy[D.P[k * 5 + 1]]);
    const x = qb(x0, cx, x1, tt), y = qb(y0, cy, y1, tt);
    const dx = (rev ? -1 : 1) * (qb(x0, cx, x1, Math.min(1, tt + 0.01)) - qb(x0, cx, x1, Math.max(0, tt - 0.01)));
    const dy = (rev ? -1 : 1) * (qb(y0, cy, y1, Math.min(1, tt + 0.01)) - qb(y0, cy, y1, Math.max(0, tt - 0.01)));
    drawSpider(x, y, Math.atan2(dy, dx), 9, t, pos < hops);
    void to;
  }
}

// ---------- panels ----------
const panel = $("#panel");
function showPanel(html) {
  panel.innerHTML = `<div class="grab" aria-hidden="true"></div><button class="x" id="close" aria-label="Back to the world web">✕</button>${html}`;
  panel.hidden = false;
  $("#close").onclick = () => goWorld();
}
function teamPanel(c) {
  const { dist } = bfs(c);
  let within2 = 0, within3 = 0, reach = 0;
  for (let i = 0; i < D.n; i++) { const d = dist[i]; if (d > 0) { reach++; if (d <= 2) within2++; if (d <= 3) within3++; } }
  const ns = neighbors(c).sort((x, y) => x.k - y.k);
  const target = D.champ.length ? D.champ : [D.top];
  let stepsTo = -1;
  for (const x of target) if (dist[x] >= 0 && (stepsTo < 0 || dist[x] < stepsTo)) stepsTo = dist[x];
  const isTarget = target.includes(c);
  const most = ns.reduce((b, x) => (!b || D.P[x.k * 5 + 2] > D.P[b.k * 5 + 2] ? x : b), null);
  const far = ns.filter(x => D.ok[x.k]).reduce((b, x) => (!b || D.km[x.k] > D.km[b.k] ? x : b), null);
  const wins = ns.reduce((s, x) => s + D.P[x.k * 5 + 3], 0), games = ns.reduce((s, x) => s + D.P[x.k * 5 + 2], 0);
  const tgtLabel = D.champ.length ? "World Champions" : `#1 rated team (${esc(D.t.num[D.top])})`;
  const name = n => `<button class="link" data-team="${n}">${esc(D.t.num[n])}</button>`;
  showPanel(`
    <p class="eyebrow">Team web · ${SEASON_NAMES[S.season]}</p>
    <h2>${esc(D.t.num[c])}</h2>
    <p class="who">${esc([D.t.name[c], D.t.reg[c]].filter(Boolean).join(" · "))}</p>
    <div class="grid">
      <div class="stat"><b>${ns.length}</b><span>alliance partners</span></div>
      <div class="stat"><b>${fmt(within2)}</b><span>teams within 2 steps</span></div>
      <div class="stat"><b>${fmt(within3)}</b><span>within 3 steps</span></div>
      <div class="stat"><b>${isTarget ? "0" : stepsTo < 0 ? "–" : stepsTo}</b><span>steps to the ${tgtLabel}</span></div>
    </div>
    <h3>Highlights</h3>
    <ul class="facts">
      ${most ? `<li>Most matches together: ${name(most.j)} <b>(${D.P[most.k * 5 + 2]}, won ${D.P[most.k * 5 + 3]})</b></li>` : ""}
      ${far ? `<li>Farthest partner: ${name(far.j)}, <b>${fmt(D.km[far.k] * KM_MI)} mi</b> from home</li>` : ""}
      ${ns.length ? `<li>First alliance: ${name(ns[0].j)} at ${esc(evName(D.P[ns[0].k * 5 + 4]))}, <b>${shortDate(evDate(D.P[ns[0].k * 5 + 4]))}</b></li>` : ""}
      <li>Won <b>${wins} of ${games}</b> alliance matches with partners. The whole web reaches <b>${fmt(reach)}</b> teams.</li>
    </ul>
    <h3>Link to another team</h3>
    <form class="connect" id="connect"><label class="sr" for="to">Team number</label><input id="to" placeholder="Team, e.g. ${esc(D.t.num[target[0]])}" autocomplete="off" spellcheck="false"><button class="btn">Find the chain</button></form>
    <p class="note" id="connect-msg"></p>
    <div class="row"><button class="btn ghost" id="toworld">Show on the world web</button></div>
    <h3>Partners, in order</h3>
    <ul class="partners">${ns.map(x => {
      const p = pairOf(x.k);
      return `<li>${name(x.j)}<span class="n">${p.n} match${p.n === 1 ? "" : "es"} · ${p.w} won</span><span></span><span class="ev">${esc(evName(p.ev))} · ${shortDate(evDate(p.ev))}</span></li>`;
    }).join("") || `<li class="note">No alliance partners yet this season.</li>`}</ul>`);
  wirePanel();
  $("#connect").onsubmit = e => {
    e.preventDefault();
    const v = $("#to").value.trim().toUpperCase();
    const b = D.byNum.get(v);
    if (b == null) { $("#connect-msg").textContent = `No team ${v} played this season.`; return; }
    goPath(c, b);
  };
  $("#toworld").onclick = () => { S.mode = "world"; panel.hidden = false; S.orb = null; setHash(); updateChrome(); };
}
function pathPanel(P) {
  const a = D.t.num[P.a], b = D.t.num[P.b];
  if (!P.chain) {
    showPanel(`<p class="eyebrow">Six degrees of VEX · ${SEASON_NAMES[S.season]}</p><h2>${esc(a)} → ${esc(b)}</h2>
      <p class="who">No chain of alliances links these two teams this season (yet). Their webs haven't touched.</p>
      <div class="row"><button class="btn ghost" data-team="${P.a}">Open ${esc(a)}'s web</button><button class="btn ghost" data-team="${P.b}">Open ${esc(b)}'s web</button></div>`);
    wirePanel(); return;
  }
  const hops = P.chain.length - 1;
  showPanel(`<p class="eyebrow">Six degrees of VEX · ${SEASON_NAMES[S.season]}</p>
    <h2>${esc(a)} → ${esc(b)}</h2>
    <p class="who">${hops === 0 ? "Same team." : hops === 1 ? "They've been alliance partners." : `${hops} alliances apart: ${hops - 1} team${hops - 1 === 1 ? "" : "s"} in between.`}</p>
    <ol class="chain">${P.chain.map(({ i, k }) => {
      if (k < 0) return `<li><b>${esc(D.t.num[i])}</b> <span class="note">${esc(D.t.reg[i])}</span></li>`;
      const p = pairOf(k);
      return `<li><span class="hop">teamed up at ${esc(evName(p.ev))}, ${shortDate(evDate(p.ev))} · ${p.n} match${p.n === 1 ? "" : "es"}, ${p.w} won</span><b>${esc(D.t.num[i])}</b> <span class="note">${esc(D.t.reg[i])}</span></li>`;
    }).join("")}</ol>
    <div class="row"><button class="btn ghost" data-team="${P.a}">Open ${esc(a)}'s web</button><button class="btn ghost" data-team="${P.b}">Open ${esc(b)}'s web</button><button class="btn ghost" id="copy">Copy link</button></div>
    <p class="note" id="copy-msg"></p>`);
  wirePanel();
  $("#copy").onclick = () => {
    navigator.clipboard?.writeText(location.href).then(() => { $("#copy-msg").textContent = "Link copied."; },
      () => { $("#copy-msg").textContent = location.href; });
  };
}
function wirePanel() {
  panel.querySelectorAll("[data-team]").forEach(b => b.onclick = () => goTeam(+b.dataset.team));
}

// ---------- navigation ----------
function goWorld() {
  S.mode = "world"; S.team = -1; S.path = null; S.orb = null; panel.hidden = true; S.hover = -1;
  setHash(); updateChrome();
}
function goTeam(i) {
  S.team = i; S.mode = "orb"; S.path = null; S.hover = -1;
  teamPanel(i);
  S.orb = buildOrb(i); S.orbT0 = performance.now();
  setHash(); updateChrome();
}
function goPath(a, b) {
  S.mode = "path"; S.team = a; S.path = findPath(a, b); S.pathT0 = performance.now(); S.hover = -1;
  S.spin = D.m; layerDirty = true; setPlaying(false);
  pathPanel(S.path);
  // frame the chain on the map
  if (S.path.chain) {
    const pts = S.path.chain.filter(({ i }) => D.has[i]).map(({ i }) => [D.wx[i], D.wy[i]]);
    if (pts.length) {
      const area = orbArea();
      let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
      const pad = 0.04; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
      const s = Math.min(area.w / (x1 - x0), area.h / (y1 - y0), baseScale() * 8);
      S.view = { s, tx: area.x + (area.w - s * (x0 + x1)) / 2, ty: area.y + (area.h - s * (y0 + y1)) / 2 };
      S.userMoved = true; layerDirty = true;
    }
  }
  setHash(); updateChrome();
}
function updateChrome() {
  $("#intro").classList.toggle("gone", S.mode !== "world" || S.team >= 0);
  $("#hud").classList.toggle("hidden", S.mode === "orb");
  canvas.setAttribute("aria-label", S.mode === "orb" ? `The alliance web of team ${D.t.num[S.team]}` : S.mode === "path" ? "A chain of alliances on the world map" : "Every alliance of the season on a world map");
}
function setHash() {
  const parts = [`s=${S.season}`];
  if (S.mode === "path" && S.path) parts.push(`p=${encodeURIComponent(D.t.num[S.path.a])},${encodeURIComponent(D.t.num[S.path.b])}`);
  else if (S.team >= 0) parts.push(`t=${encodeURIComponent(D.t.num[S.team])}`);
  history.replaceState(null, "", "#" + parts.join("&"));
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { season: h.get("s"), team: h.get("t"), path: h.get("p") };
}

// ---------- season switch ----------
async function useSeason(season, keep = {}) {
  $("#loading").classList.remove("done");
  $("#loading-text").textContent = `Spinning the ${SEASON_NAMES[season]} web…`;
  try { D = await load(season); } catch (e) {
    $("#loading-text").textContent = `${e.message}. Check your connection and reload.`; return;
  }
  S.season = season;
  document.querySelectorAll(".season button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.season === season)));
  _base = 0; S.userMoved = false; fitWorld(); _base = S.view.s;
  S.spin = reduced ? D.m : 0; layerDirty = true; setPlaying(!reduced);
  $("#scrub").max = String(D.m);
  $("#loading").classList.add("done");
  const num = x => (x ? D.byNum.get(x.toUpperCase()) : undefined);
  if (keep.path) {
    const [a, b] = keep.path.split(",").map(num);
    if (a != null && b != null) return goPath(a, b);
  }
  if (keep.team && num(keep.team) != null) return goTeam(num(keep.team));
  goWorld();
}

// ---------- HUD ----------
const play = $("#play"), scrub = $("#scrub");
function setPlaying(p) {
  S.playing = p;
  play.textContent = p ? "❚❚" : (D && S.spin >= D.m ? "↻" : "▶");
  play.setAttribute("aria-label", p ? "Pause" : D && S.spin >= D.m ? "Replay the season" : "Play");
}
play.onclick = () => {
  if (S.mode === "path") { S.mode = "world"; S.path = null; panel.hidden = S.team < 0; updateChrome(); }
  if (S.spin >= D.m) { S.spin = 0; layerDirty = true; }
  setPlaying(!S.playing);
};
scrub.oninput = () => { S.spin = +scrub.value; setPlaying(false); };
let hudLast = -1;
function updateHud() {
  const k = Math.max(0, Math.min(D.m - 1, Math.floor(S.spin) - 1));
  if (k === hudLast) return;
  hudLast = k;
  $("#hud-date").textContent = S.spin <= 0 ? "Season start" : longDate(evDate(D.P[k * 5 + 4]));
  let teams = 0;
  for (let i = 0; i < D.n; i++) if (D.first[i] <= S.spin) teams++;
  $("#hud-count").textContent = `${fmt(Math.floor(S.spin))} alliances · ${fmt(teams)} teams`;
  if (document.activeElement !== scrub) scrub.value = String(Math.floor(S.spin));
}

// ---------- pointer: pan, zoom, hover, pick ----------
let dragging = false, downAt = null, pointers = new Map(), pinch0 = null;
canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downAt = { x: e.clientX, y: e.clientY, t: performance.now(), view: { ...S.view } };
  if (pointers.size === 2) {
    const [p, q] = [...pointers.values()];
    pinch0 = { d: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, view: { ...S.view } };
  }
});
canvas.addEventListener("pointermove", e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.mode !== "orb" && pointers.size === 2 && pinch0) {
    const [p, q] = [...pointers.values()];
    const k = Math.hypot(p.x - q.x, p.y - q.y) / pinch0.d;
    zoomAt(pinch0.mx, pinch0.my, pinch0.view, k); dragging = true; return;
  }
  if (downAt && pointers.size === 1 && S.mode !== "orb") {
    const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
    if (dragging || Math.hypot(dx, dy) > 4) {
      dragging = true; canvas.classList.add("dragging");
      S.view = { ...downAt.view, tx: downAt.view.tx + dx, ty: downAt.view.ty + dy }; S.userMoved = true;
      hideTip(); return;
    }
  }
  if (!downAt) hoverAt(e.clientX, e.clientY);
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch0 = null;
  if (pointers.size === 0) {
    const wasDrag = dragging;
    dragging = false; canvas.classList.remove("dragging");
    if (wasDrag) { layerDirty = true; }
    else if (downAt && e.type === "pointerup") pickAt(e.clientX, e.clientY);
    downAt = null;
  }
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => { if (!downAt) { S.hover = -1; hideTip(); } });
canvas.addEventListener("wheel", e => {
  if (S.mode === "orb") return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, S.view, Math.exp(-e.deltaY * 0.0015));
  clearTimeout(window._wz); window._wz = setTimeout(() => { layerDirty = true; }, 140);
}, { passive: false });
function zoomAt(mx, my, v0, k) {
  const s = Math.max(baseScale() * 0.6, Math.min(baseScale() * 60, v0.s * k));
  const f = s / v0.s;
  S.view = { s, tx: mx - (mx - v0.tx) * f, ty: my - (my - v0.ty) * f }; S.userMoved = true;
}
function nearestTeam(x, y, maxPx = 12) {
  let best = -1, bd = maxPx * maxPx;
  const v = S.view;
  for (let i = 0; i < D.n; i++) {
    if (!D.has[i] || D.first[i] > S.spin) continue;
    const dx = D.wx[i] * v.s + v.tx - x, dy = D.wy[i] * v.s + v.ty - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function nearestNode(x, y, maxPx = 14) {
  if (!S.orb) return -1;
  let best = -1, bd = maxPx * maxPx;
  S.orb.nodes.forEach((nd, q) => { if (q === 0) return; const d = (nd.x - x) ** 2 + (nd.y - y) ** 2; if (d < bd) { bd = d; best = q; } });
  return best;
}
function hoverAt(x, y) {
  if (!D) return;
  if (S.mode === "orb") {
    S.hover = nearestNode(x, y);
    if (S.hover > 0) {
      const nd = S.orb.nodes[S.hover], p = pairOf(nd.k);
      const via = nd.ring === 2 ? `<span class="m">partner of ${esc(D.t.num[S.orb.nodes[nd.parent].i])}</span>` : "";
      showTip(x, y, `<b>${esc(D.t.num[nd.i])}</b> <span class="m">${esc([D.t.name[nd.i], D.t.reg[nd.i]].filter(Boolean).join(" · "))}</span>${via}
        <span class="m">${p.n} match${p.n === 1 ? "" : "es"} together, ${p.w} won · ${esc(evName(p.ev))}, ${shortDate(evDate(p.ev))}</span>`);
    } else hideTip();
  } else {
    S.hover = nearestTeam(x, y);
    if (S.hover >= 0) {
      const i = S.hover;
      showTip(x, y, `<b>${esc(D.t.num[i])}</b> <span class="m">${esc([D.t.name[i], D.t.reg[i]].filter(Boolean).join(" · "))}</span><span class="m">${D.deg[i]} alliance partners · tap to open its web</span>`);
    } else hideTip();
  }
  canvas.classList.toggle("pointing", S.hover >= 0);
}
function pickAt(x, y) {
  if (S.mode === "orb") {
    const q = nearestNode(x, y, 18);
    if (q > 0) goTeam(S.orb.nodes[q].i);
    return;
  }
  const i = nearestTeam(x, y, 16);
  if (i >= 0) goTeam(i);
}
const tip = $("#tip");
function showTip(x, y, html) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(W - r.width - 8, x + 14) + "px";
  tip.style.top = Math.min(H - r.height - 8, y + 14) + "px";
}
function hideTip() { tip.hidden = true; }

// ---------- search ----------
const q = $("#q"), sug = $("#suggest");
function matches(text) {
  const v = text.trim().toUpperCase();
  if (!v || !D) return [];
  const out = [];
  const exact = D.byNum.get(v);
  if (exact != null) out.push(exact);
  for (let i = 0; i < D.n && out.length < 8; i++) if (i !== exact && String(D.t.num[i]).toUpperCase().startsWith(v)) out.push(i);
  if (out.length < 8 && v.length >= 3) {
    for (let i = 0; i < D.n && out.length < 8; i++) if (!out.includes(i) && String(D.t.name[i]).toUpperCase().includes(v)) out.push(i);
  }
  return out;
}
q.addEventListener("input", () => {
  const ms = matches(q.value);
  sug.innerHTML = ms.map(i => `<li><button type="button" data-i="${i}"><b>${esc(D.t.num[i])}</b><span>${esc([D.t.name[i], D.t.reg[i]].filter(Boolean).join(" · "))}</span></button></li>`).join("");
  sug.hidden = !ms.length;
  sug.querySelectorAll("button").forEach(b => b.onclick = () => { pick(+b.dataset.i); });
});
function pick(i) { sug.hidden = true; q.value = ""; q.blur(); goTeam(i); }
$("#find").onsubmit = e => {
  e.preventDefault();
  const ms = matches(q.value);
  if (ms.length) pick(ms[0]);
};
document.addEventListener("click", e => { if (!$("#find").contains(e.target)) sug.hidden = true; });
document.querySelectorAll(".season button").forEach(b => b.onclick = () => {
  if (b.dataset.season === S.season) return;
  const keep = S.mode === "path" && S.path ? { path: `${D.t.num[S.path.a]},${D.t.num[S.path.b]}` } : S.team >= 0 ? { team: D.t.num[S.team] } : {};
  useSeason(b.dataset.season, keep);
});
$("#home").onclick = e => { e.preventDefault(); if (D) { goWorld(); S.userMoved = false; fitWorld(); layerDirty = true; } };
addEventListener("keydown", e => { if (e.key === "Escape" && D && S.mode !== "world") goWorld(); });
addEventListener("resize", resize);

// ---------- start ----------
resize();
requestAnimationFrame(frame);
(async () => {
  const h = readHash();
  await useSeason(SOURCES[h.season] ? h.season : "push-back", { team: h.team, path: h.path });
})();
