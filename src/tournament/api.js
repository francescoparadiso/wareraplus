/* ══════════════════════════════════════════════════════════════
   WarEra+ — Tornei: accesso ai dati
   ------------------------------------------------------------------
   Tutto PUBBLICO su api6, nessuna chiave e quindi nessun consumo del
   budget del Worker (misurato il 2026-10-25):

     · tournament.getManyPaginated {limit} → gli ultimi tornei, MU e
       nazioni alternati, ognuno COMPLETO di tabellone (`rounds`): ~10 KB
       gzip a torneo. Il filtro `type` è ignorato in silenzio, quindi se ne
       chiedono abbastanza da avere qualche torneo di ogni tipo.
     · tournament.getById → lo stesso oggetto, per riaggiornare quello in
       corso senza riscaricare la lista.
     · tournamentTeam.getByTournamentId → le squadre: entità (MU o
       nazioni), `participants` (gli iscritti, userId), `status`,
       `totalDamage` nel torneo. ~180 KB gzip per un torneo MU da 457
       squadre, ~10 KB per quello delle nazioni.
     · battle.getById → punteggio di una partita in corso
       (`wonRoundsCount` / `roundsToWin`), solo per quelle a schermo.

   Il danno settimanale dei giocatori NON si chiede qui: è la stessa
   classifica intera (`ranking.getRanking weeklyUserDamages`, ~510 KB gzip,
   ~13.700 righe) che scarica la sezione Giocatori, e si passa dalla SUA
   cache di sessione (src/players/api.js: fetchLeaderboard). Aprire tornei
   e poi giocatori, o il contrario, la scarica una volta sola.

   Cache in memoria per la sessione. Il torneo in corso si riaggiorna
   (tabellone ogni 3 minuti, squadre ogni 15): l'esito delle partite e il
   danno nel torneo cambiano, gli iscritti no.
   ══════════════════════════════════════════════════════════════ */

import { trpcBatchManual } from '../shared/trpcClient.js';
import { fetchLeaderboard } from '../players/api.js';
import { WARERA_CACHE_BASE } from '../diplomacy/config.js';

/* ── Via server di cache (/tournament) ──────────────────────────────
   Dal 2026-10-25 la strada normale: il server (server/tournament.js)
   tiene lui classifica settimanale e squadre, e manda tabellone + forza
   di ogni squadra già sommata, con nome e stemma delle unità: ~30 KB gzip
   invece dei ~700 KB del percorso diretto qui sotto, che resta come
   ricaduta (regola del progetto: il server è un'ottimizzazione, mai un
   punto di fallimento). `me` è l'id PUBBLICO del personaggio che l'utente
   ha indicato in Giocatori: serve al server per dire qual è la sua squadra
   senza spedire gli 8.000 iscritti.

   Se il server non risponde si riprova dopo 2 minuti; se la rotta non
   esiste (server non ancora rideployato) dopo 10. */
const BUNDLE_TIMEOUT_MS = 8000;
let _bundleDownUntil = 0;

/** Iscritti di una squadra col danno degli ultimi 7 giorni (`w`) e quello
 *  fatto nel torneo (`t`), dal server. null se non risponde: chi chiama
 *  ricade sui dati che ha (percorso diretto) o non mostra la sezione. */
export async function fetchTeamRoster(tournamentId, teamId) {
  if (!WARERA_CACHE_BASE) return null;
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/tournament/team?id=${tournamentId}&team=${teamId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.rows) ? json : null;
  } catch {
    return null;
  }
}

export async function fetchTournamentBundle({ type, id, me }) {
  if (!WARERA_CACHE_BASE || Date.now() < _bundleDownUntil) return null;
  const q = new URLSearchParams({ type });
  if (id) q.set('id', id);
  if (me) q.set('me', me);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUNDLE_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/tournament?${q}`, { signal: controller.signal });
    if (res.status === 404) { _bundleDownUntil = Date.now() + 10 * 60 * 1000; return null; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.list) || !Array.isArray(json?.teams)) throw new Error('forma inattesa');
    return json;
  } catch (err) {
    console.warn('WarEra+ tornei: /tournament non disponibile, carico direttamente:', err.message);
    _bundleDownUntil = Date.now() + 2 * 60 * 1000;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const LIST_LIMIT = 8;                  // ~4 tornei per tipo
const LIST_TTL_MS = 10 * 60 * 1000;
const TOURNAMENT_TTL_MS = 3 * 60 * 1000;
const TEAMS_TTL_MS = 15 * 60 * 1000;
const SCORE_TTL_MS = 2 * 60 * 1000;
const SCORE_CHUNK = 20;

let _list = null;           // { at, items }
let _listPromise = null;
const _tournaments = new Map();   // id -> { at, data }
const _teams = new Map();         // id -> { at, data }
const _scores = new Map();        // battleId -> { at, data }

async function one(proc, input) {
  const [res] = await trpcBatchManual([[proc, input]]);
  return res;
}

/** Gli ultimi tornei, dal più recente. Scarta i rimasugli "upcoming" mai
 *  partiti (dicembre 2025: niente `startAt`, niente squadre), che in
 *  coda alla lista sembrerebbero tornei in arrivo. */
export function fetchTournamentList({ force = false } = {}) {
  if (!force && _list && Date.now() - _list.at < LIST_TTL_MS) return Promise.resolve(_list.items);
  if (_listPromise) return _listPromise;
  _listPromise = one('tournament.getManyPaginated', { limit: LIST_LIMIT })
    .then(res => {
      const items = (Array.isArray(res) ? res : res?.items || [])
        .filter(t => t && t._id && t.type && (t.startAt || t.status === 'active'));
      const now = Date.now();
      _list = { at: now, items };
      for (const t of items) _tournaments.set(t._id, { at: now, data: t });
      return items;
    })
    .finally(() => { _listPromise = null; });
  return _listPromise;
}

/** Un torneo col suo tabellone. Quelli conclusi non cambiano più: restano
 *  in memoria per tutta la sessione. */
export async function fetchTournament(id, { force = false } = {}) {
  const hit = _tournaments.get(id);
  if (hit && !force && (hit.data.status === 'ended' || Date.now() - hit.at < TOURNAMENT_TTL_MS)) return hit.data;
  const data = await one('tournament.getById', { tournamentId: id });
  if (data?._id) _tournaments.set(id, { at: Date.now(), data });
  return data || hit?.data || null;
}

export async function fetchTeams(id, { ended = false, force = false } = {}) {
  const hit = _teams.get(id);
  if (hit && !force && (ended || Date.now() - hit.at < TEAMS_TTL_MS)) return hit.data;
  const res = await one('tournamentTeam.getByTournamentId', { tournamentId: id });
  const data = Array.isArray(res) ? res : res?.items || [];
  _teams.set(id, { at: Date.now(), data });
  return data;
}

/** Danno settimanale per giocatore: Map userId → danno. null se la
 *  classifica non arriva — la vista ripiega sui totali delle entità e lo
 *  dichiara. */
export async function fetchWeeklyByUser() {
  try {
    const rows = await fetchLeaderboard('weeklyUserDamages');
    return new Map(rows.map(r => [r.u, r.v]));
  } catch (err) {
    console.warn('WarEra+ tornei: classifica settimanale dei giocatori non disponibile:', err.message);
    return null;
  }
}

/** Punteggio delle partite in corso: Map battleId → { a, d, toWin, aDmg, dDmg }.
 *  Una partita che non risponde resta fuori: la vista scrive "in corso"
 *  senza punteggio. */
export async function fetchLiveScores(battleIds) {
  const now = Date.now();
  const want = [...new Set(battleIds.filter(Boolean))];
  const missing = want.filter(id => !(_scores.has(id) && now - _scores.get(id).at < SCORE_TTL_MS));
  for (let i = 0; i < missing.length; i += SCORE_CHUNK) {
    const chunk = missing.slice(i, i + SCORE_CHUNK);
    try {
      const res = await trpcBatchManual(chunk.map(id => ['battle.getById', { battleId: id }]));
      res.forEach((b, k) => {
        if (!b?._id) return;
        _scores.set(chunk[k], {
          at: now,
          data: {
            a: b.attacker?.wonRoundsCount ?? 0,
            d: b.defender?.wonRoundsCount ?? 0,
            toWin: b.roundsToWin ?? null,
            aDmg: b.attacker?.damages ?? 0,
            dDmg: b.defender?.damages ?? 0,
            active: !!b.isActive,
          },
        });
      });
    } catch (err) {
      console.warn('WarEra+ tornei: punteggi non disponibili:', err.message);
    }
  }
  const out = new Map();
  for (const id of want) if (_scores.has(id)) out.set(id, _scores.get(id).data);
  return out;
}
