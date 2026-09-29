/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Storico politico: elezioni, presidenti, partiti, governi
   -----------------------------------------------------------------------
   Political View era l'unica sezione del tool senza memoria lato server:
   la timeline dei seggi si ricostruiva nel browser elezione per elezione,
   e tutto quello che WarEra non conserva (chi era iscritto a quale partito
   ieri, chi sedeva al governo il mese scorso) semplicemente non esisteva.
   Questo modulo tiene quattro archivi, e sono di due tipi OPPOSTI:

   ── 1. ELEZIONI E PRESIDENTI: COMPLETI DAL LANCIO ──────────────────────
   `elections-by-country` (pollElections) contiene già TUTTE le elezioni
   di ogni nazione — la passata completa ogni 6 ore chiede il tetto
   dell'API, 100 per nazione, e l'Italia che è fra le più vecchie ne ha 35.
   E la voce di lista È il dettaglio (verificato: candidates, votes,
   votesCount, isElected byte per byte). Quindi qui non si scarica niente:
   si RIASSUME. Per ogni elezione: votanti, voti e seggi per partito, e
   per le presidenziali il vincitore. I presidenti nel tempo vengono da lì
   — vincitore di un'elezione, in carica fino alla successiva — e valgono
   fin dal primo giorno del gioco.

   ⚠️ Il presidente "da elezione" è il presidente ELETTO. Un impeachment o
   una rinuncia fra due elezioni non si vedono qui (le presidenziali
   straordinarie sì: sono elezioni come le altre, l'Italia ne ha una il
   9 luglio 2026). Per chi sedeva DAVVERO al governo c'è l'archivio 4.

   ── 2. ISCRITTI AI PARTITI: ACCUMULA ───────────────────────────────────
   `parties-detail` (pollParties, ogni 10 minuti) porta i `members` di
   ogni partito del mondo, ma solo quelli di ADESSO. Quanti erano la
   settimana scorsa non lo sa nessuno: si registra da qui in avanti, un
   punto solo quando il numero cambia (una serie per partito, non una
   fotografia al giorno di duemila partiti).

   ── 3. CAMBI DI CASACCA: ACCUMULA ──────────────────────────────────────
   Stesso principio di server/citizenMoves.js: WarEra non pubblica "chi ha
   cambiato partito", e un cambio è per forza la differenza fra due
   fotografie utente → partito. Una fotografia all'ora (non ad ogni giro
   da 10 minuti: chi esce e rientra nella stessa ora non è una notizia).
   Tre forme: da A a B, iscrizione (da nessun partito), uscita (verso
   nessun partito — anche lo scioglimento del partito finisce qui).
   ⚠️ Stessa guardia dei trasferimenti: una fotografia molto più piccola
   della precedente è un giro monco, e diffarla inventerebbe centinaia di
   uscite. Si scarta, e la si accetta solo se si ripresenta uguale per
   CONFIRM_ROUNDS giri (un calo vero resta, una pagina persa no).

   ── 4. GOVERNI: ACCUMULA ───────────────────────────────────────────────
   Presidente, vice e i tre ministri. `government.getByCountryId` lo
   chiede GIÀ il radar dei proxy (server/proxyIndex.js) ogni 6 ore per
   tutte le nazioni: qui si riceve la sua risposta invece di ripagarla.
   Una riga solo quando qualcosa cambia. Risoluzione 6 ore, dichiarata:
   un ministro nominato e rimosso nello stesso pomeriggio non si vede.

   Per i tre archivi che accumulano `coverageFrom` dice da quando in qua
   si guardava: prima di quella data una serie vuota NON vuol dire
   "nessuno si è mosso", e il client lo dichiara.

   ⚠️ Niente potatura a giorni sugli archivi 2 e 4 (vedi CLAUDE.md, gli
   archivi che accumulano non si recuperano): pesano poco. I cambi di
   casacca tengono 180 giorni perché sono righe per persona.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const MEMBERS_FILE = 'party-members-history';   // { startedAt, series: {pid:[[ts,n]]}, meta: {pid:[country,name]} }
const SNAP_FILE = 'party-snapshot';              // { at, map: {uid: pid}, total, suspect? }
const SWITCHES_FILE = 'party-switches';          // { startedAt, data: [{u,f,t,a,c}] }
const GOV_FILE = 'government-history';           // { startedAt, byCountry: {cid: [{a, r:[pres,vp,def,fa,eco]}]} }

const SWITCH_RETENTION_DAYS = 180;
const SNAP_EVERY_MS = 55 * 60 * 1000;            // una fotografia di casacca all'ora
const MAX_POINTS_PER_PARTY = 5000;
const MIN_TOTAL_RATIO = 0.85;
const CONFIRM_ROUNDS = 3;
const CONFIRM_TOLERANCE = 0.10;
const DAY_MS = 24 * 60 * 60 * 1000;

function initPoliticalHistory(tools) {
  deps = tools;
}

function readCache(name, fb) { return deps.readCache(name, fb); }
function writeCache(name, data, opts) { return deps.writeCache(name, data, opts); }

function _ts(s) {
  if (!s) return null;
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/* ══ 1. ELEZIONI ══════════════════════════════════════════════════════ */

/** Una elezione in forma compatta. `P` presidenziale, `C` congresso.
 *  I voti per candidato stanno in `votes` ({userId: n}); `voteCount` sul
 *  candidato è quasi sempre 0 e fa solo da ripiego. */
function summarizeElection(e) {
  const votes = e.votes && typeof e.votes === 'object' && !Array.isArray(e.votes) ? e.votes : {};
  const parties = {};
  let win = null;
  let sum = 0;
  let seats = 0;
  const pres = e.type === 'president' || e.type === 'presidential';
  const ranking = [];
  for (const c of e.candidates || []) {
    const uid = String(c.user || c.userId || '');
    const pid = c.party || c.partyId || null;
    const key = pid || '_';
    const v = Number(votes[uid] ?? c.voteCount ?? 0) || 0;
    sum += v;
    const p = parties[key] || (parties[key] = { v: 0, s: 0, c: 0 });
    p.v += v; p.c++;
    if (c.isElected) { p.s++; seats++; }
    if (pres) ranking.push({ u: uid, p: pid, v, el: !!c.isElected });
  }
  if (pres && ranking.length) {
    ranking.sort((a, b) => (b.el - a.el) || (b.v - a.v));
    const w = ranking[0];
    const second = ranking[1];
    // Vincitore solo a elezione chiusa E con un eletto: durante il voto il
    // primo in classifica non è "il presidente".
    if (w.el) win = { u: w.u, p: w.p, v: w.v, r: second ? { u: second.u, p: second.p, v: second.v } : null };
  }
  return {
    id: e._id || e.id,
    t: pres ? 'P' : 'C',
    c0: _ts(e.createdAt),
    s: _ts(e.votesStartAt),
    e: _ts(e.votesEndAt),
    st: e.status || null,
    v: Number.isFinite(e.votesCount) ? e.votesCount : sum,
    n: (e.candidates || []).length,
    seats,
    parties,
    win,
  };
}

/** Numero effettivo di partiti (Laakso-Taagepera) su una distribuzione. */
function enp(values) {
  const tot = values.reduce((s, x) => s + x, 0);
  if (!tot) return null;
  const hh = values.reduce((s, x) => s + (x / tot) ** 2, 0);
  return hh ? 1 / hh : null;
}

let _el = null;   // { fetchedAt, byCountry: {cid: [summary asc]}, overview, presidents }

function _finished(s) { return s.st === 'finished' || (s.st == null && s.e && s.e < Date.now()); }

function _overviewOf(list, now) {
  const cong = list.filter(s => s.t === 'C' && _finished(s));
  const pres = list.filter(s => s.t === 'P' && _finished(s));
  const out = { n: list.length, first: list.length ? (list[0].e || list[0].c0) : null };

  const lastC = cong.at(-1);
  if (lastC) {
    const pv = Object.entries(lastC.parties).filter(([k]) => k !== '_');
    const votes = pv.map(([, p]) => p.v);
    const seats = pv.map(([, p]) => p.s);
    const top = pv.slice().sort((a, b) => b[1].v - a[1].v)[0];
    const tot = lastC.v || votes.reduce((s, x) => s + x, 0);
    out.lastC = {
      id: lastC.id, e: lastC.e, v: lastC.v, seats: lastC.seats,
      parties: pv.filter(([, p]) => p.s > 0).length,
      enpV: enp(votes), enpS: enp(seats),
      top: top ? { p: top[0], share: tot ? top[1].v / tot : null, s: top[1].s } : null,
      prevV: cong.at(-2)?.v ?? null,
    };
    const last3 = cong.slice(-3);
    out.avgC3 = last3.reduce((s, x) => s + (x.v || 0), 0) / last3.length;
  }

  const lastP = pres.at(-1);
  if (lastP) {
    const w = lastP.win;
    out.lastP = {
      id: lastP.id, e: lastP.e, v: lastP.v, n: lastP.n,
      win: w ? w.u : null, p: w ? w.p : null,
      share: w && lastP.v ? w.v / lastP.v : null,
      margin: w && lastP.v ? (w.v - (w.r?.v || 0)) / lastP.v : null,
    };
    const last6 = pres.slice(-6).filter(s => s.win);
    out.pres6 = { n: last6.length, distinct: new Set(last6.map(s => s.win.u)).size };
    // Serie del presidente in carica (stessa persona) e del suo partito.
    let streak = 0, pStreak = 0;
    for (let i = pres.length - 1; i >= 0 && pres[i].win?.u === w?.u; i--) streak++;
    for (let i = pres.length - 1; i >= 0 && w?.p && pres[i].win?.p === w.p; i--) pStreak++;
    out.streak = streak;
    out.pStreak = pStreak;
  }

  const open = list.filter(s => !_finished(s)).sort((a, b) => (a.e || 0) - (b.e || 0))[0];
  if (open) {
    out.open = {
      id: open.id, t: open.t, s: open.s, e: open.e, v: open.v, n: open.n,
      phase: open.s && now < open.s ? 'candidacy' : 'voting',
    };
  }
  return out;
}

function refreshElections(force = false) {
  if (!deps) return null;
  const cache = readCache('elections-by-country', { fetchedAt: null, data: {} });
  if (!force && _el && _el.fetchedAt === cache.fetchedAt) return _el;
  const now = Date.now();
  const byCountry = {};
  const overview = {};
  const presidents = {};
  for (const [cid, list] of Object.entries(cache.data || {})) {
    const sums = (list || []).map(summarizeElection)
      .filter(s => s.id)
      .sort((a, b) => ((a.e || a.c0 || 0) - (b.e || b.c0 || 0)));
    byCountry[cid] = sums;
    overview[cid] = _overviewOf(sums, now);
    presidents[cid] = sums.filter(s => s.t === 'P' && s.win && _finished(s)).map(s => [s.e, s.win.u, s.win.p]);
  }
  _el = { fetchedAt: cache.fetchedAt, builtAt: now, byCountry, overview, presidents };
  return _el;
}

/* ══ 2 + 3. PARTITI: ISCRITTI NEL TEMPO E CAMBI DI CASACCA ═══════════ */

function _readMembers() { return readCache(MEMBERS_FILE, { startedAt: null, series: {}, meta: {} }); }
function _readSwitches() { return readCache(SWITCHES_FILE, { startedAt: null, fetchedAt: null, data: [] }); }
function _readSnap() { return readCache(SNAP_FILE, { at: null, map: null, total: 0 }); }

/**
 * Chiamata da pollParties subito dopo aver scritto `parties-detail`, con lo
 * stesso array — nessuna rilettura, nessuna chiamata.
 * @param {Array<{partyId:string, data:object}>} parties
 */
function recordParties(parties, now = Date.now()) {
  if (!deps || !Array.isArray(parties) || !parties.length) return;

  // ── Iscritti per partito: un punto solo se il numero cambia ──
  const store = _readMembers();
  if (!store.startedAt) store.startedAt = now;
  let changed = false;
  const map = {};
  let total = 0;
  for (const { partyId, data } of parties) {
    if (!partyId || !data) continue;
    const members = Array.isArray(data.members) ? data.members : [];
    const n = members.length;
    const s = store.series[partyId] || (store.series[partyId] = []);
    const last = s.at(-1);
    if (!last || last[1] !== n) {
      s.push([now, n]);
      if (s.length > MAX_POINTS_PER_PARTY) s.splice(0, s.length - MAX_POINTS_PER_PARTY);
      changed = true;
    }
    // Nome e nazione: si tengono anche dopo lo scioglimento, così lo
    // storico elezioni sa ancora come si chiamava.
    const meta = [data.country || null, data.name || null];
    const old = store.meta[partyId];
    if (!old || old[0] !== meta[0] || old[1] !== meta[1]) { store.meta[partyId] = meta; changed = true; }
    for (const uid of members) { map[String(uid)] = partyId; total++; }
  }
  if (changed) writeCache(MEMBERS_FILE, store, { compact: true });

  // ── Cambi di casacca: fotografia oraria ──
  const prev = _readSnap();
  if (prev.at && now - prev.at < SNAP_EVERY_MS && !prev.suspect) return;
  if (!prev.map) {
    writeCache(SNAP_FILE, { at: now, map, total }, { compact: true });
    const sw = _readSwitches();
    writeCache(SWITCHES_FILE, { startedAt: sw.startedAt || now, fetchedAt: now, data: sw.data }, { compact: true });
    console.log(`[political-history] prima fotografia partiti: ${total} iscritti, da qui si contano i cambi`);
    return;
  }
  if (prev.total && total < prev.total * MIN_TOTAL_RATIO) {
    const s = prev.suspect;
    const same = s && Math.abs(total - s.total) <= s.total * CONFIRM_TOLERANCE;
    const streak = same ? s.streak + 1 : 1;
    if (streak < CONFIRM_ROUNDS) {
      writeCache(SNAP_FILE, { ...prev, suspect: { streak, total: same ? s.total : total } }, { compact: true });
      console.warn(`[political-history] iscritti ${prev.total}→${total}: giro sospetto ${streak}/${CONFIRM_ROUNDS}, scartato`);
      return;
    }
    console.log(`[political-history] calo iscritti confermato per ${streak} giri: si diffa`);
  }

  const meta = store.meta;
  const fresh = [];
  for (const [uid, before] of Object.entries(prev.map)) {
    const after = map[uid] || null;
    if (after === before) continue;
    fresh.push({ u: uid, f: before, t: after, a: now });
  }
  for (const [uid, after] of Object.entries(map)) {
    if (!prev.map[uid]) fresh.push({ u: uid, f: null, t: after, a: now });
  }
  // `c` = nazione del partito coinvolto (di arrivo se c'è, se no di
  // partenza): serve al filtro per nazione senza rileggere i metadati.
  for (const r of fresh) r.c = meta[r.t]?.[0] || meta[r.f]?.[0] || null;

  const sw = _readSwitches();
  const floor = now - SWITCH_RETENTION_DAYS * DAY_MS;
  const merged = [...fresh, ...sw.data].filter(r => r.a >= floor).sort((a, b) => b.a - a.a);
  writeCache(SNAP_FILE, { at: now, map, total }, { compact: true });
  writeCache(SWITCHES_FILE, { startedAt: sw.startedAt || prev.at || now, fetchedAt: now, data: merged }, { compact: true });
  if (fresh.length) console.log(`[political-history] +${fresh.length} cambi di partito, ${merged.length} in archivio`);
}

/* ══ 4. GOVERNI ═══════════════════════════════════════════════════════ */

function _readGov() { return readCache(GOV_FILE, { startedAt: null, byCountry: {} }); }

/** Riceve la risposta che proxyIndex ha appena scaricato. */
function recordGovernments(countries, results, now = Date.now()) {
  if (!deps || !Array.isArray(countries) || !Array.isArray(results)) return;
  const store = _readGov();
  if (!store.startedAt) store.startedAt = now;
  let changed = 0;
  countries.forEach((c, i) => {
    const g = results[i];
    if (!g || !c?._id) return;   // chiamata fallita: non è "governo vuoto"
    const r = [g.president || null, g.vicePresident || null, g.minOfDefense || null, g.minOfForeignAffairs || null, g.minOfEconomy || null];
    const rows = store.byCountry[c._id] || (store.byCountry[c._id] = []);
    const last = rows.at(-1);
    if (last && last.r.every((x, k) => x === r[k])) return;
    rows.push({ a: now, r });
    changed++;
  });
  writeCache(GOV_FILE, store, { compact: true });
  if (changed) console.log(`[political-history] governi: ${changed} nazioni con un cambio registrato`);
}

/* ══ LETTURA ══════════════════════════════════════════════════════════ */

function _partyNames(countryId) {
  const out = {};
  const meta = _readMembers().meta || {};
  for (const [pid, m] of Object.entries(meta)) {
    if (!countryId || m[0] === countryId) out[pid] = m[1];
  }
  // I partiti di oggi vincono sul ricordo (un nome cambiato si aggiorna).
  const detail = readCache('parties-detail', { data: [] }).data || [];
  for (const p of detail) {
    if (!p?.data?.name) continue;
    if (!countryId || p.data.country === countryId || out[p.partyId] !== undefined) out[p.partyId] = p.data.name;
  }
  return out;
}

/** Tutto lo storico politico di UNA nazione. Gli id utente escono senza
 *  nome: li risolve la route (resolveUsersLite), una volta sola. */
function readPoliticalHistory(countryId, { switchDays = 30 } = {}) {
  const el = refreshElections();
  const elections = el?.byCountry?.[countryId] || [];

  // Presidenti: vincitore di un'elezione, in carica fino alla successiva.
  const pres = elections.filter(s => s.t === 'P' && s.win && _finished(s));
  const presidents = pres.map((s, i) => ({
    u: s.win.u, p: s.win.p, v: s.win.v, tot: s.v,
    share: s.v ? s.win.v / s.v : null,
    from: s.e, to: pres[i + 1]?.e ?? null, id: s.id,
  }));

  const partyNames = _partyNames(countryId);
  const ms = _readMembers();
  const series = {};
  for (const [pid, s] of Object.entries(ms.series || {})) {
    if (ms.meta?.[pid]?.[0] === countryId) series[pid] = s;
  }

  const sw = _readSwitches();
  const since = Date.now() - Math.min(SWITCH_RETENTION_DAYS, Math.max(1, switchDays)) * DAY_MS;
  const switches = [];
  for (const r of sw.data) {
    if (r.a < since) break;
    if (r.c === countryId) switches.push(r);
  }

  const gov = _readGov();
  const governments = gov.byCountry?.[countryId] || [];

  return {
    fetchedAt: el?.fetchedAt || null,
    countryId,
    elections,
    presidents,
    partyNames,
    overview: el?.overview?.[countryId] || null,
    members: { coverageFrom: ms.startedAt, series },
    switches: { coverageFrom: sw.startedAt, days: switchDays, rows: switches },
    governments: { coverageFrom: gov.startedAt, rows: governments },
  };
}

/** Le metriche di confronto di tutte le nazioni (vista "Mondo"). */
function readPoliticalOverview() {
  const el = refreshElections();
  const data = el?.overview || {};
  // I nomi dei soli partiti citati (primo partito, partito del presidente):
  // il client non ha i partiti di tutte le nazioni in memoria.
  const all = _partyNames(null);
  const partyNames = {};
  const userIds = new Set();
  for (const o of Object.values(data)) {
    for (const pid of [o.lastC?.top?.p, o.lastP?.p]) if (pid && all[pid]) partyNames[pid] = all[pid];
    if (o.lastP?.win) userIds.add(o.lastP.win);
  }
  return { fetchedAt: el?.fetchedAt || null, builtAt: el?.builtAt || null, data, partyNames, userIds: [...userIds] };
}

/** Presidenti di tutte le nazioni, per la time machine: {cid: [[da, userId, partyId]]}. */
function readPresidents() {
  const el = refreshElections();
  return { fetchedAt: el?.fetchedAt || null, data: el?.presidents || {} };
}

/** Gli id di tutti i presidenti di sempre: il cron li fa risolvere in
 *  anticipo, così la time machine trova i nomi già in casa. */
function allPresidentIds() {
  const el = refreshElections();
  const ids = new Set();
  for (const rows of Object.values(el?.presidents || {})) for (const r of rows) ids.add(r[1]);
  return [...ids];
}

function statoPoliticalHistory() {
  const el = _el;
  const ms = _readMembers();
  const sw = _readSwitches();
  const gov = _readGov();
  return {
    elezioni: el ? Object.values(el.byCountry).reduce((s, l) => s + l.length, 0) : null,
    iscritti: { partiti: Object.keys(ms.series || {}).length, copreDa: ms.startedAt ? new Date(ms.startedAt).toISOString() : null },
    cambiDiCasacca: { righe: sw.data.length, copreDa: sw.startedAt ? new Date(sw.startedAt).toISOString() : null },
    governi: { nazioni: Object.keys(gov.byCountry || {}).length, copreDa: gov.startedAt ? new Date(gov.startedAt).toISOString() : null },
  };
}

module.exports = {
  initPoliticalHistory,
  refreshElections,
  recordParties,
  recordGovernments,
  readPoliticalHistory,
  readPoliticalOverview,
  readPresidents,
  allPresidentIds,
  statoPoliticalHistory,
  summarizeElection,
};
