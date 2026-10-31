/* VEX Scan: point the camera at a license plate, get the team's card. */
"use strict";

const SEASON = "override";
const STATS = "https://stats.2360arachnid.com";
const DATA_SOURCES = [`${STATS}/data/${SEASON}/scan.json`, `data/scan-${SEASON}.json`];
const TESS = "vendor/tesseract/";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem("vs:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vs:" + k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- data ----------
let D = null;              // scan.json
let T = [];                // team objects
const byNum = new Map(), byId = new Map();
let worldNums = [];
let ratedCount = 1;

async function loadData() {
  for (const url of DATA_SOURCES) {
    try { const r = await fetch(url, { cache: "no-cache" }); if (r.ok) { D = await r.json(); break; } } catch { /* next */ }
  }
  if (!D) throw new Error("no data");
  const c = D.t;
  T = c.id.map((id, i) => ({ i, id, num: c.num[i], name: c.name[i], loc: c.loc[i], r: c.r[i], rk: c.rk[i],
                            rec: c.rec[i], sk: c.sk[i], q: c.q[i] }));
  for (const t of T) { byNum.set(t.num.toUpperCase(), t); byId.set(t.id, t); }
  worldNums = T.map(t => t.num.toUpperCase());
  ratedCount = Math.max(1, T.filter(t => t.rk).length);
}

// ---------- state ----------
const state = {
  me: store.get("me", ""),          // team number
  eventId: store.get("event", null),
  dex: store.get(`dex:${SEASON}`, {}),   // team id -> { t: time, e: event id, c: plate color }
};
const event = () => (state.eventId == null ? null : D.e.find(e => e.id === state.eventId) || null);
const eventTeams = () => (event()?.t || []).map(i => T[i]);
const meTeam = () => byNum.get((state.me || "").toUpperCase()) || null;

function today() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function autoEvent() {
  // an event happening now (give or take a day) that your team is at, else none
  const me = meTeam(), now = today();
  const live = D.e.filter(e => addDays(e.date, -1) <= now && now <= addDays(e.end, 1));
  if (me) { const mine = live.find(e => e.t.includes(me.i)); if (mine) return mine.id; }
  return null;
}

// ---------- tiers, odds ----------
function tier(t) {
  if (!t.rk) return { key: "unranked", label: "Unranked" };
  const p = t.rk / ratedCount;
  if (p <= 0.01) return { key: "legendary", label: "Legendary" };
  if (p <= 0.05) return { key: "epic", label: "Epic" };
  if (p <= 0.2) return { key: "rare", label: "Rare" };
  return { key: "common", label: "Common" };
}
const sig = z => 1 / (1 + Math.exp(-z));
function typical() {
  // the median rating of rated teams at this event, or of the whole season
  const rs = eventTeams().map(t => t.r).filter(r => r != null).sort((a, b) => a - b);
  return rs.length >= 4 ? rs[rs.length >> 1] : D.med;
}
function odds(me, them) {
  if (!me || me.r == null || them.r == null) return null;
  const avg = typical();
  return { with: sig(D.k * (me.r + them.r - 2 * avg)), against: sig(D.k * (me.r - them.r)) };
}

// ---------- the card ----------
function recordText(rec) {
  if (!rec) return "–";
  const [w, l, t] = rec.split("-").map(Number);
  return t ? `${w}–${l}–${t}` : `${w}–${l}`;
}
function cardHTML(t, color) {
  const ti = tier(t), me = meTeam(), o = odds(me, t);
  const q = [t.q & 1 ? "States" : "", t.q & 2 ? "Worlds" : ""].filter(Boolean);
  const pend = [t.q & 4 ? "States" : "", t.q & 8 ? "Worlds" : ""].filter(Boolean);
  const pct = x => Math.round(x * 100);
  let oddsBlock;
  if (me && me.id === t.id) oddsBlock = `<p class="odds-note">That's you. Go scan someone else.</p>`;
  else if (!me) oddsBlock = `<button class="odds-note linkish" data-open="event-sheet">Set your team to see your odds with and against them</button>`;
  else if (!o) oddsBlock = `<p class="odds-note">${t.r == null ? "No matches yet this season" : `${esc(me.num)} has no matches yet`}, so no odds.</p>`;
  else oddsBlock = `<div class="odds">
      <div class="odd"><span>Allied, ${esc(me.num)} wins</span><b>${pct(o.with)}%</b><i style="--p:${pct(o.with)}%"></i></div>
      <div class="odd"><span>Facing them, ${esc(me.num)} wins</span><b>${pct(o.against)}%</b><i style="--p:${pct(o.against)}%"></i></div>
    </div>`;
  const skills = t.sk ? `<dd>${t.sk[0]}</dd><small>${t.sk[1]} auto, ${t.sk[2]} driver</small>` : `<dd>–</dd><small>none posted</small>`;
  return `<article class="card t-${ti.key}" id="card">
    <div class="flip">
      <div class="face front">
        <div class="rail"></div>
        <div class="cbody">
          <div class="ctop"><span class="tier">${ti.label}</span><span class="rank">${t.rk ? `#${t.rk} of ${ratedCount.toLocaleString()} rated` : "No matches yet"}</span></div>
          <div class="plate ${color === "blue" ? "blue" : "red"}"><h2 id="card-title">${esc(t.num)}</h2></div>
          <p class="tname">${esc(t.name) || "&nbsp;"}</p>
          <p class="tloc">${esc(t.loc)}</p>
          <dl class="cstats">
            <div><dt>Rating</dt><dd>${t.r == null ? "–" : t.r.toFixed(1)}</dd><small>points per match</small></div>
            <div><dt>Record</dt><dd>${recordText(t.rec)}</dd><small>this season</small></div>
            <div><dt>Skills</dt>${skills}</div>
          </dl>
          ${q.length ? `<p class="quals">Qualified for ${q.join(" and ")}</p>` : ""}
          ${pend.length ? `<p class="quals pending" title="Their award qualifies only if the event gets enough spots; RECF sets spot counts in January">${q.length ? "Also pending" : "Pending"} for ${pend.join(" and ")}</p>` : ""}
          ${oddsBlock}
        </div>
        <div class="rail"></div>
        <div class="foil" aria-hidden="true"></div>
      </div>
      <div class="face back" aria-hidden="true"><img src="https://2360arachnid.com/brand/logo-320.webp" alt="" onerror="this.remove()"><span>VEX Scan</span></div>
    </div>
  </article>`;
}

let shown = null;
function showCard(t, { scanned = false, color = "red" } = {}) {
  shown = { t, color };
  const fresh = scanned && !state.dex[t.id];
  if (scanned) {
    state.dex[t.id] = { t: Date.now(), e: state.eventId, c: color };
    store.set(`dex:${SEASON}`, state.dex);
    updateDexCount();
  }
  $("#card-slot").innerHTML = cardHTML(t, scanned ? color : state.dex[t.id]?.c || color);
  const ev = event();
  $("#caught-note").textContent = !scanned ? (state.dex[t.id] ? "In your Dex." : "")
    : fresh ? `Caught! ${ev && ev.t.includes(t.i) ? `${caughtAt(ev)} of ${ev.t.length} at ${ev.name}.` : `${Object.keys(state.dex).length} in your Dex.`}`
    : "Already in your Dex.";
  $("#stats-link").href = `${STATS}/#/team/${t.id}`;
  open("card-sheet");
  const card = $("#card");
  if (scanned && !reduceMotion) { card.classList.add("reveal"); }
  else card.classList.add("shown");
  wireFoil(card);
  card.querySelector("[data-open]")?.addEventListener("click", e => { close("card-sheet"); openEvents(); });
}

function wireFoil(card) {
  if (reduceMotion) return;
  const move = e => {
    const r = card.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width), y = ((e.clientY - r.top) / r.height);
    card.style.setProperty("--fx", `${Math.round(x * 100)}%`);
    card.style.setProperty("--fy", `${Math.round(y * 100)}%`);
    card.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    card.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
  };
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerleave", () => { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
}

// ---------- share a card as an image ----------
async function shareCard() {
  if (!shown) return;
  const { t, color } = shown, ti = tier(t);
  await document.fonts.ready;
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const frame = { legendary: "#f5c542", epic: "#a43bd6", rare: "#c99bf0", common: "#c3bfcc", unranked: "#5d5468" }[ti.key];
  x.fillStyle = "#07050a"; x.fillRect(0, 0, W, H);
  const g = x.createRadialGradient(W / 2, 380, 50, W / 2, 380, 900); g.addColorStop(0, "rgba(116,23,147,.55)"); g.addColorStop(1, "rgba(7,5,10,0)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // card body + C-channel rails
  const cx0 = 90, cy0 = 90, cw = W - 180, chh = H - 230;
  x.fillStyle = "#140d1b"; roundRect(x, cx0, cy0, cw, chh, 36); x.fill();
  x.lineWidth = 6; x.strokeStyle = frame; roundRect(x, cx0, cy0, cw, chh, 36); x.stroke();
  for (const ry of [cy0 + 18, cy0 + chh - 62]) {
    x.fillStyle = frame; x.fillRect(cx0 + 30, ry, cw - 60, 44);
    x.fillStyle = "#07050a";
    for (let hx = cx0 + 48; hx < cx0 + cw - 60; hx += 46) x.fillRect(hx, ry + 11, 22, 22);
  }
  x.textBaseline = "alphabetic";
  x.font = "500 34px 'Space Grotesk'"; x.fillStyle = frame; x.fillText(ti.label, cx0 + 50, cy0 + 130);
  x.textAlign = "right"; x.fillStyle = "#a99bb8";
  x.fillText(t.rk ? `#${t.rk} of ${ratedCount.toLocaleString()} rated` : "No matches yet", cx0 + cw - 50, cy0 + 130);
  x.textAlign = "center";
  x.fillStyle = color === "blue" ? "#2456c9" : "#d8273a"; roundRect(x, cx0 + 60, cy0 + 170, cw - 120, 230, 22); x.fill();
  x.fillStyle = "#fff"; x.font = `170px Rye`; fitText(x, t.num, cw - 180, 170, "Rye"); x.fillText(t.num, W / 2, cy0 + 345);
  x.fillStyle = "#efe9f5"; x.font = "700 56px 'Space Grotesk'"; fitText(x, t.name || "", cw - 120, 56, "'Space Grotesk'", "700"); x.fillText(t.name || "", W / 2, cy0 + 490);
  x.fillStyle = "#a99bb8"; x.font = "400 36px 'Space Grotesk'"; x.fillText(t.loc || "", W / 2, cy0 + 545);
  const cols = [["Rating", t.r == null ? "–" : t.r.toFixed(1)], ["Record", recordText(t.rec)], ["Skills", t.sk ? String(t.sk[0]) : "–"]];
  cols.forEach(([k, v], i) => {
    const mx = cx0 + cw * (i + 0.5) / 3;
    x.fillStyle = "#efe9f5"; x.font = "88px Rye"; x.fillText(v, mx, cy0 + 720);
    x.fillStyle = "#a99bb8"; x.font = "500 32px 'Space Grotesk'"; x.fillText(k, mx, cy0 + 770);
  });
  const q = [t.q & 1 ? "States" : "", t.q & 2 ? "Worlds" : ""].filter(Boolean);
  const pend = [t.q & 4 ? "States" : "", t.q & 8 ? "Worlds" : ""].filter(Boolean);
  if (q.length) { x.fillStyle = "#7ee0a6"; x.font = "700 38px 'Space Grotesk'"; x.fillText(`Qualified for ${q.join(" and ")}`, W / 2, cy0 + 880); }
  else if (pend.length) { x.fillStyle = "#f5c542"; x.font = "700 38px 'Space Grotesk'"; x.fillText(`Pending for ${pend.join(" and ")}`, W / 2, cy0 + 880); }
  x.fillStyle = "#a99bb8"; x.font = "500 32px 'Space Grotesk'"; x.fillText("Scanned with VEX Scan · app.2360arachnid.com", W / 2, H - 70);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  const file = new File([blob], `${t.num}-vex-scan.png`, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${t.num} on VEX Scan` }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Card saved as an image.");
}
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.roundRect ? x.roundRect(a, b, w, h, r) : x.rect(a, b, w, h); }
function fitText(x, s, max, size, fam, wt = "") { let z = size; x.font = `${wt} ${z}px ${fam}`; while (z > 20 && x.measureText(s).width > max) { z -= 4; x.font = `${wt} ${z}px ${fam}`; } }

// ---------- sheets ----------
function open(id) {
  const el = document.getElementById(id); el.hidden = false;
  el.classList.add("open");
  document.body.classList.add("sheeted");
  pause(true);
}
function close(id) {
  const el = document.getElementById(id); if (el.hidden) return;
  el.classList.remove("open");
  setTimeout(() => { if (!el.classList.contains("open")) el.hidden = true;
    if (![...document.querySelectorAll(".sheet")].some(s => s.classList.contains("open"))) document.body.classList.remove("sheeted"); }, reduceMotion ? 0 : 220);
  if (id === "card-sheet" && lastLock) lastLock.t = performance.now();   // cooldown starts when the card closes
  setTimeout(() => { if (![...document.querySelectorAll(".sheet")].some(s => !s.hidden && s.classList.contains("open"))) pause(false); }, 0);
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-close]");
  if (c) close(c.closest(".sheet").id);
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const openSheet = [...document.querySelectorAll(".sheet")].reverse().find(s => !s.hidden);
  if (openSheet) close(openSheet.id);
});
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }

// ---------- dex ----------
const caughtAt = ev => ev.t.filter(i => state.dex[T[i].id]).length;
function updateDexCount() {
  const ev = event();
  $("#dex-count").textContent = ev ? `${caughtAt(ev)}/${ev.t.length}` : Object.keys(state.dex).length;
}
function openDex() {
  const ev = event();
  const numKey = t => [parseInt(t.num, 10) || 0, t.num];
  const sortNum = (a, b) => { const [x, s] = numKey(a), [y, u] = numKey(b); return x - y || s.localeCompare(u); };
  let list, sub;
  if (ev) {
    list = ev.t.map(i => T[i]).sort(sortNum);
    const n = caughtAt(ev);
    sub = `${n} of ${list.length} teams caught at ${ev.name}.`;
    $("#dex-meter span").style.width = `${(n / Math.max(1, list.length)) * 100}%`;
    $("#dex-meter").hidden = false;
  } else {
    list = Object.keys(state.dex).map(id => byId.get(+id)).filter(Boolean).sort((a, b) => state.dex[b.id].t - state.dex[a.id].t);
    sub = list.length ? `${list.length} teams caught this season. Pick an event to collect a whole field.` : "Teams you scan land here. Pick an event to see everyone you can catch there.";
    $("#dex-meter").hidden = true;
  }
  $("#dex-sub").textContent = sub;
  $("#dex-grid").innerHTML = list.map(t => {
    const got = state.dex[t.id];
    return got ? `<button class="mini ${got.c === "blue" ? "blue" : "red"} t-${tier(t).key}" data-team="${t.id}" aria-label="${esc(t.num)}, ${tier(t).label}"><span>${esc(t.num)}</span></button>`
      : `<button class="mini empty" data-team="${t.id}" aria-label="${esc(t.num)}, not caught yet"><span>${esc(t.num)}</span></button>`;
  }).join("");
  open("dex-sheet");
}
$("#dex-grid").addEventListener("click", e => {
  const b = e.target.closest("[data-team]"); if (!b) return;
  const t = byId.get(+b.dataset.team);
  if (!state.dex[t.id]) { toast(`${t.num} isn't caught yet. Find their robot and scan the plate.`); return; }
  close("dex-sheet"); showCard(t);
});

// ---------- events + your team ----------
function eventRow(e, me) {
  const mine = me && e.t.includes(me.i);
  const d = new Date(e.date + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `<button class="evrow ${e.id === state.eventId ? "on" : ""}" data-ev="${e.id}">
    <b>${esc(e.name)}</b><span>${d}, ${esc(e.place || "")} · ${e.t.length} teams${mine ? ` · <em>${esc(me.num)} is here</em>` : ""}</span></button>`;
}
function renderEvents() {
  const q = $("#event-search").value.trim().toLowerCase(), me = meTeam(), now = today();
  const hit = e => !q || e.name.toLowerCase().includes(q) || (e.place || "").toLowerCase().includes(q);
  const all = D.e.filter(hit);
  const span = e => Date.parse(e.end) - Date.parse(e.date);
  const live = all.filter(e => e.date <= now && now <= e.end).sort((a, b) => span(a) - span(b));
  const soon = all.filter(e => e.date > now && e.date <= addDays(now, 45));
  const past = all.filter(e => e.end < now && e.end >= addDays(now, -45)).reverse();
  const later = all.filter(e => e.date > addDays(now, 45));
  const mineFirst = arr => me ? [...arr.filter(e => e.t.includes(me.i)), ...arr.filter(e => !e.t.includes(me.i))] : arr;
  const section = (title, arr, n = 40) => arr.length ? `<h3>${title}</h3>${mineFirst(arr).slice(0, n).map(e => eventRow(e, me)).join("")}` : "";
  $("#event-list").innerHTML = `<button class="evrow ${state.eventId == null ? "on" : ""}" data-ev="">
      <b>All teams</b><span>Match any of the ${T.length.toLocaleString()} High School teams this season</span></button>
    ${section("Happening now", live)}${section("Coming up", soon)}${section("Recent", past)}${q ? section("Later", later) : ""}
    ${q && !all.length ? `<p class="muted">No events match “${esc(q)}”.</p>` : ""}`;
}
function openEvents() { $("#me-input").value = state.me; renderEvents(); open("event-sheet"); }
$("#event-list").addEventListener("click", e => {
  const b = e.target.closest("[data-ev]"); if (!b) return;
  setEvent(b.dataset.ev ? +b.dataset.ev : null); close("event-sheet");
});
$("#event-search").addEventListener("input", renderEvents);
$("#me-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#me-input").value.trim().toUpperCase();
  if (v && !byNum.has(v)) { $("#me-note").textContent = `No High School team ${v} this season. Check the number.`; return; }
  state.me = v; store.set("me", v);
  $("#me-note").textContent = v ? `Saved. Cards now show odds for ${v}.` : "Used for your odds with and against each team.";
  if (state.eventId == null) { const a = autoEvent(); if (a != null) setEvent(a); }
  renderEvents();
});
function setEvent(id) {
  state.eventId = id; store.set("event", id);
  const ev = event();
  $("#event-name").textContent = ev ? ev.name : "All teams";
  eventNums = ev ? ev.t.map(i => T[i].num.toUpperCase()) : [];
  updateDexCount();
}

// ---------- type a number ----------
function openType() { $("#type-input").value = ""; renderType(); open("type-sheet"); setTimeout(() => $("#type-input").focus(), 60); }
function renderType() {
  const v = $("#type-input").value.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  const pool = eventTeams().length ? eventTeams() : T;
  let rows;
  if (!v) rows = pool.slice(0, 0);
  else {
    rows = pool.filter(t => t.num.toUpperCase().startsWith(v));
    if (rows.length < 8 && pool !== T) rows = rows.concat(T.filter(t => t.num.toUpperCase().startsWith(v) && !rows.includes(t)));
    rows.sort((a, b) => a.num.length - b.num.length || a.num.localeCompare(b.num));
  }
  $("#type-list").innerHTML = rows.slice(0, 12).map(t => `<li><button data-team="${t.id}"><b>${esc(t.num)}</b><span>${esc(t.name)}${t.loc ? `, ${esc(t.loc)}` : ""}</span></button></li>`).join("")
    || (v ? `<li class="muted">No High School team starts with ${esc(v)} this season.</li>` : `<li class="muted">${eventTeams().length ? `Teams at ${esc(event().name)} come first.` : "Any High School team this season."}</li>`);
}
$("#type-input").addEventListener("input", renderType);
$("#type-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#type-input").value.trim().toUpperCase();
  const t = byNum.get(v) || (() => { const b = $("#type-list button"); return b && byId.get(+b.dataset.team); })();
  if (t) { close("type-sheet"); showCard(t); }
});
$("#type-list").addEventListener("click", e => {
  const b = e.target.closest("[data-team]"); if (!b) return;
  close("type-sheet"); showCard(byId.get(+b.dataset.team));
});

// ---------- camera + reading loop ----------
let stream = null, worker = null, workerLoading = null, scanning = false, paused = false, eventNums = [];
const recent = [];   // recent resolved reads, for "two frames agree"
let lastLock = null; // the team just caught: ignored for a few seconds so "Scan next" doesn't re-catch it

function loadWorker() {
  return workerLoading ??= (async () => {
    await new Promise((ok, bad) => {
      if (window.Tesseract) return ok();
      const s = document.createElement("script"); s.src = TESS + "tesseract.min.js"; s.onload = ok; s.onerror = bad; document.head.append(s);
    });
    const w = await Tesseract.createWorker("eng", 1, { workerPath: TESS + "worker.min.js", corePath: TESS, langPath: TESS, workerBlobURL: false });
    await w.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" });
    worker = w;
    return w;
  })();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $("#intro-note").textContent = location.protocol === "http:" && location.hostname !== "localhost"
      ? "The camera needs a secure page. Open https://app.2360arachnid.com instead." : "This browser can't use the camera. You can still type a team number.";
    return;
  }
  $("#start-btn").disabled = true; $("#start-btn").textContent = "Opening the camera…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (e) {
    $("#start-btn").disabled = false; $("#start-btn").textContent = "Start scanning";
    $("#intro-note").textContent = e.name === "NotAllowedError"
      ? "Camera access is off for this site. Allow it in your browser's site settings, or type a team number."
      : "Couldn't open a camera. You can still type a team number.";
    return;
  }
  const v = $("#cam"); v.srcObject = stream; await v.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* not supported */ }
  const caps = track.getCapabilities?.() || {};
  $("#torch-btn").hidden = !caps.torch;
  store.set("scanned", true);
  document.body.classList.add("live");
  $("#intro").hidden = true; $("#viewfinder").hidden = false;
  $("#start-btn").disabled = false; $("#start-btn").textContent = "Start scanning";
  hint("Loading the plate reader…");
  try { await loadWorker(); } catch { hint("The plate reader didn't load. Check your connection, or type a number."); return; }
  hint("Fit a license plate in the box");
  scanning = true; loop();
}
function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  document.body.classList.remove("live");
  $("#viewfinder").hidden = true; $("#intro").hidden = false;
}
function pause(on) { paused = on; if (!on && scanning) loop(); }
function hint(s) { $("#hint").textContent = s; }

// copy the part of the video under the aim box into the 640x360 frame
function grab() {
  const v = $("#cam"), vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return false;
  const vr = v.getBoundingClientRect(), ar = $("#aim").getBoundingClientRect();
  const s = Math.max(vr.width / vw, vr.height / vh);
  const ox = vr.left + (vr.width - vw * s) / 2, oy = vr.top + (vr.height - vh * s) / 2;
  const sx = (ar.left - ox) / s, sy = (ar.top - oy) / s, sw = ar.width / s, sh = ar.height / s;
  const f = $("#frame"), ctx = f.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, PlateReader.W, PlateReader.H);
  return true;
}

let looping = false, lastSeen = 0;
async function loop() {
  if (looping) return;
  looping = true;
  while (scanning && !paused) {
    const t0 = performance.now();
    if (grab()) {
      const { crops, plate } = PlateReader.textCrops($("#frame"));
      const seen = crops.length > 0;
      $("#aim").classList.toggle("seen", seen);
      if (seen) lastSeen = t0;
      else if (t0 - lastSeen > 2500) hint(plate ? "Closer, so the number fills the box" : "Fit a license plate in the box");
      for (const cr of crops.slice(0, 3)) {
        if (!scanning || paused) break;
        const { data } = await worker.recognize(cr.canvas);
        const r = PlateReader.resolve(data.text, eventNums, worldNums);
        if (r) { if (consider(r, plate)) break; else { hint(`Reading… ${r.team}?`); break; } }
      }
    }
    const wait = 90 - (performance.now() - t0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  looping = false;
}
function consider(r, color) {
  const now = performance.now();
  if (paused || !scanning) return false;
  if (lastLock && lastLock.team === r.team && now - lastLock.t < 6000) return false;
  recent.push({ team: r.team, t: now });
  while (recent.length && now - recent[0].t > 2500) recent.shift();
  const agree = recent.filter(x => x.team === r.team).length;
  const sure = (r.where === "event" && r.d <= 0.4) || agree >= 2;
  if (!sure) return false;
  recent.length = 0;
  const t = byNum.get(r.team);
  if (!t) return false;
  lastLock = { team: r.team, t: now };
  paused = true;
  navigator.vibrate?.(35);
  $("#aim").classList.add("lock");
  setTimeout(() => $("#aim").classList.remove("lock"), 500);
  hint("Fit a license plate in the box");
  showCard(t, { scanned: true, color: color || "red" });
  return true;
}

$("#torch-btn").addEventListener("click", async () => {
  const track = stream?.getVideoTracks()[0]; if (!track) return;
  const on = $("#torch-btn").getAttribute("aria-pressed") !== "true";
  try { await track.applyConstraints({ advanced: [{ torch: on }] }); $("#torch-btn").setAttribute("aria-pressed", String(on)); } catch { toast("This camera has no flashlight."); }
});
$("#start-btn").addEventListener("click", startCamera);
$("#stop-btn").addEventListener("click", stopCamera);
$("#type-btn").addEventListener("click", openType);
$("#type-btn-2").addEventListener("click", openType);
$("#dex-btn").addEventListener("click", openDex);
$("#event-btn").addEventListener("click", openEvents);
$("#share-btn").addEventListener("click", () => shareCard().catch(() => toast("Couldn't make the image.")));
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stopCamera(); });

// ---------- boot ----------
(async () => {
  document.body.classList.add("loading");
  try { await loadData(); }
  catch { $("#intro-note").textContent = "Couldn't load team data. Check your connection and reload."; return; }
  document.body.classList.remove("loading");
  if (state.eventId != null && !event()) state.eventId = null;
  if (state.eventId == null) state.eventId = autoEvent();
  setEvent(state.eventId);
  if (!navigator.mediaDevices?.getUserMedia && location.protocol === "http:" && location.hostname !== "localhost")
    $("#intro-note").textContent = "The camera needs a secure page. Open https://app.2360arachnid.com instead.";
  const want = new URLSearchParams(location.search).get("team");
  if (want && byNum.get(want.toUpperCase())) showCard(byNum.get(want.toUpperCase()));
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost"))
    navigator.serviceWorker.register("sw.js").catch(() => {});
  // returning scanners: warm the reader so the first scan is quick (first-timers
  // don't download 7 MB just for looking)
  if (store.get("scanned", false) && navigator.mediaDevices?.getUserMedia) setTimeout(() => loadWorker().catch(() => {}), 1200);
})();
