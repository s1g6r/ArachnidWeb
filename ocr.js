/* VEX Scan plate reader.
 *
 * Finds a row of character-shaped blobs in a 640x360 frame (the aim box),
 * straightens it using the plate's own angle, and hands only those blobs to
 * Tesseract, then matches the read to real team numbers. Licence-plate readers
 * work the same way: find the characters first, read them second.
 *
 * Plate: red or blue, any text color. Text masks tried, best row first:
 *   - inside the plate's outline but not plate-colored (works for any text color)
 *   - bright pixels (white text), dark pixels (black text)
 */
"use strict";

const PlateReader = (() => {
  const W = 640, H = 360;

  function colorMasks(d) {
    const n = W * H;
    const red = new Uint8Array(n), blue = new Uint8Array(n), mn = new Uint8Array(n), mx = new Uint8Array(n);
    let rc = 0, bc = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      const M = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const m = r < g ? (r < b ? r : b) : (g < b ? g : b);
      mn[i] = m; mx[i] = M;
      const sat = M ? (M - m) / M : 0;
      if (r > g + 40 && r > b + 30 && sat > 0.45) { red[i] = 1; rc++; }
      else if (b > r + 40 && b > g + 15 && sat > 0.45) { blue[i] = 1; bc++; }
    }
    return { red, blue, mn, mx, rc, bc };
  }

  // 4-connected components; returns labels and per-component stats
  function label(mask, w, h, moments) {
    const lab = new Int32Array(w * h), comps = [], stack = new Int32Array(w * h);
    let k = 0;
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue;
      k++;
      const c = { id: k, x0: w, y0: h, x1: -1, y1: -1, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
      let sp = 0; stack[sp++] = s; lab[s] = k;
      while (sp) {
        const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
        c.area++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        if (moments) { c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y; }
        if (x + 1 < w && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = k; stack[sp++] = p + 1; }
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = k; stack[sp++] = p - 1; }
        if (y + 1 < h && mask[p + w] && !lab[p + w]) { lab[p + w] = k; stack[sp++] = p + w; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = k; stack[sp++] = p - w; }
      }
      comps.push(c);
    }
    return { lab, comps };
  }

  // the plate: the biggest, fullest, wide red or blue region (on a 4x coarser grid)
  function findPlate(cm) {
    const st = 4, w = W / st, h = H / st;
    let best = null;
    for (const [color, full] of [["red", cm.red], ["blue", cm.blue]]) {
      const small = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = full[y * st * W + x * st];
      for (const c of label(small, w, h, true).comps) {
        if (c.area < 40) continue;
        const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
        let score = c.area * Math.min(1, c.area / (bw * bh) / 0.5);
        if (bw < 1.3 * bh) score *= 0.3;
        if (!best || score > best.score) {
          const mx = c.sx / c.area, my = c.sy / c.area;
          const cxx = c.sxx / c.area - mx * mx, cyy = c.syy / c.area - my * my, cxy = c.sxy / c.area - mx * my;
          let ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI;   // major axis, y down
          best = { score, ang, color, cx: mx * st, cy: my * st, box: [c.x0 * st, c.y0 * st, (c.x1 + 1) * st, (c.y1 + 1) * st] };
        }
      }
    }
    return best;
  }

  function otsu(v) {
    const hist = new Float64Array(256);
    for (let i = 0; i < v.length; i++) hist[v[i]]++;
    let w = 0, mu = 0, mt = 0, best = 0, arg = 0;
    for (let i = 0; i < 256; i++) mt += i * hist[i] / v.length;
    for (let i = 0; i < 256; i++) {
      const p = hist[i] / v.length; w += p; mu += i * p;
      const sb = (mt * w - mu) ** 2 / Math.max(w * (1 - w), 1e-9);
      if (sb > best) { best = sb; arg = i; }
    }
    return arg;
  }

  function morph(m, grow) {           // one step of dilation (grow) or erosion, cross-shaped
    const o = new Uint8Array(m.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const n = [m[p], x > 0 ? m[p - 1] : 0, x < W - 1 ? m[p + 1] : 0, y > 0 ? m[p - W] : 0, y < H - 1 ? m[p + W] : 0];
      o[p] = grow ? (n.some(Boolean) ? 1 : 0) : (n.every(Boolean) ? 1 : 0);
    }
    return o;
  }

  function fillHoles(m) {             // everything not reachable from the border through background
    const out = new Uint8Array(m.length).fill(1), stack = [];
    const push = p => { if (!m[p] && out[p]) { out[p] = 0; stack.push(p); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (stack.length) {
      const p = stack.pop(), y = (p / W) | 0, x = p - y * W;
      if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W);
    }
    return out;
  }

  function inkMasks(cm) {
    const out = [], n = W * H;
    for (const [pm, cnt] of [[cm.red, cm.rc], [cm.blue, cm.bc]]) {
      if (cnt / n <= 0.03) continue;
      let c = pm;
      c = morph(morph(c, true), true); c = morph(morph(c, false), false);
      const filled = fillHoles(c), ink = new Uint8Array(n);
      for (let i = 0; i < n; i++) ink[i] = filled[i] && !pm[i] ? 1 : 0;
      out.push(ink);
    }
    const tw = Math.max(otsu(cm.mn), 120), td = Math.min(otsu(cm.mx), 110);
    const white = new Uint8Array(n), dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) { white[i] = cm.mn[i] > tw ? 1 : 0; dark[i] = cm.mx[i] < td ? 1 : 0; }
    out.push(white, dark);
    return out;
  }

  // the best row of 2-7 blobs of similar height, side by side
  function charRow(ink) {
    const { lab, comps } = label(ink, W, H, false);
    const blobs = [];
    for (const c of comps) {
      const h = c.y1 - c.y0 + 1, w = c.x1 - c.x0 + 1;
      if (h < H * 0.08 || h > H * 0.9) continue;
      if (c.x0 === 0 || c.y0 === 0 || c.x1 === W - 1 || c.y1 === H - 1) continue;
      if (!(w / h > 0.12 && w / h < 1.25)) continue;
      const fill = c.area / (w * h);
      if (!(fill > 0.15 && fill < 0.92)) continue;
      blobs.push({ x0: c.x0, y0: c.y0, x1: c.x1 + 1, y1: c.y1 + 1, id: c.id });
    }
    blobs.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    let best = null;
    for (let s = 0; s < blobs.length; s++) {
      const row = [blobs[s]];
      for (const b of blobs.slice(s + 1)) {
        const p = row[row.length - 1], ph = p.y1 - p.y0, bh = b.y1 - b.y0;
        if (Math.abs(bh - ph) > 0.3 * Math.max(bh, ph)) continue;
        if (Math.abs((b.y0 + b.y1) / 2 - (p.y0 + p.y1) / 2) > 0.35 * ph) continue;
        const gap = b.x0 - p.x1;
        if (gap < -0.1 * ph || gap > 0.9 * ph) continue;
        row.push(b);
      }
      if (row.length >= 2 && row.length <= 7) {
        const score = row.length * 10 + row.reduce((a, r) => a + r.y1 - r.y0, 0) / row.length / H;
        if (!best || score > best.score) best = { score, row };
      }
    }
    if (!best) return null;
    const ids = new Set(best.row.map(r => r.id));
    const x0 = Math.min(...best.row.map(r => r.x0)), y0 = Math.min(...best.row.map(r => r.y0));
    const x1 = Math.max(...best.row.map(r => r.x1)), y1 = Math.max(...best.row.map(r => r.y1));
    const cw = x1 - x0, ch = y1 - y0;
    const crop = document.createElement("canvas"); crop.width = cw; crop.height = ch;
    const cx = crop.getContext("2d"), img = cx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = ids.has(lab[(y + y0) * W + x + x0]) ? 0 : 255, o = (y * cw + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    const s = 56 / Math.max(ch, 1), out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cw * s)) + 32; out.height = 56 + 32;
    const ox = out.getContext("2d");
    ox.fillStyle = "#fff"; ox.fillRect(0, 0, out.width, out.height);
    ox.imageSmoothingEnabled = true; ox.drawImage(crop, 16, 16, out.width - 32, 56);
    return { score: best.score, canvas: out, box: [x0, y0, x1, y1], n: best.row.length };
  }

  /** frame: a 640x360 canvas. Returns text crops to OCR, best first, and
   *  whether a plate-colored region was seen (for aiming feedback). */
  function textCrops(frame) {
    let ctx = frame.getContext("2d", { willReadFrequently: true });
    let cm = colorMasks(ctx.getImageData(0, 0, W, H).data);
    const plate = findPlate(cm);
    if (plate && Math.abs(plate.ang) > 2 && Math.abs(plate.ang) < 30) {
      const rot = document.createElement("canvas"); rot.width = W; rot.height = H;
      const rc = rot.getContext("2d", { willReadFrequently: true });
      rc.fillStyle = "rgb(128,128,128)"; rc.fillRect(0, 0, W, H);
      rc.translate(plate.cx, plate.cy); rc.rotate(-plate.ang * Math.PI / 180); rc.translate(-plate.cx, -plate.cy);
      rc.drawImage(frame, 0, 0);
      ctx = rc; cm = colorMasks(rc.getImageData(0, 0, W, H).data);
    }
    const rows = inkMasks(cm).map(charRow).filter(Boolean).sort((a, b) => b.score - a.score);
    return { crops: rows, plate: plate ? plate.color : null };
  }

  // ---- matching a read to real team numbers ----
  const CONF = new Map();
  for (const p of ["0O", "0D", "0Q", "1I", "1L", "1T", "2Z", "5S", "6G", "8B", "6B", "3B", "4A", "7T", "9G", "OD", "OQ",
                   "CG", "UV", "MN", "EF", "PR", "KX", "VY", "38", "69", "05", "08", "17", "56", "58", "89", "36", "35"]) {
    CONF.set(p, 0.35); CONF.set(p[1] + p[0], 0.35);
  }
  function dist(s, t) {
    const n = s.length, m = t.length;
    let prev = new Float64Array(m + 1), cur = new Float64Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j * 0.8;
    for (let i = 1; i <= n; i++) {
      cur[0] = i * 0.8;
      for (let j = 1; j <= m; j++) {
        const a = s[i - 1], b = t[j - 1];
        const sub = a === b ? 0 : (CONF.get(a + b) ?? 1);
        cur[j] = Math.min(prev[j] + 0.8, cur[j - 1] + 0.8, prev[j - 1] + sub);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[m];
  }
  function best(read, cands) {
    let b1 = null, d1 = 9, d2 = 9;
    for (const c of cands) {
      const d = dist(read, c);
      if (d < d1) { d2 = d1; d1 = d; b1 = c; } else if (d < d2) d2 = d;
    }
    return { team: b1, d1, d2 };
  }
  /** -> {team, d, where: "event"|"world"} or null. Event teams first; the whole
   *  world only for a near-exact read. */
  function resolve(raw, eventNums, worldNums) {
    const read = (raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (read.length < 2) return null;
    if (eventNums && eventNums.length) {
      const e = best(read, eventNums);
      if (e.d1 <= 1.2 && e.d2 - e.d1 >= 0.3) return { team: e.team, d: e.d1, where: "event", read };
    }
    if (read.length < 3) return null;
    const w = best(read, worldNums);
    if (w.d1 <= 0.4 && w.d2 - w.d1 >= 0.3) return { team: w.team, d: w.d1, where: "world", read };
    return null;
  }

  return { W, H, textCrops, resolve, dist };
})();
