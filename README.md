# Riftbound Pack EV

A static expected-value calculator for Riftbound booster packs and displays. It
uses TCGplayer prices from [tcgcsv.com](https://tcgcsv.com) and runs on GitHub Pages.

## What it does differently

- **Ultimates get their own per-pack rate.** Riot publishes each Ultimate's odds
  directly: Unleashed's Baron Nashor in "< 0.1% of packs", Radiance's Packed
  Amphitheater in ~0.025% (1 in 4,000). Many calculators put the Ultimate in the
  Overnumbered/Showcase pool and split one rate across every card. For Radiance
  that nearly triples its value. The page shows that comparison live.
- **Hits replace Rares.** Epics and showcase cards take one of the two
  Rare-or-better slots. They are not added on top of the 14 cards.
- **Median vs mean.** A 20,000-display Monte Carlo shows what a *typical* box is
  worth and the chance a box beats its sealed price, not just EV.
- Every rate is editable and labelled *official* / *community* / *assumed*.
  Overrides are saved per browser.

## Run locally

```bash
node scripts/fetch-prices.mjs   # snapshot prices into data/
python3 -m http.server 8000     # then open http://localhost:8000
```

`node scripts/check-ev.mjs` prints the EV breakdown for every set in the terminal.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo on the `main` branch.
2. **Settings → Pages → Source: GitHub Actions.**
3. The workflow in `.github/workflows/deploy.yml` runs on every push and daily at
   21:30 UTC. It refreshes `data/` from tcgcsv.com, commits the change and deploys.
   You can also run it by hand from the Actions tab.

tcgcsv.com doesn't send CORS headers, so the browser can't fetch prices live.
That's why prices are snapshotted by the Action instead.

## Files

| File | Purpose |
| --- | --- |
| `rates.js` | Pull-rate defaults per set, with sources. Add new sets here. |
| `ev.js` | Pure EV engine: card classification, slot model, simulation |
| `app.js` | UI |
| `scripts/fetch-prices.mjs` | tcgcsv.com → `data/*.json` |

## Adding a new set

New sets appear automatically once TCGplayer lists cards for them. They use a
generic fallback profile and show a warning. Add an entry keyed by the set
abbreviation to `PROFILES` in `rates.js`. If the set has an Ultimate, set
`ultimate` to Riot's published per-pack rate.

Not affiliated with Riot Games or TCGplayer.
