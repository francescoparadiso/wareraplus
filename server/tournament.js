// ═══════════════════════════════════════════════════════════════════════
// WarEra+ — Tornei: forza delle squadre già calcolata (/tournament)
// -----------------------------------------------------------------------
// La sezione Tornei del client (src/tournament/*) misura ogni squadra col
// danno dei suoi ISCRITTI. Per farlo dal browser doveva scaricare la
// classifica settimanale INTERA dei giocatori (~510 KB gzip) e le squadre
// con tutti gli iscritti (~180 KB): 3-4 secondi alla prima apertura.
// Qui lo si fa una volta per tutti, e il client riceve ~50 KB.
//
// Cosa tiene questo modulo, e perché:
//
// 1. SETTIMANA MOBILE. `weeklyUserDamages` riparte da zero il lunedì alle
//    00:00 UTC (lo stesso reset che vede server/damageTimeline.js): il
//    lunedì mattina tutte le squadre sembrerebbero deboli insieme, e la
//    forza dipenderebbe da chi ha giocato nelle prime ore. Ogni 6 ore (alle
//    :55 delle 5, 11, 17, 23 UTC — l'ultima è la lettura finale prima del
//    reset) si fotografa la classifica in cache/weekly-snaps/, e la forza
//    diventa il danno degli ULTIMI 7 GIORNI:
//        questa settimana + (finale della scorsa − scorsa a 7 giorni fa)
//    Finché in archivio non c'è la settimana scorsa intera, il pezzo che
//    manca si stima spalmando la finale in modo uniforme (`weeklyMode`
//    'estimate', la vista lo dice). Senza la finale: settimana in corso
//    ('week'). 470 KB a fotografia, si tengono 10 giorni.
//
// 2. FORMA NEL TORNEO. Misurato il 2026-10-25 sulle 100 partite di turno 2
//    in cui le due squadre avevano giocato il turno 1: il danno per round
//    del turno prima prevede da solo quanto il settimanale (72 contro 75
//    favoriti vincenti), ma i due insieme abbassano la log-loss da 0,508 a
//    0,433 (correlano solo 0,66: il torneo ha il tetto all'equipaggiamento,
//    e dice chi si presenta davvero). Per ogni partita finita si tiene
//    [danno attaccante, danno difensore, round giocati] — una
//    battle.getById a partita, una volta sola (cache/tournament-battles).
//
// 3. REGISTRO DELLE PREVISIONI. Appena una partita ha le due squadre, la
//    probabilità del modello si scrive in cache/tournament-predictions e
//    non si tocca più: a partita finita si può dire quante ne ha
//    indovinate, senza il trucco di ricalcolarle col senno di poi. Una
//    partita già avviata al primo sguardo (round vinti, o battaglia aperta
//    da più di 15 minuti) è marcata `late` e non conta.
//
// 4. COMPOSIZIONE di una squadra (/tournament/team): iscritti col danno
//    degli ultimi 7 giorni e quello fatto nel torneo (`damageByEntity`).
//
// ⚠️ Il modello qui sotto è lo STESSO di src/tournament/model.js (fit e
// probabilità): il server lo usa solo per il registro, il client per tutto
// il resto e quando il server manca. Se cambi l'uno, cambia l'altro.
//
// Tutto pubblico su api6, niente chiave. Se questa rotta manca o non
// risponde il client fa da sé (src/tournament/api.js), senza settimana
// mobile, forma e registro, e lo dichiara.
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const LIST_LIMIT = 8;
const WEEKLY_TTL_MS = 10 * 60 * 1000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const SNAP_SUBDIR = 'weekly-snaps';
const SNAP_KEEP_MS = 10 * DAY;
const BATTLES_FILE = 'tournament-battles';
const PREDS_FILE = 'tournament-predictions';
const LATE_AFTER_MS = 15 * 60 * 1000;

let deps = null;
let _list = [];                 // tornei, dal più recente
let _listAt = 0;
const _teams = new Map();       // tournamentId -> { at, rows, byUser, dmg: Map teamId -> damageByEntity }
let _weekly = null;             // Map userId -> danno della settimana in corso
let _weeklyAt = 0;
let _rolling = null;            // { map, mode, from }
let _battles = null;            // { battleId: [aDmg, dDmg, rounds] }
let _preds = null;              // { tournamentId: { "n:idx": { a, d, p: [pot, avg], late, at } } }
let _lastError = null;

function initTournament(tools) {
  deps = tools;
}

async function one(proc, input) {
  const [res] = await deps.trpcBatch([[proc, input]]);
  return res;
}

/* ── 1. Classifica settimanale e settimana mobile ───────────────────── */

async function refreshWeekly(force = false) {
  if (!force && _weekly && Date.now() - _weeklyAt < WEEKLY_TTL_MS) return false;
  const res = await one('ranking.getRanking', { rankingType: 'weeklyUserDamages' });
  const items = Array.isArray(res) ? res : res?.items;
  if (!Array.isArray(items) || !items.length) throw new Error('classifica settimanale vuota');
  _weekly = new Map(items.map(x => [x.user, Number(x.value) || 0]));
  _weeklyAt = Date.now();
  _rolling = null;
  return true;
}

function snapDir() { return path.join(deps.cacheDir, SNAP_SUBDIR); }

function stamp(t) { return new Date(t).toISOString().slice(0, 16).replace(/[-:]/g, ''); }

function listSnaps() {
  try {
    return fs.readdirSync(snapDir())
      .map(f => {
        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\.json$/.exec(f);
        return m ? { f, t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
  } catch { return []; }
}

const _snapMemo = new Map();    // file -> Map (al massimo tre, vedi loadSnap)
function loadSnap(f) {
  if (_snapMemo.has(f)) return _snapMemo.get(f);
  let map = null;
  try {
    const { v } = JSON.parse(fs.readFileSync(path.join(snapDir(), f), 'utf8'));
    map = new Map(Object.entries(v || {}));
  } catch (err) { console.error('[tournament] fotografia illeggibile', f, err.message); }
  _snapMemo.set(f, map);
  while (_snapMemo.size > 3) _snapMemo.delete(_snapMemo.keys().next().value);
  return map;
}

async function snapshotWeekly() {
  if (!deps) return;
  try {
    await refreshWeekly(true);
    fs.mkdirSync(snapDir(), { recursive: true });
    fs.writeFileSync(path.join(snapDir(), `${stamp(_weeklyAt)}.json`),
      JSON.stringify({ t: _weeklyAt, v: Object.fromEntries(_weekly) }));
    for (const s of listSnaps()) {
      if (Date.now() - s.t > SNAP_KEEP_MS) fs.unlinkSync(path.join(snapDir(), s.f));
    }
    recomputeAll();
    console.log(`[tournament] fotografia classifica settimanale (${_weekly.size} giocatori)`);
  } catch (err) {
    console.error('[tournament] fotografia fallita:', err.message);
  }
}

function weekStartUtc(ts) {
  const d = new Date(ts);
  const back = (d.getUTCDay() + 6) % 7;   // lunedì = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

/** Danno degli ultimi 7 giorni per giocatore (vedi il punto 1 in testa). */
function rolling() {
  if (_rolling) return _rolling;
  if (!_weekly) return null;
  const now = _weeklyAt;
  const ws = weekStartUtc(now);
  const snaps = listSnaps();
  const finals = snaps.filter(s => s.t < ws && s.t >= ws - 6 * HOUR);
  const prevFinal = finals[finals.length - 1];
  if (!prevFinal) return (_rolling = { map: _weekly, mode: 'week', from: ws });
  const P = loadSnap(prevFinal.f);
  if (!P) return (_rolling = { map: _weekly, mode: 'week', from: ws });

  const target = now - WEEK;
  const back = snaps
    .filter(s => s.t >= ws - WEEK && s.t < ws && Math.abs(s.t - target) <= 4 * HOUR)
    .sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target))[0];
  const out = new Map(_weekly);
  let mode;
  if (back) {
    const B = back.f === prevFinal.f ? P : loadSnap(back.f);
    for (const [u, v] of P) out.set(u, (out.get(u) || 0) + Math.max(0, v - (B?.get(u) || 0)));
    mode = 'rolling';
  } else {
    const left = 1 - Math.min(1, Math.max(0, (now - ws) / WEEK));
    for (const [u, v] of P) out.set(u, (out.get(u) || 0) + v * left);
    mode = 'estimate';
  }
  return (_rolling = { map: out, mode, from: now - WEEK });
}

/* ── Squadre ────────────────────────────────────────────────────────── */

function sumRoster(roster) {
  const map = rolling()?.map;
  let potential = 0, fighters = 0;
  for (const u of roster) {
    const v = map?.get(u) || 0;
    potential += v;
    if (v > 0) fighters++;
  }
  return { potential, fighters };
}

async function refreshTeams(id) {
  const res = await one('tournamentTeam.getByTournamentId', { tournamentId: id });
  const raw = Array.isArray(res) ? res : res?.items;
  if (!Array.isArray(raw)) throw new Error(`squadre di ${id}: forma inattesa`);
  const byUser = new Map();
  const dmg = new Map();
  const rows = raw.map(t => {
    const roster = t.participants || [];
    for (const u of roster) byUser.set(u, t._id);
    dmg.set(t._id, t.damageByEntity || {});
    const tourFighters = roster.filter(u => (t.damageByEntity?.[u] || 0) > 0).length;
    return {
      _id: t._id,
      number: t.number,
      mus: t.mus || [],
      countries: t.countries || [],
      colorScheme: t.colorScheme || null,
      status: t.status || null,
      totalDamage: t.totalDamage || 0,
      roster: roster.length,
      tourFighters,
      ...sumRoster(roster),
      _participants: roster,
    };
  });
  _teams.set(id, { at: Date.now(), rows, byUser, dmg });
}

/** Dopo un giro della classifica, i numeri delle squadre già in memoria. */
function recomputeAll() {
  for (const entry of _teams.values()) {
    for (const r of entry.rows) Object.assign(r, sumRoster(r._participants));
  }
}

/* ── 2. Partite finite: danno per round ─────────────────────────────── */

function loadBattles() {
  if (!_battles) _battles = deps.readCache?.(BATTLES_FILE, {}) || {};
  return _battles;
}

async function refreshBattles(t) {
  const store = loadBattles();
  const want = [];
  for (const r of Object.values(t.rounds || {})) {
    for (const m of r.matches || []) if (m.battle && m.wonBy && !store[m.battle]) want.push(m.battle);
  }
  if (!want.length) return;
  for (let i = 0; i < want.length; i += 50) {
    const chunk = want.slice(i, i + 50);
    const res = await deps.trpcBatch(chunk.map(id => ['battle.getById', { battleId: id }]));
    res.forEach((b, k) => {
      if (!b?._id) return;
      store[chunk[k]] = [b.attacker?.damages || 0, b.defender?.damages || 0, (b.roundsHistory || []).length || 1];
    });
  }
  deps.writeCache?.(BATTLES_FILE, store);
}

/* ── Modello (stesso di src/tournament/model.js) ─────────────────────── */

const DEFAULT_K = { potential: 0.95, average: 0.85 };
const MIN_GAMES = 30;
const FLOOR = 1e3;
const sig = z => 1 / (1 + Math.exp(-z));
const lr = (a, b, floor) => Math.log(Math.max(a || 0, floor) / Math.max(b || 0, floor));

/** Forma = danno per round sulle partite finite PRIMA del turno `upTo`. */
function formUpTo(t, battles, upTo) {
  const out = new Map();
  for (const [n, r] of Object.entries(t.rounds || {})) {
    if (Number(n) >= upTo) continue;
    for (const m of r.matches || []) {
      const b = m.wonBy && m.battle && battles[m.battle];
      if (!b) continue;
      for (const [team, d] of [[m.attacker, b[0]], [m.defender, b[1]]]) {
        const f = out.get(team) || { d: 0, r: 0 };
        f.d += d; f.r += b[2];
        out.set(team, f);
      }
    }
  }
  return out;
}

function fitLogistic(rows, nVar) {
  let b = new Array(nVar).fill(0);
  for (let it = 0; it < 4000; it++) {
    const g = new Array(nVar).fill(0);
    for (const r of rows) {
      const p = sig(r.x.reduce((s, v, j) => s + b[j] * v, 0));
      for (let j = 0; j < nVar; j++) g[j] += ((r.y ? 1 : 0) - p) * r.x[j];
    }
    b = b.map((v, j) => v + 0.1 * g[j] / rows.length);
  }
  return b;
}

function fitModel(t, strength, battles, metric) {
  const single = [], combo = [];
  const rounds = Object.entries(t.rounds || {}).map(([n, r]) => [Number(n), r]).sort((a, b) => a[0] - b[0]);
  for (const [n, r] of rounds) {
    const form = formUpTo(t, battles, n);
    for (const m of r.matches || []) {
      if (!m.wonBy || !m.attacker || !m.defender) continue;
      const a = strength.get(m.attacker), d = strength.get(m.defender);
      if (!a || !d) continue;
      const x1 = lr(a[metric], d[metric], FLOOR);
      const y = m.wonBy === 'attacker';
      single.push({ x: [x1], y });
      const fa = form.get(m.attacker), fd = form.get(m.defender);
      if (fa && fd) combo.push({ x: [x1, lr(fa.d / fa.r, fd.d / fd.r, 1)], y });
    }
  }
  const k = single.length >= MIN_GAMES ? fitLogistic(single, 1)[0] : DEFAULT_K[metric];
  const both = combo.length >= MIN_GAMES ? fitLogistic(combo, 2) : null;
  return { k, k1: both?.[0] ?? null, k2: both?.[1] ?? null };
}

function predict(model, a, d, fa, fd, metric) {
  const x1 = lr(a[metric], d[metric], FLOOR);
  if (model.k2 != null && fa && fd) return sig(model.k1 * x1 + model.k2 * lr(fa.d / fa.r, fd.d / fd.r, 1));
  return sig(model.k * x1);
}

/* ── 3. Registro delle previsioni ───────────────────────────────────── */

function loadPreds() {
  if (!_preds) _preds = deps.readCache?.(PREDS_FILE, {}) || {};
  return _preds;
}

async function recordPredictions(t) {
  const entry = _teams.get(t._id);
  if (!entry || t.status === 'ended') return;
  const strength = new Map(entry.rows.map(r => [r._id, { potential: r.potential, average: r.fighters ? r.potential / r.fighters : 0 }]));
  const battles = loadBattles();
  const models = { potential: fitModel(t, strength, battles, 'potential'), average: fitModel(t, strength, battles, 'average') };
  const form = formUpTo(t, battles, Infinity);
  const book = (loadPreds()[t._id] ||= {});
  const fresh = [];
  for (const [n, r] of Object.entries(t.rounds || {})) {
    for (const m of r.matches || []) {
      const key = `${n}:${m.matchIndex}`;
      if (book[key] || m.wonBy) continue;
      const ta = m.attacker || (m.possibleAttackerTeamIds?.length === 1 ? m.possibleAttackerTeamIds[0] : null);
      const td = m.defender || (m.possibleDefenderTeamIds?.length === 1 ? m.possibleDefenderTeamIds[0] : null);
      const a = strength.get(ta), d = strength.get(td);
      if (!a || !d) continue;
      book[key] = {
        a: ta, d: td,
        p: ['potential', 'average'].map(metric => Math.round(predict(models[metric], a, d, form.get(ta), form.get(td), metric) * 1000) / 1000),
        late: false,
        at: Date.now(),
      };
      if (m.battle) fresh.push([key, m.battle]);
    }
  }
  // Una partita già avviata al primo sguardo non è una previsione onesta.
  for (let i = 0; i < fresh.length; i += 50) {
    const chunk = fresh.slice(i, i + 50);
    const res = await deps.trpcBatch(chunk.map(([, id]) => ['battle.getById', { battleId: id }]));
    res.forEach((b, k) => {
      const rec = book[chunk[k][0]];
      const started = !b || (b.attacker?.wonRoundsCount || 0) + (b.defender?.wonRoundsCount || 0) > 0
        || Date.now() - Date.parse(b.createdAt || 0) > LATE_AFTER_MS;
      if (started) rec.late = true;
    });
  }
  deps.writeCache?.(PREDS_FILE, _preds);
}

/** Come sono andate le previsioni registrate di un torneo. */
function predictionReport(t) {
  const book = loadPreds()[t._id] || {};
  const byKey = {};
  const outcome = new Map();
  for (const [n, r] of Object.entries(t.rounds || {})) {
    for (const m of r.matches || []) if (m.wonBy) outcome.set(`${n}:${m.matchIndex}`, m.wonBy === 'attacker');
  }
  const report = {};
  ['potential', 'average'].forEach((metric, i) => {
    let n = 0, hits = 0, brier = 0;
    const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([lo, hi]) => ({ lo, hi, n: 0, p: 0, won: 0 }));
    for (const [key, rec] of Object.entries(book)) {
      if (rec.late || !outcome.has(key)) continue;
      const aWon = outcome.get(key);
      const p = rec.p[i];
      n++;
      brier += (p - (aWon ? 1 : 0)) ** 2;
      const fav = p >= 0.5 ? aWon : !aWon;
      if (fav) hits++;
      const pf = Math.max(p, 1 - p);
      const b = buckets.find(x => pf >= x.lo && pf < x.hi);
      if (b) { b.n++; b.p += pf; b.won += fav ? 1 : 0; }
    }
    report[metric] = { n, hits, brier: n ? brier / n : null, buckets: buckets.filter(b => b.n).map(b => ({ lo: b.lo, n: b.n, p: b.p / b.n, won: b.won / b.n })) };
  });
  for (const [key, rec] of Object.entries(book)) byKey[key] = [rec.p[0], rec.p[1], rec.late ? 1 : 0];
  const ats = Object.values(book).map(r => r.at);
  return { since: ats.length ? Math.min(...ats) : null, report, byKey };
}

/* ── Giro ───────────────────────────────────────────────────────────── */

async function pollTournament() {
  if (!deps) return;
  try {
    const changed = await refreshWeekly().catch(err => { _lastError = `classifica: ${err.message}`; return false; });
    const res = await one('tournament.getManyPaginated', { limit: LIST_LIMIT });
    const items = (Array.isArray(res) ? res : res?.items || [])
      .filter(t => t && t._id && t.type && (t.startAt || t.status === 'active'));
    if (items.length) { _list = items; _listAt = Date.now(); }

    // L'ultimo torneo di ogni tipo si riaggiorna sempre se in corso; gli
    // altri solo la prima volta (conclusi, non cambiano più).
    for (const type of ['mu', 'country']) {
      const t = _list.find(x => x.type === type);
      if (!t) continue;
      if (t.status !== 'ended' || !_teams.has(t._id)) await refreshTeams(t._id);
      await refreshBattles(t);
      await recordPredictions(t);
    }
    if (changed) recomputeAll();
    _lastError = null;
  } catch (err) {
    _lastError = err.message;
    console.error('[tournament] giro fallito:', err.message);
  }
}

/* ── Rotte ──────────────────────────────────────────────────────────── */

/** `id` mancante = ultimo torneo del tipo. Un torneo più vecchio della
 *  lista in memoria si carica a richiesta. */
async function readTournament({ type, id, me }) {
  if (!_list.length) await pollTournament();
  const ofType = _list.filter(t => t.type === type);
  const t = (id && _list.find(x => x._id === id)) || ofType[0];
  if (!t) return { list: listMeta(), tournament: null, teams: [] };
  if (!_teams.has(t._id)) {
    if (!_weekly) await refreshWeekly().catch(() => {});
    await refreshTeams(t._id);
    await refreshBattles(t).catch(() => {});
  }
  const entry = _teams.get(t._id);
  const { registered, ...rest } = t;
  const dir = type === 'mu' ? muDirectoryMap() : null;
  const roll = rolling();

  // Partite finite di QUESTO torneo, per la forma.
  const store = loadBattles();
  const battles = {};
  for (const r of Object.values(t.rounds || {})) {
    for (const m of r.matches || []) if (m.battle && store[m.battle]) battles[m.battle] = store[m.battle];
  }

  return {
    list: listMeta(),
    tournament: {
      ...rest,
      // Gli elenchi degli iscritti non servono: solo quanti sono.
      registeredCount: (type === 'mu' ? registered?.mus : registered?.countries)?.length ?? 0,
    },
    teams: entry.rows.map(({ _participants, ...r }) => {
      // Nome, stemma e settimanale dell'unità dalla directory che il server
      // ha già (/mu-directory): così il client non deve scaricarla solo
      // per disegnare le caselle.
      const mu = dir?.get(r.mus[0]);
      return mu ? {
        ...r, name: mu.name, avatarUrl: mu.avatarUrl || null, country: mu.country || null,
        muWeekly: mu.rankings?.muWeeklyDamages?.value ?? 0, members: mu.memberCount || 0,
      } : r;
    }),
    battles,
    predictions: predictionReport(t),
    weeklyOk: !!_weekly,
    weeklyMode: roll?.mode || null,
    weeklyAt: _weeklyAt || null,
    teamsAt: entry.at,
    myTeam: me ? entry.byUser.get(me) || null : null,
  };
}

/** Iscritti di una squadra: danno degli ultimi 7 giorni e nel torneo. Le
 *  squadre delle nazioni hanno migliaia di iscritti: i primi `limit`. */
function readTournamentTeam({ id, team, limit = 60 }) {
  const entry = _teams.get(id);
  const row = entry?.rows.find(r => r._id === team);
  if (!row) return null;
  const map = rolling()?.map;
  const dmg = entry.dmg.get(team) || {};
  const rows = row._participants.map(u => ({ u, w: Math.round(map?.get(u) || 0), t: dmg[u] || 0 }))
    .sort((a, b) => (b.t - a.t) || (b.w - a.w));
  return {
    total: rows.length,
    inTournament: rows.filter(r => r.t > 0).length,
    withDamage: rows.filter(r => r.w > 0).length,
    rows: rows.slice(0, limit),
  };
}

let _dirSrc = null, _dirMap = null;
function muDirectoryMap() {
  const data = deps.readCacheShared?.('mu-directory', { data: [] })?.data;
  if (!Array.isArray(data)) return null;
  if (data !== _dirSrc) { _dirSrc = data; _dirMap = new Map(data.map(m => [m._id, m])); }
  return _dirMap;
}

function listMeta() {
  return _list.map(t => ({ _id: t._id, type: t.type, name: t.name, status: t.status, startAt: t.startAt || null }));
}

function statoTournament() {
  const snaps = listSnaps();
  return {
    tornei: _list.length,
    listaAt: _listAt ? new Date(_listAt).toISOString() : null,
    classificaAt: _weeklyAt ? new Date(_weeklyAt).toISOString() : null,
    giocatoriInClassifica: _weekly?.size || 0,
    settimana: rolling()?.mode || null,
    fotografie: snaps.length,
    primaFotografia: snaps[0] ? new Date(snaps[0].t).toISOString() : null,
    partiteConForma: Object.keys(loadBattles()).length,
    previsioniRegistrate: Object.values(loadPreds()).reduce((s, b) => s + Object.keys(b).length, 0),
    squadreInMemoria: [..._teams.values()].reduce((s, e) => s + e.rows.length, 0),
    errore: _lastError,
  };
}

module.exports = {
  initTournament,
  pollTournament,
  snapshotWeekly,
  readTournament,
  readTournamentTeam,
  statoTournament,
};
