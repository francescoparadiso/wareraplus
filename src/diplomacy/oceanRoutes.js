// oceanRoutes.js
//
// WarEra+ — geometria condivisa delle rotte marittime commerciali, usata
// sia dal tema scuro (oceanBackground.js, colori ciano "GIS futuristico")
// sia dal tema chiaro (antiqueTheme.js, colori seppia "mappa antica").
// Stesse rotte, stessi chokepoint reali, stesso motore di animazione —
// cambia solo lo stile con cui ognuno dei due le disegna.

// Chokepoint marittimi reali: le rotte collegano SOLO questi punti,
// passando per tappe intermedie in mare aperto.
export const CHOKEPOINTS = {
  gibraltar: [-5.6, 35.9],
  suez: [32.9, 29.9],
  hormuz: [56.3, 26.6],
  malacca: [100.3, 2.8],
  panamaPacific: [-79.6, 8.8],
  panamaAtlantic: [-79.9, 9.4],
  capeOfGoodHope: [18.4, -34.4],
  bering: [-169.5, 65.6],
  capeHorn: [-67.3, -55.9],
};

// Rotte come sequenze di tappe (chokepoint + waypoint intermedi in mare
// aperto), così seguono un percorso plausibile invece di tagliare dritto
// sopra ai continenti. Quelle che attraversano il Pacifico (Malacca <->
// Bering/Panama) lo attraversano DAVVERO grazie a unwrapLngPath.
export const ROUTES = [
  [CHOKEPOINTS.gibraltar, [15, 36], [30, 33.5], CHOKEPOINTS.suez],
  [CHOKEPOINTS.suez, [40, 14], [65, 8], [82, 4], CHOKEPOINTS.malacca],
  [CHOKEPOINTS.hormuz, [65, 16], [82, 6], CHOKEPOINTS.malacca],
  [CHOKEPOINTS.capeOfGoodHope, [50, -26], [80, -10], CHOKEPOINTS.malacca],
  [CHOKEPOINTS.malacca, [140, 8], [170, 15], [-170, 20], [-140, 14], CHOKEPOINTS.panamaPacific],
  [CHOKEPOINTS.panamaAtlantic, [-60, 20], [-30, 30], CHOKEPOINTS.gibraltar],
  [CHOKEPOINTS.bering, [-176, 54], [175, 38], [140, 20], CHOKEPOINTS.malacca], // rotta pacifica nord: Bering -> Giappone -> Malacca, attraversa davvero il Pacifico
  [CHOKEPOINTS.panamaPacific, [-85, -15], [-75, -40], CHOKEPOINTS.capeHorn],
  [CHOKEPOINTS.capeOfGoodHope, [10, -20], CHOKEPOINTS.panamaAtlantic],
  [CHOKEPOINTS.capeOfGoodHope, [0, -44], [-35, -51], CHOKEPOINTS.capeHorn], // rotta oceano australe ("Roaring Forties"), storica rotta a vela
  [CHOKEPOINTS.hormuz, [55, 5], [45, -20], CHOKEPOINTS.capeOfGoodHope], // rotta petrolifera intorno all'Africa (alternativa a Suez)
];

// ==================== PRNG seedato (mulberry32) ====================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260813); // seed fisso: stesso "disegno" a ogni sessione

// ==================== HELPERS GEOMETRICI ====================

// "Srotola" le longitudini di un percorso: ogni tappa viene spostata di
// ±360° finché non è entro 180° dalla precedente (già srotolata). Senza
// questo, interpolare linearmente fra es. 140° e -170° (differenza grezza
// di -310°) fa fare alla curva tutto il giro "sbagliato" attraverso
// l'Atlantico/le Americhe invece dei 50° più brevi attraverso il
// Pacifico/l'antimeridiano. Le coordinate risultanti possono uscire da
// [-180,180] (es. 190 invece di -170): è voluto e corretto — con
// renderWorldCopies:true (map.js) maplibre le disegna comunque bene,
// proseguendo nella copia del mondo adiacente.
export function unwrapLngPath(stops) {
  const out = [[stops[0][0], stops[0][1]]];
  for (let i = 1; i < stops.length; i++) {
    const prevLng = out[i - 1][0];
    let lng = stops[i][0];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    out.push([lng, stops[i][1]]);
  }
  return out;
}

export function curve(p0, p1, bow, steps = 20) {
  const mx = (p0[0] + p1[0]) / 2;
  const my = (p0[1] + p1[1]) / 2;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const ctrl = [mx + nx * bow, my + ny * bow];
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const it = 1 - t;
    const lng = it * it * p0[0] + 2 * it * t * ctrl[0] + t * t * p1[0];
    const lat = it * it * p0[1] + 2 * it * t * ctrl[1] + t * t * p1[1];
    coords.push([lng, lat]);
  }
  return coords;
}

// Percorso fluido attraverso più tappe: srotola le longitudini (vedi
// sopra), poi concatena una curve() fra ogni coppia di tappe consecutive
// (bow deterministico, alternato) così il risultato è un'unica linea
// morbida "a serpentina" che segue le tappe nella direzione giusta.
export function multiStopPath(rawStops, bowFactor = 0.12) {
  const stops = unwrapLngPath(rawStops);
  let coords = [stops[0]];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const bow = len * bowFactor * (i % 2 === 0 ? 1 : -1);
    const seg = curve(a, b, bow, 16);
    coords = coords.concat(seg.slice(1));
  }
  return coords;
}

// Bearing (in gradi, 0 = nord) fra due punti consecutivi di un percorso,
// per orientare il pallino nave nella direzione di marcia.
export function bearingAt(coords, idx) {
  const a = coords[Math.max(0, idx - 1)];
  const b = coords[Math.min(coords.length - 1, idx + 1)];
  const dLng = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dLat = b[1] - a[1];
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

// ==================== GENERAZIONE DATI ====================
export function buildRoutesData() {
  const lineFeats = [];
  const nodeFeats = [];
  const sampledPaths = [];
  ROUTES.forEach(stops => {
    const coords = multiStopPath(stops);
    sampledPaths.push(coords);
    lineFeats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    const step = Math.max(1, Math.floor(coords.length / 6));
    for (let idx = step; idx < coords.length - 1; idx += step) {
      nodeFeats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[idx] } });
    }
  });
  return {
    lines: { type: 'FeatureCollection', features: lineFeats },
    nodes: { type: 'FeatureCollection', features: nodeFeats },
    sampledPaths,
  };
}

// ==================== ANIMAZIONE (pallini "nave" che avanzano) ====================
// N "corridori" indipendenti, uno per rotta, con velocità e partenza
// sfalsate, aggiornati a intervalli (non ad ogni frame: è un dettaglio
// ambientale, non serve fluidità da 60fps — più leggero per CPU/batteria).
export function makeRunner(map, sourceId, sampledPaths, { intervalMs, speedRange, withBearing = false, particlesPerPath = 1 }) {
  if (!sampledPaths.length) return () => {};
  const runners = [];
  sampledPaths.forEach((coords, pathIdx) => {
    for (let p = 0; p < particlesPerPath; p++) {
      runners.push({
        pathIdx,
        speed: speedRange[0] + rnd() * (speedRange[1] - speedRange[0]),
        progress: rnd(),
      });
    }
  });
  let timer = setInterval(() => {
    // WarEra+ perf: puramente decorativo — niente setData/repaint mentre
    // la tab è in background (minimizzata/altro tab attivo), dove nessuno
    // lo sta comunque guardando. Il timer resta vivo (i browser lo
    // throttlano già da soli in background) ma salta il lavoro.
    if (document.hidden) return;
    const src = map.getSource(sourceId);
    if (!src) { clearInterval(timer); return; }
    const feats = runners.map(r => {
      r.progress = (r.progress + r.speed * 0.01) % 1;
      const coords = sampledPaths[r.pathIdx];
      const idx = Math.min(coords.length - 1, Math.floor(r.progress * coords.length));
      const props = withBearing ? { bearing: bearingAt(coords, idx) } : {};
      return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: coords[idx] } };
    });
    src.setData({ type: 'FeatureCollection', features: feats });
  }, intervalMs);
  return () => clearInterval(timer);
}
