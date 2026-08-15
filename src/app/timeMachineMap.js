/* ══════════════════════════════════════════════════════════════
   WarEra+ — Time machine: mappa dedicata, alleggerita
   ------------------------------------------------------------------
   Sostituisce l'approccio precedente (ridisegnare DENTRO alla mappa
   Diplomacy principale, sostituendo temporaneamente le sue sorgenti) —
   richiesto esplicitamente dall'utente dopo che il rendering restava
   troppo lento anche dopo diversi giri di ottimizzazione: la mappa
   principale ha una decina di layer attivi contemporaneamente (alleanze,
   blocchi, sfera d'influenza, marker/heatmap battaglie, rotte navali,
   badge doppi, danni settimanali, popolazione, pattern SVG diplomazia...)
   — anche ignorandoli, WebGL li processa tutti ad ogni frame, più
   `renderWorldCopies:true` che a zoom basso disegna 2-3 copie del mondo.

   Qui c'è una SECONDA istanza MapLibre indipendente, con un proprio
   canvas/contesto WebGL, che sa fare UNA cosa sola: colorare le regioni
   per ownership storica + disegnare i confini + i nomi nazione. Tre
   layer in tutto, contro la dozzina della mappa principale.

   Dati: tutti riusati da quelli già in memoria (state.baseGeoJSON,
   state.mapDataGlobal.map per topojson.mesh, state.nationBaseColorMap,
   state.nationMap) — ZERO fetch nuove, la ricostruzione keyframe+eventi
   resta interamente lato server (vedi cacheClient.js).

   Semplificazioni deliberate rispetto alla mappa principale (coerenti con
   "alleggerita il più possibile"):
   - `renderWorldCopies:false` + `maxBounds` — mappa fissa, non a
     scorrimento infinito (richiesto esplicitamente).
   - Confini: SOLO la linea internazionale (ownership diversa fra regioni
     confinanti). Niente mesh "coast" (già nascosta di default sulla
     mappa principale, vedi map.js LYR_COAST) né le sottili divisioni
     INTERNE fra regioni dello stesso paese (LYR_OUTLINE lì) — dettaglio
     cosmetico, non essenziale per capire "chi possiede cosa".
   - Etichette: canvas 2D dedicato (stesso principio di labels.js, ma
     drasticamente più semplice) — solo nome nazione, font fisso, nessuna
     bandiera/testo popolazione/decluttering per collisione fra label
     (quella è la parte più costosa dell'originale). Regioni fuori dal
     viewport corrente vengono saltate (culling), non solo nascoste via
     canvas clip.

   La mappa principale (state.map) viene NASCOSTA (display:none), non
   distrutta — resta pronta a riapparire istantaneamente alla chiusura,
   niente ricostruzione dello stile da capo. Le sue fetch periodiche
   (paginate/timer) restano tecnicamente vive ma innocue: navi e marker
   battaglia sono già messi in pausa da timeMachine.js prima di attivare
   questa mappa, e il resto dei dati diplomacy/main.js si carica una sola
   volta al boot (nessun poll periodico che tocchi i suoi layer mentre è
   nascosta).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { THEMES } from '../diplomacy/config.js';
import maplibregl from 'maplibre-gl';
import * as topojson from 'topojson-client';

const CONTAINER_ID = 'wp-tm-map';
const SRC_FILL = 'wp-tm-regions-src';
const SRC_BORDERS = 'wp-tm-borders-src';
export const TM_LYR_FILL = 'wp-tm-regions-fill';
const TM_LYR_BORDER = 'wp-tm-borders-line';

let _map = null;
let _labelCanvas = null;
let _labelCtx = null;
let _labelEntries = []; // ultimo set applicato da renderTimeMachineFrame — riusato da _drawLabels ad ogni 'render'

export function getTimeMachineMap() {
  return _map;
}

// ==================== COSTRUZIONE DATI (stessa logica della versione
// precedente in timeMachine.js, spostata qui insieme al "dove disegno") ====================
function _buildFillGeoJSON(regionsMap) {
  return {
    type: 'FeatureCollection',
    features: state.baseGeoJSON.features.map(f => {
      const regionId = f.properties?.regionId;
      const historicalCountryId = regionId && Object.prototype.hasOwnProperty.call(regionsMap, regionId)
        ? regionsMap[regionId]
        : f.properties?.countryId; // regione non presente nello storico (raro): fallback al dato live
      return { ...f, properties: { ...f.properties, countryId: historicalCountryId } };
    }),
  };
}

// Un SOLO mesh (confine internazionale, ownership diversa) invece dei tre
// della mappa principale — vedi nota in testa al file.
function _buildBordersGeoJSON(regionsMap) {
  const topoData = state.mapDataGlobal?.map;
  if (!topoData) return { type: 'FeatureCollection', features: [] };
  const ownerOf = (props) => {
    const historical = regionsMap && props.regionId && Object.prototype.hasOwnProperty.call(regionsMap, props.regionId)
      ? regionsMap[props.regionId]
      : undefined;
    return historical !== undefined ? historical : props.countryId;
  };
  const mesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && ownerOf(a.properties) !== ownerOf(b.properties));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: mesh }] };
}

function _fillColorExpr() {
  const theme = THEMES[state.theme];
  const expr = ['match', ['get', 'countryId']];
  for (const [id, color] of state.nationBaseColorMap.entries()) expr.push(id, color);
  expr.push(theme.DEFAULT_LAND);
  return expr;
}

// ==================== ETICHETTE (canvas 2D dedicato) ====================
function _initLabelCanvas(container) {
  _labelCanvas = document.createElement('canvas');
  _labelCanvas.style.cssText = 'position:absolute; top:0; left:0; pointer-events:none;';
  container.appendChild(_labelCanvas);
  _labelCtx = _labelCanvas.getContext('2d');
  _resizeLabelCanvas();
  _map.on('render', _drawLabels);
  window.addEventListener('resize', _resizeLabelCanvas);
}

function _resizeLabelCanvas() {
  if (!_labelCanvas || !_map) return;
  const c = _map.getContainer();
  const r = window.devicePixelRatio || 1;
  _labelCanvas.width = c.clientWidth * r;
  _labelCanvas.height = c.clientHeight * r;
  _labelCanvas.style.width = c.clientWidth + 'px';
  _labelCanvas.style.height = c.clientHeight + 'px';
  _labelCtx.setTransform(r, 0, 0, r, 0, 0);
}

function _drawLabels() {
  if (!_labelCtx || !_map) return;
  const r = window.devicePixelRatio || 1;
  const W = _labelCanvas.width / r;
  const H = _labelCanvas.height / r;
  _labelCtx.clearRect(0, 0, W, H);
  if (!_labelEntries.length) return;

  const isLight = state.theme === 'light';
  _labelCtx.font = 'bold 11px "JetBrains Mono", monospace';
  _labelCtx.textAlign = 'center';
  _labelCtx.textBaseline = 'middle';
  _labelCtx.lineWidth = 3;
  _labelCtx.strokeStyle = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)';

  for (const entry of _labelEntries) {
    if (!entry.countryName) continue;
    const pt = _map.project(entry.coordinates);
    if (pt.x < -60 || pt.x > W + 60 || pt.y < -30 || pt.y > H + 30) continue; // fuori viewport: salta (culling)
    const text = entry.countryName.toUpperCase();
    _labelCtx.strokeText(text, pt.x, pt.y);
    _labelCtx.fillStyle = entry.textColor || (isLight ? '#1a1a1a' : '#e6edf3');
    _labelCtx.fillText(text, pt.x, pt.y);
  }
}

// ==================== CICLO DI VITA ====================
// BUG FIX (segnalato dall'utente: "Container 'wp-tm-map' not found" al
// primo avvio): il div esiste in index.html, ma non è robusto dipendere
// SOLO da quello (cache del browser/dev-server su una versione precedente
// dell'HTML, o un futuro refactor che lo sposta/rimuove per errore) — lo
// stesso principio già usato per il pannello slider (creato via JS, non
// dichiarato in index.html). Se manca lo crea al volo, appendendolo a
// document.body; se c'è già lo riusa. Passiamo l'ELEMENTO a maplibre (non
// la stringa id) cosi non rifà lui stesso una document.getElementById
// che potrebbe fallire per lo stesso motivo.
function _ensureContainer() {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = CONTAINER_ID;
    document.body.appendChild(el);
  }
  return el;
}

function _createMap() {
  return new Promise((resolve) => {
    const theme = THEMES[state.theme];
    _map = new maplibregl.Map({
      container: _ensureContainer(),
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'wp-tm-background', type: 'background', paint: { 'background-color': theme.OCEAN } }],
      },
      center: [0, 20],
      zoom: 2,
      minZoom: 1.7,
      maxZoom: 8,
      renderWorldCopies: false, // mappa fissa, non a scorrimento infinito (richiesto esplicitamente)
      // BUG FIX (segnalato dall'utente: mappa nera/"spezzata a metà"): qui
      // c'era [[-185,…],[185,…]] con l'idea di lasciare un margine oltre
      // l'antimeridiano. MapLibre però NORMALIZZA le longitudini di
      // maxBounds: |lng| >= 180 diventa un intervallo degenere/invertito,
      // e `_constrain()` reagisce sparando la camera a lng 180 con uno
      // zoom forzato altissimo (verificato dal vivo: center [180,20],
      // zoom 6.3 invece di [0,20] zoom 2) — in mezzo al Pacifico, dove
      // con renderWorldCopies:false metà viewport cade fuori dal mondo e
      // mostra il nero del container. Restare STRETTAMENTE dentro ±180
      // (179.9) è l'unica forma che MapLibre accetta senza wrappare.
      maxBounds: [[-179.9, -85], [179.9, 85]],
      attributionControl: false,
      keyboard: false, // le frecce sono riservate al playback (vedi timeMachine.js:_onKeydown)
    });

    _map.on('load', () => {
      _map.addSource(SRC_FILL, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      _map.addSource(SRC_BORDERS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      _map.addLayer({ id: TM_LYR_FILL, type: 'fill', source: SRC_FILL, paint: { 'fill-color': theme.DEFAULT_LAND, 'fill-opacity': 0.9 } });
      _map.addLayer({ id: TM_LYR_BORDER, type: 'line', source: SRC_BORDERS, paint: { 'line-color': theme.BORDER_COLOR, 'line-width': 2.2 } });
      resolve();
    });

    _initLabelCanvas(_map.getContainer());
  });
}

// Rende visibile il container, crea la mappa al primo utilizzo (idempotente
// — le attivazioni successive nella stessa sessione riusano la stessa
// istanza) e nasconde la mappa principale. L'ordine conta: il container
// deve avere dimensioni reali (classe .open aggiunta) PRIMA di creare
// MapLibre, altrimenti il canvas si dimensiona a 0x0.
export async function activateTimeMachineMap() {
  _ensureContainer().classList.add('open');
  // BUG FIX (segnalato dall'utente: mappa "spezzata a metà", metà oceano
  // metà nero): il container passa da display:none a display:block sulla
  // riga sopra — se MapLibre legge le dimensioni per il canvas PRIMA che
  // il browser abbia completato il relayout (stesso turno sincrono di
  // JS), il canvas si dimensiona in modo scorretto (il nero è lo sfondo
  // del contenitore dietro a un canvas troppo piccolo). Un frame di
  // respiro qui garantisce che il layout sia assestato prima di
  // creare/ridimensionare la mappa.
  await new Promise(requestAnimationFrame);

  if (!_map) {
    await _createMap();
  }
  // Resize esplicito SEMPRE (non solo "se già esisteva") — rete di
  // sicurezza in più oltre al frame di respiro sopra, indipendentemente
  // da quale dei due rami sopra è stato preso.
  _map.resize();
  _resizeLabelCanvas();

  if (state.map) state.map.getContainer().style.display = 'none';
}

export function deactivateTimeMachineMap() {
  const container = document.getElementById(CONTAINER_ID);
  if (container) container.classList.remove('open');

  if (state.map) {
    state.map.getContainer().style.display = '';
    // Classico "la mappa resta grigia a metà" di maplibre/mapbox dopo un
    // display:none -> '' se non si richiama resize() esplicitamente.
    state.map.resize();
  }
}

// Applica un istante storico: SOLO qui, non nel chiamante — timeMachine.js
// passa i dati già pronti (regionsMap dal server, labelEntries calcolati da
// _buildLabelEntries), questo modulo si occupa solo del "dove disegno".
export function renderTimeMachineFrame(regionsMap, labelEntries) {
  if (!_map) return;
  const fillSrc = _map.getSource(SRC_FILL);
  const borderSrc = _map.getSource(SRC_BORDERS);
  if (!fillSrc || !borderSrc) return; // stile non ancora caricato (non dovrebbe succedere: activate() aspetta _createMap)

  fillSrc.setData(_buildFillGeoJSON(regionsMap));
  borderSrc.setData(_buildBordersGeoJSON(regionsMap));
  _map.setPaintProperty(TM_LYR_FILL, 'fill-color', _fillColorExpr());
  const theme = THEMES[state.theme];
  _map.setPaintProperty(TM_LYR_BORDER, 'line-color', theme.BORDER_COLOR);

  _labelEntries = labelEntries || [];
  _drawLabels();
}

// Cattura il frame corrente (mappa + etichette, composte) come <canvas>
// offscreen — usata da timeMachine.js per lo screenshot condivisibile
// (📤). Il canvas WebGL di questa mappa non è creato con
// preserveDrawingBuffer:true (costo di memoria permanente per un caso
// d'uso occasionale) — workaround standard: leggerlo DENTRO al callback
// dell'evento 'render' (map.once), prima che il browser scarichi il
// buffer, forzando un frame con triggerRepaint(). Ritorna null se la
// mappa non è pronta o la cattura fallisce (il chiamante mostra un toast).
export function captureFrame() {
  return new Promise((resolve) => {
    if (!_map) { resolve(null); return; }
    _map.once('render', () => {
      try {
        const mapCanvas = _map.getCanvas();
        const out = document.createElement('canvas');
        out.width = mapCanvas.width;
        out.height = mapCanvas.height;
        const ctx = out.getContext('2d');
        ctx.drawImage(mapCanvas, 0, 0);
        // Etichette nazione: canvas 2D separato, sovrapposto via CSS —
        // composto sopra alla mappa per uno screenshot leggibile.
        if (_labelCanvas) ctx.drawImage(_labelCanvas, 0, 0, out.width, out.height);
        resolve(out);
      } catch (err) {
        console.warn('WarEra+ time machine map: cattura frame fallita:', err.message);
        resolve(null);
      }
    });
    _map.triggerRepaint();
  });
}
