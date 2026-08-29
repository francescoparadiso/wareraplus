/* ══════════════════════════════════════════════════════════════
   WarEra+ — Heatmap "Bonus produzione" (risorse strategiche)
   ------------------------------------------------------------------
   Ogni nazione che controlla regioni con risorse strategiche prende un
   bonus percentuale alla produzione (e lo stesso alla crescita dello
   sviluppo). È una delle poche cose che si guadagnano col TERRITORIO e
   non con la gente: due paesi con la stessa popolazione producono in modo
   diverso se uno ha il carbone e l'altro no. Da qui la vista: dove sta la
   ricchezza mineraria del mondo.

   ZERO RICHIESTE: il dato arriva dentro `country.getAllCountries`, che
   l'app fa già al boot — `strategicResources.resources` (quali risorse, in
   quali regioni) e `strategicResources.bonuses` (la percentuale). La
   classifica `rankings.countryProductionBonus` porta lo stesso numero più
   la posizione, e si usa come rete di sicurezza.

   GRANULARITÀ PER NAZIONE, come population.js e la vista Guerra vs Eco: il
   bonus è di paese. Le regioni che portano la risorsa sono note (sono gli
   id dentro `resources`) ma il vantaggio non è loro, è di chi le possiede:
   colorare solo quelle direbbe un'altra cosa.

   QUALI bonus sono, non solo quanto: sei tipi di risorsa (carbone, uranio,
   diamanti, terre rare, oro, litio), riportati per nazione con quante
   regioni ciascuno — è la domanda immediata dopo "chi ha il bonus più
   alto", e la risposta è già nella stessa risposta API.

   ⚠️ Il valore NON è una semplice moltiplicazione: 5% per tipo di risorsa,
   più un extra decrescente per le regioni in più dello stesso tipo (visto
   dal vivo: 1 tipo/1 regione = 5%, 1/2 = 5,5%, 1/3 = 5,75%, 4 tipi/6
   regioni = 21%). La formula esatta non è documentata e non serve: qui si
   mostra il numero che dà il gioco, mai uno ricalcolato.
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';
import { state } from './state.js';
import { ethicBonusOf, ethicStats } from './countryEthics.js';

/** Ordine di lettura fisso (non per quantità: così due nazioni si
 *  confrontano a colpo d'occhio) e icona di ogni risorsa. */
export const RESOURCE_TYPES = [
  { key: 'coal', icon: '⚫' },
  { key: 'gold', icon: '🟡' },
  { key: 'diamonds', icon: '💎' },
  { key: 'uranium', icon: '☢️' },
  { key: 'lithium', icon: '🔋' },
  { key: 'rareEarths', icon: '🧪' },
];

/** Tetto della scala. Due tetti, perché la vista mostra due cose diverse a
 *  seconda di cosa è arrivato:
 *   · 30% = massimo teorico delle sole risorse strategiche (sei tipi);
 *   · 60% = quel massimo più il +30% dell'etica industrialista.
 *  Fissi, non ricalcolati sul leader del momento: così la mappa di oggi e
 *  quella di domani si confrontano. Vedi scaleMax(). */
export const SCALE_MAX = 30;
export const SCALE_MAX_WITH_ETHICS = 60;

/** Il tetto in vigore adesso: sale a 60 appena le etiche sono in memoria. */
export function scaleMax() {
  return ethicStats().loaded ? SCALE_MAX_WITH_ETHICS : SCALE_MAX;
}

/* ⚠️ productionInfo è MEMOIZZATA, e non per gusto dell'ottimizzazione: la
   chiama labels.js:_metricLabel per OGNI etichetta visibile, e drawLabels è
   agganciata a map.on('render'), cioè ~60 volte al secondo durante pan e zoom
   (lo dice labels.js stesso, ed è il motivo per cui lì esiste già
   _textWidthCache). Le due viste gemelle — popolazione e danno settimanale —
   leggono un numero già pronto dentro `rankings`; questa invece allocava ad
   ogni chiamata un array da RESOURCE_TYPES.map().filter() e un oggetto nuovo,
   per nazione per frame.

   Chiave sull'OGGETTO nazione, non sull'id: refreshData() sostituisce gli
   oggetti dentro state.nationMap, e una WeakMap si svuota da sola quando i
   vecchi non servono più — nessuna invalidazione da ricordare a mano. Resta
   il solo dato che cambia sotto lo stesso oggetto nazione, il bonus etico, e
   per quello c'è il contatore di versione. */
const _infoCache = new WeakMap();   // nation → { version, info }

/**
 * Cosa ha una nazione. `null` se non ha risorse strategiche: è un'assenza
 * vera (88 nazioni su 180), non un dato mancante — chi disegna la tratta
 * come "nessun bonus", non come "sconosciuto".
 *
 * `bonus` è il TOTALE (risorse + etica); `strategic` e `ethic` restano
 * separati perché sono due leve diverse: le risorse si conquistano, l'etica
 * si vota — e l'etica sparisce alle elezioni successive.
 *
 * @returns {{bonus:number, strategic:number, ethic:number, specializedItem:string|null,
 *            dev:number|null, rank:number|null, regions:number,
 *            types:Array<{key:string, icon:string, regions:number}>}|null}
 */
export function productionInfo(nation) {
  if (nation) {
    const hit = _infoCache.get(nation);
    if (hit && hit.version === state.countryEthicsVersion) return hit.info;
  }
  const info = _computeProductionInfo(nation);
  if (nation) _infoCache.set(nation, { version: state.countryEthicsVersion, info });
  return info;
}

function _computeProductionInfo(nation) {
  const sr = nation?.strategicResources;
  const strategic = sr?.bonuses?.productionPercent ?? nation?.rankings?.countryProductionBonus?.value ?? 0;
  const ethic = ethicBonusOf(nation?._id);
  const bonus = (Number.isFinite(strategic) ? strategic : 0) + ethic;
  // Nessuna delle due leve accesa: non è "zero", è una nazione che in
  // questa vista non ha niente da dire — chi disegna la lascia neutra.
  if (!(bonus > 0)) return null;

  const res = sr?.resources || {};
  const types = RESOURCE_TYPES
    .map(({ key, icon }) => ({ key, icon, regions: Array.isArray(res[key]) ? res[key].length : 0 }))
    .filter(r => r.regions > 0);

  return {
    bonus,
    strategic: Number.isFinite(strategic) ? strategic : 0,
    ethic,
    specializedItem: state.countryEthics?.[nation?._id]?.specializedItem || null,
    dev: Number.isFinite(sr?.bonuses?.developmentPercent) ? sr.bonuses.developmentPercent : null,
    rank: nation?.rankings?.countryProductionBonus?.rank ?? null,
    regions: types.reduce((s, r) => s + r.regions, 0),
    types,
  };
}

/** Verde spento (poco) → menta acceso (molto). Tavolozza tenuta distinta
 *  dalle altre viste sequenziali: popolazione è rosa→giallo, danno
 *  settimanale blu→rosso. */
export function getProductionColor(bonus, max = scaleMax()) {
  // Lineare, non compressa: i livelli veri sono pochi e distanti (5, 10,
  // 15, 20, 25, 30, e col bonus etico 35, 50, 60) e si distinguono già; con
  // la radice quadrata il 5% — che sono due terzi delle nazioni dotate —
  // saliva a mezza rampa e l'Europa diventava tutta verde acceso.
  const u = Math.max(0, Math.min(1, bonus / max));
  return `rgb(${Math.round(46 + (79 - 46) * u)},${Math.round(74 + (240 - 74) * u)},${Math.round(64 + (168 - 64) * u)})`;
}

/**
 * @param {boolean} isOriginal usa initialCountryId invece di countryId
 */
export function buildProductionColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const expr = ['match', ['get', prop]];
  let any = false;

  for (const [id, nation] of state.nationMap) {
    const info = productionInfo(nation);
    if (!info) continue;   // nessuna risorsa strategica: resta terra neutra
    expr.push(id, getProductionColor(info.bonus));
    any = true;
  }
  if (!any) return COLORS.DEFAULT_LAND;

  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

/** Classifica per il riepilogo del pannello. */
export function productionRankedList(limit = 20) {
  const rows = [];
  for (const [id, nation] of state.nationMap) {
    const info = productionInfo(nation);
    if (info) rows.push({ id, nation, ...info });
  }
  rows.sort((a, b) => b.bonus - a.bonus || b.regions - a.regions);
  return limit ? rows.slice(0, limit) : rows;
}

/** Numeri di contorno: quante nazioni hanno un bonus, quante no, e come si
 *  distribuiscono le sei risorse nel mondo. */
export function getProductionStats() {
  let withBonus = 0, without = 0, best = 0, sum = 0, withEthic = 0, ethicSum = 0;
  const byResource = Object.fromEntries(RESOURCE_TYPES.map(r => [r.key, 0]));

  for (const [, nation] of state.nationMap) {
    const info = productionInfo(nation);
    if (!info) { without++; continue; }
    withBonus++;
    sum += info.bonus;
    if (info.ethic > 0) { withEthic++; ethicSum += info.ethic; }
    if (info.bonus > best) best = info.bonus;
    for (const t of info.types) byResource[t.key] += t.regions;
  }

  return {
    withBonus, without, best,
    avg: withBonus ? sum / withBonus : 0,
    // Quante nazioni devono una parte del totale all'etica del partito al
    // governo, e quanto vale in tutto: è la differenza fra questa vista e
    // quella di prima, e va detta.
    withEthic, ethicSum,
    ethicsLoaded: ethicStats().loaded,
    byResource,
    regions: Object.values(byResource).reduce((s, v) => s + v, 0),
  };
}

export function productionLegendGradient() {
  const max = scaleMax();
  const stops = [0, 0.25, 0.5, 0.75, 1].map(f => getProductionColor(f * max, max));
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/* ══════════════════════════════════════════════════════════════
   GIACIMENTI TEMPORANEI (deposit)
   ------------------------------------------------------------------
   Le risorse strategiche non sono l'unico bonus alla produzione: ogni
   regione può ospitare un GIACIMENTO a tempo — `region.deposit` =
   { type, bonusPercent, startsAt, endsAt } — che vale il 30% in più su
   quel singolo item (`gameConfig.company.depositResourceBonus = 30`) e
   dura pochi giorni. Il gioco li annuncia con gli eventi
   depositDiscovered / depositDepleted.

   Sono già in `state.regionData` (region.getRegionsObject, caricata al
   boot da regions.js): nessuna richiesta in più per mostrarli. Vanno
   filtrati per finestra temporale, non solo per presenza: un giacimento
   scaduto resta scritto nel dato finché il gioco non lo rimpiazza.
   ══════════════════════════════════════════════════════════════ */

/** @returns {Array<{regionId:string, name:string, countryId:string, type:string,
 *                   bonusPercent:number, endsAt:number, startsAt:number}>}
 *  ordinati per scadenza più vicina: quello che sta per finire è la notizia. */
export function activeDeposits(now = Date.now()) {
  const out = [];
  for (const [regionId, region] of Object.entries(state.regionData || {})) {
    const d = region?.deposit;
    if (!d?.type) continue;
    const startsAt = Date.parse(d.startsAt) || 0;
    const endsAt = Date.parse(d.endsAt) || 0;
    if (endsAt && endsAt < now) continue;          // scaduto, non ancora sostituito
    if (startsAt && startsAt > now) continue;      // annunciato ma non ancora attivo
    out.push({
      regionId,
      name: region.name || region.code || regionId,
      countryId: region.country || null,
      type: d.type,
      bonusPercent: Number.isFinite(d.bonusPercent) ? d.bonusPercent : 30,
      startsAt, endsAt,
    });
  }
  out.sort((a, b) => (a.endsAt || Infinity) - (b.endsAt || Infinity));
  return out;
}

/** Quanti giacimenti attivi ha ogni nazione, per la classifica del pannello. */
export function depositsByCountry(now = Date.now()) {
  const map = new Map();
  for (const d of activeDeposits(now)) {
    if (!d.countryId) continue;
    map.set(d.countryId, (map.get(d.countryId) || 0) + 1);
  }
  return map;
}
