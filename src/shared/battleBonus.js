/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bonus di battaglia
   ------------------------------------------------------------------
   Modulo NUOVO (2026-10-14). Quanto bonus danno prende chi combatte in
   una battaglia, per lato, a seconda di chi è: cittadino della nazione,
   alleato, partner di patto, nemico giurato dell'avversario, con un
   ordine della sua nazione o della sua unità. Idea dalla pagina
   warera.realmarijn.nl/battles; qui con i dati che il tool ha già, più
   il bonus PERSONALE di chi ha detto "Sono io" in Giocatori.

   Le percentuali NON sono scritte nel codice: vengono da
   gameConfig.getGameConfig (pubblica), con i valori di oggi come
   ripiego. Da dove viene ogni voce:

     Home        battle.patrioticBonusPercent (20), ai cittadini del lato
     Enemy       swornEnemy.bonusPercent della nazione di chi combatte,
                 se il suo nemico giurato è il lato avversario
     Pact        defensivePacts[].bonusPercent del lato, per il partner.
                 Vale per chi DIFENDE la propria terra: il difensore in una
                 guerra, l'attaccante (chi si ribella) in una rivolta
     Ally.       bonus d'alleanza del blocco (allianceBonus.js), a chi è
                 nella stessa alleanza del lato
     Order       ordine della nazione di chi combatte su quel lato:
                 battle.countryOrderBonusPercent (10) per priorità media,
                 ×1,5 alta (rosso), ×0,5 bassa (verde) → 15 / 10 / 5
     MU order    stessa cosa per gli ordini delle unità militari
     MU HQ       quartier generale dell'unità, upgradesConfig.headquarters
     Bunker /    livello ATTIVO (region.activeUpgradeLevels) del bunker
     Mil. base   nella regione difesa / della base in quella d'attacco.
                 Pieno ai cittadini, metà (per eccesso) ad alleati e
                 partner di patto
     Revolt      rivolta: resistanceCitizenBonusPercent (30) ai cittadini
                 e resistanceAllyBonusPercent (15) agli alleati, in
                 proporzione alla barra (resistance / resistanceMax)
     Malus       regione difesa non collegata alla capitale:
                 regionNotLinkedToCapitalMalusPercent (-25) a tutto il lato

   ⚠️ STIMATO, da confermare in gioco:
     - chi riceve la metà di bunker/base. Qui: stessa alleanza o patto
       col lato. Il sito di partenza usa il campo `allies` delle nazioni,
       che per questo progetto è un fossile del 10 giugno (vedi CLAUDE.md);
     - il totale è una SOMMA dei bonus, come fa il sito: il gioco potrebbe
       comporli diversamente. Nell'interfaccia è sempre "≈".

   Costo: battaglie, regioni, diplomazia e alleanze sono già in memoria.
   Le uniche chiamate sono gli ordini (battleOrder.getByBattle, due per
   battaglia, in batch, cache 60 s), la config (una per sessione) e il
   quartier generale della TUA unità (una per sessione). Tutte pubbliche
   su api6: nessun consumo del budget del proxy.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { trpcBatch } from '../diplomacy/utils.js';
import { allianceDamageBonus } from './allianceBonus.js';

/* ── Regole ────────────────────────────────────────────────────── */

// Valori di gameConfig al 2026-10-14: ripiego se la config non arriva.
const DEFAULT_RULES = Object.freeze({
  patriotic: 20,
  countryOrder: 10,
  muOrder: 10,
  notLinked: -25,
  revoltOwn: 30,
  revoltAlly: 15,
  bunker: [0, 5, 10, 15, 20, 25],   // indice = livello
  base: [0, 5, 10, 15, 20, 25],
  hq: [0, 5, 10, 15, 20],
  // gameConfig.mapTravel (v0.28.3, 16 nov 2026): le casse sulla mappa e il
  // ritorno gratis a casa sono spenti. Ripiego = com'è oggi.
  mapCases: false,
  travelHome: false,
});

/* ── Tipo di governo (v0.27, dal 2026-10-26) ────────────────────
   Alcuni tipi cambiano i bonus di battaglia. ⚠️ La config del gioco NON
   li contiene (vedi AGGIORNAMENTO-v0.27.md): i numeri sono quelli delle
   note del rilascio, scritti qui. Senza `govType` (prima della v0.27, o
   nazione Provvisoria) non cambia niente.
     · bonus patriottico: Stato nazionalista 30, Federazione 15,
       Plutocrazia 10 (gli altri il valore della config, 20);
     · Federazione: +5% a chi combatte per un alleato (stessa alleanza);
     · Fronte patriottico: +5% al bunker (⚠️ stimato: qui solo dove un
       bunker acceso c'è);
     · Stato mercenario: danno degli ordini ×2, normale finché la sua
       capitale è occupata.
   Il bonus sul nemico giurato (Stato nazionalista 5% → 15%) arriva già
   dal dato della diplomazia, e non si tocca.

   ⚠️ v0.28.3 (16 nov 2026): Stato mercenario non esiste più (le nazioni
   tornano Provvisorie), quindi `MERCENARY_ORDER_FACTOR` resta solo per
   leggere un dato vecchio. I tipi di unità sono modellati più sotto
   (MU_TYPE_EFFECTS). La barra di resistenza (cala dello 0,2%/h a casa,
   sale 0,1–0,35%/h sotto occupazione) è già quella che legge `defRegion`. */
const GOV_PATRIOTIC = Object.freeze({ nationalistState: 30, federation: 15, plutocracy: 10 });
const FEDERATION_ALLY_BONUS = 5;
const HOMELAND_BUNKER_BONUS = 5;
const MERCENARY_ORDER_FACTOR = 2;

/* ── Tipo di UNITÀ (v0.28.3, dal 2026-11-16) ─────────────────────
   Il tipo arriva dalle API (`mu.type`: assente = paramilitare,
   'stateArmy' con `sponsorCountry`, 'privateMercenary'), gli EFFETTI no:
   non sono in gameConfig. Questi sono quelli della tabella `effects` del
   client del gioco (app.warera.io, chunk _app, letta il 2026-11-17), solo
   le voci che toccano il danno:
     · Esercito di Stato: ordine della NAZIONE ×2, nessun ordine d'unità
       (canIssueMuOrders: false), +5 al bonus patriottico (patrioticBonusDelta),
       +5 a quello d'alleanza (allianceBonusDelta), −5 quando combatte per
       un lato che non è né suo né alleato (foreignSideBonusPercent);
     · Mercenaria privata: QG e ordini d'unità ×2, NESSUN bonus legato alla
       nazionalità (patria, nemico giurato, patto, alleanza, ordine della
       nazione, bunker/base, rivolta), +5 sotto contratto, tetto 70% (75%
       sotto contratto).
   ⚠️ Due letture nostre, da confermare in gioco: chi è "straniero" per il
   −5 (qui: né la propria nazione né un alleato, quindi anche un partner di
   patto), e che bunker/base e rivolta siano fra i bonus di nazionalità
   della mercenaria. Se il gioco cambia la tabella, va cambiata qui. */
export const MU_TYPE_EFFECTS = Object.freeze({
  paramilitary: Object.freeze({ hq: 1, muOrder: 1, countryOrder: 1, muOrders: true, nationality: true, home: 0, ally: 0, foreign: 0, contract: 0, cap: null, capContract: null }),
  stateArmy: Object.freeze({ hq: 1, muOrder: 1, countryOrder: 2, muOrders: false, nationality: true, home: 5, ally: 5, foreign: -5, contract: 0, cap: null, capContract: null }),
  privateMercenary: Object.freeze({ hq: 2, muOrder: 2, countryOrder: 1, muOrders: true, nationality: false, home: 0, ally: 0, foreign: 0, contract: 5, cap: 70, capContract: 75 }),
});
export const MU_TYPES = Object.freeze(Object.keys(MU_TYPE_EFFECTS));
export function muTypeEffects(type) {
  return MU_TYPE_EFFECTS[type] || MU_TYPE_EFFECTS.paramilitary;
}

/** Tetto della mercenaria privata sul totale: 70, o 75 se la parte
 *  `contract` può valere (è un intervallo [0, 5]: il contratto non si sa). */
export function capTotal(total, type) {
  const e = muTypeEffects(type);
  return e.capContract == null ? total : Math.min(total, e.capContract);
}

const govOf = (countryId) => (countryId && state.nationMap?.get(countryId)?.govType) || null;

/** La capitale originaria di una nazione è in mano a qualcun altro? */
function capitalOccupied(countryId) {
  for (const r of Object.values(state.regionData || {})) {
    if (r?.isCapital && r.initialCountry === countryId) return r.country !== countryId;
  }
  return false;
}

const PRIORITY_FACTOR = { high: 1.5, medium: 1, low: 0.5 };
export const PRIORITIES = ['high', 'medium', 'low'];

let _rules = null;
let _rulesP = null;

function levels(upCfg, stat, fallback) {
  const lv = upCfg?.levels;
  if (!lv || typeof lv !== 'object') return fallback;
  const out = [0];
  for (const k of Object.keys(lv).map(Number).filter(Number.isFinite).sort((a, b) => a - b)) {
    out[k] = Number(lv[k]?.stats?.[stat]) || 0;
  }
  for (let i = 0; i < out.length; i++) if (out[i] == null) out[i] = 0;
  return out.length > 1 ? out : fallback;
}

/** Regole del gioco (una richiesta per sessione). Non lancia mai. */
export function loadBonusRules() {
  if (_rules) return Promise.resolve(_rules);
  if (_rulesP) return _rulesP;
  _rulesP = (async () => {
    let cfg = null;
    try { [cfg] = await trpcBatch([['gameConfig.getGameConfig', {}]]); } catch { /* ripiego */ }
    const b = cfg?.battle || {};
    const r = cfg?.region || {};
    const up = cfg?.upgradesConfig || {};
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    _rules = Object.freeze({
      patriotic: num(b.patrioticBonusPercent, DEFAULT_RULES.patriotic),
      countryOrder: num(b.countryOrderBonusPercent, DEFAULT_RULES.countryOrder),
      muOrder: num(b.muOrderBonusPercent, DEFAULT_RULES.muOrder),
      notLinked: num(b.regionNotLinkedToCapitalMalusPercent, DEFAULT_RULES.notLinked),
      revoltOwn: num(r.resistanceCitizenBonusPercent, DEFAULT_RULES.revoltOwn),
      revoltAlly: num(r.resistanceAllyBonusPercent, DEFAULT_RULES.revoltAlly),
      bunker: levels(up.bunker, 'defenseBonus', DEFAULT_RULES.bunker),
      base: levels(up.base, 'attackBonus', DEFAULT_RULES.base),
      hq: levels(up.headquarters, 'attackBonus', DEFAULT_RULES.hq),
      mapCases: cfg?.mapTravel?.mapCasesEnabled ?? DEFAULT_RULES.mapCases,
      travelHome: cfg?.mapTravel?.travelHomeEnabled ?? DEFAULT_RULES.travelHome,
      fromConfig: !!cfg,
    });
    return _rules;
  })();
  return _rulesP;
}

export function orderPct(base, priority) {
  return Math.round(base * (PRIORITY_FACTOR[priority] ?? 1));
}

/* ── Ordini ────────────────────────────────────────────────────── */

const ORDERS_TTL_MS = 60 * 1000;
const _orders = new Map(); // battleId -> { at, data: { attacker: [], defender: [] } | null }

/**
 * Ordini attivi di più battaglie, entrambi i lati, in batch.
 * @returns {Promise<Map<string, {attacker: object[], defender: object[]}|null>>}
 *   null = non letti (errore): l'interfaccia mostra "?" invece di "nessuno".
 */
export async function fetchBattleOrders(battleIds) {
  const now = Date.now();
  const ids = [...new Set(battleIds.filter(Boolean))];
  const todo = ids.filter(id => !(_orders.get(id) && now - _orders.get(id).at < ORDERS_TTL_MS));
  if (todo.length) {
    const calls = [];
    for (const id of todo) {
      calls.push(['battleOrder.getByBattle', { battleId: id, side: 'attacker' }]);
      calls.push(['battleOrder.getByBattle', { battleId: id, side: 'defender' }]);
    }
    let res = [];
    try { res = await trpcBatch(calls); } catch { res = []; }
    todo.forEach((id, i) => {
      const a = res[2 * i];
      const d = res[2 * i + 1];
      const ok = Array.isArray(a) && Array.isArray(d);
      _orders.set(id, {
        at: ok ? now : now - ORDERS_TTL_MS + 10_000, // un errore si riprova presto
        data: ok ? { attacker: a.filter(o => o?.isActive !== false), defender: d.filter(o => o?.isActive !== false) } : null,
      });
    });
  }
  return new Map(ids.map(id => [id, _orders.get(id)?.data ?? null]));
}

/* ── Chi sono io ───────────────────────────────────────────────── */

const MINE_KEY = 'we_my_player';
const ID_RE = /^[a-f0-9]{24}$/i;
let _me = null; // { at, userId, data }
const ME_TTL_MS = 5 * 60 * 1000;
const _hq = new Map(); // muId -> livello attivo (0 = nessuno)

export function myPlayerId() {
  try {
    const v = localStorage.getItem(MINE_KEY);
    return v && ID_RE.test(v) ? v : null;
  } catch { return null; }
}

/** Livello ATTIVO del quartier generale e tipo dell'unità, in un batch.
 *  { hqLevel: 0, muType: 'paramilitary' } se non si leggono. */
async function muHqAndType(muId) {
  if (!muId) return { hqLevel: 0, muType: 'paramilitary' };
  if (_hq.has(muId)) return _hq.get(muId);
  let out = { hqLevel: 0, muType: 'paramilitary', sponsorCountry: null };
  try {
    const [u, mu] = await trpcBatch([
      ['upgrade.getUpgradeByTypeAndEntity', { upgradeType: 'headquarters', muId }],
      ['mu.getById', { muId }],
    ]);
    out = {
      hqLevel: u && u.status === 'active' ? Number(u.level) || 0 : 0,
      muType: MU_TYPE_EFFECTS[mu?.type] ? mu.type : 'paramilitary',
      sponsorCountry: mu?.sponsorCountry || null,
    };
  } catch { /* non letti: paramilitare senza QG */ }
  _hq.set(muId, out);
  return out;
}

/**
 * Il giocatore di "Sono io": nazione, unità e livello del quartier
 * generale. null se "Sono io" non è impostato o il profilo non si legge.
 */
export async function loadMe() {
  const userId = myPlayerId();
  if (!userId) return null;
  if (_me && _me.userId === userId && Date.now() - _me.at < ME_TTL_MS) return _me.data;
  let data = null;
  try {
    const [lite] = await trpcBatch([['user.getUserLite', { userId }]]);
    if (lite) {
      const muId = typeof lite.mu === 'string' ? lite.mu : (lite.mu?._id || null);
      const unit = await muHqAndType(muId);
      data = {
        userId,
        name: lite.username || '',
        countryId: typeof lite.country === 'string' ? lite.country : (lite.country?._id || null),
        muId,
        hqLevel: unit.hqLevel,
        muType: unit.muType,
        sponsorCountry: unit.sponsorCountry,
      };
    }
  } catch { /* profilo non letto */ }
  _me = { at: Date.now(), userId, data };
  return data;
}

/* ── Calcolo ───────────────────────────────────────────────────── */

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const halfUp = (x) => Math.ceil(x / 2);

/** Bonus d'alleanza per allianceId, memorizzato per un giro di calcolo. */
function allianceBonusFn() {
  const memo = new Map();
  return (allianceId) => {
    if (!allianceId) return 0;
    if (memo.has(allianceId)) return memo.get(allianceId);
    const all = state.nazioniGlobal || [];
    const members = all.filter(n => n.allianceId === allianceId);
    const b = allianceDamageBonus(members, all)?.bonus;
    const v = Number.isFinite(b) ? Math.round(b * 10) / 10 : 0;
    memo.set(allianceId, v);
    return v;
  };
}

/**
 * Tutto quello che serve a calcolare un lato, una volta sola.
 * `orders`: { attacker: [], defender: [] } | null (non letti).
 */
export function sideContext(battle, side, rules, orders) {
  const other = side === 'attacker' ? 'defender' : 'attacker';
  const countryId = battle?.[side]?.country || null;
  const enemyId = battle?.[other]?.country || null;
  const isRevolt = battle?.type === 'resistance';
  const defRegion = state.regionData?.[battle?.defender?.region] || null;
  const atkRegionId = battle?.attacker?.region || null;
  const atkRegion = atkRegionId ? state.regionData?.[atkRegionId] || null : null;

  let building = 0;
  let buildingLevel = 0;
  let buildingKnown = true;
  if (side === 'defender') {
    buildingLevel = Number(defRegion?.activeUpgradeLevels?.bunker) || 0;
    building = rules.bunker[buildingLevel] || 0;
    // v0.27: Fronte patriottico, +5% al bunker (vedi "Tipo di governo").
    if (buildingLevel > 0 && govOf(countryId) === 'homelandFront') building += HOMELAND_BUNKER_BONUS;
    buildingKnown = !!defRegion;
  } else {
    buildingLevel = Number(atkRegion?.activeUpgradeLevels?.base) || 0;
    building = rules.base[buildingLevel] || 0;
    buildingKnown = !!atkRegion;   // rivolta: niente regione d'attacco, "?"
  }

  const revoltBar = (isRevolt && side === 'attacker' && defRegion?.resistanceMax)
    ? clamp01((Number(defRegion.resistance) || 0) / Number(defRegion.resistanceMax))
    : 0;

  const countryOrders = new Map(); // countryId -> %
  const muOrders = new Map();      // muId -> %
  for (const o of orders?.[side] || []) {
    if (o.country) {
      const p = orderPct(rules.countryOrder, o.priority);
      countryOrders.set(o.country, Math.max(countryOrders.get(o.country) || 0, p));
    } else if (o.mu) {
      const p = orderPct(rules.muOrder, o.priority);
      muOrders.set(o.mu, Math.max(muOrders.get(o.mu) || 0, p));
    }
  }
  const muVals = [...muOrders.values()];

  return {
    side, countryId, enemyId, isRevolt,
    pactSide: (isRevolt ? 'attacker' : 'defender') === side,
    building, buildingLevel, buildingKnown,
    buildingKind: side === 'defender' ? 'bunker' : 'base',
    notLinked: (side === 'defender' && defRegion && defRegion.isLinkedToCapital === false) ? rules.notLinked : 0,
    revoltBar,
    countryOrders, muOrders,
    muOrderRange: muVals.length ? [Math.min(...muVals), Math.max(...muVals)] : null,
    ordersKnown: !!orders,
    rules,
    allianceOf: (id) => state.nationMap?.get(id)?.allianceId || null,
    allianceBonus: allianceBonusFn(),
  };
}

/**
 * Bonus di chi combatte per `ctx.side` essendo cittadino di
 * `fighterCountryId`. Con `who` ({ muId, hqLevel, muType }) il calcolo è
 * esatto per quella persona; senza, ordini d'unità e quartier generale sono
 * un intervallo ("5-15", "fino a 20") e l'unità è paramilitare. `who` col
 * solo `muType` (scheda Bonus, a mano) applica gli effetti del tipo alle
 * voci della nazione, senza ordine né QG d'unità.
 * Le parti sono numeri, o [min, max] per gli intervalli. Due parti nuove
 * (v0.28.3): `unitType` (Esercito di Stato: +5 / +5 / −5) e `contract`
 * (mercenaria privata: [0, 5], il contratto non si sa).
 */
export function bonusFor(fighterCountryId, ctx, who = null) {
  const r = ctx.rules;
  const own = fighterCountryId && fighterCountryId === ctx.countryId;
  const sideAlliance = ctx.allianceOf(ctx.countryId);
  const fighterAlliance = ctx.allianceOf(fighterCountryId);
  const ally = !own && !!sideAlliance && sideAlliance === fighterAlliance;
  const sideDip = state.diplomacyData?.get(ctx.countryId);
  const fighterDip = state.diplomacyData?.get(fighterCountryId);
  const pactWithSide = !own && !!fighterCountryId && !!sideDip?.defensivePacts?.includes(fighterCountryId);
  const shareBuilding = own || ally || pactWithSide;

  // v0.27: il tipo di governo di chi combatte (vedi "Tipo di governo").
  const gov = govOf(fighterCountryId);
  const orderFactor = (gov === 'mercenaryState' && !capitalOccupied(fighterCountryId)) ? MERCENARY_ORDER_FACTOR : 1;

  // v0.28.3: tipo dell'unità (vedi MU_TYPE_EFFECTS). Senza `who` resta
  // paramilitare, cioè com'era prima: e = tutti fattori 1, delta 0.
  const muType = who?.muType && MU_TYPE_EFFECTS[who.muType] ? who.muType : 'paramilitary';
  const e = muTypeEffects(muType);
  const nat = e.nationality ? 1 : 0;           // mercenaria privata: niente bonus di nazionalità
  const scaleRange = (v, k) => (Array.isArray(v) ? [v[0] * k, v[1] * k] : v * k);
  const muOrderRaw = who?.muId !== undefined ? (ctx.muOrders.get(who.muId) || 0) : who ? 0 : (ctx.muOrderRange || 0);
  const muHqRaw = who?.muId !== undefined ? (r.hq[who.hqLevel || 0] || 0) : who ? 0 : [0, Math.max(...r.hq)];

  const parts = {
    home: nat * (own ? (GOV_PATRIOTIC[gov] ?? r.patriotic) : 0),
    enemy: nat * ((fighterDip?.swornEnemy && fighterDip.swornEnemy === ctx.enemyId) ? (fighterDip.swornBonus || 0) : 0),
    pact: nat * ((ctx.pactSide && !own) ? (sideDip?.pactBonus?.[fighterCountryId] || 0) : 0),
    ally: nat * (ally ? ctx.allianceBonus(fighterAlliance) + (gov === 'federation' ? FEDERATION_ALLY_BONUS : 0) : 0),
    order: nat * (ctx.countryOrders.get(fighterCountryId) || 0) * orderFactor * e.countryOrder,
    muOrder: e.muOrders ? scaleRange(muOrderRaw, e.muOrder) : 0,
    muHq: scaleRange(muHqRaw, e.hq),
    building: nat * (own ? ctx.building : (shareBuilding ? halfUp(ctx.building) : 0)),
    revolt: nat * (ctx.revoltBar ? Math.round((own ? r.revoltOwn : (ally || pactWithSide) ? r.revoltAlly : 0) * ctx.revoltBar * 100) / 100 : 0),
    malus: ctx.notLinked,
    unitType: own ? e.home : ally ? e.ally : e.foreign,
    contract: e.contract ? [0, e.contract] : 0,
  };
  // Il −0 di `nat * 0` non deve comparire come "−0%".
  for (const k of Object.keys(parts)) if (parts[k] === 0) parts[k] = 0;
  return { parts, total: capTotal(sumMax(parts), muType), relation: { own, ally, pact: pactWithSide }, muType };
}

/** Totale "al massimo": la somma usando l'estremo alto degli intervalli. */
export function sumMax(parts) {
  let t = 0;
  for (const v of Object.values(parts)) t += Array.isArray(v) ? v[1] : (Number(v) || 0);
  return Math.round(t * 10) / 10;
}

/**
 * Le righe di una tabella "chi prende quanto" per un lato: cittadini, poi
 * le nazioni con qualcosa di SOLO loro (ordine, nemico giurato), poi i
 * gruppi (alleanza con/senza patto, partner di patto) e "tutti gli altri".
 */
export function sideRows(ctx) {
  const rows = [];
  rows.push({ kind: 'own', countryId: ctx.countryId, ...bonusFor(ctx.countryId, ctx) });

  const specific = new Set();
  for (const id of ctx.countryOrders.keys()) if (id !== ctx.countryId) specific.add(id);
  for (const [id, d] of state.diplomacyData || []) {
    if (id !== ctx.countryId && d?.swornEnemy && d.swornEnemy === ctx.enemyId && d.swornBonus) specific.add(id);
  }
  const specRows = [...specific].map(id => ({ kind: 'country', countryId: id, ...bonusFor(id, ctx) }));
  specRows.sort((a, b) => b.total - a.total);
  rows.push(...specRows);

  // Gruppi: tutte le nazioni non già elencate, raccolte per relazione col lato.
  const groups = { allyPact: [], ally: [], pact: [] };
  for (const n of state.nazioniGlobal || []) {
    if (n._id === ctx.countryId || specific.has(n._id)) continue;
    const b = bonusFor(n._id, ctx);
    if (b.relation.ally && b.relation.pact) groups.allyPact.push(b);
    else if (b.relation.ally) groups.ally.push(b);
    else if (b.relation.pact) groups.pact.push(b);
  }
  for (const [kind, list] of Object.entries(groups)) {
    if (!list.length) continue;
    // Una riga per gruppo: ogni parte come intervallo fra i membri.
    const parts = {};
    for (const key of Object.keys(list[0].parts)) {
      const vals = list.map(b => b.parts[key]);
      const lo = Math.min(...vals.map(v => (Array.isArray(v) ? v[0] : v)));
      const hi = Math.max(...vals.map(v => (Array.isArray(v) ? v[1] : v)));
      parts[key] = lo === hi ? hi : [lo, hi];
    }
    rows.push({ kind, count: list.length, parts, total: sumMax(parts) });
  }
  rows.push({ kind: 'other', ...bonusFor(null, ctx) });
  return rows;
}

/** Il bonus massimo (stimato) di ogni nazione per un lato: per la mappa. */
export function bonusByCountry(ctx) {
  const out = new Map();
  for (const n of state.nazioniGlobal || []) out.set(n._id, bonusFor(n._id, ctx).total);
  return { values: out, baseline: bonusFor(null, ctx).total };
}

/** Il bonus di una persona per entrambi i lati di una battaglia. */
export function personalBonus(battle, rules, orders, me) {
  if (!me?.countryId) return null;
  const who = { muId: me.muId, hqLevel: me.hqLevel, muType: me.muType };
  const out = {};
  for (const side of ['defender', 'attacker']) {
    out[side] = bonusFor(me.countryId, sideContext(battle, side, rules, orders), who);
  }
  out.best = out.attacker.total > out.defender.total ? 'attacker' : 'defender';
  return out;
}

/* ── Bonus di una NAZIONE (vista mappa e scheda Bonus della battaglia) ──
   Le voci che valgono per tutti i cittadini di una nazione. Ordine e
   quartier generale dell'unità no: dipendono dal singolo giocatore, e
   sommati a tutti farebbero partire il mondo intero dal 35%. `unitType` è 0
   senza un tipo scelto; vale solo quando la scheda Bonus applica a mano il
   tipo d'unità a tutte le righe (sideNationRows con `who`). */
export const NATION_KEYS = ['home', 'enemy', 'pact', 'ally', 'order', 'building', 'revolt', 'malus', 'unitType'];

export function nationTotal(parts) {
  let t = 0;
  for (const k of NATION_KEYS) t += Number(parts[k]) || 0;
  return Math.round(t * 10) / 10;
}

export function nationParts(parts) {
  const out = {};
  for (const k of NATION_KEYS) if (parts[k]) out[k] = parts[k];
  return out;
}

/** Le nazioni con un bonus loro (> 0) su un lato, dalla più alta.
 *  `who` ({ muType }) applica il tipo d'unità a tutte (scheda Bonus). Con
 *  l'Esercito di Stato "un bonus loro" è più del −5 degli stranieri: le
 *  nazioni che prendono solo quello finiscono nella riga "le altre". */
export function sideNationRows(ctx, who = null) {
  const rows = [];
  const floor = who ? nationTotal(bonusFor(null, ctx, who).parts) : 0;
  for (const n of state.nazioniGlobal || []) {
    const { parts } = bonusFor(n._id, ctx, who);
    const v = nationTotal(parts);
    if (who ? v > floor : v > 0) rows.push({ id: n._id, v, parts: nationParts(parts) });
  }
  return rows.sort((a, b) => b.v - a.v);
}
