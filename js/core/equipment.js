// Equipment helpers built on the full DAT equipment list (defaults.js EQUIPMENT).
//   equipInfo(code)       the list entry for a code (or null)
//   equipLabel(code)      "Van w/Team" for VM; the code itself when unknown
//   equipFamilies(code)   ['van'], ['van','reefer'] (Van or Reefer) ... drives carrier matching
//   rateViewWord(code)    the one word DAT RateView understands: Van | Reefer | Flatbed
//   equipWords(code)      words to look for in a carrier's "Equipment" text
//   broadEquipCode(code)  the wider DAT type that shows the same load to more trucks (opt-in, export only): Van -> Van or Reefer, Flatbed -> Flatbed or Step Deck
//   equipFromText(text)   TQL "Trailer Type:" text -> the best DAT code (used by the parser)

import { EQUIPMENT } from './defaults.js';

const BY_CODE = new Map(EQUIPMENT.map(e => [e.code, e]));
const norm = (c) => String(c ?? '').trim().toUpperCase();

export const equipInfo = (code) => BY_CODE.get(norm(code)) || null;
export const equipLabel = (code) => { const e = equipInfo(code); return e ? e.label : norm(code); };
export const equipFamilies = (code) => { const e = equipInfo(code); return e ? e.fam : ['van']; };
export const rateViewWord = (code) => { const e = equipInfo(code); return e ? e.rateView : 'Van'; };

const FAMILY_WORDS = {
  van: ['van', 'v', 'vm', 'dry'],
  reefer: ['reefer', 'r', 'rm', 'refrigerated'],
  flatbed: ['flat', 'f', 'flatbed', 'conestoga'],
  stepdeck: ['step', 'sd', 'stepdeck', 'flat'],
  box: ['straight', 'box', 'sb'],
  power: ['power', 'po'],
  sprinter: ['sprinter', 'sv', 'cargo'],
  other: [],
};

/** Words that identify this equipment in a carrier's free-text "Equipment" field. Unknown codes behave like Van (as before). */
export function equipWords(code) {
  const out = new Set();
  for (const f of equipFamilies(code)) for (const w of FAMILY_WORDS[f] || []) out.add(w);
  const e = equipInfo(code);
  if (e && e.fam.includes('other')) for (const w of String(e.label).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2)) out.add(w);
  return out.size ? [...out] : FAMILY_WORDS.van;
}

/** Opt-in "post wider" mapping. Same freight, same trucks, plus the trucks that can also legally haul it. null = nothing wider exists. */
const BROAD = { V: 'VR', F: 'FD' };   // a Step Deck is never widened: over-height freight cannot go on a flatbed
export const broadEquipCode = (code) => BROAD[norm(code)] || norm(code);

// ---- TQL text -> DAT code ---------------------------------------------------------------------------------------------
const has = (t, re) => re.test(t);

export function equipFromText(text) {
  const t = String(text ?? '').toLowerCase().replace(/[_]+/g, ' ');
  if (!t.trim()) return 'V';
  const team = has(t, /\bteams?\b/), haz = has(t, /haz-?\s?mat/), rgn = has(t, /\brgn\b|removable\s+gooseneck/);
  const van = has(t, /\bvan\b|\bdry\b/), reefer = has(t, /reefer|refrigerat|temp(?:erature)?[ -]?controlled/), flat = has(t, /flat/), step = has(t, /step\s?-?\s?deck/);
  const conestoga = has(t, /conestoga/), hotshot = has(t, /hot\s?-?\s?shot/), tarps = has(t, /tarp/), pallet = has(t, /pallet\s+exch/);

  if (has(t, /power\s?-?\s?only/)) return has(t, /tow\s?-?\s?away/) ? 'PT' : has(t, /load\s?-?\s?out/) ? 'PL' : 'PO';
  if (has(t, /sprinter|cargo\s+van/)) return team ? 'SM' : haz ? 'SZ' : reefer ? 'SC' : 'SV';
  if (has(t, /straight\s*(?:box|truck)|box\s*truck|\bsb\b/)) return reefer ? 'BR' : haz ? 'BZ' : 'SB';
  if (has(t, /lowboy|low\s?-?\s?boy/)) return has(t, /over\s?-?\s?dim/) ? 'LO' : rgn ? 'LR' : 'LB';
  if (step) {
    if (rgn) return 'SR';
    if (conestoga) return 'SN';
    if (flat) return 'FD';
    return has(t, /landoll|drop\s?-?\s?deck/) ? 'LA' : 'SD';
  }
  if (rgn) return 'RG';
  if (has(t, /landoll|drop\s?-?\s?deck/)) return 'LA';
  if (has(t, /double\s?-?\s?drop/)) return 'DD';
  if (has(t, /container/)) return has(t, /refrigerat|reefer/) ? 'CR' : has(t, /insulat/) ? 'CI' : 'C';
  if (has(t, /tanker/)) return has(t, /alumin/) ? 'TA' : has(t, /intermodal/) ? 'TN' : 'TS';
  if (van && reefer) return flat ? 'FR' : has(t, /insulat/) ? 'IR' : has(t, /vented/) ? 'RV' : 'VR';
  if ((flat || conestoga || hotshot) && !(van && !flat)) {   // "Van Conestoga" / "Van Hotshot" are vans, handled below
    if (van && flat) return tarps ? 'VT' : 'VF';
    if (conestoga) return flat ? 'FN' : 'CN';
    if (hotshot) return 'FH';
    if (haz) return 'FZ';
    if (team) return 'FM';
    if (tarps) return 'FT';
    if (has(t, /chain/)) return 'FC';
    if (has(t, /\bsides?\b/)) return 'FS';
    if (has(t, /maxi/)) return 'MX';
    if (has(t, /air\s?-?\s?ride/)) return 'FA';
    if (has(t, /double/)) return 'F2';
    if (has(t, /over\s?-?\s?dim/)) return 'FO';
    return 'F';
  }
  if (reefer) {
    if (team) return 'RM';
    if (haz) return 'RZ';
    if (pallet) return 'RP';
    if (has(t, /air\s?-?\s?ride/)) return 'RA';
    if (has(t, /double/)) return 'R2';
    if (has(t, /intermodal/)) return 'RN';
    if (has(t, /logistic/)) return 'RL';
    return 'R';
  }
  if (has(t, /auto\s?-?\s?carrier/)) return 'AC';
  if (has(t, /b\s?-?\s?train/)) return 'BT';
  if (has(t, /conveyor/)) return 'CV';
  if (has(t, /dump/)) return 'DT';
  if (has(t, /hopper/)) return 'HB';
  if (has(t, /pneumatic/)) return 'NU';
  if (has(t, /moving\s+van/)) return 'MV';
  if (has(t, /stretch/)) return 'ST';
  if (has(t, /truck\s+and\s+trailer/)) return 'TT';
  if (has(t, /removable\s+gooseneck/)) return 'RG';
  if (has(t, /maxi/)) return 'MX';
  if (van || has(t, /\bvans?\b/)) {
    if (team) return 'VM';
    if (haz) return 'VZ';
    if (has(t, /air\s?-?\s?ride/)) return 'VA';
    if (conestoga) return 'VS';
    if (has(t, /double/)) return 'V2';
    if (has(t, /triple/)) return 'V3';
    if (hotshot) return 'VH';
    if (has(t, /insulat/)) return 'VI';
    if (has(t, /intermodal/)) return 'VN';
    if (has(t, /lift\s?-?\s?gate/)) return 'VG';
    if (has(t, /logistic/)) return 'VL';
    if (has(t, /open\s?-?\s?top/)) return 'OT';
    if (has(t, /roller/)) return 'VB';
    if (has(t, /vented/)) return 'VV';
    if (has(t, /blanket/)) return 'VW';
    if (has(t, /curtain/)) return 'VC';
    if (pallet) return 'VP';
    return 'V';
  }
  return team ? 'VM' : 'V';          // unknown text: van, exactly as the macro defaults
}
