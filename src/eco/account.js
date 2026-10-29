/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: fetch account (v0.27)
   ------------------------------------------------------------------
   Nato come port di `warera/account.py`; riscritto per la v0.27, quando
   il gioco ha tolto il mercato del lavoro e messo i DIPENDENTI (NPC) al
   posto dei lavoratori.

   ── COSA SI VEDE, E COSA NO ──────────────────────────────────────────
   Fino al 2026-10-27 i dipendenti NON si vedevano da fuori:
   `employee.*` ed `employeeEvent.*` rispondevano 403 "API tokens cannot
   access this endpoint" anche con una chiave valida. Il 2026-10-28 WarEra
   li ha aperti ai token, e `employee.getCompanyRoster {companyId}`
   risponde per QUALUNQUE azienda, non solo per quelle del titolare della
   chiave: dipendenti con statistiche, tratti, felicità, attrezzo, salario
   e la stima del gioco (`estimate.production` punti l'ora, verificato =
   breakdown.production.total ÷ 4 × (1 + productionBonus.total/100)), più
   `hourly`, la somma dell'azienda. Passa dal proxy (è nell'allowlist del
   VPS). Le `employee.getMy*` invece NO: darebbero i dipendenti del
   titolare della chiave, e il proxy le respinge apposta.

   La rosa è una FOTOGRAFIA di adesso; quello che è SUCCESSO resta qui sotto,
   e le due cose si guardano accanto, non l'una al posto dell'altra.

   Si vede, per ogni azienda, quello che è SUCCESSO:
   `work.getStatsByCompany` (token-gated, quindi dal proxy) dà 31 giorni
   di `{dailyDate, total, wage, employeeProd, selfWork, automatedEngine}`
   — punti prodotti dai dipendenti, dal proprietario e dal motore, e
   salari pagati davvero. Tutto l'Ottimizzatore della v0.27 è costruito
   su questo dato misurato, non su una stima del dipendente.

   Il resto è pubblico: `company.getById` (prodotto, regione, livelli di
   area relax e motore, `isFull`), `company.getProductionBonus` (resta
   l'unica fonte ammessa del bonus — oggi 0 per tutti, senza giacimenti né
   specializzazione, ma se il gioco ne rimettesse uno arriverebbe da lì),
   e regione → nazione per la tassa sul reddito.

   `perPage: 20` è un parametro NON documentato ma verificato dal vivo: la
   page size di default è 10 e la paginazione a cursore è rotta a monte per
   le aziende senza `movedUpAt` (vedi BOT_KNOWLEDGE.md §4). Con perPage il
   cursore non serve mai (max reale 12 aziende/account).

   `disabledAt` presente = azienda oltre il cap della skill Companies →
   contribuisce ZERO reddito reale finché non si alza la skill o si disabilita
   un'altra azienda attiva.
   ══════════════════════════════════════════════════════════════ */

import { ecoCall, ecoBatchByKey, EcoProxyUnavailableError } from './api.js';

const byId = (ids, param) => Object.fromEntries(ids.map(id => [id, { [param]: id }]));

/** Un dipendente di getCompanyRoster ridotto a quello che la vista usa.
 *  Le percentuali restano quelle del gioco, mai ricalcolate qui. */
function normalizeEmployee(e) {
  const stat = e.breakdown?.production?.total ?? 0;
  const parts = e.productionBonus?.contributions || [];
  const tool = e.toolItem
    ? {
        code: e.toolItem.code,
        state: Number(e.toolItem.state) || 0,
        maxState: Number(e.toolItem.maxState) || 100,
        broken: Boolean(e.toolStatus?.isBroken),
        usable: e.toolStatus ? e.toolStatus.isUsable !== false : true,
        bonusPct: Number(e.toolStatus?.bonusPercent) || 0,
      }
    : null;
  return {
    id: e._id,
    name: e.name,
    production: stat,
    // Punti l'ora senza nessun bonus: è su questi che la Gestione aggiunge
    // il suo 2% per punto (vedi skills.js).
    rawHourly: stat / 4,
    bonusPct: Number(e.productionBonus?.total) || 0,
    bonusParts: parts.map(p => ({ source: p.source, pct: Number(p.percent) || 0 })),
    pointsHour: Number(e.estimate?.production) || 0,
    wageHour: Number(e.estimate?.wage ?? e.wage) || 0,
    wageExpectation: Number(e.wageExpectation) || null,
    happiness: Number(e.happinessBreakdown?.value ?? 50),
    happinessParts: (e.happinessBreakdown?.contributions || []).map(c => ({
      reason: c.reason, code: c.code || null, delta: Number(c.delta) || 0, revealed: c.revealed !== false,
    })),
    quitChance: Number(e.happinessBreakdown?.quitChance) || 0,
    retireAt: e.retireAskAt || null,
    traits: (e.traits || []).map(t => ({ code: t.code, revealed: t.revealed !== false })),
    potential: e.potential ?? null,
    potentialMax: e.potentialMax ?? null,
    trainable: Number(e.trainingsToday || 0) < Number(e.trainingsPerDay || 0),
    tool,
  };
}

function normalizeRoster(r) {
  if (!r || !Array.isArray(r.employees)) return null;
  const hourly = r.hourly || {};
  return {
    employees: r.employees.map(normalizeEmployee),
    production: Number(hourly.production) || 0,
    wageCost: Number(hourly.wageCost) || 0,
    managerCost: Number(hourly.managerCost) || 0,
    toolboxes: Number(hourly.toolboxes) || 0,
    cap: Number(hourly.cap) || null,
  };
}

/**
 * @returns {Promise<Array<{
 *   id, name, itemCode, regionId, regionName, countryId, countryName,
 *   incomeTax, engineLevel, engineDailyProd, breakRoomLevel, maxEmployees,
 *   disabled, isFull, bonus, stats, roster }>>}
 *   `stats` è l'array di work.getStatsByCompany, o `null` se non è arrivato.
 *   `roster` è getCompanyRoster normalizzato, o `null` se non è arrivato
 *   (proxy vecchio, o WarEra che richiude le procedure): la vista torna
 *   allora a quella dei soli totali, com'era prima.
 */
export async function loadOwnedCompanies(gd, userId) {
  const idsResult = await ecoCall('company.getCompanies', { userId, perPage: 20 });
  const companyIds = idsResult?.items || [];
  if (!companyIds.length) return [];

  const [coById, bonusById, statsById, rosterById] = await Promise.all([
    ecoBatchByKey('company.getById', byId(companyIds, 'companyId')),
    ecoBatchByKey('company.getProductionBonus', byId(companyIds, 'companyId')),
    ecoBatchByKey('work.getStatsByCompany', byId(companyIds, 'companyId')),
    ecoBatchByKey('employee.getCompanyRoster', byId(companyIds, 'companyId')),
  ]);

  // Nessuna statistica arrivata per nessuna azienda = il proxy non sta
  // mettendo la chiave (o il VPS è giù): senza quelle il tool non ha niente
  // da dire, ed è lo stato "setup", non un "zero".
  if (companyIds.every(cid => !Array.isArray(statsById[cid]))) {
    throw new EcoProxyUnavailableError('work.getStatsByCompany non raggiungibile');
  }

  const regionIds = [...new Set(companyIds.map(cid => coById[cid]?.region).filter(Boolean))];
  const regionById = await ecoBatchByKey('region.getById', byId(regionIds, 'regionId'));
  const countryIds = [...new Set(regionIds.map(rid => regionById[rid]?.country).filter(Boolean))];
  const countryById = await ecoBatchByKey('country.getCountryById', byId(countryIds, 'countryId'));

  const gc = gd.gameConfig;
  const levelStat = (upgrade, lvl, stat) => gc.upgradesConfig?.[upgrade]?.levels?.[String(lvl)]?.stats?.[stat] ?? 0;

  const out = [];
  for (const cid of companyIds) {
    const co = coById[cid];
    if (!co) continue;
    const upgrades = co.activeUpgradeLevels || {};
    const engineLevel = upgrades.automatedEngine ?? 1;
    const breakRoomLevel = upgrades.breakRoom ?? 1;
    const region = regionById[co.region] || null;
    const country = region ? countryById[region.country] : null;
    out.push({
      id: cid,
      name: co.name,
      itemCode: co.itemCode,
      regionId: co.region,
      regionName: region?.name || null,
      countryId: region?.country || null,
      countryName: country?.name || null,
      incomeTax: Number(country?.taxes?.income) || 0,
      engineLevel,
      engineDailyProd: levelStat('automatedEngine', engineLevel, 'dailyProd'),
      breakRoomLevel,
      maxEmployees: levelStat('breakRoom', breakRoomLevel, 'maxWorkers'),
      disabled: Boolean(co.disabledAt),
      isFull: Boolean(co.isFull),
      bonus: Number(bonusById[cid]?.total) || 0,
      stats: Array.isArray(statsById[cid]) ? statsById[cid] : null,
      roster: normalizeRoster(rosterById[cid]),
    });
  }
  return out;
}
