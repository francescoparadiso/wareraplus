/* ══════════════════════════════════════════════════════════════
   WarEra+ — Andamento delle battaglie, minuto per minuto
   ------------------------------------------------------------------
   La domanda da cui nasce: "QUANDO è entrata quella nazione, e la
   battaglia si è girata lì?". L'archivio battaglie sa chi ha fatto
   quanto danno IN TOTALE; non sa in che ordine.

   ⚠️ A RITROSO NON ESISTE, e non è una scelta (misurato il 2026-10-07):
     · battle.getBattles / getLiveBattleData danno solo la fotografia del
       round in corso — danno e punti dei due lati, ticksCount, nextTickAt;
     · round.getLastHits tiene gli ultimi 5 colpi per lato, e basta;
     · roundsHistory di una battaglia chiusa ha il risultato di ogni round
       (chi ha vinto, punti e danni finali): CHE si è girata, non QUANDO;
     · battleRanking.getRanking è il cumulato dell'INTERA battaglia per
       nazione (con `roundId` torna vuoto), e cambia solo al tick.
   Quindi la curva si ACCUMULA da quando questo modulo guarda, come i
   bonifici fra tesori e il danno orario. Una battaglia già aperta al
   deploy ha la sua prima lettura come FONDO (`baseAt`): tutto il danno
   fatto prima arriva lì in un colpo, e il client non deve leggerlo come
   "a quell'ora sono entrati in sessanta".

   ── Due serie, a due ritmi ─────────────────────────────────────
   1. `s` — UN CAMPIONE AL MINUTO per battaglia attiva:
        [t, round, ticksCount, dannoAtk, dannoDef, puntiAtk, puntiDef]
      Danni e punti sono quelli del ROUND corrente (si azzerano al cambio
      round). Costa una richiesta al minuto in tutto: battle.getBattles
      pagina da 100 e porta già `currentRound` di tutte (~25 attive).
      Si salva solo se qualcosa è cambiato: una battaglia ferma non cresce.
   2. `k` — IL DANNO PER NAZIONE A OGNI TICK:
        [t, round, ticksCount, {nazione: cumulato}atk, {...}def]
      Solo le nazioni il cui cumulato è CAMBIATO dal tick prima (delta di
      chiave, non di valore: il valore è il cumulato nuovo). Il client
      ricostruisce sommando in ordine. Due procedure per battaglia, e solo
      per quelle il cui `ticksCount` è avanzato dall'ultima lettura —
      ~metà a ogni minuto, tutte in UN batch. Le classifiche cambiano solo
      al tick (vedi memoria battle-tick-nexttickat), leggerle più spesso
      non darebbe niente.

   ⚠️ Se una classifica arriva identica alla precedente benché il tick
   sia avanzato, il gioco può non averla ancora riscritta (lo fa ~3 s
   dopo nextTickAt): si riprova al minuto dopo, UNA volta sola — una
   battaglia dove nessuno ha colpito resta legittimamente ferma.

   ── Chiusura ───────────────────────────────────────────────────
   Una battaglia che sparisce dall'elenco attivo NON si chiude subito:
   fetchActiveBattles, se prende un 429 a metà paginazione, rende una
   lista monca. Dopo MISS_TO_CLOSE giri di assenza si chiede battle.getById
   + le due classifiche finali, si scrive il file e la si toglie dalla
   memoria. File: cache/battle-timeline/<id>.json.gz, uno per battaglia.

   ── Quanto pesa ────────────────────────────────────────────────
   Stima: ~70 KB di JSON per una battaglia di 7-8 ore, ~15 KB compressi,
   ~50 battaglie al giorno → ~250 MB l'anno. NESSUNA potatura, per la
   stessa ragione dei PAVIMENTI di moneyTransfers/wealth/priceHistory:
   è un dato che non esiste in nessun altro posto.
   In memoria stanno SOLO le battaglie attive, salvate ogni giro in
   cache/battle-timeline-live.json per sopravvivere a un pm2 restart; il
   buco del riavvio resta un buco (il client lo disegna come tale).
   ══════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, 'cache', 'battle-timeline');
const LIVE_CACHE = 'battle-timeline-live';
const MISS_TO_CLOSE = 3;          // giri (minuti) di assenza prima di chiudere
const RANK_LIMIT = 100;           // 84 nazioni in una battaglia grossa: ci stanno

let deps = null;                  // { trpcBatch, readCache, writeCache, fetchActiveBattles }
const live = new Map();           // battleId -> record
let meta = { coverageFrom: null, lastPollAt: null, lastError: null, archived: 0 };
let _busy = false;

const _ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

function initBattleTimeline(d) {
  deps = d;
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const saved = deps.readCache(LIVE_CACHE, null);
  if (saved && Array.isArray(saved.battles)) {
    for (const rec of saved.battles) if (rec && rec.id) live.set(rec.id, rec);
    if (saved.meta) meta = { ...meta, ...saved.meta };
  }
  try { meta.archived = fs.readdirSync(DIR).filter(f => f.endsWith('.json.gz')).length; } catch (_) {}
}

function _newRecord(b, now) {
  const createdAt = _ts(b.createdAt);
  return {
    id: b._id,
    type: b.type || 'war',
    war: b.war || null,
    atk: b.attacker?.country || null,
    def: b.defender?.country || null,
    region: b.defender?.region || b.attacker?.region || null,
    createdAt,
    roundsToWin: b.roundsToWin || null,
    coverageFrom: now,
    // Aperta da più di 3 minuti quando la vediamo la prima volta: la prima
    // classifica contiene tutto il danno fatto prima di noi.
    baseAt: createdAt && now - createdAt > 3 * 60 * 1000 ? now : null,
    rounds: [],
    s: [],
    k: [],
    rk: { a: {}, d: {} },   // ultimo cumulato per nazione, per i delta
    rkKey: null,            // `${round}:${ticksCount}` dell'ultima classifica letta
    rkRetry: 0,
    miss: 0,
    endedAt: null,
    wonBy: null,
  };
}

function _sampleOf(b, now) {
  const cr = b.currentRound || {};
  return [
    now,
    cr.number || 0,
    cr.live?.ticksCount ?? null,
    cr.attacker?.damages || 0,
    cr.defender?.damages || 0,
    cr.attacker?.points || 0,
    cr.defender?.points || 0,
  ];
}

function _sameSample(a, b) {
  if (!a) return false;
  for (let i = 1; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function _rankMap(res) {
  const items = res?.items;
  if (!Array.isArray(items)) return null;
  const out = {};
  for (const it of items) if (it?.country) out[it.country] = it.value || 0;
  return { map: out, truncated: (res.itemCount || 0) > items.length };
}

function _sum(m) { let s = 0; for (const k in m) s += m[k]; return s; }

/** Registra una coppia di classifiche come tick. Ritorna false se uguale
 *  alla precedente (niente da registrare). */
function _pushTick(rec, t, round, tk, atk, def) {
  const dA = {}, dD = {};
  let changed = false;
  for (const [c, v] of Object.entries(atk.map)) if (rec.rk.a[c] !== v) { dA[c] = v; rec.rk.a[c] = v; changed = true; }
  for (const [c, v] of Object.entries(def.map)) if (rec.rk.d[c] !== v) { dD[c] = v; rec.rk.d[c] = v; changed = true; }
  if (atk.truncated || def.truncated) rec.truncated = true;
  if (!changed) return false;
  rec.k.push([t, round, tk, dA, dD]);
  return true;
}

function _rankCalls(battleId) {
  return [
    ['battleRanking.getRanking', { battleId, dataType: 'damage', type: 'country', side: 'attacker', limit: RANK_LIMIT }],
    ['battleRanking.getRanking', { battleId, dataType: 'damage', type: 'country', side: 'defender', limit: RANK_LIMIT }],
  ];
}

function _archive(rec) {
  const out = _public(rec);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out), 'utf-8'));
  const file = path.join(DIR, `${rec.id}.json.gz`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, gz);
  fs.renameSync(tmp, file);
  meta.archived++;
}

/** Chiusura: risultato finale + ultima classifica, poi su disco. */
async function _close(recs) {
  if (!recs.length) return;
  const calls = [];
  for (const rec of recs) calls.push(['battle.getById', { battleId: rec.id }], ..._rankCalls(rec.id));
  let res = [];
  try { res = await deps.trpcBatch(calls, { useWorker: true }); } catch (_) { res = []; }
  const now = Date.now();
  recs.forEach((rec, i) => {
    const b = res[i * 3];
    const atk = _rankMap(res[i * 3 + 1]);
    const def = _rankMap(res[i * 3 + 2]);
    if (b) {
      if (Array.isArray(b.roundsHistory)) rec.rounds = b.roundsHistory;
      rec.wonBy = b.wonBy || null;
      rec.endedAt = _ts(b.endedAt) || _ts(b.updatedAt) || now;
    } else {
      rec.endedAt = rec.s.length ? rec.s[rec.s.length - 1][0] : now;
    }
    if (atk && def) _pushTick(rec, rec.endedAt, rec.rounds.length || 0, null, atk, def);
    try { _archive(rec); live.delete(rec.id); }
    catch (err) { console.error(`[battle-timeline] archivio ${rec.id} fallito:`, err.message); }
  });
}

async function pollBattleTimeline() {
  if (!deps || _busy) return;
  _busy = true;
  try {
    const battles = await deps.fetchActiveBattles();
    const now = Date.now();
    if (!meta.coverageFrom) meta.coverageFrom = now;
    const seen = new Set();
    const wantRank = [];

    for (const b of battles) {
      if (!b?._id) continue;
      seen.add(b._id);
      let rec = live.get(b._id);
      if (!rec) { rec = _newRecord(b, now); live.set(b._id, rec); }
      rec.miss = 0;
      if (Array.isArray(b.roundsHistory)) rec.rounds = b.roundsHistory;

      const sample = _sampleOf(b, now);
      if (!_sameSample(rec.s[rec.s.length - 1], sample)) rec.s.push(sample);

      const key = `${sample[1]}:${sample[2]}`;
      if (key !== rec.rkKey) wantRank.push({ rec, key, round: sample[1], tk: sample[2] });
    }

    if (wantRank.length) {
      const calls = wantRank.flatMap(w => _rankCalls(w.rec.id));
      const res = await deps.trpcBatch(calls, { useWorker: true });
      wantRank.forEach((w, i) => {
        const atk = _rankMap(res[i * 2]);
        const def = _rankMap(res[i * 2 + 1]);
        if (!atk || !def) return;               // riprova al prossimo minuto
        const prevTot = _sum(w.rec.rk.a) + _sum(w.rec.rk.d);
        const tot = _sum(atk.map) + _sum(def.map);
        if (w.rec.rkKey !== null && tot === prevTot && w.rec.rkRetry < 1) {
          w.rec.rkRetry++;                       // classifica forse non ancora riscritta
          return;
        }
        w.rec.rkRetry = 0;
        w.rec.rkKey = w.key;
        _pushTick(w.rec, now, w.round, w.tk, atk, def);
      });
    }

    // Spariti dall'elenco: si chiudono solo dopo MISS_TO_CLOSE assenze.
    const toClose = [];
    for (const rec of live.values()) {
      if (seen.has(rec.id)) continue;
      rec.miss = (rec.miss || 0) + 1;
      if (rec.miss >= MISS_TO_CLOSE) toClose.push(rec);
    }
    await _close(toClose);

    meta.lastPollAt = now;
    meta.lastError = null;
    deps.writeCache(LIVE_CACHE, { meta, battles: [...live.values()] }, { compact: true });
  } catch (err) {
    meta.lastError = err.message;
    console.error('[battle-timeline] giro fallito:', err.message);
  } finally {
    _busy = false;
  }
}

/** Forma pubblica: senza i campi di lavoro (rk, rkKey, miss). */
function _public(rec) {
  return {
    battleId: rec.id,
    type: rec.type,
    war: rec.war,
    attacker: rec.atk,
    defender: rec.def,
    region: rec.region,
    createdAt: rec.createdAt,
    endedAt: rec.endedAt,
    wonBy: rec.wonBy,
    roundsToWin: rec.roundsToWin,
    rounds: rec.rounds,
    coverageFrom: rec.coverageFrom,
    baseAt: rec.baseAt,
    truncated: Boolean(rec.truncated),
    sampleFields: ['t', 'round', 'ticks', 'atkDamage', 'defDamage', 'atkPoints', 'defPoints'],
    s: rec.s,
    tickFields: ['t', 'round', 'ticks', 'atkByCountry', 'defByCountry'],
    k: rec.k,
  };
}

/** Una battaglia: dalla memoria se è viva, dal disco se è chiusa, null
 *  se questo archivio non l'ha mai vista. */
function readBattleTimeline(battleId) {
  if (!battleId || !/^[a-f0-9]{24}$/i.test(battleId)) return null;
  const rec = live.get(battleId);
  if (rec) return { live: true, ..._public(rec) };
  const file = path.join(DIR, `${battleId}.json.gz`);
  if (!fs.existsSync(file)) return null;
  try { return { live: false, ...JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8')) }; }
  catch (err) { console.error(`[battle-timeline] lettura ${battleId} fallita:`, err.message); return null; }
}

function statoBattleTimeline() {
  return {
    coverageFrom: meta.coverageFrom ? new Date(meta.coverageFrom).toISOString() : null,
    ultimoGiro: meta.lastPollAt ? new Date(meta.lastPollAt).toISOString() : null,
    attive: live.size,
    archiviate: meta.archived,
    errore: meta.lastError,
  };
}

module.exports = { initBattleTimeline, pollBattleTimeline, readBattleTimeline, statoBattleTimeline };
