/* ══════════════════════════════════════════════════════════════════════
   WarEra+ — Classifiche INTERE, a pagine
   ----------------------------------------------------------------------
   Fino alla v0.28.2 `ranking.getRanking {rankingType}` rispondeva con la
   ladder intera in un colpo (17-21.000 righe), e quattro pezzi del tool ci
   contavano: la fotografia notturna della ricchezza (plusApi/wealth.js), il
   giro della ricchezza per categoria (playerParts.js), la forza delle
   squadre nei tornei (tournament.js) e le classifiche di Giocatori. Dalla
   v0.28.3 (2026-11-16) la stessa procedura risponde con i PRIMI 100 e basta
   (`count` dice ancora 21.319): niente errore, solo una classifica corta che
   sembra buona. Il client del gioco è passato a:

     ranking.getRankingPage { rankingType, limit ≤ 50, cursor? }
       → { items, nextCursor, ranking: { count, zeroRank?, tierValues… } }

   `limit` oltre 50 è un errore di validazione, `page` non esiste (si
   ignora): si sfoglia col cursore, una pagina alla volta. La ricchezza sono
   ~430 pagine, il danno settimanale ~290. Qui si fanno con la CHIAVE
   (useWorker → api2, 500/min) a passo lento, una classifica per volta, e il
   risultato resta in memoria: chi lo chiede dopo non paga niente.

   Ci passano tournament.js e playerParts.js (via getFullRanking) e la rotta
   /ranking-full, che è quello che legge il browser al posto delle 300-400
   richieste che dovrebbe fare da solo.

   ⚠️ Quando una pagina non arriva dopo i tentativi la classifica NON si
   sostituisce: resta quella di prima (o nessuna), mai una a metà spacciata
   per intera. `complete` dice se si è arrivati in fondo.
   ══════════════════════════════════════════════════════════════════════ */

const PAGE_LIMIT = 50;
const PAUSE_MS = 150;            // fra una pagina e l'altra: ~400/min al massimo, di solito meno
const PAGE_RETRIES = 3;
const MAX_PAGES = 1500;          // rete contro un cursore che non finisce mai

/** Quanto vale una classifica in memoria prima di rifarla. Il danno
 *  settimanale si muove di ora in ora; ricchezza, danno totale e taglie
 *  si guardano per la posizione, e tre ore non la spostano di molto. */
const TTL_MS = {
  weeklyUserDamages: 30 * 60 * 1000,
  userDamages: 3 * 3600 * 1000,
  userWealth: 3 * 3600 * 1000,
  userBounty: 3 * 3600 * 1000,
  userReferrals: 6 * 3600 * 1000,
};
const TYPES = Object.keys(TTL_MS);

let deps = null;                 // { trpcBatch }
const _cache = new Map();        // type -> { at, count, complete, items, body }
const _inflight = new Map();     // type -> Promise
let _lastError = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function initFullRanking(tools) {
  deps = tools;
}

async function page(type, cursor) {
  const input = { rankingType: type, limit: PAGE_LIMIT };
  if (cursor) input.cursor = cursor;
  for (let a = 1; a <= PAGE_RETRIES; a++) {
    const [res] = await deps.trpcBatch([['ranking.getRankingPage', input]], { useWorker: true });
    if (res && Array.isArray(res.items)) return res;
    await sleep(2000 * a);
  }
  throw new Error(`pagina di ${type} non arrivata dopo ${PAGE_RETRIES} tentativi`);
}

async function fetchAll(type) {
  const t0 = Date.now();
  const items = [];
  let cursor = null;
  let count = null;
  let complete = false;
  for (let n = 0; n < MAX_PAGES; n++) {
    const d = await page(type, cursor);
    if (count == null) count = Number(d.ranking?.count) || null;
    for (const it of d.items) {
      items.push({ user: it.user || null, country: it.country || null, mu: it.mu || null, value: Number(it.value) || 0, rank: it.rank });
    }
    const last = d.items[d.items.length - 1];
    // Oltre lo zero non c'è niente da sapere: la ricchezza ha una coda di
    // iscritti a 0 (`zeroRank`), e nessuno la vuole in una classifica.
    if (!d.nextCursor || !d.items.length || (last && Number(last.value) <= 0)) { complete = true; break; }
    cursor = d.nextCursor;
    await sleep(PAUSE_MS);
  }
  const at = Date.now();
  // Le righe compatte che legge il browser: { u, c, m, v, r }, come
  // src/players/api.js le costruiva dalla vecchia risposta.
  const body = JSON.stringify({
    type, at, count, complete, n: items.length,
    rows: items.map(x => ({ u: x.user, c: x.country, m: x.mu, v: x.value, r: x.rank })),
  });
  console.log(`[full-ranking] ${type}: ${items.length}/${count ?? '?'} righe in ${Math.round((at - t0) / 1000)} s${complete ? '' : ' (INCOMPLETA)'}`);
  return { at, count, complete, items, body };
}

/**
 * La classifica intera di `type`. Se quella in memoria è più giovane di
 * `maxAgeMs` (default: il TTL del tipo) si usa quella, altrimenti si rifà.
 * Una sola richiesta per tipo alla volta: chi arriva mentre si sfoglia
 * aspetta la stessa promessa.
 * @returns {Promise<{at:number,count:number|null,complete:boolean,items:Array}>}
 */
function getFullRanking(type, { maxAgeMs } = {}) {
  if (!deps) return Promise.reject(new Error('fullRanking non inizializzato'));
  const age = maxAgeMs ?? TTL_MS[type] ?? 3600 * 1000;
  const hit = _cache.get(type);
  if (hit && Date.now() - hit.at < age) return Promise.resolve(hit);
  if (_inflight.has(type)) return _inflight.get(type);
  const p = fetchAll(type)
    .then(entry => { _cache.set(type, entry); _lastError = null; return entry; })
    .catch(err => {
      _lastError = { type, message: err.message, at: Date.now() };
      console.error('[full-ranking]', type, err.message);
      if (hit) return hit;          // meglio quella vecchia che nessuna
      throw err;
    })
    .finally(() => _inflight.delete(type));
  _inflight.set(type, p);
  return p;
}

/** Quella in memoria, senza fetch (null se non c'è ancora). */
function cachedFullRanking(type) {
  return _cache.get(type) || null;
}

/**
 * Tiene calde le classifiche che servono al browser: una per volta, mai in
 * parallelo, così il passo resta quello di una sola. Il primo giro parte
 * dopo `delayMs` (all'avvio il server ha altro da fare).
 */
function startFullRankingLoop({ delayMs = 60 * 1000, everyMs = 10 * 60 * 1000 } = {}) {
  const tick = async () => {
    for (const type of TYPES) {
      try { await getFullRanking(type); } catch { /* già nel log */ }
    }
  };
  setTimeout(() => { tick(); setInterval(tick, everyMs); }, delayMs);
}

function fullRankingHealth() {
  const out = {};
  for (const type of TYPES) {
    const e = _cache.get(type);
    out[type] = e ? { righe: e.items.length, count: e.count, complete: e.complete, at: new Date(e.at).toISOString() } : null;
  }
  return { ...out, inCorso: [..._inflight.keys()], ultimoErrore: _lastError };
}

module.exports = {
  FULL_RANKING_TYPES: TYPES,
  initFullRanking, getFullRanking, cachedFullRanking, startFullRankingLoop, fullRankingHealth,
};
