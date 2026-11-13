/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: economia della nazione
   ------------------------------------------------------------------
   Cinque cose, dalla più generale alla più fine:

     1. il TESORO di adesso (già in memoria: `rankings.countryWealth`) con
        la variazione a 7 e 30 giorni e la sua curva, dallo storico che il
        server scatta ogni giorno (/country-treasury);
     2. i BONIFICI fra tesori in entrata e in uscita (l'archivio dei
        finanziamenti, lo stesso del dettaglio battaglia) e da chi/a chi;
     3. le DONAZIONI dei giocatori, giorno per giorno: quanto ha ricevuto
        il tesoro della nazione e quanto le sue unità militari
        (/donations);
     4. il raffronto fra le due cose, in una ciambella;
     5. quanto ha ricevuto CIASCUNA unità della nazione, con donatori e
        andamento giornaliero.

   Una `donation` va da un giocatore (`buyerId`) a una nazione, un'unità o
   un partito (`seller*Id`): vedi server/donations.js. Non si filtra per
   nazionalità del donatore, che la riga non porta.

   ── COSA NON SI SA, E LA SCHEDA LO DICE ──────────────────────────────
   · il tesoro è `countryWealth`, MAI `country.money` (fermo da mesi: somma
     54 mila contro i 4,4 milioni della classifica);
   · bonifici e donazioni si ACCUMULANO dal giorno in cui il server ha
     cominciato a guardare: l'API ne ricorda poco. Prima di `coverageFrom`
     l'assenza di una riga NON è «nessuna donazione», e un giorno prima di
     quella data si lascia fuori dal grafico invece di disegnarlo a zero;
   · le donazioni ai partiti restano in archivio ma non si mostrano: la riga
     non porta la nazione del partito.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, flagImg } from '../mu/ui.js';
import { tipAttr } from '../shared/chartTip.js';
import { fetchMoneyTransfers } from '../battles/moneyTransfers.js';
import { state } from '../diplomacy/state.js';
import { donutHtml } from './charts.js';
import { fetchDonations, fetchTreasury } from './api.js';
import { ecoT } from './i18nEco.js';

const W = 640, H = 150, PAD_T = 10, PAD_B = 4;
const C_TREASURY = '#e3b341';
const C_IN = '#3fb950';
const C_OUT = '#e5484d';
const C_DON = ['#e3b341', '#58a6ff'];   // dal tesoro · dalle unità
const RANGES = [7, 30, 90];
const DAY_MS = 86400_000;

const RANGE_KEY = 'we_nat_eco_range';
let _range = (() => {
  try { const v = Number(localStorage.getItem(RANGE_KEY)); return RANGES.includes(v) ? v : 30; }
  catch { return 30; }
})();

let _host = null;
let _nation = null;

/* ── utilità ───────────────────────────────────────────────────── */

/* Oro arrotondato: su cifre di settimane i centesimi sono rumore. */
const oro = (v) => {
  const n = Math.round(Number(v) || 0);
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(document.documentElement.lang || undefined);
};
const signed = (v) => `${v > 0 ? '+' : ''}${oro(v)}`;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
function fmtData(giorno) {
  return new Date(`${giorno}T12:00:00Z`)
    .toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' });
}
function nomeDi(id) { return state.nationMap?.get(id)?.name || id; }

/** I giorni UTC da oggi - (n-1) a oggi. */
function lastDays(n) {
  const out = [];
  const t0 = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayOf(t0 - i * DAY_MS));
  return out;
}

/* ── ingresso ──────────────────────────────────────────────────── */

export async function renderEco(host, nation) {
  _host = host;
  _nation = nation;
  paintShell();
  await load();
}

function paintShell() {
  _host.innerHTML = `
    <h3 class="wp-nat-section-title">
      ${escapeHtml(ecoT('ecoTitle', { nation: _nation.name || '—' }))}
      <div class="wp-nat-tools">
        <div class="wp-nat-curve-range" id="wp-nat-eco-range" role="group">
          ${RANGES.map(r => `<button type="button" data-r="${r}" class="${r === _range ? 'active' : ''}">${escapeHtml(ecoT('r' + r))}</button>`).join('')}
        </div>
      </div>
    </h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('ecoSub'))}</p>
    <div id="wp-nat-eco-body"><div class="wp-nat-empty">…</div></div>`;
  _host.querySelector('#wp-nat-eco-range').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b || Number(b.dataset.r) === _range) return;
    _range = Number(b.dataset.r);
    try { localStorage.setItem(RANGE_KEY, String(_range)); } catch { /* storage negato */ }
    _host.querySelectorAll('#wp-nat-eco-range button').forEach(x => x.classList.toggle('active', x === b));
    load();
  });
}

async function load() {
  const nation = _nation;
  const range = _range;
  const [treasury, donations, transfers] = await Promise.all([
    fetchTreasury(nation._id).catch(() => null),
    fetchDonations(nation._id, range).catch(() => null),
    fetchMoneyTransfers().catch(() => null),
  ]);
  // Nazione o intervallo cambiati mentre si aspettava: questo disegno è vecchio.
  if (_nation?._id !== nation._id || _range !== range || !_host?.isConnected) return;
  const body = _host.querySelector('#wp-nat-eco-body');
  if (!body) return;
  body.innerHTML = tilesAndTreasury(treasury, transfers)
    + transfersHtml(transfers)
    + donationsHtml(donations)
    + unitsHtml(donations);
  body.querySelector('#wp-nat-eco-units')?.addEventListener('click', openUnit);
}

/* ── 1. tesoro + tessere ───────────────────────────────────────── */

function treasuryAt(points, ago) {
  // L'ultimo punto a `ago` giorni o più fa. Se la storia comincia dopo,
  // null: non si inventa un confronto con un giorno che non si conosce.
  const target = dayOf(Date.now() - ago * DAY_MS);
  let found = null;
  for (const [d, v] of points) { if (d <= target) found = v; else break; }
  return found;
}

function tilesAndTreasury(treasury, transfers) {
  const id = _nation._id;
  const wealth = _nation.rankings?.countryWealth;
  const now = Number(wealth?.value);
  const rank = wealth?.rank;
  const delta = (ago) => {
    const old = treasury ? treasuryAt(treasury, ago) : null;
    return old != null && Number.isFinite(now) ? now - old : null;
  };
  const d7 = delta(7), d30 = delta(30);

  const since = Date.now() - _range * DAY_MS;
  const inside = (transfers?.transfers || []).filter(t => t.at >= since);
  const recv = inside.filter(t => t.to === id).reduce((s, t) => s + t.money, 0);
  const sent = inside.filter(t => t.from === id).reduce((s, t) => s + t.money, 0);

  const tile = (lab, val, cls = '', tip = '') => `
    <div class="wp-nat-lab-tile"${tip ? ` title="${escapeHtml(tip)}"` : ''}>
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val ${cls}">${escapeHtml(val)}</strong>
    </div>`;
  const sgn = (v) => (v == null ? '' : v >= 0 ? 'wp-nat-up' : 'wp-nat-down');

  const tiles = [
    tile(ecoT('ecoTreasury'), Number.isFinite(now) ? oro(now) : '—', '', ecoT('ecoTreasuryNote')),
    tile(ecoT('ecoRank'), rank ? `#${rank}` : '—'),
    tile(ecoT('ecoChange7'), d7 == null ? '—' : signed(d7), sgn(d7)),
    tile(ecoT('ecoChange30'), d30 == null ? '—' : signed(d30), sgn(d30)),
    tile(ecoT('ecoRecv'), transfers ? oro(recv) : '—', 'wp-nat-up'),
    tile(ecoT('ecoSent'), transfers ? oro(sent) : '—', 'wp-nat-down'),
    tile(ecoT('ecoNet'), transfers ? signed(recv - sent) : '—', transfers ? sgn(recv - sent) : ''),
  ].join('');

  const pts = (treasury || []).filter(([d]) => d >= dayOf(since));
  // Il punto di oggi non è ancora nello storico (scatto alle 02:05): si
  // aggiunge il valore in memoria, che è lo stesso dato più fresco.
  if (Number.isFinite(now) && (!pts.length || pts[pts.length - 1][0] < dayOf(Date.now()))) {
    pts.push([dayOf(Date.now()), now]);
  }
  const chart = treasury && pts.length > 1
    ? lineChartHtml(pts)
    : `<p class="wp-nat-lab-note">${escapeHtml(ecoT('ecoNoHist'))}</p>`;

  return `
    <div class="wp-nat-lab-tiles">${tiles}</div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('ecoTreasuryChart'))}</h4>
      <div class="wp-nat-curve-slot">${chart}</div>
    </div>`;
}

/** Linea (con area) di una serie [giorno, valore]: asse x proporzionale al
 *  tempo, perché lo storico ha buchi e i buchi non devono sembrare
 *  continuità. Etichette in HTML, non nell'SVG, per restare leggibili su
 *  telefono (vedi la nota in labourSection.js). */
function lineChartHtml(points) {
  const t0 = dayMs(points[0][0]);
  const t1 = dayMs(points[points.length - 1][0]);
  const span = Math.max(1, t1 - t0);
  const vals = points.map(p => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const h = H - PAD_T - PAD_B;
  const x = (d) => ((dayMs(d) - t0) / span) * W;
  const y = (v) => PAD_T + h - ((v - lo) / (hi - lo)) * h;

  const path = points.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${W},${H - PAD_B} L0,${H - PAD_B} Z`;
  const hits = points.map(([d, v], i) => {
    const xa = i ? (x(points[i - 1][0]) + x(d)) / 2 : 0;
    const xb = i < points.length - 1 ? (x(d) + x(points[i + 1][0])) / 2 : W;
    return `<rect class="wp-tip-hit" x="${xa.toFixed(1)}" y="0" width="${Math.max(1, xb - xa).toFixed(1)}" height="${H}"${tipAttr(
      fmtData(d), `${ecoT('ecoTreasury')}\t${oro(v)}`)}/>`;
  }).join('');

  return `
    <div class="wp-nat-lab-axisrow wp-nat-lab-axis-top"><span>${escapeHtml(oro(Math.max(...vals)))}</span><span>${escapeHtml(oro(Math.min(...vals)))}</span></div>
    <svg class="wp-nat-lab-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(ecoT('ecoTreasuryChart'))}">
      <path d="${area}" fill="${C_TREASURY}" fill-opacity=".14"/>
      <path d="${path}" fill="none" stroke="${C_TREASURY}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${hits}
    </svg>
    <div class="wp-nat-lab-axisrow"><span>${escapeHtml(fmtData(points[0][0]))}</span><span>${escapeHtml(fmtData(points[points.length - 1][0]))}</span></div>`;
}

/* ── 2. bonifici fra tesori ────────────────────────────────────── */

function transfersHtml(data) {
  const title = `<h3 class="wp-nat-section-title">${escapeHtml(ecoT('trTitle'))}</h3>`;
  if (!data) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('trServer'))}</p>`;

  const id = _nation._id;
  const since = Date.now() - _range * DAY_MS;
  const rows = data.transfers.filter(t => t.at >= since && (t.to === id || t.from === id));
  const agg = (pick) => {
    const m = new Map();
    for (const t of rows) {
      const k = pick(t);
      if (k) m.set(k, (m.get(k) || 0) + t.money);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  };
  const from = agg(t => (t.to === id ? t.from : null));
  const to = agg(t => (t.from === id ? t.to : null));

  // La copertura conta solo se cade DENTRO la finestra scelta: altrimenti
  // l'archivio copre tutto l'intervallo e la nota sarebbe rumore.
  const cov = data.coverageFrom && data.coverageFrom > since
    ? `<p class="wp-nat-curve-note">${escapeHtml(ecoT('trCoverage', { d: fmtData(dayOf(data.coverageFrom)) }))}</p>`
    : '';
  const lists = (from.length || to.length)
    ? `<div class="wp-nat-lab-cols">${list(ecoT('trFrom'), from, C_IN)}${list(ecoT('trTo'), to, C_OUT)}</div>`
    : `<div class="wp-nat-empty">${escapeHtml(ecoT('trNone'))}</div>`;
  return title + cov + lists;
}

function list(titolo, righe, colore) {
  if (!righe.length) return '';
  const max = righe[0][1] || 1;
  return `
    <div class="wp-nat-lab-col">
      <h4 class="wp-nat-chart-title">${escapeHtml(titolo)}</h4>
      <ul class="wp-nat-lab-list">${righe.map(([id, v]) => `
        <li class="wp-nat-lab-row">
          ${flagImg(id, 'wp-nat-lab-flag')}<span class="wp-nat-lab-name">${escapeHtml(nomeDi(id))}</span>
          <span class="wp-nat-lab-bar"><span style="width:${((v / max) * 100).toFixed(1)}%;background:${colore}"></span></span>
          <span class="wp-nat-lab-num">${escapeHtml(oro(v))}</span>
        </li>`).join('')}</ul>
    </div>`;
}

/* ── 3-4. donazioni dei giocatori (transazioni «donation») ─────── */

/* Una `donation` ha `buyerId` (il giocatore che DONA) e `sellerCountryId` /
   `sellerMuId` / `sellerPartyId` (chi RICEVE: il verso del gioco, vedi la
   testata di server/donations.js). Qui: cosa ha ricevuto il tesoro della
   nazione e cosa le sue unità, giorno per giorno. */

/** Il server ha righe ma non ha capito chi dà o chi riceve? */
function unreadable(d) {
  const c = d?.classified;
  return !!c && c.rows > 0 && (c.giver === 0 || c.receiver === 0);
}

function donationsHtml(d) {
  const title = `<h3 class="wp-nat-section-title">${escapeHtml(ecoT('donTitle'))}</h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('donSub'))}</p>`;
  if (!d) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('donNoServer'))}</p>`;
  if (!d.classified?.rows) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('donNotYet'))}</p>`;
  if (unreadable(d)) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('donShape', { n: d.classified.rows }))}</p>`;

  const sumDaily = (i) => d.daily.reduce((s, r) => s + (Number(r[i]) || 0), 0);
  const fromTre = d.treasury?.money ?? sumDaily(1);
  const fromMu = d.byMu.reduce((s, m) => s + m.money, 0);

  const tile = (lab, val, sub = '') => `
    <div class="wp-nat-lab-tile">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val">${escapeHtml(val)}</strong>${sub ? `<span class="wp-nat-lab-note">${escapeHtml(sub)}</span>` : ''}
    </div>`;
  const tiles = [
    tile(ecoT('donFromTreasury'), oro(fromTre), ecoT('donCount', { n: d.treasury?.n ?? 0 })),
    tile(ecoT('donFromUnits'), oro(fromMu), ecoT('donCount', { n: d.byMu.reduce((s, m) => s + m.n, 0) })),
    tile(ecoT('colRecipients'), String(d.treasury?.donors ?? 0), ecoT('donFromTreasury')),
  ].join('');

  // Giorni mostrati: dall'inizio della finestra, ma mai prima di quando
  // l'archivio ha cominciato a guardare. Un giorno senza righe DENTRO la
  // copertura è davvero zero; uno fuori è sconosciuto e non si disegna.
  const cover = d.coverageFrom ? dayOf(d.coverageFrom) : null;
  const days = lastDays(d.days).filter(g => !cover || g >= cover);
  const byDay = new Map(d.daily.map(r => [r[0], r]));
  const series = days.map(g => {
    const r = byDay.get(g);
    return { day: g, parts: [Number(r?.[1]) || 0, Number(r?.[2]) || 0] };
  });
  const labels = [ecoT('donFromTreasury'), ecoT('donFromUnits')];

  const note = cover && cover > dayOf(Date.now() - (d.days - 1) * DAY_MS)
    ? `<p class="wp-nat-curve-note">${escapeHtml(ecoT('donCoverage', { d: fmtData(cover) }))}</p>` : '';

  const donut = donutHtml({
    title: ecoT('cmpVsTreasury'),
    slices: [
      { label: labels[0], value: fromTre, color: C_DON[0] },
      { label: labels[1], value: fromMu, color: C_DON[1] },
    ],
    totalFmt: oro,
  });

  return `${title}${note}
    <div class="wp-nat-lab-tiles">${tiles}</div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('donChart'))}</h4>
      <ul class="wp-nat-curve-legend">${labels.map((l, i) =>
        `<li><span class="wp-nat-dot" style="background:${C_DON[i]}"></span>${escapeHtml(l)}</li>`).join('')}</ul>
      <div class="wp-nat-curve-slot">${stackedBarsHtml(series, labels)}</div>
    </div>
    <section class="wp-nat-charts">${donut}</section>
    <p class="wp-nat-lab-note">${escapeHtml(ecoT('donWhat'))}</p>`;
}

/** Barre impilate giorno per giorno (UTC). */
function stackedBarsHtml(series, labels) {
  if (!series.length) return '';
  const max = Math.max(...series.map(s => s.parts.reduce((a, b) => a + b, 0)), 1);
  const w = W / series.length;
  const h = H - PAD_T - PAD_B;
  const bars = series.map((s, i) => {
    let y = PAD_T + h;
    const x = i * w;
    const total = s.parts.reduce((a, b) => a + b, 0);
    const rects = s.parts.map((v, k) => {
      const hh = (v / max) * h;
      y -= hh;
      return hh > 0 ? `<rect x="${(x + 0.5).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${hh.toFixed(1)}" fill="${C_DON[k]}"/>` : '';
    }).join('');
    return rects + `<rect class="wp-tip-hit" x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}"${tipAttr(
      fmtData(s.day),
      `${ecoT('total')}\t${oro(total)}`,
      ...s.parts.map((v, k) => `${labels[k]}\t${oro(v)}`))}/>`;
  }).join('');
  return `
    <div class="wp-nat-lab-axisrow wp-nat-lab-axis-top">${escapeHtml(oro(max))}</div>
    <svg class="wp-nat-lab-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(ecoT('donChart'))}">${bars}</svg>
    <div class="wp-nat-lab-axisrow"><span>${escapeHtml(fmtData(series[0].day))}</span><span>${escapeHtml(fmtData(series[series.length - 1].day))}</span></div>`;
}

/* ── 5. quanto ha pagato ciascuna unità ────────────────────────── */

function unitsHtml(d) {
  if (!d || !d.classified?.rows || unreadable(d)) return '';
  const title = `<h3 class="wp-nat-section-title">${escapeHtml(ecoT('cmpTitle'))}</h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('cmpSub'))}</p>`;
  if (!d.byMu?.length) return `${title}<div class="wp-nat-empty">${escapeHtml(ecoT('cmpNone'))}</div>`;

  const cover = d.coverageFrom ? dayOf(d.coverageFrom) : null;
  const days = lastDays(d.days).filter(g => !cover || g >= cover);
  const head = ['colUnit', 'colGiven', 'colRecipients', 'colCount', 'colAvg', 'colPerDay']
    .map((k, i) => `<span class="${i && i < 5 ? 'wp-nat-num' : ''}">${escapeHtml(ecoT(k))}</span>`).join('');

  const max = d.byMu[0].money || 1;
  const body = d.byMu.map(m => `
      <a class="wp-nat-ecot-row" href="#" data-mu="${escapeHtml(m.id)}">
        <span class="wp-nat-cname"><span class="wp-nat-cnick">${escapeHtml(m.name)}</span></span>
        <span class="wp-nat-num money wp-nat-ecot-bar"><i style="width:${((m.money / max) * 100).toFixed(1)}%"></i><b>${escapeHtml(oro(m.money))}</b></span>
        <span class="wp-nat-num">${m.donors}</span>
        <span class="wp-nat-num">${m.n}</span>
        <span class="wp-nat-num">${escapeHtml(oro(m.n ? m.money / m.n : 0))}</span>
        <span>${sparkHtml(days, m.daily, m.name)}</span>
      </a>`).join('');

  return `${title}
    <div class="wp-nat-mut-wrap"><div class="wp-nat-ecot" id="wp-nat-eco-units">
      <div class="wp-nat-ecot-row wp-nat-mut-head">${head}</div>${body}
    </div></div>`;
}

/** Minibarre giornaliere di un'unità, sullo stesso asse dei giorni. */
function sparkHtml(days, daily, name) {
  if (days.length < 2) return '—';
  const by = new Map(daily.map(([g, v]) => [g, v]));
  const vals = days.map(g => by.get(g) || 0);
  const max = Math.max(...vals, 1);
  const w = 100 / days.length;
  const bars = vals.map((v, i) => v > 0
    ? `<rect x="${(i * w).toFixed(2)}" y="${(20 - (v / max) * 20).toFixed(2)}" width="${Math.max(0.6, w - 0.4).toFixed(2)}" height="${((v / max) * 20).toFixed(2)}" fill="${C_DON[1]}"/>`
    : '').join('');
  return `<svg class="wp-nat-spark" viewBox="0 0 100 20" preserveAspectRatio="none"${tipAttr(name, `${ecoT('colPerDay')}\t${oro(vals.reduce((a, b) => a + b, 0) / days.length)}`)}>${bars}</svg>`;
}

async function openUnit(e) {
  const a = e.target.closest('a[data-mu]');
  if (!a) return;
  e.preventDefault();
  const [nat, mu] = await Promise.all([import('../app/nationsOverlay.js'), import('../app/muOverlay.js')]);
  nat.closeNationsView();
  mu.openMuView(a.dataset.mu);
}
