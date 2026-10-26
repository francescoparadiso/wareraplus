// oceanRoutes.js
//
// WarEra+ — geometria condivisa delle rotte marittime commerciali, usata
// sia dal tema scuro (oceanBackground.js, colori ciano "GIS futuristico")
// sia dal tema chiaro (antiqueTheme.js, colori seppia "mappa antica").
// Stesse rotte, stessi chokepoint reali — cambia solo lo stile con cui
// ognuno dei due le disegna. Le navi che le percorrono stanno in
// shipOverlay.js, che da qui prende i percorsi già misurati (buildShipPaths).

// Chokepoint marittimi reali: le rotte collegano SOLO questi punti,
// passando per tappe intermedie in mare aperto.
//
// WarEra+ (2026-10-20): le coordinate sono quelle di un punto IN MARE sulla
// mappa di WarEra, non quelle "da atlante" del capo o della città. Il Capo
// di Buona Speranza, Capo Nord e Suez erano punte di terra (Suez stava sul
// Sinai, a mezzo grado dal golfo), e da lì ogni rotta partiva già sopra un
// territorio. Il controllo è `npm run check:routes` (tools/checkOceanRoutes.mjs).
export const CHOKEPOINTS = {
  gibraltar: [-5.6, 35.9],
  suez: [32.55, 29.8],          // in cima al Golfo di Suez
  hormuz: [56.3, 26.6],
  malacca: [100.8, 2.7],        // a metà dello stretto, fra Sumatra e la penisola
  panamaPacific: [-79.3, 8.3],  // Golfo di Panama
  panamaAtlantic: [-79.9, 9.8],
  capeOfGoodHope: [18.8, -35.2],
  bering: [-169.5, 65.6],
  capeHorn: [-67.3, -56.4],
  northSea: [3.0, 56.5],   // Mare del Nord, al largo dello Jutland
  northCape: [26.0, 71.8], // al largo di Capo Nord (Norvegia), soglia del Mare di Barents
};

// Sulla mappa di WarEra il Canale di Suez non c'è: Mediterraneo e Mar Rosso
// sono separati da una striscia di terra continua. La rotta arriva a Porto
// Said e da lì scende dritta a Suez lungo il canale — l'unico tratto di
// terra attraversato apposta, che il controllo delle rotte tollera.
const PORT_SAID = [32.3, 31.6];
export const CANALS = [[PORT_SAID, CHOKEPOINTS.suez]];

// Avvicinamenti condivisi: lo Stretto di Malacca è largo un paio di gradi
// e chi ci arriva da ovest gira per forza attorno alla punta di Sumatra
// (Aceh); chi esce verso est passa da Singapore.
const MALACCA_FROM_WEST = [[95.2, 6.4], [98.9, 4.9], [100.2, 3.5]];
const MALACCA_TO_EAST = [[102.3, 1.9], [102.9, 1.5], [103.4, 1.2], [103.8, 1.05], [104.6, 1.3]];

// Rotte come sequenze di tappe (chokepoint + waypoint intermedi in mare
// aperto), così seguono un percorso plausibile invece di tagliare dritto
// sopra ai continenti. Quelle che attraversano il Pacifico (Malacca <->
// Bering/Panama) lo attraversano DAVVERO grazie a unwrapLngPath.
//
// WarEra+ (2026-10-20): prima 8 rotte su 13 passavano per oltre il 10%
// sopra la terraferma (Portogallo, Bretagna, Oman, Madagascar, Patagonia,
// il Corno d'Africa, Sumatra, la Siberia…): le linee stanno sotto ai paesi,
// quindi si vedevano in trasparenza e le navi ci sparivano dentro. Ora le
// tappe costeggiano dal mare, misurate sui poligoni veri di map.getMapData.
// Se ne aggiungi o ne sposti una, rilancia `npm run check:routes`: la
// curvatura di multiStopPath dipende dalla posizione della tappa nella
// rotta (segno alterno), quindi spostarne una cambia anche le curve dopo.
export const ROUTES = [
  [CHOKEPOINTS.gibraltar, [-1.5, 36.4], [4.5, 37.7], [8.6, 37.9], [11.8, 37.35], [15, 36], [30, 33.5], PORT_SAID, CHOKEPOINTS.suez],
  [CHOKEPOINTS.suez, [32.65, 29.35], [32.95, 28.85], [33.45, 28.15], [34.0, 27.4], [37, 23.5], [40, 18], [42.2, 14.5], [42.9, 13.3], [43.3, 12.7], [44.0, 12.35], [46.5, 12.4], [50.5, 12.5], [52.5, 12.3], [65, 8], [81.5, 5], ...MALACCA_FROM_WEST, CHOKEPOINTS.malacca],
  [CHOKEPOINTS.hormuz, [65, 16], [81.5, 5], ...MALACCA_FROM_WEST, CHOKEPOINTS.malacca],
  [CHOKEPOINTS.capeOfGoodHope, [26, -35.6], [33, -32.2], [50, -27.5], [80, -10], [92, 1], ...MALACCA_FROM_WEST, CHOKEPOINTS.malacca],
  // Verso Panama passando a sud delle Filippine: Mar Cinese Meridionale,
  // Stretto di Balabac, Mare di Sulu e Mare di Celebes.
  [CHOKEPOINTS.malacca, ...MALACCA_TO_EAST, [108.5, 5.6], [114, 7.3], [117.9, 7.8], [120, 7.2], [121.6, 6.3], [125.8, 4.6], [140, 8], [170, 15], [-170, 20], [-140, 14], [-95, 9], [-84, 6.5], [-80, 6.9], CHOKEPOINTS.panamaPacific],
  [CHOKEPOINTS.panamaAtlantic, [-74.5, 13.2], [-66, 16], [-58, 20.5], [-30, 30], CHOKEPOINTS.gibraltar],
  // Rotta pacifica nord: Bering -> Giappone -> Stretto di Luzon -> Malacca,
  // attraversa davvero il Pacifico.
  [CHOKEPOINTS.bering, [-176, 54], [175, 38], [140, 22], [121.4, 20.4], [114, 15], [108.8, 8.5], [105.4, 3.0], ...[...MALACCA_TO_EAST].reverse(), CHOKEPOINTS.malacca],
  [CHOKEPOINTS.panamaPacific, [-80, 6.5], [-83, -2], [-85, -15], [-78.5, -40], [-77.8, -50], [-72, -57.2], CHOKEPOINTS.capeHorn],
  [CHOKEPOINTS.capeOfGoodHope, [8, -20], [-30, -2], [-50, 8.5], [-60.5, 12.3], [-70, 13.5], [-76, 11.6], CHOKEPOINTS.panamaAtlantic],
  [CHOKEPOINTS.capeOfGoodHope, [0, -44], [-35, -51], CHOKEPOINTS.capeHorn], // rotta oceano australe ("Roaring Forties"), storica rotta a vela
  // Rotta petrolifera intorno all'Africa (alternativa a Suez): esce dal
  // Golfo di Oman doppiando Ras al-Hadd e scende per il Canale di Mozambico.
  [CHOKEPOINTS.hormuz, [57.4, 25.2], [59.4, 24.0], [61.3, 22.3], [57, 12], [52, 0], [42.3, -11.8], [42, -17], [39.5, -22.5], [35.5, -27.5], [32, -31.5], [27, -34.6], [22.5, -35.4], CHOKEPOINTS.capeOfGoodHope],
  // Rotta artica (Passaggio a Nord-Est / "Northern Sea Route"): risale
  // l'Atlantico fino al Mare del Nord, doppia Capo Nord e costeggia la
  // Siberia sopra il circolo polare fino allo Stretto di Bering. Le tappe
  // sono fitte apposta: `multiStopPath` incurva ogni segmento (bow
  // proporzionale alla sua lunghezza), e con tappe rade la curva
  // scavallerebbe oltre l'80° parallelo o rientrerebbe sulla costa.
  // Passa a NORD della Novaja Zemlja, per lo Stretto di Vil'kickij (fra
  // il Tajmyr e la Severnaja Zemlja) e a SUD delle Isole della Nuova
  // Siberia e dell'Isola di Wrangel. L'ultimo salto oltre i 180° è
  // gestito da unwrapLngPath come le altre rotte pacifiche.
  [CHOKEPOINTS.gibraltar, [-7.5, 36.2], [-10.3, 37.2], [-10.6, 40], [-10.4, 43.5], [-6.5, 48.3], [-3, 49.8], [0.6, 50.35], [1.4, 51.0], [2.4, 51.6], CHOKEPOINTS.northSea],
  [CHOKEPOINTS.northSea, [3, 62], [8.5, 66.5], [15, 70.5], [20, 71.4], CHOKEPOINTS.northCape, [40, 73.3], [50, 75.2], [62, 77.4], [76, 77.3], [90, 77.85], [96, 77.6], [100, 77.55], [101.5, 77.7], [102.5, 77.8], [103.5, 77.9], [104.5, 78.0], [105.5, 77.95], [106.5, 77.7], [108.5, 77.6], [113, 77.1], [122, 75.8], [132, 76.7], [138, 76.9], [144, 76.8], [150, 76.2], [155, 75.2], [160, 73.2], [166, 71.5], [172, 70.9], [176, 70.4], [179.5, 70.0], [-178, 69.7], [-174.5, 69.0], [-170, 68.0], [-168.8, 67.0], CHOKEPOINTS.bering],
];

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

// La linea disegnata di una rotta: unico punto da cui passano mappa,
// navi e tools/checkOceanRoutes.mjs, così il controllo prova esattamente
// la curva che si vede.
export function routePath(stops) {
  return multiStopPath(stops);
}

// ==================== GENERAZIONE DATI ====================
export function buildRoutesData() {
  const lineFeats = [];
  const nodeFeats = [];
  ROUTES.forEach(stops => {
    const coords = routePath(stops);
    lineFeats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    const step = Math.max(1, Math.floor(coords.length / 6));
    for (let idx = step; idx < coords.length - 1; idx += step) {
      nodeFeats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[idx] } });
    }
  });
  return {
    lines: { type: 'FeatureCollection', features: lineFeats },
    nodes: { type: 'FeatureCollection', features: nodeFeats },
  };
}

// ==================== PERCORSI MISURATI (per le navi, shipOverlay.js) ====================
// WarEra+: la vecchia animazione metteva la nave sul vertice
// floor(progresso × n) — a vertici distribuiti 16 per tratto qualunque
// fosse la sua lunghezza, quindi la nave stava ferma e poi saltava, e
// correva sui tratti lunghi e strisciava su quelli corti. Qui ogni vertice
// porta la distanza percorsa fino a lì, misurata in Mercator (x = lng,
// y = latitudine stirata come la stira la mappa): la nave avanza di una
// distanza costante SULLO SCHERMO, anche sopra il circolo polare dove un
// grado di longitudine è molto più corto in chilometri.
const mercY = lat => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;

export function buildShipPaths() {
  return ROUTES.map(stops => {
    const coords = routePath(stops);
    const n = coords.length;
    const lng = new Float64Array(n), lat = new Float64Array(n), cum = new Float64Array(n);
    let prevY = 0;
    for (let i = 0; i < n; i++) {
      lng[i] = coords[i][0];
      lat[i] = coords[i][1];
      const y = mercY(lat[i]);
      if (i) cum[i] = cum[i - 1] + Math.hypot(lng[i] - lng[i - 1], y - prevY);
      prevY = y;
    }
    return { lng, lat, cum, total: cum[n - 1] };
  });
}

// ==================== ETICHETTE DELLE ROTTE (per il tooltip nave) ====================
// Da/A di ogni rotta, ricavati per identità di riferimento: ROUTES cita
// direttamente gli array dentro CHOKEPOINTS, quindi il confronto `===`
// ritrova la chiave senza dover riconfrontare coordinate. Calcolato una
// volta sola all'import — se un giorno ROUTES cambia, questo la segue da
// solo. Le tappe intermedie sono waypoint anonimi in mare aperto: non
// hanno un nome da mostrare, quindi restano null (il tooltip in quel caso
// non si apre, vedi shipTooltip.js).
const _CHOKE_BY_REF = new Map(Object.entries(CHOKEPOINTS).map(([k, v]) => [v, k]));

export const ROUTE_ENDPOINTS = ROUTES.map(stops => ({
  from: _CHOKE_BY_REF.get(stops[0]) || null,
  to: _CHOKE_BY_REF.get(stops[stops.length - 1]) || null,
}));

// Merci trasportate: puramente decorative, assegnate una volta per nave
// alla creazione (shipOverlay.js, seed fisso, quindi la stessa nave porta
// sempre lo stesso carico per tutta la sessione). Il tooltip traduce
// l'indice, qui non c'è testo — vedi shipTooltip.js.
export const CARGO_COUNT = 8;
