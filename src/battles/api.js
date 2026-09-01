/* ══════════════════════════════════════════════════════════════
   WarEra+ — Battaglie: dati
   ------------------------------------------------------------------
   Due sorgenti per lo stesso dato, e la vista non deve sapere quale ha
   risposto — sa solo se sta guardando l'archivio pieno o la finestra
   ridotta (`degraded`), perché quello va detto all'utente.

   1. SERVER DI CACHE (server/battleArchive.js) — novanta giorni di
      battaglie già complete di taglia pagata e contratti mercenari, più
      la serie giornaliera per nazione. Una fetch, tutto pronto.
   2. FALLBACK NEL BROWSER — se il VPS non risponde (o il deploy non è
      stato fatto): poche pagine di `battle.getBattles {isActive:false}`
      per l'elenco, e le taglie caricate SOLO per la riga che l'utente
      apre. Copre ~una settimana invece di novanta giorni, e la serie
      giornaliera si limita ai contratti mercenari (quelli sì, sfogliabili
      in una manciata di pagine). Dichiarato in interfaccia, mai
      silenzioso.

   ⚠️ Perché il fallback NON ricostruisce le taglie di tutte le battaglie:
   sono 2 chiamate per battaglia. Su 400 battaglie fanno 800 richieste da
   un singolo browser — esattamente i 429 che questo progetto passa il
   tempo a evitare. Su richiesta di una riga sola, invece, sono due.
   ══════════════════════════════════════════════════════════════ */

import { trpcBatch } from '../diplomacy/utils.js';
import {
  fetchBattleArchiveViaCache,
  fetchWarExpensesViaCache,
} from '../diplomacy/cacheClient.js';
import { fetchActiveBattles } from '../diplomacy/battleHeatmap.js';

// Quante pagine da 50 sfogliare nel fallback. 8 pagine = 400 battaglie
// ≈ 10 giorni, ~8 richieste: il massimo che ha senso chiedere a un browser
// all'apertura di una vista.
const FALLBACK_BATTLE_PAGES = 8;
// Aste: ~300-540 aggiudicate al giorno, quindi 12 pagine ≈ due giorni.
const FALLBACK_AUCTION_PAGES = 12;

const _ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };
const _day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Cache di sessione: la vista si apre e chiude spesso, e questi dati si
// muovono al ritmo di un poll (minuti). In MEMORIA, mai in localStorage —
// l'archivio pieno è qualche centinaio di KB.
let _archiveCache = null;   // { at, battles, degraded, retentionDays }
let _expensesCache = null;  // { at, byDay, degraded, tz, retentionDays }
const _bountyCache = new Map(); // battleId -> {atk, def} caricati on-demand
const TTL_MS = 5 * 60 * 1000;

/** Riespande una riga compatta del server nella forma che usa la vista.
 *  Le chiavi corte esistono per far viaggiare meno byte (vedi _toRow lato
 *  server), non per essere lette qui dentro. */
function _expand(r) {
  return {
    id: r.i,
    type: r.t,
    endedAt: r.e,
    wonBy: r.w,
    regionId: r.r,
    attacker: { countryId: r.ac, damages: r.ad || 0, bounty: r.ab },
    defender: { countryId: r.dc, damages: r.dd || 0, bounty: r.db },
    contracts: r.mc || 0,
    contractCount: r.mn || 0,
    // Il fallback non conosce i contratti né, all'inizio, le taglie: la
    // vista distingue "zero" da "non lo so" con questa bandiera, invece di
    // mostrare uno zero che sarebbe una bugia.
    partial: false,
  };
}

/** Stessa forma, ma da una battaglia grezza di battle.getBattles. */
function _fromRaw(b) {
  return {
    id: b._id,
    type: b.type || 'war',
    endedAt: _ts(b.endedAt) || _ts(b.updatedAt),
    wonBy: b.wonBy || null,
    regionId: b.defender?.region || b.attacker?.region || null,
    attacker: { countryId: b.attacker?.country || null, damages: b.attacker?.damages || 0, bounty: null },
    defender: { countryId: b.defender?.country || null, damages: b.defender?.damages || 0, bounty: null },
    contracts: null,
    contractCount: null,
    partial: true,
  };
}

// ---------------------------------------------------------------------------
// ARCHIVIO
// ---------------------------------------------------------------------------

async function _fallbackBattles() {
  const out = [];
  let cursor = null;
  for (let p = 0; p < FALLBACK_BATTLE_PAGES; p++) {
    const input = { isActive: false, limit: 50 };
    if (cursor) input.cursor = cursor;
    const [res] = await trpcBatch([['battle.getBattles', input]]);
    if (!res?.items?.length) break;
    out.push(...res.items.map(_fromRaw));
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out.filter(b => b.endedAt).sort((a, b) => b.endedAt - a.endedAt);
}

/**
 * Elenco battaglie concluse, più recenti prima.
 * @returns {Promise<{battles: object[], degraded: boolean, retentionDays: number|null, fetchedAt: number|null}>}
 */
export async function getBattleArchive({ force = false } = {}) {
  if (!force && _archiveCache && Date.now() - _archiveCache.at < TTL_MS) return _archiveCache;

  const server = await fetchBattleArchiveViaCache();
  if (server?.data?.length) {
    _archiveCache = {
      at: Date.now(),
      battles: server.data.map(_expand),
      degraded: false,
      retentionDays: server.retentionDays ?? null,
      fetchedAt: server.fetchedAt ?? null,
    };
    return _archiveCache;
  }

  // Server assente o archivio ancora vuoto (bootstrap non ha girato):
  // finestra ridotta calcolata qui.
  let battles = [];
  try { battles = await _fallbackBattles(); }
  catch (err) { console.warn('WarEra+ battaglie: fallback fallito', err); }
  _archiveCache = { at: Date.now(), battles, degraded: true, retentionDays: null, fetchedAt: Date.now() };
  return _archiveCache;
}

/* ══════════════════════════════════════════════════════════════
   BATTAGLIE IN CORSO (WarEra+, richiesta esplicita)
   ------------------------------------------------------------------
   L'archivio mostrava solo battaglie CHIUSE: chi lo apriva mentre una
   guerra era in pieno svolgimento non vedeva niente di quella guerra.
   Adesso in cima all'elenco stanno le battaglie in corso.

   ── PERCHÉ NON COSTA NIENTE ────────────────────────────────────────
   L'elenco delle attive è lo STESSO oggetto che alimenta i marker sulla
   mappa: `fetchActiveBattles()` (battleHeatmap.js) risponde dal server
   di cache con una fetch sola, e ricade sul Worker solo se il VPS è giù.
   Qui non si aggiunge una sorgente nuova, si legge quella che il tool
   già polla.

   ── PERCHÉ PIÙ LENTO DELLA MAPPA ───────────────────────────────────
   I marker si aggiornano al ritmo del tick di battaglia (~2 min) perché
   lì il numero che cambia È il contenuto. In una tabella d'archivio,
   invece, una riga che si riscrive ogni due minuti mentre la si legge è
   fastidiosa e non aggiunge niente: qui il giro è di 4 minuti, e gira
   SOLO mentre la scheda archivio è davvero aperta (vedi
   startLiveRefresh/stopLiveRefresh in main.js). Con la cache di sessione
   qui sotto, aprire e chiudere la vista dieci volte in un minuto resta
   UNA richiesta.

   ⚠️ Taglia e contratti di una battaglia in corso NON sono nell'elenco:
   vanno chiesti per battaglia come nel fallback (bottone "carica costo"),
   ed è giusto che sia così — sono numeri che si muovono, e scaricarli per
   tutte le righe a ogni giro sarebbe il moltiplicatore di richieste che
   questo progetto evita ovunque.
   ══════════════════════════════════════════════════════════════ */

const LIVE_TTL_MS = 4 * 60 * 1000;
let _liveCache = null;   // { at, battles }

/** Una battaglia attiva grezza nella forma di riga usata dalla vista.
 *
 *  ⚠️ I danni: `attacker.damages` di primo livello contiene SOLO i round
 *  già chiusi — il round in corso resta fuori finché non si chiude. Su
 *  una battaglia viva è la metà del numero vero. Si somma quindi
 *  `currentRound`, esattamente come fa battleMarkers.js per il tooltip
 *  della mappa (vedi il commento lungo lì: bug reale già segnalato). */
function _fromLive(b) {
  const cur = b.currentRound || {};
  return {
    id: b._id,
    type: b.type || 'war',
    endedAt: null,
    startedAt: _ts(b.createdAt) || _ts(b.startedAt) || null,
    wonBy: null,
    regionId: b.regionId || b.defender?.region || b.attacker?.region || null,
    attacker: {
      countryId: b.attacker?.country || null,
      damages: (b.attacker?.damages || 0) + (cur.attacker?.damages || 0),
      bounty: null,
    },
    defender: {
      countryId: b.defender?.country || null,
      damages: (b.defender?.damages || 0) + (cur.defender?.damages || 0),
      bounty: null,
    },
    contracts: null,
    contractCount: null,
    partial: true,
    live: true,
  };
}

/**
 * Battaglie in corso, più "calde" (danno complessivo) prima.
 * Non lancia mai: se non si riesce a leggerle, l'archivio mostra le sole
 * concluse invece di non mostrare niente.
 * @returns {Promise<object[]>}
 */
export async function getLiveBattles({ force = false } = {}) {
  if (!force && _liveCache && Date.now() - _liveCache.at < LIVE_TTL_MS) return _liveCache.battles;
  let battles = [];
  try {
    const raw = await fetchActiveBattles();
    battles = (Array.isArray(raw) ? raw : [])
      .map(_fromLive)
      .filter(b => b.id)
      .sort((a, b) => (b.attacker.damages + b.defender.damages) - (a.attacker.damages + a.defender.damages));
  } catch (err) {
    console.warn('WarEra+ battaglie: elenco in corso non disponibile', err);
    // Meglio l'ultimo elenco buono che una tabella che perde d'improvviso
    // la sua metà viva per un singolo giro andato storto.
    if (_liveCache) return _liveCache.battles;
  }
  _liveCache = { at: Date.now(), battles };
  return battles;
}

/** Taglia pagata dai due schieramenti di UNA battaglia, on-demand.
 *  Usata solo dal fallback (con l'archivio del server il dato c'è già) e
 *  memorizzata, così riaprire la stessa riga non ricompra le due chiamate.
 *  `limit: 100` è obbligatorio: senza, la classifica torna 20 voci e la
 *  somma sarebbe silenziosamente troppo bassa. */
export async function getBattleBounty(battleId, { live = false } = {}) {
  // Su una battaglia in corso la taglia cresce: memorizzarla la
  // congelerebbe al primo clic, e il bottone "aggiorna" mostrerebbe per
  // sempre lo stesso numero.
  if (!live && _bountyCache.has(battleId)) return _bountyCache.get(battleId);
  try {
    const [atk, def] = await trpcBatch([
      ['battleRanking.getRanking', { battleId, dataType: 'money', type: 'country', side: 'attacker', limit: 100 }],
      ['battleRanking.getRanking', { battleId, dataType: 'money', type: 'country', side: 'defender', limit: 100 }],
    ]);
    const sum = (r) => Array.isArray(r?.items) ? r.items.reduce((s, x) => s + (Number(x.value) || 0), 0) : null;
    const out = { atk: sum(atk), def: sum(def) };
    if (!live) _bountyCache.set(battleId, out);
    return out;
  } catch (err) {
    console.warn('WarEra+ battaglie: taglia non disponibile', err);
    return { atk: null, def: null };
  }
}

/** Contratti mercenari aggiudicati di UNA battaglia, on-demand (fallback). */
export async function getBattleContracts(battleId) {
  try {
    const [res] = await trpcBatch([
      ['mercenaryContractAuction.getPaginatedAuctions', { battleId, status: 'won', limit: 50 }],
    ]);
    const items = res?.items || [];
    return {
      total: items.reduce((s, a) => s + (Number(a.currentPayout) || 0), 0),
      count: items.length,
      // Oltre 50 contratti in una sola battaglia servirebbe il cursore: qui
      // si dichiara il troncamento invece di mostrare un numero basso.
      truncated: Boolean(res?.nextCursor),
    };
  } catch (err) {
    console.warn('WarEra+ battaglie: contratti non disponibili', err);
    return { total: null, count: null, truncated: false };
  }
}

/* ══════════════════════════════════════════════════════════════
   DETTAGLIO DI UNA BATTAGLIA
   ------------------------------------------------------------------
   L'archivio tiene per ogni battaglia due totali per schieramento. Il
   dettaglio scompone quei totali per NAZIONE: chi ha combattuto da che
   parte, quanto danno ha fatto, quanta taglia hanno incassato i suoi
   cittadini, e quali contratti mercenari sono stati pagati.

   ⚠️ ATTENZIONE ALLA COLONNA "TAGLIA" QUI DENTRO — significa una cosa
   DIVERSA dalla stessa parola nell'elenco e nelle spese di guerra:
     · nell'elenco è la SPESA di uno schieramento (la somma di tutto ciò
       che è uscito dal suo salvadanaio);
     · qui, riga per riga, è quanto quella nazione ha INCASSATO, perché
       la classifica money elenca chi riceve, non chi paga.
   Le due cose coincidono solo sommandole su un intero schieramento. È la
   stessa distinzione che rende `rankings.countryBounty` inutilizzabile
   come "spesa" (vedi server/battleArchive.js): la UI etichetta questa
   colonna come "incassato" e non come "speso".

   Costo: 4 classifiche + 1 pagina di aste in UN batch. Le classifiche
   per unità militare sono altre 2, chieste solo se si apre quella
   sezione. Tutto memorizzato per battaglia.
   ══════════════════════════════════════════════════════════════ */

const _detailCache = new Map();  // battleId -> dettaglio
const _muRankCache = new Map();  // battleId -> classifiche per MU

function _rankRows(res, key) {
  if (!Array.isArray(res?.items)) return null;
  return res.items
    .map(it => ({ id: it[key], value: Number(it.value) || 0, rank: it.rank }))
    .filter(r => r.id);
}

/** Fonde le due classifiche di uno schieramento (danno + denaro) in una
 *  riga per entità, ordinata per danno. Chi compare solo in una delle due
 *  resta comunque in elenco: incassare senza figurare fra i top danno è
 *  possibile, e nasconderlo falserebbe i totali di colonna. */
/** Vero se una classifica ha altre pagine oltre quella chiesta. Serve a
 *  dichiarare i totali tagliati invece di mostrarli come completi: con
 *  `limit: 100` una battaglia grossa supera il tetto sulle UNITÀ (viste
 *  118 e 133 su una sola battaglia), e la somma di colonna finirebbe
 *  silenziosamente sotto quella per nazione. */
function _isTruncated(res) {
  return Boolean(res?.nextCursor);
}

function _mergeSide(damageRows, moneyRows) {
  const map = new Map();
  for (const r of damageRows || []) map.set(r.id, { id: r.id, damage: r.value, money: 0 });
  for (const r of moneyRows || []) {
    const cur = map.get(r.id) || { id: r.id, damage: 0, money: 0 };
    cur.money = r.value;
    map.set(r.id, cur);
  }
  return [...map.values()].sort((a, b) => b.damage - a.damage);
}

/**
 * Scomposizione per nazione di una battaglia + contratti mercenari.
 * @returns {Promise<{sides:{attacker:object[],defender:object[]},
 *                    contracts:object[], contractsTruncated:boolean}|null>}
 */
export async function getBattleDetail(battleId, { live = false } = {}) {
  // Stessa ragione di getBattleBounty: su una battaglia viva le classifiche
  // cambiano ad ogni tick, quindi non si memorizzano.
  if (!live && _detailCache.has(battleId)) return _detailCache.get(battleId);

  const rank = (dataType, type, side) =>
    ['battleRanking.getRanking', { battleId, dataType, type, side, limit: 100 }];

  try {
    const [dAtk, dDef, mAtk, mDef, auctions] = await trpcBatch([
      rank('damage', 'country', 'attacker'),
      rank('damage', 'country', 'defender'),
      rank('money', 'country', 'attacker'),
      rank('money', 'country', 'defender'),
      ['mercenaryContractAuction.getPaginatedAuctions', { battleId, status: 'won', limit: 50 }],
    ]);

    const detail = {
      sides: {
        attacker: _mergeSide(_rankRows(dAtk, 'country'), _rankRows(mAtk, 'country')),
        defender: _mergeSide(_rankRows(dDef, 'country'), _rankRows(mDef, 'country')),
      },
      truncated: {
        attacker: _isTruncated(dAtk) || _isTruncated(mAtk),
        defender: _isTruncated(dDef) || _isTruncated(mDef),
      },
      contracts: (auctions?.items || []).map(a => ({
        id: a._id,
        payer: a.country,
        forCountry: a.forCountry,
        side: a.forCountrySide === 'defender' ? 'defender' : 'attacker',
        mu: a.currentWinner,
        payout: Number(a.currentPayout) || 0,
        perK: Number(a.currentPerK) || 0,
        minDamage: Number(a.minimumDamage) || 0,
        createdAt: _ts(a.createdAt),
      })).sort((a, b) => b.payout - a.payout),
      contractsTruncated: Boolean(auctions?.nextCursor),
    };

    // Nessuna delle due classifiche ha risposto: è un errore di rete, non
    // una battaglia senza partecipanti — meglio null (la UI dice "riprova")
    // che un dettaglio vuoto che sembra un dato.
    if (!detail.sides.attacker.length && !detail.sides.defender.length && !dAtk && !dDef) return null;

    if (!live) _detailCache.set(battleId, detail);
    return detail;
  } catch (err) {
    console.warn('WarEra+ battaglie: dettaglio non disponibile', err);
    return null;
  }
}

/** Le stesse due classifiche ma per UNITÀ MILITARE. Sezione separata e a
 *  richiesta: è la domanda "chi ha combattuto davvero", che non tutti si
 *  fanno, e non vale due chiamate in più su ogni apertura. */
export async function getBattleMuBreakdown(battleId, { live = false } = {}) {
  if (!live && _muRankCache.has(battleId)) return _muRankCache.get(battleId);
  const rank = (dataType, side) =>
    ['battleRanking.getRanking', { battleId, dataType, type: 'mu', side, limit: 100 }];
  try {
    const [dAtk, dDef, mAtk, mDef] = await trpcBatch([
      rank('damage', 'attacker'), rank('damage', 'defender'),
      rank('money', 'attacker'), rank('money', 'defender'),
    ]);
    const out = {
      attacker: _mergeSide(_rankRows(dAtk, 'mu'), _rankRows(mAtk, 'mu')),
      defender: _mergeSide(_rankRows(dDef, 'mu'), _rankRows(mDef, 'mu')),
      truncated: {
        attacker: _isTruncated(dAtk) || _isTruncated(mAtk),
        defender: _isTruncated(dDef) || _isTruncated(mDef),
      },
    };
    if (!live) _muRankCache.set(battleId, out);
    return out;
  } catch (err) {
    console.warn('WarEra+ battaglie: classifiche MU non disponibili', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// SPESE DI GUERRA
// ---------------------------------------------------------------------------

async function _fallbackExpenses() {
  // Solo i contratti: le taglie richiederebbero 2 chiamate per battaglia
  // su tutta la finestra (vedi il ⚠️ in testa al file).
  const byDay = {};
  let cursor = null;
  for (let p = 0; p < FALLBACK_AUCTION_PAGES; p++) {
    const input = { status: 'won', limit: 50, sortBy: 'createdAt', sortOrder: 'desc' };
    if (cursor) input.cursor = cursor;
    const [res] = await trpcBatch([['mercenaryContractAuction.getPaginatedAuctions', input]]);
    if (!res?.items?.length) break;
    for (const a of res.items) {
      const at = _ts(a.createdAt);
      const payer = a.country;
      const amount = Number(a.currentPayout);
      if (!at || !payer || !Number.isFinite(amount)) continue;
      const d = _day(at);
      byDay[d] = byDay[d] || {};
      const c = byDay[d][payer] = byDay[d][payer] || { bounty: 0, contracts: 0, contractCount: 0, battles: 0 };
      c.contracts += amount;
      c.contractCount += 1;
    }
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return byDay;
}

/**
 * Serie giornaliera per nazione.
 * @returns {Promise<{byDay: object, degraded: boolean, tz: string, retentionDays: number|null,
 *                    bountyMissing: boolean}>}
 * `bountyMissing` = la colonna taglie non è ricostruibile in questa
 * modalità (fallback): la vista la nasconde invece di mostrare zeri.
 */
export async function getWarExpenses({ force = false } = {}) {
  if (!force && _expensesCache && Date.now() - _expensesCache.at < TTL_MS) return _expensesCache;

  const server = await fetchWarExpensesViaCache();
  if (server && Object.keys(server.byDay).length) {
    _expensesCache = {
      at: Date.now(),
      byDay: server.byDay,
      degraded: false,
      bountyMissing: false,
      tz: server.tz || 'UTC',
      retentionDays: server.retentionDays ?? null,
      fetchedAt: server.fetchedAt ?? null,
    };
    return _expensesCache;
  }

  let byDay = {};
  try { byDay = await _fallbackExpenses(); }
  catch (err) { console.warn('WarEra+ spese di guerra: fallback fallito', err); }
  _expensesCache = {
    at: Date.now(), byDay, degraded: true, bountyMissing: true,
    tz: 'UTC', retentionDays: null, fetchedAt: Date.now(),
  };
  return _expensesCache;
}

/** Aggrega la serie giornaliera su una finestra di N giorni, per nazione.
 *  Vive qui e non nella vista perché le due schede (classifica e dettaglio
 *  nazione) devono per forza contare allo stesso modo. */
export function aggregateExpenses(byDay, days) {
  const cutoff = _day(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const totals = new Map();
  for (const [d, byCountry] of Object.entries(byDay)) {
    if (d < cutoff) continue;
    for (const [cid, v] of Object.entries(byCountry)) {
      const t = totals.get(cid) || { bounty: 0, contracts: 0, contractCount: 0, battles: 0 };
      t.bounty += v.bounty || 0;
      t.contracts += v.contracts || 0;
      t.contractCount += v.contractCount || 0;
      t.battles += v.battles || 0;
      totals.set(cid, t);
    }
  }
  return totals;
}

/** Serie giorno per giorno di UNA nazione, dal più vecchio al più recente
 *  (l'ordine che vuole un grafico). */
export function countrySeries(byDay, countryId, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = _day(Date.now() - i * 24 * 60 * 60 * 1000);
    const v = byDay[d]?.[countryId];
    out.push({
      day: d,
      bounty: v?.bounty || 0,
      contracts: v?.contracts || 0,
      contractCount: v?.contractCount || 0,
      battles: v?.battles || 0,
    });
  }
  return out;
}

/** Quanti giorni distinti copre davvero la serie: serve a non promettere
 *  "90 giorni" quando il bootstrap notturno ne ha macinati dodici. */
export function coveredDays(byDay) {
  return Object.keys(byDay).length;
}

/** Giorni DAVVERO presenti dentro la finestra scelta.
 *
 *  ⚠️ È il denominatore giusto per "al giorno", e non `days`: in modalità
 *  ridotta il browser copre due giorni di aste, ma la finestra selezionata
 *  può essere 30 — dividere per 30 farebbe sembrare una nazione quindici
 *  volte più parsimoniosa di quanto sia. Vale anche a server acceso finché
 *  il bootstrap notturno non ha finito di scendere fino a novanta giorni.
 *
 *  Si contano i giorni globali, non quelli della singola nazione: una
 *  nazione che ha speso in 1 giorno su 30 ha speso in 1 giorno su 30, e la
 *  sua media giornaliera deve dirlo. */
export function effectiveDays(byDay, days) {
  const cutoff = _day(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const n = Object.keys(byDay).filter(d => d >= cutoff).length;
  return Math.max(1, n);
}
