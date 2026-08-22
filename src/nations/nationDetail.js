/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: scheda di una nazione
   ------------------------------------------------------------------
   Tre strati, dal generale al singolo:

     1. le METRICS della nazione, ognuna con la sua posizione in
        classifica quando il gioco la fornisce (le `rankings` arrivano
        già dentro country.getAllCountries, zero richieste);
     2. i grafici: come si distribuiscono i cittadini fra guerra ed
        economia, e chi porta il danno settimanale;
     3. l'elenco cittadini con le loro statistiche, in LISTA o in CARD —
        stessa doppia vista dei membri di un'unità militare, e stessa
        regola: due disegni degli stessi dati, nessuna richiesta in più
        per passare dall'una all'altra.

   L'elenco cittadini è l'unico pezzo che dipende dal server di cache
   (/country-citizens): senza, si ricade su una risoluzione diretta
   limitata e lo si dichiara in chiaro invece di fingere una lista
   completa. Vedi src/nations/api.js.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { METRICS } from './metrics.js';
import { fetchCountryCitizens } from './api.js';
import { barsHtml, donutHtml } from './charts.js';
import { classifyPlaystyle } from '../mu/playstyle.js';
import { avatarImg, escapeHtml, flagImg, fmtCompact, fmtRelative } from '../mu/ui.js';
import { countryDamageToday, dailyDamageLabel, ensureDailyDamage } from '../shared/dailyDamage.js';
import { t as sharedT } from '../shared/i18n.js';

const APP_BASE = 'https://app.warera.io';

const CITIZEN_SORTS = [
  { key: 'wk',   label: 'weekly',   get: c => c.wk || 0 },
  { key: 'dmg',  label: 'total',    get: c => c.dmg || 0 },
  { key: 'w',    label: 'wealth',   get: c => c.w || 0 },
  { key: 'b',    label: 'bounty',   get: c => c.b || 0 },
  { key: 'lv',   label: 'level',    get: c => c.lv || 0 },
  { key: 'seen', label: 'lastSeen', get: c => c.seen || 0 },
  { key: 'u',    label: 'citizen',  get: c => c.u || '' },
];

const VIEW_KEY = 'we_nat_citizen_view';

let _host = null;
let _nation = null;
let _citizens = null;      // { rows, total, known, partial }
let _sort = 'wk';
let _view = (() => {
  try { return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'list'; }
  catch { return 'list'; }
})();

export function renderNationDetail(host, nation, ctx) {
  _host = host;
  if (_nation?._id !== nation._id) _citizens = null;
  _nation = nation;

  host.innerHTML = `
    <button type="button" class="wp-nat-back" id="wp-nat-back">← ${escapeHtml(natT('back'))}</button>

    <header class="wp-nat-head">
      ${flagImg(nation._id, 'wp-nat-head-flag')}
      <div>
        <h2 class="wp-nat-head-name">${escapeHtml(nation.name || '—')}</h2>
        <div class="wp-nat-head-meta" id="wp-nat-today"></div>
      </div>
    </header>

    <section class="wp-nat-stats">
      ${METRICS.map(m => statCard(nation, m)).join('')}
    </section>

    <section class="wp-nat-charts" id="wp-nat-charts"></section>

    <section class="wp-nat-citizens">
      <h3 class="wp-nat-section-title">
        ${escapeHtml(natT('citizenList'))}
        <span class="wp-nat-count" id="wp-nat-citizen-count"></span>
        <div class="wp-nat-tools">
          <label class="wp-nat-sort">
            <span>${escapeHtml(natT('sortBy'))}</span>
            <select id="wp-nat-citizen-sort">
              ${CITIZEN_SORTS.map(s => `<option value="${s.key}"${s.key === _sort ? ' selected' : ''}>${escapeHtml(natT(s.label))}</option>`).join('')}
            </select>
          </label>
          <div class="wp-nat-viewswitch" id="wp-nat-citizen-view" role="group">
            <button type="button" data-view="list" class="${_view === 'list' ? 'active' : ''}">${escapeHtml(natT('viewList'))}</button>
            <button type="button" data-view="cards" class="${_view === 'cards' ? 'active' : ''}">${escapeHtml(natT('viewCards'))}</button>
          </div>
        </div>
      </h3>
      <div id="wp-nat-citizen-list"><div class="wp-nat-empty">${escapeHtml(natT('citizensLoading'))}</div></div>
    </section>`;

  host.querySelector('#wp-nat-back').addEventListener('click', () => ctx.onBack());
  host.querySelector('#wp-nat-citizen-sort').addEventListener('change', (e) => {
    _sort = e.target.value;
    renderCitizens();
  });
  host.querySelector('#wp-nat-citizen-view').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn || btn.dataset.view === _view) return;
    _view = btn.dataset.view;
    try { localStorage.setItem(VIEW_KEY, _view); } catch { /* storage negato */ }
    host.querySelectorAll('#wp-nat-citizen-view button').forEach(b => b.classList.toggle('active', b.dataset.view === _view));
    renderCitizens();
  });

  paintToday(nation);
  loadCitizens(nation);
}

function statCard(nation, m) {
  // La posizione in classifica esiste solo per le metriche che il gioco
  // classifica davvero: per le altre (guerre, alleati, tasse) la riga
  // resta senza pastiglia invece di inventarne una.
  const rankKey = {
    pop: 'countryActivePopulation', weekly: 'weeklyCountryDamages', total: 'countryDamages',
    wealth: 'countryWealth', dev: 'countryDevelopment', regions: 'countryRegionDiff',
    perCit: 'weeklyCountryDamagesPerCitizen', bounty: 'countryBounty',
  }[m.key];
  const rank = rankKey ? nation.rankings?.[rankKey]?.rank : null;

  return `
    <div class="wp-nat-statcard">
      <div class="wp-nat-statcard-label">${escapeHtml(natT(m.label))}</div>
      <div class="wp-nat-statcard-value ${m.cls || ''}">${escapeHtml(m.fmt(m.get(nation)))}</div>
      ${rank ? `<div class="wp-nat-statcard-rank">#${rank}</div>` : ''}
    </div>`;
}

function paintToday(nation) {
  const el = _host?.querySelector('#wp-nat-today');
  if (!el) return;
  ensureDailyDamage().then(() => {
    if (_nation?._id !== nation._id) return;
    const today = countryDamageToday(nation);
    const target = _host?.querySelector('#wp-nat-today');
    if (!target || today == null) return;
    target.innerHTML = `<span>${escapeHtml(dailyDamageLabel(sharedT))}</span> <strong>${escapeHtml(fmtCompact(today))}</strong>`;
  });
}

async function loadCitizens(nation) {
  const data = await fetchCountryCitizens(nation._id);
  if (_nation?._id !== nation._id) return;   // nazione cambiata nel frattempo
  _citizens = data;
  paintCharts();
  renderCitizens();
}

function paintCharts() {
  const el = _host?.querySelector('#wp-nat-charts');
  if (!el || !_citizens) return;

  const rows = _citizens.rows;
  const styles = { war: 0, eco: 0, mixed: 0, undecided: 0 };
  for (const c of rows) {
    // Dal server arriva già classificato; dal fallback diretto abbiamo le
    // skill e si classifica qui, con lo stesso identico criterio.
    const mode = c.ps || (c.skills ? classifyPlaystyle(c).mode : null);
    if (mode && styles[mode] != null) styles[mode]++;
  }

  const styleDonut = donutHtml({
    title: natT('playstyle'),
    slices: [
      { label: natT('war'), value: styles.war, color: '#e5484d' },
      { label: natT('eco'), value: styles.eco, color: '#3fb950' },
      { label: natT('mixed'), value: styles.mixed, color: '#e3b341' },
      { label: natT('undecided'), value: styles.undecided, color: '#6e7681' },
    ],
    totalFmt: v => String(v),
  });

  const top = rows.slice().sort((a, b) => (b.wk || 0) - (a.wk || 0)).slice(0, 10);
  const topBars = barsHtml({
    title: natT('weekly'),
    rows: top.map(c => ({ label: c.u || '—', value: c.wk || 0 })),
  });

  el.innerHTML = styleDonut + topBars;
}

function renderCitizens() {
  const listEl = _host?.querySelector('#wp-nat-citizen-list');
  const countEl = _host?.querySelector('#wp-nat-citizen-count');
  if (!listEl || !_citizens) return;

  const { rows, total, known, partial } = _citizens;
  if (countEl) {
    countEl.textContent = total
      ? `${known} ${natT('citizensKnown')} ${natT('of')} ${total}`
      : String(rows.length);
  }

  if (!rows.length) {
    listEl.innerHTML = `<div class="wp-nat-empty">${escapeHtml(natT('citizensEmpty'))}</div>`;
    return;
  }

  const s = CITIZEN_SORTS.find(o => o.key === _sort) || CITIZEN_SORTS[0];
  const sorted = rows.slice().sort((a, b) => (s.key === 'u'
    ? String(s.get(a)).localeCompare(String(s.get(b)), undefined, { sensitivity: 'base' })
    : s.get(b) - s.get(a)));

  const notice = partial ? `<p class="wp-nat-notice">${escapeHtml(natT('citizensPartial'))}</p>` : '';
  listEl.innerHTML = notice + (_view === 'cards'
    ? `<div class="wp-nat-citizen-grid">${sorted.map(citizenCard).join('')}</div>`
    : citizenTable(sorted));
}

const CITIZEN_COLS = [
  { label: 'citizen' },
  { label: 'level',    num: true, get: c => c.lv ?? '—' },
  { label: 'mrank',    num: true, get: c => c.mr ?? '—' },
  { label: 'playstyle', get: c => psPill(c) },
  { label: 'weekly',   num: true, get: c => fmtCompact(c.wk || 0), cls: 'wk' },
  { label: 'total',    num: true, get: c => fmtCompact(c.dmg || 0) },
  { label: 'wealth',   num: true, get: c => fmtCompact(c.w || 0), cls: 'money' },
  { label: 'bounty',   num: true, get: c => fmtCompact(c.b || 0) },
  { label: 'atk',      num: true, get: c => (c.atk != null ? fmtCompact(c.atk) : '—') },
  { label: 'lastSeen', num: true, get: c => (c.seen ? fmtRelative(new Date(c.seen).toISOString()) : '—'), cls: 'when' },
];

function psPill(c) {
  const mode = c.ps || (c.skills ? classifyPlaystyle(c).mode : null);
  if (!mode) return '—';
  return `<span class="wp-nat-ps wp-nat-ps-${mode}">${escapeHtml(natT(mode === 'war' ? 'war' : mode === 'eco' ? 'eco' : mode === 'mixed' ? 'mixed' : 'undecided'))}</span>`;
}

function citizenTable(rows) {
  const head = CITIZEN_COLS.map(c => `
    <span class="wp-nat-cth${c.num ? ' wp-nat-num' : ''}">${escapeHtml(natT(c.label))}</span>`).join('');

  const body = rows.map(c => `
    <a class="wp-nat-crow" href="${APP_BASE}/user/${encodeURIComponent(c.id)}" target="_blank" rel="noopener noreferrer">
      <span class="wp-nat-cname">
        ${avatarImg(c.a, c.u || '', 'wp-mu-avatar wp-mu-avatar-xs')}
        <span class="wp-nat-cnick">${escapeHtml(c.u || '—')}</span>
      </span>
      ${CITIZEN_COLS.slice(1).map(col => `<span class="${col.num ? 'wp-nat-num ' : ''}${col.cls || ''}">${col.get(c)}</span>`).join('')}
    </a>`).join('');

  return `<div class="wp-nat-ctable-wrap"><div class="wp-nat-ctable">
    <div class="wp-nat-cthead">${head}</div>
    ${body}
  </div></div>`;
}

function citizenCard(c) {
  const cell = (label, value, cls = '') => `
    <div class="wp-nat-ccell">
      <span class="wp-nat-ccell-k">${escapeHtml(label)}</span>
      <span class="wp-nat-ccell-v ${cls}">${value}</span>
    </div>`;

  return `
    <a class="wp-nat-ccard" href="${APP_BASE}/user/${encodeURIComponent(c.id)}" target="_blank" rel="noopener noreferrer">
      <div class="wp-nat-ccard-top">
        ${avatarImg(c.a, c.u || '', 'wp-mu-avatar wp-mu-avatar-sm')}
        <div class="wp-nat-ccard-main">
          <span class="wp-nat-cnick">${escapeHtml(c.u || '—')}</span>
          <span class="wp-nat-ccard-sub">${escapeHtml(natT('level'))} ${c.lv ?? '—'} · ${escapeHtml(natT('mrank'))} ${c.mr ?? '—'}</span>
        </div>
        ${psPill(c)}
      </div>
      <div class="wp-nat-ccard-stats">
        ${cell(natT('weekly'), escapeHtml(fmtCompact(c.wk || 0)), 'wk')}
        ${cell(natT('total'), escapeHtml(fmtCompact(c.dmg || 0)))}
        ${cell(natT('wealth'), escapeHtml(fmtCompact(c.w || 0)), 'money')}
        ${cell(natT('bounty'), escapeHtml(fmtCompact(c.b || 0)))}
        ${cell(natT('atk'), c.atk != null ? escapeHtml(fmtCompact(c.atk)) : '—')}
        ${cell(natT('lastSeen'), c.seen ? escapeHtml(fmtRelative(new Date(c.seen).toISOString())) : '—', 'when')}
      </div>
    </a>`;
}
