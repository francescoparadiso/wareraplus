/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: fetch account
   ------------------------------------------------------------------
   Port di `warera/account.py`. `loadOwnedCompanies` è la fetch condivisa da
   tutte e tre le funzioni (Competenze/Posizione/Lavoratori): ids delle
   aziende + doc di ciascuna + bonus di produzione già calcolato server-side,
   il tutto in batch.

   `perPage: 20` è un parametro NON documentato ma verificato dal vivo: la
   page size di default è 10 e la paginazione a cursore è rotta a monte per
   le aziende senza `movedUpAt` (vedi BOT_KNOWLEDGE.md §4). Con perPage il
   cursore non serve mai (max reale 12 aziende/account).

   `disabledAt` presente = azienda oltre il cap della skill Companies →
   contribuisce ZERO reddito reale finché non si alza la skill o si disabilita
   un'altra azienda attiva. È il campo più importante di tutto il tool.
   ══════════════════════════════════════════════════════════════ */

import { ecoCall, ecoBatchByKey } from './api.js';

/**
 * @returns {Promise<Array<{
 *   id, name, itemCode, regionId, engineLevel, dailyProd, breakRoomLevel,
 *   maxWorkers, workerCount, disabled, bonus }>>}
 */
export async function loadOwnedCompanies(gd, userId) {
  const idsResult = await ecoCall('company.getCompanies', { userId, perPage: 20 });
  const companyIds = idsResult?.items || [];
  if (!companyIds.length) return [];

  const coById = await ecoBatchByKey('company.getById', Object.fromEntries(companyIds.map(cid => [cid, { companyId: cid }])));
  const bonusById = await ecoBatchByKey('company.getProductionBonus', Object.fromEntries(companyIds.map(cid => [cid, { companyId: cid }])));

  const gc = gd.gameConfig;
  const out = [];
  for (const cid of companyIds) {
    const co = coById[cid];
    if (!co) continue;
    const upgrades = co.activeUpgradeLevels || {};
    const engineLevel = upgrades.automatedEngine ?? 1;
    const breakRoomLevel = upgrades.breakRoom ?? 1;
    const dailyProd = gc.upgradesConfig.automatedEngine.levels[String(engineLevel)].stats.dailyProd;
    const maxWorkers = gc.upgradesConfig.breakRoom.levels[String(breakRoomLevel)].stats.maxWorkers;
    out.push({
      id: cid,
      name: co.name,
      itemCode: co.itemCode,
      regionId: co.region,
      engineLevel,
      dailyProd,
      breakRoomLevel,
      maxWorkers,
      workerCount: co.workerCount || 0,
      disabled: Boolean(co.disabledAt),
      bonus: bonusById[cid] || { strategicBonus: 0, depositBonus: 0, ethicSpecializationBonus: 0, ethicDepositBonus: 0, total: 0 },
    });
  }
  return out;
}

/** region.getById in batch, solo per le regioni davvero referenziate. */
export async function resolveRegionNames(regionIds) {
  const ids = [...regionIds];
  if (!ids.length) return {};
  return ecoBatchByKey('region.getById', Object.fromEntries(ids.map(rid => [rid, { regionId: rid }])));
}

export async function resolveCountryNames(countryIds) {
  const ids = [...countryIds];
  if (!ids.length) return {};
  return ecoBatchByKey('country.getCountryById', Object.fromEntries(ids.map(cid => [cid, { countryId: cid }])));
}
