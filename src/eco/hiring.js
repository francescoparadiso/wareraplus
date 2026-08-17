/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: opportunità di assunzione
   ------------------------------------------------------------------
   NON esisteva nel bot originale (che ottimizzava solo i lavoratori GIÀ
   assunti). Richiesta esplicita: suggerire potenziali dipendenti a chi ha
   aziende con slot liberi, con la paga da offrire e quanto ci guadagna.

   WarEra non espone una "bacheca lavoratori disponibili" via API, quindi la
   stima usa un LAVORATORE DI RIFERIMENTO (le statistiche energia/produzione
   del giocatore analizzato — un "uno come te") per dare numeri concreti; la
   produzione grezza è dichiarata così l'utente sa su cosa si basa la stima.

   Economia (BOT_KNOWLEDGE.md §5): un nuovo assunto ha fedeltà 0.
     net_per_point   = oro/punto dell'azienda al suo bonus% (fedeltà 0)
     paga_pareggio   = net_per_point (sopra questa il proprietario ci rimette)
     paga_suggerita  = 80% del pareggio (il proprietario tiene ~20% di margine)
     guadagno_prop   = produzione_grezza × (net_per_point − paga_suggerita)
     netto_lavorat.  = produzione_grezza × paga_suggerita × (1 − tassa%/100)
   Tassa: reddito del paese che possiede la regione (endpoint pubblici).
   ══════════════════════════════════════════════════════════════ */

import { resolveRegionNames, resolveCountryNames } from './account.js';

const SUGGESTED_WAGE_FRACTION = 0.8; // paga suggerita = 80% del pareggio

export async function computeHiring(gd, ownedCompanies, me) {
  const withFreeSlots = ownedCompanies.filter(oc => (oc.maxWorkers - oc.workerCount) > 0 && !oc.disabled);
  const refEnergy = me?.skills?.energy?.total || 0;
  const refProd = me?.skills?.production?.total || 0;
  const rawProd = 0.24 * refEnergy * refProd;

  if (!withFreeSlots.length) return { rows: [], refEnergy, refProd, rawProd };

  const regionById = await resolveRegionNames(new Set(withFreeSlots.map(oc => oc.regionId)));
  const countryById = await resolveCountryNames(new Set(Object.values(regionById).filter(Boolean).map(r => r.country)));

  const rows = [];
  for (const oc of withFreeSlots) {
    const region = regionById[oc.regionId];
    const country = region ? countryById[region.country] : null;
    const tax = country ? country.taxes.income : 0;
    const netPerPoint = gd.getNetPerPoint(oc.itemCode, oc.bonus.total); // fedeltà 0
    const suggestedWage = netPerPoint * SUGGESTED_WAGE_FRACTION;
    const ownerGainPerDay = rawProd * (netPerPoint - suggestedWage);
    const workerTakeHomePerDay = rawProd * suggestedWage * (1 - tax / 100);
    rows.push({
      company: oc,
      freeSlots: oc.maxWorkers - oc.workerCount,
      breakEvenGross: netPerPoint,
      suggestedWage,
      ownerGainPerDay,
      workerTakeHomePerDay,
      tax,
      regionName: region?.name || null,
      countryName: country?.name || null,
    });
  }
  // Le opportunità migliori (più guadagno per il proprietario) in cima.
  rows.sort((a, b) => b.ownerGainPerDay - a.ownerGainPerDay);
  return { rows, refEnergy, refProd, rawProd };
}
