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
import { fetchGearMarketViaCache } from '../diplomacy/cacheClient.js';
import { loadSpotPrices } from '../market/api.js';
import * as M from './craftingModel.js';

// ── Stato della scheda ──────────────────────────────────────────────
let _container = null;
let _model = null;          // risposta di /gear-market, null = non risponde
let _prices = null;
let _modelTs = 0;
let _loading = false;
let _view = 'craft';        // 'craft' | 'cases'
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

const nomePezzo = (code) => {
  const m = /^(helmet|chest|pants|boots|gloves)(\d)$/.exec(code);
  return m ? craftT(m[1]) : craftT('weapon');
};

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
function kpiHtml(etichetta, valore, nota, cls = '') {
  return `<div class="wp-ecn-kpi">
      <em>${escapeHtml(etichetta)}</em>
      <strong class="${cls}">${escapeHtml(valore)}</strong>
      ${nota ? `<small>${escapeHtml(nota)}</small>` : ''}
    </div>`;
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
        <span class="wp-crf-rname">${escapeHtml(craftT(r.rarity))}${migliore && r.rarityIdx === migliore.rarityIdx
    ? ` <b class="wp-crf-best">${escapeHtml(craftT('best'))}</b>` : ''}</span>
        <strong class="wp-crf-roi${segno(r.roi)}">${escapeHtml(pctFirmato(r.roi))}</strong>
        <span class="wp-crf-line${segno(r.margin)}">${escapeHtml(firmato(r.margin))} ${escapeHtml(craftT('perCraft'))}</span>
        <span class="wp-crf-line wp-crf-dim">${escapeHtml(craftT('costEv'))}<br>${escapeHtml(prezzo(r.cost))} → ${escapeHtml(r.ev != null ? prezzo(r.ev) : '—')}</span>
        <span class="wp-crf-line wp-crf-dim">${escapeHtml(craftT('pWin'))} ${escapeHtml(pct(r.pProfit, 0))}</span>
      </button>`).join('');

  const righe = sel.outcomes.map(o => `
      <div class="wp-crf-row">
        <span class="wp-crf-piece"><b>${escapeHtml(nomePezzo(o.code))}</b> <small class="wp-crf-dim">${escapeHtml(o.code)}</small></span>
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
        ${kpiHtml(craftT('kCost'), prezzo(sel.cost), `${sel.scraps} scraps${sel.steel ? ` + ${sel.steel} steel` : ''}`)}
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
    return `<div class="wp-crf-case"><h3>${escapeHtml(nome)}</h3>
      <p class="wp-ecn-note">${escapeHtml(craftT('casePrice'))}: ${escapeHtml(prezzo(prezzoCassa))} · ${escapeHtml(craftT('caseFew'))}</p></div>`;
  }
  const apri = strat.opt.ev > venditaChiusa;
  const riga = (k, v) => `<div class="wp-crf-crow">
      <span>${escapeHtml(craftT(k))}</span>
      <span class="wp-ecn-num">${escapeHtml(v != null ? prezzo(v) : '—')}</span>
      <span class="wp-ecn-num${v != null ? segno(v - venditaChiusa) : ''}">${v != null && k !== 'stratSell' ? escapeHtml(firmato(v - venditaChiusa, 3)) : '—'}</span>
    </div>`;
  return `<div class="wp-crf-case">
      <header>
        <h3>${escapeHtml(nome)}</h3>
        <span class="wp-crf-verdict ${apri ? 'wp-crf-pos' : 'wp-crf-neg'}">${escapeHtml(craftT(apri ? 'verdictOpen' : 'verdictSell'))}</span>
      </header>
      <div class="wp-ecn-kpis wp-crf-mini">
        ${kpiHtml(craftT('casePrice'), prezzo(prezzoCassa), craftT('opens', { n: strat.opt.opens }))}
        ${kpiHtml(craftT('roiBuy'), pctFirmato(strat.opt.ev / prezzoCassa - 1), craftT('stratOpt'), segno(strat.opt.ev - prezzoCassa))}
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
  if (!w || p == null) return '';
  const apri = w.ev > p * (1 - _tax);
  return `<div class="wp-crf-case">
      <header>
        <h3>${escapeHtml(craftT('woodenCase'))}</h3>
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
  const custom = M.RARITIES.map(r => `
      <span class="wp-crf-crar">${escapeHtml(craftT(r))}
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

// ── Note di fondo ───────────────────────────────────────────────────
function noteHtml() {
  const m = _model;
  return `
    <p class="wp-ecn-note">${escapeHtml(craftT('noteSales', { n: new Intl.NumberFormat(lingua()).format(m.sales), d: m.windowDays, a: giorno(m.salesFrom), b: giorno(m.salesTo) }))}</p>
    <p class="wp-ecn-note">${escapeHtml(craftT('noteCurve'))}</p>
    ${_steel && _view === 'craft' ? `<p class="wp-ecn-note">${escapeHtml(craftT('noteSteel'))}</p>` : ''}`;
}

// ── Disegno ─────────────────────────────────────────────────────────
function corpoHtml() {
  if (!_model) return `<p class="wp-ecn-note">${escapeHtml(craftT('noServer'))}</p>`;
  if (!_prices) return `<p class="wp-ecn-note">${escapeHtml(craftT('noServer'))}</p>`;
  if (!_model.sales) return `<p class="wp-ecn-note">${escapeHtml(craftT('notYet'))}</p>`;
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
          ${['craft', 'cases'].map(v => `<button type="button" class="wp-ecn-chip${_view === v ? ' active' : ''}" data-view="${v}">${
            escapeHtml(craftT(v === 'craft' ? 'secCraft' : 'secCases'))}</button>`).join('')}
          <button type="button" class="wp-ecn-refresh"${_loading ? ' disabled' : ''}>${
            escapeHtml(_loading ? ecoT('refreshing') : ecoT('refresh'))}</button>
        </div>
      </header>
      <div class="wp-crf-opts">
        <label title="${escapeHtml(craftT('taxTip'))}">${escapeHtml(craftT('tax'))}
          <input type="number" min="0" max="50" step="0.5" value="${+(_tax * 100).toFixed(2)}" id="wp-crf-tax" class="wp-ecn-search wp-crf-num"> %</label>
        ${_view === 'craft' ? `<label><input type="checkbox" id="wp-crf-steel"${_steel ? ' checked' : ''}> ${escapeHtml(craftT('steel'))}</label>` : ''}
      </div>
      ${_loading && !_model ? `<div class="wp-ecn-loading">${escapeHtml(ecoT('loading'))}</div>` : corpoHtml()}
    </div>`;
  collega();
}

function collega() {
  const c = _container;
  c.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { _view = b.dataset.view; paint(); }));
  c.querySelector('.wp-ecn-refresh')?.addEventListener('click', () => carica(true));
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
    _prices = spot?.prices || _prices;
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
    carica(true, _tick % MODEL_EVERY_TICKS !== 0);
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
