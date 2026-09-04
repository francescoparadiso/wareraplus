/* ═══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — bilancio giornaliero di un'unità militare
   -----------------------------------------------------------------------
   La domanda a cui risponde: «la mia unità sta guadagnando o si sta
   dissanguando per stare in guerra?». Il gioco non la fa mai, e non ha un
   posto dove chiederla: espone la ricchezza di ADESSO e nient'altro.

   ── PERCHÉ UNO SCATTO AL GIORNO, E NON UN CALCOLO ─────────────────────
   Non esiste una procedura — pubblica o token-gated — che dica quanto
   aveva un giocatore ieri. `rankings.userWealth` è un valore istantaneo,
   `ranking.getRanking` pure. Quindi lo storico non si ricostruisce: si
   accumula. Conseguenza da dire in chiaro nell'interfaccia e non da
   scoprire dopo:

     · i sette giorni pieni arrivano dopo una settimana di scatti;
     · un giorno saltato (server giù alle 02:00) è perso per sempre, e la
       differenza fra i due scatti superstiti copre due giorni — per
       questo ogni intervallo porta con sé quanti giorni e quante ore
       copre davvero, invece di far finta che siano sempre 24.

   ── IL RODAGGIO ───────────────────────────────────────────────────────
   Ma «torna fra ventiquattr'ore» è il modo migliore per non far tornare
   nessuno. Il PRIMO giorno si scatta quindi anche in mezzo, ogni
   ORE_RODAGGIO, così un raffronto c'è già la sera stessa. Quegli scatti
   hanno un'etichetta con l'ora ('2026-09-04T20') accanto a quella del
   giorno ('2026-09-04'), e le due si ordinano già bene fra loro.

   Non sono una versione peggiore del dato giornaliero: sono lo stesso
   dato su una finestra più corta, e ogni intervallo dice quante ore
   copre — otto ore si leggono come otto ore.

   ⚠️ Il rodaggio finisce appena in archivio ci sono DUE giorni, e da lì
   la serie mostrata usa solo gli scatti giornalieri (vedi `finestra`).
   Non è pignoleria: le colonne mostrate sono al massimo sette, e se
   restassero quelle da quattro ore la "settimana" coprirebbe ventotto
   ore per tutta la settimana vera — il numero giusto sotto l'etichetta
   sbagliata, che è il modo più difficile di accorgersi di un errore.

   Stesso identico vincolo dei bonifici fra tesori
   (server/moneyTransfers.js): là l'API tiene tre giorni scorrevoli, qui
   non tiene niente.

   ── COS'È IL NUMERO ───────────────────────────────────────────────────
   La differenza fra due ricchezze è il SALDO NETTO: entrate meno uscite.
   Non è «quanto ha speso per andare in guerra» — è quello che gli resta
   dopo averlo fatto, che è la domanda che interessa a chi comanda. Un
   membro a −80k può aver comprato armi o aver perso i soldi in una
   compravendita, e questa vista non li distingue: lo dichiara e basta,
   invece di battezzare "spesa militare" un numero che non lo è. Stessa
   trappola di `rankings.countryBounty`, che sembra la spesa di una
   nazione e non lo è (vedi server/battleArchive.js).

   ── CHI VIENE FOTOGRAFATO ─────────────────────────────────────────────
   I membri delle unità ITALIANE — registrate in Italia oppure italiane
   *de facto*, cioè con la nazionalità prevalente fra i membri italiana
   anche se registrate altrove. La distinzione la fa già il cache-server
   (`composition.top` in /mu-directory) e non si ricalcola qui: è lo
   stesso marchio "de facto" che l'elenco unità mostra a tutti.

   Costo di uno scatto: una richiesta al cache-server sulla loopback, una
   ventina di `mu.getById` in due batch, e i membri risolti a blocchi di
   30 con `user.getUserLite`. Sull'ordine delle quaranta richieste al
   giorno, tutte PUBBLICHE: questo processo non ha la chiave API e non
   passa dal Worker.

   ── CHI PUÒ GUARDARE ──────────────────────────────────────────────────
   Chi comanda quell'unità nel GIOCO (owner / commander / manager, cioè
   la stessa capacità `chiedePer` che permette di prenotare un contratto)
   e solo per le unità italiane dell'elenco qui sopra. Non c'è una lista
   di permessi da tenere aggiornata a mano: se in gioco passi comandante,
   entri; se lasci la carica, esci. Gli amministratori del tool vedono
   tutte le unità dell'elenco, per poter rispondere a «io non la vedo».
   ═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { trpcBatch } = require('./wareraApi');
const {
  salvaScattoRicchezza, scattiRicchezzaDisponibili, scattiRicchezza,
  ultimoScattoMu, potaScattiRicchezza, deltaRicchezzaPerMu, totaliRicchezzaPerMu, audit,
} = require('./db');

// Il cache-server sta sulla stessa macchina e ascolta solo sulla loopback:
// niente nginx, niente segreto condiviso, e se non risponde si degrada.
const CACHE_BASE = (process.env.CACHE_BASE || 'http://127.0.0.1:3001').replace(/\/+$/, '');

// La nazione di riferimento. È una costante e non una tabella perché oggi
// serve a una nazione sola: quando ne servirà una seconda, questa riga
// diventa una colonna, non un refactor.
const PAESE_CODICE = (process.env.WEALTH_COUNTRY_CODE || 'IT').toUpperCase();

const TZ = 'Europe/Rome';
const ORA_SCATTO = 2;                   // 02:00 italiane, come /daily-damage nel cache-server
const GIORNI_DELTA = 7;                 // quanti giorni indietro deve poter guardare la vista
const GIORNI_SCATTO = GIORNI_DELTA + 1; // sette differenze vogliono otto fotografie
const RETENTION_GIORNI = 14;            // margine: potare stretto è irreversibile
const CHUNK_UTENTI = 30;                // getUserLite: a 100 il batch dà HTTP 414 (URL troppo lunga)
const CHUNK_MU = 20;
const TTL_LIVE_MS = 3 * 60 * 1000;      // la ricchezza "di adesso", per unità
const TTL_ELENCO_MS = 30 * 60 * 1000;   // l'elenco delle unità italiane
const CONTROLLO_MS = 5 * 60 * 1000;     // ogni quanto si chiede "manca uno scatto?"
// Ogni quante ore si scatta finché l'archivio non ha la settimana piena.
// Quattro e non una: la ricchezza di un giocatore si muove a colpi di
// battaglia e di mercato, e otto misure al giorno sarebbero otto colonne
// di rumore attorno allo stesso numero.
const ORE_RODAGGIO = 4;
// Per quanti giorni si scatta anche in mezzo. Due: cioè oggi. Domani alle
// 02:00 arriva il primo scatto giornaliero, ci sono due giorni in
// archivio e la serie diventa quella vera.
const GIORNI_RODAGGIO = 2;

// ---------------------------------------------------------------------------
// Giorni
// ---------------------------------------------------------------------------
// Le date sono ETICHETTE ('YYYY-MM-DD' nel fuso italiano), non istanti: si
// confrontano e si ordinano come stringhe, e non c'è un solo punto in cui
// serva sapere che ora fosse. L'istante vero viaggia a parte in `taken_at`.

const FMT_GIORNO = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const FMT_ORA = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });

const giornoDi = (ts = Date.now()) => FMT_GIORNO.format(new Date(ts));
const oraDi = (ts = Date.now()) => Number(FMT_ORA.format(new Date(ts)));

/** `giorno` meno n giorni, sempre come etichetta. Passa da UTC apposta:
 *  sommare 86400000 a un timestamp locale sbaglia due volte l'anno. */
function giornoMeno(giorno, n) {
  const [y, m, d] = giorno.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - n * 86400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** La data dentro un'etichetta di momento: '2026-09-04T16' → '2026-09-04'. */
const giornoDelSlot = (slot) => String(slot).slice(0, 10);

/** L'etichetta di uno scatto in mezzo alla giornata. L'ora basta: due
 *  scatti di rodaggio distano ORE_RODAGGIO, non possono cadere nella
 *  stessa. */
function slotOrario(ts = Date.now()) {
  return `${giornoDi(ts)}T${String(oraDi(ts)).padStart(2, '0')}`;
}

/** Quanti giorni di calendario fra due etichette. */
function distanzaGiorni(da, a) {
  const ms = (g) => { const [y, m, d] = giornoDelSlot(g).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(a) - ms(da)) / 86400_000);
}

// ---------------------------------------------------------------------------
// Da chi si prendono i dati
// ---------------------------------------------------------------------------

async function dalCacheServer(percorso) {
  const res = await fetch(`${CACHE_BASE}${percorso}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`cache-server ${percorso}: HTTP ${res.status}`);
  return res.json();
}

let _paese = null; // { id, at }

/** L'id della nazione di riferimento. Si cerca per CODICE e non si scrive
 *  a mano: un ObjectId copiato in una costante è la cosa che nessuno
 *  ricontrolla più. */
async function paeseId() {
  if (_paese && Date.now() - _paese.at < 24 * 3600_000) return _paese.id;

  let elenco = [];
  try {
    const c = await dalCacheServer('/countries');
    elenco = c?.data?.result?.data || c?.data || [];
  } catch {
    // Il cache-server è un'ottimizzazione, mai un punto di rottura in più:
    // la stessa procedura è pubblica su api6.
    const res = await fetch('https://api6.warera.io/trpc/country.getAllCountries', {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`country.getAllCountries: HTTP ${res.status}`);
    const body = await res.json();
    elenco = body?.result?.data || [];
  }

  const paese = elenco.find((n) => String(n?.code || '').toUpperCase() === PAESE_CODICE);
  if (!paese?._id) throw new Error(`nazione ${PAESE_CODICE} non trovata fra ${elenco.length} nazioni`);
  _paese = { id: paese._id, at: Date.now() };
  return _paese.id;
}

let _elenco = null; // { at, mus, fonte }

/**
 * Le unità italiane: registrate in Italia, oppure italiane *de facto*.
 * La composizione arriva già calcolata dal cache-server — rifarla qui
 * vorrebbe dire risolvere la nazione di sedicimila giocatori.
 */
async function elencoUnita({ forza = false } = {}) {
  if (!forza && _elenco && Date.now() - _elenco.at < TTL_ELENCO_MS) return _elenco;

  const italia = await paeseId();
  let mus = [];
  let fonte = 'directory';
  try {
    const dir = await dalCacheServer('/mu-directory');
    const tutte = dir?.data || [];
    if (!tutte.length) throw new Error('directory vuota');
    mus = tutte
      .map((m) => {
        const dominante = m?.composition?.top?.[0]?.country || null;
        const registrata = m.country === italia;
        const deFacto = !registrata && dominante === italia;
        if (!registrata && !deFacto) return null;
        return {
          id: m._id,
          nome: m.name || null,
          avatar: m.avatarUrl || null,
          countryId: m.country || null,
          deFacto,
          membriNoti: m?.composition?.known ?? null,
          membriTotali: m?.composition?.total ?? m.memberCount ?? null,
        };
      })
      .filter(Boolean);
  } catch (err) {
    // Ripiego: le stesse unità dell'ultimo scatto. Uno scatto saltato non
    // si recupera, quindi è meglio rifotografare gli stessi di ieri che
    // non fotografare nessuno.
    const precedenti = ultimoScattoMu();
    if (!precedenti.length) throw err;
    console.warn(`[wealth] directory non disponibile (${err.message}), uso le ${precedenti.length} unità dell'ultimo scatto`);
    mus = precedenti.map((id) => ({ id, nome: null, avatar: null, countryId: null, deFacto: false }));
    fonte = 'ultimo-scatto';
  }

  _elenco = { at: Date.now(), mus, fonte };
  return _elenco;
}

/** Membri (e anagrafica) di un gruppo di unità. `mu.getById` è pubblica e
 *  il suo input è corto: venti per batch stanno larghe nell'URL. */
async function dettaglioUnita(muIds) {
  const out = new Map();
  for (let i = 0; i < muIds.length; i += CHUNK_MU) {
    const fetta = muIds.slice(i, i + CHUNK_MU);
    const risposte = await trpcBatch(fetta.map((muId) => ['mu.getById', { muId }]));
    fetta.forEach((muId, k) => {
      const m = risposte[k];
      if (!m) return;
      out.set(muId, {
        id: muId,
        nome: m.name || null,
        avatar: m.avatarUrl || null,
        countryId: m.country || null,
        membri: Array.isArray(m.members) ? m.members : [],
      });
    });
  }
  return out;
}

/** Ricchezza (e anagrafica) di un gruppo di giocatori. */
async function ricchezzaDi(userIds) {
  const out = new Map();
  for (let i = 0; i < userIds.length; i += CHUNK_UTENTI) {
    const fetta = userIds.slice(i, i + CHUNK_UTENTI);
    const risposte = await trpcBatch(fetta.map((userId) => ['user.getUserLite', { userId }]));
    fetta.forEach((userId, k) => {
      const u = risposte[k];
      if (!u) return;
      out.set(userId, {
        userId,
        username: u.username || null,
        avatar: u.avatarUrl || null,
        muId: u.mu || null,
        countryId: u.country || null,
        livello: u.leveling?.level ?? null,
        wealth: Number(u.rankings?.userWealth?.value ?? 0),
        dannoSettimanale: Number(u.rankings?.weeklyUserDamages?.value ?? 0),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// LO SCATTO
// ---------------------------------------------------------------------------

let _scattoInCorso = false;
let _ultimoEsito = null; // { giorno, righe, unita, durataMs, quando, errore }

async function scatta({ motivo = 'programmato', slot = null } = {}) {
  if (_scattoInCorso) return { saltato: 'gia_in_corso' };
  _scattoInCorso = true;
  const avvio = Date.now();
  // Senza indicazioni si scatta "adesso": è il caso dello scatto a mano.
  const momento = slot || slotOrario(avvio);
  try {
    const { mus, fonte } = await elencoUnita({ forza: true });
    if (!mus.length) throw new Error('nessuna unità da fotografare');

    const dettagli = await dettaglioUnita(mus.map((m) => m.id));
    const muDiUtente = new Map();
    for (const [muId, d] of dettagli) for (const id of d.membri) muDiUtente.set(id, muId);

    const utenti = [...muDiUtente.keys()];
    if (!utenti.length) throw new Error('nessun membro da fotografare');

    const ricchezze = await ricchezzaDi(utenti);
    const takenAt = Date.now();
    const righe = [];
    for (const [userId, muId] of muDiUtente) {
      const r = ricchezze.get(userId);
      // Giocatore sparito fra una chiamata e l'altra: si salta. Uno zero
      // inventato qui diventerebbe domani una perdita di tutto il suo
      // patrimonio nella colonna di ieri.
      if (!r) continue;
      righe.push({ warUserId: userId, wealth: r.wealth, username: r.username, muId, takenAt });
    }

    salvaScattoRicchezza(momento, righe);
    const potate = potaScattiRicchezza(giornoMeno(giornoDi(avvio), RETENTION_GIORNI));

    _ultimoEsito = {
      momento, righe: righe.length, unita: dettagli.size, fonte, motivo,
      durataMs: Date.now() - avvio, quando: takenAt, errore: null,
    };
    console.log(`[wealth] scatto ${momento} (${motivo}): ${righe.length} giocatori in ${dettagli.size} unità, `
      + `${Date.now() - avvio}ms${potate ? `, ${potate} righe vecchie potate` : ''}`);
    return _ultimoEsito;
  } catch (err) {
    _ultimoEsito = { momento, righe: 0, motivo, durataMs: Date.now() - avvio, quando: Date.now(), errore: err.message };
    console.error(`[wealth] scatto ${momento} fallito:`, err.message);
    return _ultimoEsito;
  } finally {
    _scattoInCorso = false;
  }
}

/**
 * Il programmatore. Non un cron: questo processo non ha node-cron fra le
 * dipendenze, e soprattutto si riavvia decine di volte al giorno mentre si
 * sviluppa — una sveglia alle 02:00 la perderebbe ogni volta. La domanda
 * qui è invece «manca uno scatto?», che dopo un riavvio ha la stessa
 * risposta di prima.
 *
 * Tre casi, in quest'ordine:
 *
 *   1. archivio vuoto  → si scatta SUBITO, a qualunque ora. Un giorno di
 *      attesa prima di poter mostrare qualsiasi cosa sarebbe un tool che
 *      non parte.
 *   2. manca il giorno → lo scatto delle 02:00, quello che fa la serie
 *      giornaliera. Etichetta senza ora.
 *   3. rodaggio        → finché l'archivio non ha la settimana piena si
 *      scatta anche in mezzo, ogni ORE_RODAGGIO, così un raffronto c'è
 *      già la sera del primo giorno invece che il giorno dopo.
 */
function scattoDovuto() {
  const scatti = scattiRicchezzaDisponibili(RETENTION_GIORNI * 8);
  const ultimo = scatti[0] || null;
  // Etichetta di GIORNO e non di ora, anche se non sono le 02:00: è il
  // primo scatto di oggi, cioè quello che d'ora in poi rappresenta oggi
  // nella serie giornaliera. Con un'etichetta oraria, domani `finestra()`
  // non troverebbe due scatti giornalieri e resterebbe sulle colonne di
  // rodaggio per un giorno di troppo.
  if (!ultimo) return { motivo: 'primo-avvio', slot: giornoDi() };

  const giorniNoti = new Set(scatti.map((x) => giornoDelSlot(x.slot)));
  const oggi = giornoDi();

  // Lo scatto del giorno manca se manca l'etichetta SENZA ora. Guardare
  // "c'è qualcosa di oggi?" sarebbe sbagliato in un caso solo, ma reale:
  // uno scatto di rodaggio all'una di notte conterebbe come il giorno
  // nuovo e farebbe saltare quello delle 02:00 — quel giorno resterebbe
  // senza etichetta giornaliera, e `finestra()` continuerebbe a mostrare
  // le colonne di rodaggio invece di passare a quelle vere.
  const giorniConScattoGiornaliero = new Set(
    scatti.filter((x) => !x.slot.includes('T')).map((x) => x.slot),
  );
  if (!giorniConScattoGiornaliero.has(oggi) && oraDi() >= ORA_SCATTO) {
    return { motivo: 'giornaliero', slot: oggi };
  }

  if (giorniNoti.size < GIORNI_RODAGGIO
      && ultimo.presoIl
      && Date.now() - ultimo.presoIl >= ORE_RODAGGIO * 3600_000) {
    return { motivo: 'rodaggio', slot: slotOrario() };
  }
  return null;
}

let _timer = null;

function initWealth() {
  const giro = () => {
    const dovuto = scattoDovuto();
    if (dovuto) scatta(dovuto).catch(() => {});
  };
  giro();
  _timer = setInterval(giro, CONTROLLO_MS);
  _timer.unref();
}

/** Per /health: dice se lo storico si sta riempiendo, e da quando. */
function statoRicchezza() {
  const scatti = scattiRicchezzaDisponibili(RETENTION_GIORNI * 8);
  const giorni = new Set(scatti.map((x) => giornoDelSlot(x.slot)));
  return {
    paese: PAESE_CODICE,
    scattiInArchivio: scatti.length,
    giorniInArchivio: giorni.size,
    primoScatto: scatti.at(-1)?.slot || null,
    ultimoScatto: scatti[0]?.slot || null,
    scattoDiOggi: giorni.has(giornoDi()),
    serieCompleta: giorni.size >= GIORNI_SCATTO,
    // Finché è vero si scatta anche in mezzo alla giornata: serve a non
    // chiedere ventiquattr'ore di pazienza prima del primo raffronto.
    rodaggio: giorni.size < GIORNI_RODAGGIO,
    ultimoEsito: _ultimoEsito,
    unitaSeguite: _elenco?.mus.length ?? null,
    fonteElenco: _elenco?.fonte ?? null,
  };
}

// ---------------------------------------------------------------------------
// LA LETTURA
// ---------------------------------------------------------------------------

const _live = new Map(); // muId → { at, dati }

/** Chi c'è nell'unità ADESSO e quanto ha adesso. Serve al giorno in corso,
 *  che nessuno scatto può ancora coprire: senza, chi apre la vista alle 18
 *  vedrebbe l'ultimo dato fermo alle 02:00 e crederebbe che non è successo
 *  niente. Tre minuti di cache: un'unità da trenta persone è una richiesta
 *  in batch, ma dieci ricariche di fila non devono diventare dieci giri. */
async function ricchezzaAttuale(muId) {
  const c = _live.get(muId);
  if (c && Date.now() - c.at < TTL_LIVE_MS) return c.dati;

  const mu = (await dettaglioUnita([muId])).get(muId);
  if (!mu) throw new Error('unita_non_trovata');
  const ricchezze = await ricchezzaDi(mu.membri);
  const dati = {
    id: muId,
    nome: mu.nome,
    avatar: mu.avatar,
    countryId: mu.countryId,
    letteIl: Date.now(),
    membri: mu.membri.map((id) => ricchezze.get(id)).filter(Boolean),
    nonRisolti: mu.membri.length - ricchezze.size,
  };
  _live.set(muId, { at: Date.now(), dati });
  return dati;
}

/** I giorni in archivio dentro la finestra che la vista guarda, dal più
 *  vecchio. Sta qui perché lo usano sia la panoramica sia il rapporto, e
 *  due copie della stessa finestra sono due copie da tenere allineate. */
/**
 * Gli scatti su cui si costruisce la serie mostrata.
 *
 * Appena esistono due scatti GIORNALIERI si usano solo quelli: le colonne
 * a schermo sono al massimo sette, e tenerci dentro anche quelli di
 * rodaggio farebbe una "settimana" lunga ventotto ore. Gli scatti in
 * mezzo restano in archivio — non danno fastidio a nessuno e il primo
 * giorno sono l'unica cosa che c'è.
 */
function finestra() {
  const dal = giornoMeno(giornoDi(), GIORNI_SCATTO);
  const tutti = scattiRicchezzaDisponibili(RETENTION_GIORNI * 8)
    .filter((g) => g.slot >= dal)
    .sort((a, b) => (a.slot < b.slot ? -1 : 1));
  const giornalieri = tutti.filter((g) => !g.slot.includes('T'));
  return giornalieri.length >= 2 ? giornalieri : tutti;
}

/** Gli intervalli CHIUSI fra scatti consecutivi. `giorni`/`ore` dicono
 *  quanto coprono davvero: un giorno saltato non si spalma. */
function intervalliChiusi(scatti) {
  const out = [];
  for (let i = 0; i < scatti.length - 1; i++) {
    const da = scatti[i];
    const a = scatti[i + 1];
    out.push({
      da: da.slot,
      a: a.slot,
      giorni: distanzaGiorni(da.slot, a.slot),
      ore: da.presoIl && a.presoIl ? Math.round((a.presoIl - da.presoIl) / 3600_000) : null,
      // L'istante vero di partenza: serve alla vista per intitolare la
      // colonna con un'ora quando l'intervallo non è una giornata.
      presoIl: da.presoIl || null,
      inCorso: false,
    });
  }
  return out;
}

/**
 * Quanto lontano guarda davvero l'archivio, e quanto pesano le colonne
 * mostrate. `oreMostrate` è la somma degli intervalli CHIUSI a schermo:
 * è quello che permette alla vista di non intitolare "7 giorni" una
 * colonna che ne copre uno e mezzo.
 */
/**
 * Il ritmo GIORNALIERO di un saldo, dalle ore che copre davvero.
 *
 * Non `totale / numero di colonne`: quella formula è giusta solo se ogni
 * colonna è una giornata piena, e non lo è mai in rodaggio (colonne da
 * quattro ore) né quando un giorno è saltato (una colonna da 48 ore).
 * Sotto le 24 ore non si estrapola: `null`, e la vista non mostra la
 * riga — moltiplicare per sei un pomeriggio non è una media, è una
 * profezia.
 */
function ritmoGiornaliero(totale, ore) {
  if (totale == null || !ore || ore < 24) return null;
  return Math.round(totale / (ore / 24));
}

function coperturaDi(scatti, intervalliMostrati) {
  const giorni = new Set(scatti.map((x) => giornoDelSlot(x.slot)));
  const ore = intervalliMostrati.reduce((s, iv) => s + (iv.ore ?? (iv.giorni || 0) * 24), 0);
  return {
    primoGiorno: scatti[0] ? giornoDelSlot(scatti[0].slot) : null,
    ultimoGiorno: scatti.at(-1) ? giornoDelSlot(scatti.at(-1).slot) : null,
    ultimoScattoIl: scatti.at(-1)?.presoIl || null,
    giorniDisponibili: giorni.size,
    giorniRichiesti: GIORNI_SCATTO,
    scattiDisponibili: scatti.length,
    oreMostrate: ore,
    // Vero quando le colonne mostrate NON sono giornate: la vista deve
    // poterlo dire, perché una colonna da quattro ore non è un giorno.
    rodaggio: intervalliMostrati.some((iv) => iv.ore != null && iv.ore < 20),
    completa: giorni.size >= GIORNI_SCATTO,
  };
}

/**
 * LA PANORAMICA: una riga per unità, i giorni in colonna.
 *
 * Costa ZERO richieste a WarEra — è tutta SQL sugli scatti già in
 * archivio. È il motivo per cui è la prima cosa che si vede: con trenta
 * unità, aprire la scheda di ognuna per sapere quale sta perdendo
 * significherebbe trenta letture dal vivo, e la domanda «chi sta
 * andando male» va risposta prima di scegliere dove guardare.
 *
 * Il prezzo, dichiarato nella vista: qui NON c'è il giorno in corso.
 * Quello vuole la ricchezza di adesso, cioè una lettura dal vivo, e si
 * paga solo per l'unità che si apre davvero.
 */
function panoramica(unita) {
  const giorni = finestra();
  // In rodaggio gli intervalli sono più corti e più numerosi: se ne
  // mostrano comunque al massimo sette, e `copertura.oreMostrate` dice
  // quanto pesano davvero — così la colonna del totale non si intitola
  // "7 giorni" quando copre trenta ore.
  const intervalli = intervalliChiusi(giorni).slice(-GIORNI_DELTA);

  // muId → array di delta, allineato agli intervalli (null dove l'unità
  // non aveva nessuno in entrambi gli scatti).
  const serie = new Map();
  intervalli.forEach((iv, i) => {
    for (const r of deltaRicchezzaPerMu(iv.da, iv.a)) {
      if (!serie.has(r.muId)) serie.set(r.muId, { delta: new Array(intervalli.length).fill(null), membri: new Array(intervalli.length).fill(0) });
      serie.get(r.muId).delta[i] = r.delta;
      serie.get(r.muId).membri[i] = r.membri;
    }
  });

  const ultimo = giorni.at(-1) || null;
  const testa = new Map(
    (ultimo ? totaliRicchezzaPerMu(ultimo.slot) : []).map((r) => [r.muId, r]),
  );

  const oreMostrate = intervalli.reduce((x, iv) => x + (iv.ore ?? (iv.giorni || 0) * 24), 0);
  const righe = unita.map((u) => {
    const s = serie.get(u.id);
    const t = testa.get(u.id);
    const chiusi = (s?.delta || []).filter((v) => v != null);
    return {
      ...u,
      membri: t?.membri ?? null,
      ricchezza: t?.ricchezza ?? null,
      serie: s?.delta || new Array(intervalli.length).fill(null),
      membriPerGiorno: s?.membri || new Array(intervalli.length).fill(0),
      ultimo: chiusi.length ? chiusi.at(-1) : null,
      settimana: chiusi.length ? chiusi.reduce((x, v) => x + v, 0) : null,
      media: chiusi.length ? ritmoGiornaliero(chiusi.reduce((x, v) => x + v, 0), oreMostrate) : null,
      giorniNoti: chiusi.length,
    };
  });

  return {
    intervalli,
    unita: righe,
    copertura: coperturaDi(giorni, intervalli),
    riassunto: {
      unita: righe.length,
      giocatori: righe.reduce((x, r) => x + (r.membri || 0), 0),
      ricchezza: righe.reduce((x, r) => x + (r.ricchezza || 0), 0),
      settimana: righe.some((r) => r.settimana != null)
        ? righe.reduce((x, r) => x + (r.settimana || 0), 0)
        : null,
    },
  };
}

/**
 * Il rapporto: una riga per membro, una colonna per giorno.
 *
 * Gli INTERVALLI sono gli stessi per tutti — si costruiscono una volta dai
 * giorni davvero presenti in archivio, non membro per membro. È l'unico
 * modo perché la tabella abbia colonne allineate quando un giocatore è
 * entrato tre giorni fa e un altro c'era già.
 */
async function rapportoUnita(muId, meta = {}) {
  const attuale = await ricchezzaAttuale(muId);
  const ids = attuale.membri.map((m) => m.userId);

  const oggi = giornoDi();
  const dal = giornoMeno(oggi, GIORNI_SCATTO);
  const giorniArchivio = finestra();

  const perUtente = new Map(); // userId → Map(giorno → wealth)
  for (const r of scattiRicchezza(ids, dal)) {
    if (!perUtente.has(r.warUserId)) perUtente.set(r.warUserId, new Map());
    perUtente.get(r.warUserId).set(r.slot, r.wealth);
  }

  const intervalli = intervalliChiusi(giorniArchivio);
  // Il giorno che stiamo vivendo: dall'ultimo scatto a questo momento.
  const ultimo = giorniArchivio.at(-1) || null;
  if (ultimo) {
    intervalli.push({
      da: ultimo.slot,
      a: null,
      giorni: distanzaGiorni(ultimo.slot, oggi),
      ore: ultimo.presoIl ? Math.round((attuale.letteIl - ultimo.presoIl) / 3600_000) : null,
      presoIl: ultimo.presoIl || null,
      inCorso: true,
    });
  }
  // Sette differenze chiuse più quella in corso: più indietro di così la
  // vista non guarda, e tenere le righe di scorta in archivio non è un
  // motivo per spedirle.
  const mostrati = intervalli.slice(-(GIORNI_DELTA + 1));

  const membri = attuale.membri.map((m) => {
    const storia = perUtente.get(m.userId) || new Map();
    const serie = mostrati.map((iv) => {
      const prima = storia.get(iv.da);
      const dopo = iv.inCorso ? m.wealth : storia.get(iv.a);
      if (prima == null || dopo == null) return null; // non c'era: niente, non zero
      return dopo - prima;
    });
    const chiusi = serie.slice(0, -1).filter((v) => v != null);
    return {
      userId: m.userId,
      username: m.username,
      avatar: m.avatar,
      livello: m.livello,
      dannoSettimanale: m.dannoSettimanale,
      attuale: m.wealth,
      serie,
      // Il totale sui soli intervalli CHIUSI: mescolarci il giorno in
      // corso farebbe sembrare in caduta chi ha comprato armi alle nove
      // del mattino e le userà stasera.
      totale: chiusi.length ? chiusi.reduce((s, v) => s + v, 0) : null,
      giorniNoti: chiusi.length,
      // Chi non ha nemmeno uno scatto: è entrato dopo, o l'archivio non è
      // ancora arrivato fin lì. La vista deve poterlo dire.
      nuovo: storia.size === 0,
    };
  });

  const totali = mostrati.map((_, i) => {
    const valori = membri.map((m) => m.serie[i]).filter((v) => v != null);
    return { delta: valori.reduce((s, v) => s + v, 0), membri: valori.length };
  });
  const chiusiTot = totali.slice(0, -1);

  return {
    unita: {
      id: muId,
      nome: attuale.nome || meta.nome || null,
      avatar: attuale.avatar || meta.avatar || null,
      countryId: attuale.countryId,
      deFacto: Boolean(meta.deFacto),
    },
    letteIl: attuale.letteIl,
    // Da quando in qua l'archivio guarda davvero. Senza questo la vista
    // non può distinguere «nessuno ha speso niente» da «non lo sappiamo»,
    // che è la differenza fra un dato e una bugia.
    copertura: coperturaDi(giorniArchivio, mostrati.filter((iv) => !iv.inCorso)),
    intervalli: mostrati,
    membri,
    totali,
    riassunto: {
      ricchezzaTotale: membri.reduce((s, m) => s + (m.attuale || 0), 0),
      inCorso: totali.at(-1)?.delta ?? null,
      settimana: chiusiTot.length ? chiusiTot.reduce((s, t) => s + t.delta, 0) : null,
      mediaGiornaliera: chiusiTot.length
        ? ritmoGiornaliero(
          chiusiTot.reduce((s, t) => s + t.delta, 0),
          mostrati.filter((iv) => !iv.inCorso).reduce((x, iv) => x + (iv.ore ?? (iv.giorni || 0) * 24), 0),
        )
        : null,
      membriTotali: membri.length,
      membriSenzaStorico: membri.filter((m) => m.nuovo).length,
      nonRisolti: attuale.nonRisolti,
    },
  };
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

/** Le unità che questo account può guardare: le comanda E sono italiane.
 *  L'intersezione sta qui e non nel client, perché un elenco filtrato dal
 *  browser è un elenco che il browser può non filtrare. */
async function unitaVisibili(capacita) {
  const { mus, fonte } = await elencoUnita();
  const indice = new Map(mus.map((m) => [m.id, m]));
  const unita = capacita.admin
    ? mus
    : (capacita.chiedePer || []).map((id) => indice.get(id)).filter(Boolean);
  return { unita, fonte };
}

function buildWealthRouter({ requireAuth, capacitaDi }) {
  const router = express.Router();
  router.use(requireAuth);

  /**
   * Cosa può vedere chi chiede. Il client la usa per decidere se disegnare
   * la linguetta: un elenco vuoto significa «niente linguetta», e non
   * costa nulla a nessun altro perché la vista unità la chiama solo se una
   * sessione c'è già.
   */
  router.get('/unita', async (req, res) => {
    try {
      const capacita = await capacitaDi(req.account);
      const { unita, fonte } = await unitaVisibili(capacita);
      res.json({
        unita,
        fonte,
        paese: PAESE_CODICE,
        admin: Boolean(capacita.admin),
        // Il perché di un elenco vuoto: distingue «non comandi nessuna
        // unità» da «comandi un'unità che non è italiana», che portano a
        // due messaggi diversi.
        comandaQualcosa: Boolean((capacita.chiedePer || []).length),
        stato: statoRicchezza(),
      });
    } catch (err) {
      console.error('[wealth] elenco unità fallito:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  /**
   * La panoramica: tutte le unità che si possono guardare, con i loro
   * numeri. Nessuna richiesta a WarEra — è la ragione per cui è la prima
   * schermata invece di un menù a tendina.
   */
  router.get('/panoramica', async (req, res) => {
    try {
      const capacita = await capacitaDi(req.account);
      const { unita, fonte } = await unitaVisibili(capacita);
      res.json({ ...panoramica(unita), fonte, paese: PAESE_CODICE, admin: Boolean(capacita.admin), comandate: capacita.chiedePer || [] });
    } catch (err) {
      console.error('[wealth] panoramica fallita:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  /** Il rapporto di UNA unità. Il permesso si ricontrolla qui: la rotta
   *  sopra dice cosa disegnare, questa è quella che decide davvero. */
  router.get('/unita/:muId', async (req, res) => {
    const { muId } = req.params;
    try {
      const capacita = await capacitaDi(req.account);
      const { unita } = await unitaVisibili(capacita);
      const meta = unita.find((m) => m.id === muId);
      if (!meta) return res.status(403).json({ error: 'non_autorizzato' });

      const dati = await rapportoUnita(muId, meta);
      // Si registra SOLO l'amministratore che guarda un'unità che non
      // comanda. Un comandante che apre la propria è la cosa che questa
      // rotta esiste per fare, e una riga di audit ad ogni ridisegno
      // riempirebbe la tabella di eventi che non dicono niente — mentre
      // «chi ha guardato i conti di un'unità altrui» è esattamente il tipo
      // di cosa per cui l'audit c'è.
      if (capacita.admin && !(capacita.chiedePer || []).includes(muId)) {
        audit(req.account.id, 'wealth.read-altrui', `mu:${muId}`, null);
      }
      res.json(dati);
    } catch (err) {
      if (err.message === 'unita_non_trovata') return res.status(404).json({ error: 'unita_inesistente' });
      console.error(`[wealth] rapporto ${muId} fallito:`, err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  /** Uno scatto a mano. Solo amministratori, e non è un bottone da mettere
   *  nella vista: serve al primo impianto e a rimediare a un giorno saltato
   *  finché è ancora lo stesso giorno. */
  router.post('/scatta', async (req, res) => {
    if (!req.account.is_admin) return res.status(403).json({ error: 'non_autorizzato' });
    const esito = await scatta({ motivo: `manuale:${req.account.id}` });
    audit(req.account.id, 'wealth.snapshot', null, { esito: esito?.errore || 'ok' });
    res.json(esito);
  });

  return router;
}

// `scattoDovuto` esce insieme al resto perché è la sola parte di questo
// modulo che gira da sola mentre nessuno guarda: poterla interrogare
// senza far passare le ore è la differenza fra averla provata e sperarci.
module.exports = { buildWealthRouter, initWealth, statoRicchezza, scatta, scattoDovuto };
