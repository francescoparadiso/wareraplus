// ═══════════════════════════════════════════════════════════════════════
// WarEra+ — Tornei: forza delle squadre già calcolata (/tournament)
// -----------------------------------------------------------------------
// La sezione Tornei del client (src/tournament/*) misura ogni squadra col
// danno settimanale dei suoi ISCRITTI. Per farlo dal browser deve scaricare
// la classifica settimanale INTERA dei giocatori (~510 KB gzip, ~13.700
// righe) e le squadre con tutti gli iscritti (~180 KB gzip per il torneo MU):
// 3-4 secondi di attesa alla prima apertura, segnalati dall'utente.
//
// Qui lo si fa una volta per tutti:
//   · ogni 3 minuti la lista degli ultimi tornei (tabellone incluso) e le
//     squadre dell'ultimo torneo di ogni tipo;
//   · ogni 10 minuti la classifica settimanale (cambia di continuo, ma la
//     forza di una squadra non si sposta in dieci minuti);
//   · i tornei conclusi restano in memoria così come sono.
// Il client riceve il tabellone e, per squadra, i numeri già sommati
// (iscritti, combattenti, potenziale): decine di KB invece di settecento.
//
// "La mia unità": il client manda `me` (l'id del suo personaggio, quello
// che ha detto in Giocatori) e il server risponde con la sua squadra —
// così gli iscritti (8.000 id) non viaggiano.
//
// Tutto pubblico su api6, niente chiave. Se questa rotta manca o non
// risponde il client fa da sé, come prima (src/tournament/api.js).
// ═══════════════════════════════════════════════════════════════════════

const LIST_LIMIT = 8;
const WEEKLY_TTL_MS = 10 * 60 * 1000;

let deps = null;
let _list = [];                 // tornei, dal più recente
let _listAt = 0;
const _teams = new Map();       // tournamentId -> { at, rows, byUser }
let _weekly = null;             // Map userId -> danno settimanale
let _weeklyAt = 0;
let _lastError = null;

function initTournament(tools) {
  deps = tools;
}

async function one(proc, input) {
  const [res] = await deps.trpcBatch([[proc, input]]);
  return res;
}

async function refreshWeekly(force = false) {
  if (!force && _weekly && Date.now() - _weeklyAt < WEEKLY_TTL_MS) return;
  const res = await one('ranking.getRanking', { rankingType: 'weeklyUserDamages' });
  const items = Array.isArray(res) ? res : res?.items;
  if (!Array.isArray(items) || !items.length) throw new Error('classifica settimanale vuota');
  _weekly = new Map(items.map(x => [x.user, Number(x.value) || 0]));
  _weeklyAt = Date.now();
}

/** Le squadre di un torneo, ridotte ai numeri che servono al client. */
async function refreshTeams(id) {
  const res = await one('tournamentTeam.getByTournamentId', { tournamentId: id });
  const raw = Array.isArray(res) ? res : res?.items;
  if (!Array.isArray(raw)) throw new Error(`squadre di ${id}: forma inattesa`);
  const byUser = new Map();
  const rows = raw.map(t => {
    const roster = t.participants || [];
    let potential = 0, fighters = 0;
    for (const u of roster) {
      byUser.set(u, t._id);
      const v = _weekly?.get(u) || 0;
      potential += v;
      if (v > 0) fighters++;
    }
    return {
      _id: t._id,
      number: t.number,
      mus: t.mus || [],
      countries: t.countries || [],
      colorScheme: t.colorScheme || null,
      status: t.status || null,
      totalDamage: t.totalDamage || 0,
      roster: roster.length,
      fighters,
      potential,
      // Per ricalcolare dopo un giro della classifica senza riscaricare.
      _participants: roster,
    };
  });
  _teams.set(id, { at: Date.now(), rows, byUser });
}

/** Dopo un giro della classifica, i numeri delle squadre già in memoria. */
function recomputeAll() {
  for (const entry of _teams.values()) {
    for (const r of entry.rows) {
      let potential = 0, fighters = 0;
      for (const u of r._participants) {
        const v = _weekly?.get(u) || 0;
        potential += v;
        if (v > 0) fighters++;
      }
      r.potential = potential;
      r.fighters = fighters;
    }
  }
}

async function pollTournament() {
  if (!deps) return;
  try {
    const weeklyWasAt = _weeklyAt;
    await refreshWeekly().catch(err => { _lastError = `classifica: ${err.message}`; });
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
    }
    if (_weeklyAt !== weeklyWasAt) recomputeAll();
    _lastError = null;
  } catch (err) {
    _lastError = err.message;
    console.error('[tournament] giro fallito:', err.message);
  }
}

/** Risposta della rotta. `id` mancante = ultimo torneo del tipo. Un torneo
 *  più vecchio della lista in memoria si carica a richiesta. */
async function readTournament({ type, id, me }) {
  if (!_list.length) await pollTournament();
  const ofType = _list.filter(t => t.type === type);
  const t = (id && _list.find(x => x._id === id)) || ofType[0];
  if (!t) return { list: listMeta(), tournament: null, teams: [] };
  if (!_teams.has(t._id)) {
    if (!_weekly) await refreshWeekly().catch(() => {});
    await refreshTeams(t._id);
  }
  const entry = _teams.get(t._id);
  const { registered, ...rest } = t;
  const dir = type === 'mu' ? muDirectoryMap() : null;
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
    weeklyOk: !!_weekly,
    weeklyAt: _weeklyAt || null,
    teamsAt: entry.at,
    myTeam: me ? entry.byUser.get(me) || null : null,
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
  return {
    tornei: _list.length,
    listaAt: _listAt ? new Date(_listAt).toISOString() : null,
    classificaAt: _weeklyAt ? new Date(_weeklyAt).toISOString() : null,
    giocatoriInClassifica: _weekly?.size || 0,
    squadreInMemoria: [..._teams.values()].reduce((s, e) => s + e.rows.length, 0),
    errore: _lastError,
  };
}

module.exports = {
  initTournament,
  pollTournament,
  readTournament,
  statoTournament,
};
