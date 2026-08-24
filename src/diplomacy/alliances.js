import { state } from './state.js';
import { renderMap } from './map.js';
import { updateDynamicLegend } from './ui.js';
import { buildMultiBlocPatternExpression } from './patterns.js';
// Genera un colore in base al nome e allo scheme (come prima)
import { hashColor } from './utils.js';   // aggiungi in cima


// WarEra+: la tabella copriva 6 scheme su 12 in uso. Gli scoperti (blue,
// cyan, purple, yellow, sand...) cadevano sul fallback ad hash dell'ID, cioè
// una tinta casuale: ATLAS, che in gioco è BLU, usciva verde chiaro. Ogni
// scheme visto sulle alleanze reali ha ora il suo colore.
const SCHEME_COLORS = {
  violet: '#8b5cf6',
  purple: '#7c3aed',
  pink: '#ec4899',
  amber: '#ffbf00',
  yellow: '#eab308',
  sand: '#d2b48c',
  orange: '#f97316',
  red: '#d60606',
  green: '#0d652d',
  lime: '#84cc16',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  blue: '#1d4ed8',
  lightblue: '#007cb1',
  brown: '#92400e',
  grey: '#6b7280',
  gray: '#6b7280',
  white: '#e5e7eb',
  black: '#374151',
};

// Converte RGB in HSL
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

// WarEra+ — normalizza qualunque colore CSS (#rrggbb, nome, hsl(...)) a
// #rrggbb, con lo stesso trucco del canvas già usato da shiftColor.
function toHex(colorHexOrName) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = colorHexOrName;
  return ctx.fillStyle;
}

// WarEra+ — colore finale di un'alleanza. Tinta e saturazione restano quelle
// dello scheme (colori "digitali", pieni, come la vista Diplomazia: una
// versione pastello è stata provata e scartata — smorzava troppo). L'unica
// correzione è sulla luminosità, e solo per le alleanze che hanno dovuto
// ruotare tinta: vanno più scure, così il colore "preso in prestito" non
// compete con quello di chi ha l'originale.
function finalAllianceColor(color, extraDark = 0) {
  const hex = toHex(color);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Stessa FASCIA DI LUMINOSITÀ dei colori nazione della vista Diplomazia,
  // misurata sui dati veri: 180 nazioni stanno fra 0.15 e 0.32 (mediana
  // 0.20), mentre gli scheme d'alleanza grezzi arrivavano a 0.60 — per
  // questo lo stesso rosso sembrava molto più acceso in Alleanze che in
  // Diplomazia. La luminosità viene quindi compressa in [0.16, 0.32].
  // La SATURAZIONE resta alta (tetto 0.85): il colore deve restare pieno e
  // "digitale", il pastello è stato provato e scartato.
  const s2 = Math.min(s, 0.85);
  const l2 = Math.max(0.15, Math.min(0.32, 0.16 + l * 0.24 - extraDark));
  return `hsl(${Math.round(h)}, ${Math.round(s2 * 100)}%, ${Math.round(l2 * 100)}%)`;
}

// Tinta di un colore già in hsl(...) (quello che ritorna finalAllianceColor).
function hueOf(hslString) {
  const m = /^hsl\(\s*(-?\d+(?:\.\d+)?)/i.exec(String(hslString));
  return m ? ((parseFloat(m[1]) % 360) + 360) % 360 : 0;
}

// Distanza fra due tinte sul cerchio: 350° e 10° distano 20, non 340.
function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Shifta il hue di un colore (esadecimale o nome CSS)
function shiftColor(colorHexOrName, amount) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = colorHexOrName;
  const hex = ctx.fillStyle; // normalizza a #rrggbb
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let [h, s, l] = rgbToHsl(r, g, b);
  h = (h + amount) % 360;
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function getBaseAllianceColor(ally) {
  const scheme = ally.scheme?.toLowerCase();
  if (scheme && SCHEME_COLORS[scheme]) {
    return SCHEME_COLORS[scheme];
  }
  // fallback: hash dell'ID (non dovrebbe servire)
  let hash = 0;
  for (let i = 0; i < ally._id.length; i++) hash = ((hash << 5) - hash) + ally._id.charCodeAt(i);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

// ==================== MEDIANA GEOMETRICA PESATA (robusta agli outlier, ora anche per popolazione) ====================
// A differenza della media aritmetica, questo punto minimizza la somma
// PESATA delle distanze da tutti i membri: resta vicino al cluster più
// numeroso anche se ci sono nazioni isolate molto lontane (es. 10 in
// Europa + 2 in Sudamerica). WarEra+: ora accetta anche un peso per
// membro (popolazione attiva) — a parità di posizione geografica, il
// punto si sposta verso le nazioni più popolose del blocco, non solo
// verso dove ce ne sono di più in numero.
function geometricMedian(points, weights, iterations = 60) {
  if (!points.length) return null;
  if (points.length === 1) return points[0];
  if (!weights) weights = points.map(() => 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || points.length;

  let x = points.reduce((s, p, i) => s + p[0] * weights[i], 0) / totalWeight;
  let y = points.reduce((s, p, i) => s + p[1] * weights[i], 0) / totalWeight;

  for (let iter = 0; iter < iterations; iter++) {
    let numX = 0, numY = 0, denom = 0;
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      const w = weights[i];
      const d = Math.hypot(px - x, py - y) || 1e-6;
      numX += (w * px) / d;
      numY += (w * py) / d;
      denom += w / d;
    }
    if (denom === 0) break;
    const nx = numX / denom, ny = numY / denom;
    if (Math.abs(nx - x) < 1e-6 && Math.abs(ny - y) < 1e-6) { x = nx; y = ny; break; }
    x = nx; y = ny;
  }
  return [x, y];
}

// Questa è la funzione chiamata da refreshData
export function processAlliancesData(alliances) {
  // Se non ci sono alleanze, pulisci tutto
  if (!alliances.length) {
    state.allianceMap.clear();
    state.externalBlocsInfo = [];
    state.blocColorMap.clear();
    state.multiBlocMap.clear();
    updateDynamicLegend();
    if (state.coloringMode === 'blocs') renderMap();
    return;
  }

  // 0. Indice allianceId -> alliance (evita alliancesList.find dentro i loop
  //    di getAllianceAllies, che era O(n^2)).
  state.allianceMap.clear();
  for (const ally of alliances) state.allianceMap.set(ally._id, ally);

  // 1. Mappa allianceId -> colore
  //
  // WarEra+: due alleanze con lo stesso scheme non possono avere lo stesso
  // colore, quindi la seconda viene ruotata di tinta. Prima vinceva chi
  // arrivava prima nella risposta dell'API: Troublemakers (5 nazioni) si
  // prendeva il rosso e The Inglourious Basterds (24 nazioni, rossa in
  // gioco) finiva arancione. Ora il colore originale va alle alleanze più
  // GRANDI: si ordina per numero di nazioni prima di assegnare, e la
  // rotazione tocca alle piccole, che si notano meno. `alliances` non viene
  // mutato (è l'array condiviso): si ordina una copia.
  state.allianceColorMap.clear();
  const usedHues = [];
  const bySize = alliances
    .slice()
    .sort((a, b) => (b.memberCountries?.length || 0) - (a.memberCountries?.length || 0));
  for (const ally of bySize) {
    const baseColor = getBaseAllianceColor(ally);
    let shift = 0;
    let color = finalAllianceColor(baseColor);
    let hue = hueOf(color);
    // Due scheme diversi possono essere quasi la stessa tinta (amber #ffbf00
    // e yellow #eab308 stanno entrambi intorno ai 45°: B.E.E.R e Custodes
    // Aeterni risultavano indistinguibili sulla mappa). Si ruota finché la
    // tinta non dista almeno 14° da tutte quelle già assegnate.
    for (let attempt = 0; attempt < 12 && usedHues.some(h => hueDistance(h, hue) < 14); attempt++) {
      shift += 30;
      color = finalAllianceColor(shiftColor(baseColor, shift), 0.04);
      hue = hueOf(color);
    }
    usedHues.push(hue);
    state.allianceColorMap.set(ally._id, color);
  }

  // 2. Costruisci nationAlliancesMap (paese -> Set di allianceId)
  state.nationAlliancesMap.clear();
  for (const ally of alliances) {
    for (const member of ally.memberCountries) {
      const countryId = member.country;
      if (!countryId) continue;
      if (!state.nationAlliancesMap.has(countryId))
        state.nationAlliancesMap.set(countryId, new Set());
      state.nationAlliancesMap.get(countryId).add(ally._id);
    }
  }

  // 3. Crea externalBlocsInfo per la legenda
  // La posizione della label usa la mediana geometrica PESATA per
  // popolazione dei membri (non la media aritmetica né una mediana non
  // pesata), così resta vicina sia al cluster più numeroso sia — ora —
  // ai membri più popolosi, in presenza di membri isolati molto lontani
  // (es. Europa + outlier in Africa).
  state.externalBlocsInfo = alliances.map(ally => {
    const memberIds = ally.memberCountries.map(m => m.country);
    const points = [];
    const weights = [];
    memberIds.forEach(id => {
      const coord = state.labelsData.find(l => l.properties.countryId === id)?.coordinates;
      if (!coord) return;
      const pop = state.nationMap.get(id)?.rankings?.countryActivePopulation?.value || 0;
      points.push(coord);
      // Peso minimo 1 anche per popolazione 0/sconosciuta: altrimenti
      // quel membro verrebbe completamente ignorato nel calcolo (peso 0).
      weights.push(Math.max(pop, 1));
    });

    const median = points.length ? geometricMedian(points, weights) : null;

    return {
      id: ally._id,
      name: ally.name,
      color: state.allianceColorMap.get(ally._id),
      labelLng: median ? median[0] : null,
      labelLat: median ? median[1] : null,
      memberCount: memberIds.length, // usato per la priorità nel posizionamento label
    };
  });

  // 4. Costruisci blocColorMap (colore singolo) e multiBlocMap (pattern)
  state.blocColorMap.clear();
  state.multiBlocMap.clear();
  for (const [countryId, allianceSet] of state.nationAlliancesMap.entries()) {
    if (allianceSet.size === 1) {
      const singleAllianceId = [...allianceSet][0];
      const color = state.allianceColorMap.get(singleAllianceId);
      state.blocColorMap.set(countryId, color);
    } else if (allianceSet.size > 1) {
      const colors = [...allianceSet].map(aid => state.allianceColorMap.get(aid));
      state.multiBlocMap.set(countryId, { colors });
    }
  }

  // 5. Precarica pattern per nazioni in più alleanze
  buildMultiBlocPatternExpression();

  // 6. Aggiorna UI e mappa
  updateDynamicLegend();
  if (state.coloringMode === 'blocs') renderMap();
}