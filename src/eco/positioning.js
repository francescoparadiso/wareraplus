/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: ottimizzatore Posizione
   ------------------------------------------------------------------
   Port di `warera/positioning.py`. Per ogni azienda posseduta guarda la
   miglior regione consigliata per il suo item e calcola guadagno/giorno e
   giorni di rientro del costo di trasloco (5 × prezzo concrete).

   Segnale: VERDE se rientro ≤ GREEN_DAYS (3); GIALLO se c'è un guadagno reale
   ma rientro più lento (nessun tetto); BIANCO/nessuno se non c'è regione
   migliore o è già la migliore. Vale anche per le aziende disabilitate:
   riattivarle e traslocarle è lo stesso viaggio.
   ══════════════════════════════════════════════════════════════ */

import { ecoBatchByKey } from './api.js';
import { resolveRegionNames, resolveCountryNames } from './account.js';

// Soglia piatta per il segnale verde (deliberatamente semplice — nessun
// blended-payback anchor-vs-deposit, vedi BOT_KNOWLEDGE.md). Importata da
// skills.js così le due funzioni non possono mai discordare sulla soglia.
export const GREEN_DAYS = 3;

export async function computeCompanies(gd, ownedCompanies) {
  if (!ownedCompanies.length) return [];

  const distinctItems = [...new Set(ownedCompanies.map(oc => oc.itemCode))].sort();
  const recsByItem = await ecoBatchByKey(
    'company.getRecommendedRegionIdsByItemCode',
    Object.fromEntries(distinctItems.map(item => [item, { itemCode: item }])),
  );

  const moveCostGold = 5 * gd.prices.concrete;

  const regionIdsNeeded = new Set(ownedCompanies.map(oc => oc.regionId));
  const prelim = [];
  for (const oc of ownedCompanies) {
    const candidates = recsByItem[oc.itemCode] || [];
    const target = candidates[0] || null;
    if (target) regionIdsNeeded.add(target.regionId);
    prelim.push([oc, target]);
  }

  const regionById = await resolveRegionNames(regionIdsNeeded);
  const countryIdsNeeded = new Set(Object.values(regionById).filter(Boolean).map(r => r.country));
  const countryById = await resolveCountryNames(countryIdsNeeded);

  function regionLabel(regionId) {
    const region = regionById[regionId];
    if (!region) return regionId;
    const country = countryById[region.country];
    const countryName = country ? country.name : '?';
    return `${region.name}, ${countryName}`;
  }

  const results = [];
  for (const [oc, target] of prelim) {
    const curNetPerPoint = gd.getNetPerPoint(oc.itemCode, oc.bonus.total);
    const curDaily = oc.dailyProd * curNetPerPoint;

    if (target === null) {
      results.push({
        company: oc, currentLabel: regionLabel(oc.regionId),
        currentBonus: oc.bonus.total, currentDaily: curDaily,
        alreadyBest: true, noRecommendation: true,
      });
      continue;
    }

    const alreadyBest = target.regionId === oc.regionId;
    const targetNetPerPoint = gd.getNetPerPoint(oc.itemCode, target.bonus);
    const targetDaily = oc.dailyProd * targetNetPerPoint;
    const gain = targetDaily - curDaily;
    const payback = gain > 0.0001 ? (moveCostGold / gain) : null;

    let signal;
    if (payback === null) signal = null;
    else if (payback <= GREEN_DAYS) signal = 'green';
    else signal = 'yellow';

    const depositPct = (target.depositBonus || 0) + (target.ethicDepositBonus || 0);
    const depositEndAt = depositPct > 0 ? (target.depositEndAt || null) : null;

    results.push({
      company: oc,
      currentLabel: regionLabel(oc.regionId), currentBonus: oc.bonus.total, currentDaily: curDaily,
      alreadyBest, noRecommendation: false,
      targetLabel: !alreadyBest ? regionLabel(target.regionId) : null,
      targetBonus: target.bonus, targetDaily,
      gainPerDay: gain, moveCostGold, paybackDays: payback, signal,
      depositPct, depositEndAt,
    });
  }
  return results;
}
