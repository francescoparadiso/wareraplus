/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: ui.js come modulo ES (Fase 2, Stage 5)
   ------------------------------------------------------------------
   Conversione di public/political/ui.js. `Chart`/`TomSelect` da CDN
   globali a import npm (chart.js/auto, tom-select — installate Stage 0).

   showPartyView() nell'originale chiamava in avanti
   loadPartiesForSelector/loadPartyDetails (party.js) come identificatori
   nudi — dipendenza cross-modulo REALE (party.js a sua volta importa
   showSkeletonPartyView/hideSkeletonPartyView da qui, quindi un
   `import` statico diretto sarebbe circolare ma tecnicamente valido in
   ES modules finché non si usano i binding a top-level). Per restare
   coerenti con lo stesso pattern già usato in config.js: toggleTheme
   (Stage 2), showPartyView accetta le due funzioni come parametri
   iniettati da chi orchestra l'app (src/political/main.js, Stage 8)
   invece di importarle qui — evita anche di dover far esistere
   party.js già a questo stage per poter verificare ui.js in isolamento.
   ══════════════════════════════════════════════════════════════ */

import Chart from 'chart.js/auto';
import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.css';
import { localFetch } from './api.js';
import { currentCountryId, countryNamesMap, currentPartyId } from './config.js';
import { t } from './i18n.js';

/* ── VIEW HELPERS ── */
export function showView(which) {
  document.getElementById('president-view').style.display = which === 'president' ? '' : 'none';
  document.getElementById('congress-view').style.display  = which === 'congress'  ? '' : 'none';
  document.getElementById('candidatesContainer').style.display = 'none';
  document.getElementById('party-view').style.display     = 'none';

  // Mostra stats e timeline solo se siamo in una vista elettorale
  const statsRow = document.querySelector('.stats-row');
  const timelinePanel = document.getElementById('timelinePanel');
  if (statsRow) statsRow.style.display = '';
  // Il timeline lo mostriamo solo per il congresso, non per il presidente
  if (timelinePanel) {
    timelinePanel.style.display = which === 'congress' ? '' : 'none';
  }
}

export function showPartyView({ loadPartiesForSelector, loadPartyDetails } = {}) {
  document.getElementById('president-view').style.display = 'none';
  document.getElementById('congress-view').style.display  = 'none';
  document.getElementById('party-view').style.display     = '';

  // Nascondi la riga delle statistiche e il timeline
  const statsRow = document.querySelector('.stats-row');
  const timelinePanel = document.getElementById('timelinePanel');
  if (statsRow) statsRow.style.display = 'none';
  if (timelinePanel) timelinePanel.style.display = 'none';

  loadPartiesForSelector?.();
  if (currentPartyId) loadPartyDetails?.(currentPartyId);
}

export function showElectionView() {
  document.getElementById('party-view').style.display = 'none';
  const pv = document.getElementById('president-view');
  const cv = document.getElementById('congress-view');
  if (pv.style.display === 'none' && cv.style.display === 'none') {
    cv.style.display = '';
  }
  // Mostra stats e timeline (se congrsso)
  const statsRow = document.querySelector('.stats-row');
  const timelinePanel = document.getElementById('timelinePanel');
  if (statsRow) statsRow.style.display = '';
  if (timelinePanel) {
    timelinePanel.style.display = (cv.style.display !== 'none') ? '' : 'none';
  }
}

/* ── SKELETON ── */
const _partySkHtml = `
  <div class="psk-overview">
    <div class="psk-avatar"></div>
    <div class="psk-lines">
      <div class="psk-line psk-line-wide"></div>
      <div class="psk-line psk-line-med"></div>
      <div class="psk-line psk-line-short"></div>
    </div>
  </div>`;

function _partySkMembersHtml() {
  return Array.from({length: 4}, () => `
    <div class="psk-member-row">
      <div class="psk-mem-avatar"></div>
      <div class="psk-lines" style="flex:1">
        <div class="psk-line psk-line-med"></div>
        <div class="psk-line psk-line-short"></div>
      </div>
    </div>`).join('');
}

export function showSkeletonPartyView() {
  const blanks = {
    partyOverview:            _partySkHtml,
    partyMembersContainer:    _partySkMembersHtml(),
    partyElectedContainer:    _partySkMembersHtml(),
    partyLeadershipContainer: _partySkMembersHtml(),
  };
  for (const [id, html] of Object.entries(blanks)) {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = html; el.classList.add('psk-loading'); }
  }
}

export function hideSkeletonPartyView() {
  ['partyOverview','partyMembersContainer','partyElectedContainer','partyLeadershipContainer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('psk-loading');
  });
}

export function showSkeleton() {
  document.getElementById('parliamentSkeleton').style.display  = '';
  document.getElementById('parliamentContainer').style.display = 'none';
  document.getElementById('tableSkeleton').style.display       = '';
  document.getElementById('partyTable').style.display          = 'none';
  ['seatsChart', 'membersChart', 'votesChart'].forEach(id => {
    const c  = document.getElementById(id);
    const sk = c?.previousElementSibling;
    if (sk && sk.classList.contains('sk-chart-block')) sk.style.display = '';
    if (c) c.style.display = 'none';
  });
  const apCanvas = document.getElementById('allPartiesChart');
  const apSk     = apCanvas?.previousElementSibling;
  if (apSk && apSk.classList.contains('sk-chart-block')) apSk.style.display = '';
  if (apCanvas) apCanvas.style.display = 'none';
}
export function hideSkeleton() {
  document.getElementById('parliamentSkeleton').style.display  = 'none';
  document.getElementById('parliamentContainer').style.display = '';
  document.getElementById('tableSkeleton').style.display       = 'none';
  document.getElementById('partyTable').style.display          = '';
  ['seatsChart', 'membersChart', 'votesChart'].forEach(id => {
    const c  = document.getElementById(id);
    const sk = c?.previousElementSibling;
    if (sk && sk.classList.contains('sk-chart-block')) sk.style.display = 'none';
    if (c) c.style.display = '';
  });
  const apCanvas = document.getElementById('allPartiesChart');
  const apSk     = apCanvas?.previousElementSibling;
  if (apSk && apSk.classList.contains('sk-chart-block')) apSk.style.display = 'none';
  if (apCanvas) apCanvas.style.display = '';
}

/* ── STATUS & STATS ── */
export function setStatus(msg, type = '') {
  const el = document.getElementById('statusBadge');
  el.textContent = msg; el.className = 'badge-status ' + type;
}
export function fillStat(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.classList.remove('skeleton-val');
  el.classList.add('loaded');
}
export function resetStats() {
  ['stat-seats', 'stat-parties', 'stat-totalvotes', 'stat-majority', 'stat-leader'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '—';
    el.classList.add('skeleton-val');
    el.classList.remove('loaded');
  });
  const enpLabel = document.getElementById('stat-enp-label');
  if (enpLabel) { enpLabel.textContent = '—'; enpLabel.style.color = ''; }
}
export function safeDestroy(canvasId) {
  const existing = Chart.getChart(canvasId);
  if (existing) existing.destroy();
}

/* ── EXPORT CSV ── */
export function exportCSV(parties, filename = 'parliament.csv') {
  if (!parties || !parties.length) { alert('No data to export.'); return; }
  const headers  = [t('col_party'), t('col_abbr'), t('col_seats'), t('col_members'), t('col_votes'), t('col_seat_pct'), t('col_leader'), t('col_color')];
  const totalSeats = parties.reduce((s, p) => s + p.seats, 0);
  const rows = parties.map(p => [
    `"${p.name.replace(/"/g, '""')}"`,
    p.abbr, p.seats, p.members, p.votes,
    totalSeats ? ((p.seats / totalSeats) * 100).toFixed(2) : 0,
    `"${(p.leaderName || '').replace(/"/g, '""')}"`,
    p.color,
  ]);
  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── FULLSCREEN PARLIAMENT ── */
export function openParliamentFullscreen() {
  const container = document.getElementById('parliamentContainer');
  const overlay   = document.getElementById('parliamentOverlay');
  const dest      = document.getElementById('parliamentOverlayContent');
  if (!container || !overlay || !dest) return;
  const svg = container.querySelector('svg');
  if (!svg) return;
  overlay._svg            = svg;
  overlay._originalParent = svg.parentNode;
  dest.innerHTML          = '';
  svg.style.width         = '100%';
  svg.style.height        = '100%';
  dest.appendChild(svg);
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
export function closeParliamentFullscreen() {
  const overlay = document.getElementById('parliamentOverlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  if (overlay._svg && overlay._originalParent) {
    overlay._svg.style.width  = '';
    overlay._svg.style.height = '';
    overlay._originalParent.appendChild(overlay._svg);
    overlay._svg            = null;
    overlay._originalParent = null;
  }
}

/* ── COUNTRIES ── */
export async function loadCountries() {
  const select = document.getElementById('countrySelect');
  if (!select) return;
  if (select.tomselect) select.tomselect.destroy();
  const tomSelect = new TomSelect(select, {
    placeholder: 'Search country…',
    allowEmptyOption: true,
    create: false,
    sortField: { field: 'text', direction: 'asc' },
    maxOptions: null,
    shouldSort: true,
  });
  try {
    const data  = await localFetch('/countries');
    const items = data?.items || [];
    if (!Array.isArray(items) || items.length === 0) throw new Error('No countries found');
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    items.forEach(c => {
      tomSelect.addOption({ value: c._id, text: c.name || c._id });
      countryNamesMap.set(c._id, c.name);
    });
    const savedOption = tomSelect.options[currentCountryId];
    tomSelect.setValue(savedOption ? currentCountryId : (Object.keys(tomSelect.options)[0] || ''));
    select.tomselect = tomSelect;
  } catch (err) {
    console.warn('⚠️ Unable to load countries:', err.message);
    tomSelect.addOption({ value: '6813b6d446e731854c7ac7a2', text: 'Italy' });
    tomSelect.setValue('6813b6d446e731854c7ac7a2');
    select.tomselect = tomSelect;
  }
}
