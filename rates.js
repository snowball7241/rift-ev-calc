// Pull-rate profiles per set, keyed by TCGplayer set abbreviation.
//
// Every number is an EXPECTED COUNT PER PACK for that category (for rare hits
// this is the same as "chance a pack contains one"). They are all editable in
// the UI; these are only the defaults.
//
// Pack: 14 cards = 7 Common + 3 Uncommon + 2 "Rare or better" + 1 Foil + 1 Rune/Token.
// Showcase hits (Alt Art, Special Art, Overnumbered, Signature, Ultimate) and
// Epics REPLACE a Rare in one of the two Rare-or-better slots. They are never
// extra cards on top of the 14.
//
// ULTIMATES ARE MODELLED SEPARATELY. Riot gives each Ultimate its own per-pack
// rate. It is NOT a share of the Overnumbered/Showcase rate. Many calculators
// put the Ultimate in the showcase pool and split the pool rate evenly across
// every card in it, which can overvalue it several times over (see the
// "naive" comparison in the UI).
//
// src: "official" = Riot published figure, "community" = opening samples,
// "assumed" = no data, a placeholder you should sanity-check.

export const PACKS_PER_DISPLAY = 24;

const FOIL_DEFAULT = { common: 0.65, uncommon: 0.25, rare: 0.08, epic: 0.02 };

export const PROFILES = {
  OGN: {
    label: "Origins",
    rates: {
      epic: { v: 1 / 4, src: "official", note: "Riot: about 1 in 4 packs." },
      altArt: { v: 1 / 12, src: "official", note: "Riot: about 2 per 24-pack display." },
      overnumbered: { v: (1 / 72) * 0.9, src: "official", note: "Riot: about 1 per 3 displays (1/72 packs), less the ~1 in 10 that are signed." },
      signature: { v: 1 / 720, src: "official", note: "Riot: about 1 in 10 Overnumbered cards is signed, so 1/720 packs." },
      specialArt: { v: 0, src: "official", note: "None in this set." },
      ultimate: { v: 0, src: "official", note: "Origins has no Ultimate." },
      altRune: { v: 1 / 48, src: "assumed", note: "Riot only says 'very rarely'. No figure published." },
    },
    foil: { ...FOIL_DEFAULT },
  },
  SFD: {
    label: "Spiritforged",
    rates: {
      epic: { v: 0.25, src: "community", note: "12 Epics in 48 packs." },
      altArt: { v: 1 / 10, src: "community", note: "About 2-3 per display in early openings." },
      overnumbered: { v: 1 / 48, src: "community", note: "2 in 72 packs (small sample). Rounded toward the Origins rate." },
      signature: { v: 1 / 720, src: "assumed", note: "No Riot rate. Origins ratio assumed. Only 12 of 30 Overnumbered cards have signed versions." },
      specialArt: { v: 0, src: "official", note: "None in this set." },
      ultimate: { v: 0, src: "official", note: "Spiritforged has no Ultimate." },
      altRune: { v: 1 / 48, src: "assumed", note: "No published rate." },
    },
    foil: { ...FOIL_DEFAULT },
  },
  UNL: {
    label: "Unleashed",
    rates: {
      epic: { v: 0.27, src: "community", note: "About 27% of packs (6-8 per display)." },
      altArt: { v: 0.1, src: "community", note: "About 10% of packs (2-4 per display)." },
      overnumbered: { v: 0.017, src: "community", note: "About 1.7% of packs (~0.4 per display)." },
      signature: { v: 1 / 720, src: "assumed", note: "No Riot rate. Origins ratio assumed. 0 seen in 168 packs." },
      specialArt: { v: 0, src: "official", note: "None in this set." },
      ultimate: {
        v: 0.001,
        src: "official",
        note: "Riot: Baron Nashor in '< 0.1% of packs'. That is an UPPER bound (at most 1 in 1,000), so EV from it is a ceiling.",
      },
      altRune: { v: 1 / 36, src: "assumed", note: "No published rate." },
    },
    foil: { ...FOIL_DEFAULT },
  },
  VEN: {
    label: "Vendetta",
    rates: {
      epic: { v: 0.27, src: "community", note: "About 27% of packs." },
      altArt: { v: 0.09, src: "community", note: "About 9% of packs (2-3 per display)." },
      overnumbered: { v: 0.02, src: "community", note: "2 in 90 packs (small sample)." },
      signature: { v: 1 / 720, src: "assumed", note: "No Riot rate. Only the 9 Legend overnumbers have signed versions." },
      specialArt: { v: 0.03, src: "community", note: "Crystal Rose SP cards. About as common per card as an alt art. 2-3 in 3 displays." },
      ultimate: { v: 0, src: "official", note: "Vendetta has no Ultimate." },
      altRune: { v: 1 / 36, src: "assumed", note: "No published rate." },
    },
    foil: { ...FOIL_DEFAULT },
  },
  RAD: {
    label: "Radiance",
    rates: {
      epic: { v: 0.27, src: "community", note: "About 27% of packs." },
      altArt: { v: 0.07, src: "community", note: "Alt + special art about 9% of packs combined." },
      overnumbered: { v: 0.012, src: "community", note: "4 in 330 packs (~1.2%). Includes Heartsteel overnumbers." },
      signature: { v: 1 / 720, src: "assumed", note: "No Riot rate. 0 seen in 330 packs." },
      specialArt: { v: 0.02, src: "official", note: "Riot: K/DA special arts appear 'at roughly the same frequency as Alt Art cards' (per card)." },
      ultimate: {
        v: 0.00025,
        src: "official",
        note: "Riot: Packed Amphitheater in about 0.025% of packs (1 in 4,000, ~1 in 167 displays). Not guaranteed per case.",
      },
      altRune: { v: 6 / 168, src: "community", note: "6 alt runes in 168 packs." },
    },
    foil: { ...FOIL_DEFAULT },
  },
};

// Used for sets with no profile yet (e.g. a newly listed set).
export const FALLBACK_PROFILE = {
  label: "Unknown set",
  unknown: true,
  rates: {
    epic: { v: 0.25, src: "assumed", note: "No profile for this set. Generic default." },
    altArt: { v: 1 / 12, src: "assumed", note: "Generic default." },
    overnumbered: { v: 1 / 72, src: "assumed", note: "Generic default." },
    signature: { v: 1 / 720, src: "assumed", note: "Generic default." },
    specialArt: { v: 0, src: "assumed", note: "Set this if the set has special-art cards." },
    ultimate: { v: 0, src: "assumed", note: "Set this from Riot's published rate if the set has an Ultimate." },
    altRune: { v: 1 / 48, src: "assumed", note: "Generic default." },
  },
  foil: { ...FOIL_DEFAULT },
};

export const CATEGORY_META = {
  common: { label: "Common", slot: "7 Common slots" },
  uncommon: { label: "Uncommon", slot: "3 Uncommon slots" },
  rare: { label: "Rare", slot: "Rare-or-better slots" },
  epic: { label: "Epic", slot: "Rare-or-better slots" },
  altArt: { label: "Alternate Art", slot: "Rare-or-better slots" },
  specialArt: { label: "Special Art", slot: "Rare-or-better slots" },
  overnumbered: { label: "Overnumbered", slot: "Rare-or-better slots" },
  signature: { label: "Signature", slot: "Rare-or-better slots" },
  ultimate: { label: "Ultimate", slot: "Rare-or-better slot (own rate)" },
  foil: { label: "Foil slot", slot: "1 Foil slot" },
  rune: { label: "Rune / Token", slot: "Last slot" },
  altRune: { label: "Alt-art Rune", slot: "Last slot" },
};
