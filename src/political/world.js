/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: la vista "Mondo"
   ------------------------------------------------------------------
   Political guardava una nazione alla volta. Due domande però sono
   del mondo intero, e oggi non avevano risposta se non aprendo
   centottanta nazioni una dopo l'altra:

   1. CALENDARIO — dove si vota adesso, dove si stanno raccogliendo le
      candidature. Stesso materiale che il ticker mostra a pezzi, qui
      tutto insieme e in ordine di chiusura.
   2. CONFRONTO — affluenza, frammentazione, stabilità del governo di
      ogni nazione, in una tabella ordinabile.

   Dati: /political-overview (server/politicalHistory.js), un solo
   riassunto per tutte le nazioni, più `state.nazioniGlobal` per nomi,
   bandiere e popolazione attiva (zero fetch). Se il server non c'è, il
   calendario ricade su /elections?open=1 (quello dei ticker) e il
   confronto non compare: le metriche storiche si calcolano sulle
   elezioni archiviate, che stanno solo lì.

   ⚠️ L'affluenza è votanti / popolazione ATTIVA DI OGGI
   (`rankings.countryActivePopulation`, la metrica giusta: vedi
   CLAUDE.md sulla popolazione). Per un'elezione di un mese fa il
   denominatore è quindi di oggi — la nota sotto la tabella lo dice.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, getPartyColor } from './config.js';
import { pT } from './plusI18n.js';
import { fetchPoliticalOverview } from './plusApi.js';
import { hideOtherViews } from './plusViews.js';
import { getAllCountries } from '../shared/countries.js';
import { fetchOpenElectionsViaCache } from '../diplomacy/cacheClient.js';
import { getFlagUrl } from '../panel/nationFlag.js';
import { fmtDate } from './plusCharts.js';

const COLS = [
  { key: 'name', label: 'col_nation', text: true },
  { key: 'pop', label: 'col_active_pop' },
  { key: 'voters', label: 'col_voters' },
  { key: 'turnout', label: 'col_turnout', pct: true },
  { key: 'dVoters', label: 'col_delta', pct: true, signed: true },
  { key: 'parties', label: 'col_parties' },
  { key: 'enp', label: 'col_enp', dec: 1 },
  { key: 'topShare', label: 'col_top_party', pct: true },
  { key: 'presShare', label: 'col_pres_share', pct: true },
  { key: 'presDistinct', label: 'col_pres_distinct' },
  { key: 'streak', label: 'col_streak' },
];

let _sort = 'pop';
let _dir = -1;
let _query = '';
let _showAll = false;
let _rows = [];
let _onPick = null;
let _seq = 0;
let _tick = null;

export function isWorldViewOpen() {
  const el = document.getElementById('wp-pol-world-view');
  return !!el && el.style.display !== 'none';
}

/** @param {{onPick:(countryId:string)=>void}} opts */
export async function showWorldView({ onPick } = {}) {
  _onPick = onPick || null;
  hideOtherViews('world');
  const view = document.getElementById('wp-pol-world-view');
  if (!view) return;
  view.style.display = '';
  const seq = ++_seq;
  view.innerHTML = `<div class="panel wp-pol-loading">${escapeHtml(pT('loading_world'))}</div>`;

  const [overview, countries] = await Promise.all([
    fetchPoliticalOverview(),
    getAllCountries().catch(() => []),
  ]);
  if (seq !== _seq || !view.isConnected) return;

  const byId = new Map(countries.map(c => [c._id, c]));
  let open = [];
  if (overview) {
    for (const [cid, o] of Object.entries(overview.data)) if (o.open) open.push({ cid, ...o.open });
  } else {
    // Ripiego: le sole elezioni aperte, dalla stessa rotta dei ticker.
    try {
      const raw = await fetchOpenElectionsViaCache();
      const now = Date.now();
      for (const [cid, list] of Object.entries(raw || {})) {
        for (const e of list || []) {
          const s = Date.parse(e.votesStartAt), en = Date.parse(e.votesEndAt);
          open.push({
            cid, id: e._id, t: e.type === 'president' ? 'P' : 'C', s, e: en,
            v: e.votesCount || 0, n: (e.candidates || []).length,
            phase: s && now < s ? 'candidacy' : 'voting',
          });
        }
      }
    } catch (_) { open = []; }
  }

  _rows = overview ? buildRows(overview, byId) : [];
  view.innerHTML = `
    <div class="panel wp-pol-hist-head">
      <div>
        <div class="wp-pol-hist-title">🌍 ${escapeHtml(pT('world_title'))}</div>
        <div class="wp-pol-dim">${escapeHtml(pT('world_sub'))}</div>
      </div>
    </div>
    <div id="wp-pol-cal">${calendarHtml(open, byId)}</div>
    ${overview ? `<div class="panel wp-pol-card wp-pol-wide">
        <div class="panel-head"><div class="panel-icon">📊</div><h2>${escapeHtml(pT('compare_title'))}</h2>
          <input type="search" id="wp-pol-cmp-q" class="wp-pol-search" placeholder="${escapeHtml(pT('search_nation'))}" value="${escapeHtml(_query)}">
        </div>
        <div id="wp-pol-cmp">${tableHtml()}</div>
        <div class="wp-pol-note">${escapeHtml(pT('compare_note'))}</div>
      </div>` : `<div class="panel wp-pol-empty">${escapeHtml(pT('compare_unavailable'))}</div>`}
  `;
  wire(view);

  // Il "chiude tra" si muove: un giro al minuto finché la vista è aperta.
  clearInterval(_tick);
  _tick = setInterval(() => {
    if (!isWorldViewOpen()) { clearInterval(_tick); _tick = null; return; }
    const cal = document.getElementById('wp-pol-cal');
    if (cal) cal.innerHTML = calendarHtml(open, byId);
  }, 60_000);
}

function buildRows(overview, byId) {
  const rows = [];
  for (const [cid, o] of Object.entries(overview.data)) {
    const c = byId.get(cid);
    if (!c) continue;
    const pop = c.rankings?.countryActivePopulation?.value ?? null;
    const lc = o.lastC, lp = o.lastP;
    rows.push({
      cid, name: c.name || cid, code: (c.code || '').toLowerCase(),
      pop,
      voters: lc?.v ?? null,
      turnout: lc?.v != null && pop ? lc.v / pop : null,
      dVoters: lc?.v != null && lc?.prevV ? (lc.v - lc.prevV) / lc.prevV : null,
      parties: lc?.parties ?? null,
      enp: lc?.enpV ?? null,
      topShare: lc?.top?.share ?? null,
      topParty: lc?.top?.p || null,
      topName: overview.partyNames?.[lc?.top?.p] || null,
      presShare: lp?.share ?? null,
      presMargin: lp?.margin ?? null,
      presDistinct: o.pres6 ? o.pres6.distinct : null,
      presN: o.pres6 ? o.pres6.n : null,
      streak: o.streak ?? null,
      president: lp?.win || null,
      presName: overview.usernames?.[lp?.win] || null,
      open: o.open || null,
    });
  }
  return rows;
}

function _flag(code) {
  const url = getFlagUrl(code);
  return url ? `<img class="wp-pol-flag" src="${url}" alt="" onerror="this.remove()">` : '';
}

function _left(ms) {
  if (ms <= 0) return pT('closing');
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  if (h >= 48) return pT('in_days', { n: Math.round(h / 24) });
  return h ? pT('in_hm', { h, m }) : pT('in_m', { m });
}

function calendarHtml(open, byId) {
  const now = Date.now();
  const voting = open.filter(e => e.phase === 'voting').sort((a, b) => (a.e || 0) - (b.e || 0));
  const cand = open.filter(e => e.phase !== 'voting').sort((a, b) => (a.s || 0) - (b.s || 0));
  const row = (e) => {
    const c = byId.get(e.cid);
    const when = e.phase === 'voting'
      ? pT('closes_in', { t: _left((e.e || 0) - now) })
      : pT('voting_from', { t: e.s ? _left(e.s - now) : '—' });
    return `<button type="button" class="wp-pol-cal-row" data-pick="${escapeHtml(e.cid)}">
      <span class="wp-pol-cal-nation">${_flag((c?.code || '').toLowerCase())}${escapeHtml(c?.name || e.cid)}</span>
      <span class="wp-pol-tag ${e.t === 'P' ? 'pres' : 'cong'}">${escapeHtml(pT(e.t === 'P' ? 'presidential' : 'congress'))}</span>
      <span class="wp-pol-dim">${escapeHtml(when)}</span>
      <span class="wp-pol-num">${e.phase === 'voting' ? escapeHtml(pT('votes_so_far', { n: e.v || 0 })) : escapeHtml(pT('candidates_n', { n: e.n || 0 }))}</span>
    </button>`;
  };
  const block = (title, list, cls) => `<div class="wp-pol-cal-block ${cls}">
      <div class="wp-pol-comp-title">${escapeHtml(title)} <span class="badge-count">${list.length}</span></div>
      ${list.length ? list.map(row).join('') : `<p class="wp-pol-dim">${escapeHtml(pT('none_now'))}</p>`}
    </div>`;
  return `<div class="panel wp-pol-card wp-pol-wide">
      <div class="panel-head"><div class="panel-icon">🗓️</div><h2>${escapeHtml(pT('calendar_title'))}</h2></div>
      <div class="wp-pol-grid2 wp-pol-cal">
        ${block(pT('phase_voting'), voting, 'voting')}
        ${block(pT('phase_candidacy'), cand, 'candidacy')}
      </div>
    </div>`;
}

function _cell(r, col) {
  const v = r[col.key];
  if (col.key === 'name') {
    return `${_flag(r.code)}<span>${escapeHtml(r.name)}</span>${r.open ? ` <span class="wp-pol-tag ${r.open.phase === 'voting' ? 'live' : ''}" title="${escapeHtml(pT(r.open.phase === 'voting' ? 'phase_voting' : 'phase_candidacy'))}">●</span>` : ''}`;
  }
  if (v == null) return '<span class="wp-pol-dim">—</span>';
  if (col.key === 'topShare') {
    return `<span class="wp-pol-cell-party" title="${escapeHtml(r.topName || '')}"><i style="background:${getPartyColor(r.topParty)}"></i>${(v * 100).toFixed(0)}%</span>`;
  }
  if (col.key === 'presShare') {
    return `<span title="${escapeHtml(r.presName || '')}${r.presMargin != null ? ` · ${escapeHtml(pT('margin'))} ${(r.presMargin * 100).toFixed(0)}%` : ''}">${(v * 100).toFixed(0)}%</span>`;
  }
  if (col.key === 'presDistinct') return `${v}<span class="wp-pol-dim">/${r.presN}</span>`;
  if (col.pct) {
    const s = (v * 100).toFixed(0) + '%';
    return col.signed ? `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${s}</span>` : s;
  }
  if (col.dec) return v.toFixed(col.dec);
  return Number(v).toLocaleString();
}

function tableHtml() {
  const col = COLS.find(c => c.key === _sort) || COLS[1];
  const q = _query.trim().toLowerCase();
  let rows = _rows.filter(r => !q || r.name.toLowerCase().includes(q));
  rows.sort((a, b) => {
    const x = a[col.key], y = b[col.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;           // i buchi sempre in fondo, in entrambi i versi
    if (y == null) return -1;
    return col.text ? _dir * String(x).localeCompare(String(y)) : _dir * (x > y ? 1 : x < y ? -1 : 0);
  });
  const total = rows.length;
  if (!_showAll && !q) rows = rows.slice(0, 50);
  const head = COLS.map(c => `<th data-sort="${c.key}" class="${c.key === _sort ? 'active' : ''}${c.text ? '' : ' num'}" title="${escapeHtml(pT(c.label + '_help'))}">${escapeHtml(pT(c.label))}${c.key === _sort ? (_dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('');
  const body = rows.map(r => `<tr data-pick="${escapeHtml(r.cid)}">${COLS.map(c => `<td class="${c.text ? '' : 'num'}">${_cell(r, c)}</td>`).join('')}</tr>`).join('');
  return `<div class="wp-pol-table-wrap"><table class="wp-pol-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${!_showAll && !q && total > 50 ? `<button type="button" class="btn-load wp-pol-more" id="wp-pol-cmp-more">${escapeHtml(pT('show_all', { n: total }))}</button>` : ''}`;
}

function wire(view) {
  view.querySelector('#wp-pol-cmp-q')?.addEventListener('input', (e) => {
    _query = e.target.value || '';
    document.getElementById('wp-pol-cmp').innerHTML = tableHtml();
  });
  // Il contenitore sopravvive ai ridisegni: il listener delegato si mette
  // una volta sola, altrimenti ogni riapertura ne aggiungerebbe un altro.
  if (view._wpWired) return;
  view._wpWired = true;
  view.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      if (k === _sort) _dir = -_dir; else { _sort = k; _dir = COLS.find(c => c.key === k)?.text ? 1 : -1; }
      document.getElementById('wp-pol-cmp').innerHTML = tableHtml();
      return;
    }
    if (e.target.closest('#wp-pol-cmp-more')) {
      _showAll = true;
      document.getElementById('wp-pol-cmp').innerHTML = tableHtml();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick && _onPick) _onPick(pick.dataset.pick);
  });
}

export { fmtDate };
