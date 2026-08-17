/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: ottimizzatore Competenze
   ------------------------------------------------------------------
   Port di `warera/skills.py`. Entro il budget di punti competenza trova la
   combinazione Companies/Energy/Entrepreneurship/Production (0–10 ciascuna)
   che massimizza il guadagno in oro/giorno, tenendo Management come pavimento
   fisso (non cercato) sufficiente ai lavoratori attuali.

   Differenza IMPLEMENTATIVA (non di comportamento) rispetto al bot Python:
   il bot richiamava `worker.getWorkers` una volta per azienda e di nuovo per
   ogni azienda "conveniente da spostare" (round-trip ridondante noto,
   BOT_KNOWLEDGE.md §13). Qui i roster e i profili dei lavoratori si
   pre-caricano in batch UNA sola volta e il calcolo del reddito-lavoratori
   diventa una funzione pura sui dati già in memoria — stessi numeri, meno
   chiamate.

   NB sul SEARCH vs CURRENT (§6): il search valuta ogni azienda alla sua
   miglior regione disponibile SOLO se quel trasloco ripaga entro GREEN_DAYS;
   `cur_total`/"Lavora: X" restano invece letterali all'oggi (solo aziende
   ATTIVE, posizione attuale) — non condividono logica di proposito.
   ══════════════════════════════════════════════════════════════ */

import { ecoBatchByKey } from './api.js';
import { GREEN_DAYS } from './positioning.js';

export async function computeSkills(gd, me, ownedCompanies, jobRate) {
  const costCum = gd.levelTable('companies', 'totalCost');
  const companiesTable = gd.levelTable('companies', 'value');
  const energyTable = gd.levelTable('energy', 'value');
  const entrepTable = gd.levelTable('entrepreneurship', 'value');
  const prodTable = gd.levelTable('production', 'value');
  const managementTable = gd.levelTable('management', 'value');

  // ── Pre-fetch batch dei roster + profili lavoratori (una volta sola) ──
  const withWorkers = ownedCompanies.filter(oc => oc.workerCount > 0);
  const rosters = withWorkers.length
    ? await ecoBatchByKey('worker.getWorkers', Object.fromEntries(withWorkers.map(oc => [oc.id, { companyId: oc.id }])))
    : {};
  const workersByCompany = {};
  const workerIds = new Set();
  for (const oc of withWorkers) {
    const list = rosters[oc.id]?.workers || [];
    workersByCompany[oc.id] = list;
    for (const w of list) workerIds.add(w.user);
  }
  const workerUserById = workerIds.size
    ? await ecoBatchByKey('user.getUserLite', Object.fromEntries([...workerIds].map(id => [id, { userId: id }])))
    : {};

  // Reddito netto/giorno dai lavoratori di una azienda, a un dato bonus%.
  function workerNetPerDay(oc, bonusOverride) {
    const workers = workersByCompany[oc.id] || [];
    if (!workers.length) return 0;
    const bonus = bonusOverride == null ? oc.bonus.total : bonusOverride;
    let total = 0;
    for (const w of workers) {
      const wu = workerUserById[w.user];
      if (!wu) continue;
      const wRawProd = 0.24 * wu.skills.energy.total * wu.skills.production.total;
      const wNetPerPoint = gd.getNetPerPoint(oc.itemCode, bonus + w.fidelity) - w.wage;
      total += wRawProd * wNetPerPoint;
    }
    return total;
  }

  // ── Regioni consigliate per il search reposition-aware ──
  const allItems = [...new Set(ownedCompanies.map(oc => oc.itemCode))].sort();
  const recsByItem = allItems.length
    ? await ecoBatchByKey('company.getRecommendedRegionIdsByItemCode', Object.fromEntries(allItems.map(item => [item, { itemCode: item }])))
    : {};
  const moveCostGold = 5 * gd.prices.concrete;

  const companyRows = [];
  const searchValues = [];
  const searchRates = [];
  let totalWorkersAll = 0;

  for (const oc of ownedCompanies) {
    totalWorkersAll += oc.workerCount;
    const netPerPoint = gd.getNetPerPoint(oc.itemCode, oc.bonus.total);
    const engineRevenue = oc.dailyProd * netPerPoint;
    const workerNet = workerNetPerDay(oc);
    const potentialNetPerDay = engineRevenue + workerNet;
    companyRows.push({
      name: oc.name, item: oc.itemCode, active: !oc.disabled,
      bonusPercent: oc.bonus.total, workers: oc.workerCount,
      maxWorkers: oc.maxWorkers, engineLevel: oc.engineLevel,
      engineRevenue,
      workerNetPerDay: workerNet, potentialNetPerDay, netPerPoint,
    });

    const candidates = recsByItem[oc.itemCode] || [];
    const best = candidates[0] || null;
    let worthMoving = false;
    let bestEngineRevenue = 0, bestNetPerPoint = 0;
    if (best) {
      bestNetPerPoint = gd.getNetPerPoint(oc.itemCode, best.bonus);
      bestEngineRevenue = oc.dailyProd * bestNetPerPoint;
      const repositionGain = bestEngineRevenue - engineRevenue;
      const payback = repositionGain > 0.0001 ? (moveCostGold / repositionGain) : null;
      worthMoving = payback !== null && payback <= GREEN_DAYS;
    }
    if (worthMoving) {
      const bestWorkerNet = workerNetPerDay(oc, best.bonus);
      searchValues.push(bestEngineRevenue + bestWorkerNet);
      searchRates.push(bestNetPerPoint);
    } else {
      searchValues.push(potentialNetPerDay);
      searchRates.push(netPerPoint);
    }
  }

  companyRows.sort((a, b) => b.potentialNetPerDay - a.potentialNetPerDay);
  const companyRevenueSorted = [...searchValues].sort((a, b) => b - a);
  const ownRateBestRecommended = searchRates.length ? Math.max(...searchRates) : 0;

  // "Lavora: X" (oggi): solo un'azienda ATTIVA, alla sua posizione attuale.
  let bestOwnCompany = null;
  let ownRateBest = 0;
  const activeRows = companyRows.filter(r => r.active);
  if (activeRows.length) {
    bestOwnCompany = activeRows.reduce((a, b) => (b.netPerPoint > a.netPerPoint ? b : a));
    ownRateBest = bestOwnCompany.netPerPoint;
  }

  function passiveIncome(lc) {
    const cap = Math.min(companyRevenueSorted.length, Math.floor(companiesTable[lc]));
    let s = 0;
    for (let i = 0; i < cap; i++) s += companyRevenueSorted[i];
    return s;
  }

  const budget = me.leveling.totalSkillPoints;

  let requiredMgmtLevel = 0;
  for (let m = 0; m <= 10; m++) {
    if (managementTable[m] >= totalWorkersAll) { requiredMgmtLevel = m; break; }
  }
  const managementCost = costCum[requiredMgmtLevel];
  const searchBudget = budget - managementCost;

  let best = null;
  for (let lc = 0; lc <= 10; lc++) {
    const cCompanies = costCum[lc];
    if (cCompanies > searchBudget) continue;
    const passive = passiveIncome(lc);
    for (let le = 0; le <= 10; le++) {
      const cEnergy = costCum[le];
      if (cCompanies + cEnergy > searchBudget) continue;
      for (let lt = 0; lt <= 10; lt++) {
        const cEntrep = costCum[lt];
        if (cCompanies + cEnergy + cEntrep > searchBudget) continue;
        for (let lp = 0; lp <= 10; lp++) {
          const cProd = costCum[lp];
          const totalCost = cCompanies + cEnergy + cEntrep + cProd;
          if (totalCost > searchBudget) continue;
          const jobIncome = energyTable[le] * 0.24 * prodTable[lp] * jobRate;
          const ownIncome = entrepTable[lt] * 0.24 * prodTable[lp] * ownRateBestRecommended;
          const total = passive + jobIncome + ownIncome;
          if (best === null || total > best.total) {
            best = { lc, le, lt, lp, cost: totalCost, passive, jobIncome, ownIncome, total };
          }
        }
      }
    }
  }

  const curLc = me.skills.companies.level;
  const curLe = me.skills.energy.level;
  const curLt = me.skills.entrepreneurship.level;
  const curLp = me.skills.production.level;
  // NON passiveIncome(curLc): "current" deve riflettere il vero stato
  // disabledAt, non un re-toggle ottimale assunto.
  const curPassive = companyRows.filter(r => r.active).reduce((s, r) => s + r.potentialNetPerDay, 0);
  const curJob = energyTable[curLe] * 0.24 * prodTable[curLp] * jobRate;
  const curOwn = entrepTable[curLt] * 0.24 * prodTable[curLp] * ownRateBest;
  const curTotal = curPassive + curJob + curOwn;

  return {
    companyRows, budget, searchBudget,
    totalWorkersAll, requiredMgmtLevel, managementCost,
    curLc, curLe, curLt, curLp, curTotal,
    best, bestOwnCompany,
  };
}
