/* ══════════════════════════════════════════════════════════════
   WarEra+ — Tornei: dal dato grezzo al tabellone
   ------------------------------------------------------------------
   Com'è fatto un torneo (verificato sul torneo MU del 23 ottobre 2026,
   457 squadre, e su quello delle nazioni del 9 ottobre, 8 squadre):

   · `rounds` = { "1": {matches}, "2": …}. Ogni partita ha `attacker` e
     `defender` (id di squadra, solo quando sono decisi), `battle` (quando
     si gioca), `wonBy` ('attacker'|'defender', a partita finita) e
     `predecessors` = { attacker: i, defender: j }, gli indici delle
     partite del turno PRIMA da cui escono i due posti.
   · `possibleAttackerTeamIds` / `possibleDefenderTeamIds`: chi PUÒ
     ancora finire in quel posto. È il gioco a tenerli aggiornati — una
     squadra eliminata sparisce dalle liste dei turni dopo — quindi i
     "possibili avversari" si leggono da lì, non si ricostruiscono.
   · Il turno 1 dei tornei MU è di QUALIFICAZIONE (`isQualificationRound`):
     201 partite irregolari, mentre 55 unità (`autoQualify1stRound`)
     entrano dirette nel turno 2. Dal turno 2 in poi l'albero è binario
     regolare. Per questo la qualificazione non è una colonna del
     tabellone: compare come provenienza nel posto del turno 2.

   ── LA FORZA DI UNA SQUADRA ────────────────────────────────────────
   Richiesta dell'utente: ordinare gli avversari per difficoltà "in base
   al danno settimanale che fanno, in media/potenziale".
   · POTENZIALE = somma del danno settimanale dei suoi ISCRITTI al torneo
     (`participants`), non di tutta l'unità o la nazione: chi non è nella
     squadra non combatte per lei.
   · MEDIA = lo stesso diviso per gli iscritti che questa settimana hanno
     colpito almeno una volta (stessa scelta della scheda unità, "per
     combattente"): un iscritto eco non deve far sembrare la squadra più
     debole di quanto sono i suoi soldati.
   ⚠️ È il danno della SETTIMANA IN CORSO, ovunque sia stato fatto
   (battaglie del torneo comprese), e riparte da zero a inizio settimana:
   all'inizio della settimana tutte le squadre sembrano più deboli
   insieme. Il confronto fra squadre resta giusto, i valori assoluti no.
   Se la classifica dei giocatori non arriva si ripiega sul settimanale
   dell'entità (directory MU, rankings delle nazioni) e la vista lo dice.
   ══════════════════════════════════════════════════════════════ */

import { countryName } from '../mu/ui.js';

export const METRICS = ['potential', 'average'];

/**
 * @param {object} t        torneo (tournament.getById)
 * @param {object[]} rawTeams  tournamentTeam.getByTournamentId
 * @param {{ weekly: Map|null, muDir: Map, nations: Map }} src
 */
export function buildModel(t, rawTeams, src) {
  const type = t.type === 'country' ? 'country' : 'mu';
  const teams = new Map();
  for (const raw of rawTeams || []) teams.set(raw._id, buildTeam(raw, type, src));

  const roundNums = Object.keys(t.rounds || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const rounds = roundNums.map(n => {
    const r = t.rounds[n];
    return {
      n,
      qual: !!r.isQualificationRound,
      cases: r.cases ?? null,
      skillValue: r.skillValue ?? null,
      matches: (r.matches || []).map(m => ({
        idx: m.matchIndex,
        a: m.attacker || null,
        d: m.defender || null,
        pa: m.possibleAttackerTeamIds || (m.attacker ? [m.attacker] : []),
        pd: m.possibleDefenderTeamIds || (m.defender ? [m.defender] : []),
        battle: m.battle || null,
        wonBy: m.wonBy || null,
        pred: m.predecessors || null,
      })).sort((x, y) => x.idx - y.idx),
    };
  });

  // Livelli del tabellone = turni NON di qualificazione. Mappa inversa
  // figlio → padre per risalire l'albero (settore di una squadra).
  const levels = rounds.filter(r => !r.qual);
  const parent = levels.map(() => new Map());
  levels.forEach((r, L) => {
    if (L === 0) return;
    for (const m of r.matches) {
      if (m.pred?.attacker != null) parent[L - 1].set(m.pred.attacker, m.idx);
      if (m.pred?.defender != null) parent[L - 1].set(m.pred.defender, m.idx);
    }
  });

  // Per ogni partita del primo livello, da quale qualificazione arriva
  // ogni posto (solo tornei con turno di qualificazione).
  const qual = rounds.find(r => r.qual) || null;

  const model = {
    id: t._id,
    type,
    name: t.name || '',
    status: t.status,
    startAt: t.startAt || null,
    activeRound: t.activeRound ?? null,
    roundsCount: t.roundsCount ?? rounds.length,
    maxRarity: t.maxRarity || null,
    winner: t.winnerTournamentTeam || null,
    registeredCount: (type === 'mu' ? t.registered?.mus : t.registered?.countries)?.length ?? 0,
    autoQualified: new Set(t.autoQualify1stRound || []),
    weeklyOk: !!src.weekly,
    teams,
    rounds,
    levels,
    parent,
    qual,
  };
  rankTeams(model);
  return model;
}

function buildTeam(raw, type, { weekly, muDir, nations }) {
  const entityIds = type === 'mu' ? (raw.mus || []) : (raw.countries || []);
  const roster = raw.participants || [];
  let potential = 0, fighters = 0;
  if (weekly) {
    for (const u of roster) {
      const v = weekly.get(u) || 0;
      potential += v;
      if (v > 0) fighters++;
    }
  }

  // Settimanale dell'entità (unità o somma delle nazioni): dato di
  // contorno, e ripiego se la classifica dei giocatori manca.
  let entityWeekly = 0, members = 0;
  let name = '', avatarUrl = null, homeCountry = null;
  if (type === 'mu') {
    const mu = muDir.get(entityIds[0]);
    if (mu) {
      name = mu.name || '';
      avatarUrl = mu.avatarUrl || null;
      homeCountry = mu.country || null;
      entityWeekly = mu.rankings?.muWeeklyDamages?.value ?? 0;
      members = mu.memberCount || 0;
    }
  } else {
    // Le squadre delle nazioni sono coalizioni di 9-27 nazioni: si
    // ordinano dalla più forte, così il nome e le prime bandiere dicono
    // chi la trascina.
    const sorted = [...entityIds].sort((x, y) => (nationWeekly(nations, y) - nationWeekly(nations, x)));
    entityIds.splice(0, entityIds.length, ...sorted);
    for (const c of entityIds) entityWeekly += nationWeekly(nations, c);
    if (entityIds.length === 1) name = countryName(entityIds[0]);
  }
  if (!weekly) {
    potential = entityWeekly;
    fighters = type === 'mu' ? members : roster.length;
  }

  return {
    id: raw._id,
    number: raw.number,
    type,
    entityIds,
    name,
    avatarUrl,
    homeCountry,
    color: raw.colorScheme || null,
    roster: roster.length,
    participants: roster,
    fighters,
    potential,
    average: fighters ? potential / fighters : 0,
    entityWeekly,
    tourDamage: raw.totalDamage || 0,
    status: raw.status || null,        // 'active' | 'eliminated' | 'winner'
    rank: { potential: null, average: null },
  };
}

function nationWeekly(nations, id) {
  return nations.get(id)?.rankings?.weeklyCountryDamages?.value ?? 0;
}

/** Posizione di forza fra le squadre ancora in gara (o fra tutte, a
 *  torneo concluso), per le due misure. */
function rankTeams(model) {
  const pool = [...model.teams.values()].filter(t => model.status === 'ended' || t.status !== 'eliminated');
  for (const metric of METRICS) {
    [...pool].sort((x, y) => y[metric] - x[metric]).forEach((t, i) => { t.rank[metric] = i + 1; });
  }
  model.aliveCount = pool.length;
}

/** Etichetta di una squadra. Le MU hanno il loro nome; le squadre delle
 *  nazioni sono coalizioni senza nome, e prendono quello delle prime due
 *  nazioni (le più forti, vedi buildTeam). */
export function teamLabel(team, fmt) {
  if (!team) return '';
  if (team.name) return team.name;
  if (team.type === 'country' && team.entityIds.length) {
    const lead = team.entityIds.slice(0, 2).map(countryName).join(', ');
    const more = team.entityIds.length - 2;
    return more > 0 ? `${lead} ${fmt.more(more)}` : lead;
  }
  return fmt.teamN(team.number);
}

/* ── Turni: nomi dalla fine ─────────────────────────────────────── */

/** 'final' | 'semi' | 'quarter' | 'qual' | null (= "Turno n"). */
export function roundKind(model, round) {
  if (round.qual) return 'qual';
  const last = model.rounds[model.rounds.length - 1]?.n;
  if (round.n === last) return 'final';
  if (round.n === last - 1) return 'semi';
  if (round.n === last - 2) return 'quarter';
  return null;
}

export function matchState(m) {
  if (m.wonBy) return 'done';
  if (m.battle) return 'live';
  return 'upcoming';
}

/* ── Albero: discendenti di una partita ─────────────────────────── */

/** Colonne del sottoalbero che ha per radice la partita `idx` del livello
 *  `L`, profondo `depth` livelli: [[partite del livello più basso], …,
 *  [radice]]. Si segue `predecessors`, non l'aritmetica 2k/2k+1. Un posto
 *  senza predecessore (unità qualificata d'ufficio) lascia un buco: lo
 *  si riempie con null perché le righe restino allineate. */
export function subtree(model, L, idx, depth) {
  const cols = [];
  let cur = [model.levels[L]?.matches.find(m => m.idx === idx) || null];
  for (let k = 0; k < depth; k++) {
    cols.unshift(cur);
    const lvl = L - k - 1;
    if (lvl < 0 || k === depth - 1) break;
    const below = model.levels[lvl].matches;
    const byIdx = new Map(below.map(m => [m.idx, m]));
    cur = cur.flatMap(m => [
      m?.pred?.attacker != null ? byIdx.get(m.pred.attacker) || null : null,
      m?.pred?.defender != null ? byIdx.get(m.pred.defender) || null : null,
    ]);
  }
  return cols;
}

/** Le "viste" del tabellone. Fino a 5 livelli si vede tutto insieme; oltre,
 *  una fase finale (ultimi 4 livelli) e un settore per ogni partita del
 *  primo livello della fase finale, ognuno col suo sottoalbero dal primo
 *  livello in su. Per il torneo MU: 8 settori da 16 partite di turno 2,
 *  più la fase finale da quarti di ottavo (8 partite) alla finale. */
export function bracketViews(model) {
  const M = model.levels.length;
  if (!M) return [];
  if (M <= 5) return [{ id: 'all', L: M - 1, idx: 0, depth: M }];
  const finalDepth = 4;
  const sectorL = M - finalDepth;
  const views = [{ id: 'final', L: M - 1, idx: 0, depth: finalDepth }];
  model.levels[sectorL].matches.forEach((m, i) => {
    views.push({ id: `s${i}`, sector: i + 1, L: sectorL, idx: m.idx, depth: sectorL + 1 });
  });
  return views;
}

/** Dove sta una squadra nel tabellone, come { L, idx } sui livelli:
 *  l'ultima partita che ha GIOCATO o sta giocando (non l'ultima in cui
 *  è solo "possibile": quella sarebbe sempre la finale). Se non ne ha
 *  ancora una decisa, la prima in cui può entrare; se è uscita in
 *  qualificazione, la partita del primo livello in cui sarebbe entrata. */
export function teamPosition(model, teamId) {
  for (let L = model.levels.length - 1; L >= 0; L--) {
    const m = model.levels[L].matches.find(x => x.a === teamId || x.d === teamId);
    if (m) return { L, idx: m.idx };
  }
  for (let L = 0; L < model.levels.length; L++) {
    const m = model.levels[L].matches.find(x => x.pa.includes(teamId) || x.pd.includes(teamId));
    if (m) return { L, idx: m.idx };
  }
  if (model.qual) {
    const q = model.qual.matches.find(x => x.a === teamId || x.d === teamId);
    if (q) {
      const m = model.levels[0]?.matches.find(x => x.pred?.attacker === q.idx || x.pred?.defender === q.idx);
      if (m) return { L: 0, idx: m.idx };
    }
  }
  return null;
}

/** La vista del tabellone che contiene la squadra. */
export function viewForTeam(model, views, teamId) {
  const pos = teamPosition(model, teamId);
  if (!pos || views.length === 1) return views[0]?.id || null;
  const final = views[0];
  const sectorL = final.L - final.depth + 1;
  if (pos.L >= sectorL) return 'final';
  let { L, idx } = pos;
  while (L < sectorL) { idx = model.parent[L].get(idx); L++; if (idx == null) return 'final'; }
  return views.find(v => v.idx === idx && v.L === sectorL)?.id || 'final';
}

/* ── Percorso di una squadra ───────────────────────────────────── */

/**
 * Turno per turno: com'è andata (o come sta andando) e chi può ancora
 * incontrare. Ritorna [{ round, match, side, state, opp, opponents }]:
 * `opp` = avversario deciso, `opponents` = possibili (turni futuri).
 * Si ferma al turno in cui la squadra esce.
 */
export function teamPath(model, teamId) {
  const out = [];
  for (const round of model.rounds) {
    const m = round.matches.find(x => x.a === teamId || x.d === teamId || x.pa.includes(teamId) || x.pd.includes(teamId));
    if (!m) continue;
    const side = (m.a === teamId || m.pa.includes(teamId)) ? 'a' : 'd';
    const other = side === 'a' ? 'd' : 'a';
    const opp = m[other] || (m[`p${other}`].length === 1 ? m[`p${other}`][0] : null);
    const state = matchState(m);
    const mine = m[side] === teamId;
    let result = null;
    if (state === 'done' && mine) result = (m.wonBy === 'attacker') === (side === 'a') ? 'won' : 'lost';
    out.push({
      round, match: m, side, state, result,
      opp,
      opponents: opp ? [opp] : [...m[`p${other}`]],
      // In un turno futuro la squadra stessa può non esserci ancora
      // (deve vincere prima): `certain` dice se il posto è già suo.
      certain: mine || (m[`p${side}`].length === 1),
    });
    if (result === 'lost') break;
  }
  return out;
}

/* ── Difficoltà ─────────────────────────────────────────────────── */

/** Rapporto avversario / squadra scelta → fascia. Le soglie sono larghe
 *  apposta: il danno di una settimana è una stima, e "alla pari" fra 0,85
 *  e 1,18 dice la cosa giusta più spesso di una cifra secca. */
export function difficulty(opp, me, metric) {
  const a = opp?.[metric] || 0;
  const b = me?.[metric] || 0;
  if (!b) return a ? 'muchHarder' : 'even';
  const r = a / b;
  if (r >= 1.6) return 'muchHarder';
  if (r >= 1.18) return 'harder';
  if (r > 0.85) return 'even';
  if (r > 0.6) return 'easier';
  return 'muchEasier';
}
