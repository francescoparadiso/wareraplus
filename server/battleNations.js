/* ══════════════════════════════════════════════════════════════════════
   WarEra+ — Danno e incasso PER NAZIONE di una battaglia, ricostruiti dai
   giocatori (/battle-nations)
   ----------------------------------------------------------------------
   ⚠️ 2026-11-19, Libano–Siria (6afeb5b644f5e54a7e4344bb): la classifica del
   gioco per NAZIONE (`battleRanking.getRanking {type:'country'}`) del lato
   siriano NON conteneva i cittadini di sette nazioni. Misurato alle 16:38 UTC:

       lato difesa      per nazione   per unità   per giocatore
       danno              349,6M       507,6M        508,3M
       incassato          16.142       27.215        27.440

   Arabia Saudita 65,7M di danno (nella classifica ~0), Senegal 30,3M e Papua
   Nuova Guinea 29,4M (assenti), Ghana, Qatar, Vaticano, Egitto (9,4M contro
   1,0M). Le altre nazioni tornavano al centesimo (Maldive 70,7M = 70,7M), e
   sul lato libanese le tre classifiche coincidevano. Il perché non si vede
   dall'API (non è alleanza né guerra: il Qatar è nell'alleanza della Siria
   e manca lo stesso). Nel dettaglio battaglia si leggeva un terzo di danno
   in meno e una colonna «di cui contratti» (24.018) più alta dell'incassato
   (15.759), perché i contratti si contano sulle UNITÀ, che sono complete.

   Qui si rifà la somma dal basso: la classifica per GIOCATORE (completa:
   coincide con quella per unità e col danno della battaglia) di entrambi i
   lati, danno e incasso, raggruppata per cittadinanza. La cittadinanza viene
   dalla mappa utente → nazione del censimento (mu-user-countries); chi non
   c'è si chiede a `user.getUserLite` una volta e si tiene in memoria.

   ⚠️ La cittadinanza è quella di ADESSO. Per questo il client NON sostituisce
   la classifica del gioco con questa: le aggiunge solo quello che manca
   (src/shared/battleNations.js, `fillMissingNations`), e solo se i totali
   non tornano. Su una battaglia vecchia in cui la classifica del gioco è
   completa non cambia niente, anche se nel frattempo qualcuno ha cambiato
   cittadinanza.

   Costo: la classifica per giocatore si ferma a 100 righe per pagina (200 →
   errore di validazione), quindi una battaglia da ~860 giocatori per lato
   sono ~9 giri; ogni giro chiede le quattro classifiche (danno/incasso ×
   lato) in UN batch. Le risposte restano in memoria 60 s se la battaglia è
   in corso e 6 ore se è finita, e le richieste uguali in volo si accorpano.
   ══════════════════════════════════════════════════════════════════════ */

const PAGE = 100;
// 40 pagine = 4.000 giocatori per lato: oltre si dichiara `truncated`.
const MAX_PAGES = 40;
const LIVE_TTL_MS = 60 * 1000;
const ENDED_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 80;
// Utenti fuori dal censimento risolti con getUserLite: una settimana basta,
// la cittadinanza cambia di rado.
const EXTRA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXTRA_MAX_FETCH = 400;

const RANKINGS = [
  ['damage', 'attacker'], ['damage', 'defender'],
  ['money', 'attacker'], ['money', 'defender'],
];

let deps = null;
const _cache = new Map();   // battleId -> { at, ttl, data }
const _inflight = new Map(); // battleId -> Promise
const _extra = new Map();   // userId -> { c, at }
const _stats = { served: 0, built: 0, failed: 0, lastBuildMs: null, lastError: null };

/** deps: { trpcBatch, readCacheShared, userCountriesFile } */
function initBattleNations(d) { deps = d; }

async function _fetchUserRankings(battleId) {
  const rows = RANKINGS.map(() => []);
  const cursors = RANKINGS.map(() => null);
  const done = RANKINGS.map(() => false);
  for (let page = 0; page < MAX_PAGES; page++) {
    const idx = RANKINGS.map((_, i) => i).filter(i => !done[i]);
    if (!idx.length) break;
    const res = await deps.trpcBatch(idx.map(i => ['battleRanking.getRanking', {
      battleId, dataType: RANKINGS[i][0], type: 'user', side: RANKINGS[i][1], limit: PAGE,
      ...(cursors[i] ? { cursor: cursors[i] } : {}),
    }]), { useWorker: true });
    idx.forEach((i, k) => {
      const p = res[k];
      // Una pagina persa non è "nessun altro giocatore": senza tutte le
      // pagine non si risponde (il client resta sulla classifica del gioco).
      if (!p || !Array.isArray(p.items)) throw new Error(`classifica ${RANKINGS[i].join('/')} non disponibile`);
      rows[i].push(...p.items);
      cursors[i] = p.nextCursor || null;
      if (!cursors[i] || !p.items.length) done[i] = true;
    });
  }
  return { rows, truncated: done.some(x => !x) };
}

async function _citizenships(userIds) {
  const census = deps.readCacheShared(deps.userCountriesFile, { data: {} }).data || {};
  const now = Date.now();
  const out = new Map();
  const missing = [];
  for (const id of userIds) {
    const c = census[id]?.[0];
    if (c) { out.set(id, c); continue; }
    const x = _extra.get(id);
    if (x && now - x.at < EXTRA_TTL_MS) { if (x.c) out.set(id, x.c); continue; }
    missing.push(id);
  }
  const ask = missing.slice(0, EXTRA_MAX_FETCH);
  if (ask.length) {
    const res = await deps.trpcBatch(ask.map(id => ['user.getUserLite', { userId: id }]), { useWorker: true, maxBatch: 50 });
    ask.forEach((id, k) => {
      const u = res[k];
      if (!u) return;            // non risposto: si riprova al prossimo giro
      _extra.set(id, { c: u.country || null, at: now });
      if (u.country) out.set(id, u.country);
    });
  }
  return out;
}

async function _build(battleId) {
  const t0 = Date.now();
  const { rows, truncated } = await _fetchUserRankings(battleId);
  const ids = new Set();
  for (const list of rows) for (const it of list) if (it.user) ids.add(it.user);
  const cit = await _citizenships([...ids]);

  const sides = {};
  for (const side of ['attacker', 'defender']) {
    sides[side] = { totals: { d: 0, m: 0 }, users: 0, byCountry: new Map(), unresolved: { d: 0, m: 0, n: 0 } };
  }
  const seen = { attacker: new Set(), defender: new Set() };
  RANKINGS.forEach(([dataType, side], i) => {
    const s = sides[side];
    const key = dataType === 'damage' ? 'd' : 'm';
    for (const it of rows[i]) {
      const v = Number(it.value) || 0;
      if (!v) continue;
      s.totals[key] += v;
      if (!seen[side].has(it.user)) { seen[side].add(it.user); s.users += 1; }
      const c = cit.get(it.user);
      if (!c) { s.unresolved[key] += v; if (key === 'd') s.unresolved.n += 1; continue; }
      const row = s.byCountry.get(c) || { c, d: 0, m: 0 };
      row[key] += v;
      s.byCountry.set(c, row);
    }
  });
  const round = (n) => Math.round(n * 100) / 100;
  const out = { battleId, at: new Date().toISOString(), truncated, sides: {} };
  for (const side of ['attacker', 'defender']) {
    const s = sides[side];
    out.sides[side] = {
      totals: { d: round(s.totals.d), m: round(s.totals.m) },
      users: s.users,
      unresolved: { d: round(s.unresolved.d), m: round(s.unresolved.m), n: s.unresolved.n },
      countries: [...s.byCountry.values()]
        .map(r => ({ c: r.c, d: round(r.d), m: round(r.m) }))
        .sort((a, b) => b.d - a.d),
    };
  }
  _stats.built += 1;
  _stats.lastBuildMs = Date.now() - t0;
  return out;
}

/** Danno e incasso per cittadinanza di una battaglia. `live` sceglie solo
 *  quanto tenere la risposta. Lancia se una classifica non risponde. */
async function readBattleNations(battleId, { live = false } = {}) {
  if (!deps) throw new Error('battleNations non inizializzato');
  _stats.served += 1;
  const hit = _cache.get(battleId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  if (_inflight.has(battleId)) return _inflight.get(battleId);
  const p = _build(battleId)
    .then((data) => {
      _cache.set(battleId, { at: Date.now(), ttl: live ? LIVE_TTL_MS : ENDED_TTL_MS, data });
      while (_cache.size > MAX_ENTRIES) _cache.delete(_cache.keys().next().value);
      return data;
    })
    .catch((err) => { _stats.failed += 1; _stats.lastError = err.message; throw err; })
    .finally(() => _inflight.delete(battleId));
  _inflight.set(battleId, p);
  return p;
}

function statoBattleNations() {
  return { ..._stats, cached: _cache.size, extraUsers: _extra.size };
}

module.exports = { initBattleNations, readBattleNations, statoBattleNations };
