/* ═══════════════════════════════════════════════════════════════════════
   RISORSE STRATEGICHE — abilità per i cittadini, condivise nell'alleanza
   -----------------------------------------------------------------------
   Dall'aggiornamento del 7 novembre 2026 le risorse strategiche non
   pagano più soldi (`income.strategicResourcesBonus` = 0 su 181 nazioni):
   danno un BONUS DI ABILITÀ a ogni cittadino.

   - Livelli: 1, 4 e 9 copie di una risorsa (cioè regioni che la portano)
     danno livello 1, 2 e 3. Le copie in mezzo non aggiungono niente.
   - Per livello: terre rare +3 Produzione, oro +1 Gestione, litio +10
     Energia, carbone +5 Precisione, diamanti +10 Salute, uranio +2
     Probabilità di bottino (le note dicevano "rendita di sviluppo", l'API
     dice bottino: vale l'API).
   - Alleanza: ogni membro prende il bonus delle copie di TUTTI i membri;
     un membro sospeso non dà e non prende. Senza alleanza contano solo le
     regioni della nazione.
   - Il bonus del singolo giocatore sta in `skills.<x>.strategic` di
     user.getUserById.

   Due fonti, in quest'ordine:
   1. `country.getStrategicResourceBonuses {countryId}` — PUBBLICA su api6,
      una richiesta. Dà le nazioni che contano (sospesi esclusi), le
      regioni per risorsa e i bonus già calcolati. `null` per una nazione
      senza alleanza e senza risorse.
   2. Il calcolo locale, a costo zero, da `strategicResources.resources` e
      `allianceId` di country.getAllCountries (già in memoria). Provato l'8
      novembre su 181 nazioni: 167 identiche all'endpoint; le altre sono 8
      senza niente (null) e 6 di un'alleanza in cui un membro non ha ancora
      `allianceId` nella lista delle nazioni. Non sa dei sospesi: per questo
      è il ripiego e non la fonte.
   ═══════════════════════════════════════════════════════════════════════ */

import { API_BASE_URL } from '../diplomacy/config.js';

/** Copie che servono per ciascun livello. */
export const LEVEL_COPIES = [1, 4, 9];

/** Risorsa → abilità e bonus per livello, nell'ordine in cui si mostrano. */
export const STRATEGIC_RULES = [
  { key: 'rareEarths', icon: '🧪', skill: 'production', perLevel: 3 },
  { key: 'gold', icon: '🟡', skill: 'management', perLevel: 1 },
  { key: 'lithium', icon: '🔋', skill: 'energy', perLevel: 10 },
  { key: 'coal', icon: '⚫', skill: 'precision', perLevel: 5 },
  { key: 'diamonds', icon: '💎', skill: 'health', perLevel: 10 },
  { key: 'uranium', icon: '☢️', skill: 'lootChance', perLevel: 2 },
];

export function levelOf(copies) {
  let l = 0;
  for (const need of LEVEL_COPIES) if (copies >= need) l++;
  return l;
}

/** Quante copie mancano al livello dopo, o null se è già al massimo. */
export function copiesToNext(copies) {
  const need = LEVEL_COPIES.find(n => n > copies);
  return need == null ? null : need - copies;
}

const countRes = (res) => Object.fromEntries(
  Object.entries(res || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));

/** Righe pronte da disegnare: una per risorsa, con copie dell'alleanza,
 *  copie proprie, livello, bonus e copie che mancano al livello dopo. */
function buildRows(total, own) {
  return STRATEGIC_RULES.map(r => {
    const copies = total[r.key] || 0;
    const level = levelOf(copies);
    return {
      ...r, copies, own: own[r.key] || 0, level,
      bonus: level * r.perLevel, toNext: copiesToNext(copies),
    };
  });
}

/** Le risorse di un GRUPPO qualunque di nazioni, come se fosse un'alleanza
 *  sola: le alleanze di Statistiche alleanze, quelle fuse nel Builder, le
 *  fazioni del 1 vs 2. Per ogni risorsa anche chi porta le copie
 *  (`holders`: [{ nation, n }], dal più grande). Non sa dei membri
 *  sospesi, che in gioco non danno e non prendono. */
export function groupStrategic(nations) {
  const total = {};
  const holders = {};
  for (const n of nations || []) {
    if (!n) continue;
    for (const [k, v] of Object.entries(countRes(n.strategicResources?.resources))) {
      if (!v) continue;
      total[k] = (total[k] || 0) + v;
      (holders[k] || (holders[k] = [])).push({ nation: n, n: v });
    }
  }
  const rows = buildRows(total, {});
  for (const r of rows) r.holders = (holders[r.key] || []).sort((a, b) => b.n - a.n);
  return {
    rows,
    levels: rows.reduce((s, r) => s + r.level, 0),
    skills: Object.fromEntries(rows.map(r => [r.skill, r.bonus])),
  };
}

/** Il calcolo locale (vedi testata). `nations` = state.nazioniGlobal. */
export function localStrategic(nation, nations) {
  if (!nation) return null;
  const group = nation.allianceId
    ? (nations || []).filter(n => n?.allianceId === nation.allianceId)
    : [nation];
  if (!group.some(n => n._id === nation._id)) group.push(nation);
  const total = {};
  for (const n of group) {
    for (const [k, v] of Object.entries(countRes(n.strategicResources?.resources))) total[k] = (total[k] || 0) + v;
  }
  return {
    source: 'local',
    allianceId: nation.allianceId || null,
    countryIds: group.map(n => n._id),
    rows: buildRows(total, countRes(nation.strategicResources?.resources)),
  };
}

const _cache = new Map();   // countryId → { at, p }
const TTL_MS = 10 * 60 * 1000;

/** Dall'endpoint del gioco, con ripiego sul calcolo locale. Non lancia. */
export function fetchStrategic(nation, nations) {
  if (!nation?._id) return Promise.resolve(null);
  const hit = _cache.get(nation._id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = (async () => {
    try {
      const url = `${API_BASE_URL}/trpc/country.getStrategicResourceBonuses?input=${encodeURIComponent(JSON.stringify({ countryId: nation._id }))}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json())?.result?.data;
      // null = né alleanza né risorse: nessun bonus, ed è un dato.
      if (d == null) return { source: 'game', allianceId: null, countryIds: [nation._id], rows: buildRows({}, {}) };
      const rows = buildRows(countRes(d.regionIds), countRes(nation.strategicResources?.resources));
      // Il numero del gioco vince sulla regola, se mai le due divergessero.
      const sk = d.bonuses?.skills || {};
      for (const r of rows) if (Number.isFinite(sk[r.skill])) r.bonus = sk[r.skill];
      return { source: 'game', allianceId: d.allianceId || null, countryIds: d.countryIds || [nation._id], rows };
    } catch (err) {
      console.warn('WarEra+ risorse strategiche: endpoint non disponibile, calcolo locale:', err.message);
      return localStrategic(nation, nations);
    }
  })();
  _cache.set(nation._id, { at: Date.now(), p });
  return p;
}
