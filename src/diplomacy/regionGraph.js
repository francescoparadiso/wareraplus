/* ══════════════════════════════════════════════════════════════
   WarEra+ — Grafo delle regioni (nomi, vicini, punto sulla mappa)
   ------------------------------------------------------------------
   Modulo NUOVO (2026-11-17). Prima viveva dentro travelDistance.js, la
   vista mappa "Distanze", tolta il 2026-11-17 perché dalla v0.28.3 le
   casse non stanno più sulla mappa e il ritorno gratis a casa non c'è
   più (gameConfig.mapTravel). È rimasto solo ciò che serve ad altri:
   la lavagna delle operazioni (src/private/*) e gli impulsi sulla mappa
   (mapPulses.js).

   Il dato è quello che la mappa ha già in memoria (state.mapDataGlobal):
   zero fetch. Ogni geometria di topoData.objects.regions porta `neighbors`
   (gli id delle regioni confinanti, misurato simmetrico: 726 regioni).
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';

let _topo = null;
let _graph = new Map();       // regionId → [regionId confinanti]
let _pos = new Map();         // regionId → [lng, lat]
let _labelNames = new Map();  // regionId → nome, dalle etichette della mappa

/** Ricostruisce il grafo solo se la mappa in memoria è cambiata
 *  (refreshData sostituisce l'oggetto intero). */
function graph() {
  const topo = state.mapDataGlobal?.map;
  if (!topo) return _graph;
  if (topo === _topo) return _graph;
  _topo = topo;
  _graph = new Map();
  _pos = new Map();
  _labelNames = new Map();
  for (const g of topo.objects?.regions?.geometries || []) {
    const p = g.properties || {};
    if (!p.regionId) continue;
    _graph.set(p.regionId, Array.isArray(p.neighbors) ? p.neighbors : []);
    if (Array.isArray(p.position)) _pos.set(p.regionId, p.position);
  }
  const labels = state.mapDataGlobal.regionLabels?.geometries || topo.objects?.regionLabels?.geometries || [];
  for (const l of labels) {
    const p = l.properties || {};
    if (p.regionId && p.name) _labelNames.set(p.regionId, p.name);
    if (p.regionId && !_pos.has(p.regionId) && Array.isArray(l.coordinates)) _pos.set(p.regionId, l.coordinates);
  }
  return _graph;
}

export function regionName(id) {
  graph();
  return state.regionData?.[id]?.name || _labelNames.get(id) || '—';
}

/** WarEra+: le regioni confinanti. Le usa la lavagna delle operazioni
 *  (src/private/operazioni.js) per proporre da dove si può attaccare una
 *  regione: si attacca solo da un confine. */
export function regionNeighbors(id) {
  return graph().get(id) || [];
}

/** WarEra+: il punto della regione COME LA DISEGNA LA MAPPA (posizione della
 *  geometria, ripiego sull'etichetta). Non `state.regionData[id].position`:
 *  per alcune regioni quella è la città di un'altra — il 22/10/2026 Romagna
 *  & Tuscany aveva la stessa di Northwestern Italy (Milano), e una freccia
 *  fra le due finiva lunga zero. */
export function regionAnchor(id) {
  graph();
  return _pos.get(id) || null;
}
