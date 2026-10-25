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
  const weeklyOk = src.weeklyOk ?? !!src.weekly;
  const teams = new Map();
  for (const raw of rawTeams || []) teams.set(raw._id, buildTeam(raw, type, { ...src, weeklyOk }));

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
    registeredCount: t.registeredCount ?? (type === 'mu' ? t.registered?.mus : t.registered?.countries)?.length ?? 0,
    autoQualified: new Set(t.autoQualify1stRound || []),
    weeklyOk,
    myTeam: src.myTeam || null,      // dal server, quando gli iscritti non arrivano al client
    teams,
    rounds,
    levels,
    parent,
    qual,
  };
  rankTeams(model);
  calibrate(model);
  return model;
}

/** Una squadra. `raw` è o la squadra del gioco (con `participants`, e la
 *  forza si somma qui) o la riga già calcolata da /tournament del server
 *  (`potential`, `fighters`, `roster` numerico, nome e stemma dell'unità). */
function buildTeam(raw, type, { weekly, weeklyOk, muDir, nations }) {
  const entityIds = [...(type === 'mu' ? (raw.mus || []) : (raw.countries || []))];
  const pre = typeof raw.potential === 'number';
  const roster = pre ? [] : (raw.participants || []);
  let potential = 0, fighters = 0;
  if (pre) {
    potential = raw.potential;
    fighters = raw.fighters || 0;
  } else if (weekly) {
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
  if (type === 'mu' && pre && raw.name) {
    name = raw.name;
    avatarUrl = raw.avatarUrl || null;
    homeCountry = raw.country || null;
    entityWeekly = raw.muWeekly || 0;
    members = raw.members || 0;
  } else if (type === 'mu') {
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
  const rosterCount = pre ? (raw.roster || 0) : roster.length;
  if (!weeklyOk) {
    potential = entityWeekly;
    fighters = type === 'mu' ? members : rosterCount;
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
    roster: rosterCount,
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

/* ══════════════════════════════════════════════════════════════
   Probabilità di vittoria
   ------------------------------------------------------------------
   Richiesta dell'utente: una percentuale di possibile vittoria sulle
   varie unità. Il modello è il più semplice che regge ai dati:

       P(A batte B) = a^k / (a^k + b^k)

   con a, b la forza delle due squadre (potenziale o media). k si TARA
   sulle partite già finite del torneo stesso, per massima verosimiglianza:
   misurato sul torneo MU del 23 ottobre 2026 (329 partite di turno 1 e 2),
   k = 0,95 sul potenziale, e il favorito ha vinto 250 volte su 329 (76%).
   La taratura regge: dove il modello diceva 96% le vittorie vere erano il
   96%, dove diceva 55% erano il 54%. Sulla media va peggio (73%, k 0,85).
   Sotto le 30 partite giocate (i tornei delle nazioni ne hanno 7 in tutto)
   k non si stima: si usa quello misurato lì, e la vista lo dice.

   ⚠️ Il danno settimanale dei giocatori comprende i colpi del torneo
   stesso: chi ha vinto ha giocato una partita in più. Pesa poco (7,6 M
   nel torneo contro 335 M di settimanale per la seconda unità più forte),
   ma è il motivo per cui la taratura è un po' ottimista.

   Una partita in corso tiene conto del punteggio: la probabilità della
   battaglia si scompone in quella di un round (q, tale che vincere `toWin`
   round prima dell'altro faccia P), e si riparte dal punteggio vero.

   Lungo il tabellone le probabilità si PROPAGANO: chi occupa un posto non
   ancora deciso è la distribuzione dei vincitori della partita prima.
   Le due metà di una partita vengono da rami disgiunti, quindi la
   probabilità di incontrarsi è il prodotto delle due di arrivarci.
   ══════════════════════════════════════════════════════════════ */

export const DEFAULT_K = { potential: 0.95, average: 0.85 };
const MIN_GAMES = 30;
const FLOOR = 1e3;   // una squadra a zero non deve dare 0% o 100% secchi

function finishedGames(model) {
  const out = [];
  for (const r of model.rounds) {
    for (const m of r.matches) {
      if (!m.wonBy || !m.a || !m.d) continue;
      const a = model.teams.get(m.a), d = model.teams.get(m.d);
      if (a && d) out.push({ a, d, aWon: m.wonBy === 'attacker' });
    }
  }
  return out;
}

function calibrate(model) {
  const games = finishedGames(model);
  model.k = {};
  model.calib = {};
  for (const metric of METRICS) {
    const hits = games.filter(g => (g.a[metric] > g.d[metric]) === g.aWon).length;
    let k = DEFAULT_K[metric];
    const own = games.length >= MIN_GAMES;
    if (own) {
      let best = -Infinity;
      for (let c = 0.2; c <= 3.001; c += 0.05) {
        let ll = 0;
        for (const g of games) {
          const p = pBeat(g.a[metric], g.d[metric], c);
          ll += Math.log(Math.min(Math.max(g.aWon ? p : 1 - p, 1e-6), 1 - 1e-6));
        }
        if (ll > best) { best = ll; k = Math.round(c * 100) / 100; }
      }
    }
    model.k[metric] = k;
    model.calib[metric] = { n: games.length, hits, own };
  }
}

function pBeat(a, b, k) {
  return 1 / (1 + Math.pow(Math.max(b || 0, FLOOR) / Math.max(a || 0, FLOOR), k));
}

/** Probabilità che `a` batta `b` in una partita secca. */
export function winProb(model, a, b, metric) {
  if (!a || !b) return null;
  return pBeat(a[metric], b[metric], model.k?.[metric] ?? DEFAULT_K[metric]);
}

/** Fascia di difficoltà dalla probabilità di vincere: sempre la stessa
 *  scala in pillole, barre e bordi. */
export function difficultyOf(p) {
  if (p == null) return 'even';
  if (p < 0.2) return 'muchHarder';
  if (p < 0.4) return 'harder';
  if (p < 0.6) return 'even';
  if (p < 0.8) return 'easier';
  return 'muchEasier';
}

/** P di vincere la serie dato il punteggio: `p` è la probabilità della
 *  battaglia intera da 0–0, `toWin` i round che servono. */
function seriesFromScore(p, toWin, a, d) {
  if (a >= toWin) return 1;
  if (d >= toWin) return 0;
  const from = (q, x, y, memo = new Map()) => {
    if (x >= toWin) return 1;
    if (y >= toWin) return 0;
    const key = x * 100 + y;
    if (memo.has(key)) return memo.get(key);
    const v = q * from(q, x + 1, y, memo) + (1 - q) * from(q, x, y + 1, memo);
    memo.set(key, v);
    return v;
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (from(mid, 0, 0) < p) lo = mid; else hi = mid;
  }
  return from((lo + hi) / 2, a, d);
}

/**
 * Probabilità lungo tutto il tabellone per la misura scelta.
 * `scores` = Map battleId → { a, d, toWin } delle partite in corso.
 * Ritorna:
 *   slot(round, match, side) → Map squadra → P di trovarsi in quel posto
 *   champion → Map squadra → P di vincere il torneo
 *   match(round, match) → P che vinca l'attaccante (null se già finita)
 */
export function bracketOdds(model, metric, scores = new Map()) {
  const k = model.k?.[metric] ?? DEFAULT_K[metric];
  const byN = new Map(model.rounds.map(r => [r.n, { r, byIdx: new Map(r.matches.map(m => [m.idx, m])) }]));
  const slots = new Map();
  const wins = new Map();

  const pair = (m, ta, td) => {
    const base = pBeat(model.teams.get(ta)?.[metric], model.teams.get(td)?.[metric], k);
    const s = m.battle && m.a === ta && m.d === td ? scores.get(m.battle) : null;
    return s ? seriesFromScore(base, s.toWin || 2, s.a || 0, s.d || 0) : base;
  };

  function slot(round, m, side) {
    const key = `${round.n}:${m.idx}:${side}`;
    if (slots.has(key)) return slots.get(key);
    let dist;
    const id = m[side] || (m[`p${side}`].length === 1 ? m[`p${side}`][0] : null);
    const pred = m.pred?.[side === 'a' ? 'attacker' : 'defender'];
    const prev = byN.get(round.n - 1);
    if (id) dist = new Map([[id, 1]]);
    else if (pred != null && prev?.byIdx.has(pred)) dist = winners(prev.r, prev.byIdx.get(pred));
    else {
      const poss = m[`p${side}`];
      dist = new Map(poss.map(t => [t, 1 / poss.length]));
    }
    slots.set(key, dist);
    return dist;
  }

  function winners(round, m) {
    const key = `${round.n}:${m.idx}`;
    if (wins.has(key)) return wins.get(key);
    let out;
    if (m.wonBy && m.a && m.d) out = new Map([[m.wonBy === 'attacker' ? m.a : m.d, 1]]);
    else {
      out = new Map();
      const A = slot(round, m, 'a'), D = slot(round, m, 'd');
      for (const [ta, pa] of A) {
        for (const [td, pd] of D) {
          const p = pair(m, ta, td);
          out.set(ta, (out.get(ta) || 0) + pa * pd * p);
          out.set(td, (out.get(td) || 0) + pa * pd * (1 - p));
        }
      }
    }
    wins.set(key, out);
    return out;
  }

  const last = model.rounds[model.rounds.length - 1];
  const final = last?.matches[0];
  const champion = final ? winners(last, final) : new Map();

  return {
    k,
    slot,
    champion,
    match(round, m) {
      if (m.wonBy) return null;
      const a = m.a || (m.pa.length === 1 ? m.pa[0] : null);
      const d = m.d || (m.pd.length === 1 ? m.pd[0] : null);
      return a && d ? pair(m, a, d) : null;
    },
    pair,
  };
}
