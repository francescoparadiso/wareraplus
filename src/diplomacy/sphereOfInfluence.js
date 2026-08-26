import { state } from './state.js';
import { parseCSV, showToast } from './utils.js';
import { EXTERNAL_SPHERE_URL, COLORS } from './config.js';
import { mergedSphereGroups } from '../proxy/radar.js';
import { renderMap } from './map.js';
import { updateDynamicLegend } from './ui.js';
import { trackEvent } from '../shared/analytics.js';

// WarEra+ fix (429): stesso problema di naps.js — cache-buster `?t=Date.now()`
// che annullava la cache SWR di raw.githubusercontent.com e causava i 429.
// Rimosso + retry a backoff su 429/5xx. Vedi nota estesa in naps.js.
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

// ==================== CARICAMENTO CSV ====================
// CSV format: nazione_primaria,codici_proxy,label_lng,label_lat
// nazione_primaria : codice ISO della nazione primaria (es. "RU")
// codici_proxy     : lista di codici ISO delle nazioni proxy, separati da virgola (es. "BY,KP,SY")
// label_lng/label_lat (opzionali) : coordinate per un eventuale label di gruppo
export async function loadSphereOfInfluence() {
  try {
    const resp = await fetchCsvWithRetry(EXTERNAL_SPHERE_URL);
    const csv = await resp.text();
    const data = parseCSV(csv);
    buildSphereMapFromData(data);
    updateDynamicLegend();
    if (state.coloringMode === 'sphereOfInfluence') renderMap();
    showToast('Sphere of Influence data loaded', 'success');
  } catch (err) {
    console.error('Errore Sphere of Influence:', err);
    buildSphereMapFromData([]);
    showToast('Sphere of Influence data unavailable.', 'warning');
    trackEvent('data-unavailable', { source: 'sphere-of-influence' });
  }
}

// ==================== BUILD MAP ====================
export function buildSphereMapFromData(rows) {
  state.sphereMap.clear();
  state.spherePrimaries.clear();
  state.sphereInfo = [];

  if (!rows || !rows.length) return;

  for (const row of rows) {
    const primaryCode = row.nazione_primaria?.trim().toUpperCase();
    const proxyStr = row.codici_proxy?.trim();
    if (!primaryCode || !proxyStr) continue;

    const primary = state.nationByCode.get(primaryCode);
    if (!primary) continue;

    const labelLng = parseFloat(row.label_lng);
    const labelLat = parseFloat(row.label_lat);

    const proxyIds = [];
    proxyStr.split(',').map(c => c.trim().toUpperCase()).filter(Boolean).forEach(code => {
      const proxy = state.nationByCode.get(code);
      if (!proxy || proxy._id === primary._id) return;
      state.sphereMap.set(proxy._id, primary._id);
      proxyIds.push(proxy._id);
    });

    state.spherePrimaries.add(primary._id);
    state.sphereInfo.push({
      primaryId: primary._id,
      primaryName: primary.name,
      proxyIds,
      labelLng: isNaN(labelLng) ? null : labelLng,
      labelLat: isNaN(labelLat) ? null : labelLat,
    });
  }
}

// ==================== COLORE ====================
function _getPrimaryColor(primaryId) {
  return state.nationBaseColorMap.get(primaryId) || COLORS.DEFAULT_LAND;
}

// ==================== EXPRESSION FILL ====================
// isOriginal: true -> usa 'initialCountryId' (territori originali), false -> 'countryId' (attuali)
export function buildSphereColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const colorMap = new Map();

  // WarEra+: alle sfere del CSV si sommano quelle del radar (src/proxy/
  // radar.js). Sulla mappa entrano solo i rilevamenti dati per sicuri
  // almeno al 75% — sotto quella soglia si vedono nell'elenco del pannello
  // con la loro percentuale, e sulla mappa solo se l'utente accende il
  // toggle "anche i rilevamenti incerti". Il CSV si disegna sempre.
  // Se il radar non ha ancora finito (o non è disponibile), mergedSphereGroups
  // restituisce esattamente le sfere del CSV: comportamento originale intatto.
  for (const group of mergedSphereGroups({ forMap: true })) {
    const color = _getPrimaryColor(group.primaryId);
    colorMap.set(group.primaryId, color);
    group.proxies.forEach(proxy => colorMap.set(proxy.id, color));
  }

  if (!colorMap.size) return COLORS.DEFAULT_LAND;

  const expr = isOriginal ? ['match', ['to-string', ['get', prop]]] : ['match', ['get', prop]];
  for (const [id, color] of colorMap.entries()) {
    expr.push(isOriginal ? id.toString() : id, color);
  }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}
