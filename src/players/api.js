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

import { API_BASE_URL } from '../diplomacy/config.js';
import { trpcBatchManual } from '../shared/trpcClient.js';
import { fetchPlayerWealthViaCache, fetchUsersLiteViaCache } from '../diplomacy/cacheClient.js';
import { getBattleArchive, getLiveBattles } from '../battles/api.js';

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
