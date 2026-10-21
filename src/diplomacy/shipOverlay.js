/* ══════════════════════════════════════════════════════════════
   WarEra+ — Le navi delle rotte marittime, su un canvas tutto loro
   ------------------------------------------------------------------
   Prima le navi erano un layer `circle` di MapLibre, aggiornato con un
   setData ogni 1,5 s (oceanRoutes.js: makeRunner). Due difetti, legati:

   1. andavano a scatti. La nave stava sul vertice floor(progresso × n)
      della linea: nel Mediterraneo restava ferma 15-25 s e poi balzava
      avanti. E la velocità era una frazione della rotta, quindi ogni
      nave faceva il giro in 11-21 minuti qualunque fosse la lunghezza:
      sull'artica andava sette volte più veloce che fra Gibilterra e Suez;
   2. ogni setData costava un repaint WebGL dell'intera mappa, che a sua
      volta trascinava drawLabels (labels.js, su map.on('render')). Per
      questo l'intervallo era stato allungato da 180 a 500 a 1500 ms:
      più scatti in cambio di meno costo.

   Un movimento fluido dentro MapLibre vorrebbe dire ridisegnare la mappa
   a ogni fotogramma. Qui invece le navi stanno su un <canvas> 2D sopra
   la mappa (stessa idea delle etichette di labels.js) e MapLibre non sa
   nemmeno che esistono: zero setData, zero repaint della mappa.

   ── Fluido senza girare a 60 fps ─────────────────────────────────
   La posizione è funzione del TEMPO, non dei tick: distanza = velocità ×
   tempo lungo il percorso misurato in Mercator (buildShipPaths), cioè
   come appare sullo schermo, interpolata fra i vertici. Tutte le navi
   vanno quindi alla stessa velocità visibile, e si ridisegna solo quando
   la più veloce si è spostata di STEP_PX: il canvas disegna a posizioni
   frazionarie, quindi un quarto di pixel alla volta la nave scivola. A
   zoom mondo sono ~2 ridisegni al secondo (avanza di mezzo pixel al
   secondo), a zoom 8 si arriva a 60. Fra un ridisegno e l'altro il
   thread è libero: un setTimeout, non un requestAnimationFrame a vuoto.

   Arrivata in fondo la nave fa dietrofront invece di sparire e
   ricomparire al porto di partenza, e il tooltip gira Da/A con lei.

   ── Cosa resta com'era ───────────────────────────────────────────
   Colori e dimensioni sono quelli dei layer di prima. Quando le navi ci
   sono lo decidono ancora i due temi (oceanBackground.js, antiqueTheme.js),
   ognuno col suo "proprietario" per non spegnere quelle dell'altro. Si
   fermano come prima con la time machine, gli overlay (mapIdle.js) e
   l'interruttore delle animazioni (shared/motion.js); ferme restano
   visibili, come facevano i pallini di prima. Il tooltip (shipTooltip.js)
   chiede qui quale nave sta sotto il cursore (shipAt) invece di
   interrogare un layer.

   ⚠️ Il canvas sta SOPRA il riempimento dei paesi: prima le navi stavano
   sotto, e sulla terra sparivano. Va bene solo perché nessuna rotta passa
   più sulla terraferma — `npm run check:routes` lo verifica. Sopra le navi
   restano le etichette (canvas a z-index 500) e i marker DOM delle battaglie.
   ══════════════════════════════════════════════════════════════ */

import { buildShipPaths, CARGO_COUNT } from './oceanRoutes.js';

// Gradi Mercator al secondo, uguale per tutte le navi. Partita dalla
// mediana delle vecchie (0,1; erano 0,03-0,36 secondo la rotta), poi +20%
// su richiesta (2026-10-21).
const SPEED = 0.12;
const SPEED_JITTER = 0.15;   // ±15% per nave, così non avanzano a passo d'oca
const STEP_PX = 0.25;        // spostamento massimo fra due ridisegni
// Un buco più lungo di così (tab in background, PC in sospensione) non fa
// saltare le navi in avanti: il tempo nave scorre solo mentre le si guarda.
const MAX_DT = 2;
// Stessa scala di 'circle-radius' dei vecchi layer: zoom → raggio in px.
const RADIUS_STOPS = [[1, 2.6], [4, 3.6], [8, 5]];
const MAX_DPR = 2;

// ==================== PRNG seedato (mulberry32) ====================
// Spostato qui da oceanRoutes.js: serve solo a partenza, velocità e carico
// delle navi. Stesso seed, stesso "disegno" a ogni sessione.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _map = null;
let _canvas = null;
let _ctx = null;
let _w = 0, _h = 0;
let _ships = [];      // { routeIdx, path, offset, speed, cargo }
let _owner = null;    // 'dark' | 'antique' | null (nascoste)
let _style = null;    // { color, opacity }
let _running = false;
let _clock = 0;       // secondi di tempo nave: avanza solo mentre girano
let _lastTick = 0;
let _timer = 0;
let _raf = 0;
let _drawn = [];      // { x, y, ship, back } dell'ultimo disegno, per shipAt

function radiusAt(zoom) {
  if (zoom <= RADIUS_STOPS[0][0]) return RADIUS_STOPS[0][1];
  for (let i = 1; i < RADIUS_STOPS.length; i++) {
    const [z1, r1] = RADIUS_STOPS[i];
    if (zoom <= z1) {
      const [z0, r0] = RADIUS_STOPS[i - 1];
      return r0 + ((zoom - z0) / (z1 - z0)) * (r1 - r0);
    }
  }
  return RADIUS_STOPS[RADIUS_STOPS.length - 1][1];
}

// Posizione di una nave al tempo _clock. Il percorso si fa avanti e
// indietro: s scorre su 2 × lunghezza, la seconda metà è il ritorno.
function positionOf(ship) {
  const p = ship.path;
  const L = p.total;
  let s = (ship.offset * 2 * L + ship.speed * _clock) % (2 * L);
  const back = s > L;
  if (back) s = 2 * L - s;
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] <= s) lo = mid; else hi = mid;
  }
  const t = (s - p.cum[lo]) / ((p.cum[hi] - p.cum[lo]) || 1);
  return {
    lng: p.lng[lo] + (p.lng[hi] - p.lng[lo]) * t,
    lat: p.lat[lo] + (p.lat[hi] - p.lat[lo]) * t,
    back,
  };
}

function resize() {
  if (!_canvas || !_map) return;
  const gl = _map.getCanvas();
  _w = gl.clientWidth;
  _h = gl.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  _canvas.width = Math.round(_w * dpr);
  _canvas.height = Math.round(_h * dpr);
  _canvas.style.width = _w + 'px';
  _canvas.style.height = _h + 'px';
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  if (!_ctx) return;
  _ctx.clearRect(0, 0, _w, _h);
  _drawn = [];
  if (!_owner || !_style) return;

  const r = radiusAt(_map.getZoom());
  // Con renderWorldCopies la mappa può mostrare più copie del mondo: ogni
  // nave va disegnata in ognuna di quelle visibili (getBounds le include,
  // con longitudini oltre ±180).
  const b = _map.getBounds();
  const west = b.getWest() - 2, east = b.getEast() + 2;

  _ctx.globalAlpha = _style.opacity;
  _ctx.fillStyle = _style.color;
  _ctx.beginPath();
  for (const ship of _ships) {
    const pos = positionOf(ship);
    const lng = ((pos.lng + 540) % 360) - 180;
    for (let k = Math.ceil((west - lng) / 360); lng + 360 * k <= east; k++) {
      const pt = _map.project([lng + 360 * k, pos.lat]);
      if (pt.x < -r || pt.y < -r || pt.x > _w + r || pt.y > _h + r) continue;
      _ctx.moveTo(pt.x + r, pt.y);
      _ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      _drawn.push({ x: pt.x, y: pt.y, ship, back: pos.back });
    }
  }
  _ctx.fill();
}

// Ogni quanti ms ridisegnare perché la nave più veloce non si sposti più
// di STEP_PX: dipende dallo zoom (un grado Mercator vale 512·2^z/360 px).
function frameInterval() {
  const pxPerSec = (SPEED * (1 + SPEED_JITTER) * 512 * Math.pow(2, _map.getZoom())) / 360;
  return (STEP_PX / pxPerSec) * 1000;
}

function schedule() {
  if (!_running || _timer || _raf) return;
  const wait = frameInterval();
  if (wait < 20) {
    _raf = requestAnimationFrame(tick);
  } else {
    // Il setTimeout aspetta, il rAF finale allinea il disegno al refresh
    // dello schermo (e in una tab nascosta non parte: niente lavoro a vuoto).
    _timer = setTimeout(() => { _timer = 0; _raf = requestAnimationFrame(tick); }, wait - 16);
  }
}

function tick(now) {
  _raf = 0;
  if (!_running) return;
  _clock += Math.min(MAX_DT, Math.max(0, (now - _lastTick) / 1000));
  _lastTick = now;
  draw();
  schedule();
}

function cancel() {
  if (_timer) { clearTimeout(_timer); _timer = 0; }
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
}

/**
 * Crea il canvas sopra la mappa (subito dopo quello di MapLibre, quindi
 * sotto i marker DOM e le etichette). Idempotente: la chiamano entrambi i
 * temi nella loro init.
 */
export function initShipOverlay(map) {
  if (_map || !map) return;
  _map = map;
  const rnd = mulberry32(20260813);
  _ships = buildShipPaths().map((path, routeIdx) => ({
    routeIdx,
    path,
    offset: rnd(),
    speed: SPEED * (1 - SPEED_JITTER + 2 * SPEED_JITTER * rnd()),
    // Carico fisso per tutta la vita della nave: il tooltip deve dire la
    // stessa cosa a ogni passaggio del mouse.
    cargo: Math.floor(rnd() * CARGO_COUNT),
  }));

  _canvas = document.createElement('canvas');
  _canvas.className = 'wp-ship-canvas';
  _canvas.setAttribute('aria-hidden', 'true');
  _canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;display:none;';
  map.getCanvas().insertAdjacentElement('afterend', _canvas);
  _ctx = _canvas.getContext('2d');
  resize();

  // 'move' arriva a ogni cambio di camera, dentro lo stesso fotogramma in
  // cui MapLibre ridisegna: le navi seguono pan e zoom senza ritardo.
  map.on('move', () => { if (_owner) draw(); });
  map.on('resize', () => { resize(); draw(); });
}

/** Mostra le navi con lo stile del tema `owner` (ferme finché non parte runShips). */
export function showShips(owner, style) {
  if (!_canvas) return;
  _owner = owner;
  _style = style;
  _canvas.style.display = '';
  draw();
}

/** Nasconde le navi, ma solo se le sta mostrando `owner`. */
export function hideShips(owner) {
  if (!_canvas || _owner !== owner) return;
  _owner = null;
  _running = false;
  cancel();
  draw();
  _canvas.style.display = 'none';
}

/** Fa ripartire il tempo nave. No-op se le navi sono di un altro tema. */
export function runShips(owner) {
  if (!_canvas || _owner !== owner || _running) return;
  _running = true;
  _lastTick = performance.now();
  schedule();
}

/** Ferma il tempo nave: restano visibili dove sono. */
export function freezeShips(owner) {
  if (!_canvas || _owner !== owner) return;
  _running = false;
  cancel();
}

/**
 * La nave disegnata più vicina al punto (px nel canvas della mappa), entro
 * `pad` px. Usata dal tooltip: niente queryRenderedFeatures, solo i pochi
 * punti dell'ultimo disegno.
 */
export function shipAt(x, y, pad) {
  let best = null, bestD = pad * pad;
  for (const d of _drawn) {
    const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
    if (dd <= bestD) { bestD = dd; best = d; }
  }
  return best && { routeIdx: best.ship.routeIdx, cargo: best.ship.cargo, back: best.back };
}
