import { state } from './state.js';
import { parseCSV, showToast } from './utils.js';
import { EXTERNAL_NAPS_URL } from './config.js';
import { renderMap } from './map.js';
import { updateExternalNapsUI, updateNapListUI } from './ui.js';
import { trackEvent } from '../shared/analytics.js';

// WarEra+ fix (429): il CSV sta su raw.githubusercontent.com, coperto da una
// cache Workbox StaleWhileRevalidate (vite.config: 'warera-csv-cache'). Il
// vecchio cache-buster `?t=Date.now()` rendeva ogni URL unico → sempre
// cache-MISS → ogni load colpiva l'origine → GitHub raw rate-limitava (429).
// Rimosso il buster (così la SWR serve la copia e rivalida in background) e
// aggiunto un retry a backoff esponenziale su 429/5xx, coerente col pattern
// di retry già usato altrove nel repo (trpcBatch). Fallback invariato: al
// fallimento finale il catch tiene i NAP già caricati e avvisa.
async function fetchCsvWithRetry(url, { retries = 3, base = 800 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(url);
    if (resp.ok) return resp;
    if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
      await new Promise(r => setTimeout(r, base * 2 ** attempt));
      continue;
    }
    throw new Error(`HTTP ${resp.status}`);
  }
}

// ==================== NAP ESTERNI ====================
export async function loadExternalNaps() {
  try {
    const resp = await fetchCsvWithRetry(EXTERNAL_NAPS_URL);
    const csv = await resp.text();
    const napsData = parseCSV(csv);

    state.externalNapsList = [];
    state.externalNapsSet.clear();

    for (const row of napsData) {
      const nationACode = row.nazione_A?.trim().toUpperCase();
      const napConStr   = row.nap_con?.trim();
      if (!nationACode || !napConStr) continue;

      const countryA = state.nationByCode.get(nationACode);
      if (!countryA) continue;

      for (const targetCode of napConStr.split(',').map(c => c.trim().toUpperCase())) {
        const countryB = state.nationByCode.get(targetCode);
        if (!countryB) continue;
        const key    = `${countryA._id}-${countryB._id}`;
        const revKey = `${countryB._id}-${countryA._id}`;
        if (!state.externalNapsSet.has(key) && !state.externalNapsSet.has(revKey)) {
          state.externalNapsSet.add(key);
          state.externalNapsList.push({ fromId: countryA._id, toId: countryB._id, fromName: countryA.name, toName: countryB.name });
        }
      }
    }

    updateExternalNapsUI();
    renderMap();
    showToast(`${state.externalNapsList.length} external NAPs loaded`, 'success');
  } catch (err) {
    console.error('Errore NAP esterni:', err);
    showToast('External NAPs unavailable.', 'warning');
    trackEvent('data-unavailable', { source: 'external-naps' });
  }
}

// ==================== NAP MANUALI ====================
export function aggiungiNap() {
  const input = document.getElementById('napInput');
  const val   = input.value.trim();
  if (!val) { showToast('Enter a nation name', 'error'); return; }

  const lower = val.toLowerCase();
  const found = state.nazioniGlobal.find(n => n.name.toLowerCase() === lower);
  if (!found)                              { showToast(`Nation "${val}" not found`, 'error'); return; }
  if (state.customNaps.includes(found._id)){ showToast(`${found.name} already in NAP`, 'error'); return; }
  if (state.selectedCountryId === found._id){ showToast('Cannot add selected nation', 'error'); return; }

  state.customNaps.push(found._id);
  input.value = '';
  updateNapListUI();
  renderMap();
  showToast(`Added ${found.name} to NAP`, 'success');
  trackEvent('add-manual-nap', { nation: found.name });
}

export function rimuoviNap(id) {
  const nation = state.nationMap.get(id);
  state.customNaps = state.customNaps.filter(n => n !== id);
  updateNapListUI();
  renderMap();
  trackEvent('remove-manual-nap', { nation: nation?.name || id });
}

// updateNapListUI vive in ui.js (versione con bandiere): qui la ri-esportiamo
// per non rompere gli import esistenti. Prima c'erano due implementazioni
// diverse e aggiungendo un NAP si perdevano le bandiere fino al reload.
export { updateNapListUI } from './ui.js';
