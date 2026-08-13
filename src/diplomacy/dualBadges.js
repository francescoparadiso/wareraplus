// dualBadges.js
// ══════════════════════════════════════════════════════════════
// WarEra+ — Badge "alleato + patto difensivo" (Opzione B)
// ------------------------------------------------------------------
// Complementa il bordo viola (Opzione A, in map.js/LYR_DIPLOMACY_DUAL):
// oltre al bordo sul poligono, mostra un piccolo badge 🛡️ al centroide
// della nazione, per chi preferisce un segnale puntuale e immediato
// invece di (o in aggiunta a) osservare il bordo del confine.
//
// Segue lo stesso pattern di battleMarkers.js (maplibregl.Marker su
// elemento HTML custom, diff invece di clear+ricrea ad ogni update).
// ══════════════════════════════════════════════════════════════

import maplibregl from 'maplibre-gl';
import { state } from './state.js';

const badges = new Map(); // countryId -> { marker, el }

function buildBadgeEl(nationName) {
  const el = document.createElement('div');
  el.className = 'wp-dual-badge';
  el.title = `${nationName}: alleato + patto difensivo`;
  el.innerHTML = '🛡️';
  el.style.cssText = `
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(155, 89, 182, 0.9);
    border: 1.5px solid rgba(255,255,255,0.85);
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; line-height: 1;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    cursor: default;
    pointer-events: none;
  `;
  return el;
}

/**
 * Aggiorna i badge per l'insieme corrente di nazioni "dual" (alleato +
 * patto difensivo). Va chiamata dallo stesso punto di renderMap() dove
 * viene ricalcolato dualIds, con lo stesso array.
 * @param {string[]} dualIds
 */
export function updateDualBadges(dualIds) {
  if (!state.map) return;
  const seen = new Set();

  for (const id of dualIds) {
    const centroid = state.centroids.get(id);
    if (!centroid) continue;
    seen.add(id);

    const existing = badges.get(id);
    if (existing) {
      existing.marker.setLngLat(centroid);
    } else {
      const nation = state.nationMap.get(id);
      const el = buildBadgeEl(nation?.name || id);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(centroid)
        .addTo(state.map);
      badges.set(id, { marker, el });
    }
  }

  // Rimuovi i badge di nazioni non più "dual"
  for (const [id, entry] of badges) {
    if (seen.has(id)) continue;
    try { entry.marker.remove(); } catch (_) {}
    badges.delete(id);
  }
}

export function clearDualBadges() {
  badges.forEach(({ marker }) => {
    try { marker.remove(); } catch (_) {}
  });
  badges.clear();
}
