// muBattleDamage.js
//
// ══════════════════════════════════════════════════════════════
// WarEra+ — Danni delle unità militari giorno per giorno
// ------------------------------------------------------------------
// La domanda: «da quando sono nati i Praetorians, hanno fatto più danni
// loro o i Knights Hospitaller?». Richiesta dell'utente, il 2026-10-18,
// per il 1 vs 1 delle unità (src/mu/muCompare.js). Il gioco non la fa
// mai: un'unità porta il danno di SEMPRE (`muDamages`) e quello della
// settimana in corso (`muWeeklyDamages`), e nient'altro.
//
// ── PERCHÉ DALLE BATTAGLIE, E NON DAGLI SCATTI ───────────────────────
// Gli scatti c'erano già: snapshotDailyDamage salva ogni notte `muDamages`
// di tutte le unità (damage-history.json), e la differenza fra due notti è
// il danno del giorno, esatto. Ma partono dal 20 settembre 2026 (prima
// solo settimanali) e a ritroso non si possono rifare: «quanto aveva
// un'unità a luglio» non lo dice nessuna procedura.
//
// La classifica di una battaglia sì: `battleRanking.getRanking
// {type:'mu', dataType:'damage'}` dice quanto ha fatto ogni unità in QUELLA
// battaglia, anche per battaglie del 2025 (provato). E le battaglie le
// conosciamo tutte: l'archivio di battleArchive.js (90 giorni) più il
// vecchio bootstrap (bootstrap-raw-battles.json, dal 2 maggio 2025 al 14
// agosto 2026). Sommando battaglia per battaglia si ricostruisce lo
// storico di tutte le unità, da sempre.
//
// Verificato il 2026-10-18 contro gli scatti, dal 20 settembre al 18
// ottobre: Knights Hospitaller 655,9 milioni dalle battaglie contro 655,9
// dagli scatti, Praetorians 818,0 contro 825,5 (−0,9%: le battaglie ancora
// aperte ai due capi della finestra).
//
// ⚠️ IL GIORNO È QUELLO IN CUI LA BATTAGLIA FINISCE (UTC), non quello del
// colpo. Una battaglia dura anche un giorno intero, quindi giorno per
// giorno il numero è rumoroso (misurato: errore medio di 15 milioni al
// giorno sui Praetorians, che ne fanno 30) mentre la settimana e il
// cumulato tornano. Il client per questo disegna settimane e cumulato,
// MAI barre giornaliere — e lo dice.
//
// ── COME SI RIEMPIE ───────────────────────────────────────────────
//   · GIRO INCREMENTALE (tutto il giorno): le battaglie dell'archivio non
//     ancora contate. Una richiesta ogni 20 minuti, in regime.
//   · RECUPERO (solo di notte, 02:00-06:59 italiane, come i bootstrap di
//     battleArchive): la coda di tutte le battaglie note, dalla più
//     recente all'indietro, BACKFILL_PER_TICK alla volta. La coda nasce
//     dall'archivio più `mu-backfill-seed.json`, che scrive una volta sola
//     import/muBattleSeed.js leggendo il bootstrap da 255 MB — questo
//     processo non lo apre mai (954 MB di RAM in tutto il VPS). Senza
//     seme il recupero si ferma ai 90 giorni dell'archivio.
//
// Costo: le classifiche viaggiano in batch, e WarEra conta la richiesta e
// non le procedure dentro (misurato: 160 procedure al secondo senza un
// 429). Una battaglia sono due procedure, più una pagina per lato quando
// le unità sono più di 100 (~1 battaglia su 3, ma oltre la centesima ci
// sono briciole), a gruppi di 25 battaglie per richiesta. ~19.000 battaglie
// = ~1.000 richieste, 75 battaglie al minuto: le cinque ore di una notte.
//
// ── COPERTURA ─────────────────────────────────────────────────────
// `coverageFrom` è il primo giorno UTC di cui sono state contate TUTTE le
// battaglie. Il recupero scende all'indietro, quindi il giorno della
// prossima battaglia in coda è ancora a metà: si parte dal giorno dopo.
// Il client non disegna niente prima di quella data, e lo dichiara.
//
// NESSUNA potatura, come i PAVIMENTI di moneyTransfers e wealth: ~300
// unità attive al giorno, una decina di KB al giorno, pochi MB l'anno.
// ══════════════════════════════════════════════════════════════

let trpcBatch = null;
let readCache = null;
let readCacheShared = null;
let writeCache = null;

const STORE_FILE = 'mu-battle-damage';
const SEED_FILE = 'mu-backfill-seed';      // [[battleId, endMs], ...] da import/muBattleSeed.js
const ARCHIVE_FILE = 'battle-archive';     // scritto da battleArchive.js

const RANK_LIMIT = 100;                    // tetto dell'API (101 → "too_big")
const INCREMENTAL_MAX = 100;               // battaglie per giro incrementale
const BACKFILL_PER_TICK = 75;              // battaglie per minuto, di notte: ~19.000 in una notte
const MAX_PAGES = 5;                       // pagine per lato oltre la prima: oltre, briciole
const MAX_ATTEMPTS = 3;                    // poi la battaglia si salta e si conta in `failed`
const MAX_IDS = 10;                        // unità per richiesta a /mu-damage-history

const TZ = 'Europe/Rome';
const QUIET_HOURS = [2, 3, 4, 5, 6];

const DAY_MS = 24 * 60 * 60 * 1000;
const _day = (ms) => new Date(ms).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function _inQuietHours() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()));
  return QUIET_HOURS.includes(h);
}

function initMuBattleDamage(tools) {
  trpcBatch = tools.trpcBatch;
  readCache = tools.readCache;
  readCacheShared = tools.readCacheShared;
  writeCache = tools.writeCache;
}

// ---------------------------------------------------------------------------
// Archivio su disco
//   days:    { 'YYYY-MM-DD': { muId: danno } }   giorno UTC di fine battaglia
//   done:    [battleId]                           già contate (mai due volte)
//   queue:   [[battleId, endMs]]                  recupero, dalla più recente
//   queueBuilt, seeded, failed, oldestEnd, updatedAt
// ---------------------------------------------------------------------------

function _read() {
  const st = readCache(STORE_FILE, null) || {};
  return {
    v: 1,
    days: st.days || {},
    done: st.done || [],
    queue: st.queue || [],
    queueBuilt: !!st.queueBuilt,
    seeded: !!st.seeded,
    failed: st.failed || 0,
    oldestEnd: st.oldestEnd || null,
    updatedAt: st.updatedAt || null,
  };
}

function _write(st) {
  st.updatedAt = Date.now();
  writeCache(STORE_FILE, st, { compact: true });
}

/** A gruppi di RANK_CHUNK battaglie: 25 battaglie = 50 procedure in una GET,
 *  la stessa misura di battleArchive. Con 100 procedure l'indirizzo passa i
 *  15 KB e api6 non risponde più in JSON (provato). */
const RANK_CHUNK = 25;
async function _fetchBattles(battleIds) {
  const out = new Map();
  for (let i = 0; i < battleIds.length; i += RANK_CHUNK) {
    const part = await _fetchChunk(battleIds.slice(i, i + RANK_CHUNK));
    for (const [id, m] of part) out.set(id, m);
    if (i + RANK_CHUNK < battleIds.length) await sleep(400);
  }
  return out;
}

/** Una sola classifica per lato, con le pagine dopo la prima. Torna
 *  Map<muId, danno> o null se anche una sola richiesta è fallita: un
 *  totale monco spacciato per intero è peggio di un riprovo. */
async function _fetchChunk(battleIds) {
  const calls = [];
  for (const id of battleIds) {
    for (const side of ['attacker', 'defender']) {
      calls.push(['battleRanking.getRanking', { battleId: id, dataType: 'damage', type: 'mu', side, limit: RANK_LIMIT }]);
    }
  }
  const res = await trpcBatch(calls);

  const out = new Map(battleIds.map(id => [id, new Map()]));
  const broken = new Set();
  let more = [];
  calls.forEach(([, input], k) => {
    const r = res[k];
    if (!r || !Array.isArray(r.items)) { broken.add(input.battleId); return; }
    const m = out.get(input.battleId);
    for (const it of r.items) if (it?.mu) m.set(it.mu, (m.get(it.mu) || 0) + (Number(it.value) || 0));
    if (r.nextCursor) more.push({ input, cursor: r.nextCursor, page: 1 });
  });

  // Le pagine oltre la prima: un giro di batch per profondità.
  while (more.length) {
    const next = [];
    const pageCalls = more.map(p => ['battleRanking.getRanking', { ...p.input, cursor: p.cursor }]);
    const pres = await trpcBatch(pageCalls);
    more.forEach((p, k) => {
      const r = pres[k];
      if (!r || !Array.isArray(r.items)) { broken.add(p.input.battleId); return; }
      const m = out.get(p.input.battleId);
      for (const it of r.items) if (it?.mu) m.set(it.mu, (m.get(it.mu) || 0) + (Number(it.value) || 0));
      if (r.nextCursor && p.page < MAX_PAGES) next.push({ ...p, cursor: r.nextCursor, page: p.page + 1 });
    });
    more = next;
    if (more.length) await sleep(300);
  }

  for (const id of broken) out.set(id, null);
  return out;
}

/** Somma nel giorno di fine battaglia. */
function _fold(st, endMs, perMu) {
  const day = _day(endMs);
  const bucket = st.days[day] || (st.days[day] = {});
  for (const [mu, v] of perMu) if (v > 0) bucket[mu] = (bucket[mu] || 0) + Math.round(v);
}

/** Costruisce la coda del recupero UNA volta: archivio + seme, senza
 *  quello che il giro incrementale ha già contato, dalla più recente. */
function _buildQueue(st, doneSet) {
  const archive = readCache(ARCHIVE_FILE, { data: [] }).data || [];
  const seed = readCache(SEED_FILE, null);
  const byId = new Map();
  for (const r of archive) if (r?.i && r.e) byId.set(r.i, r.e);
  if (Array.isArray(seed)) for (const [id, e] of seed) if (id && e && !byId.has(id)) byId.set(id, e);
  st.queue = [...byId].filter(([id]) => !doneSet.has(id)).sort((a, b) => b[1] - a[1]);
  st.queueBuilt = true;
  st.seeded = Array.isArray(seed);
  const all = [...byId.values()];
  st.oldestEnd = all.length ? Math.min(...all) : null;
  console.log(`[mu-battle-damage] coda del recupero: ${st.queue.length} battaglie${st.seeded ? '' : ' (senza seme: solo i 90 giorni dell\'archivio)'}`);
}

/** Il seme arrivato DOPO che la coda era già stata costruita (deploy fatto
 *  prima di lanciare import/muBattleSeed.js): si aggiunge in coda quello
 *  che manca, una volta sola. */
function _maybeAddSeed(st, doneSet) {
  if (!st.queueBuilt || st.seeded) return;
  const seed = readCache(SEED_FILE, null);
  if (!Array.isArray(seed)) return;
  const queued = new Set(st.queue.map(([id]) => id));
  const add = seed.filter(([id, e]) => id && e && !doneSet.has(id) && !queued.has(id));
  st.queue = [...st.queue, ...add].sort((a, b) => b[1] - a[1]);
  st.seeded = true;
  for (const [, e] of add) if (!st.oldestEnd || e < st.oldestEnd) st.oldestEnd = e;
  console.log(`[mu-battle-damage] seme aggiunto alla coda: +${add.length} battaglie`);
}

/** Conta un gruppo di battaglie [[id, endMs]]. Torna quelle fallite. */
async function _process(st, doneSet, list) {
  if (!list.length) return [];
  const got = await _fetchBattles(list.map(([id]) => id));
  const failedOnes = [];
  for (const [id, e] of list) {
    const perMu = got.get(id);
    if (!perMu) { failedOnes.push([id, e]); continue; }
    _fold(st, e, perMu);
    doneSet.add(id);
    st.done.push(id);
  }
  return failedOnes;
}

// ---------------------------------------------------------------------------
// Giri
// ---------------------------------------------------------------------------

/** INCREMENTALE: le battaglie dell'archivio non ancora contate. */
async function pollMuBattleDamage() {
  if (!trpcBatch) return;
  try {
    const st = _read();
    const doneSet = new Set(st.done);
    // La coda PRIMA di cercare le nuove: al primo giro della vita del file
    // tutto l'archivio va al recupero notturno, non contato qui di giorno.
    if (!st.queueBuilt) _buildQueue(st, doneSet);
    _maybeAddSeed(st, doneSet);
    const queued = new Set(st.queue.map(([id]) => id));
    const archive = readCache(ARCHIVE_FILE, { data: [] }).data || [];
    // Solo quelle che il recupero non ha già in coda: altrimenti il giro
    // diurno farebbe il lavoro della notte, a rate pieno, in pieno giorno.
    const fresh = archive
      .filter(r => r?.i && r.e && !doneSet.has(r.i) && !queued.has(r.i))
      .sort((a, b) => b.e - a.e)
      .slice(0, INCREMENTAL_MAX)
      .map(r => [r.i, r.e]);
    if (!fresh.length) { _write(st); return; }
    const failed = await _process(st, doneSet, fresh);
    _write(st);
    console.log(`[mu-battle-damage] +${fresh.length - failed.length} battaglie${failed.length ? `, ${failed.length} da riprovare` : ''}`);
  } catch (err) {
    console.error('[mu-battle-damage] giro fallito:', err.message);
  }
}

/** RECUPERO: solo di notte, dalla coda. */
async function pollMuBattleDamageBackfill() {
  if (!trpcBatch || !_inQuietHours()) return;
  try {
    const st = _read();
    const doneSet = new Set(st.done);
    if (!st.queueBuilt) _buildQueue(st, doneSet);
    _maybeAddSeed(st, doneSet);
    if (!st.queue.length) return;

    const take = st.queue.slice(0, BACKFILL_PER_TICK).filter(([id]) => !doneSet.has(id));
    const rest = st.queue.slice(BACKFILL_PER_TICK);
    const failed = await _process(st, doneSet, take.map(([id, e]) => [id, e]));
    // Chi fallisce va in fondo con un tentativo in più; dopo MAX_ATTEMPTS si
    // lascia perdere e si conta. In fondo e non in testa: una battaglia che
    // non risponde non deve fermare la copertura di tutte le altre.
    const retry = [];
    for (const [id, e] of failed) {
      const prev = take.find(t => t[0] === id);
      const attempts = (prev?.[2] || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) st.failed++;
      else retry.push([id, e, attempts]);
    }
    st.queue = [...rest, ...retry];
    _write(st);
    if (!st.queue.length) console.log('[mu-battle-damage] recupero finito');
  } catch (err) {
    console.error('[mu-battle-damage] recupero fallito:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

/** Primo giorno UTC completo. Il recupero scende dalla più recente, quindi
 *  è completo tutto ciò che sta DOPO il giorno della prossima battaglia in
 *  coda (i ritentativi in fondo alla coda non contano: sono poche e vengono
 *  dichiarate in `failed`). */
function _coverageFrom(st) {
  const firstTry = st.queue.find(q => !q[2]);
  if (firstTry) return _day(firstTry[1] + DAY_MS);
  // Coda vuota: tutto contato. Ma il giorno della battaglia più vecchia è
  // a metà anche lui (l'archivio la taglia a un'ora, non a mezzanotte).
  if (st.oldestEnd) return _day(st.oldestEnd + DAY_MS);
  return null;
}

/** /mu-damage-history?ids=a,b → { coverageFrom, data: { id: [[giorno, danno]] } } */
function readMuDamageHistory(ids) {
  const st = readCacheShared(STORE_FILE, null) || { days: {}, queue: [] };
  const want = [...new Set(ids)].slice(0, MAX_IDS);
  const data = Object.fromEntries(want.map(id => [id, []]));
  for (const day of Object.keys(st.days || {}).sort()) {
    const bucket = st.days[day];
    for (const id of want) if (bucket[id]) data[id].push([day, bucket[id]]);
  }
  return {
    coverageFrom: _coverageFrom({ queue: st.queue || [], oldestEnd: st.oldestEnd }),
    dayBasis: 'battle-end-utc',
    updatedAt: st.updatedAt || null,
    backfill: { pending: (st.queue || []).length, seeded: !!st.seeded, failed: st.failed || 0 },
    data,
  };
}

function muBattleDamageStatus() {
  const st = readCacheShared(STORE_FILE, null);
  if (!st) return { available: false };
  return {
    available: true,
    coverageFrom: _coverageFrom({ queue: st.queue || [], oldestEnd: st.oldestEnd }),
    battles: (st.done || []).length,
    days: Object.keys(st.days || {}).length,
    pending: (st.queue || []).length,
    seeded: !!st.seeded,
    failed: st.failed || 0,
    updatedAt: st.updatedAt || null,
  };
}

module.exports = {
  initMuBattleDamage,
  pollMuBattleDamage,
  pollMuBattleDamageBackfill,
  readMuDamageHistory,
  muBattleDamageStatus,
  MU_DAMAGE_MAX_IDS: MAX_IDS,
  MU_DAMAGE_TZ: TZ,
};
