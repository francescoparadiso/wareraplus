/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — il sorvegliante delle aste
   ----------------------------------------------------------------------
   Riempie la colonna che sul tavolo resta vuota: cosa ha detto il gioco.
   Non è un poller che gira a vuoto — è guidato dalla spunta "ho aperto
   l'asta", che è anche l'unico momento in cui si sa che vale la pena
   guardare.

   ── LE MISURE CHE DECIDONO I TEMPI (2 settembre 2026, dal vivo) ───────
   Non sono stime: sono state prese su cinquanta aste realmente
   aggiudicate e cinque minuti di campionamento continuo.

     · aste aggiudicate nel mondo ....... 4 all'ora (~95 al giorno)
     · attive contemporaneamente ........ 2-3, mai una seconda pagina
     · prima offerta dall'apertura ...... ~10 secondi
     · durata ........................... 5 min (40 su 50), poi 7, 10, 15
                                          — NON è una costante
     · ritardo dell'esito rispetto a
       `expiresAt` ...................... min 0,6 · mediana 10,9 ·
                                          p90 25,1 · max 29,5 secondi
     · aste con ribasso ................. 2 su 50 (una sola con più di
                                          una unità offerente)

   Da qui i tre numeri di questo file:

   RAFFICA a 12s per 3 minuti dopo la spunta. Guarda anche INDIETRO,
   perché il ministro può aver aperto prima di spuntare.

   ULTIMO ALLARME a `expiresAt − 15s`. Nel 96% dei casi non dirà niente
   di nuovo; nel resto è l'unico momento in cui qualcuno può ancora fare
   qualcosa, e comunque avvisa il ministro *mentre* l'accordo fallisce
   invece che dopo.

   VERDETTO a `expiresAt + 35s`, con un secondo tentativo a +90s. Non +20:
   a venti secondi si perderebbe il 24% delle aste ancora non risolte.
   Non +30 nemmeno: il massimo osservato è 29,5 e mezzo secondo di
   margine non è margine.

   ── PERCHÉ LA CODA STA SU DISCO ──────────────────────────────────────
   Un `pm2 restart` a metà finestra — e qui si riavvia spesso — perderebbe
   i controlli in sospeso senza che nessuno se ne accorga, lasciando righe
   "non ancora verificata" per sempre. La coda si rilegge all'avvio.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { trpcGet } = require('./wareraApi');
const {
  getDb, getRichiesta, aggiornaRichiesta, getWebhook, audit,
} = require('./db');
const { avvisa } = require('./notify');

const RAFFICA_MS = 12_000;
const RAFFICA_DURATA_MS = 3 * 60_000;
const RAFFICA_INDIETRO_MS = 5 * 60_000;   // quanto guardare all'indietro
const ALLARME_PRIMA_MS = 15_000;
const VERDETTO_DOPO_MS = 35_000;
const VERDETTO_RITENTA_MS = 90_000;
const SWEEP_MS = 4 * 60_000;

let CODA_FILE = null;
let coda = [];        // [{ requestId, tipo, quando, auctionId }]
let timer = null;

// ---------------------------------------------------------------------------
// Coda persistente
// ---------------------------------------------------------------------------

function caricaCoda() {
  try { coda = JSON.parse(fs.readFileSync(CODA_FILE, 'utf-8')); }
  catch { coda = []; }
}

function salvaCoda() {
  try { fs.writeFileSync(CODA_FILE, JSON.stringify(coda)); }
  catch (err) { console.warn('[watcher] coda non salvata:', err.message); }
}

function programma(requestId, tipo, quando, extra = {}) {
  coda = coda.filter((c) => !(c.requestId === requestId && c.tipo === tipo));
  coda.push({ requestId, tipo, quando, ...extra });
  salvaCoda();
}

function togli(requestId, tipo = null) {
  coda = coda.filter((c) => c.requestId !== requestId || (tipo && c.tipo !== tipo));
  salvaCoda();
}

// ---------------------------------------------------------------------------
// Lettura delle aste
// ---------------------------------------------------------------------------

async function asteDellaBattaglia(battleId, stato) {
  // ⚠️ Senza `status` esplicito il default è `active`, e `limit` non passa
  // 50. Il filtro si chiama `battleId` anche se il campo nel record è
  // `battle`: è una trappola già pagata una volta, annotata qui.
  const r = await trpcGet('mercenaryContractAuction.getPaginatedAuctions',
    { battleId, status: stato, limit: 50 });
  return r?.items || [];
}

/**
 * L'asta che corrisponde a questa richiesta. Non basta "una qualsiasi
 * asta su quella battaglia": ce ne possono essere di altre nazioni, e
 * attribuire alla richiesta sbagliata è peggio che non attribuire.
 */
function corrisponde(a, r) {
  if (a.forCountry !== r.country_id) return false;
  if (r.side && a.forCountrySide && a.forCountrySide !== r.side) return false;
  // Aperta prima della spunta? Si accetta comunque, ma solo entro una
  // finestra ragionevole: il ministro apre e poi spunta, non il contrario
  // di mezz'ora prima.
  const nata = new Date(a.createdAt).getTime();
  if (nata < r.opened_at - RAFFICA_INDIETRO_MS) return false;
  return true;
}

/**
 * "Aperta con parametri diversi" solo quando lo e' DAVVERO.
 *
 * ⚠️ I contratti non si aprono quasi mai identici alla richiesta: si
 * chiedono 4 milioni a 0,10 e se ne aprono 3,9 a 0,08. E' negoziazione
 * normale, non uno scostamento da segnalare. Una tolleranza stretta —
 * la prima versione era al 10% — avrebbe marcato come anomalia il caso
 * ordinario, e una colonna che grida al lupo si smette di guardarla.
 *
 * Le soglie sono larghe apposta: qui non si cerca la differenza, si
 * cerca il CONTRATTO DIVERSO. Ridurre il danno di un terzo o dimezzare
 * il compenso non e' un arrotondamento, e' un altro accordo.
 *
 * I valori veri vengono registrati SEMPRE (apert_min_damage,
 * apert_budget) a prescindere dal verdetto: la vista mostra "chiesto X,
 * aperto Y", che dice piu' di qualunque etichetta.
 */
const TOLLERANZA_DANNO = 0.30;
const TOLLERANZA_COMPENSO = 0.40;

function parametriDiversi(a, r) {
  const fuori = (vero, chiesto, soglia) => {
    if (vero == null || !chiesto) return false;
    return Math.abs(vero - chiesto) / chiesto > soglia;
  };
  return fuori(a.minimumDamage, r.min_damage, TOLLERANZA_DANNO)
      || fuori(a.budget, r.budget, TOLLERANZA_COMPENSO);
}

// ---------------------------------------------------------------------------
// I tre momenti
// ---------------------------------------------------------------------------

async function raffica(c) {
  const r = getRichiesta(c.requestId);
  if (!r || !r.opened_at) { togli(c.requestId); return; }

  let trovata = null;
  try {
    const attive = await asteDellaBattaglia(r.battle_id, 'active');
    trovata = attive.find((a) => corrisponde(a, r)) || null;
    if (!trovata) {
      // Può essersi già chiusa mentre cercavamo: cinque minuti passano
      // in fretta, e una raffica che parte tardi troverebbe solo `won`.
      const vinte = await asteDellaBattaglia(r.battle_id, 'won');
      trovata = vinte.find((a) => corrisponde(a, r)) || null;
    }
  } catch (err) {
    console.warn('[watcher] raffica fallita:', err.message);
  }

  if (trovata) {
    aggiornaRichiesta(r.id, { auction_id: trovata._id });
    togli(r.id, 'raffica');
    const scade = new Date(trovata.expiresAt).getTime();
    // La durata NON è una costante (5, 7, 10, 15 minuti osservati): si
    // schedula su expiresAt, mai su un numero fisso.
    if (scade - Date.now() > ALLARME_PRIMA_MS) {
      programma(r.id, 'allarme', scade - ALLARME_PRIMA_MS, { auctionId: trovata._id });
    }
    programma(r.id, 'verdetto', scade + VERDETTO_DOPO_MS, { auctionId: trovata._id });
    return;
  }

  // Ancora niente: si riprova finché la raffica non scade.
  if (Date.now() < r.opened_at + RAFFICA_DURATA_MS) {
    programma(r.id, 'raffica', Date.now() + RAFFICA_MS);
  } else {
    // Spuntata come aperta, ma nessuna asta è mai comparsa. Non è
    // un'accusa: capita di aprirla sulla battaglia sbagliata.
    aggiornaRichiesta(r.id, { esito: 'mai_aperta', verificato_il: Date.now() });
    audit(null, 'watcher.mai_aperta', `request:${r.id}`, null);
    togli(r.id);
  }
}

async function allarme(c) {
  const r = getRichiesta(c.requestId);
  if (!r) { togli(c.requestId); return; }
  togli(r.id, 'allarme');

  try {
    const attive = await asteDellaBattaglia(r.battle_id, 'active');
    const a = attive.find((x) => x._id === c.auctionId);
    if (!a) return;                       // già chiusa: parlerà il verdetto

    const inTesta = a.currentWinner || null;
    if (!inTesta) {
      avvisa('mu', r.mu_id, `**Auction closing in ~15s** — no bid yet on ${r.battle_label || r.battle_id}.`);
    } else if (inTesta !== r.mu_id) {
      avvisa('mu', r.mu_id, `**Auction closing in ~15s** — another unit is leading on ${r.battle_label || r.battle_id}.`);
      avvisa('country', r.country_id, `**Heads up** — the contract on ${r.battle_label || r.battle_id} is being taken by a unit other than the one agreed.`);
    }
  } catch (err) {
    console.warn('[watcher] allarme fallito:', err.message);
  }
}

async function verdetto(c) {
  const r = getRichiesta(c.requestId);
  if (!r) { togli(c.requestId); return; }

  let a = null;
  try {
    for (const stato of ['won', 'expiredNoBids', 'expiredBattle', 'expiredRound', 'cancelled']) {
      const elenco = await asteDellaBattaglia(r.battle_id, stato);
      a = elenco.find((x) => x._id === c.auctionId);
      if (a) break;
    }
  } catch (err) {
    console.warn('[watcher] verdetto fallito:', err.message);
  }

  if (!a) {
    // Non ancora risolta: il ritardo misurato arriva a 29,5s, ma la coda
    // di un gioco può allungarsi. Un secondo tentativo, poi si smette.
    if (!c.ritentato) {
      programma(r.id, 'verdetto', Date.now() + VERDETTO_RITENTA_MS, { auctionId: c.auctionId, ritentato: true });
    } else {
      togli(r.id);
    }
    return;
  }

  let esito;
  // "Nessun vincitore" non è una cosa sola: expiredNoBids è un problema
  // del ministro (nessuno l'ha voluta), expiredBattle/expiredRound non
  // sono colpa di nessuno. Distinguerli evita accuse sbagliate.
  if (a.status === 'expiredNoBids') esito = 'nessuna_offerta';
  else if (['expiredBattle', 'expiredRound', 'cancelled'].includes(a.status)) esito = 'nessuna_offerta';
  else if (a.currentWinner && a.currentWinner !== r.mu_id) esito = 'altra_unita';
  else if (parametriDiversi(a, r)) esito = 'parametri_diversi';
  else esito = 'conforme';

  aggiornaRichiesta(r.id, {
    esito,
    status: 'closed',
    winner_mu: a.currentWinner || null,
    final_per_k: a.currentPerK ?? null,
    // Sempre, anche quando l'esito e' "conforme": e' la differenza fra
    // dire "e' andata bene" e poter mostrare a quali condizioni.
    apert_min_damage: a.minimumDamage ?? null,
    apert_budget: a.budget ?? null,
    verificato_il: Date.now(),
  });
  audit(null, `watcher.${esito}`, `request:${r.id}`, { auctionId: a._id, winner: a.currentWinner || null });
  togli(r.id);

  if (esito === 'altra_unita') {
    avvisa('country', r.country_id, `**Contract went elsewhere** — ${r.battle_label || r.battle_id}: another unit won the auction agreed with ${r.mu_nome || r.mu_id}.`);
    avvisa('mu', r.mu_id, `**Lost** — the contract on ${r.battle_label || r.battle_id} was taken by another unit.`);
  } else if (esito === 'conforme') {
    avvisa('mu', r.mu_id, `**Won** — the contract on ${r.battle_label || r.battle_id} is yours.`);
  }
}

// ---------------------------------------------------------------------------
// Il giro
// ---------------------------------------------------------------------------

async function giro() {
  const ora = Date.now();
  const scaduti = coda.filter((c) => c.quando <= ora);
  for (const c of scaduti) {
    try {
      if (c.tipo === 'raffica') await raffica(c);
      else if (c.tipo === 'allarme') await allarme(c);
      else if (c.tipo === 'verdetto') await verdetto(c);
    } catch (err) {
      console.error('[watcher] errore su', c.tipo, err.message);
      togli(c.requestId, c.tipo);
    }
  }
}

/** Chiamato quando un ministro spunta "ho aperto l'asta". */
function segnalaApertura(requestId) {
  programma(requestId, 'raffica', Date.now());
}

function statoWatcher() {
  return {
    inCoda: coda.length,
    prossimo: coda.length ? Math.min(...coda.map((c) => c.quando)) : null,
    perTipo: coda.reduce((m, c) => ({ ...m, [c.tipo]: (m[c.tipo] || 0) + 1 }), {}),
  };
}

function initWatcher({ dataDir }) {
  CODA_FILE = path.join(dataDir, 'watcher-queue.json');
  caricaCoda();
  if (coda.length) console.log(`[watcher] ripresi ${coda.length} controlli dalla coda`);

  // Un solo intervallo corto: i controlli sono pochi e la coda è in
  // memoria, quindi non serve un timer per ciascuno — che dopo un
  // restart, per giunta, non ci sarebbe più.
  timer = setInterval(() => { giro().catch(() => {}); }, 5_000);
  timer.unref();

  return { segnalaApertura, statoWatcher };
}

module.exports = { initWatcher, segnalaApertura, statoWatcher, SWEEP_MS };
