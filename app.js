import { buildModel, simulate, naiveUltimate } from "./ev.js";
import { PROFILES, FALLBACK_PROFILE, CATEGORY_META, PACKS_PER_DISPLAY } from "./rates.js";

const $ = (id) => document.getElementById(id);
const RATE_KEYS = ["epic", "altArt", "specialArt", "overnumbered", "signature", "ultimate", "altRune"];
const PRICING_DEFAULTS = { priceField: "market", sellThrough: 100, bulkThreshold: 0, bulkValue: 0 };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const state = { index: null, set: null, abbr: null, profile: null, rates: {}, foil: {}, pricing: { ...PRICING_DEFAULTS } };
const cache = new Map();

// ---------- formatting ----------
const usd = (v, d = 2) =>
  "$" + (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const oneIn = (p) => (p > 0 ? "1 in " + (1 / p >= 100 ? Math.round(1 / p).toLocaleString("en-US") : (1 / p).toFixed(1).replace(/\.0$/, "")) : "—");
function rateText(v) {
  if (!v) return "0";
  return v < 0.1 ? "1/" + +(1 / v).toFixed(1) : +(v * 100).toFixed(2) + "%";
}
// Accepts "1/720", "1 in 720", "0.14%", "0.0014"
function parseRate(s) {
  s = String(s).trim().toLowerCase().replace(/,/g, "");
  if (!s) return 0;
  let m = s.match(/^1\s*(?:\/|in)\s*([\d.]+)$/);
  if (m) return +m[1] > 0 ? 1 / +m[1] : NaN;
  m = s.match(/^([\d.]+)\s*%$/);
  if (m) return +m[1] / 100;
  return +s;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tcgUrl = (id) => `https://www.tcgplayer.com/product/${id}`;
const perDisplay = (p) => 1 - Math.pow(1 - p, PACKS_PER_DISPLAY);

// ---------- data ----------
async function loadIndex() {
  const res = await fetch("data/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load data/index.json");
  return res.json();
}
async function loadSet(entry) {
  if (!cache.has(entry.file)) {
    const res = await fetch("data/" + entry.file, { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load " + entry.file);
    cache.set(entry.file, await res.json());
  }
  return cache.get(entry.file);
}

function profileFor(abbr) { return PROFILES[abbr] || FALLBACK_PROFILE; }
function defaultRates(p) { return Object.fromEntries(Object.entries(p.rates).map(([k, v]) => [k, v.v])); }

async function selectSet(abbr) {
  const entry = state.index.sets.find((s) => s.abbr === abbr) || state.index.sets[0];
  state.abbr = entry.abbr;
  state.set = await loadSet(entry);
  state.profile = profileFor(entry.abbr);
  const saved = store.get("rbev:set:" + entry.abbr);
  state.rates = { ...defaultRates(state.profile), ...(saved?.rates || {}) };
  state.foil = { ...state.profile.foil, ...(saved?.foil || {}) };
  $("setSelect").value = entry.abbr;
  if (location.hash.slice(1) !== entry.abbr) history.replaceState(null, "", "#" + entry.abbr);
  renderForms();
  recompute();
}

function saveSetOverrides() {
  store.set("rbev:set:" + state.abbr, { rates: state.rates, foil: state.foil });
}

// ---------- forms ----------
function renderForms() {
  const pools = buildModel(state.set, state.rates, state.foil, opts()).pools;
  $("rateForm").innerHTML = RATE_KEYS.map((k) => {
    const meta = state.profile.rates[k] || {};
    const n = (pools[k] || []).length;
    return `<div class="rate${n ? "" : " disabled"}">
      <div class="name">${CATEGORY_META[k].label} <span class="muted num" style="font-weight:400">· ${n} card${n === 1 ? "" : "s"}</span>
        ${meta.src ? `<span class="tag ${meta.src}">${meta.src}</span>` : ""}</div>
      <input type="text" inputmode="decimal" data-rate="${k}" value="${rateText(state.rates[k])}" ${n ? "" : "disabled"} aria-label="${CATEGORY_META[k].label} rate per pack" />
      <div class="note">${esc(meta.note || "")}${n ? "" : " Not in this set."}</div>
    </div>`;
  }).join("");

  $("foilForm").innerHTML = ["common", "uncommon", "rare", "epic"].map((k) =>
    `<label>${CATEGORY_META[k].label}<span class="suffix"><input type="number" min="0" max="100" step="0.5" data-foil="${k}" value="${+(state.foil[k] * 100).toFixed(2)}" /> %</span></label>`
  ).join("");

  const p = state.pricing;
  $("priceField").value = p.priceField;
  $("sellThrough").value = p.sellThrough;
  $("bulkThreshold").value = p.bulkThreshold;
  $("bulkValue").value = p.bulkValue;
}

function opts() {
  const p = state.pricing;
  return { priceField: p.priceField, sellThrough: p.sellThrough / 100, bulkThreshold: +p.bulkThreshold || 0, bulkValue: +p.bulkValue || 0 };
}

// ---------- render ----------
let simTimer = null;
function recompute() {
  const set = state.set;
  const model = buildModel(set, state.rates, state.foil, opts());
  const packPrice = set.sealed.pack?.[state.pricing.priceField] ?? set.sealed.pack?.market;
  const displayPrice = set.sealed.display?.[state.pricing.priceField] ?? set.sealed.display?.market;

  // Warnings
  const warn = [];
  if (state.profile.unknown) warn.push(`<b>${esc(set.name)}</b> has no pull-rate profile yet, so generic rates are in use. Set them under Assumptions.`);
  if (model.hitSum + model.rates.epic > 2) warn.push("Hit + Epic rates add up to more than the 2 Rare-or-better slots, so the result is not physically possible.");
  if (model.missing.length) warn.push(`${model.missing.length} chase card(s) have no TCGplayer price and count as $0: ${model.missing.slice(0, 5).map((c) => esc(c.name)).join(", ")}${model.missing.length > 5 ? "…" : ""}`);
  $("warn").hidden = !warn.length;
  $("warn").innerHTML = warn.join("<br>");

  renderKpis(model, packPrice, displayPrice, null);
  renderUltimate(model);
  renderBreakdown(model);
  renderTopCards(model);

  $("sim").innerHTML = `<p class="muted">Simulating…</p>`;
  clearTimeout(simTimer);
  simTimer = setTimeout(() => {
    const sim = simulate(model, { boxes: 20000, packsPerBox: PACKS_PER_DISPLAY });
    renderSim(model, sim, displayPrice);
    renderKpis(model, packPrice, displayPrice, sim);
  }, 30);
}

function delta(ev, price) {
  if (!price) return `<span class="muted">no sealed price listed</span>`;
  const d = ev / price - 1;
  if (Math.abs(d) < 0.005) return `vs ${usd(price)} · <span class="muted">break-even</span>`;
  return `vs ${usd(price)} · <span class="${d >= 0 ? "pos" : "neg"}">${d >= 0 ? "+" : "−"}${pct(Math.abs(d), 0)}</span>`;
}

function renderKpis(model, packPrice, displayPrice, sim) {
  const ev = model.total;
  const box = ev * PACKS_PER_DISPLAY;
  $("kpis").innerHTML = `
    <div class="kpi"><div class="label">EV per pack</div><div class="value">${usd(ev)}</div><div class="meta">${delta(ev, packPrice)}</div></div>
    <div class="kpi"><div class="label">EV per display</div><div class="value">${usd(box, 0)}</div><div class="meta">${delta(box, displayPrice)}</div></div>
    <div class="kpi"><div class="label">Median display</div><div class="value">${sim ? usd(sim.pct.p50, 0) : "…"}</div><div class="meta">typical box, not the average</div></div>
    <div class="kpi"><div class="label">Display beats price</div><div class="value">${sim && displayPrice ? pct(sim.probAtLeast(displayPrice), 0) : "…"}</div><div class="meta">${displayPrice ? `chance a box is worth ≥ ${usd(displayPrice, 0)}` : "no display price listed"}</div></div>`;
}

function renderUltimate(model) {
  const ult = model.pools.ultimate || [];
  const el = $("ultimatePanel");
  if (!ult.length) { el.hidden = true; return; }
  el.hidden = false;
  const u = ult[0];
  const p = model.rates.ultimate;
  const evPack = p * (ult.reduce((s, x) => s + x.value, 0) / ult.length);
  const naive = naiveUltimate(model);
  const meta = state.profile.rates.ultimate || {};
  let compare = "";
  if (naive && p > 0) {
    const r = naive.ratio;
    compare = `<div class="compare"><b>Why other calculators differ:</b> putting the Ultimate in the Overnumbered pool (${(model.pools.overnumbered || []).length} cards + ${ult.length}) and splitting that rate evenly gives ${oneIn(naive.naivePerCard)} packs and ${usd(naive.naiveEV, 3)}/pack, `
      + (r > 1.05 ? `<b>${r.toFixed(1)}× too high</b>.` : r < 0.95 ? `${(1 / r).toFixed(1)}× too low.` : `which happens to land close for this set.`)
      + ` This calculator uses Riot's own per-pack rate for the Ultimate instead.</div>`;
  }
  el.innerHTML = `<h2>Ultimate rare</h2>
    <div class="ult">
      ${u.card.img ? `<a href="${tcgUrl(u.card.id)}" target="_blank" rel="noopener"><img src="${esc(u.card.img)}" alt="${esc(u.card.name)}" loading="lazy" /></a>` : ""}
      <div>
        <div><b>${esc(u.card.name)}</b> <span class="muted">${esc(u.card.num)}</span> <span class="tag ${meta.src || "assumed"}">${meta.src || "assumed"}</span></div>
        <div class="facts">
          <div><b>${usd(u.value, 0)}</b><span>price used</span></div>
          <div><b>${oneIn(p)}</b><span>packs</span></div>
          <div><b>${pct(perDisplay(p), 2)}</b><span>chance per display</span></div>
          <div><b>${p > 0 ? Math.round(1 / (p * PACKS_PER_DISPLAY)).toLocaleString("en-US") : "—"}</b><span>displays per pull, on average</span></div>
          <div><b>${usd(evPack, 3)}</b><span>EV per pack</span></div>
          <div><b>${model.total ? pct(evPack / model.total, 1) : "—"}</b><span>share of pack EV</span></div>
        </div>
        <p class="fine" style="margin:0 0 10px">${esc(meta.note || "")}</p>
        ${compare}
      </div>
    </div>`;
}

function renderBreakdown(model) {
  const rows = model.lines.filter((l) => l.n !== 0 || l.cat === "foil");
  const max = Math.max(...rows.map((l) => l.ev), 1e-9);
  $("breakdown").innerHTML = `
    <thead><tr><th>Category</th><th class="r">Per pack</th><th class="r">Avg price</th><th class="r">EV / pack</th><th class="r">Share</th></tr></thead>
    <tbody>${rows.map((l) => `<tr>
      <td>${CATEGORY_META[l.cat].label}${l.n ? ` <span class="muted">(${l.n})</span>` : ""}</td>
      <td class="r">${l.count >= 0.1 ? +l.count.toFixed(2) : oneIn(l.count)}</td>
      <td class="r">${usd(l.avg)}</td>
      <td class="r">${usd(l.ev, l.ev < 0.1 ? 3 : 2)}</td>
      <td class="r"><span class="share"><span class="num">${pct(model.total ? l.ev / model.total : 0, 0)}</span><i style="width:${Math.max(2, (l.ev / max) * 60)}px"></i></span></td>
    </tr>`).join("")}</tbody>
    <tfoot><tr><td>Total</td><td class="r">14 cards</td><td></td><td class="r">${usd(model.total)}</td><td></td></tr></tfoot>`;
}

function renderTopCards(model) {
  const top = model.perCard.slice(0, 20);
  $("topCards").innerHTML = `
    <thead><tr><th>Card</th><th>Type</th><th class="r">Price</th><th class="r">Odds / pack</th><th class="r">Chance / display</th><th class="r">EV / pack</th></tr></thead>
    <tbody>${top.map((x) => `<tr>
      <td><div class="card-cell">${x.card.img ? `<img src="${esc(x.card.img)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />` : ""}<a href="${tcgUrl(x.card.id)}" target="_blank" rel="noopener">${esc(x.card.name)}</a></div></td>
      <td class="muted">${CATEGORY_META[x.cat].label}</td>
      <td class="r">${usd(x.price, x.price >= 100 ? 0 : 2)}</td>
      <td class="r">${oneIn(x.perPack)}</td>
      <td class="r">${pct(perDisplay(x.perPack), x.perPack * 24 < 0.01 ? 2 : 1)}</td>
      <td class="r">${usd(x.ev, 3)}</td>
    </tr>`).join("")}</tbody>`;
}

function renderSim(model, sim, displayPrice) {
  // Cap the x-axis so the long tail doesn't squash the body; the last bin collects everything above.
  const hi = Math.max(sim.pct.p90 * 1.5, (displayPrice || 0) * 1.5, 1);
  const bins = 40;
  const counts = new Array(bins).fill(0);
  for (const v of sim.sorted) counts[Math.min(bins - 1, Math.floor((v / hi) * bins))]++;
  const max = Math.max(...counts);
  const hitRows = [
    ["overnumbered", "Overnumbered"], ["signature", "Signature"], ["ultimate", "Ultimate"],
  ].filter(([k]) => model.rates[k] > 0);
  $("sim").innerHTML = `
    <div class="pctl">
      <div><b>${usd(sim.pct.p10, 0)}</b><span>bad box (10th pct)</span></div>
      <div><b>${usd(sim.pct.p50, 0)}</b><span>median</span></div>
      <div><b>${usd(sim.pct.p90, 0)}</b><span>great box (90th pct)</span></div>
    </div>
    <div class="hist" role="img" aria-label="Distribution of simulated display values">
      ${counts.map((c, i) => `<i class="${displayPrice && ((i + 0.5) / bins) * hi >= displayPrice ? "over" : ""}" style="height:${(c / max) * 100}%" title="${usd((i / bins) * hi, 0)}–${usd(((i + 1) / bins) * hi, 0)}: ${pct(c / sim.boxes)}"></i>`).join("")}
    </div>
    <div class="hist-axis"><span>$0</span><span>${usd(hi / 2, 0)}</span><span>${usd(hi, 0)}+</span></div>
    <div class="legend">${displayPrice ? `<span><i style="background:var(--bar)"></i>worth ≥ display price (${usd(displayPrice, 0)})</span><span><i style="background:var(--bar-2)"></i>below</span>` : ""}</div>
    <table class="tbl" style="margin-top:10px">
      <tbody>${hitRows.map(([k, label]) => `<tr><td>Boxes with ≥1 ${label}</td><td class="r">${pct(sim.hitBoxShare[k], sim.hitBoxShare[k] < 0.1 ? 2 : 0)}</td></tr>`).join("")}</tbody>
    </table>`;
}

// ---------- events ----------
function bind() {
  $("setSelect").addEventListener("change", (e) => selectSet(e.target.value));
  window.addEventListener("hashchange", () => {
    const a = location.hash.slice(1);
    if (a && a !== state.abbr) selectSet(a);
  });

  $("rateForm").addEventListener("change", (e) => {
    const k = e.target.dataset.rate;
    if (!k) return;
    const v = parseRate(e.target.value);
    if (!Number.isFinite(v) || v < 0 || v > 2) { e.target.value = rateText(state.rates[k]); return; }
    state.rates[k] = v;
    e.target.value = rateText(v);
    saveSetOverrides();
    recompute();
  });
  $("foilForm").addEventListener("input", (e) => {
    const k = e.target.dataset.foil;
    if (!k) return;
    state.foil[k] = Math.max(0, +e.target.value || 0) / 100;
    saveSetOverrides();
    recompute();
  });
  for (const id of ["priceField", "sellThrough", "bulkThreshold", "bulkValue"]) {
    $(id).addEventListener(id === "priceField" ? "change" : "input", (e) => {
      state.pricing[id] = id === "priceField" ? e.target.value : Math.max(0, +e.target.value || 0);
      store.set("rbev:pricing", state.pricing);
      recompute();
    });
  }
  $("resetBtn").addEventListener("click", () => {
    store.del("rbev:set:" + state.abbr);
    store.del("rbev:pricing");
    state.pricing = { ...PRICING_DEFAULTS };
    selectSet(state.abbr);
  });
}

async function main() {
  try {
    state.index = await loadIndex();
  } catch (err) {
    $("priceStamp").textContent = "Couldn't load price data. Run scripts/fetch-prices.mjs or check the GitHub Action.";
    return;
  }
  state.pricing = { ...PRICING_DEFAULTS, ...(store.get("rbev:pricing") || {}) };
  // Only sets with cards listed (upcoming sets may have none yet).
  state.index.sets = state.index.sets.filter((s) => s.cardCount > 20);
  $("setSelect").innerHTML = state.index.sets.map((s) => `<option value="${esc(s.abbr)}">${esc(s.name)} (${esc(s.abbr)})</option>`).join("");
  const when = new Date(state.index.fetchedAt);
  $("priceStamp").innerHTML = `TCGplayer prices via tcgcsv.com · updated ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
  bind();
  await selectSet(location.hash.slice(1) || state.index.sets[0].abbr);
}

main();
