/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — un'operazione sulla mappa
   ------------------------------------------------------------------
   Il tasto "Vedi sulla mappa" della lavagna (operazioni.js). Chiude
   l'area riservata e disegna l'operazione sulla mappa PRINCIPALE, non
   su una seconda istanza come la time machine: quello che si vuole
   vedere è il piano sopra la situazione di adesso — chi possiede cosa,
   le battaglie aperte, i confini — e una mappa a parte la toglierebbe.

   Cosa compare:
     · le regioni toccate dal piano, ripassate di bianco;
     · per ogni ATTACCO una freccia ad arco dalla regione di partenza a
       quella attaccata (stessa geometria delle frecce di migrazioni e
       battaglie, flowGeometry.js), piena se il passo è in corso o
       fatto, tratteggiata finché è da fare;
     · su ogni regione un cerchio nel colore dello stato e un cartellino
       col numero del passo, l'orario e il nome — lo stesso numero della
       scheda sulla lavagna;
     · in basso una barra con l'elenco dei passi (clic = la mappa ci va),
       "Torna alla lavagna" e la chiusura.

   Niente animazione, di proposito: le frecce delle battaglie scorrono
   perché il danno scorre davvero; un piano è fermo finché qualcuno non
   lo sposta, e una freccia che si muove direbbe il contrario.

   Si toglie tutto con la chiusura o tornando alla lavagna: un piano
   lasciato acceso sulla mappa sotto altre viste sarebbe un dato vecchio
   che sembra di adesso.
   ══════════════════════════════════════════════════════════════ */

import maplibregl from 'maplibre-gl';
import { state } from '../diplomacy/state.js';
import { arc, alongArc } from '../diplomacy/flowGeometry.js';
import { regionName, regionAnchor } from '../diplomacy/travelDistance.js';
import { showToast } from '../diplomacy/utils.js';
import { closePrivateView, openPrivateView } from '../app/privateOverlay.js';
import { opT } from './i18nOperazioni.js';
import { COLORI_STATO, oraBreve } from './operazioniComuni.js';

const SRC = 'wp-op-src';
const SRC_REGIONI = 'regions-src';
const LYR_REGIONI = 'wp-op-regioni';
const LYR_OMBRA = 'wp-op-ombra';
const LYR_ARCO = 'wp-op-arco';
const LYR_ARCO_TRATTO = 'wp-op-arco-tratto';
const LYR_ORIGINE = 'wp-op-origine';
const LYR_PUNTA = 'wp-op-punta';
const LYR_BERSAGLIO = 'wp-op-bersaglio';
const LAYERS = [LYR_REGIONI, LYR_OMBRA, LYR_ARCO, LYR_ARCO_TRATTO, LYR_ORIGINE, LYR_PUNTA, LYR_BERSAGLIO];
const IMG_PUNTA = 'wp-op-punta-img';

// Ancora "da fare" o "in attesa": la freccia è tratteggiata.
const DA_VENIRE = new Set(['da_fare', 'attesa']);

let _marker = [];
let _barra = null;

/** Dove sta una regione sulla mappa: il punto della geometria (vedi
 *  regionAnchor), poi quello del gioco come ripiego. */
function posizione(id) {
  if (!id) return null;
  const p = regionAnchor(id) || state.regionData?.[id]?.position || state.regionCache?.get(id)?.position;
  return Array.isArray(p) ? p : null;
}

// Mercatore, come flowGeometry.js: l'angolo della punta va misurato come
// la mappa disegna, non in gradi di latitudine.
const merY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI);

/** La punta della freccia: un triangolo bianco disegnato una volta, che la
 *  mappa colora (sdf) e ruota per ogni freccia. */
function assicuraPunta(map) {
  if (map.hasImage(IMG_PUNTA)) return;
  const lato = 40;
  const c = document.createElement('canvas');
  c.width = lato; c.height = lato;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(lato / 2, 3);
  g.lineTo(lato - 6, lato - 5);
  g.lineTo(lato / 2, lato - 13);
  g.lineTo(6, lato - 5);
  g.closePath();
  g.fill();
  const img = g.getImageData(0, 0, lato, lato);
  map.addImage(IMG_PUNTA, { width: lato, height: lato, data: new Uint8Array(img.data.buffer) }, { sdf: true, pixelRatio: 2 });
}

function feature(geom, props) {
  return { type: 'Feature', properties: props, geometry: geom };
}

function costruisci(op, { stati }) {
  const feats = [];
  const regioni = new Set();
  for (const p of op.passi) {
    const dove = posizione(p.regione);
    if (!dove) continue;
    regioni.add(p.regione);
    const stato = stati.get(p.id) || p.stato;
    const colore = COLORI_STATO[stato] || COLORI_STATO.da_fare;
    feats.push(feature({ type: 'Point', coordinates: dove }, { ruolo: 'bersaglio', colore }));
    // Attacco: da noi verso di loro. Difesa: da loro verso di noi. In
    // tutti e due i casi la freccia va da daRegione a regione.
    const da = p.tipo === 'attacco' || p.tipo === 'difesa' ? posizione(p.daRegione) : null;
    if (!da) continue;
    regioni.add(p.daRegione);
    const { coords } = arc(da, dove);
    const tratto = DA_VENIRE.has(stato);
    feats.push(feature({ type: 'LineString', coordinates: coords }, { ruolo: 'arco', colore, tratto }));
    feats.push(feature({ type: 'Point', coordinates: da }, { ruolo: 'origine', colore }));
    // La punta poco prima della regione, così non copre il cerchio.
    const a = alongArc(coords, 0.84), b = alongArc(coords, 0.9);
    const rot = (Math.atan2(b[0] - a[0], merY(b[1]) - merY(a[1])) * 180) / Math.PI;
    feats.push(feature({ type: 'Point', coordinates: b }, { ruolo: 'punta', colore, rot }));
  }
  return { feats, regioni: [...regioni] };
}

function aggiungiLayer(map, regioni) {
  assicuraPunta(map);
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const ruolo = (r) => ['==', ['get', 'ruolo'], r];
  if (map.getSource(SRC_REGIONI)) {
    map.addLayer({
      id: LYR_REGIONI, type: 'line', source: SRC_REGIONI,
      filter: ['in', ['get', 'regionId'], ['literal', regioni]],
      paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-opacity': 0.85 },
    });
  }
  map.addLayer({
    id: LYR_OMBRA, type: 'line', source: SRC, filter: ruolo('arco'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#000000', 'line-width': 7, 'line-opacity': 0.3, 'line-blur': 2 },
  });
  map.addLayer({
    id: LYR_ARCO, type: 'line', source: SRC, filter: ['all', ruolo('arco'), ['!', ['get', 'tratto']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'colore'], 'line-width': 3.4 },
  });
  map.addLayer({
    id: LYR_ARCO_TRATTO, type: 'line', source: SRC, filter: ['all', ruolo('arco'), ['get', 'tratto']],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ['get', 'colore'], 'line-width': 3.4, 'line-dasharray': [2, 1.5] },
  });
  map.addLayer({
    id: LYR_ORIGINE, type: 'circle', source: SRC, filter: ruolo('origine'),
    paint: { 'circle-radius': 4, 'circle-color': ['get', 'colore'], 'circle-stroke-color': '#0b1c33', 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: LYR_PUNTA, type: 'symbol', source: SRC, filter: ruolo('punta'),
    layout: {
      'icon-image': IMG_PUNTA,
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-color': ['get', 'colore'], 'icon-halo-color': '#0b1c33', 'icon-halo-width': 1.2 },
  });
  map.addLayer({
    id: LYR_BERSAGLIO, type: 'circle', source: SRC, filter: ruolo('bersaglio'),
    paint: {
      'circle-radius': 8,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': ['get', 'colore'],
      'circle-stroke-width': 3,
    },
  });
}

function togliLayer(map) {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** I cartellini sulle regioni. Più passi sulla stessa regione si
 *  impilano invece di coprirsi. */
function aggiungiCartellini(map, op, { numero, stati }) {
  const perRegione = new Map();
  const ordinati = [...op.passi].sort((a, b) => numero.get(a.id) - numero.get(b.id));
  for (const p of ordinati) {
    const dove = posizione(p.regione);
    if (!dove) continue;
    const i = perRegione.get(p.regione) || 0;
    perRegione.set(p.regione, i + 1);
    const stato = stati.get(p.id) || p.stato;
    const c = el('div', 'wp-op-segno');
    c.style.setProperty('--st', COLORI_STATO[stato] || COLORI_STATO.da_fare);
    c.appendChild(el('span', 'wp-op-segno-n', String(numero.get(p.id))));
    if (p.quando) c.appendChild(el('span', 'wp-op-segno-ora', oraBreve(p.quando)));
    c.appendChild(el('span', 'wp-op-segno-tit', p.titolo || regionName(p.regione)));
    c.title = [opT(`kind_${p.tipo}`), opT(`st_${stato}`), p.incaricato].filter(Boolean).join(' · ');
    const m = new maplibregl.Marker({ element: c, anchor: 'bottom', offset: [0, -12 - i * 26] })
      .setLngLat(dove).addTo(map);
    _marker.push(m);
  }
}

function inquadra(map, op) {
  const punti = [];
  for (const p of op.passi) {
    for (const id of [p.regione, p.tipo === 'attacco' || p.tipo === 'difesa' ? p.daRegione : null]) {
      const q = posizione(id);
      if (q) punti.push(q);
    }
  }
  if (!punti.length) return;
  if (punti.length === 1) {
    map.flyTo({ center: punti[0], zoom: Math.max(map.getZoom(), 5), duration: 900 });
    return;
  }
  const lng = punti.map((q) => q[0]), lat = punti.map((q) => q[1]);
  map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]], {
    padding: { top: 90, bottom: 190, left: 70, right: 70 },
    maxZoom: 6,
    duration: 900,
  });
}

function barra(map, op, { numero, stati }) {
  const b = el('div', 'wp-op-mapbar');
  b.id = 'wp-op-mapbar';
  b.setAttribute('role', 'region');
  b.setAttribute('aria-label', opT('mapBarLabel'));

  const testa = el('div', 'wp-op-mapbar-testa');
  testa.appendChild(el('span', 'wp-op-mapbar-label', opT('mapBarLabel')));
  testa.appendChild(el('strong', 'wp-op-mapbar-titolo', op.titolo));
  const azioni = el('div', 'wp-op-mapbar-azioni');
  const torna = el('button', 'wp-op-mapbar-btn', opT('mapBack'));
  torna.type = 'button';
  torna.addEventListener('click', () => { nascondiOperazione(); openPrivateView(); });
  const chiudi = el('button', 'wp-op-mapbar-btn wp-op-mapbar-x', '×');
  chiudi.type = 'button';
  chiudi.setAttribute('aria-label', opT('mapClose'));
  chiudi.title = opT('mapClose');
  chiudi.addEventListener('click', () => nascondiOperazione());
  azioni.appendChild(torna);
  azioni.appendChild(chiudi);
  testa.appendChild(azioni);
  b.appendChild(testa);

  const passi = el('div', 'wp-op-mapbar-passi');
  let senza = 0;
  for (const p of [...op.passi].sort((x, y) => numero.get(x.id) - numero.get(y.id))) {
    const dove = posizione(p.regione);
    if (!dove) { senza++; continue; }
    const stato = stati.get(p.id) || p.stato;
    const chip = el('button', 'wp-op-mapbar-passo');
    chip.type = 'button';
    chip.style.setProperty('--st', COLORI_STATO[stato] || COLORI_STATO.da_fare);
    chip.appendChild(el('b', null, String(numero.get(p.id))));
    chip.appendChild(el('span', null, [oraBreve(p.quando), p.titolo || regionName(p.regione)].filter(Boolean).join(' · ')));
    chip.title = `${opT(`kind_${p.tipo}`)} · ${opT(`st_${stato}`)}`;
    chip.addEventListener('click', () => map.flyTo({ center: dove, zoom: Math.max(map.getZoom(), 5.5), duration: 700 }));
    passi.appendChild(chip);
  }
  b.appendChild(passi);
  if (senza) b.appendChild(el('p', 'wp-op-mapbar-nota', opT('mapNoRegion').replace('{n}', String(senza))));
  document.body.appendChild(b);
  return b;
}

/** Porta un'operazione sulla mappa. `numero` e `stati` arrivano dalla
 *  lavagna, così la mappa dice esattamente quello che diceva la scheda. */
export function mostraOperazione(op, { numero, stati }) {
  const map = state.map;
  if (!map?.getLayer('regions-fill')) { showToast(opT('mapNotReady'), 'warning'); return; }
  // La time machine nasconde la mappa principale: il piano finirebbe
  // disegnato su una mappa che nessuno vede.
  if (state.timeMachineActive) { showToast(opT('mapTimeMachine'), 'warning'); return; }

  nascondiOperazione();
  const { feats, regioni } = costruisci(op, { stati });
  aggiungiLayer(map, regioni);
  map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: feats });
  aggiungiCartellini(map, op, { numero, stati });
  _barra = barra(map, op, { numero, stati });
  closePrivateView();
  inquadra(map, op);
}

export function nascondiOperazione() {
  for (const m of _marker) m.remove();
  _marker = [];
  _barra?.remove();
  _barra = null;
  if (state.map) togliLayer(state.map);
}
