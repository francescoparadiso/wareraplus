/* ══════════════════════════════════════════════════════════════
   WarEra+ — tooltip dei pallini "nave" delle rotte marittime
   ------------------------------------------------------------------
   I pallini animati sulle rotte (oceanRoutes.js: makeRunner, disegnati
   da oceanBackground.js sul tema scuro e da antiqueTheme.js su quello
   chiaro) erano puramente decorativi e muti. Qui si aggiunge un
   micro-tooltip scherzoso al passaggio del mouse — "sto trasportando
   spezie da Gibilterra a Suez" — senza toccare né l'animazione né i
   layer esistenti.

   VINCOLO DICHIARATO DALL'UTENTE: impatto sulle prestazioni nullo o
   minimo. Come viene rispettato, in ordine di importanza:

   1. NIENTE listener delegati di MapLibre (`map.on('mousemove', layerId)`):
      quelli fanno una queryRenderedFeatures ad OGNI evento mousemove del
      browser, senza throttle. Qui il mousemove è nostro, passivo, e la
      query gira al massimo UNA VOLTA PER FRAME (guardia requestAnimationFrame).
   2. La query si limita ai due layer dei pallini (13 punti in tutto) e a
      una bbox di 8px attorno al cursore — il resto della mappa non viene
      mai interrogato.
   3. Si esce SUBITO, prima di qualsiasi query, quando: la mappa si sta
      muovendo (pan/zoom), un overlay copre la mappa (body.wp-subview-open),
      la tab è nascosta, o il puntatore non è un mouse (touch: niente hover,
      il listener non viene proprio registrato).
   4. Zero fetch, zero stato condiviso, zero timer propri: il testo è
      costruito da un dizionario locale al momento del passaggio.

   Il testo NON è tradotto in shared/i18n.js ma in un dizionario locale
   (stessa scelta di src/mu/i18n.js e delle barre menù): sono etichette
   solo di questo dettaglio ornamentale.
   ══════════════════════════════════════════════════════════════ */

import { ROUTE_ENDPOINTS } from './oceanRoutes.js';
import { getLang } from '../shared/i18n.js';

// Gli id dei due layer dei pallini nave: quello del tema scuro
// (oceanBackground.js) e quello del tema chiaro (antiqueTheme.js). Ne è
// visibile sempre e solo uno — l'altro ha visibility:'none' e
// queryRenderedFeatures non lo restituisce, quindi si possono chiedere
// entrambi senza doversi ricordare quale tema è attivo.
const SHIP_LAYERS = ['wp-ocean-route-ships', 'wp-antique-route-ships'];

const HIT_PADDING = 8; // px attorno al cursore: i pallini sono da 2.6-5px

// ══ Dizionario locale (9 lingue, come il resto dello shell) ══
const DICT = {
  en: {
    line: 'Carrying {cargo} from {from} to {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Suez', hormuz: 'Hormuz', malacca: 'Malacca',
      panamaPacific: 'Panama (Pacific)', panamaAtlantic: 'Panama (Atlantic)',
      capeOfGoodHope: 'Cape of Good Hope', bering: 'Bering', capeHorn: 'Cape Horn',
      northSea: 'North Sea', northCape: 'North Cape',
    },
    cargo: ['spices', 'oil', 'grain', 'containers', 'iron', 'coffee', 'weapons', 'timber'],
  },
  it: {
    line: 'Sto trasportando {cargo} da {from} a {to}',
    choke: {
      gibraltar: 'Gibilterra', suez: 'Suez', hormuz: 'Hormuz', malacca: 'Malacca',
      panamaPacific: 'Panama (Pacifico)', panamaAtlantic: 'Panama (Atlantico)',
      capeOfGoodHope: 'Capo di Buona Speranza', bering: 'Bering', capeHorn: 'Capo Horn',
      northSea: 'Mare del Nord', northCape: 'Capo Nord',
    },
    cargo: ['spezie', 'petrolio', 'grano', 'container', 'ferro', 'caffè', 'armi', 'legname'],
  },
  es: {
    line: 'Transportando {cargo} de {from} a {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Suez', hormuz: 'Ormuz', malacca: 'Malaca',
      panamaPacific: 'Panamá (Pacífico)', panamaAtlantic: 'Panamá (Atlántico)',
      capeOfGoodHope: 'Cabo de Buena Esperanza', bering: 'Bering', capeHorn: 'Cabo de Hornos',
      northSea: 'Mar del Norte', northCape: 'Cabo Norte',
    },
    cargo: ['especias', 'petróleo', 'grano', 'contenedores', 'hierro', 'café', 'armas', 'madera'],
  },
  de: {
    line: 'Transportiere {cargo} von {from} nach {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Sues', hormuz: 'Hormus', malacca: 'Malakka',
      panamaPacific: 'Panama (Pazifik)', panamaAtlantic: 'Panama (Atlantik)',
      capeOfGoodHope: 'Kap der Guten Hoffnung', bering: 'Bering', capeHorn: 'Kap Hoorn',
      northSea: 'Nordsee', northCape: 'Nordkap',
    },
    cargo: ['Gewürze', 'Öl', 'Getreide', 'Container', 'Eisen', 'Kaffee', 'Waffen', 'Holz'],
  },
  fr: {
    line: 'Je transporte {cargo} de {from} à {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Suez', hormuz: 'Ormuz', malacca: 'Malacca',
      panamaPacific: 'Panama (Pacifique)', panamaAtlantic: 'Panama (Atlantique)',
      capeOfGoodHope: 'Cap de Bonne-Espérance', bering: 'Béring', capeHorn: 'Cap Horn',
      northSea: 'mer du Nord', northCape: 'Cap Nord',
    },
    cargo: ['des épices', 'du pétrole', 'du blé', 'des conteneurs', 'du fer', 'du café', 'des armes', 'du bois'],
  },
  nl: {
    line: 'Ik vervoer {cargo} van {from} naar {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Suez', hormuz: 'Hormuz', malacca: 'Malakka',
      panamaPacific: 'Panama (Stille Oceaan)', panamaAtlantic: 'Panama (Atlantisch)',
      capeOfGoodHope: 'Kaap de Goede Hoop', bering: 'Bering', capeHorn: 'Kaap Hoorn',
      northSea: 'Noordzee', northCape: 'Noordkaap',
    },
    cargo: ['specerijen', 'olie', 'graan', 'containers', 'ijzer', 'koffie', 'wapens', 'hout'],
  },
  sv: {
    line: 'Fraktar {cargo} från {from} till {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Suez', hormuz: 'Hormuz', malacca: 'Malacka',
      panamaPacific: 'Panama (Stilla havet)', panamaAtlantic: 'Panama (Atlanten)',
      capeOfGoodHope: 'Godahoppsudden', bering: 'Bering', capeHorn: 'Kap Horn',
      northSea: 'Nordsjön', northCape: 'Nordkap',
    },
    cargo: ['kryddor', 'olja', 'spannmål', 'containrar', 'järn', 'kaffe', 'vapen', 'timmer'],
  },
  pt: {
    line: 'Transportando {cargo} de {from} para {to}',
    choke: {
      gibraltar: 'Gibraltar', suez: 'Suez', hormuz: 'Ormuz', malacca: 'Malaca',
      panamaPacific: 'Panamá (Pacífico)', panamaAtlantic: 'Panamá (Atlântico)',
      capeOfGoodHope: 'Cabo da Boa Esperança', bering: 'Bering', capeHorn: 'Cabo Horn',
      northSea: 'Mar do Norte', northCape: 'Cabo Norte',
    },
    cargo: ['especiarias', 'petróleo', 'trigo', 'contentores', 'ferro', 'café', 'armas', 'madeira'],
  },
  ar: {
    line: 'أنقل {cargo} من {from} إلى {to}',
    choke: {
      gibraltar: 'جبل طارق', suez: 'السويس', hormuz: 'هرمز', malacca: 'ملقا',
      panamaPacific: 'بنما (المحيط الهادئ)', panamaAtlantic: 'بنما (الأطلسي)',
      capeOfGoodHope: 'رأس الرجاء الصالح', bering: 'بيرنغ', capeHorn: 'كيب هورن',
      northSea: 'بحر الشمال', northCape: 'الرأس الشمالي',
    },
    cargo: ['التوابل', 'النفط', 'الحبوب', 'الحاويات', 'الحديد', 'البن', 'الأسلحة', 'الأخشاب'],
  },
};

function dict() {
  return DICT[getLang()] || DICT.en;
}

let _tipEl = null;
let _initialized = false;
let _rafPending = false;
let _lastKey = null; // "routeIdx:cargo" della nave attualmente mostrata

function tipEl() {
  if (_tipEl && _tipEl.isConnected) return _tipEl;
  _tipEl = document.createElement('div');
  _tipEl.className = 'wp-ship-tip';
  _tipEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_tipEl);
  return _tipEl;
}

function hide() {
  if (_lastKey === null) return; // già nascosto: niente lavoro sul DOM
  _lastKey = null;
  if (_tipEl) _tipEl.classList.remove('visible');
}

function show(text, x, y) {
  const el = tipEl();
  el.textContent = text;
  // Posizionato a destra/sopra il cursore, ribaltato a sinistra se
  // sborderebbe: nessuna lettura di layout costosa oltre offsetWidth, e
  // solo quando il tooltip cambia nave (vedi _lastKey).
  const w = el.offsetWidth || 180;
  const left = x + 14 + w > window.innerWidth ? x - 14 - w : x + 14;
  el.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, y - 34)}px)`;
  el.classList.add('visible');
}

function textFor(routeIdx, cargoIdx) {
  const ends = ROUTE_ENDPOINTS[routeIdx];
  if (!ends || !ends.from || !ends.to) return null;
  const d = dict();
  return d.line
    .replace('{cargo}', d.cargo[cargoIdx % d.cargo.length])
    .replace('{from}', d.choke[ends.from] || ends.from)
    .replace('{to}', d.choke[ends.to] || ends.to);
}

/**
 * Aggancia il tooltip alla mappa. Idempotente. Su dispositivi senza mouse
 * non registra proprio nulla — niente hover, niente costo.
 */
export function initShipTooltip(map) {
  if (!map || _initialized) return;
  // `(hover: hover)` è falso su touch puro: lì il tooltip non avrebbe modo
  // di aprirsi e ogni listener sarebbe puro spreco.
  if (!window.matchMedia?.('(hover: hover)').matches) return;
  _initialized = true;

  const canvas = map.getCanvasContainer();

  const onMove = (ev) => {
    if (_rafPending) return; // al massimo una query per frame
    // Uscite a costo zero, PRIMA di toccare la mappa: durante pan/zoom i
    // pallini si muovono con la mappa e nessuno li sta puntando; con un
    // overlay aperto la mappa non è nemmeno visibile.
    if (document.hidden || map.isMoving() || map.isZooming() ||
        document.body.classList.contains('wp-subview-open')) { hide(); return; }
    const x = ev.clientX, y = ev.clientY;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      const rect = canvas.getBoundingClientRect();
      const px = x - rect.left, py = y - rect.top;
      const layers = SHIP_LAYERS.filter(id => map.getLayer(id));
      if (!layers.length) { hide(); return; }
      let feats;
      try {
        feats = map.queryRenderedFeatures(
          [[px - HIT_PADDING, py - HIT_PADDING], [px + HIT_PADDING, py + HIT_PADDING]],
          { layers }
        );
      } catch (_) { return; } // stile in ricarica (cambio tema): si riproverà al prossimo movimento
      if (!feats.length) { hide(); return; }
      const p = feats[0].properties || {};
      const key = `${p.routeIdx}:${p.cargo}`;
      // Stessa nave del frame precedente: si aggiorna solo la posizione,
      // niente ricostruzione della stringa né scrittura di textContent.
      if (key === _lastKey) {
        const w = _tipEl?.offsetWidth || 180;
        const left = x + 14 + w > window.innerWidth ? x - 14 - w : x + 14;
        if (_tipEl) _tipEl.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, y - 34)}px)`;
        return;
      }
      const text = textFor(Number(p.routeIdx), Number(p.cargo) || 0);
      if (!text) { hide(); return; }
      _lastKey = key;
      show(text, x, y);
    });
  };

  canvas.addEventListener('mousemove', onMove, { passive: true });
  canvas.addEventListener('mouseleave', hide, { passive: true });
  // Un click apre pannello/tooltip nazione: il messaggino della nave lì
  // sopra sarebbe solo rumore.
  canvas.addEventListener('mousedown', hide, { passive: true });
  window.addEventListener('wareraplus:langchange', () => { _lastKey = null; hide(); });
}
