/* ══════════════════════════════════════════════════════════════
   WarEra+ — Scheda "Spese di guerra"
   ------------------------------------------------------------------
   Quanto spende una nazione al giorno per combattere: taglie pagate ai
   propri combattenti + contratti mercenari aggiudicati. Classifica su
   una finestra scelta (7/30/90 giorni), e cliccando una nazione la sua
   serie giorno per giorno.

   ── PERCHÉ NON È LA CLASSIFICA BOUNTY DEL GIOCO ────────────────────
   Nel gioco esiste già un ranking "bounty" per nazione, ed è un'altra
   cosa: è quanto i cittadini di quella nazione hanno INCASSATO
   combattendo (correla 0,87 col danno, 0,11 con la ricchezza). Qui si
   mostra l'uscita di cassa del governo. Le due grandezze non sono
   confrontabili e la nota in fondo lo dice a chi guarda.

   ── IL GRAFICO ─────────────────────────────────────────────────────
   Barre in SVG scritte a mano, come src/nations/charts.js: niente
   Chart.js per due dozzine di barre impilate.

   ── LA BARRA NELLA CLASSIFICA (rifatta, era il punto confuso) ──────
   Prima c'era una colonna senza intestazione con dentro una barretta
   monocroma lunga quanto la colonna ordinata: ripeteva un numero che
   stava già due colonne più in là, non diceva niente di nuovo, e
   spingeva le cifre lontano dalle loro intestazioni.
   Adesso la barra è IMPILATA e dice una cosa che nessuna colonna dice:
   quanto di quella spesa è taglia (ambra) e quanto contratti (viola).
   La lunghezza resta la spesa totale rispetto alla prima in classifica
   — sempre il totale, mai la colonna ordinata, così l'occhio ha un
   metro che non cambia sotto i piedi quando si riordina. I due colori
   sono gli stessi del grafico e della legenda, dichiarati
   nell'intestazione della colonna così non serve cercarli altrove.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { btlT } from './i18n.js';
import { aggregateExpenses, countrySeries, coveredDays, effectiveDays } from './api.js';

const WINDOWS = [
  { days: 7, key: 'days7' },
  { days: 30, key: 'days30' },
  { days: 90, key: 'days90' },
];

let _days = 30;
let _sort = 'total';          // 'total' | 'bounty' | 'contracts'
let _selected = null;         // countryId aperto nel dettaglio

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(2);
}

function nationName(id) { return state.nationMap?.get(id)?.name || id; }

function flagHtml(id) {
  const n = state.nationMap?.get(id);
  if (!n) return '';
  const url = getFlagUrl(getNationCode(id, n));
  return url ? `<img class="wp-btl-flag" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
}

/* ── Grafico a barre impilate: taglia sotto, contratti sopra ──
   Scritto a mano in SVG. Larghezza in percentuale (viewBox +
   preserveAspectRatio="none" sarebbe deformante sul testo, quindi si
   disegna in coordinate reali e si lascia scorrere il contenitore). */
function seriesChart(series, showBounty) {
  const max = Math.max(...series.map(d => (showBounty ? d.bounty : 0) + d.contracts), 1);
  const W = Math.max(320, series.length * 22);
  const H = 140;
  const pad = 18;
  const bw = (W - pad) / series.length;

  const bars = series.map((d, i) => {
    const x = pad + i * bw;
    const b = showBounty ? d.bounty : 0;
    const c = d.contracts;
    const hb = ((b / max) * (H - 24));
    const hc = ((c / max) * (H - 24));
    const title = `${d.day} — ${btlT('bountyLabel')}: ${fmtMoney(d.bounty)} · ${btlT('contractsLabel')}: ${fmtMoney(d.contracts)}`;
    return `<g><title>${escapeHtml(title)}</title>
      <rect x="${x + 1}" y="${H - 16 - hc - hb}" width="${bw - 2}" height="${hc}" class="wp-btl-bar-c" rx="1"/>
      ${showBounty ? `<rect x="${x + 1}" y="${H - 16 - hb}" width="${bw - 2}" height="${hb}" class="wp-btl-bar-b" rx="1"/>` : ''}
    </g>`;
  }).join('');

  const first = series[0]?.day || '';
  const last = series.at(-1)?.day || '';
  return `
    <div class="wp-btl-chartwrap">
      <svg class="wp-btl-chart" width="${W}" height="${H}" role="img">
        <line x1="${pad}" y1="${H - 16}" x2="${W}" y2="${H - 16}" class="wp-btl-axis"/>
        ${bars}
        <text x="${pad}" y="${H - 4}" class="wp-btl-axislbl">${first.slice(5)}</text>
        <text x="${W - 2}" y="${H - 4}" class="wp-btl-axislbl" text-anchor="end">${last.slice(5)}</text>
      </svg>
    </div>
    <div class="wp-btl-legend">
      ${showBounty ? `<span class="wp-btl-key"><i class="wp-btl-sw-b"></i>${btlT('bountyLabel')}</span>` : ''}
      <span class="wp-btl-key"><i class="wp-btl-sw-c"></i>${btlT('contractsLabel')}</span>
    </div>`;
}

function detailHtml(data, countryId) {
  const showBounty = !data.bountyMissing;
  const series = countrySeries(data.byDay, countryId, _days);
  const tot = series.reduce((s, d) => ({
    bounty: s.bounty + d.bounty,
    contracts: s.contracts + d.contracts,
    contractCount: s.contractCount + d.contractCount,
    battles: s.battles + d.battles,
  }), { bounty: 0, contracts: 0, contractCount: 0, battles: 0 });
  const total = (showBounty ? tot.bounty : 0) + tot.contracts;
  const peak = series.reduce((a, d) => {
    const v = (showBounty ? d.bounty : 0) + d.contracts;
    return v > a.v ? { v, day: d.day } : a;
  }, { v: 0, day: '—' });
  // Denominatore = giorni per cui abbiamo davvero dati dentro la finestra,
  // non l'ampiezza della finestra: vedi effectiveDays in api.js.
  const denom = effectiveDays(data.byDay, _days);

  return `
    <div class="wp-btl-detail">
      <button type="button" class="wp-btl-back" id="wp-btl-back">← ${btlT('backToList')}</button>
      <h2 class="wp-btl-dtitle">${flagHtml(countryId)}${escapeHtml(nationName(countryId))} — ${btlT('detailTitle')}</h2>
      <div class="wp-btl-cards">
        <div class="wp-btl-card"><span>${btlT('colTotal')}</span><strong>${fmtMoney(total)}</strong></div>
        ${showBounty ? `<div class="wp-btl-card"><span>${btlT('bountyLabel')}</span><strong>${fmtMoney(tot.bounty)}</strong></div>` : ''}
        <div class="wp-btl-card"><span>${btlT('contractsLabel')}</span><strong>${fmtMoney(tot.contracts)}</strong>
          <em>${btlT('contractsCount', { n: tot.contractCount })}</em></div>
        <div class="wp-btl-card"><span>${btlT('perDayAvg')}</span><strong>${fmtMoney(total / denom)}</strong>
          ${denom < _days ? `<em>${btlT('overDays', { n: denom })}</em>` : ''}</div>
        <div class="wp-btl-card"><span>${btlT('peak')}</span><strong>${fmtMoney(peak.v)}</strong><em>${peak.day}</em></div>
        ${showBounty ? `<div class="wp-btl-card"><span>${btlT('colBattles')}</span><strong>${tot.battles}</strong></div>` : ''}
      </div>
      ${seriesChart(series, showBounty)}
      <button type="button" class="wp-btl-seebattles" data-see="${countryId}">${btlT('tabArchive')} →</button>
    </div>`;
}

/** La barra impilata di una riga: lunghezza = spesa totale rispetto alla
 *  prima in classifica, riempimento = quanto è taglia e quanto contratti.
 *  Il minimo del 2% esiste perché una nazione che ha speso poco resti
 *  comunque visibile come riga, invece di sembrare una casella vuota. */
function compBar(r, max, showBounty) {
  const len = Math.max(2, (r.total / max) * 100);
  const bPart = r.total > 0 && showBounty ? (r.bounty / r.total) * 100 : 0;
  const cPart = 100 - bPart;
  const title = showBounty
    ? `${btlT('bountyLabel')} ${fmtMoney(r.bounty)} · ${btlT('contractsLabel')} ${fmtMoney(r.contracts)}`
    : `${btlT('contractsLabel')} ${fmtMoney(r.contracts)}`;
  return `<span class="wp-btl-track" title="${escapeHtml(title)}">
    <span class="wp-btl-fill" style="width:${len.toFixed(1)}%">
      ${bPart > 0 ? `<i class="wp-btl-seg-b" style="width:${bPart.toFixed(1)}%"></i>` : ''}
      <i class="wp-btl-seg-c" style="width:${cPart.toFixed(1)}%"></i>
    </span>
  </span>`;
}

export function renderWarExpenses(data) {
  const notices = [];
  if (data.degraded) notices.push(`<div class="wp-btl-notice warn">${btlT('degraded')}</div>`);
  if (data.bountyMissing) notices.push(`<div class="wp-btl-notice warn">${btlT('degradedBounty')}</div>`);

  // La copertura si dichiara SEMPRE, anche in modalità ridotta: è
  // l'informazione che spiega perché "al giorno" è calcolato su pochi
  // giorni invece che sull'intera finestra scelta. Sta nella barra
  // strumenti e non in un riquadro a tutta larghezza: è una nota di
  // contesto, e un riquadro grigio in cima alla pagina si legge come un
  // avviso di malfunzionamento che qui non c'è.
  const covered = coveredDays(data.byDay);

  const head = `
    ${notices.join('')}
    <div class="wp-btl-toolbar">
      <div class="wp-btl-filters">
        <span class="wp-btl-lbl">${btlT('windowLabel')}</span>
        ${WINDOWS.map(w => `<button type="button" class="wp-btl-chip${_days === w.days ? ' active' : ''}" data-days="${w.days}">${btlT(w.key)}</button>`).join('')}
      </div>
      <span class="wp-btl-meta">${btlT('coverage', { n: covered })}</span>
    </div>`;

  if (_selected) return head + detailHtml(data, _selected);

  const showBounty = !data.bountyMissing;
  const totals = [...aggregateExpenses(data.byDay, _days).entries()]
    .map(([cid, v]) => ({ cid, ...v, total: (showBounty ? v.bounty : 0) + v.contracts }))
    .filter(r => r.total > 0)
    .sort((a, b) => (b[_sort] || 0) - (a[_sort] || 0));

  if (!totals.length) return head + `<div class="wp-btl-empty">${btlT('noExpenses')}</div>`;

  // ⚠️ Il metro della barra è SEMPRE il totale più alto, mai il massimo
  // della colonna ordinata: riordinando cambierebbe la scala sotto agli
  // occhi e due schermate della stessa tabella non sarebbero confrontabili.
  const max = Math.max(...totals.map(r => r.total), 1);
  const denom = effectiveDays(data.byDay, _days);
  const sortable = (key, label) =>
    `<th class="wp-btl-num wp-btl-tight wp-btl-sortable${_sort === key ? ' active' : ''}" data-sort="${key}">${label}${_sort === key ? '<span class="wp-btl-caret">▾</span>' : ''}</th>`;

  return head + `
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table wp-btl-xp">
        <thead><tr>
          <th class="wp-btl-rank">#</th>
          <th class="wp-btl-xp-name">${btlT('colNation')}</th>
          <th class="wp-btl-comp">
            <span class="wp-btl-key-inline">
              ${showBounty ? `<span class="wp-btl-key"><i class="wp-btl-sw-b"></i>${btlT('bountyLabel')}</span>` : ''}
              <span class="wp-btl-key"><i class="wp-btl-sw-c"></i>${btlT('contractsLabel')}</span>
            </span>
          </th>
          ${showBounty ? sortable('bounty', btlT('colBounty')) : ''}
          ${sortable('contracts', btlT('colContracts'))}
          ${sortable('total', btlT('colTotal'))}
          <th class="wp-btl-num wp-btl-tight">${btlT('colPerDay')}</th>
        </tr></thead>
        <tbody>
          ${totals.map((r, i) => `
            <tr class="wp-btl-row wp-btl-clickable" data-country="${r.cid}">
              <td class="wp-btl-rank">${i + 1}</td>
              <td class="wp-btl-xp-name"><span class="wp-btl-nation">${flagHtml(r.cid)}${escapeHtml(nationName(r.cid))}</span></td>
              <td class="wp-btl-comp">${compBar(r, max, showBounty)}</td>
              ${showBounty ? `<td class="wp-btl-num wp-btl-tight wp-btl-bounty">${fmtMoney(r.bounty)}</td>` : ''}
              <td class="wp-btl-num wp-btl-tight wp-btl-contracts">${fmtMoney(r.contracts)}<span class="wp-btl-sub">×${r.contractCount}</span></td>
              <td class="wp-btl-num wp-btl-tight wp-btl-total">${fmtMoney(r.total)}</td>
              <td class="wp-btl-num wp-btl-tight wp-btl-dim">${fmtMoney(r.total / denom)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="wp-btl-foot">${btlT('bountyNote')}</p>
    <p class="wp-btl-foot">${btlT('notCountryBounty')}</p>
    <p class="wp-btl-foot">${btlT('tzNote')}</p>`;
}

export function wireWarExpenses(root, data, { onRepaint, onSeeBattles }) {
  root.querySelectorAll('.wp-btl-chip[data-days]').forEach(chip => {
    chip.addEventListener('click', () => { _days = Number(chip.dataset.days); onRepaint(); });
  });

  root.querySelectorAll('.wp-btl-sortable').forEach(th => {
    th.addEventListener('click', () => { _sort = th.dataset.sort; onRepaint(); });
  });

  root.querySelectorAll('.wp-btl-clickable').forEach(tr => {
    tr.addEventListener('click', () => { _selected = tr.dataset.country; onRepaint(); });
  });

  root.querySelector('#wp-btl-back')?.addEventListener('click', () => { _selected = null; onRepaint(); });

  root.querySelector('.wp-btl-seebattles')?.addEventListener('click', (e) => {
    onSeeBattles(e.currentTarget.dataset.see);
  });
}
