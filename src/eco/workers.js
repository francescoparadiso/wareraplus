/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: ottimizzatore Lavoratori
   ------------------------------------------------------------------
   Port di `warera/workers.py`. Per ogni lavoratore assunto in una delle
   aziende possedute valuta se spostarlo in un'altra azienda dello stesso
   proprietario — MANTENENDO invariata la paga NETTA del lavoratore (si
   inverte la formula delle tasse per trovare il lordo equivalente nella
   regione di destinazione) — renderebbe di più al proprietario.

   Assegnazione greedy per guadagno potenziale decrescente, rispettando gli
   slot breakRoom liberi. Un lavoratore è "in movimento" solo se il guadagno
   supera MIN_GAIN_PER_DAY (guardia contro rumore in virgola mobile).
   ══════════════════════════════════════════════════════════════ */

import { ecoBatchByKey } from './api.js';
import { resolveRegionNames, resolveCountryNames } from './account.js';

const MIN_GAIN_PER_DAY = 0.001;

export async function computeWorkers(gd, ownedCompanies) {
  const companiesWithWorkers = ownedCompanies.filter(oc => oc.workerCount > 0);
  if (!companiesWithWorkers.length) return [];

  const regionIds = new Set(ownedCompanies.map(oc => oc.regionId));
  const regionById = await resolveRegionNames(regionIds);
  const countryIds = new Set(Object.values(regionById).filter(Boolean).map(r => r.country));
  const countryById = await resolveCountryNames(countryIds);

  function taxFor(oc) {
    const region = regionById[oc.regionId];
    const country = region ? countryById[region.country] : null;
    return country ? country.taxes.income : 0;
  }

  const rosters = await ecoBatchByKey('worker.getWorkers', Object.fromEntries(companiesWithWorkers.map(oc => [oc.id, { companyId: oc.id }])));
  const allWorkers = []; // [workerDict, owningCompany]
  for (const oc of companiesWithWorkers) {
    for (const w of (rosters[oc.id]?.workers || [])) allWorkers.push([w, oc]);
  }
  if (!allWorkers.length) return [];

  const workerUserById = await ecoBatchByKey('user.getUserLite', Object.fromEntries(allWorkers.map(([w]) => [w.user, { userId: w.user }])));

  const plans = [];
  for (const [w, curOc] of allWorkers) {
    const wu = workerUserById[w.user];
    if (!wu) continue;
    const energyTotal = wu.skills.energy.total;
    const prodTotal = wu.skills.production.total;
    const rawProd = 0.24 * energyTotal * prodTotal;

    const curTax = taxFor(curOc);
    const netWage = w.wage * (1 - curTax / 100);
    const curNpp = gd.getNetPerPoint(curOc.itemCode, curOc.bonus.total + w.fidelity);
    const curProfitPerDay = rawProd * (curNpp - w.wage);

    const candidates = [];
    for (const oc of ownedCompanies) {
      const tax = taxFor(oc);
      const requiredGross = tax < 100 ? netWage / (1 - tax / 100) : Infinity;
      const npp = gd.getNetPerPoint(oc.itemCode, oc.bonus.total + w.fidelity);
      const profitPerDay = rawProd * (npp - requiredGross);
      candidates.push({ company: oc, tax, requiredGross, breakEvenGross: npp, profitPerDay });
    }
    candidates.sort((a, b) => b.profitPerDay - a.profitPerDay);
    const uncappedGain = candidates[0].profitPerDay - curProfitPerDay;

    plans.push({
      worker: w, username: wu.username || w.user, currentCompany: curOc,
      energyTotal, prodTotal, netWage, curTax, curProfitPerDay,
      candidates, uncappedGain,
    });
  }

  const availableSlots = {};
  for (const oc of ownedCompanies) availableSlots[oc.id] = oc.maxWorkers - oc.workerCount;
  plans.sort((a, b) => b.uncappedGain - a.uncappedGain);

  const results = [];
  for (const plan of plans) {
    const curCandidate = plan.candidates.find(c => c.company.id === plan.currentCompany.id);

    let chosen = null;
    for (const c of plan.candidates) {
      if (c.company.id === plan.currentCompany.id || availableSlots[c.company.id] > 0) { chosen = c; break; }
    }
    if (chosen === null) chosen = curCandidate;

    let moving = chosen.company.id !== plan.currentCompany.id
      && (chosen.profitPerDay - plan.curProfitPerDay) > MIN_GAIN_PER_DAY;
    if (!moving) {
      chosen = curCandidate;
    } else {
      availableSlots[chosen.company.id] -= 1;
      availableSlots[plan.currentCompany.id] += 1;
    }

    const occupiedBefore = chosen.company.maxWorkers - availableSlots[chosen.company.id];
    results.push({ ...plan, chosen, occupiedBefore, moving });
  }
  return results;
}
