#!/usr/bin/env node
// Snapshots Riftbound product + price data from tcgcsv.com into ./data.
// tcgcsv.com does not send CORS headers, so a static GitHub Pages site cannot
// call it from the browser. This script runs in GitHub Actions (or locally)
// and writes compact JSON files that the static page loads.
//
// Usage: node scripts/fetch-prices.mjs
// Requires Node 18+ (global fetch). No dependencies.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://tcgcsv.com/tcgplayer";
const UA = "riftbound-ev-calc (static site price snapshot)";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data");

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      if (body.success === false) throw new Error(`tcgcsv error: ${JSON.stringify(body.errors)}`);
      return body;
    } catch (err) {
      if (attempt === 3) throw new Error(`GET ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function ext(product) {
  const out = {};
  for (const e of product.extendedData || []) out[e.name] = e.value;
  return out;
}

const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

function priceTriple(p) {
  return { market: round(p.marketPrice), low: round(p.lowPrice), mid: round(p.midPrice) };
}

async function main() {
  const cats = await getJSON(`${BASE}/categories`);
  const cat = cats.results.find((c) => /riftbound/i.test(c.name));
  if (!cat) throw new Error("Riftbound category not found on tcgcsv");
  const categoryId = cat.categoryId;

  const groups = (await getJSON(`${BASE}/${categoryId}/groups`)).results;
  await mkdir(OUT, { recursive: true });

  const index = [];
  for (const g of groups) {
    const [products, prices] = await Promise.all([
      getJSON(`${BASE}/${categoryId}/${g.groupId}/products`),
      getJSON(`${BASE}/${categoryId}/${g.groupId}/prices`),
    ]);

    // Only sets that are sold as booster packs are relevant for pack EV.
    const packProduct = products.results.find((p) => /- Booster Pack$/i.test(p.name));
    if (!packProduct) continue;

    const priceMap = new Map();
    for (const p of prices.results) {
      if (!priceMap.has(p.productId)) priceMap.set(p.productId, {});
      priceMap.get(p.productId)[p.subTypeName] = priceTriple(p);
    }

    const sealed = {};
    const cards = [];
    for (const p of products.results) {
      const e = ext(p);
      const pr = priceMap.get(p.productId) || {};
      if (!e.Rarity && !e.Number) {
        // Sealed product
        const n = p.name;
        const key = /- Booster Pack$/i.test(n)
          ? "pack"
          : /- Booster Display$/i.test(n)
          ? "display"
          : /- Booster Display Case$/i.test(n)
          ? "case"
          : null;
        if (key) sealed[key] = { id: p.productId, name: n, ...(pr.Normal || {}) };
        continue;
      }
      cards.push({
        id: p.productId,
        name: p.name,
        num: e.Number || "",
        rarity: e.Rarity || "None",
        type: e["Card Type"] || "",
        img: p.imageUrl || "",
        normal: pr.Normal || null,
        foil: pr.Foil || null,
      });
    }

    const file = `set-${g.groupId}.json`;
    const payload = {
      groupId: g.groupId,
      name: g.name,
      abbr: g.abbreviation,
      publishedOn: g.publishedOn,
      fetchedAt: new Date().toISOString(),
      sealed,
      cards,
    };
    await writeFile(join(OUT, file), JSON.stringify(payload));
    index.push({ groupId: g.groupId, name: g.name, abbr: g.abbreviation, publishedOn: g.publishedOn, file, cardCount: cards.length });
    console.log(`${g.abbreviation.padEnd(6)} ${g.name}: ${cards.length} cards`);
  }

  index.sort((a, b) => b.publishedOn.localeCompare(a.publishedOn));
  await writeFile(
    join(OUT, "index.json"),
    JSON.stringify({ categoryId, fetchedAt: new Date().toISOString(), source: "https://tcgcsv.com", sets: index }, null, 1)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
