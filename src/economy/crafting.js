/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: la scheda CRAFTING
   ------------------------------------------------------------------
   Due domande, una sola scheda:

     · CRAFT — spendere scraps (e acciaio) per un pezzo a caso rende più
       di quanto costa? Per ogni rarità: costo, valore atteso, ROI,
       probabilità di profitto, e per ogni pezzo che può uscire il suo
       valore tiro per tiro.
     · CASSE — conviene aprirla o rivenderla chiusa? Quattro strategie
       per pezzo (vendi tutto, smonta tutto, il meglio per pezzo, la tua).

   ── DA DOVE VIENE OGNI NUMERO ──────────────────────────────────────
   · I PREZZI (scraps, acciaio, casse, risorse) sono `itemTrading.getPrices`,
     pubblica, ogni 5 minuti, via `src/market/api.js`.
   · Il VALORE DI UN TIRO ("un casco epico con 83 di critico") e le
     FREQUENZE di uscita vengono dal server di cache (`/gear-market`, vedi
     server/gearMarket.js): vendite vere, craft veri, aperture vere. Il
     gioco non pubblica un listino per tiro, quindi senza server questa
     scheda non ha ripieghi e lo dice.
   · La matematica sta in `craftingModel.js`, pura e provata contro una
     dashboard di terzi: ROI dell'epico +1,0% (loro +2,0%), margini per
     pezzo entro un'unità.

   Come le altre schede, questo file non chiama `fetch`: i dati passano da
   `cacheClient.js` e `market/api.js`.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../mu/ui.js';
import { ecoT } from './i18n.js';
import { craftT } from './i18nCraft.js';
import { fetchGearMarketViaCache, fetchGearPriceHistoryViaCache } from '../diplomacy/cacheClient.js';
import { tipAttr } from '../shared/chartTip.js';
import { loadSpotPrices, loadBookPrices } from '../market/api.js';
import { loadBonusRules } from '../shared/battleBonus.js';
import * as M from './craftingModel.js';

// ── Stato della scheda ──────────────────────────────────────────────
let _container = null;
let _model = null;          // risposta di /gear-market, null = non risponde
let _prices = null;
// v0.28.3 (16 nov 2026): le casse di legno escono dal mercato e dalla mappa
// (gameConfig.mapTravel.mapCasesEnabled = false). Il prezzo in getPrices
// resta l'ULTIMO scambio, congelato, con il libro ordini vuoto: un verdetto
// "apri o vendi" su un prezzo che non esiste più sarebbe falso. La card si
// mostra solo se il gioco le riaccende.
let _woodOnSale = false;
let _modelTs = 0;
let _loading = false;
let _view = 'craft';        // 'craft' | 'cases' | 'history'
let _hCode = null;          // pezzo aperto in "Prezzi nel tempo"
let _hStep = 'day';         // 'day' | '6h'
const _hist = new Map();    // `${code}|${step}` → { at, data|null }
const _hLoading = new Set();
let _rar = 0;               // rarità aperta (1..6), 0 = ancora da scegliere
let _tax = M.DEFAULT_TAX;
let _steel = true;
let _batchN = 100;
let _custom = { common: 'sell', uncommon: 'sell', rare: 'sell', epic: 'sell', legendary: 'sell', mythic: 'sell' };
let _timer = null;
let _tick = 0;

const PRICE_EVERY_MS = 5 * 60 * 1000;
const MODEL_EVERY_TICKS = 3;          // il modello ogni 15 minuti
const FRESCO_MS = 4 * 60 * 1000;

try {
  // ⚠️ `Number(null)` è 0: senza il controllo su null il default (1%) sparisce
  // al primo avvio e la tassa parte da zero.
  const grezzo = localStorage.getItem('we_craft_tax');
  const t = grezzo === null ? NaN : Number(grezzo);
  if (Number.isFinite(t) && t >= 0 && t <= 0.5) _tax = t;
  if (localStorage.getItem('we_craft_steel') === '0') _steel = false;
} catch (_) { /* senza storage resta il default */ }

function salva() {
  try {
    localStorage.setItem('we_craft_tax', String(_tax));
    localStorage.setItem('we_craft_steel', _steel ? '1' : '0');
  } catch (_) { /* nessun danno */ }
}

// ── Numeri e date ───────────────────────────────────────────────────
function lingua() {
  return (localStorage.getItem('we_lang') || navigator.language || 'it').slice(0, 2);
}
function num(v, dec = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(lingua(), { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
}
const prezzo = (v) => num(v, Math.abs(v) >= 100 ? 1 : 2);
function firmato(v, dec = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + num(v, dec);
}
function pct(v, dec = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${new Intl.NumberFormat(lingua(), { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v * 100)}%`;
}
const pctFirmato = (v, dec = 1) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + pct(v, dec));
const segno = (v) => (v == null ? '' : v > 0 ? ' wp-crf-pos' : v < 0 ? ' wp-crf-neg' : '');
function giorno(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(lingua(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// ── Nomi e immagini dei pezzi ───────────────────────────────────────
// Il numero in fondo al codice del gioco (helmet5) è il TIER: 1 comune …
// 6 mitico. Si mostra «Elmo T5» e non il codice. Le immagini sono quelle del
// gioco (media.warera.io/images/items/<slot>.png): una per slot e per arma,
// uguale a ogni tier — il tier lo dice il colore della cornice.
const IMG_BASE = 'https://media.warera.io/images/items';
const SLOT_RE = /^(helmet|chest|pants|boots|gloves)(\d)$/;

function iconaHtml(img, tier = 0) {
  return `<img class="wp-crf-ico${tier ? ` wp-crf-r${tier}` : ''}" src="${IMG_BASE}/${escapeHtml(img)}.png" alt="" width="28" height="28" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

/** { img, nome, tier } di un codice: l'armatura porta il tier nel codice,
 *  l'arma (una per rarità) lo prende da quella del craft aperto. */
function pezzo(code, tierArma) {
  const m = SLOT_RE.exec(code);
  if (m) return { img: m[1], nome: `${craftT(m[1])} T${m[2]}`, tier: Number(m[2]) };
  return { img: code, nome: `${craftT('w_' + code)} T${tierArma}`, tier: tierArma };
}

// ── Il piccolo grafico "valore per tiro" ────────────────────────────
function sparkSvg(valori, costo) {
  const v = valori.filter(x => x != null);
  if (v.length < 2) return '';
  const W = 112, H = 30;
  const min = Math.min(...v, costo), max = Math.max(...v, costo);
  const span = max - min || 1;
  const x = (i) => 2 + (i * (W - 4)) / (valori.length - 1);
  const y = (val) => H - 3 - ((val - min) / span) * (H - 6);
  let d = '';
  let giu = false;
  valori.forEach((val, i) => {
    if (val == null) { giu = false; return; }
    d += `${giu ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`;
    giu = true;
  });
  const yc = y(costo).toFixed(1);
  return `<svg class="wp-crf-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <line class="wp-crf-spk-cost" x1="2" x2="${W - 2}" y1="${yc}" y2="${yc}"/>
      <path class="wp-crf-spk-line" d="${d}" fill="none"/>
    </svg>`;
}

// ── Pezzi del disegno ───────────────────────────────────────────────
function kpiHtml(etichetta, valore, nota, cls = '', notaHtml = '') {
  return `<div class="wp-ecn-kpi">
      <em>${escapeHtml(etichetta)}</em>
      <strong class="${cls}">${escapeHtml(valore)}</strong>
      ${notaHtml ? `<small class="wp-crf-costrow">${notaHtml}</small>` : nota ? `<small>${escapeHtml(nota)}</small>` : ''}
    </div>`;
}

/** Il costo come nel gioco: icona scraps + quantità, icona acciaio + quantità. */
function costoHtml(scraps, steel) {
  const q = (n) => new Intl.NumberFormat(lingua()).format(n);
  return `${iconaHtml('scraps')}${escapeHtml(q(scraps))}${steel ? ` ${iconaHtml('steel')}${escapeHtml(q(steel))}` : ''}`;
}

const confLabel = (c) => craftT({ high: 'confHigh', mid: 'confMid', low: 'confLow' }[c] || 'confNone');

function roiList() {
  return [1, 2, 3, 4, 5, 6].map(i => M.craftRoi(_model, _prices, i, { tax: _tax, steel: _steel }));
}

function craftHtml() {
  const rois = roiList();
  const migliore = rois.reduce((b, r) => (r.roi != null && (b == null || r.roi > b.roi) ? r : b), null);
  if (!_rar) _rar = (migliore || rois[3]).rarityIdx;
  const sel = rois[_rar - 1];

  const carte = rois.map(r => `
      <button type="button" class="wp-crf-card${r.rarityIdx === _rar ? ' active' : ''}" data-rar="${r.rarityIdx}">
        <span class="wp-crf-rname wp-crf-t${r.rarityIdx}">${escapeHtml(craftT(r.rarity))}${migliore && r.rarityIdx === migliore.rarityIdx
    ? ` <b class="wp-crf-best">${escapeHtml(craftT('best'))}</b>` : ''}</span>
        <strong class="wp-crf-roi${segno(r.roi)}">${escapeHtml(pctFirmato(r.roi))}</strong>
        <span class="wp-crf-line${segno(r.margin)}">${escapeHtml(firmato(r.margin))} ${escapeHtml(craftT('perCraft'))}</span>
        <span class="wp-crf-line wp-crf-dim">${escapeHtml(craftT('costEv'))}<br>${escapeHtml(prezzo(r.cost))} → ${escapeHtml(r.ev != null ? prezzo(r.ev) : '—')}</span>
        <span class="wp-crf-line wp-crf-dim">${escapeHtml(craftT('pWin'))} ${escapeHtml(pct(r.pProfit, 0))}</span>
      </button>`).join('');

  const righe = sel.outcomes.map(o => `
      <div class="wp-crf-row">
        ${(() => { const p = pezzo(o.code, sel.rarityIdx); return `<span class="wp-crf-piece wp-crf-go wp-crf-t${p.tier}" role="button" tabindex="0" data-hgo="${escapeHtml(o.code)}" title="${escapeHtml(craftT('secHistory'))}">${iconaHtml(p.img, p.tier)}<b>${escapeHtml(p.nome)}</b></span>`; })()}
        <span class="wp-ecn-num">${escapeHtml(pct(o.p, 1))}</span>
        <span class="wp-ecn-num">${escapeHtml(o.ev != null ? prezzo(o.ev) : '—')}</span>
        <span class="wp-ecn-num${segno(o.margin)}">${escapeHtml(firmato(o.margin))}</span>
        <span class="wp-ecn-num">${escapeHtml(pct(o.pProfit, 0))}</span>
        <span class="wp-ecn-num wp-crf-dim" title="${escapeHtml(confLabel(o.conf))}">${escapeHtml(String(o.n))} · ${escapeHtml(confLabel(o.conf))}</span>
        <span class="wp-crf-spkcell">${sparkSvg(M.valueProfile(o.code, sel.rarityIdx, _model, _prices, _tax), sel.cost)}</span>
      </div>`).join('');

  const lotto = M.craftBatch(sel, _batchN);

  return `
    <div class="wp-crf-cards">${carte}</div>

    <section class="wp-ecn-msec">
      <h3>${escapeHtml(craftT('detailTitle', { r: craftT(sel.rarity) }))}</h3>
      <div class="wp-ecn-kpis">
        ${kpiHtml(craftT('kCost'), prezzo(sel.cost), '', '', costoHtml(sel.scraps, sel.steel))}
        ${kpiHtml(craftT('kEv'), sel.ev != null ? prezzo(sel.ev) : '—', sel.measured ? craftT('noteMeasured', { n: sel.crafts }) : craftT('noteNominal', { n: sel.crafts }))}
        ${kpiHtml(craftT('kMargin'), firmato(sel.margin), pctFirmato(sel.roi) + ' ROI', segno(sel.margin))}
        ${kpiHtml(craftT('pWin'), pct(sel.pProfit, 0), craftT('kCover') + ': ' + pct(sel.covered, 0))}
      </div>
      ${sel.covered < 0.999 ? `<p class="wp-ecn-note">${escapeHtml(craftT('partial', { p: Math.round(sel.covered * 100) }))}</p>` : ''}

      <div class="wp-crf-table">
        <div class="wp-crf-row wp-crf-head">
          <span>${escapeHtml(craftT('colPiece'))}</span>
          <span class="wp-ecn-num">${escapeHtml(craftT('colChance'))}</span>
          <span class="wp-ecn-num">${escapeHtml(craftT('colEv'))}</span>
          <span class="wp-ecn-num">${escapeHtml(craftT('colMargin'))}</span>
          <span class="wp-ecn-num">${escapeHtml(craftT('colWin'))}</span>
          <span class="wp-ecn-num">${escapeHtml(craftT('colSales'))}</span>
          <span>${escapeHtml(craftT('colCurve'))}</span>
        </div>
        ${righe}
      </div>
    </section>

    <section class="wp-ecn-msec">
      <h3>${escapeHtml(craftT('batchTitle'))}</h3>
      <div class="wp-crf-batch">
        <label>${escapeHtml(craftT('batchN'))}
          <input type="number" min="1" max="100000" step="1" value="${_batchN}" id="wp-crf-n" class="wp-ecn-search wp-crf-num">
        </label>
        <div id="wp-crf-batch-out">${batchOutHtml(lotto)}</div>
      </div>
      <p class="wp-ecn-note">${escapeHtml(craftT('batchNote'))}</p>
    </section>`;
}

function batchOutHtml(l) {
  if (!l) return '';
  return `<span>${escapeHtml(craftT('batchSpent'))}: <b>${escapeHtml(prezzo(l.spent))}</b></span>
    <span>${escapeHtml(craftT('batchExp'))}: <b class="${segno(l.mean).trim()}">${escapeHtml(firmato(l.mean))}</b></span>
    <span>${escapeHtml(craftT('batchRange'))}: <b>${escapeHtml(firmato(l.lo, 0))} … ${escapeHtml(firmato(l.hi, 0))}</b></span>`;
}

// ── Casse ───────────────────────────────────────────────────────────
function caseCard(code) {
  const prezzoCassa = _prices[code];
  const nome = craftT(code);
  if (prezzoCassa == null) return '';
  const venditaChiusa = prezzoCassa * (1 - _tax);
  const strat = {
    all: M.caseEv(_model, _prices, code, 'sell', null, _tax),
    scrap: M.caseEv(_model, _prices, code, 'scrap', null, _tax),
    opt: M.caseEv(_model, _prices, code, 'opt', null, _tax),
    custom: M.caseEv(_model, _prices, code, 'custom', _custom, _tax),
  };
  if (!strat.opt) {
    return `<div class="wp-crf-case"><h3 class="wp-crf-h3">${iconaHtml(code)}${escapeHtml(nome)}</h3>
      <p class="wp-ecn-note">${escapeHtml(craftT('casePrice'))}: ${escapeHtml(prezzo(prezzoCassa))} · ${escapeHtml(craftT('caseFew'))}</p></div>`;
  }
  const apri = strat.opt.ev > venditaChiusa;
  // Dentro il 95% dell'errore del campione la differenza non dice niente:
  // meglio "troppo vicino" che un verdetto rosso o verde su rumore.
  const ci = strat.opt.se != null ? 1.96 * strat.opt.se : 0;
  const incerto = Math.abs(strat.opt.ev - venditaChiusa) < ci;
  const riga = (k, v) => `<div class="wp-crf-crow">
      <span>${escapeHtml(craftT(k))}</span>
      <span class="wp-ecn-num">${escapeHtml(v != null ? prezzo(v) : '—')}</span>
      <span class="wp-ecn-num${v != null ? segno(v - venditaChiusa) : ''}">${v != null && k !== 'stratSell' ? escapeHtml(firmato(v - venditaChiusa, 3)) : '—'}</span>
    </div>`;
  return `<div class="wp-crf-case">
      <header>
        <h3 class="wp-crf-h3">${iconaHtml(code)}${escapeHtml(nome)}</h3>
        <span class="wp-crf-verdict ${incerto ? 'wp-crf-dim' : apri ? 'wp-crf-pos' : 'wp-crf-neg'}">${escapeHtml(craftT(incerto ? 'verdictUnsure' : apri ? 'verdictOpen' : 'verdictSell'))}</span>
      </header>
      <div class="wp-ecn-kpis wp-crf-mini">
        ${kpiHtml(craftT('casePrice'), prezzo(prezzoCassa), craftT('opens', { n: new Intl.NumberFormat(lingua()).format(strat.opt.opens) }))}
        ${kpiHtml(craftT('roiBuy'), pctFirmato(strat.opt.ev / prezzoCassa - 1), `${craftT('stratOpt')} · ±${pct(ci / prezzoCassa, 1)}`, segno(strat.opt.ev - prezzoCassa))}
      </div>
      <div class="wp-crf-crow wp-crf-head"><span></span><span class="wp-ecn-num"></span><span class="wp-ecn-num">${escapeHtml(craftT('vsSell'))}</span></div>
      ${riga('stratSell', venditaChiusa)}
      ${riga('stratAll', strat.all?.ev)}
      ${riga('stratScrap', strat.scrap?.ev)}
      ${riga('stratOpt', strat.opt.ev)}
      ${riga('stratCustom', strat.custom?.ev)}
    </div>`;
}

function woodCard() {
  const w = M.woodenCaseEv(_model, _prices, _tax);
  const p = _prices.woodenCase;
  if (!_woodOnSale || !w || p == null) return '';
  const apri = w.ev > p * (1 - _tax);
  return `<div class="wp-crf-case">
      <header>
        <h3 class="wp-crf-h3">${iconaHtml('woodenCase')}${escapeHtml(craftT('woodenCase'))}</h3>
        <span class="wp-crf-verdict ${apri ? 'wp-crf-pos' : 'wp-crf-neg'}">${escapeHtml(craftT(apri ? 'verdictOpen' : 'verdictSell'))}</span>
      </header>
      <div class="wp-ecn-kpis wp-crf-mini">
        ${kpiHtml(craftT('casePrice'), prezzo(p), craftT('opens', { n: w.opens }))}
        ${kpiHtml(craftT('roiBuy'), pctFirmato(w.ev / p - 1), prezzo(w.ev), segno(w.ev - p))}
      </div>
      <p class="wp-ecn-note">${escapeHtml(craftT('woodNote'))}</p>
    </div>`;
}

function casesHtml() {
  const custom = M.RARITIES.map((r, i) => `
      <span class="wp-crf-crar"><b class="wp-crf-t${i + 1}">${escapeHtml(craftT(r))}</b>
        <button type="button" class="wp-ecn-chip${_custom[r] === 'sell' ? ' active' : ''}" data-cust="${r}:sell">${escapeHtml(craftT('optSell'))}</button>
        <button type="button" class="wp-ecn-chip${_custom[r] === 'scrap' ? ' active' : ''}" data-cust="${r}:scrap">${escapeHtml(craftT('optScrap'))}</button>
      </span>`).join('');
  return `
    <div class="wp-crf-cases">
      ${caseCard('case1')}
      ${caseCard('case2')}
      ${woodCard()}
    </div>
    <section class="wp-ecn-msec">
      <h3>${escapeHtml(craftT('customTitle'))}</h3>
      <p class="wp-ecn-note" style="margin:0 0 8px">${escapeHtml(craftT('customHint'))}</p>
      <div class="wp-crf-custom">${custom}</div>
    </section>`;
}

// ── Prezzi nel tempo ────────────────────────────────────────────────
// WarEra+ (2026-11-20, richiesta dell'utente): le vendite che fanno le curve
// dei valori, messe in fila nel tempo. Il server ne tiene il riassunto per
// giorno (mai potato) e, per le ultime due settimane, per 6 ore: vedi "LO
// STORICO DEI PREZZI" in server/gearMarket.js. Tre linee e non una: la
// mediana di tutte le vendite si sposta anche quando cambia la mescolanza dei
// tiri venduti, e lo si leggerebbe come un rincaro che non c'è.
const SLOT_ORDINE = ['helmet', 'chest', 'pants', 'boots', 'gloves'];
const HIST_FRESCO_MS = 10 * 60 * 1000;

/** I pezzi di una rarità: le cinque armature nell'ordine del gioco, poi l'arma. */
function pezziDi(rar) {
  const r = M.RARITIES[rar - 1];
  return Object.entries(_model?.curves || {})
    .filter(([, c]) => c.r === r)
    .sort(([a, ca], [b, cb]) => {
      const pa = ca.k === 'weapon' ? 9 : SLOT_ORDINE.indexOf(SLOT_RE.exec(a)?.[1]);
      const pb = cb.k === 'weapon' ? 9 : SLOT_ORDINE.indexOf(SLOT_RE.exec(b)?.[1]);
      return pa - pb;
    })
    .map(([code, c]) => ({ code, n: c.n || 0 }));
}

function codiceIniziale() {
  // Il pezzo più venduto: è quello su cui la linea dice di più.
  let best = null;
  for (const [code, c] of Object.entries(_model?.curves || {})) if (!best || (c.n || 0) > best.n) best = { code, n: c.n || 0 };
  return best?.code || null;
}

const rarDi = (code) => M.RARITIES.indexOf(_model?.curves?.[code]?.r) + 1 || 1;
const histKey = () => `${_hCode}|${_hStep}`;

function istante(r, step) {
  return step === '6h' ? Date.parse(r[0]) : Date.parse(`${r[0]}T00:00:00Z`);
}
function etichettaTempo(ms, step, lunga = false) {
  const o = step === '6h'
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', ...(lunga ? { weekday: 'short' } : {}) };
  return new Intl.DateTimeFormat(lingua(), { ...o, timeZone: 'UTC' }).format(new Date(ms)) + (step === '6h' ? ' UTC' : '');
}

function graficoStoricoHtml(dati) {
  const step = dati.step;
  const passo = step === '6h' ? 6 * 3600_000 : 86400_000;
  const righe = dati.rows;
  const W = 880, H = 310, L = 58, R = 14, T = 14, B = 24, VOL = 54, GAP = 22;
  const yPrezzoBasso = H - B - VOL - GAP;
  const t0 = istante(righe[0], step), t1 = istante(righe[righe.length - 1], step);
  const arco = Math.max(1, t1 - t0);
  const x = (t) => L + ((t - t0) / arco) * (W - L - R);

  const valori = righe.flatMap(r => [r[4], r[6], r[8]]).filter(v => v != null);
  if (!valori.length) return '';
  let min = Math.min(...valori), max = Math.max(...valori);
  if (max - min < 1e-9) { max = max * 1.05 || 1; min = min * 0.95; }
  else { const pad = (max - min) * 0.08; min = Math.max(0, min - pad); max += pad; }
  const y = (v) => T + (1 - (v - min) / (max - min)) * (yPrezzoBasso - T);
  const maxN = Math.max(...righe.map(r => r[1]), 1);
  const ultimo = righe.length - 1;

  const guide = [0, 1, 2, 3].map(i => {
    const v = min + ((max - min) * i) / 3;
    const gy = y(v).toFixed(1);
    return `<line class="wp-ecn-grid" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}"/>
      <text class="wp-ecn-axis" x="${L - 6}" y="${(Number(gy) + 3).toFixed(1)}" text-anchor="end">${escapeHtml(prezzo(v))}</text>`;
  }).join('');

  // Una linea per fascia; si spezza dove manca un secchio o la fascia ha
  // troppe poche vendite (un buco non è un prezzo).
  const linee = [0, 1, 2].map(b => {
    let d = '', prec = null;
    righe.forEach((r, i) => {
      const v = r[3 + b * 2 + 1];
      const t = istante(r, step);
      if (v == null) { prec = null; return; }
      const salto = prec == null || t - prec > passo * 1.5;
      d += `${salto ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      prec = t;
    });
    const punti = righe.length <= 60 ? righe.map((r, i) => {
      const v = r[3 + b * 2 + 1];
      if (v == null) return '';
      const parz = dati.partialLast && i === ultimo;
      return `<circle class="wp-crf-hdot wp-crf-hc${b}${parz ? ' wp-crf-hpart' : ''}" cx="${x(istante(r, step)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${parz ? 3.2 : 2.4}"/>`;
    }).join('') : '';
    return `<path class="wp-crf-hl wp-crf-hc${b}" d="${d}"/>${punti}`;
  }).join('');

  // Le vendite in basso, una barra per secchio.
  const larg = Math.max(2, Math.min(28, ((W - L - R) / Math.max(1, righe.length)) * 0.7));
  const base = H - B;
  const barre = righe.map((r, i) => {
    const h = (r[1] / maxN) * VOL;
    const cx = x(istante(r, step));
    return `<rect class="wp-crf-hvol${dati.partialLast && i === ultimo ? ' wp-crf-hpart' : ''}" x="${(cx - larg / 2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${larg.toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }).join('');

  // Colonne invisibili col tooltip comune (src/shared/chartTip.js). Ognuna
  // porta con sé il suo CURSORE (richiesta dell'utente, 2026-11-20: «col
  // mouse devo vedere graficamente dove punto»): una linea verticale, i tre
  // punti ingranditi e la barra delle vendite contornata, nascosti finché la
  // colonna non è quella puntata. Il tooltip mette `wp-tip-on` sul rettangolo
  // (anche al tocco, su telefono) e il CSS accende il gruppo da lì.
  const meta = righe.length > 1 ? (x(istante(righe[1], step)) - x(istante(righe[0], step))) : 20;
  const colonne = righe.map((r, i) => {
    const t = istante(r, step);
    const cx = x(t);
    const parz = dati.partialLast && i === ultimo;
    // Riga [inizio, n, med, n0, m0, n1, m1, n2, m2]: fascia b = n in 3+2b, mediana in 4+2b.
    const vendite = craftT('hVolume').toLocaleLowerCase();
    const fascia = (b) => `${craftT('band' + b)}\t${r[4 + b * 2] != null ? prezzo(r[4 + b * 2]) : '—'} · ${num(r[3 + b * 2], 0)} ${vendite}`;
    const hBar = (r[1] / maxN) * VOL;
    const cursore = `<g class="wp-crf-hcur">
        <line class="wp-crf-hcur-line" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${T}" y2="${base}"/>
        <rect class="wp-crf-hcur-vol" x="${(cx - larg / 2).toFixed(1)}" y="${(base - hBar).toFixed(1)}" width="${larg.toFixed(1)}" height="${hBar.toFixed(1)}"/>
        ${[0, 1, 2].map(b => (r[4 + b * 2] != null
    ? `<circle class="wp-crf-hcur-dot wp-crf-hc${b}" cx="${cx.toFixed(1)}" cy="${y(r[4 + b * 2]).toFixed(1)}" r="5"/>` : '')).join('')}
      </g>`;
    return `<g class="wp-crf-hcol">${cursore}<rect class="wp-tip-hit" x="${(cx - meta / 2).toFixed(1)}" y="${T}" width="${Math.max(meta, 4).toFixed(1)}" height="${H - T - B}"${tipAttr(
      `${etichettaTempo(t, step, true)}${parz ? ` (${craftT('hPartial')})` : ''}`,
      fascia(2), fascia(1), fascia(0),
      `${craftT('hAll')}\t${r[2] != null ? prezzo(r[2]) : '—'} · ${num(r[1], 0)} ${vendite}`,
    )}/></g>`;
  }).join('');

  const meta3 = Math.floor(righe.length / 2);
  return `<svg class="wp-ecn-mchart wp-crf-hchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(craftT('secHistory'))}">
      ${guide}
      <line class="wp-ecn-grid" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>
      <text class="wp-ecn-axis" x="${L - 6}" y="${base - VOL + 8}" text-anchor="end">${escapeHtml(num(maxN, 0))}</text>
      ${barre}
      ${linee}
      <text class="wp-ecn-axis" x="${L}" y="${H - 7}">${escapeHtml(etichettaTempo(t0, step))}</text>
      ${righe.length > 4 ? `<text class="wp-ecn-axis" x="${x(istante(righe[meta3], step)).toFixed(1)}" y="${H - 7}" text-anchor="middle">${escapeHtml(etichettaTempo(istante(righe[meta3], step), step))}</text>` : ''}
      <text class="wp-ecn-axis" x="${W - R}" y="${H - 7}" text-anchor="end">${escapeHtml(etichettaTempo(t1, step))}</text>
      ${colonne}
    </svg>`;
}

function storicoHtml() {
  if (!_hCode || !_model.curves?.[_hCode]) _hCode = codiceIniziale();
  if (!_hCode) return `<p class="wp-ecn-note">${escapeHtml(craftT('notYet'))}</p>`;
  const rar = rarDi(_hCode);
  const p = pezzo(_hCode, rar);

  const chipRar = [1, 2, 3, 4, 5, 6].map(i => `<button type="button" class="wp-ecn-chip${i === rar ? ' active' : ''}" data-hrar="${i}"><b class="wp-crf-rname wp-crf-t${i}">${escapeHtml(craftT(M.RARITIES[i - 1]))}</b></button>`).join('');
  const chipPezzi = pezziDi(rar).map(({ code, n }) => {
    const pp = pezzo(code, rar);
    return `<button type="button" class="wp-ecn-chip wp-crf-hpiece${code === _hCode ? ' active' : ''}" data-hcode="${escapeHtml(code)}">${iconaHtml(pp.img, pp.tier)}${escapeHtml(pp.nome)} <small class="wp-crf-dim">${escapeHtml(num(n, 0))}</small></button>`;
  }).join('');
  const chipStep = ['day', '6h'].map(s => `<button type="button" class="wp-ecn-chip${_hStep === s ? ' active' : ''}" data-hstep="${s}">${escapeHtml(craftT(s === 'day' ? 'hStepDay' : 'hStep6h'))}</button>`).join('');

  const c = _hist.get(histKey());
  let corpo;
  // Durante il caricamento si tiene l'altezza del grafico: senza, il riquadro
  // si accorcia e la pagina torna in cima a ogni cambio di pezzo o di passo.
  if (!c) corpo = `<div class="wp-ecn-loading" style="min-height:520px">${escapeHtml(ecoT('loading'))}</div>`;
  else if (!c.data) corpo = `<p class="wp-ecn-note">${escapeHtml(craftT('hNoRoute'))}</p>`;
  else if (c.data.rows.length < 2) corpo = `<p class="wp-ecn-note">${escapeHtml(craftT('hEmpty'))}</p>`;
  else corpo = kpiStoricoHtml(c.data) + `<div class="wp-crf-hscroll">${graficoStoricoHtml(c.data)}</div>` + legendaHtml() + noteStoricoHtml(c.data);

  return `
    <section class="wp-ecn-msec" data-nosort>
      <div class="wp-crf-hsel">${chipRar}</div>
      <div class="wp-crf-hsel">${chipPezzi}</div>
      <h3 class="wp-crf-h3" data-sec="crf-history">${iconaHtml(p.img, p.tier)}${escapeHtml(craftT('hTitle', { p: p.nome }))}</h3>
      <div class="wp-crf-hsel">${chipStep}</div>
      ${corpo}
    </section>`;
}

function kpiStoricoHtml(dati) {
  const righe = dati.rows;
  // I confronti sui secchi COMPLETI: l'ultimo è a metà.
  const complete = dati.partialLast && righe.length > 2 ? righe.slice(0, -1) : righe;
  const step = dati.step;
  const kpi = [2, 1, 0].map(b => {
    const col = 3 + b * 2 + 1;
    const conValore = complete.filter(r => r[col] != null);
    if (!conValore.length) return kpiHtml(craftT('band' + b), '—', '');
    const primo = conValore[0], ultimo = conValore[conValore.length - 1];
    const varz = primo !== ultimo && primo[col] ? ultimo[col] / primo[col] - 1 : null;
    return kpiHtml(craftT('band' + b), prezzo(ultimo[col]),
      varz != null ? craftT('hSince', { v: pctFirmato(varz), d: etichettaTempo(istante(primo, step), step) }) : '',
      segno(varz));
  });
  const media = complete.reduce((s, r) => s + r[1], 0) / complete.length;
  kpi.push(kpiHtml(craftT(step === '6h' ? 'hSales6h' : 'hSalesDay'), num(media, 0), craftT('hAvg')));
  return `<div class="wp-ecn-kpis wp-crf-hk">${kpi.join('')}</div>`;
}

function legendaHtml() {
  return `<div class="wp-crf-hleg">
      ${[2, 1, 0].map(b => `<span><i class="wp-crf-hsw wp-crf-hc${b}"></i>${escapeHtml(craftT('band' + b))}</span>`).join('')}
      <span><i class="wp-crf-hsw wp-crf-hswvol"></i>${escapeHtml(craftT('hVolume'))}</span>
    </div>`;
}

function noteStoricoHtml(dati) {
  const primo = dati.rows[0];
  return `
    <p class="wp-ecn-note">${escapeHtml(craftT('hNoteBands', { n: dati.minBand || 5 }))}</p>
    <p class="wp-ecn-note">${escapeHtml(dati.step === '6h' ? craftT('hNote6h') : craftT('hNoteDay', { d: etichettaTempo(istante(primo, 'day'), 'day') }))}</p>`;
}

async function caricaStorico(forza = false) {
  if (!_hCode) return;
  const key = histKey();
  const c = _hist.get(key);
  if (_hLoading.has(key) || (!forza && c && Date.now() - c.at < HIST_FRESCO_MS)) return;
  _hLoading.add(key);
  try {
    const [code, step] = key.split('|');
    const data = await fetchGearPriceHistoryViaCache(code, step);
    _hist.set(key, { at: Date.now(), data });
  } finally {
    _hLoading.delete(key);
    if (_view === 'history' && histKey() === key) paint();
  }
}

// ── Note di fondo ───────────────────────────────────────────────────
function noteHtml() {
  const m = _model;
  return `
    <p class="wp-ecn-note">${escapeHtml(craftT('noteSales', { n: new Intl.NumberFormat(lingua()).format(m.sales), d: m.windowDays, a: giorno(m.salesFrom), b: giorno(m.salesTo) }))}</p>
    <p class="wp-ecn-note">${escapeHtml(craftT('noteCurve'))}</p>`;
}

// ── Disegno ─────────────────────────────────────────────────────────
function corpoHtml() {
  if (!_model) return `<p class="wp-ecn-note">${escapeHtml(craftT('noServer'))}</p>`;
  if (!_prices) return `<p class="wp-ecn-note">${escapeHtml(craftT('noServer'))}</p>`;
  if (!_model.sales) return `<p class="wp-ecn-note">${escapeHtml(craftT('notYet'))}</p>`;
  if (_view === 'history') return storicoHtml();
  return (_view === 'craft' ? craftHtml() : casesHtml()) + noteHtml();
}

function paint() {
  if (!_container) return;
  _container.innerHTML = `
    <div class="wp-ecn-money wp-crf">
      <header class="wp-ecn-phead">
        <div>
          <h2>${escapeHtml(craftT('title'))}</h2>
          <p class="wp-ecn-sub">${escapeHtml(craftT('sub'))}</p>
        </div>
        <div class="wp-ecn-tools">
          ${['craft', 'cases', 'history'].map(v => `<button type="button" class="wp-ecn-chip${_view === v ? ' active' : ''}" data-view="${v}">${
            escapeHtml(craftT({ craft: 'secCraft', cases: 'secCases', history: 'secHistory' }[v]))}</button>`).join('')}
          <button type="button" class="wp-ecn-refresh"${_loading ? ' disabled' : ''}>${
            escapeHtml(_loading ? ecoT('refreshing') : ecoT('refresh'))}</button>
        </div>
      </header>
      ${_view === 'history' ? '' : `<div class="wp-crf-opts">
        <label title="${escapeHtml(craftT('taxTip'))}">${escapeHtml(craftT('tax'))}
          <input type="number" min="0" max="50" step="0.5" value="${+(_tax * 100).toFixed(2)}" id="wp-crf-tax" class="wp-ecn-search wp-crf-num"> %</label>
        ${_view === 'craft' ? `<label><input type="checkbox" id="wp-crf-steel"${_steel ? ' checked' : ''}> ${escapeHtml(craftT('steel'))}</label>` : ''}
      </div>`}
      ${_loading && !_model ? `<div class="wp-ecn-loading">${escapeHtml(ecoT('loading'))}</div>` : corpoHtml()}
    </div>`;
  collega();
  // Lo storico si chiede solo quando serve, un pezzo alla volta.
  if (_view === 'history' && _model?.sales && _hCode && !_hist.has(histKey())) caricaStorico();
}

function collega() {
  const c = _container;
  c.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { _view = b.dataset.view; paint(); }));
  c.querySelector('.wp-ecn-refresh')?.addEventListener('click', () => {
    if (_view === 'history') caricaStorico(true);
    carica(true);
  });
  c.querySelectorAll('[data-hrar]').forEach(b => b.addEventListener('click', () => {
    const lista = pezziDi(Number(b.dataset.hrar));
    // A parità di slot si resta sullo stesso pezzo (Elmo T4 → Elmo T5).
    const slot = SLOT_RE.exec(_hCode || '')?.[1];
    const stesso = lista.find(x => slot ? SLOT_RE.exec(x.code)?.[1] === slot : _model.curves[x.code]?.k === 'weapon');
    const scelto = stesso || lista.reduce((m, x) => (!m || x.n > m.n ? x : m), null);
    if (scelto) { _hCode = scelto.code; paint(); }
  }));
  c.querySelectorAll('[data-hcode]').forEach(b => b.addEventListener('click', () => { _hCode = b.dataset.hcode; paint(); }));
  c.querySelectorAll('[data-hstep]').forEach(b => b.addEventListener('click', () => { _hStep = b.dataset.hstep; paint(); }));
  c.querySelectorAll('[data-hgo]').forEach(b => b.addEventListener('click', () => { _hCode = b.dataset.hgo; _view = 'history'; paint(); }));
  c.querySelectorAll('[data-rar]').forEach(b => b.addEventListener('click', () => { _rar = Number(b.dataset.rar); paint(); }));
  c.querySelectorAll('[data-cust]').forEach(b => b.addEventListener('click', () => {
    const [r, s] = b.dataset.cust.split(':');
    _custom = { ..._custom, [r]: s };
    paint();
  }));
  c.querySelector('#wp-crf-tax')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    _tax = Number.isFinite(v) ? Math.min(Math.max(v, 0), 50) / 100 : M.DEFAULT_TAX;
    salva(); paint();
  });
  c.querySelector('#wp-crf-steel')?.addEventListener('change', (e) => { _steel = e.target.checked; salva(); paint(); });
  // Il lotto aggiorna solo il suo riquadro: ridisegnare tutto a ogni tasto
  // farebbe perdere il fuoco al campo mentre si scrive.
  c.querySelector('#wp-crf-n')?.addEventListener('input', (e) => {
    const v = Math.floor(Number(e.target.value));
    if (!Number.isFinite(v) || v < 1) return;
    _batchN = Math.min(v, 100000);
    const sel = M.craftRoi(_model, _prices, _rar, { tax: _tax, steel: _steel });
    const out = c.querySelector('#wp-crf-batch-out');
    if (out) out.innerHTML = batchOutHtml(M.craftBatch(sel, _batchN));
  });
}

// ── Caricamento ─────────────────────────────────────────────────────
async function carica(forza = false, soloPrezzi = false) {
  if (_loading) return;
  _loading = true;
  if (!soloPrezzi) paint();
  try {
    const [model, spot] = await Promise.all([
      soloPrezzi ? Promise.resolve(_model) : fetchGearMarketViaCache(),
      loadSpotPrices({ force: forza }).catch(() => null),
    ]);
    if (!soloPrezzi) { _model = model; _modelTs = Date.now(); }
    if (spot?.prices) {
      // Dal libro ordini, non dalla media di getPrices (vedi loadBookPrices).
      // Se il libro non risponde si resta sulla media, che è meglio di niente.
      _prices = await loadBookPrices(spot.prices).catch(() => spot.prices);
    }
    _woodOnSale = !!(await loadBonusRules().catch(() => null))?.mapCases;
  } finally {
    _loading = false;
    paint();
  }
}

function avviaGiro() {
  stopCraftingTab();
  _timer = setInterval(() => {
    _tick++;
    // I prezzi ogni 5 minuti, il modello (server) ogni tre giri.
    // WarEra+: se il modello non è mai arrivato (server in riavvio, rete
    // caduta all'apertura) si riprova a ogni giro e non fra un quarto d'ora:
    // la scheda altrimenti resta su "il server non risponde" anche a
    // server tornato.
    carica(true, !!_model && _tick % MODEL_EVERY_TICKS !== 0);
  }, PRICE_EVERY_MS);
}

export async function initCraftingTab(container) {
  _container = container;
  avviaGiro();
  if (_model && _prices && Date.now() - _modelTs < FRESCO_MS) { paint(); return; }
  await carica();
}

export function retranslateCraftingTab() {
  if (_container) paint();
}

export function stopCraftingTab() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
