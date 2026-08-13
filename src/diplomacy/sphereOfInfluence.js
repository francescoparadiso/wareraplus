import { state } from './state.js';
import { parseCSV, showToast } from './utils.js';
import { EXTERNAL_SPHERE_URL, COLORS } from './config.js';
import { renderMap } from './map.js';
import { updateDynamicLegend } from './ui.js';

// ==================== CARICAMENTO CSV ====================
// CSV format: nazione_primaria,codici_proxy,label_lng,label_lat
// nazione_primaria : codice ISO della nazione primaria (es. "RU")
// codici_proxy     : lista di codici ISO delle nazioni proxy, separati da virgola (es. "BY,KP,SY")
// label_lng/label_lat (opzionali) : coordinate per un eventuale label di gruppo
export async function loadSphereOfInfluence() {
  try {
    const resp = await fetch(EXTERNAL_SPHERE_URL + `?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

  for (const info of state.sphereInfo) {
    const color = _getPrimaryColor(info.primaryId);
    colorMap.set(info.primaryId, color);
    info.proxyIds.forEach(proxyId => colorMap.set(proxyId, color));
  }

  if (!colorMap.size) return COLORS.DEFAULT_LAND;

  const expr = isOriginal ? ['match', ['to-string', ['get', prop]]] : ['match', ['get', prop]];
  for (const [id, color] of colorMap.entries()) {
    expr.push(isOriginal ? id.toString() : id, color);
  }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}
