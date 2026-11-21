// Pure EV engine: no DOM. Works in the browser and in Node (for tests).

export const HIT_CATS = ["ultimate", "signature", "overnumbered", "specialArt", "altArt"];

// Map a card from the price snapshot to a pull category.
export function classify(c) {
  const n = c.name || "";
  const t = c.type || "";
  if (c.rarity === "Promo") return "excluded"; // promo-only printings, not in packs
  if (/\(Ultimate\)/i.test(n)) return "ultimate";
  if (/Signature\)/i.test(n)) return "signature"; // "(Signature)", "(Heartsteel Signature)"
  if (/Overnumbered\)/i.test(n)) return "overnumbered"; // incl. "(Heartsteel Overnumbered)"
  if (/^SP\d/i.test(c.num || "") || /Special Art/i.test(n)) return "specialArt";
  if (c.rarity === "Showcase" && (/Rune/.test(t) || /\bRune\b/.test(n))) return "altRune";
  if (c.rarity === "Showcase") return "altArt";
  if (/Token/i.test(t) || c.rarity === "None") return "token";
  if (/Rune/.test(t)) {
    // Base runes are numbered "R01" or "007/298". Lettered variants (R01b, R01c) that are not
    // Showcase are promo printings, sometimes mislabelled "Common" on TCGplayer.
    return /^(R\d+|\d+\/\d+)$/i.test(c.num || "") ? "rune" : "excluded";
  }
  switch (c.rarity) {
    case "Common": return "common";
    case "Uncommon": return "uncommon";
    case "Rare": return "rare";
    case "Epic": return "epic";
    default: return "excluded";
  }
}

// Price for one card in one finish, with fallback to the other finish.
// Rares/Epics/Showcase are foil-only on TCGplayer, so "normal" falls back to foil.
export function cardPrice(card, finish, opts) {
  const field = opts.priceField || "market";
  const pick = (f) => {
    const p = card[f];
    if (!p) return null;
    return p[field] ?? p.market ?? p.mid ?? p.low ?? null;
  };
  let v = pick(finish);
  if (v == null) v = pick(finish === "foil" ? "normal" : "foil");
  if (v == null) return { value: 0, missing: true };
  if (opts.bulkThreshold > 0 && v < opts.bulkThreshold) v = opts.bulkValue || 0;
  return { value: v * (opts.sellThrough ?? 1), missing: false };
}

const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x.value, 0) / arr.length : 0);

// rates: { epic, altArt, overnumbered, signature, specialArt, ultimate, altRune } (expected count / pack)
// foil:  { common, uncommon, rare, epic } (probabilities, normalised here)
export function buildModel(set, rates, foil, opts) {
  const pools = {};
  const missing = [];
  for (const card of set.cards) {
    const cat = classify(card);
    if (cat === "excluded") continue;
    const finish = ["common", "uncommon", "rune", "token"].includes(cat) ? "normal" : "foil";
    const p = cardPrice(card, finish, opts);
    if (p.missing && HIT_CATS.includes(cat)) missing.push(card);
    (pools[cat] ||= []).push({ card, value: p.value, foilValue: finish === "normal" ? cardPrice(card, "foil", opts).value : p.value });
  }
  const pool = (k) => pools[k] || [];
  // Last slot: runes and tokens share it.
  const baseLast = [...pool("rune"), ...pool("token")];

  // A category with no cards in the set cannot be pulled.
  const r = {};
  for (const k of ["epic", ...HIT_CATS, "altRune"]) r[k] = pool(k).length ? Math.max(0, rates[k] || 0) : 0;
  const hitSum = HIT_CATS.reduce((s, k) => s + r[k], 0);
  // Two Rare-or-better slots. Hits and Epics replace Rares, they are not extra cards.
  const rareCount = Math.max(0, 2 - hitSum - r.epic);

  const fTotal = Object.values(foil).reduce((s, x) => s + Math.max(0, x), 0) || 1;
  const f = Object.fromEntries(Object.entries(foil).map(([k, v]) => [k, Math.max(0, v) / fTotal]));
  const foilAvg = (k) => (pool(k).length ? pool(k).reduce((s, x) => s + x.foilValue, 0) / pool(k).length : 0);

  const lines = [
    { cat: "common", count: 7, avg: avg(pool("common")), n: pool("common").length },
    { cat: "uncommon", count: 3, avg: avg(pool("uncommon")), n: pool("uncommon").length },
    { cat: "rare", count: rareCount, avg: avg(pool("rare")), n: pool("rare").length },
    { cat: "epic", count: r.epic, avg: avg(pool("epic")), n: pool("epic").length },
    ...HIT_CATS.slice().reverse().map((k) => ({ cat: k, count: r[k], avg: avg(pool(k)), n: pool(k).length })),
    {
      cat: "foil",
      count: 1,
      avg: ["common", "uncommon", "rare", "epic"].reduce((s, k) => s + (f[k] || 0) * foilAvg(k), 0),
      n: null,
    },
    { cat: "rune", count: 1 - r.altRune, avg: avg(baseLast), n: baseLast.length },
    { cat: "altRune", count: r.altRune, avg: avg(pool("altRune")), n: pool("altRune").length },
  ];
  for (const l of lines) l.ev = l.count * l.avg;
  const total = lines.reduce((s, l) => s + l.ev, 0);

  // Per-card contribution, for the "what drives EV" list.
  const perCard = [];
  const addCards = (k, countPerPack, valueKey = "value") => {
    const list = pool(k);
    if (!list.length || !countPerPack) return;
    const each = countPerPack / list.length;
    for (const x of list) perCard.push({ card: x.card, cat: k, price: x[valueKey], perPack: each, ev: each * x[valueKey] });
  };
  for (const k of [...HIT_CATS, "altRune"]) addCards(k, r[k]);
  addCards("epic", r.epic);
  addCards("rare", rareCount);
  perCard.sort((a, b) => b.ev - a.ev);

  return { pools, rates: r, foil: f, rareCount, hitSum, lines, total, perCard, missing, baseLast };
}

// The mistake many calculators make: no separate Ultimate rate. They put the Ultimate in a
// showcase pool and split one rate evenly across every card in it.
export function naiveUltimate(model) {
  const ult = model.pools.ultimate || [];
  if (!ult.length) return null;
  const on = (model.pools.overnumbered || []).length;
  const pooledRate = model.rates.overnumbered + model.rates.ultimate;
  const naivePerCard = pooledRate / (on + ult.length);
  const correctPerCard = model.rates.ultimate / ult.length;
  const price = avg(ult);
  return {
    naivePerCard,
    correctPerCard,
    naiveEV: naivePerCard * price * ult.length,
    correctEV: correctPerCard * price * ult.length,
    ratio: correctPerCard ? naivePerCard / correctPerCard : Infinity,
  };
}

// Monte Carlo box openings, using the same slot model as buildModel.
export function simulate(model, { boxes = 20000, packsPerBox = 24, rng = Math.random } = {}) {
  const vals = (k) => (model.pools[k] || []).map((x) => x.value);
  const fvals = (k) => (model.pools[k] || []).map((x) => x.foilValue);
  const C = vals("common"), U = vals("uncommon"), R = vals("rare"), E = vals("epic");
  const FC = fvals("common"), FU = fvals("uncommon"), FR = fvals("rare"), FE = fvals("epic");
  const LAST = model.baseLast.map((x) => x.value), AR = vals("altRune");
  const r = model.rates;
  const pick = (a) => (a.length ? a[(rng() * a.length) | 0] : 0);

  // Slot B order of checks: hit categories first, then Epic, then Rare.
  const hitCats = HIT_CATS.map((k) => ({ k, p: r[k], v: vals(k) })).filter((h) => h.p > 0 && h.v.length);
  const S = model.hitSum;
  const epicA = Math.min(1, r.epic / 2);
  // P(Epic in slot B | no hit) chosen so the expected Epic count matches r.epic.
  const epicB = S < 1 ? Math.min(1, (r.epic - epicA) / (1 - S)) : 0;
  const foilCum = [];
  let acc = 0;
  for (const [k, arr] of [["common", FC], ["uncommon", FU], ["rare", FR], ["epic", FE]]) {
    acc += model.foil[k] || 0;
    foilCum.push([acc, arr]);
  }

  const totals = new Float64Array(boxes);
  const hitBoxes = Object.fromEntries(HIT_CATS.map((k) => [k, 0]));
  for (let b = 0; b < boxes; b++) {
    let sum = 0;
    const got = {};
    for (let p = 0; p < packsPerBox; p++) {
      for (let i = 0; i < 7; i++) sum += pick(C);
      for (let i = 0; i < 3; i++) sum += pick(U);
      // Foil slot
      const fr = rng();
      for (const [c, arr] of foilCum) if (fr < c) { sum += pick(arr); break; }
      // Slot A: Rare or Epic
      sum += rng() < epicA ? pick(E) : pick(R);
      // Slot B: hit / Epic / Rare. At most one Ultimate per pack by construction.
      let u = rng(), hit = false;
      for (const h of hitCats) {
        if (u < h.p) { sum += pick(h.v); got[h.k] = true; hit = true; break; }
        u -= h.p;
      }
      if (!hit) sum += rng() < epicB ? pick(E) : pick(R);
      // Last slot
      sum += AR.length && rng() < r.altRune ? pick(AR) : pick(LAST);
    }
    totals[b] = sum;
    for (const k in got) hitBoxes[k]++;
  }
  const sorted = Array.from(totals).sort((a, b) => a - b);
  const q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))];
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    boxes,
    mean,
    pct: { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p99: q(0.99) },
    sorted,
    hitBoxShare: Object.fromEntries(Object.entries(hitBoxes).map(([k, v]) => [k, v / boxes])),
    probAtLeast: (x) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
      return (sorted.length - lo) / sorted.length;
    },
  };
}
