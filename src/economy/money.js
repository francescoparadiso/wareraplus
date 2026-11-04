/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: la scheda SOLDI
   ------------------------------------------------------------------
   La domanda: «quanti soldi ci sono nel gioco, e dove stanno?».
   Tre pezzi, che non si sovrappongono:

     · i PORTAFOGLI dei giocatori — la voce `money` di `stats.wealth`
       (`user.getUserById`, pubblica), sommata su tutta la classifica della
       ricchezza una volta al giorno (server/playerParts.js), per nazione
       e per unità;
     · i TESORI delle nazioni — `rankings.countryWealth`, che il server
       già archivia un giorno alla volta (dayHistory.js);
     · i soldi già messi negli ORDINI D'ACQUISTO — quantità × prezzo,
       con compratore e unità (server/orderMoney.js, un campione all'ora).
       ⚠️ Stanno FUORI dalla ricchezza dei giocatori: il gioco li toglie
       dal portafoglio quando l'ordine si piazza (su 40 compratori, 16
       avevano negli ordini più di `money`, diversi più dell'intero
       `total`). Si sommano ai portafogli, non li contano due volte.

   (Fino al 2026-11-03 questa scheda diceva che i portafogli «non si
   vedono»: era falso, avevo guardato `getUserLite` e non `getUserById`.)

   ── ⚠️ IL TOTALE DEGLI ORDINI È UN MINIMO ───────────────────────────
   `getTopOrders` si ferma a 100 ordini per libro. I libri che ci
   arrivano sono segnati (`≥`) e la scheda dice quanti sono: gli ordini
   col prezzo più basso, quelli che contano meno ma non zero, non si
   vedono.

   ── NIENTE RIPIEGO ──────────────────────────────────────────────────
   Una sola fonte, `/order-money` del server di cache. Se non risponde
   la scheda lo dice: ricostruire dal browser 24 libri ogni ora per un
   archivio che non c'è sarebbe una scheda diversa, non un ripiego.
   Come le altre schede, questo file non chiama `fetch`: passa da
   `cacheClient.js`.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../mu/ui.js';
import { ecoT } from './i18n.js';
import { moneyT } from './i18nMoney.js';
import { fetchOrderMoneyViaCache, fetchPlayerMoneyViaCache } from '../diplomacy/cacheClient.js';
import { getAllCountries, getCountryById } from '../shared/countries.js';
import { fetchMuDirectory } from '../mu/api.js';

// ── Stato della scheda ──────────────────────────────────────────────
let _container = null;
let _data = null;          // risposta di /order-money, null = non risponde
let _players = null;       // risposta di /player-money (portafogli), null = non c'è
let _giorni = 30;
let _loading = false;
let _ts = 0;
let _nomiMu = null;        // Map muId → nome, null finché non arriva

const RANGES = [
  { g: 7, mine: 'r7' }, { g: 30, key: 'r30' }, { g: 90, key: 'r90' }, { g: 3650, key: 'rAll' },
];
const RIGHE_MAX = 15;
const FRESCO_MS = 10 * 60 * 1000;
const ORA = 3600_000;

// ── Numeri e date ───────────────────────────────────────────────────
function lingua() {
  return (localStorage.getItem('we_lang') || navigator.language || 'it').slice(0, 2);
}
const intero = (v) => new Intl.NumberFormat(lingua(), { maximumFractionDigits: 0, useGrouping: 'always' }).format(v);
const compatto = (v) => new Intl.NumberFormat(lingua(), { notation: 'compact', maximumFractionDigits: 2 }).format(v);
function prezzo(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(Math.abs(v) < 1 ? 4 : 3);
}
function giorno(ms) {
  return new Intl.DateTimeFormat(lingua(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
}

// ── Le serie ────────────────────────────────────────────────────────
function serieOrdini() {
  return (_data?.series || []).map(r => ({ t: r[0], y: r[1] }));
}

function serieWallets() {
  return (_players?.world || []).map(r => ({ t: Date.parse(`${r[0]}T12:00:00Z`), y: r[5] }));
}

/** Tesori: un punto al giorno dall'archivio di dayHistory, poi i campioni
 *  orari. I giorni in cui le nazioni contate sono molte meno del solito
 *  (righe importate senza tesoro) si scartano: sommate, disegnerebbero un
 *  crollo che non c'è stato. */
function serieTesori() {
  const td = _data?.treasuryDaily || [];
  const maxN = td.reduce((m, r) => Math.max(m, r[2]), 0);
  const punti = td.filter(r => r[2] >= maxN * 0.8)
    .map(r => ({ t: Date.parse(`${r[0]}T01:05:00Z`), y: r[1] }));
  const ultimoGiornaliero = punti.length ? punti[punti.length - 1].t : 0;
  for (const r of _data?.series || []) {
    if (r[4] != null && r[0] > ultimoGiornaliero + 12 * ORA) punti.push({ t: r[0], y: r[4] });
  }
  return punti;
}

/** Linea semplice con asse: il tratto si spezza dove manca un campione
 *  (più di 3 ore nella parte oraria, più di 50 in quella giornaliera). */
function graficoHtml(punti) {
  if (punti.length < 2) return `<p class="wp-ecn-note">${escapeHtml(moneyT('empty'))}</p>`;
  const W = 880, H = 260, L = 62, R = 14, T = 14, B = 26;
  const x0 = punti[0].t, x1 = punti[punti.length - 1].t, arco = Math.max(1, x1 - x0);
  let min = Math.min(...punti.map(p => p.y)), max = Math.max(...punti.map(p => p.y));
  if (max - min < 1e-9) { max = max * 1.05 || 1; min = min * 0.95; }
  else { const pad = (max - min) * 0.08; min = Math.max(0, min - pad); max += pad; }
  const x = (t) => L + ((t - x0) / arco) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);

  const orario = Date.now() - 14 * 24 * ORA;
  let d = '';
  punti.forEach((p, i) => {
    const prec = punti[i - 1];
    const salto = prec && (p.t - prec.t) > (prec.t >= orario ? 3 * ORA : 50 * ORA);
    d += `${(!prec || salto) ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`;
  });

  const guide = [0, 1, 2, 3].map(i => {
    const v = min + ((max - min) * i) / 3;
    const gy = y(v).toFixed(1);
    return `<line class="wp-ecn-grid" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}"/>
      <text class="wp-ecn-axis" x="${L - 6}" y="${(Number(gy) + 3).toFixed(1)}" text-anchor="end">${escapeHtml(compatto(v))}</text>`;
  }).join('');

  // Una colonna invisibile per punto, col valore nel `title`: tooltip del
  // browser, nessuno stato da tenere. Con centinaia di campioni orari si
  // sottocampiona a ~120 colonne per non appesantire il DOM.
  const passo = Math.max(1, Math.ceil(punti.length / 120));
  const colonne = punti.filter((_, i) => i % passo === 0 || i === punti.length - 1).map((p) => {
    const quando = new Intl.DateTimeFormat(lingua(), { day: 'numeric', month: 'short', hour: p.t >= orario ? '2-digit' : undefined, minute: p.t >= orario ? '2-digit' : undefined }).format(new Date(p.t));
    return `<rect x="${(x(p.t) - 4).toFixed(1)}" y="${T}" width="8" height="${H - T - B}" fill="transparent"><title>${escapeHtml(`${quando} — ${intero(p.y)}`)}</title></rect>`;
  }).join('');

  const ultimo = punti[punti.length - 1];
  return `<svg class="wp-ecn-mchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(`${compatto(min)} – ${compatto(max)}`)}">
      ${guide}
      <path d="${d}" class="wp-ecn-line"/>
      <circle cx="${x(ultimo.t).toFixed(1)}" cy="${y(ultimo.y).toFixed(1)}" r="3" fill="var(--wp-ov-accent, #3fb950)"/>
      <text class="wp-ecn-axis" x="${L}" y="${H - 8}">${escapeHtml(giorno(x0))}</text>
      <text class="wp-ecn-axis" x="${W - R}" y="${H - 8}" text-anchor="end">${escapeHtml(giorno(x1))}</text>
      ${colonne}
    </svg>`;
}

// ── Le tabelle ──────────────────────────────────────────────────────
function quota(v, tot) {
  return tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : '—';
}

function rigaHtml({ nome, soldi, ordini, tetto, titolo, tot, dim, cap }) {
  return `<div class="wp-ecn-mrow${dim ? ' wp-ecn-mdim' : ''}"${titolo ? ` title="${escapeHtml(titolo)}"` : ''}>
      <span class="wp-ecn-mname${cap ? ' wp-ecn-mcap' : ''}">${escapeHtml(nome)}</span>
      <span class="wp-ecn-num">${tetto ? '≥ ' : ''}${escapeHtml(intero(soldi))}</span>
      <span class="wp-ecn-num wp-ecn-dim">${ordini != null ? escapeHtml(intero(ordini)) : ''}</span>
      <span class="wp-ecn-num wp-ecn-dim">${escapeHtml(quota(soldi, tot))}</span>
    </div>`;
}

function tabellaHtml(titolo, righe, tot, colonna = 'colOrders') {
  if (!righe.length) return '';
  return `<section class="wp-ecn-msec">
      <h3>${escapeHtml(titolo)}</h3>
      <div class="wp-ecn-mrow wp-ecn-mhead">
        <span>${escapeHtml(moneyT('colName'))}</span>
        <span class="wp-ecn-num">${escapeHtml(moneyT('colMoney'))}</span>
        <span class="wp-ecn-num">${escapeHtml(moneyT(colonna))}</span>
        <span class="wp-ecn-num">${escapeHtml(moneyT('colShare'))}</span>
      </div>
      ${righe.map(r => rigaHtml({ ...r, tot })).join('')}
    </section>`;
}

function righeRisorse(latest) {
  return Object.entries(latest.byItem || {})
    .map(([code, [soldi, ordini, tetto, minimo]]) => ({
      nome: code, soldi, ordini, tetto: !!tetto, cap: true,
      titolo: tetto ? `${moneyT('capped')} · ${moneyT('lowest', { p: prezzo(minimo) })}` : '',
    }))
    .filter(r => r.soldi > 0)
    .sort((a, b) => b.soldi - a.soldi);
}

function righeNazioni(latest) {
  const righe = Object.entries(latest.byCountry || {})
    .sort((a, b) => b[1] - a[1]).slice(0, RIGHE_MAX)
    .map(([id, soldi]) => ({ nome: getCountryById(id)?.name || moneyT('unknownNation', { id: id.slice(-4) }), soldi }));
  if (latest.noCountry > 0) righe.push({ nome: moneyT('others'), soldi: latest.noCountry, dim: true });
  return righe;
}

function righePortafogli(mappa, nome, tot) {
  return Object.entries(mappa || {})
    .sort((a, b) => b[1][0] - a[1][0]).slice(0, RIGHE_MAX)
    .map(([id, [soldi, , n]]) => ({ nome: nome(id), soldi, ordini: n }));
}

function righeUnita(latest) {
  return Object.entries(latest.byMu || {})
    .sort((a, b) => b[1] - a[1]).slice(0, RIGHE_MAX)
    .map(([id, soldi]) => ({ nome: _nomiMu?.get(id) || moneyT('unknownMu', { id: id.slice(-4) }), soldi }));
}

// ── Disegno ─────────────────────────────────────────────────────────
function kpiHtml(etichetta, valore, nota) {
  return `<div class="wp-ecn-kpi">
      <em>${escapeHtml(etichetta)}</em>
      <strong>${escapeHtml(valore)}</strong>
      ${nota ? `<small>${escapeHtml(nota)}</small>` : ''}
    </div>`;
}

function corpoHtml() {
  if (!_data) return `<p class="wp-ecn-note">${escapeHtml(moneyT('noServer'))}</p>`;
  const latest = _data.latest;
  if (!latest) return `<p class="wp-ecn-note">${escapeHtml(moneyT('notYet'))}</p>`;

  const ordini = latest.total;
  const tesori = latest.treasury;
  const pw = _players?.latest || null;            // ultima lettura dei portafogli
  const portafogli = pw ? pw.world[4] : null;
  const visibile = tesori != null ? tesori + ordini + (portafogli || 0) : null;
  const libri = Object.keys(latest.byItem || {}).length;
  const dal = _data.coverageFrom ? giorno(Date.parse(_data.coverageFrom)) : '—';
  const primoTesoro = (_data.treasuryDaily || [])[0]?.[0];

  return `
    <div class="wp-ecn-kpis">
      ${kpiHtml(moneyT('kWallets'), portafogli != null ? compatto(portafogli) : '—',
        pw ? moneyT('kWalletsNote', { n: intero(pw.n), d: giorno(Date.parse(`${pw.day}T12:00:00Z`)) }) : moneyT('notYetWallets'))}
      ${kpiHtml(moneyT('kTreasury'), tesori != null ? compatto(tesori) : '—', moneyT('kTreasuryNote'))}
      ${kpiHtml(moneyT('kOrders'), `≥ ${compatto(ordini)}`, moneyT('kOrdersNote', { n: intero(latest.orders), r: libri })
        + (visibile ? ' · ' + moneyT('kShare', { p: ((ordini / visibile) * 100).toFixed(1) }) : ''))}
      ${kpiHtml(moneyT('kTotal'), visibile != null ? compatto(visibile) : '—', moneyT('kTotalNote'))}
    </div>

    ${serieWallets().length ? `<section class="wp-ecn-msec">
      <h3>${escapeHtml(moneyT('chartWallets'))}</h3>
      <div class="wp-ecn-chartwrap">${graficoHtml(serieWallets())}</div>
    </section>` : ''}
    <section class="wp-ecn-msec">
      <h3>${escapeHtml(moneyT('chartOrders'))}</h3>
      <div class="wp-ecn-chartwrap">${graficoHtml(serieOrdini())}</div>
    </section>
    <section class="wp-ecn-msec">
      <h3>${escapeHtml(moneyT('chartTreasury'))}</h3>
      <div class="wp-ecn-chartwrap">${graficoHtml(serieTesori())}</div>
    </section>

    ${pw ? `<div class="wp-ecn-mgrid">
      ${tabellaHtml(moneyT('byCountryW'), righePortafogli(pw.byCountry, id => getCountryById(id)?.name || moneyT('unknownNation', { id: id.slice(-4) })), portafogli, 'colPlayers')}
      ${tabellaHtml(moneyT('byMuW'), righePortafogli(pw.byMu, id => _nomiMu?.get(id) || moneyT('unknownMu', { id: id.slice(-4) })), portafogli, 'colPlayers')}
    </div>` : ''}

    <div class="wp-ecn-mgrid">
      ${tabellaHtml(moneyT('byItem'), righeRisorse(latest), ordini)}
      ${tabellaHtml(moneyT('byCountry'), righeNazioni(latest), ordini)}
      ${tabellaHtml(moneyT('byMu'), righeUnita(latest), ordini)}
    </div>

    <p class="wp-ecn-note">${escapeHtml(moneyT('noteMin', { c: latest.cappedItems, r: libri }))}</p>
    <p class="wp-ecn-note">${escapeHtml(moneyT('noteWhy'))}</p>
    ${latest.noCountry > 0 ? `<p class="wp-ecn-note">${escapeHtml(moneyT('noteOthers', { v: `${compatto(latest.noCountry)} (${quota(latest.noCountry, ordini)})` }))}</p>` : ''}
    <p class="wp-ecn-note">${escapeHtml(moneyT('noteCoverage', { d: dal }))}</p>
    ${_players?.coverageFrom ? `<p class="wp-ecn-note">${escapeHtml(moneyT('noteWallets', { d: giorno(Date.parse(`${_players.coverageFrom}T12:00:00Z`)) }))}</p>` : ''}
    ${primoTesoro ? `<p class="wp-ecn-note">${escapeHtml(moneyT('noteTreasury', { d: giorno(Date.parse(`${primoTesoro}T12:00:00Z`)) }))}</p>` : ''}`;
}

function paint() {
  if (!_container) return;
  _container.innerHTML = `
    <div class="wp-ecn-money">
      <header class="wp-ecn-phead">
        <div>
          <h2>${escapeHtml(moneyT('title'))}</h2>
          <p class="wp-ecn-sub">${escapeHtml(moneyT('sub'))}</p>
        </div>
        <div class="wp-ecn-tools">
          ${RANGES.map(x => `<button type="button" class="wp-ecn-chip${_giorni === x.g ? ' active' : ''}" data-range="${x.g}">${
            escapeHtml(x.mine ? moneyT(x.mine) : ecoT(x.key))}</button>`).join('')}
          <button type="button" class="wp-ecn-refresh"${_loading ? ' disabled' : ''}>${
            escapeHtml(_loading ? ecoT('refreshing') : ecoT('refresh'))}</button>
        </div>
      </header>
      ${_loading && !_data ? `<div class="wp-ecn-loading">${escapeHtml(ecoT('loading'))}</div>` : corpoHtml()}
    </div>`;

  _container.querySelectorAll('[data-range]').forEach(b => {
    b.addEventListener('click', () => {
      _giorni = Number(b.dataset.range);
      carica();
    });
  });
  _container.querySelector('.wp-ecn-refresh')?.addEventListener('click', () => carica());
}

async function carica() {
  if (_loading) return;
  _loading = true;
  paint();
  try {
    [_data, _players] = await Promise.all([fetchOrderMoneyViaCache(_giorni), fetchPlayerMoneyViaCache(_giorni)]);
    // I nomi arrivano a parte e senza bloccare: l'elenco delle unità si
    // ridisegna da solo quando ci sono, e prima mostra gli ultimi 4 caratteri
    // dell'id invece di un nome inventato.
    await getAllCountries().catch(() => null);
    _ts = Date.now();
  } finally {
    _loading = false;
    paint();
  }
  if (!_nomiMu && (Object.keys(_data?.latest?.byMu || {}).length || Object.keys(_players?.latest?.byMu || {}).length)) {
    fetchMuDirectory().then(dir => {
      _nomiMu = new Map(dir.map(m => [m._id, m.name]));
      paint();
    }).catch(() => {});
  }
}

export async function initMoneyTab(container) {
  _container = container;
  // Riaperta da poco: si ridisegna quello che c'è. I campioni sono orari,
  // rifare la richiesta a ogni clic sulla scheda non serve a nessuno.
  if (_data && Date.now() - _ts < FRESCO_MS) { paint(); return; }
  await carica();
}

/** Ridisegna con la lingua nuova, a sezione già aperta. */
export function retranslateMoneyTab() {
  if (_container) paint();
}

export function stopMoneyTab() {}
