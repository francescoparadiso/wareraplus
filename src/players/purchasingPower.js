/* ══════════════════════════════════════════════════════════════
   WarEra+ — Giocatori: POTERE D'ACQUISTO
   ------------------------------------------------------------------
   La domanda: «sto spendendo più di quanto guadagno, o è solo che le mie
   cose valgono meno?». In deflazione la ricchezza nominale cala anche a
   consumi invariati, perché oggetti ed equipaggiamento perdono valore:
   guardare il numero nudo non dice quale delle due cose sta succedendo.

   ── LA FORMULA ─────────────────────────────────────────────────────
       valore reale = valore nominale ÷ indice dei prezzi

   dove l'indice segue il prezzo di ciò che si CONSUMA per combattere:
   pillole, cibo e proiettili (candele giornaliere di `/price-history`).
   Il valore è la ricchezza SENZA le aziende (che il gioco stima a suo
   modo e che non si spendono): equipaggiamento + armi + oggetti + soldi.

   ── ⚠️ DUE SCELTE CHE NON SONO OVVIE ───────────────────────────────
   · L'indice si fa sui RAPPORTI di prezzo (prezzo di ieri / prezzo di
     oggi), non sui prezzi. Una media dei prezzi pesa la pillola (~37) cento
     volte il proiettile leggero (~0,2): sarebbe un indice della pillola.
   · È espresso in MONETE DI OGGI: l'ultimo punto della linea reale
     coincide col nominale, e i giorni prima sono riportati a quanto
     varrebbero ai prezzi di adesso. Così la distanza fra le due linee si
     legge direttamente come "quanto del calo è prezzo".

   Le tre categorie mostrate separate (senza aziende / soldi + oggetti /
   equipaggiamento + armi) servono a questo: i soldi e gli oggetti seguono
   ciò che incassi e consumi; l'equipaggiamento segue soprattutto il
   mercato. Gli oggetti contengono anche pillole, cibo e proiettili in
   magazzino, che si rivalutano con l'indice stesso: dividerli per
   l'indice li neutralizza.

   Lo storico per categoria esiste dal 2026-11-04 (server/playerParts.js):
   la vista dichiara da quando, e non inventa giorni prima.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../mu/ui.js';

/** Il paniere: gruppo → risorse. Dentro il gruppo, media dei rapporti. */
export const BASKET = {
  pill: ['cocain'],
  food: ['bread', 'steak', 'cookedFish'],
  ammo: ['lightAmmo', 'ammo', 'heavyAmmo'],
};
export const GROUPS = ['pill', 'food', 'ammo'];
export const METRICS = ['ex', 'cash', 'gear'];
export const DEFAULT_WEIGHTS = { pill: 1, food: 1, ammo: 1 };

const KEY = 'we_pp_weights';

export function loadWeights() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (w && GROUPS.every(g => Number.isFinite(w[g]) && w[g] >= 0) && GROUPS.some(g => w[g] > 0)) return w;
  } catch (_) { /* default */ }
  return { ...DEFAULT_WEIGHTS };
}
export function saveWeights(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch (_) { /* nessun danno */ }
}

const DAY = 86400_000;
const dayMs = (g) => Date.parse(`${g}T12:00:00Z`);

/** Il prezzo di una risorsa in un giorno: media fra apertura e chiusura
 *  della candela (lo scatto della ricchezza è del mattino presto, a metà
 *  fra le due). Un giorno senza candela prende l'ultima di non più di tre
 *  giorni prima: "non ho misurato" non diventa "valeva zero". */
function prezzoDelGiorno(mappa, g) {
  if (!mappa) return null;
  for (let k = 0; k <= 3; k++) {
    const d = new Date(dayMs(g) - k * DAY).toISOString().slice(0, 10);
    const c = mappa.get(d);
    if (c) return (c[1] + c[4]) / 2;
  }
  return null;
}

/**
 * @param {Array<{g:string, companies:number|null, equipments:number|null, weapons:number|null, items:number|null, money:number|null}>} rows
 * @param {(code:string)=>Array} getSeries candele [giorno, o, h, l, c, n] di una risorsa
 * @param {{pill:number, food:number, ammo:number}} weights
 */
export function buildRealSeries(rows, getSeries, weights) {
  if (!rows.length) return { series: [], base: null, priced: false };
  const base = rows[rows.length - 1].g;
  const mappe = {};
  for (const g of GROUPS) {
    for (const code of BASKET[g]) {
      if (mappe[code]) continue;
      const s = getSeries(code) || [];
      mappe[code] = new Map(s.map(c => [c[0], c]));
    }
  }

  // Prezzi di oggi per ogni risorsa (la base dei rapporti).
  const pBase = {};
  for (const code of Object.keys(mappe)) pBase[code] = prezzoDelGiorno(mappe[code], base);

  /** Livello dei prezzi del giorno `g` rispetto ad oggi (1 = come oggi). */
  const livello = (g) => {
    let somma = 0, peso = 0;
    for (const gr of GROUPS) {
      const w = weights[gr] || 0;
      if (w <= 0) continue;
      const rapporti = [];
      for (const code of BASKET[gr]) {
        const p = prezzoDelGiorno(mappe[code], g);
        if (p != null && pBase[code] > 0) rapporti.push(p / pBase[code]);
      }
      if (!rapporti.length) continue;
      somma += w * (rapporti.reduce((s, x) => s + x, 0) / rapporti.length);
      peso += w;
    }
    return peso > 0 ? somma / peso : null;
  };

  const somma = (...v) => (v.every(Number.isFinite) ? v.reduce((s, x) => s + x, 0) : null);
  let priced = false;
  const series = rows.map(r => {
    const L = livello(r.g);
    if (L != null && Math.abs(L - 1) > 1e-9) priced = true;
    const level = L ?? 1;
    const nom = {
      ex: somma(r.equipments, r.weapons, r.items, r.money),
      cash: somma(r.items, r.money),
      gear: somma(r.equipments, r.weapons),
    };
    const real = {};
    for (const m of METRICS) real[m] = nom[m] == null ? null : nom[m] / level;
    return { g: r.g, level, hasPrice: L != null, nom, real };
  });
  return { series, base, priced: priced || series.some(s => s.hasPrice) };
}

/** Variazioni fra il primo e l'ultimo giorno della finestra. */
export function summarize(series) {
  if (series.length < 2) return null;
  const a = series[0], b = series[series.length - 1];
  const out = { from: a.g, to: b.g, metrics: {}, prices: a.hasPrice ? 1 / a.level - 1 : null };
  for (const m of METRICS) {
    const n0 = a.nom[m], n1 = b.nom[m], r0 = a.real[m], r1 = b.real[m];
    out.metrics[m] = {
      nomAbs: n0 != null && n1 != null ? n1 - n0 : null,
      nomPct: n0 > 0 && n1 != null ? (n1 / n0 - 1) * 100 : null,
      realAbs: r0 != null && r1 != null ? r1 - r0 : null,
      realPct: r0 > 0 && r1 != null ? (r1 / r0 - 1) * 100 : null,
    };
  }
  return out;
}

/** Linee nominale (tratteggiata) e reale (piena) di una categoria. La scala
 *  NON parte da zero: qui conta quanto si muove, non quanto è grande. */
export function realChartSvg(series, metric, { w = 880, h = 280, fmt = String, lingua = 'it', labels } = {}) {
  const pts = series.filter(s => s.nom[metric] != null);
  if (pts.length < 2) return '';
  const L = 58, R = 14, T = 14, B = 26;
  const x0 = dayMs(pts[0].g), x1 = dayMs(pts[pts.length - 1].g), arco = Math.max(1, x1 - x0);
  let min = Infinity, max = -Infinity;
  for (const s of pts) for (const v of [s.nom[metric], s.real[metric]]) { min = Math.min(min, v); max = Math.max(max, v); }
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.05 || 1;
  min = Math.max(0, min - pad); max += pad;
  const x = (g) => L + ((dayMs(g) - x0) / arco) * (w - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (h - T - B);

  const guide = [0, 1, 2, 3].map(i => {
    const v = min + ((max - min) * i) / 3;
    const gy = y(v).toFixed(1);
    return `<line class="wp-ecn-grid" x1="${L}" x2="${w - R}" y1="${gy}" y2="${gy}"/>
      <text class="wp-ecn-axis" x="${L - 6}" y="${(Number(gy) + 3).toFixed(1)}" text-anchor="end">${escapeHtml(fmt(v))}</text>`;
  }).join('');
  const path = (k) => pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.g).toFixed(1)},${y(s[k][metric]).toFixed(1)}`).join('');
  const data = (g) => new Intl.DateTimeFormat(lingua, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(dayMs(g)));

  const colonne = pts.map((s, i) => {
    const gx = x(s.g);
    const a = i ? (x(pts[i - 1].g) + gx) / 2 : L;
    const b = i < pts.length - 1 ? (gx + x(pts[i + 1].g)) / 2 : w - R;
    const t = [data(s.g), `${labels.nominal}: ${fmt(s.nom[metric])}`, `${labels.real}: ${fmt(s.real[metric])}`,
      `${labels.index}: ${(s.level * 100).toFixed(1)}`].join('\n');
    return `<rect x="${a.toFixed(1)}" y="${T}" width="${Math.max(1, b - a).toFixed(1)}" height="${h - T - B}" fill="transparent"><title>${escapeHtml(t)}</title></rect>`;
  }).join('');

  return `<svg class="wp-ecn-mchart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(`${labels.nominal} / ${labels.real}`)}">
      ${guide}
      <path d="${path('nom')}" fill="none" stroke="#8b949e" stroke-width="1.6" stroke-dasharray="5 4" stroke-linejoin="round"/>
      <path d="${path('real')}" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <text class="wp-ecn-axis" x="${L}" y="${h - 8}">${escapeHtml(data(pts[0].g))}</text>
      <text class="wp-ecn-axis" x="${w - R}" y="${h - 8}" text-anchor="end">${escapeHtml(data(pts[pts.length - 1].g))}</text>
      ${colonne}
    </svg>`;
}
