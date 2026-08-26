/* ═══════════════════════════════════════════════════════════════════════
   Radar dei proxy — la parte che solo il server può fare
   -----------------------------------------------------------------------
   Il client calcola già da solo tre segnali (src/proxy/radar.js): dove
   militano i cittadini, il legame diplomatico col candidato patrono, e
   l'anomalia di danno per abitante. Sono tutti derivabili da dati che ha
   già in memoria o da una fetch sola.

   Ne manca il più forte, e non per pigrizia: LA LINGUA DI CHI GOVERNA.
   Per averlo serve `preferences.locale` di ogni membro di governo, cioè
   una `user.getUserById` a testa — circa 1.600 chiamate per coprire il
   mondo. Dal browser è fuori discussione; qui è un poll ogni sei ore che
   la prima volta costa ~50 richieste e poi quasi niente, perché la lingua
   di una persona non cambia e i governi rinnovano pochissime facce
   (misurato sulle nazioni sorvegliate: 1,4 volti nuovi per tornata).

   Quanto vale: sui 30 proxy noti del CSV, il modello con i soli segnali
   del client ne ritrova 9; aggiungendo la lingua di chi governa arriva a
   19. È il singolo salto di qualità più grande di tutto il progetto.

   ── Come si compone con gli altri ─────────────────────────────────
   La lingua NON nomina il patrono da sola. Identifica una COMUNITÀ: 'it'
   dice Italia perché di italofono c'è l'Italia, ma 'es' non dice Venezuela
   — dice ispanofono, e i paesi ispanofoni sono venti. Quindi:

     · se la comunità linguistica indica una nazione sola, quella diventa
       un candidato patrono a pieno titolo, anche senza il segnale delle
       unità militari;
     · se è ambigua (spagnolo, arabo, francese, portoghese) la lingua vale
       solo a CONFERMA di un candidato già proposto dalle unità militari,
       e solo se quel candidato parla davvero quella lingua.

   Senza questa distinzione Andorra e la Corea del Sud finirebbero proxy
   venezuelani: verificato dal vivo, succede davvero.

   ── I due segnali presi da un'analisi esterna ─────────────────────
   Ad agosto 2026 è arrivata una ricerca indipendente (WHO-FLIES-THAT-FLAG)
   costruita su segnali completamente diversi dai miei: i soldi, i danni in
   battaglia e le migrazioni. Incrociata con questo indice concordava sul
   patrono in 26 casi su 29 — due metodi che non condividono quasi nulla e
   arrivano alla stessa risposta. Da lì sono stati presi i due segnali che
   costano poco e che qui mancavano del tutto:

   S8 IL ROSTER DI CHI GOVERNA. Non solo che LINGUA parlano i membri del
      governo, ma in quale unità militare sono tesserati. Costa zero: la
      stessa `user.getUserById` che porta la locale porta anche `mu`, e la
      nazione di registrazione dell'unità sta già nella directory in cache.
      È il segnale più diretto di tutti — "chi comanda qui milita per chi" —
      e non dipende dalla lingua, quindi vede anche i patroni anglofoni.

   S9 IL FINANZIAMENTO. `countryMoneyTransfer` ha `sellerCountryId` (chi
      paga) e `buyerCountryId` (chi incassa): i bonifici fra tesori sono
      pubblici e nominativi. L'Albania risulta finanziata dalla Serbia per
      59.800, e la Slovenia — che tutti gli altri segnali qui non vedono —
      ha come unica controparte l'Italia. Si scarica SOLO per le nazioni
      che hanno già un candidato: ~50 su 180, tre pagine ciascuna.

   Restano fuori i suoi segnali su danni e migrazioni: il primo costa una
   `battleRanking.getRanking` per battaglia per lato, il secondo richiede
   una sessione di gioco (vedi memoria di progetto).

   ── Cosa NON tocca ────────────────────────────────────────────────
   Niente. Nessun poll esistente viene modificato: questo modulo legge le
   cache che gli altri hanno già scritto (`countries`) e ne scrive di sue.
   Se fallisce, fallisce da solo — ogni funzione pubblica è avvolta in un
   try/catch, perché nel processo non esiste un handler globale e
   un'eccezione non gestita farebbe riavviare pm2, che al riavvio rilancia
   l'intera sequenza di boot.
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

const { isNativeLocale, isUninformative, homelandsOf } = require('./languages');

/* ── Parametri, gli stessi del client dove il segnale è lo stesso ──
   src/proxy/radar.js ha i gemelli di PRIOR/W_SHARE/F_NEUTRAL/LR_*: se
   cambi una taratura, cambiala in tutti e due, altrimenti il punteggio
   servito da qui e quello calcolato dal browser divergono senza motivo. */
const PRIOR = 0.20;
const W_SHARE = 3.6;
const F_NEUTRAL = 0.35;
const MIN_KNOWN = 6;
const FULL_CONF_N = 15;
// ⚠️ La guerra col presunto patrono NON è una smentita (correzione del
// 2026-08-26, su indicazione dell'utente poi verificata sui dati). Nel
// gioco capita spesso che una potenza conquisti i propri proxy o ci vada
// in guerra per ragioni di comodo. Misurato sulle 24 coppie documentate da
// cluster di migrazione: il 13% è in guerra col proprio patrono, contro un
// 3,5% di due nazioni qualsiasi — Trinidad/Venezuela, Guinea-Bissau/
// Brasile, Iraq/Egitto. È quindi semmai un indizio A FAVORE, ma tre casi
// non bastano per farne un moltiplicatore positivo: resta NEUTRO, e la
// guerra si continua a mostrare fra le evidenze perché chi legge la sappia.
const LR_AT_WAR = 1.0;
// Patti e alleanze vanno e vengono di continuo (l'Armenia ne ha perso uno
// nelle dieci ore fra due giri di questo indice). Il legame resta un
// indizio misurato — 79% delle coppie documentate ce l'ha — ma i pesi sono
// smorzati verso l'1: un segnale che cambia di settimana in settimana non
// deve far ballare la percentuale di un fattore quattro.
const LR_LINK = 1.6;
const LR_NO_LINK = 0.6;
const LR_HIGH_DMG = 2.2;
const LR_LOW_DMG = 0.7;

/* Lingua di chi governa. La forza cresce con la quota di governo che parla
   una lingua che lì non c'entra, e con quante persone abbiamo risolto:
   un governo di tre persone di cui due straniere dice molto meno di un
   governo di dodici di cui otto. */
const LANG_MIN_ELITE = 3;      // sotto, non si guarda nemmeno
const LANG_MIN_SHARE = 0.25;   // sotto, è rumore: qualche espatriato ce l'hanno tutti
// Una QUOTA alta su un governo piccolo non è un segnale: due polacchi in un
// governo giapponese da sei fanno il 33% e basterebbero a far comparire il
// Giappone fra i proxy (misurato: succedeva). Serve anche un numero minimo
// di persone, non solo una percentuale. Costo dichiarato: la Slovenia, che
// di italiani nel governo ne ha due su sei, perde questo segnale e resta
// affidata agli altri — è il verso giusto in cui sbagliare, visto che è già
// nel CSV mentre il Giappone finirebbe sulla mappa dal nulla.
const LANG_MIN_COUNT = 3;
const LANG_MAX_LR = 9;         // tetto: un solo segnale non deve poter decidere da solo
const LANG_W = 12;             // pendenza sopra la soglia

// Roster del governo: quota di chi comanda che milita in unità straniere.
// Soglie più basse della lingua perché il segnale è molto più diretto —
// nessuno finisce per caso in un'unità di un'altra nazione.
const ROSTER_MIN_KNOWN = 3;
const ROSTER_MIN_SHARE = 0.34;
const ROSTER_MAX_LR = 10;
const ROSTER_W = 4.5;

// Finanziamento: quota dei bonifici IN ENTRATA che arriva da una sola
// nazione. Sotto la soglia non si guarda: quasi tutti ricevono qualcosa da
// qualcuno, ed è il monopolio a essere significativo, non l'esistenza.
const FUNDING_MIN_TOTAL = 2000;    // sotto, il tesoro non ha una firma
const FUNDING_MIN_SHARE = 0.40;
const FUNDING_MAX_LR = 6;
const FUNDING_W = 4;
const FUNDING_PAGES = 3;           // 300 transazioni per nazione
// Le transazioni si scaricano solo per chi ha già un candidato: su 180
// nazioni sono una cinquantina, e il resto non le userebbe comunque.
const FUNDING_MAX_COUNTRIES = 70;

const INDEX_FILE = 'proxy-index';
const LOCALES_FILE = 'user-locales';
// La lingua di una persona cambia raramente e non è un dato che marcisce:
// si ricontrolla ogni tanto solo per non restare fermi su chi l'ha cambiata.
const LOCALE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Verificato dal vivo: 100 procedure `user.getUserById` in un solo GET
// batch superano la lunghezza massima dell'URL e tornano HTTP 414. A 35
// passa. Il MAX_BATCH=100 del server vale per procedure con input corti
// (countryId, electionId), non per queste.
const USER_BATCH = 35;
// Tetto per giro: se un cold start dovesse trovare tutto da risolvere,
// meglio spalmarlo su più giri che fare una raffica sola.
const MAX_LOOKUPS_PER_RUN = 2500;

let deps = null;

/**
 * Le funzioni del server principale arrivano da fuori invece di essere
 * duplicate qui: `trpcBatch` porta con sé retry, chunking e rate control
 * già tarati, e riscriverne una copia significherebbe farli divergere.
 */
function initProxyIndex(injected) {
  deps = injected;
  // ⚠️ NIENTE letture di `deps` qui dentro. initProxyIndex viene chiamata in
  // cima al server, mentre `apiToken`/`trpcUpstream` sono getter su delle
  // `const` dichiarate ~2.000 righe più in basso: leggerle adesso significa
  // toccarle prima della loro inizializzazione e prendersi un ReferenceError
  // che uccide il processo al caricamento (successo davvero, 502 in
  // produzione). I controlli su quei valori vanno fatti quando il poll gira.
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Anagrafe di lingua e unità ───────────────────────────────────
   { userId: [locale, quandoRisolto, muId] }. Persistente: è il motivo per
   cui il secondo giro costa quasi niente. Le voci scritte prima che
   esistesse S8 hanno solo due elementi: `muId` risulta undefined e quel
   membro semplicemente non conta nel roster, finché il TTL non lo fa
   ripassare. Nessuna migrazione da scrivere. */
function loadLocales() {
  return deps.readCache(LOCALES_FILE, {});
}

async function resolveLocales(userIds) {
  const store = loadLocales();
  const now = Date.now();
  const missing = [...new Set(userIds)].filter(id => {
    const row = store[id];
    if (!row) return true;
    // Migrazione: le voci scritte prima di S8 hanno due soli elementi e non
    // sanno in quale unità milita quella persona. Aspettare il TTL vorrebbe
    // dire tenere il roster di governo spento per un mese dopo il deploy —
    // si ripassano subito, una volta sola. `undefined` significa "mai
    // chiesto", `null` significa "chiesto, non ha unità": solo il primo
    // fa rifare la domanda.
    if (row.length < 3) return true;
    return (now - (row[1] || 0)) > LOCALE_TTL_MS;
  }).slice(0, MAX_LOOKUPS_PER_RUN);

  for (let i = 0; i < missing.length; i += USER_BATCH) {
    const chunk = missing.slice(i, i + USER_BATCH);
    const results = await deps.trpcBatch(
      chunk.map(id => ['user.getUserById', { userId: id }]),
      { useWorker: true },
    );
    chunk.forEach((id, k) => {
      const user = results[k];
      if (user) {
        store[id] = [user.preferences?.locale ?? null, now, user.mu ?? null];
        return;
      }
      // Chiamata fallita (429 oltre i retry, chunk andato male): NON si
      // sovrascrive una riga buona con dei null — sarebbe perdere dato già
      // pagato per colpa di un errore di rete. Chi non ha ancora una riga
      // ne prende una vuota, così non lo si richiede ad ogni singolo giro;
      // chi ce l'ha resta com'è e verrà ritentato al prossimo passaggio.
      if (!store[id]) store[id] = [null, now, null];
    });
    await sleep(120);
  }

  if (missing.length) {
    deps.writeCache(LOCALES_FILE, store, { compact: true });
    console.log(`[proxy-index] lingue risolte: ${missing.length} nuove (${Object.keys(store).length} in anagrafe)`);
  }
  return store;
}

/* ── Chi governa ogni nazione ─────────────────────────────────────
   Presidente, vice, i tre ministri e il congresso: da cinque a dodici
   persone. È la definizione operativa di "chi controlla questo paese" —
   e il congresso conta quanto l'esecutivo, visto che può rovesciare un
   presidente. */
function governmentMembers(gov) {
  if (!gov) return { all: [], president: null, congress: [] };
  const executive = [gov.president, gov.vicePresident, gov.minOfDefense, gov.minOfForeignAffairs, gov.minOfEconomy].filter(Boolean);
  const congress = (gov.congressMembers || []).filter(Boolean);
  return {
    all: [...new Set([...executive, ...congress])],
    president: gov.president || null,
    congress,
  };
}

async function fetchGovernments(countries) {
  const results = await deps.trpcBatch(
    countries.map(c => ['government.getByCountryId', { countryId: c._id }]),
    { useWorker: true },
  );
  const byCountry = new Map();
  countries.forEach((c, i) => {
    if (results[i]) byCountry.set(c._id, governmentMembers(results[i]));
  });
  return byCountry;
}

/* ── Il profilo linguistico di una nazione ────────────────────────
   Solo le lingue che dicono qualcosa: l'inglese è il default mondiale e
   contarlo affogherebbe ogni differenza. `foreign` è la parte che qui
   non dovrebbe esserci. */
function localeProfile(userIds, localeStore, countryCode) {
  const counts = new Map();
  let known = 0;
  for (const id of userIds) {
    const locale = localeStore[id]?.[0];
    if (!locale) continue;
    known++;
    if (isUninformative(locale)) continue;
    counts.set(locale, (counts.get(locale) || 0) + 1);
  }
  if (!known) return { known: 0, dominant: null, foreign: [] };

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const foreign = sorted
    .filter(([locale]) => !isNativeLocale(locale, countryCode))
    .map(([locale, n]) => ({ locale, n, share: n / known }));

  return { known, dominant: sorted[0]?.[0] || null, foreign };
}

/* ── S1, come nel client ──────────────────────────────────────────── */
function buildMuMix(directory) {
  const mix = new Map();
  for (const mu of directory) {
    if (!mu?.country) continue;
    for (const entry of mu.composition?.top || []) {
      if (!entry?.country) continue;
      let row = mix.get(entry.country);
      if (!row) mix.set(entry.country, row = new Map());
      row.set(mu.country, (row.get(mu.country) || 0) + entry.n);
    }
  }
  return mix;
}

/* ── S8: in quale unità militare milita chi governa ───────────────
   Il segnale più diretto che esista: non "che lingua parlano" ma "per chi
   combattono". Nessuno finisce per sbaglio tesserato in un'unità di
   un'altra nazione, e a differenza della lingua funziona anche quando
   patrono e cliente parlano entrambi inglese.

   Costo zero: `mu` arriva dalla stessa `user.getUserById` già fatta per la
   locale, e la nazione di registrazione dell'unità è nella directory MU
   che il server tiene in cache per la vista Unità Militari. */
function eliteRoster(userIds, store, muHome, ownCountryId) {
  const byCountry = new Map();
  let known = 0;
  for (const id of userIds) {
    const muId = store[id]?.[2];
    if (!muId) continue;
    const home = muHome.get(muId);
    if (!home) continue;
    known++;
    byCountry.set(home, (byCountry.get(home) || 0) + 1);
  }
  if (!known) return null;
  const foreign = [...byCountry.entries()]
    .filter(([countryId]) => countryId !== ownCountryId)
    .sort((a, b) => b[1] - a[1]);
  if (!foreign.length) return { known, top: null, share: 0, count: 0 };
  return { known, top: foreign[0][0], count: foreign[0][1], share: foreign[0][1] / known };
}

/* ── S9: chi finanzia il tesoro ───────────────────────────────────
   `countryMoneyTransfer` è un bonifico fra due tesori: `sellerCountryId`
   paga, `buyerCountryId` incassa (verificato dal vivo — l'Albania compare
   come buyer per 59.800 arrivati dalla Serbia). Qui si guarda solo
   l'ENTRATA: da chi arrivano i soldi di questa nazione.

   Non si scarica per tutti: solo per chi ha già un candidato da un altro
   segnale. Su una nazione qualsiasi sarebbero 180 richieste per un dato
   che nessuno guarderebbe. */
async function fetchFunding(countryIds) {
  const out = new Map();
  for (const countryId of countryIds.slice(0, FUNDING_MAX_COUNTRIES)) {
    const byPayer = new Map();
    let total = 0;
    let cursor = null;
    try {
      for (let page = 0; page < FUNDING_PAGES; page++) {
        const input = { countryId, limit: 100, ...(cursor ? { cursor } : {}) };
        // Non passa da trpcBatch: è paginata a cursore, una pagina alla
        // volta, e il batch serve a raggruppare chiamate indipendenti.
        //
        // Serve la chiave: `transaction.getPaginatedTransactions` risponde
        // 401 "API token required" sia su api6 nudo SIA attraverso il Worker
        // Cloudflare (verificato dal vivo — la chiave del Worker non apre
        // questo endpoint). L'unica che funziona è quella del VPS, la stessa
        // che la route /trpc mette in `X-API-Key`: si riusa quella, presa
        // dall'ambiente e mai scritta nel codice.
        const url = `${deps.trpcUpstream}/transaction.getPaginatedTransactions?input=${encodeURIComponent(JSON.stringify(input))}`;
        const res = await fetch(url, { headers: deps.apiToken ? { 'X-API-Key': deps.apiToken } : {} });
        if (!res.ok) break;
        const data = (await res.json())?.result?.data;
        if (!data?.items?.length) break;
        for (const tx of data.items) {
          if (tx.transactionType !== 'countryMoneyTransfer') continue;
          if (tx.buyerCountryId !== countryId) continue;   // solo entrate
          const payer = tx.sellerCountryId;
          if (!payer || payer === countryId) continue;
          byPayer.set(payer, (byPayer.get(payer) || 0) + (tx.money || 0));
          total += tx.money || 0;
        }
        cursor = data.nextCursor;
        if (!cursor) break;
      }
    } catch (err) {
      // Una nazione che fallisce non deve fermare le altre: resta senza
      // segnale finanziario, che è lo stesso stato di chi non ha bonifici.
      console.warn(`[proxy-index] transazioni di ${countryId} non lette: ${err.message}`);
    }
    const top = [...byPayer.entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(countryId, {
      total,
      topPayer: top ? top[0] : null,
      topAmount: top ? top[1] : 0,
      share: top && total ? top[1] / total : 0,
    });
    await sleep(90);
  }
  return out;
}

function hasDiplomaticTie(nation, patron) {
  return (!!nation.allianceId && nation.allianceId === patron.allianceId)
    || (nation.defensivePacts || []).includes(patron._id)
    || (patron.defensivePacts || []).includes(nation._id)
    || (nation.allies || []).includes(patron._id)
    || (patron.allies || []).includes(nation._id);
}

/**
 * Il punteggio di una nazione, con tutte le evidenze che lo compongono.
 * Restituisce null quando non c'è niente da dire: l'assenza di rilevamento
 * è una risposta legittima, e migliore di un rilevamento inventato su tre
 * persone.
 */
function scoreCountry(ctx, nation) {
  const { mix, medianDamage, byId, byCode, govs, locales, countries } = ctx;
  const code = String(nation.code || '').toUpperCase();

  const evidence = [];
  // I due segnali di tesseramento (cittadini e governo) si raccolgono qui e
  // si applicano insieme più sotto: vedi la nota "valgono per UNO".
  const rosterFactors = [];
  const candidates = new Map();   // countryId → odds moltiplicativi accumulati
  const bump = (id, factor, ev) => {
    if (!id || id === nation._id) return;
    candidates.set(id, (candidates.get(id) || 1) * factor);
    if (ev) evidence.push({ ...ev, patronId: id });
  };

  /* S1 — dove militano i cittadini */
  let muCandidate = null;
  const row = mix.get(nation._id);
  if (row) {
    const known = [...row.values()].reduce((a, b) => a + b, 0);
    const foreign = [...row.entries()]
      .filter(([id]) => id !== nation._id)
      .sort((a, b) => b[1] - a[1]);
    if (known >= MIN_KNOWN && foreign.length) {
      const [patronId, count] = foreign[0];
      const share = count / known;
      const confidence = Math.min(1, known / FULL_CONF_N);
      muCandidate = patronId;
      // Il fattore si applica più sotto, insieme a quello del roster di
      // governo: i due misurano la stessa cosa su due popolazioni diverse
      // (il governo È fatto di cittadini) e moltiplicarli come indipendenti
      // gonficherebbe ogni punteggio verso il 99%.
      rosterFactors.push({
        patronId,
        factor: Math.exp(W_SHARE * (share - F_NEUTRAL) * confidence),
        // Sotto il punto di equilibrio il fattore è minore di 1: entra nel
        // calcolo ma non fra le evidenze, perché mostrarlo come prova
        // direbbe il contrario di quello che il numero sta facendo.
        ev: share >= F_NEUTRAL ? { key: 'radar_ev_units', share: Math.round(share * 100), count, known } : null,
      });
    }
  }

  /* S2 — la lingua di chi governa */
  const gov = govs.get(nation._id);
  if (gov && gov.all.length >= LANG_MIN_ELITE) {
    const profile = localeProfile(gov.all, locales, code);
    const top = profile.foreign[0];
    if (profile.known >= LANG_MIN_ELITE && top && top.share >= LANG_MIN_SHARE && top.n >= LANG_MIN_COUNT) {
      const strength = Math.min(LANG_MAX_LR, Math.exp(LANG_W * (top.share - LANG_MIN_SHARE)))
        * Math.min(1, profile.known / 6);
      const { candidates: homes, ambiguous } = homelandsOf(top.locale, countries);

      if (!ambiguous && homes.length) {
        // Lingua che indica una nazione sola: candidato a pieno titolo,
        // anche se le unità militari non avevano proposto nessuno.
        const patron = byCode.get(homes[0]);
        bump(patron?._id, strength, {
          key: 'radar_ev_government', locale: top.locale,
          share: Math.round(top.share * 100), known: profile.known,
        });
      } else if (muCandidate) {
        // Lingua ambigua: vale solo a conferma di chi le unità militari
        // hanno già proposto, e solo se quel patrono parla quella lingua.
        const patronCode = String(byId.get(muCandidate)?.code || '').toUpperCase();
        if (homes.includes(patronCode)) {
          bump(muCandidate, strength, {
            key: 'radar_ev_government', locale: top.locale,
            share: Math.round(top.share * 100), known: profile.known,
          });
        }
      }

      // Il presidente da solo è un bit ad alta densità: è la persona che
      // il paese ha eletto per rappresentarlo.
      const presLocale = locales[gov.president]?.[0];
      if (presLocale && presLocale === top.locale) {
        evidence.push({ key: 'radar_ev_president', locale: presLocale });
      }
    }
  }

  /* S8 — in quale unità milita chi governa */
  if (gov && gov.all.length) {
    const roster = eliteRoster(gov.all, locales, ctx.muHome, nation._id);
    if (roster && roster.top && roster.known >= ROSTER_MIN_KNOWN && roster.share >= ROSTER_MIN_SHARE) {
      rosterFactors.push({
        patronId: roster.top,
        factor: Math.min(ROSTER_MAX_LR, Math.exp(ROSTER_W * (roster.share - ROSTER_MIN_SHARE))) * Math.min(1, roster.known / 5),
        ev: { key: 'radar_ev_elite_units', share: Math.round(roster.share * 100), count: roster.count, known: roster.known },
      });
    }
  }

  /* ── I due segnali di tesseramento valgono per UNO ──
     "Dove militano i cittadini" e "dove milita chi governa" sono la stessa
     domanda posta a due campioni sovrapposti. Si applica quindi il fattore
     PIÙ FORTE, non il prodotto: l'altro resta fra le evidenze — è
     informazione da leggere — ma non moltiplica una seconda volta.
     Se puntano a due patroni diversi, entrambi restano in gara col proprio
     fattore, ed è giusto: lì stanno davvero dicendo cose diverse. */
  const perPatron = new Map();
  for (const r of rosterFactors) {
    const prev = perPatron.get(r.patronId);
    if (!prev || r.factor > prev.factor) perPatron.set(r.patronId, r);
    if (prev && r.ev) prev.extra = (prev.extra || []).concat(r.ev);
    if (prev && prev.factor >= r.factor && prev.ev && r.factor > prev.factor) { /* no-op, leggibilità */ }
  }
  for (const r of rosterFactors) {
    const chosen = perPatron.get(r.patronId);
    if (chosen !== r && r.ev) evidence.push({ ...r.ev, patronId: r.patronId });
  }
  for (const r of perPatron.values()) bump(r.patronId, r.factor, r.ev);

  /* S9 — chi finanzia il tesoro */
  const funding = ctx.funding?.get(nation._id);
  if (funding && funding.total >= FUNDING_MIN_TOTAL && funding.topPayer && funding.share >= FUNDING_MIN_SHARE) {
    bump(funding.topPayer,
      Math.min(FUNDING_MAX_LR, Math.exp(FUNDING_W * (funding.share - FUNDING_MIN_SHARE))),
      { key: 'radar_ev_funding', share: Math.round(funding.share * 100), amount: Math.round(funding.topAmount) });
  }

  if (!candidates.size) return null;

  const [patronId, product] = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
  let odds = (PRIOR / (1 - PRIOR)) * product;

  /* S4 — legame diplomatico col candidato che ha vinto */
  const patron = byId.get(patronId);
  if (patron) {
    if (hasDiplomaticTie(nation, patron)) {
      odds *= LR_LINK;
      evidence.push({ key: 'radar_ev_tie', patronId });
    } else {
      odds *= LR_NO_LINK;
      evidence.push({ key: 'radar_ev_no_tie', patronId });
    }
    if ((nation.warsWith || []).includes(patron._id)) {
      odds *= LR_AT_WAR;
      evidence.push({ key: 'radar_ev_at_war', patronId });
    }
  }

  /* S5 — anomalia per abitante */
  const perCitizen = nation.rankings?.weeklyCountryDamagesPerCitizen?.value || 0;
  const ratio = medianDamage ? perCitizen / medianDamage : 0;
  if (ratio >= 2) {
    odds *= LR_HIGH_DMG;
    evidence.push({ key: 'radar_ev_damage', ratio: Math.round(ratio * 10) / 10 });
  } else if (ratio > 0 && ratio < 1) {
    odds *= LR_LOW_DMG;
  }

  // ── Il denaro come CONTROLLO, non come autocertificazione ──
  // I numeri dei bonifici viaggiano insieme al rilevamento per poter
  // chiedere dall'esterno: il patrono che abbiamo nominato è davvero chi lo
  // finanzia? Ma attenzione alla circolarità — quando S9 ha fatto punteggio,
  // il patrono nominato È il primo finanziatore per costruzione, e quel
  // confronto non verifica niente. `usedInScore` lo dice: le sole righe su
  // cui il controllo vale qualcosa sono quelle in cui è `false`.
  // Sotto FUNDING_MIN_TOTAL non si riporta nulla: una nazione che ha
  // ricevuto un bonifico solo da 200 risulterebbe finanziata al 100% da
  // chiunque gliel'abbia mandato, che è rumore travestito da certezza.
  const money = ctx.funding?.get(nation._id);
  const fundingScored = evidence.some(e => e.key === 'radar_ev_funding');
  return {
    countryId: nation._id,
    patronId,
    p: odds / (1 + odds),
    evidence: evidence.filter(e => !e.patronId || e.patronId === patronId),
    ...(money && money.total >= FUNDING_MIN_TOTAL && money.topPayer ? {
      money: {
        topPayer: money.topPayer,
        share: Math.round(money.share * 100) / 100,
        total: Math.round(money.total),
        agrees: money.topPayer === patronId,
        usedInScore: fundingScored,
      },
    } : {}),
  };
}

/**
 * Un giro completo. Costo tipico a regime: due richieste per i governi,
 * più una manciata per le lingue nuove. Il primo giro dopo un deploy è
 * l'unico caro (~50 richieste), ed è proprio il caso in cui il tetto
 * MAX_LOOKUPS_PER_RUN serve.
 */
async function pollProxyIndex() {
  try {
    if (!deps) { console.warn('[proxy-index] initProxyIndex non chiamata, salto'); return; }

    const countriesCache = deps.readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.log('[proxy-index] nessuna nazione in cache ancora, salto'); return; }

    const directory = deps.readCache('mu-directory', { data: [] }).data || [];
    if (!directory.length) console.warn('[proxy-index] directory MU vuota: si va con la sola lingua');

    if (!deps.apiToken) console.warn('[proxy-index] WARERA_API_TOKEN assente: il segnale finanziamento resterà spento (401 sulle transazioni)');

    const govs = await fetchGovernments(countries);
    const everyone = [...govs.values()].flatMap(g => g.all);
    const locales = await resolveLocales(everyone);

    const perCitizen = countries
      .map(c => c.rankings?.weeklyCountryDamagesPerCitizen?.value || 0)
      .filter(Boolean)
      .sort((a, b) => a - b);

    const ctx = {
      mix: buildMuMix(directory),
      // unità → nazione di registrazione: serve a S8 e costa una passata
      // sulla directory che è già in memoria.
      muHome: new Map(directory.map(mu => [mu._id, mu.country])),
      medianDamage: perCitizen.length ? perCitizen[Math.floor(perCitizen.length / 2)] : 0,
      byId: new Map(countries.map(c => [c._id, c])),
      byCode: new Map(countries.map(c => [String(c.code || '').toUpperCase(), c])),
      govs, locales, countries,
      funding: null,
    };

    // ── Due passate ──
    // La prima serve a sapere CHI vale la pena guardare: le transazioni si
    // scaricano una nazione alla volta, e farle per tutte e 180 sarebbe
    // spendere 500 richieste per un dato che su gran parte del mondo non
    // verrebbe nemmeno usato. La soglia è bassa di proposito (0,35): a
    // questo giro non si decide niente, si compila solo la lista.
    const sospette = countries
      .map(nation => ({ nation, hit: scoreCountry(ctx, nation) }))
      .filter(x => x.hit && x.hit.p >= 0.35)
      .sort((a, b) => b.hit.p - a.hit.p)
      .map(x => x.nation._id);

    ctx.funding = await fetchFunding(sospette);
    console.log(`[proxy-index] finanziamenti letti per ${ctx.funding.size} nazioni sospette su ${countries.length}`);

    // Taglio di pubblicazione a 0,40, non 0,50 — ritarato il 2026-08-26
    // contro i cluster di migrazione di un'analisi esterna (24 coppie
    // ricavate dalla storia delle cittadinanze, che questo modello non vede
    // mai). Due misure da quel confronto:
    //   · sopra il 75% l'accordo sul patrono è 10/10, quindi la soglia
    //     della MAPPA è messa bene e non si tocca;
    //   · fra 50% e 75% è 12/13, quindi anche la fascia bassa è quasi tutta
    //     giusta — il limite del modello è la copertura, non l'esattezza.
    // Il Suriname (governo tedesco al 86%, proxy vero e documentato) si
    // fermava a ~41% e spariva del tutto. Sotto 0,40 invece si resta muti:
    // lì sotto è rumore.
    const data = [];
    for (const nation of countries) {
      const hit = scoreCountry(ctx, nation);
      if (hit && hit.p >= 0.40) data.push(hit);
    }
    data.sort((a, b) => b.p - a.p);

    deps.writeCache(INDEX_FILE, {
      fetchedAt: Date.now(),
      governments: govs.size,
      localesKnown: Object.keys(locales).length,
      data,
    });
    // Solo le righe in cui il denaro NON ha fatto punteggio: le altre
    // darebbero ragione a se stesse.
    const conSoldi = data.filter(d => d.money && !d.money.usedInScore);
    const concordi = conSoldi.filter(d => d.money.agrees).length;
    console.log(`[proxy-index] aggiornato: ${data.length} rilevamenti (${data.filter(d => d.p >= 0.75).length} sopra il 75%), ${govs.size} governi`);
    if (conSoldi.length) console.log(`[proxy-index] controllo denaro indipendente: il patrono nominato è anche il primo finanziatore in ${concordi}/${conSoldi.length} casi`);
  } catch (err) {
    console.error('[proxy-index] giro fallito:', err.message);
  }
}

function readProxyIndex() {
  try {
    return deps.readCache(INDEX_FILE, { fetchedAt: null, data: [] });
  } catch {
    return { fetchedAt: null, data: [] };
  }
}

module.exports = { initProxyIndex, pollProxyIndex, readProxyIndex };
