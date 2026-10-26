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

   ── DALLA v0.27: RENDITA GIORNALIERA ───────────────────────────────
   Con l'aggiornamento del 2026-10-26 il bonus non esiste più: via la
   specializzazione, giacimenti spenti, e le risorse strategiche invece
   di un bonus pagano una RENDITA (lo sviluppo della nazione d'origine).
   Spariscono `strategicResources.bonuses` e la classifica
   `countryProductionBonus`; arriva `income` su nazioni e regioni:
   { development, strategicResourcesBonus, employeeIncomeTax,
     managerIncomeTax, govType, total }.
   ⚠️ Quei numeri sono ORARI: su apidev lo sviluppo dell'Egitto è 12,11 e
   `income.development` 0,5046 = 12,11 / 24, e la rendita di una risorsa
   (che le note dicono "giornaliera, pari allo sviluppo") torna allo
   stesso modo. Qui si moltiplicano per 24 e si mostra il giorno.
   La vista resta la stessa (stesso bottone, stessi agganci in map.js,
   labels.js, ui.js, viewOverview.js) ma racconta la rendita: decide il
   DATO (`income` presente), non la data, così lo stesso codice gira prima
   e dopo il rilascio. Vedi isRevenueEra().
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

/** Il tetto in vigore adesso: sale a 60 appena le etiche sono in memoria.
 *  Nella v0.27 è la rendita più alta del mondo (vedi revenueMax). */
export function scaleMax() {
  if (isRevenueEra()) return revenueMax();
  return ethicStats().loaded ? SCALE_MAX_WITH_ETHICS : SCALE_MAX;
}

/** v0.27: le nazioni portano `income`. Basta guardarne una — arrivano
 *  tutte dalla stessa risposta. Costa niente: la chiamano le etichette a
 *  ogni frame. */
export function isRevenueEra() {
  for (const n of state.nationMap.values()) return !!n?.income;
  return false;
}

/** Ore → giorno, arrotondato al centesimo. Vedi "i numeri sono ORARI". */
const perGiorno = (v) => (Number.isFinite(v) ? Math.round(v * 24 * 100) / 100 : 0);

/** Le voci della rendita giornaliera di una nazione o di una regione. */
export function revenueOf(obj) {
  const inc = obj?.income;
  if (!inc) return null;
  return {
    total: perGiorno(inc.total),
    development: perGiorno(inc.development),
    strategic: perGiorno(inc.strategicResourcesBonus),
    employeeTax: perGiorno(inc.employeeIncomeTax),
    managerTax: perGiorno(inc.managerIncomeTax),
    govType: perGiorno(inc.govType),
  };
}

/* Il tetto della scala nella v0.27. Non fisso come i 30/60 del bonus: la
   rendita dipende dallo sviluppo e dalle aziende, e prima del rilascio non
   c'è modo di sapere dove si fermi. Quindi la nazione più ricca di adesso,
   memoizzata sul primo oggetto nazione (refreshData li sostituisce tutti:
   cambia l'oggetto, si ricalcola). */
let _maxCache = { key: null, max: 1 };
function revenueMax() {
  const first = state.nationMap.values().next().value;
  if (_maxCache.key === first) return _maxCache.max;
  let max = 0;
  for (const n of state.nationMap.values()) max = Math.max(max, revenueOf(n)?.total || 0);
  _maxCache = { key: first, max: max || 1 };
  return _maxCache.max;
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
  if (nation?.income) return _computeRevenueInfo(nation);
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

/* v0.27 — stessa forma di productionInfo, così map.js, labels.js e il
   riepilogo non cambiano strada: `bonus` resta il VALORE DELLA VISTA, che
   qui è la rendita totale al giorno (non una percentuale). Le voci stanno
   in `revenue`; le risorse tenute in `types`, perché ora sono loro a
   pagare. Nessuna etica: i partiti non ne hanno più. */
function _computeRevenueInfo(nation) {
  const revenue = revenueOf(nation);
  if (!(revenue?.total > 0)) return null;
  const res = nation?.strategicResources?.resources || {};
  const types = RESOURCE_TYPES
    .map(({ key, icon }) => ({ key, icon, regions: Array.isArray(res[key]) ? res[key].length : 0 }))
    .filter(r => r.regions > 0);
  return {
    bonus: revenue.total,
    revenue,
    strategic: 0,
    ethic: 0,
    specializedItem: null,
    dev: null,
    rank: null,
    regions: types.reduce((s, r) => s + r.regions, 0),
    types,
  };
}

/** Le regioni che rendono di più, per il riepilogo: la vista del gioco
 *  ("Daily revenue") è per regione, e la domanda dopo "quale nazione"
 *  è "dove". */
export function topRevenueRegions(limit = 10) {
  const rows = [];
  for (const [id, region] of Object.entries(state.regionData || {})) {
    const r = revenueOf(region);
    if (r?.total > 0) rows.push({ id, region, ...r });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, limit);
}

/** Verde spento (poco) → menta acceso (molto). Tavolozza tenuta distinta
 *  dalle altre viste sequenziali: popolazione è rosa→giallo, danno
 *  settimanale blu→rosso. */
export function getProductionColor(bonus, max = scaleMax()) {
  // Lineare, non compressa: i livelli veri sono pochi e distanti (5, 10,
  // 15, 20, 25, 30, e col bonus etico 35, 50, 60) e si distinguono già; con
  // la radice quadrata il 5% — che sono due terzi delle nazioni dotate —
  // saliva a mezza rampa e l'Europa diventava tutta verde acceso.
  // La rendita della v0.27 invece è continua e larghissima (dalle
  // nazioni vuote alle grandi c'è un fattore cento): lì la radice serve,
  // o resterebbe acceso solo il primo.
  const r = Math.max(0, Math.min(1, bonus / max));
  const u = isRevenueEra() ? Math.sqrt(r) : r;
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
  // v0.27: di cosa è fatta la rendita del mondo intero.
  const parts = { development: 0, strategic: 0, employeeTax: 0, managerTax: 0, govType: 0 };

  for (const [, nation] of state.nationMap) {
    const info = productionInfo(nation);
    if (!info) { without++; continue; }
    withBonus++;
    sum += info.bonus;
    if (info.ethic > 0) { withEthic++; ethicSum += info.ethic; }
    if (info.bonus > best) best = info.bonus;
    for (const t of info.types) byResource[t.key] += t.regions;
    if (info.revenue) for (const k of Object.keys(parts)) parts[k] += info.revenue[k] || 0;
  }

  return {
    revenue: isRevenueEra(),
    total: sum,
    parts,
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
  // Con la radice della v0.27 i punti della legenda vanno presi al
  // quadrato, o la barra non sarebbe la stessa rampa della mappa.
  const quadra = isRevenueEra();
  const stops = [0, 0.25, 0.5, 0.75, 1].map(f => getProductionColor((quadra ? f * f : f) * max, max));
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
