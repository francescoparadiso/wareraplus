/* ══════════════════════════════════════════════════════════════
   WarEra+ — Rendite di produzione (src/market/*)
   ------------------------------------------------------------------
   Vista NUOVA sotto "Approfondimenti", sorella dell'Ottimizzatore
   industriale e volutamente separata da lui: l'Ottimizzatore parte da
   uno username e sistema le aziende che HAI GIÀ, questa risponde alle
   due domande di chi deve ancora decidere — cosa produrre e dove
   aprire. Per questo non chiede nulla: si apre e mostra la tabella.

   Richiesta nata in chat (iltrulloparlante, frappa10): «una lista di
   tutte le risorse classate per rendita per punto produzione, con nome,
   rendita/pp, regione e bonus, tassazione» più «il punto zero del wage
   per un impiegato per avere ritorno nullo».

   TRE COSE DA SAPERE PRIMA DI TOCCARLA

   1. Le formule stanno in model.js e sono PURE: cambiare la paga
      ricalcola le righe in memoria, senza una sola richiesta di rete.
   2. I dati stanno in api.js, con due orologi diversi (prezzi 5 min,
      regioni consigliate 30 min) — vedi il commento in testa a quel
      file. Qui si aggiunge solo il giro automatico mentre la vista è
      aperta, che va FERMATO alla chiusura: `stopMarketAutoRefresh()`,
      chiamata da src/app/marketOverlay.js. Un timer lasciato acceso
      dietro un overlay chiuso è già costato CPU una volta in questo
      progetto (il canvas di Political), non ripetiamolo.
   3. Il bonus è sempre quello che dice il gioco, mai ricalcolato qui.
   ══════════════════════════════════════════════════════════════ */

import '../styles/market.css';
import { mktT } from './i18n.js';
import { loadMarketData, PRICE_TTL_MS } from './api.js';
import {
  buildRows, sortRows, COLUMNS, THIN_BOOK_QTY,
  workerPointsPerDay, enginePointsPerDay, fidelityConfig, fidelityPercent,
} from './model.js';
import { escapeHtml, flagImg, fmtCompact, fmtRelative } from '../mu/ui.js';
import { trackEvent } from '../shared/analytics.js';

const SIM_KEY = 'we_mkt_sim';

let rootEl = null;
let data = null;
let rows = [];
let sort = { key: 'perPoint', dir: -1 };
let filter = 'all';                 // 'all' | 'raw' | 'product'
let expanded = null;                // codice risorsa con la riga aperta
let loading = false;
let loadError = null;
let langBound = false;
let timer = null;

/* Impostazioni del simulatore. Energia 130 / produzione 40 è un
   lavoratore a competenze piene (i massimi delle tabelle skill del
   gioco): dà numeri concreti al primo colpo, e chi ne ha uno diverso
   cambia i due campi. La paga parte a zero, cioè "azienda che lavora da
   sola": la prima colonna utile resta la rendita. */
const SIM_DEFAULTS = { wage: 0, energy: 130, production: 40, days: 1 };
/* Lo slider vive dentro la fedeltà e basta: un giorno (il primo, bonus
   appena maturato) fino al decimo, dove il gioco mette il tetto. Oltre non
   cambierebbe più niente per punto — l'unica cosa che continuerebbe a
   salire è il totale accumulato, e per quello basta moltiplicare. */
const MIN_DAYS = 1;
const MAX_DAYS = 10;   // = gameConfig.worker.maxFidelity
let sim = { ...SIM_DEFAULTS };
let simSeeded = false;   // la paga è già stata scelta (dall'utente o da noi)

function loadSim() {
  try {
    const raw = JSON.parse(localStorage.getItem(SIM_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      sim = {
        wage: Number(raw.wage) || 0,
        energy: Number(raw.energy) || SIM_DEFAULTS.energy,
        production: Number(raw.production) || SIM_DEFAULTS.production,
        // Il salvataggio può venire da una versione con un altro intervallo
        // (lo slider arrivava a 30): si riporta dentro, non si scarta.
        days: Math.min(Math.max(Number(raw.days) || MIN_DAYS, MIN_DAYS), MAX_DAYS),
      };
      simSeeded = true;
    }
  } catch (_) { /* storage negato: si resta ai valori di default */ }
}

/* Paga di partenza: l'80% della rendita migliore sul mercato di adesso.
   È la stessa convenzione della sezione Assunzioni dell'Ottimizzatore
   (eco/hiring.js: il proprietario tiene circa un quinto), e serve a far
   trovare all'utente delle colonne "Tu /giorno" e "Lavoratore /giorno"
   già piene di numeri sensati invece che di zeri. Si semina una volta
   sola: appena l'utente tocca il campo, comanda lui. */
function seedWage(sample) {
  if (simSeeded) return;
  const best = sample.reduce((m, r) => (Number.isFinite(r.perPoint) && r.perPoint > m ? r.perPoint : m), 0);
  if (best > 0) sim.wage = Math.round(best * 0.8 * 10000) / 10000;
  simSeeded = true;
}
function saveSim() {
  try { localStorage.setItem(SIM_KEY, JSON.stringify(sim)); } catch (_) {}
}

/* Modalità prezzo e tassa: preferenze di lettura, stessa cassa. */
const OPT_KEY = 'we_mkt_opts';
let opts = { execPrices: false, netMarketTax: false };
function loadOpts() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPT_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      opts = { execPrices: !!raw.execPrices, netMarketTax: !!raw.netMarketTax };
    }
  } catch (_) {}
}
function saveOpts() {
  try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (_) {}
}

// ══ Ciclo di vita ══════════════════════════════════════════════════
export async function initMarketView(container) {
  rootEl = container;
  loadSim();
  loadOpts();
  bindLangChange();
  if (!data) await refresh({ first: true });
  else render();
  startAutoRefresh();
  trackEvent('market-open');
}

function bindLangChange() {
  if (langBound) return;
  langBound = true;
  window.addEventListener('wareraplus:langchange', () => { if (rootEl && data) render(); });
}

/** Giro automatico dei soli prezzi: l'utente li vuole freschi («almeno
 *  una volta all'ora, più spesso meglio è»), e costano una richiesta
 *  pubblica. Si ferma alla chiusura dell'overlay e quando la scheda va
 *  in secondo piano — rinfrescare una tabella che nessuno guarda è
 *  traffico buttato. */
function startAutoRefresh() {
  stopMarketAutoRefresh();
  timer = setInterval(() => {
    if (document.hidden || !rootEl?.isConnected) return;
    refresh({ pricesOnly: true, silent: true });
  }, PRICE_TTL_MS);
}

export function stopMarketAutoRefresh() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function refresh({ force = false, pricesOnly = false, silent = false, first = false } = {}) {
  if (loading) return;
  loading = true;
  loadError = null;
  if (!silent) render();
  try {
    data = await loadMarketData({ force, pricesOnly });
  } catch (err) {
    loadError = err?.message || String(err);
    console.warn('[market] caricamento fallito:', loadError);
  } finally {
    loading = false;
    render();
    if (first && data) {
      trackEvent('market-loaded', { items: data.items.length, regions: Object.keys(data.regionsByItem).length });
    }
  }
}

// ══ Numeri ═════════════════════════════════════════════════════════
/** Oro: il mercato di WarEra lavora sui millesimi (grain a 0,0767), e
 *  troncare a due decimali cancellerebbe proprio le differenze che
 *  questa tabella esiste per mostrare. */
function gold(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = decimals != null ? decimals : (Math.abs(v) < 1 ? 4 : Math.abs(v) < 100 ? 3 : 2);
  return v.toFixed(d);
}
function pct(v, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(decimals)}%`;
}
function signedGold(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = Math.abs(v) >= 1000 ? fmtCompact(Math.abs(v)) : Math.abs(v).toFixed(2);
  return `${v < 0 ? '−' : '+'}${s}`;
}

// ══ Render ═════════════════════════════════════════════════════════
/* DUE LIVELLI DI RIDISEGNO, e la differenza non è un'ottimizzazione: è un
   bug vero, segnalato dall'utente. Rifare `rootEl.innerHTML` ad ogni
   evento `input` distrugge il controllo che l'utente sta USANDO — con lo
   slider dei giorni si vedeva subito: il cursore avanzava di una tacca e
   poi il trascinamento moriva, perché l'elemento sotto il dito non
   esisteva più (e rimettere il focus non restituisce il puntatore).

   · render()  — pagina intera: apertura, cambio lingua, dati nuovi,
                 click su filtri/prezzi/tassa. Nessuno di questi arriva
                 mentre si tiene premuto qualcosa.
   · repaint() — solo i numeri (#wp-mkt-body) più le etichette vive della
                 barra. La barra degli strumenti NON viene ricreata,
                 quindi slider e campi numerici restano gli stessi nodi:
                 il trascinamento continua e il cursore di testo non
                 salta. Lo usano lo slider, i tre campi, l'ordinamento e
                 l'apertura di una riga.

   Chi tocca questo file: se aggiungi un controllo che si tiene premuto o
   in cui si digita, aggancialo a repaint(), non a render(). */
function render() {
  if (!rootEl) return;

  if (!data) {
    rootEl.innerHTML = `<div class="wp-mkt-page"><div class="wp-mkt-empty">${
      escapeHtml(loadError ? mktT('empty') : mktT('loading'))}</div></div>`;
    return;
  }

  const ppDay = computeRows();

  rootEl.innerHTML = `
    <div class="wp-mkt-page">
      <header class="wp-mkt-masthead">
        <h2 class="wp-mkt-title">${escapeHtml(mktT('title'))}</h2>
        <p class="wp-mkt-subtitle">${escapeHtml(mktT('subtitle'))}</p>
      </header>

      ${toolbarHtml(ppDay)}
      <div id="wp-mkt-body">${bodyHtml(ppDay)}</div>
    </div>`;

  wireToolbar();
  wireBody();
}

/** Ricalcola `rows` dalle impostazioni correnti e torna i punti/giorno del
 *  lavoratore di riferimento (serve a barra e legenda). */
function computeRows() {
  const ppDay = workerPointsPerDay(sim.energy, sim.production);
  if (!simSeeded) seedWage(buildRows(data, { execPrices: opts.execPrices, netMarketTax: opts.netMarketTax }));
  rows = buildRows(data, {
    execPrices: opts.execPrices,
    netMarketTax: opts.netMarketTax,
    wage: sim.wage,
    workerPpDay: ppDay,
    days: sim.days,
  });
  return ppDay;
}

function bodyHtml(ppDay) {
  const visible = sortRows(rows.filter(r => filter === 'all' || r.type === filter), sort.key, sort.dir);
  return `
    ${data.regionsError || !Object.keys(data.regionsByItem).length
      ? `<p class="wp-mkt-notice">${escapeHtml(mktT('regionsMissing'))}</p>` : ''}
    ${tableHtml(visible)}
    <p class="wp-mkt-legend">${escapeHtml(mktT('legend'))}</p>
    <p class="wp-mkt-legend">${escapeHtml(mktT('simNote', { n: Math.round(ppDay) }))}
      ${escapeHtml(mktT('fidelityNote'))}
      ${escapeHtml(mktT('priceHint'))}</p>`;
}

/** Ridisegna i soli numeri, lasciando in vita i controlli della barra. */
function repaint() {
  const body = rootEl?.querySelector('#wp-mkt-body');
  if (!body) { render(); return; }

  const ppDay = computeRows();
  // La tabella è più larga dello schermo: rifarla senza rimettere lo
  // scorrimento orizzontale dov'era la riporterebbe a sinistra ad ogni
  // tacca dello slider.
  const scrollLeft = body.querySelector('.wp-mkt-table-wrap')?.scrollLeft || 0;
  body.innerHTML = bodyHtml(ppDay);
  const wrap = body.querySelector('.wp-mkt-table-wrap');
  if (wrap && scrollLeft) wrap.scrollLeft = scrollLeft;

  // Le due etichette della barra che dipendono dai campi: si aggiornano a
  // mano, senza ricostruire la barra (vedi il commento sopra render()).
  const fid = fidelityConfig(data.gameConfig);
  rootEl.querySelector('#wp-mkt-days')?.style.setProperty('--fill', `${daysFillPct()}%`);
  const daysVal = rootEl.querySelector('.wp-mkt-daysval');
  if (daysVal) {
    daysVal.innerHTML = `${sim.days}
      <span class="wp-mkt-fid">${escapeHtml(mktT('fidelity', { n: fidelityPercent(sim.days, fid) }))}</span>`;
  }
  const ppEl = rootEl.querySelector('.wp-mkt-ppdayval');
  if (ppEl) ppEl.textContent = mktT('ppDay', { n: Math.round(ppDay) });

  wireBody();
}

/** Quanta traccia è percorsa, in percentuale: la disegniamo noi (vedi
 *  market.css), così al decimo giorno il riempimento chiude davvero. */
function daysFillPct() {
  const span = MAX_DAYS - MIN_DAYS;
  return span > 0 ? ((sim.days - MIN_DAYS) / span) * 100 : 100;
}

function toolbarHtml(ppDay) {
  const age = data.pricesTs ? fmtRelative(new Date(data.pricesTs).toISOString()) : '—';
  const engine = enginePointsPerDay(data.gameConfig, 1);
  const fid = fidelityConfig(data.gameConfig);
  const fidPct = fidelityPercent(sim.days, fid);
  return `
    <div class="wp-mkt-toolbar">
      <div class="wp-mkt-seg" role="group">
        ${['all', 'raw', 'product'].map(f => `
          <button type="button" data-filter="${f}" class="${filter === f ? 'active' : ''}">${
            escapeHtml(mktT(f === 'all' ? 'filterAll' : f === 'raw' ? 'filterRaw' : 'filterProduct'))}</button>`).join('')}
      </div>

      <div class="wp-mkt-seg" role="group">
        <button type="button" data-price="ref" class="${opts.execPrices ? '' : 'active'}">${escapeHtml(mktT('priceRef'))}</button>
        <button type="button" data-price="exec" class="${opts.execPrices ? 'active' : ''}">${escapeHtml(mktT('priceExec'))}</button>
      </div>

      <label class="wp-mkt-check" title="${escapeHtml(mktT('netMarketTaxHint'))}">
        <input type="checkbox" id="wp-mkt-nettax"${opts.netMarketTax ? ' checked' : ''}>
        <span>${escapeHtml(mktT('netMarketTax'))}</span>
      </label>

      <div class="wp-mkt-sim">
        <span class="wp-mkt-simlabel">${escapeHtml(mktT('simTitle'))}</span>
        <label>${escapeHtml(mktT('wage'))}
          <input type="number" id="wp-mkt-wage" step="0.001" min="0" value="${sim.wage}" title="${escapeHtml(mktT('wageHint'))}">
        </label>
        <label>${escapeHtml(mktT('energy'))}
          <input type="number" id="wp-mkt-energy" step="1" min="0" value="${sim.energy}">
        </label>
        <label>${escapeHtml(mktT('production'))}
          <input type="number" id="wp-mkt-prod" step="1" min="0" value="${sim.production}">
        </label>
        <span class="wp-mkt-ppday"><span class="wp-mkt-ppdayval">${escapeHtml(mktT('ppDay', { n: Math.round(ppDay) }))}</span>
          <span class="wp-mkt-dim" title="${escapeHtml(mktT('engineHint'))}">⚙ ${escapeHtml(mktT('ppDay', { n: engine }))}</span></span>

        <label class="wp-mkt-days" title="${escapeHtml(mktT('fidelityHint', { max: fid.maxDays * fid.perDay }))}">
          <span>${escapeHtml(mktT('days'))}</span>
          <input type="range" id="wp-mkt-days" min="${MIN_DAYS}" max="${MAX_DAYS}" step="1" value="${sim.days}"
                 style="--fill:${daysFillPct()}%">
          <span class="wp-mkt-daysval">${sim.days}
            <span class="wp-mkt-fid">${escapeHtml(mktT('fidelity', { n: fidPct }))}</span></span>
        </label>
      </div>

      <div class="wp-mkt-refresh">
        <span class="wp-mkt-dim">${escapeHtml(mktT('updated'))} ${escapeHtml(age)}</span>
        <button type="button" id="wp-mkt-refresh"${loading ? ' disabled' : ''}>${
          escapeHtml(loading ? mktT('refreshing') : mktT('refresh'))}</button>
      </div>
    </div>`;
}

function tableHtml(list) {
  if (!list.length) return `<div class="wp-mkt-empty">${escapeHtml(mktT('empty'))}</div>`;

  const head = COLUMNS.map(c => `
    <button type="button" class="wp-mkt-th${c.num ? ' wp-mkt-num' : ''}${sort.key === c.key ? ' active' : ''}"
            data-sort="${c.key}" data-dir="${sort.dir}"
            title="${escapeHtml(mktT(c.label, { n: sim.days }))}">${escapeHtml(mktT(c.label, { n: sim.days }))}</button>`).join('');

  const body = list.map(r => rowHtml(r)).join('');

  return `<div class="wp-mkt-table-wrap"><div class="wp-mkt-table">
    <div class="wp-mkt-thead">${head}</div>
    ${body}
  </div></div>`;
}

function rowHtml(r) {
  const thinSell = opts.execPrices && r.bid != null && r.bidQty < THIN_BOOK_QTY;
  const over = sim.wage > 0 && r.marginPerPoint < 0;
  const best = r.best;

  const row = `
    <div class="wp-mkt-row${expanded === r.code ? ' open' : ''}" role="button" tabindex="0" data-row="${r.code}">
      <span class="wp-mkt-item">
        <span class="wp-mkt-code">${escapeHtml(r.code)}</span>
        <span class="wp-mkt-type wp-mkt-type-${r.type}">${escapeHtml(mktT(r.type === 'raw' ? 'raw' : 'product'))}</span>
      </span>
      <span class="wp-mkt-num">${escapeHtml(gold(r.sell))}${thinSell ? '<span class="wp-mkt-thin" title="' + escapeHtml(mktT('thin', { n: r.bidQty })) + '">△</span>' : ''}</span>
      <span class="wp-mkt-num">${r.materials.length ? escapeHtml(gold(r.rawCost)) : '—'}</span>
      <span class="wp-mkt-num">${r.pp}</span>
      <span class="wp-mkt-num">${escapeHtml(gold(r.basePerPoint))}</span>
      <span class="wp-mkt-num wp-mkt-bonus">${r.bonus == null ? '—' : '+' + escapeHtml(pct(r.bonus))}</span>
      <span class="wp-mkt-num wp-mkt-yield">${escapeHtml(gold(r.perPoint))}</span>
      <span class="wp-mkt-region">${best
        ? `${best.countryId ? flagImg(best.countryId, 'wp-mkt-flag') : ''}<span class="wp-mkt-rname">${escapeHtml(best.regionName || best.regionId)}</span>`
        : `<span class="wp-mkt-dim">${escapeHtml(mktT('noRegion'))}</span>`}</span>
      <span class="wp-mkt-num">${r.incomeTax == null ? '—' : escapeHtml(pct(r.incomeTax))}</span>
      <span class="wp-mkt-num wp-mkt-break${over ? ' over' : ''}"${over ? ` title="${escapeHtml(mktT('lossWarn'))}"` : ''}>${escapeHtml(gold(r.breakEven))}</span>
      <span class="wp-mkt-num ${r.ownerPerDay < 0 ? 'neg' : 'pos'}">${escapeHtml(signedGold(r.ownerPerDay))}</span>
      <span class="wp-mkt-num">${escapeHtml(signedGold(r.workerNetPerDay))}</span>
      <span class="wp-mkt-num wp-mkt-total ${r.ownerTotal < 0 ? 'neg' : 'pos'}">${escapeHtml(signedGold(r.ownerTotal))}</span>
    </div>`;

  return row + (expanded === r.code ? detailHtml(r) : '');
}

function detailHtml(r) {
  const regions = r.regions.map(reg => {
    const parts = [
      [mktT('depositB'), reg.depositBonus],
      [mktT('ethicDepositB'), reg.ethicDepositBonus],
      [mktT('strategicB'), reg.strategicBonus],
      [mktT('specializationB'), reg.ethicSpecializationBonus],
    ].filter(([, v]) => v).map(([label, v]) => `<span class="wp-mkt-part">${escapeHtml(label)} +${escapeHtml(pct(v))}</span>`).join('');

    const ends = reg.depositEndAt && reg.depositBonus
      ? `<span class="wp-mkt-dim">${escapeHtml(mktT('depositEnds', { when: fmtRelative(reg.depositEndAt) }))}</span>` : '';

    // La rendita di QUESTA regione, non solo della prima: è la domanda
    // vera quando la migliore è in un paese che tassa il triplo.
    const yieldHere = r.basePerPoint * (1 + reg.bonus / 100);
    return `
      <div class="wp-mkt-regrow">
        <span class="wp-mkt-region">${reg.countryId ? flagImg(reg.countryId, 'wp-mkt-flag') : ''}
          <span class="wp-mkt-rname">${escapeHtml(reg.regionName || reg.regionId)}</span>
          <span class="wp-mkt-dim">${escapeHtml(reg.countryName || '')}</span></span>
        <span class="wp-mkt-num wp-mkt-bonus">+${escapeHtml(pct(reg.bonus))}</span>
        <span class="wp-mkt-num wp-mkt-yield">${escapeHtml(gold(yieldHere))}</span>
        <span class="wp-mkt-num">${escapeHtml(pct(reg.incomeTax))}</span>
        <span class="wp-mkt-parts">${parts}${ends}</span>
      </div>`;
  }).join('');

  const mats = r.materials.length
    ? r.materials.map(m => `<span class="wp-mkt-mat">${m.qty}× ${escapeHtml(m.code)} @ ${escapeHtml(gold(m.price))} = ${escapeHtml(gold(m.cost))}</span>`).join('')
    : `<span class="wp-mkt-dim">${escapeHtml(mktT('noNeeds'))}</span>`;

  return `
    <div class="wp-mkt-detail">
      <div class="wp-mkt-dcol">
        <h4>${escapeHtml(mktT('detailPrices'))}</h4>
        <div class="wp-mkt-dlist">
          <span>${escapeHtml(mktT('refPriceL'))}: <b>${escapeHtml(gold(r.refPrice))}</b></span>
          <span>${escapeHtml(mktT('bidL'))}: <b>${escapeHtml(gold(r.bid))}</b> <span class="wp-mkt-dim">× ${fmtCompact(r.bidQty)}</span></span>
          <span>${escapeHtml(mktT('askL'))}: <b>${escapeHtml(gold(r.ask))}</b> <span class="wp-mkt-dim">× ${fmtCompact(r.askQty)}</span></span>
        </div>
        <h4>${escapeHtml(mktT('materialsL'))}</h4>
        <div class="wp-mkt-dlist">${mats}</div>
      </div>
      <div class="wp-mkt-dcol wp-mkt-dregions">
        <h4>${escapeHtml(mktT('best5'))} <span class="wp-mkt-dim">· ${escapeHtml(mktT('bonusParts'))}</span></h4>
        ${regions || `<span class="wp-mkt-dim">${escapeHtml(mktT('noRegion'))}</span>`}
      </div>
    </div>`;
}

// ══ Eventi ═════════════════════════════════════════════════════════
/* Barra degli strumenti: agganciata una volta per render(), perché i suoi
   nodi sopravvivono ai repaint. */
function wireToolbar() {
  const q = sel => rootEl.querySelector(sel);

  rootEl.querySelectorAll('[data-filter]').forEach(b => {
    b.addEventListener('click', () => { filter = b.dataset.filter; render(); });
  });
  rootEl.querySelectorAll('[data-price]').forEach(b => {
    b.addEventListener('click', () => {
      opts.execPrices = b.dataset.price === 'exec';
      saveOpts(); render();
      trackEvent('market-price-mode', { mode: b.dataset.price });
    });
  });
  q('#wp-mkt-nettax')?.addEventListener('change', e => {
    opts.netMarketTax = e.target.checked; saveOpts(); render();
  });
  q('#wp-mkt-refresh')?.addEventListener('click', () => {
    refresh({ force: true });
    trackEvent('market-refresh');
  });

  /* I tre campi del simulatore e lo slider ricalcolano SOLO in memoria
     (model.js è puro): nessuna fetch mentre si digita o si trascina, e
     nessuna ricostruzione della barra — l'elemento resta lo stesso, quindi
     il trascinamento prosegue e il cursore di testo non salta. */
  const bindNum = (sel, key) => {
    const el = q(sel);
    if (!el) return;
    // Un campo numerico col fuoco addosso cambia valore alla rotellina:
    // scorrendo la tabella si sposterebbero di nascosto tutti i numeri
    // della pagina. Si toglie il fuoco invece di lasciarlo succedere.
    el.addEventListener('wheel', () => { if (document.activeElement === el) el.blur(); }, { passive: true });
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      sim[key] = Number.isFinite(v) && v >= 0 ? v : 0;
      saveSim();
      repaint();
    });
  };
  const daysEl = q('#wp-mkt-days');
  if (daysEl) {
    daysEl.addEventListener('input', () => {
      sim.days = Math.min(Math.max(parseInt(daysEl.value, 10) || MIN_DAYS, MIN_DAYS), MAX_DAYS);
      saveSim();
      repaint();
    });
  }

  bindNum('#wp-mkt-wage', 'wage');
  bindNum('#wp-mkt-energy', 'energy');
  bindNum('#wp-mkt-prod', 'production');
}

/* Tabella: ricreata ad ogni repaint, quindi i suoi ascoltatori vanno
   riagganciati ogni volta. */
function wireBody() {
  rootEl.querySelectorAll('.wp-mkt-th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      const col = COLUMNS.find(c => c.key === k);
      if (sort.key === k) sort.dir *= -1;
      else sort = { key: k, dir: col?.text ? 1 : -1 };
      repaint();
    });
  });

  const toggleRow = code => { expanded = expanded === code ? null : code; repaint(); };
  rootEl.querySelectorAll('.wp-mkt-row[data-row]').forEach(row => {
    row.addEventListener('click', () => toggleRow(row.dataset.row));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(row.dataset.row); }
    });
  });
}
