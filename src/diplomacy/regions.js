// regions.js
import { state } from './state.js';
import { API_BASE_URL } from './config.js';
import { showToast } from './utils.js';
import { fetchRegionsViaCache } from './cacheClient.js';

export async function loadRegions() {
  try {
    state.regionData = await fetchRegionsViaCache();
    console.log(`Loaded ${Object.keys(state.regionData).length} regions (cache)`);
    return;
  } catch (err) {
    console.warn('[cache] regioni non disponibili, fallback diretto:', err.message);
  }
  try {
    const res = await fetch(`${API_BASE_URL}/trpc/region.getRegionsObject`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // BUG FIX: qui sotto veniva assegnato l'involucro tRPC intero
    // ({result:{data:{...}}}) invece del contenuto — stesso errore che
    // main.js evita con `nationsData.result.data`. Risultato visibile:
    // "Loaded 1 regions" in console (Object.keys su un oggetto con la sola
    // chiave "result"), invece del vero conteggio regioni. La risposta è un
    // oggetto chiave: valore (regionId -> region), come nel path cache sopra.
    state.regionData = json.result?.data ?? json;
    console.log(`Loaded ${Object.keys(state.regionData).length} regions`);
  } catch (err) {
    console.error('loadRegions error:', err);
    state.regionData = {};
    showToast('Failed to load region data', 'warning');
  }
}