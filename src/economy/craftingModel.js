/* ══════════════════════════════════════════════════════════════
   WarEra+ — Crafting: il modello (matematica pura, niente DOM)
   ------------------------------------------------------------------
   Prende quello che il server ha MISURATO (`/gear-market`: curve
   prezzo(tiro) per ogni pezzo, frequenze di uscita di craft e casse,
   rese di smontaggio) e i prezzi di adesso (`itemTrading.getPrices`) e
   risponde a due domande:

     1. un craft casuale di rarità R rende più di quanto costa?
     2. conviene aprire una cassa, o rivenderla chiusa?

   ── COME SI CALCOLA IL VALORE DI UN PEZZO ──────────────────────────
   I tiri sono UNIFORMI nell'intervallo di gioco, quindi il valore atteso
   di un codice (es. helmet4) è la media della sua curva sull'intera
   griglia dei tiri. Per ogni tiro il pezzo si vende o si smonta, e si
   sceglie il meglio: max(prezzo di mercato, scraps rese × prezzo scraps).
   Le due strade pagano la stessa tassa di mercato (`tax`).

   ── COSTO DEL CRAFT ────────────────────────────────────────────────
   Le transazioni `craftItem` registrano solo le scraps (6·3^(k-1)); l'acciaio
   (1, 2, 4, 8, 16, 32) sta nella schermata «Craft items» del gioco, che
   mostra per ogni rarità scraps e acciaio (verificato il 2026-11-11 con la
   schermata: mitico 1,46k + 32, epico 162 + 8, comune 6 + 1). Se il gioco
   cambiasse i costi si aggiorna `CRAFT_STEEL`.

   ── ⚠️ UNA COSA NON MISURABILE, DICHIARATA ─────────────────────────
   · La TASSA di mercato dipende dal paese: è un parametro dell'utente
     (default 1%), non un dato.

   Le curve dipendono dalle vendite degli ultimi 7 giorni: `conf` dice
   quanto sono solide per ogni pezzo, e la vista lo mostra.
   ══════════════════════════════════════════════════════════════ */

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const SLOTS = ['helmet', 'chest', 'pants', 'boots', 'gloves'];

/** Acciaio per craft, per indice di rarità (1 = common): quello della
 *  schermata «Craft items» del gioco. Vedi la testata. */
export const CRAFT_STEEL = [0, 1, 2, 4, 8, 16, 32];
/** Scraps per craft e rese di smontaggio nominali: 6·3^(k-1). Misurate sulle
 *  transazioni (craftItem e dismantleItem coincidono); qui solo come ripiego
 *  per le rarità di cui il server non ha ancora visto nessuno smontaggio. */
export const SCRAPS_NOMINAL = [0, 6, 18, 54, 162, 486, 1458];

export const DEFAULT_TAX = 0.01;
const P_WEAPON_NOMINAL = 0.30;

/** Le coordinate di tutti i tiri di un pezzo, col loro peso. Armatura: un
 *  valore per tiro; arma: una cella della griglia attacco × critico, pesata
 *  per quanti attacchi interi contiene. */
export function curvePoints(curve) {
  const g = curve?.g;
  if (!g) return [];
  if (Array.isArray(g)) return g.filter(v => v != null).map(v => ({ v, w: 1 }));
  const pts = [];
  g.v.forEach((riga, i) => riga.forEach(v => { if (v != null) pts.push({ v, w: g.aw[i] }); }));
  return pts;
}

/** Il prezzo (con tassa) a cui si vendono le scraps di uno smontaggio. */
function scrapNet(rarityIdx, code, model, prices, tax) {
  const resa = model.freq?.dismantle?.[code] || SCRAPS_NOMINAL[rarityIdx];
  return resa * (prices.scraps || 0) * (1 - tax);
}

/**
 * Statistiche di UN codice: valore atteso con le tre strategie e, per ogni
 * tiro, il valore ottimo (serve a P(profitto) e alla varianza).
 *
 * @returns {{ sell:number, scrap:number, opt:number, m2:number, points:{v:number,w:number}[], conf:string, n:number }|null}
 */
export function codeValue(code, rarityIdx, model, prices, tax) {
  const curve = model.curves?.[code];
  const pts = curvePoints(curve);
  if (!pts.length) return null;
  const scrap = scrapNet(rarityIdx, code, model, prices, tax);
  let wTot = 0, sell = 0, opt = 0, m2 = 0;
  const points = [];
  for (const p of pts) {
    const net = p.v * (1 - tax);
    const best = Math.max(net, scrap);
    wTot += p.w; sell += net * p.w; opt += best * p.w; m2 += best * best * p.w;
    points.push({ v: best, w: p.w });
  }
  return { sell: sell / wTot, scrap, opt: opt / wTot, m2: m2 / wTot, points, conf: curve.conf || 'low', n: curve.n || 0 };
}

/**
 * Il valore ottimo (netto, vendita o smontaggio) lungo il tiro principale:
 * per l'armatura un punto per tiro, per l'arma uno per cella d'attacco con
 * il critico mediato. Serve al piccolo grafico "valore per tiro".
 */
export function valueProfile(code, rarityIdx, model, prices, tax) {
  const curve = model.curves?.[code];
  if (!curve?.g) return [];
  const scrap = scrapNet(rarityIdx, code, model, prices, tax);
  const best = (v) => Math.max(v * (1 - tax), scrap);
  if (Array.isArray(curve.g)) return curve.g.map(v => (v == null ? null : best(v)));
  return curve.g.v.map(riga => {
    const ok = riga.filter(v => v != null);
    return ok.length ? best(ok.reduce((s, v) => s + v, 0) / ok.length) : null;
  });
}

/** Il codice di armatura di uno slot e di una rarità: helmet + 4 → helmet4. */
const armorCode = (slot, idx) => `${slot}${idx}`;

/** Il codice dell'arma di una rarità, dalle curve (kind 'w'/'weapon'). */
function weaponCodeFor(model, rarity) {
  for (const [code, c] of Object.entries(model.curves || {})) {
    if (c.k === 'weapon' && c.r === rarity) return code;
  }
  return null;
}

/**
 * ROI di un craft casuale di rarità `rarityIdx` (1..6).
 *
 * @param {object} model risposta di /gear-market
 * @param {Record<string, number>} prices itemTrading.getPrices
 * @param {number} rarityIdx 1..6
 * @param {{ tax?: number, steel?: boolean }} opt
 */
export function craftRoi(model, prices, rarityIdx, { tax = DEFAULT_TAX, steel = true } = {}) {
  const rarity = RARITIES[rarityIdx - 1];
  const scraps = SCRAPS_NOMINAL[rarityIdx];
  const steelQty = steel ? CRAFT_STEEL[rarityIdx] : 0;
  const cost = scraps * (prices.scraps || 0) + steelQty * (prices.steel || 0);

  const weapon = weaponCodeFor(model, rarity);
  const codes = [...(weapon ? [weapon] : []), ...SLOTS.map(s => armorCode(s, rarityIdx))];

  // Frequenze MISURATE sui craft veri di questa rarità; se il server non ne
  // ha ancora, quelle nominali (30% arma, il resto in parti uguali).
  const freq = model.freq?.craft || {};
  const visti = codes.reduce((s, c) => s + (freq[c] || 0), 0);
  const misurato = visti >= 500;

  const outcomes = [];
  let ev = 0, m2 = 0, pProfit = 0, coperto = 0;
  for (const code of codes) {
    const p = misurato ? (freq[code] || 0) / visti
      : code === weapon ? P_WEAPON_NOMINAL : (1 - P_WEAPON_NOMINAL) / SLOTS.length;
    const cv = codeValue(code, rarityIdx, model, prices, tax);
    if (!cv) { outcomes.push({ code, p, ev: null, margin: null, pProfit: null, conf: 'none', n: 0, isWeapon: code === weapon }); continue; }
    let win = 0, wTot = 0;
    for (const pt of cv.points) { wTot += pt.w; if (pt.v > cost) win += pt.w; }
    const pw = win / wTot;
    outcomes.push({
      code, p, ev: cv.opt, margin: cv.opt - cost, pProfit: pw, conf: cv.conf, n: cv.n,
      sell: cv.sell, scrap: cv.scrap, points: cv.points, isWeapon: code === weapon,
    });
    ev += p * cv.opt; m2 += p * cv.m2; pProfit += p * pw; coperto += p;
  }

  // Se manca la curva di qualche pezzo, la media è sui soli pezzi coperti:
  // meglio un numero dichiarato incompleto che uno con un buco spacciato per zero.
  if (coperto > 0 && coperto < 0.999) { ev /= coperto; m2 /= coperto; pProfit /= coperto; }
  const variance = Math.max(0, m2 - ev * ev);
  return {
    rarity, rarityIdx, cost, scraps, steel: steelQty,
    ev: coperto > 0 ? ev : null,
    margin: coperto > 0 ? ev - cost : null,
    roi: coperto > 0 && cost > 0 ? ev / cost - 1 : null,
    pProfit: coperto > 0 ? pProfit : null,
    sd: Math.sqrt(variance),
    covered: coperto,
    measured: misurato, crafts: visti,
    outcomes,
  };
}

/** Un lotto di `n` craft: attesa e fascia 80% (approssimazione normale,
 *  dichiarata: con pochi craft la distribuzione vera è asimmetrica). */
export function craftBatch(roi, n) {
  if (roi.margin == null) return null;
  const mean = roi.margin * n;
  const sd = roi.sd * Math.sqrt(n);
  return { mean, sd, lo: mean - 1.2816 * sd, hi: mean + 1.2816 * sd, spent: roi.cost * n };
}

/**
 * Valore atteso di una cassa di pezzi (case1, case2) aperta.
 *
 * @param {'sell'|'scrap'|'opt'|'custom'} strategy cosa fare di ogni pezzo
 * @param {Record<string,'sell'|'scrap'>} custom scelta per rarità (solo 'custom')
 */
export function caseEv(model, prices, caseCode, strategy, custom, tax = DEFAULT_TAX) {
  const freq = model.freq?.cases?.[caseCode];
  if (!freq) return null;
  const tot = Object.values(freq).reduce((s, n) => s + n, 0);
  if (tot < 30) return null;
  let ev = 0, coperto = 0;
  for (const [code, n] of Object.entries(freq)) {
    const c = model.curves?.[code];
    if (!c) continue;
    const idx = RARITIES.indexOf(c.r) + 1;
    const cv = codeValue(code, idx, model, prices, tax);
    if (!cv) continue;
    let v;
    if (strategy === 'sell') v = cv.sell;
    else if (strategy === 'scrap') v = cv.scrap;
    else if (strategy === 'custom') v = (custom?.[c.r] || 'sell') === 'scrap' ? cv.scrap : cv.sell;
    else v = cv.opt;
    ev += (n / tot) * v; coperto += n / tot;
  }
  if (coperto < 0.5) return null;
  // Pezzi senza curva (mai visti in vendita): la media è sui coperti.
  return { ev: ev / coperto, covered: coperto, opens: tot };
}

/** La cassa di legno: nessun pezzo, risorse. Valore = quantità × prezzo,
 *  sommate su tutte le aperture viste. */
export function woodenCaseEv(model, prices, tax = DEFAULT_TAX) {
  const wood = model.freq?.wood;
  if (!wood) return null;
  let n = 0, valore = 0;
  for (const [res, v] of Object.entries(wood)) {
    n += v.n;
    valore += v.q * (prices[res] || 0);
  }
  if (n < 50) return null;
  return { ev: (valore / n) * (1 - tax), opens: n };
}
