#!/usr/bin/env node
// Prints the EV breakdown for every set in ./data using default rates.
// Handy for sanity-checking after a price refresh: node scripts/check-ev.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, simulate, naiveUltimate, classify } from "../ev.js";
import { PROFILES } from "../rates.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const idx = JSON.parse(readFileSync(join(root, "data/index.json")));
for (const s of idx.sets) {
  const set = JSON.parse(readFileSync(join(root, "data", s.file)));
  const prof = PROFILES[s.abbr];
  if (!prof || !set.cards.length) { console.log(`\n${s.abbr}: skipped (no profile or no cards)`); continue; }
  const rates = Object.fromEntries(Object.entries(prof.rates).map(([k, v]) => [k, v.v]));
  // Same defaults as the site: cards under $1 count as $0.
  const m = buildModel(set, rates, prof.foil, { priceField: "market", sellThrough: 1, bulkThreshold: 1, bulkValue: 0 });
  const sim = simulate(m, { boxes: 20000 });
  console.log(
    `\n${s.abbr} EV/pack $${m.total.toFixed(2)} (pack $${set.sealed.pack?.market}) | box EV $${(m.total * 24).toFixed(0)}, ` +
      `sim mean $${sim.mean.toFixed(0)}, median $${sim.pct.p50.toFixed(0)} (display $${set.sealed.display?.market}) | unpriced hits: ${m.missing.length}`
  );
  for (const l of m.lines)
    console.log(`  ${l.cat.padEnd(13)} n=${String(l.n).padEnd(4)} count=${l.count.toFixed(4)} avg=$${l.avg.toFixed(2)} ev=$${l.ev.toFixed(3)}`);
  const n = naiveUltimate(m);
  if (n) console.log(`  ultimate: correct ev $${n.correctEV.toFixed(3)}, naive pooled ev $${n.naiveEV.toFixed(3)} (${n.ratio.toFixed(2)}x)`);
  const counts = {};
  for (const c of set.cards) counts[classify(c)] = (counts[classify(c)] || 0) + 1;
  console.log("  categories:", JSON.stringify(counts));
}
