/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: fetch account (v0.27)
   ------------------------------------------------------------------
   Nato come port di `warera/account.py`; riscritto per la v0.27, quando
   il gioco ha tolto il mercato del lavoro e messo i DIPENDENTI (NPC) al
   posto dei lavoratori.

   ── COSA SI VEDE, E COSA NO ──────────────────────────────────────────
   I dipendenti di un giocatore NON si vedono da fuori:
   `employee.getCompanyRoster`, `employee.getById`, `employeeEvent.*`
   rispondono 403 "API tokens cannot access this endpoint" anche con una
   chiave valida (sondato su apidev il 2026-10-23) — vanno solo con la
   sessione di gioco. Niente statistiche, tratti, felicità né attrezzi.

   Si vede invece, per ogni azienda, quello che è SUCCESSO:
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

/**
 * @returns {Promise<Array<{
 *   id, name, itemCode, regionId, regionName, countryId, countryName,
 *   incomeTax, engineLevel, engineDailyProd, breakRoomLevel, maxEmployees,
 *   disabled, isFull, bonus, stats }>>}
 *   `stats` è l'array di work.getStatsByCompany, o `null` se non è arrivato.
 */
export async function loadOwnedCompanies(gd, userId) {
  const idsResult = await ecoCall('company.getCompanies', { userId, perPage: 20 });
  const companyIds = idsResult?.items || [];
  if (!companyIds.length) return [];

  const [coById, bonusById, statsById] = await Promise.all([
    ecoBatchByKey('company.getById', byId(companyIds, 'companyId')),
    ecoBatchByKey('company.getProductionBonus', byId(companyIds, 'companyId')),
    ecoBatchByKey('work.getStatsByCompany', byId(companyIds, 'companyId')),
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
    });
  }
  return out;
}
