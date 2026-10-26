import { state } from './state.js';
import { showToast } from './utils.js';
import { renderMap } from './map.js';
import { updateNapListUI } from './ui.js';
import { trackEvent } from '../shared/analytics.js';

// WarEra+ (2026-10-23): i NAP "esterni" NON vengono più dal CSV su
// raw.githubusercontent.com (warera_naps.csv, richiesta dell'utente: "d'ora
// in poi si userà solo questo"). L'unica fonte è la sezione Accordi
// (src/accordi/*, server/plusApi/accordi.js): src/diplomacy/accordiNaps.js
// riempie state.externalNapsSet / externalNapsList, che le letture del
// colore (diplomacy.js, borderStyle.js, ui.js) guardano come prima.

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
