// ═══════════════════════════════════════════════════════════════════════════
// borderStyle.js — WarEra+ (NUOVO)
//
// Riproduce lo stile dei bordi della mappa DEL GIOCO, che qui mancava:
//   · confini INTERNI (tra regioni della stessa nazione) nella tinta della
//     nazione, schiarita — non più una riga nera uguale per tutti;
//   · confini NAZIONALI colorati secondo la RELAZIONE tra i due vicini
//     (guerra, nemico giurato, alleanza, patto difensivo, NAP) — non più
//     una riga bianca uguale per tutti.
//
// Perché serviva un modulo a parte: le tre mesh costruite in map.js
// (bordersMesh / regionsMesh / coastMesh) sono ognuna UNA geometria unica
// fusa, senza proprietà per segmento. Una geometria sola = un colore solo:
// per dipingere ogni tratto di confine in modo diverso servono feature
// distinte, con addosso "di chi è" (countryId) o "tra chi passa" (pairKey).
//
// Come le otteniamo senza rifare 300 volte topojson.mesh (una per coppia di
// vicini, che sarebbe 300 passate sull'intero topology): UNA passata sugli
// archi. In TopoJSON ogni confine condiviso è un arco unico, riferito da
// entrambe le regioni che lo toccano (con indice negativo su un lato, ~i).
// Quindi basta contare, per ogni indice di arco, chi lo usa:
//   · usato una volta sola          → costa (già disegnata da LYR_COAST)
//   · due regioni, stessa nazione   → confine interno
//   · due regioni, nazioni diverse  → confine nazionale tra quelle due
// e poi ricostruire la geometria con topojson.feature() su una
// GeometryCollection sintetica, così la decodifica delta/quantizzazione la
// fa la libreria invece che noi a mano.
//
// Tutto client, zero fetch: le relazioni sono già in state (warsWith,
// diplomacyData, nationAlliancesMap, externalNapsSet).
// ═══════════════════════════════════════════════════════════════════════════

import * as topojson from 'topojson-client';
import { state } from './state.js';
import { COLORS, THEMES } from './config.js';

// ==================== COSTRUZIONE GEOMETRIE ====================

// Raccoglie gli indici di arco di una geometria (Polygon o MultiPolygon),
// normalizzati: in TopoJSON il lato "al contrario" di un arco condiviso è
// scritto come ~i (cioè -i-1), ma è lo STESSO arco.
function _collectArcIndices(arcs, out) {
  if (typeof arcs === 'number') {
    out.add(arcs < 0 ? ~arcs : arcs);
    return;
  }
  if (Array.isArray(arcs)) arcs.forEach(a => _collectArcIndices(a, out));
}

export function pairKeyOf(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Una passata sugli archi del topology → FeatureCollection con due tipi di
 * feature, entrambe MultiLineString (un gruppo per nazione / per coppia,
 * non una feature per arco: passiamo da qualche migliaio di feature a
 * qualche centinaio, il resto è identico a schermo).
 *
 *   { kind: 'inner', countryId }        confini tra regioni della stessa nazione
 *   { kind: 'pair', pairKey, a, b }     confine nazionale tra due vicini
 *
 * Effetto collaterale voluto: riempie state.borderPairs con l'elenco delle
 * coppie di nazioni CONFINANTI (~qualche centinaio), che è l'unico insieme
 * per cui serve poi calcolare una relazione — non tutte le n² coppie.
 */
export function buildBorderFeatures(topoData) {
  const geometries = topoData?.objects?.regions?.geometries;
  if (!geometries) return { type: 'FeatureCollection', features: [] };

  // Due classificazioni nella stessa struttura: la mappa ATTUALE raggruppa
  // per `countryId`, quella ORIGINALE per `initialCountryId` (confini di
  // inizio partita). Sono gli stessi archi letti con due criteri diversi,
  // quindi si producono entrambi i gruppi di feature e si cambia solo il
  // filtro dei layer quando si passa da una vista all'altra — nessuna
  // ricostruzione della sorgente al cambio.
  const synth = [];

  const classify = (field, kindInner, kindPair, store) => {
    const owners = new Map(); // arcIndex → { ids: Set, uses: n }
    geometries.forEach(g => {
      const cid = g.properties?.[field] ?? g.properties?.countryId;
      if (!cid) return;
      const idxs = new Set();
      _collectArcIndices(g.arcs, idxs);
      idxs.forEach(i => {
        let rec = owners.get(i);
        if (!rec) { rec = { ids: new Set(), uses: 0 }; owners.set(i, rec); }
        rec.uses++;
        rec.ids.add(cid);
      });
    });

    const innerByCountry = new Map(); // countryId → [arcIndex]
    const pairArcs = new Map();       // pairKey → { a, b, arcs: [arcIndex] }

    for (const [i, rec] of owners) {
      if (rec.uses < 2) continue; // costa: un solo utilizzatore
      const ids = [...rec.ids];
      if (ids.length === 1) {
        const list = innerByCountry.get(ids[0]) || [];
        list.push(i);
        innerByCountry.set(ids[0], list);
      } else if (ids.length === 2) {
        const key = pairKeyOf(ids[0], ids[1]);
        let rec2 = pairArcs.get(key);
        if (!rec2) { rec2 = { a: ids[0], b: ids[1], arcs: [] }; pairArcs.set(key, rec2); }
        rec2.arcs.push(i);
      }
      // ids.length > 2 non esiste in un topology valido (un arco separa due
      // facce). Se capitasse, lo scartiamo invece di indovinare.
    }

    for (const [cid, arcs] of innerByCountry) {
      synth.push({
        type: 'MultiLineString',
        arcs: arcs.map(i => [i]),
        // Entrambe le proprietà con lo stesso valore: così la stessa
        // feature risponde sia a un'expression che legge `countryId` sia a
        // una che legge `initialCountryId` (la vista Originale colora il
        // riempimento con la seconda), senza duplicare le tavolozze.
        properties: { kind: kindInner, countryId: cid, initialCountryId: cid },
      });
    }
    for (const [key, rec] of pairArcs) {
      synth.push({
        type: 'MultiLineString',
        arcs: rec.arcs.map(i => [i]),
        properties: { kind: kindPair, pairKey: key, a: rec.a, b: rec.b },
      });
    }

    state[store] = [...pairArcs.entries()].map(([key, r]) => ({ key, a: r.a, b: r.b }));
  };

  classify('countryId', 'inner', 'pair', 'borderPairs');
  classify('initialCountryId', 'inner-orig', 'pair-orig', 'borderPairsOriginal');

  return topojson.feature(topoData, { type: 'GeometryCollection', geometries: synth });
}

// ==================== COLORI ====================

// Schiarisce un colore restando sulla stessa tinta: è così che il gioco
// distingue i confini interni dal riempimento — stesso colore, più acceso.
// Lavora in HSL perché alzare i canali RGB slava verso il bianco.
// Riconosce le stringhe che sono un colore: esadecimale, hsl(...) o rgb(...).
// Serve perché la tavolozza delle alleanze arriva in hsl() (vedi
// alliances.js: finalAllianceColor/shiftColor), non solo in #rrggbb.
export function isColorString(v) {
  return typeof v === 'string' && /^(#[0-9a-f]{3,8}|hsla?\(|rgba?\()/i.test(v.trim());
}

// Normalizza qualunque colore CSS a #rrggbb (canvas come parser, stesso
// trucco di alliances.js).
function _toHex(color) {
  const v = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = v;
    return ctx.fillStyle;
  } catch {
    return v;
  }
}

export function brighten(color, dl = 0.18, ds = 0.08) {
  const hex = _toHex(color);
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  const l2 = Math.min(1, l + dl);
  const s2 = Math.min(1, s + ds);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
  const p = 2 * l2 - q;
  const to255 = v => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const rr = to255(hue2rgb(p, q, h + 1 / 3));
  const gg = to255(hue2rgb(p, q, h));
  const bb = to255(hue2rgb(p, q, h - 1 / 3));
  return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1);
}

// Spegne un colore: meno saturo e un filo più scuro. Serve ai confini
// nazionali nelle viste dove il riempimento porta già un'informazione sua
// (alleanze, sfere): lì i rossi/blu pieni della diplomazia gridano più delle
// campiture e la mappa diventa illeggibile. La relazione resta riconoscibile,
// ma smette di essere la prima cosa che si vede.
export function mute(hex, ds = 0.45, dl = -0.05) {
  return brighten(hex, dl, -ds);
}

// Applica una funzione a TUTTI i colori letterali dentro una expression
// MapLibre, lasciando intatta la struttura (['match', ['get', ...], id,
// colore, ...]). È il trucco che tiene i bordi sempre agganciati al
// riempimento: invece di ricostruire a mano una tavolozza per ogni vista
// (diplomazia, alleanze, focus su un'alleanza, sfere...), si prende la
// STESSA expression già calcolata per LYR_FILL e le si schiariscono i colori.
// Così qualunque vista futura è coperta senza toccare questo file.
export function mapExpressionColors(expr, fn) {
  if (typeof expr === 'string') {
    return isColorString(expr) ? fn(expr) : expr;
  }
  if (Array.isArray(expr)) return expr.map(v => mapExpressionColors(v, fn));
  return expr;
}

// Confini interni: stessa tinta del riempimento sotto, più accesa.
// `fillExpr` è l'expression appena messa su LYR_FILL: passandola qui i
// confini interni seguono da soli la vista attiva (colore nazione in
// diplomazia, colore dell'alleanza in vista Alleanze, ecc.).
// Senza `fillExpr` (chiamata di sicurezza) si ricade sui colori nazione.
export function buildInnerBorderColorExpression(fillExpr) {
  const step = innerBorderStep();
  if (Array.isArray(fillExpr)) return mapExpressionColors(fillExpr, step);

  const theme = THEMES[state.theme];
  const neutral = step(theme.NEUTRAL_UNSELECTED);
  // Una 'match' senza nemmeno un caso non è valida in MapLibre ("Expected at
  // least 4 arguments"): succede al primo render, quando i colori nazione
  // non sono ancora arrivati. In quel caso si torna il colore secco.
  if (!state.nationBaseColorMap.size) return neutral;

  const expr = ['match', ['get', 'countryId']];
  for (const [id, color] of state.nationBaseColorMap.entries()) {
    expr.push(id, step(color));
  }
  expr.push(neutral);
  return expr;
}

// Di quanto il confine interno si stacca dal riempimento — e in che
// DIREZIONE. Sul tema scuro si va verso l'alto (riempimenti cupi, la riga
// deve accendersi); sul tema chiaro verso il basso, perché lì le campiture
// sono pallide su pergamena e una riga ancora più chiara sparisce del tutto
// (era il caso dell'arancione, invisibile). In entrambi i casi la
// saturazione sale: la riga resta la tinta della nazione, non un grigio.
export function innerBorderStep() {
  // Nota storica: in Alleanze il confine interno era stato portato al nero,
  // quando le campiture erano molto chiare. Ora che la tavolozza delle
  // alleanze sta nella stessa fascia di luminosità dei colori nazione
  // (alliances.js: finalAllianceColor), vale la stessa regola di Diplomazia
  // — il bordo si accende sopra il riempimento invece di spegnersi.
  const dark = state.theme !== 'light';
  return dark
    ? (c => brighten(c, 0.13, 0.10))
    : (c => brighten(c, -0.20, 0.08));
}

// Palette dei CONFINI, volutamente diversa da COLORS (che colora i
// RIEMPIMENTI): il gioco usa il blu per il confine interno a un'alleanza e
// un grigio per i vicini senza rapporti, non il verde/viola della legenda
// diplomatica. Tenerla qui evita di cambiare i colori delle campiture, che
// restano quelli di sempre.
export const BORDER_COLORS = {
  SWORN_ENEMY: COLORS.SWORN_ENEMY,   // rosso acceso
  WAR: COLORS.WAR_DIRECT,            // rosso scuro
  ALLIANCE: '#2f6fd0',               // blu: stessa alleanza (come nel gioco)
  DEFENSIVE_PACT: '#1abc9c',         // verde acqua: patto difensivo
  NAP: COLORS.NAP,                   // ciano: patto di non aggressione
  NEUTRAL: '#7d8590',                // grigio: nessun rapporto (come nel gioco)
};

// Relazione fra due nazioni CONFINANTI, in ordine di gravità: nemico
// giurato → guerra → alleanza → patto difensivo → NAP → nessuna.
// Assoluta, non relativa alla nazione selezionata: nel gioco il colore del
// confine dice cosa passa fra QUEI due, indipendentemente da dove hai
// cliccato.
function _relationColor(a, b) {
  const dipA = state.diplomacyData.get(a);
  const dipB = state.diplomacyData.get(b);
  if (dipA?.swornEnemy === b || dipB?.swornEnemy === a) return BORDER_COLORS.SWORN_ENEMY;

  const na = state.nationMap.get(a);
  const nb = state.nationMap.get(b);
  if (na?.warsWith?.includes(b) || nb?.warsWith?.includes(a)) return BORDER_COLORS.WAR;

  // ATTENZIONE: nationAlliancesMap è nazione → Set di ID ALLEANZA (non di
  // nazioni alleate, vedi alliances.js). "Stessa alleanza" è quindi
  // l'intersezione dei due insiemi, non un .has(b) sull'altro paese.
  const alA = state.nationAlliancesMap.get(a);
  const alB = state.nationAlliancesMap.get(b);
  if (alA && alB) {
    for (const id of alA) if (alB.has(id)) return BORDER_COLORS.ALLIANCE;
  }

  if (dipA?.defensivePacts?.includes(b) || dipB?.defensivePacts?.includes(a)) return BORDER_COLORS.DEFENSIVE_PACT;

  if (state.externalNapsSet.has(`${a}-${b}`) || state.externalNapsSet.has(`${b}-${a}`)) return BORDER_COLORS.NAP;

  return null; // nessun rapporto: grigio neutro (default della expression)
}

export function buildRelationBorderColorExpression({ muted = false, original = false } = {}) {
  const tone = muted ? mute : (c => c);
  const expr = ['match', ['get', 'pairKey']];
  // In vista Originale i confini sono quelli di inizio partita, ma le
  // relazioni sono quelle di ADESSO: è la lettura utile ("chi confinava con
  // chi, e come stanno oggi"), e comunque non esiste uno storico della
  // diplomazia da cui prendere quelle di allora.
  const pairs = original ? state.borderPairsOriginal : state.borderPairs;
  (pairs || []).forEach(({ key, a, b }) => {
    const color = _relationColor(a, b);
    if (color) expr.push(key, tone(color));
  });
  expr.push(tone(BORDER_COLORS.NEUTRAL));
  // Una 'match' senza nemmeno un caso non è valida in MapLibre: se nessuna
  // coppia confinante ha un rapporto (dati non ancora arrivati), torniamo il
  // grigio secco.
  return expr.length > 3 ? expr : tone(BORDER_COLORS.NEUTRAL);
}
