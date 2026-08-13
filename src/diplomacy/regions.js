// regions.js
import { state } from './state.js';
import { API_BASE_URL } from './config.js';
import { showToast } from './utils.js';

export async function loadRegions() {
  try {
    const res = await fetch(`${API_BASE_URL}/trpc/region.getRegionsObject`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // La risposta è un oggetto chiave: valore
    state.regionData = data;
    console.log(`Loaded ${Object.keys(state.regionData).length} regions`);
  } catch (err) {
    console.error('loadRegions error:', err);
    state.regionData = {};
    showToast('Failed to load region data', 'warning');
  }
}