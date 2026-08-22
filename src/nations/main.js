/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: orchestratore
   ------------------------------------------------------------------
   Stesso ruolo che src/mu/main.js ha per le Unità Militari: monta la
   vista dentro il div che l'overlay gli passa (#wp-nations-root), tiene i
   tab (panoramica, 1vs2, grafici) più la scheda della singola nazione, e
   decide chi è a schermo.

   Caricato via import() dinamico da src/app/nationsOverlay.js alla PRIMA
   apertura: il suo chunk non pesa sul boot.

   Non scarica le nazioni: sono già in memoria da Diplomacy
   (state.nazioniGlobal, vedi src/nations/api.js). Se la mappa non ha
   ancora finito di caricare, la vista aspetta l'evento
   `wareraplus:diplomacy-ready` invece di rifare la stessa fetch.
   ══════════════════════════════════════════════════════════════ */

import '../styles/nations.css';
import { getNation, getNations } from './api.js';
import { natT } from './i18n.js';
import { renderNationList } from './nationList.js';
import { renderNationCompare } from './nationCompare.js';
import { renderNationDetail } from './nationDetail.js';
import { METRICS, metricValue } from './metrics.js';
import { donutHtml, barsHtml } from './charts.js';
import { escapeHtml, flagImg, fmtCompact } from '../mu/ui.js';
import { trackEvent } from '../shared/analytics.js';

let rootEl = null;
let tab = 'overview';                 // 'overview' | 'compare' | 'charts'
let openCountryId = null;
let sort = { key: 'weekly', dir: -1 };
let search = '';
let searchFocused = false;
const sides = new Map();              // countryId → 'a' | 'b' (confronto 1vs2)
let langBound = false;

export async function initNationsView(container) {
  rootEl = container;
  bindLangChange();

  if (!getNations().length) {
    rootEl.innerHTML = `<div class="wp-nat-page"><div class="wp-nat-empty">${escapeHtml(natT('loading'))}</div></div>`;
    await new Promise(resolve => {
      const done = () => { window.removeEventListener('wareraplus:diplomacy-ready', done); resolve(); };
      window.addEventListener('wareraplus:diplomacy-ready', done);
      // Guardia: se l'evento è già passato prima che questa vista esistesse,
      // le nazioni ci sono comunque e non si aspetta nessuno.
      if (getNations().length) done();
    });
  }

  render();
  trackEvent('nations-open', { nations: getNations().length });
}

function bindLangChange() {
  if (langBound) return;
  langBound = true;
  window.addEventListener('wareraplus:langchange', () => { if (rootEl) render(); });
}

function render() {
  if (!rootEl) return;
  const nations = getNations();

  if (openCountryId) {
    const nation = getNation(openCountryId);
    if (nation) {
      rootEl.innerHTML = '<div class="wp-nat-page" id="wp-nat-body"></div>';
      renderNationDetail(rootEl.querySelector('#wp-nat-body'), nation, {
        onBack: () => { openCountryId = null; render(); },
      });
      return;
    }
    openCountryId = null;
  }

  rootEl.innerHTML = `
    <div class="wp-nat-page">
      <header class="wp-nat-masthead">
        <h2 class="wp-nat-title">${escapeHtml(natT('title'))}</h2>
        <p class="wp-nat-subtitle">${nations.length} ${escapeHtml(natT('nations'))}</p>
      </header>
      <div class="wp-nat-tabs">
        ${[['overview', 'tabOverview'], ['compare', 'tabCompare'], ['charts', 'tabCharts']].map(([key, label]) => `
          <button type="button" class="wp-nat-tab${tab === key ? ' active' : ''}" data-tab="${key}">${escapeHtml(natT(label))}</button>`).join('')}
      </div>
      <div id="wp-nat-body"></div>
    </div>`;

  rootEl.querySelectorAll('.wp-nat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      searchFocused = false;
      render();
      trackEvent('nations-tab', { tab });
    });
  });

  const body = rootEl.querySelector('#wp-nat-body');
  if (tab === 'overview') {
    renderNationList(body, {
      nations, sort, search, searchFocused,
      onSort: (key) => {
        // Ricliccare la stessa colonna inverte il verso, come nell'elenco
        // unità militari e nella tabella delle alleanze.
        sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: -1 };
        searchFocused = false;
        render();
      },
      onSearch: (v) => { search = v; searchFocused = true; render(); },
      onOpen: (countryId) => {
        openCountryId = countryId;
        searchFocused = false;
        render();
        trackEvent('nations-detail-open', { countryId });
      },
    });
  } else if (tab === 'compare') {
    renderNationCompare(body, {
      nations, sides, search, searchFocused,
      onCycle: (countryId) => {
        // Un clic: schieramento A. Due: B. Tre: fuori. Stessa meccanica del
        // Faction 1vs2 di Statistiche alleanze.
        const cur = sides.get(countryId);
        if (!cur) sides.set(countryId, 'a');
        else if (cur === 'a') sides.set(countryId, 'b');
        else sides.delete(countryId);
        searchFocused = false;
        render();
      },
      onResetSides: () => { sides.clear(); render(); },
      onSearch: (v) => { search = v; searchFocused = true; render(); },
    });
  } else {
    renderCharts(body, nations);
  }
}

/* ── Tab grafici: il mondo intero, quattro quote e una classifica ── */
function renderCharts(body, nations) {
  const slice = (key) => nations
    .map(n => ({ label: n.name || '—', value: metricValue(n, key) }))
    .filter(s => s.value > 0);

  body.innerHTML = `
    <div class="wp-nat-chart-grid">
      ${donutHtml({ title: natT('chartWeekly'), slices: slice('weekly'), otherLabel: natT('others') })}
      ${donutHtml({ title: natT('chartWealth'), slices: slice('wealth'), otherLabel: natT('others') })}
      ${donutHtml({ title: natT('chartPop'), slices: slice('pop'), otherLabel: natT('others'), totalFmt: v => fmtCompact(v) })}
      ${donutHtml({ title: natT('chartDev'), slices: slice('dev'), otherLabel: natT('others'), totalFmt: v => v.toFixed(0) })}
    </div>
    <div class="wp-nat-chart-grid">
      ${barsHtml({
        title: `${natT('perCitizen')} — ${natT('weekly')}`,
        rows: nations.slice()
          .sort((a, b) => metricValue(b, 'perCit') - metricValue(a, 'perCit'))
          .slice(0, 12)
          .map(n => ({ label: n.name || '—', value: metricValue(n, 'perCit'), icon: flagImg(n._id) })),
      })}
      ${barsHtml({
        title: natT('development'),
        rows: nations.slice()
          .sort((a, b) => metricValue(b, 'dev') - metricValue(a, 'dev'))
          .slice(0, 12)
          .map(n => ({ label: n.name || '—', value: metricValue(n, 'dev'), icon: flagImg(n._id), color: '#3fb950' })),
        fmt: v => v.toFixed(1),
      })}
    </div>`;
}

/** Apre direttamente la scheda di una nazione (pannello nazione, ricerca). */
export function openNationDetail(countryId) {
  openCountryId = countryId;
  if (rootEl) render();
}

export { METRICS };
