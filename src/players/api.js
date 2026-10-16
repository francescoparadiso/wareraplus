/* ══════════════════════════════════════════════════════════════
   WarEra+ — Giocatori: dati
   ------------------------------------------------------------------
   Tutto quello che serve alla sezione Giocatori, e da dove viene. Quasi
   tutto è PUBBLICO su api6 (nessuna chiave, nessun consumo del Worker):

   · PROFILO — `user.getUserLite`: nazione, unità, livello, abilità,
     pillola, e soprattutto `rankings` con valore E posizione mondiale di
     danni settimanali, danni totali, ricchezza, taglia, esperienza…
     Una richiesta, ~5 KB.
   · EQUIPAGGIAMENTO — `inventory.fetchCurrentEquipment {userId}`.
   · CLASSIFICHE — `ranking.getRanking {rankingType}` risponde con la
     ladder INTERA (~13-16.000 righe, ~470 KB compressi): si scarica solo
     quando la si apre, una per tipo e per sessione, in MEMORIA. Le righe
     non hanno il nome del giocatore: i nomi dei primi 50 li dà
     /users-lite del cache-server, con ripiego su getUserLite a gruppi.
   · RICCHEZZA NEL TEMPO — /player-wealth del cache-server, la stessa
     della scheda Ricchezza di Economia. Senza server non c'è (lo storico
     non esiste da nessun'altra parte).

   ── ⚠️ LE BATTAGLIE DI UN GIOCATORE ────────────────────────────────
   Il gioco NON ha una procedura "battaglie di questo giocatore", e nessuna
   transazione porta l'id della battaglia (il bottino no, la taglia nemmeno:
   verificato il 2026-10-14). C'è però `battleLootSummary.getByBattleAndUser
   {battleId, userId}`: il riepilogo di UN giocatore in UNA battaglia —
   colpi, danno, taglia e paga dei contratti incassate, casse — ~750 byte,
   e 404 se lì non ha combattuto. Quindi si chiede, a gruppi di 25 in un
   batch, per le battaglie candidate: quelle IN CORSO più le concluse degli
   ultimi N giorni dall'archivio (~50 al giorno). Di base 3 giorni ≈ 170
   battaglie ≈ 7 richieste; "cerca più indietro" allarga a richiesta.
   Le concluse non cambiano più: il risultato resta in memoria per la
   sessione e riaprire lo stesso giocatore costa zero. Le in corso si
   richiedono dopo 2 minuti.
   Il riepilogo NON dice per quale schieramento ha combattuto: la vista
   mostra le due nazioni della battaglia e non indovina.
   ══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { trpcBatchManual, trpcCall } from '../shared/trpcClient.js';
import { fetchPlayerWealthViaCache, fetchUsersLiteViaCache } from '../diplomacy/cacheClient.js';
import { getBattleArchive, getLiveBattles } from '../battles/api.js';
import { fetchCountryCitizens } from '../nations/api.js';

export const LEADERBOARDS = ['weeklyUserDamages', 'userDamages', 'userWealth', 'userBounty'];

const MAX_CANDIDATES = 8;
const SUMMARY_CHUNK = 25;
const LIVE_TTL_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/* ── Profilo ──────────────────────────────────────────────────── */

const _lite = new Map();   // userId -> { at, data }
const LITE_TTL_MS = 2 * 60 * 1000;

export async function fetchPlayer(userId) {
  const hit = _lite.get(userId);
  if (hit && Date.now() - hit.at < LITE_TTL_MS) return hit.data;
  const [data] = await trpcBatchManual([['user.getUserLite', { userId }]]);
  if (data) _lite.set(userId, { at: Date.now(), data });
  return data || null;
}

/** Ricerca per nome: due richieste, mai una per candidato. */
export async function searchPlayers(text) {
  const q = String(text || '').trim();
  if (q.length < 2) return [];
  const [ids] = await trpcBatchManual([['search.searchUsers', { searchText: q }]]);
  const list = (Array.isArray(ids) ? ids : []).slice(0, MAX_CANDIDATES);
  if (!list.length) return [];
  const lite = await trpcBatchManual(list.map(id => ['user.getUserLite', { userId: id }]));
  return list.map((id, i) => ({ id, lite: lite[i] })).filter(c => c.lite);
}

export async function fetchEquipment(userId) {
  try {
    const [eq] = await trpcBatchManual([['inventory.fetchCurrentEquipment', { userId }]]);
    return eq || null;
  } catch (_) {
    return null;
  }
}

export function fetchWealthHistory(userId) {
  return fetchPlayerWealthViaCache(userId).catch(() => null);
}

/* ── Classifiche mondiali ─────────────────────────────────────── */

const _boards = new Map();  // rankingType -> Promise<rows>

/** Righe compatte { u, c, m, v, r } — userId, nazione, unità, valore,
 *  posizione — dell'intera classifica. Una richiesta per tipo e sessione. */
export function fetchLeaderboard(type) {
  if (_boards.has(type)) return _boards.get(type);
  const p = trpcBatchManual([['ranking.getRanking', { rankingType: type }]])
    .then(([res]) => {
      const items = Array.isArray(res) ? res : res?.items;
      if (!Array.isArray(items)) throw new Error('forma inattesa');
      return items.map(x => ({ u: x.user, c: x.country, m: x.mu, v: Number(x.value) || 0, r: x.rank }));
    })
    .catch(err => { _boards.delete(type); throw err; });
  _boards.set(type, p);
  return p;
}

const _names = new Map();   // userId -> { username, avatarUrl }

/** Nome e avatar di pochi giocatori: /users-lite del cache-server, e per
 *  chi manca getUserLite a gruppi da 30 (oltre i ~35 il GET va in 414). */
export async function fetchNames(userIds) {
  const want = [...new Set(userIds)].filter(id => id && !_names.has(id));
  if (want.length) {
    try {
      const got = await fetchUsersLiteViaCache(want);
      got.forEach((v, id) => _names.set(id, v));
    } catch (_) { /* si ricade sotto */ }
    const still = want.filter(id => !_names.has(id));
    for (let i = 0; i < still.length; i += 30) {
      const chunk = still.slice(i, i + 30);
      try {
        const res = await trpcBatchManual(chunk.map(id => ['user.getUserLite', { userId: id }]));
        chunk.forEach((id, k) => { if (res[k]) _names.set(id, { username: res[k].username, avatarUrl: res[k].avatarUrl }); });
      } catch (_) { break; }
    }
  }
  return new Map(userIds.map(id => [id, _names.get(id) || null]));
}

/* ── Le battaglie di un giocatore ─────────────────────────────── */

const _summ = new Map();    // `${userId}:${battleId}` -> { at, live, data|null }

/** Un batch di riepiloghi. Fetch propria e non trpcBatchManual: qui il 404
 *  è la risposta NORMALE ("non ha combattuto lì") e arriva per la maggior
 *  parte delle voci — l'helper lo loggherebbe come errore, centinaia di
 *  volte, e con un batch tutto 404 lo tratterebbe da guasto. */
async function _summaryBatch(userId, battleIds, attempt = 0) {
  const path = battleIds.map(() => 'battleLootSummary.getByBattleAndUser').join(',');
  const input = {};
  battleIds.forEach((b, i) => { input[i] = { battleId: b, userId }; });
  const res = await fetch(`${API_BASE_URL}/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`);
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    return _summaryBatch(userId, battleIds, attempt + 1);
  }
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) throw new Error(`HTTP ${res.status}`);
  return body.map(item => {
    const d = item?.result?.data;
    if (!d) return null;
    return {
      hits: d.hits || 0,
      dmg: d.totalDmg || 0,
      bounty: d.totalMoneyFromBounty || 0,
      contract: d.totalMoneyFromContract || 0,
      cases: (d.case1Count || 0) + (d.case2Count || 0),
      // Gli oggetti caduti, con la posizione in classifica che li ha fatti
      // cadere. Arrivano già in questa risposta: tenerli non costa niente.
      loot: (Array.isArray(d.poolLoot) ? d.poolLoot : []).map(l => ({
        code: l.item?.code || null,
        skills: l.item?.skills || null,
        rank: l.rank ?? null,
        pool: l.pool || null,
      })).filter(l => l.code),
    };
  });
}

/**
 * Battaglie in cui `userId` ha combattuto: quelle in corso più le concluse
 * degli ultimi `days` giorni.
 * @returns {Promise<{ rows: {battle:object, s:object}[], checked:number,
 *   failed:number, days:number, archiveDegraded:boolean }>}
 */
export async function fetchPlayerBattles(userId, { days = 3 } = {}) {
  const [live, archive] = await Promise.all([
    getLiveBattles().catch(() => []),
    getBattleArchive().catch(() => null),
  ]);
  const since = Date.now() - days * DAY_MS;
  const liveList = (Array.isArray(live) ? live : live?.battles || []);
  // Nessun danno = nessuno ha combattuto: inutile chiederlo.
  const hasDamage = b => (b.defender?.damages || 0) + (b.attacker?.damages || 0) > 0;
  const candidates = [
    ...liveList.filter(hasDamage).map(b => ({ ...b, live: true })),
    ...(archive?.battles || []).filter(b => b.endedAt >= since && hasDamage(b)),
  ];
  const seen = new Set();
  const list = candidates.filter(b => !seen.has(b.id) && seen.add(b.id));

  const now = Date.now();
  const todo = list.filter(b => {
    const hit = _summ.get(`${userId}:${b.id}`);
    return !hit || (hit.live && now - hit.at > LIVE_TTL_MS);
  });

  let failed = 0;
  // In serie e non in parallelo: sono richieste senza chiave (100/min per
  // IP sul gioco), e sette insieme sarebbero il modo più rapido di
  // prendersi un 429 a metà.
  for (let i = 0; i < todo.length; i += SUMMARY_CHUNK) {
    const chunk = todo.slice(i, i + SUMMARY_CHUNK);
    try {
      const out = await _summaryBatch(userId, chunk.map(b => b.id));
      chunk.forEach((b, k) => _summ.set(`${userId}:${b.id}`, { at: Date.now(), live: !!b.live, data: out[k] }));
    } catch (err) {
      console.warn('WarEra+ giocatori: riepiloghi battaglia non arrivati:', err.message);
      failed += chunk.length;
    }
  }

  const rows = [];
  for (const b of list) {
    const s = _summ.get(`${userId}:${b.id}`)?.data;
    if (s && (s.dmg > 0 || s.hits > 0)) rows.push({ battle: b, s });
  }
  // In corso prima (`live` è true o assente: !! se no true - undefined = NaN
  // e l'ordinamento salta), poi le concluse dalla più recente.
  rows.sort((a, b) => (!!b.battle.live - !!a.battle.live) || ((b.battle.endedAt || 0) - (a.battle.endedAt || 0)));
  return { rows, checked: list.length, failed, days, archiveDegraded: !!archive?.degraded };
}

/* ── Aziende e lavoro ─────────────────────────────────────────── */

/** Le aziende del giocatore: `company.getCompanies {userId}` dà solo gli
 *  id, `company.getById` il resto (prodotto, regione, dipendenti,
 *  magazzino, valore stimato, potenziamenti). Pubbliche, due giri. */
export async function fetchCompanies(userId) {
  const [list] = await trpcBatchManual([['company.getCompanies', { userId, perPage: 50 }]]);
  const ids = (list?.items || []).map(x => (typeof x === 'string' ? x : x?._id)).filter(Boolean);
  const out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const res = await trpcBatchManual(chunk.map(id => ['company.getById', { companyId: id }]));
    res.forEach((c, k) => {
      if (!c) return;
      out.push({
        id: chunk[k], name: c.name || '', itemCode: c.itemCode, region: c.region,
        workers: c.workerCount || 0, stock: c.production || 0, value: c.estimatedValue || 0,
        upgrades: c.activeUpgradeLevels || {}, disabled: !!c.disabledAt,
      });
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** 31 giorni di lavoro DELLE SUE AZIENDE, giorno per giorno:
 *  `employeeProd` (prodotto dai dipendenti), `selfWork` (da lui),
 *  `automatedEngine` (dal motore), `total` la somma — in punti
 *  produzione — e `wage`, i salari che le sue aziende hanno PAGATO.
 *  ⚠️ Verificato il 2026-10-14: è la somma esatta di work.getStatsByCompany
 *  sulle sue aziende, quindi lo stipendio che incassa lavorando per altri
 *  qui NON c'è. Procedura con chiave: passa dal proxy (useWorker). */
export async function fetchWorkStats(userId) {
  try {
    const rows = await trpcCall('work.getStatsByUserId', { userId }, { useWorker: true });
    return Array.isArray(rows) ? rows : null;
  } catch (err) {
    console.warn('WarEra+ giocatori: statistiche di lavoro non disponibili:', err.message);
    return null;
  }
}

/* ── Politica ─────────────────────────────────────────────────── */

const GOV_ROLES = ['president', 'vicePresident', 'minOfDefense', 'minOfForeignAffairs', 'minOfEconomy'];

/**
 * Partito, cariche di adesso e storia politica di un giocatore.
 * · partito: getUserById (getUserLite non lo porta) + party.getById;
 * · cariche: government.getByCountryId della SUA nazione;
 * · storia: /political-history del cache-server per la sua nazione —
 *   presidenze (complete dal lancio), governi e cambi di partito (che
 *   ACCUMULANO dal deploy: `coverageFrom` dice da quando). Senza server
 *   la storia manca e lo si dice; partito e cariche ci sono lo stesso.
 *   ⚠️ È la storia della nazione di ADESSO: chi ha cambiato cittadinanza
 *   ha avuto la sua carriera di prima altrove, e qui non compare.
 */
export async function fetchPolitics(userId, countryId) {
  const [full, gov] = await trpcBatchManual([
    ['user.getUserById', { userId }],
    ['government.getByCountryId', { countryId }],
  ]);
  const partyId = full?.party || null;
  let party = null;
  if (partyId) {
    const [p] = await trpcBatchManual([['party.getById', { partyId }]]);
    if (p) {
      party = {
        id: partyId, name: p.name || '', avatarUrl: p.avatarUrl || null,
        members: Array.isArray(p.members) ? p.members.length : null,
        role: p.leader === userId ? 'leader' : (p.councilMembers || []).includes(userId) ? 'council' : 'member',
      };
    }
  }
  const roles = [];
  if (gov) {
    for (const r of GOV_ROLES) if (gov[r] === userId) roles.push(r);
    if ((gov.congressMembers || []).includes(userId)) roles.push('congress');
  }

  let history = null;
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/political-history?countryId=${encodeURIComponent(countryId)}&days=180`,
      { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const h = await res.json();
      // Governi: una riga quando qualcosa cambia, quindi una carica dura
      // dalla riga in cui compare fino alla prima in cui non c'è più.
      const govRows = h.governments?.rows || [];
      const terms = [];
      for (let ri = 0; ri < GOV_ROLES.length; ri++) {
        let open = null;
        govRows.forEach((g, i) => {
          const holds = g.r?.[ri] === userId;
          if (holds && !open) open = { role: GOV_ROLES[ri], from: g.a, to: null };
          if (!holds && open) { open.to = g.a; terms.push(open); open = null; }
          if (holds && i === govRows.length - 1) terms.push(open);
        });
      }
      history = {
        presidencies: (h.presidents || []).filter(p => p.u === userId)
          .map(p => ({ from: p.from, to: p.to, share: p.share, party: h.partyNames?.[p.p] || null }))
          .sort((a, b) => b.from - a.from),
        terms: terms.sort((a, b) => b.from - a.from),
        govFrom: h.governments?.coverageFrom || null,
        switches: (h.switches?.rows || []).filter(r => r.u === userId)
          .map(r => ({ at: r.a, from: h.partyNames?.[r.f] || null, to: h.partyNames?.[r.t] || null, fromId: r.f, toId: r.t }))
          .sort((a, b) => b.at - a.at),
        switchFrom: h.switches?.coverageFrom || null,
      };
    }
  } catch (_) { /* resta null: la vista dice che lo storico non c'è */ }

  return { party, roles, presidentOf: full?.infos?.presidentOf || null, history };
}

/* ── Posizione nella sua nazione ──────────────────────────────── */

const NAT_KEYS = { weeklyUserDamages: 'wk', userDamages: 'dmg', userWealth: 'w', userBounty: 'b' };

/**
 * Posizione del giocatore fra i cittadini della sua nazione, per le stesse
 * quattro misure delle classifiche mondiali. L'elenco viene da
 * /country-citizens (lo stesso di Statistiche nazioni, stessa cache di
 * sessione): il valore del giocatore è quello DI ADESSO (getUserLite),
 * quelli degli altri sono dell'ultimo giro del server, qualche ora fa al
 * massimo. Ritorna { n, partial, ranks: { rankingType: posizione } }.
 */
export async function fetchNationRanks(lite) {
  if (!lite?.country) return null;
  const data = await fetchCountryCitizens(lite.country).catch(() => null);
  const rows = (data?.rows || []).filter(r => r.id !== lite._id);
  if (!rows.length) return null;
  const ranks = {};
  for (const [type, key] of Object.entries(NAT_KEYS)) {
    const mine = Number(lite.rankings?.[type]?.value);
    if (!Number.isFinite(mine)) continue;
    ranks[type] = 1 + rows.filter(r => (Number(r[key]) || 0) > mine).length;
  }
  return { n: rows.length + 1, partial: !!data.partial, ranks };
}
