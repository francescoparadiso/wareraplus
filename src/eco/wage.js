/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: paga di lavoro
   ------------------------------------------------------------------
   Port di `warera/wage.py`. Ricava la paga netta di lavoro attuale e
   sostenuta dell'utente. Lo storico transazioni serve SOLO a identificare
   CHI lo impiega ora (entry più recente in cui è lui a ricevere la paga) —
   il lordo vero si rilegge fresco dal roster live di quel datore, perché una
   transazione potrebbe riflettere una paga nel frattempo cambiata.

   Ritorna `null` se non si rileva alcun lavoro corrente: il chiamante tratta
   allora il reddito da lavoro come 0 oppure accetta un override manuale.
   ══════════════════════════════════════════════════════════════ */

import { ecoCall } from './api.js';

export async function deriveNetWage(userId) {
  let txs;
  try {
    const res = await ecoCall('transaction.getPaginatedTransactions', { userId, transactionType: 'wage', limit: 20 });
    txs = res?.items || [];
  } catch (_) {
    return null;
  }

  const employerIdsInOrder = [];
  for (const t of txs) {
    if (t.sellerId === userId && !employerIdsInOrder.includes(t.buyerId)) employerIdsInOrder.push(t.buyerId);
  }

  for (const employerId of employerIdsInOrder) {
    let roster;
    try {
      roster = await ecoCall('worker.getWorkers', { userId: employerId });
    } catch (_) { continue; }
    if (!roster) continue;

    let mine = null, myCompany = null;
    for (const grp of (roster.workersPerCompany || [])) {
      const match = (grp.workers || []).find(w => w.user === userId);
      if (match) { mine = match; myCompany = grp.company; break; }
    }
    if (!mine) continue;

    let co, region, country;
    try {
      co = await ecoCall('company.getById', { companyId: myCompany._id });
      region = await ecoCall('region.getById', { regionId: co.region });
      country = await ecoCall('country.getCountryById', { countryId: region.country });
    } catch (_) { continue; }
    if (!co || !region || !country) continue;

    const gross = mine.wage;
    const tax = country.taxes.income;
    const net = gross * (1 - tax / 100);

    let employerName = employerId;
    try {
      const lite = await ecoCall('user.getUserLite', { userId: employerId });
      employerName = lite?.username || employerId;
    } catch (_) {}

    return {
      net, gross, tax,
      employerName,
      companyName: myCompany.name,
      itemCode: myCompany.itemCode,
      regionName: region.name,
      countryName: country.name,
    };
  }
  return null;
}
