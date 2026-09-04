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

     · il primo giorno la vista non ha nulla da confrontare;
     · i sette giorni pieni arrivano dopo una settimana di scatti;
     · un giorno saltato (server giù alle 02:00) è perso per sempre, e la
       differenza fra i due scatti superstiti copre due giorni — per
       questo ogni intervallo porta con sé quanti giorni e quante ore
       copre davvero, invece di far finta che siano sempre 24.

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
  salvaScattoRicchezza, giorniScattoRicchezza, scattiRicchezza,
  ultimoScattoMu, potaScattiRicchezza, audit,
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
const CONTROLLO_MS = 5 * 60 * 1000;     // ogni quanto si chiede "manca lo scatto di oggi?"

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

/** Quanti giorni di calendario fra due etichette. */
function distanzaGiorni(da, a) {
  const ms = (g) => { const [y, m, d] = g.split('-').map(Number); return Date.UTC(y, m - 1, d); };
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

async function scatta({ motivo = 'programmato' } = {}) {
  if (_scattoInCorso) return { saltato: 'gia_in_corso' };
  _scattoInCorso = true;
  const avvio = Date.now();
  const giorno = giornoDi(avvio);
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

    salvaScattoRicchezza(giorno, righe);
    const potate = potaScattiRicchezza(giornoMeno(giorno, RETENTION_GIORNI));

    _ultimoEsito = {
      giorno, righe: righe.length, unita: dettagli.size, fonte, motivo,
      durataMs: Date.now() - avvio, quando: takenAt, errore: null,
    };
    console.log(`[wealth] scatto ${giorno} (${motivo}): ${righe.length} giocatori in ${dettagli.size} unità, `
      + `${Date.now() - avvio}ms${potate ? `, ${potate} righe vecchie potate` : ''}`);
    return _ultimoEsito;
  } catch (err) {
    _ultimoEsito = { giorno, righe: 0, motivo, durataMs: Date.now() - avvio, quando: Date.now(), errore: err.message };
    console.error(`[wealth] scatto ${giorno} fallito:`, err.message);
    return _ultimoEsito;
  } finally {
    _scattoInCorso = false;
  }
}

/**
 * Il programmatore. Non un cron: questo processo non ha node-cron fra le
 * dipendenze, e soprattutto si riavvia decine di volte al giorno mentre si
 * sviluppa — una sveglia alle 02:00 la perderebbe ogni volta. La domanda
 * qui è invece «manca lo scatto di oggi ed è ora?», che dopo un riavvio ha
 * la stessa risposta di prima.
 *
 * ⚠️ Al PRIMO avvio (archivio vuoto) lo scatto parte subito, a qualunque
 * ora: un giorno di attesa prima ancora di poter mostrare qualcosa sarebbe
 * un tool che non parte. Quel primo intervallo copre quindi meno di 24
 * ore, ed è il motivo per cui ogni differenza porta con sé le ore vere.
 */
function scattoDovuto() {
  const ultimo = giorniScattoRicchezza(1)[0]?.giorno || null;
  if (ultimo === giornoDi()) return null;
  if (!ultimo) return 'primo-avvio';
  return oraDi() >= ORA_SCATTO ? 'programmato' : null;
}

let _timer = null;

function initWealth() {
  const giro = () => {
    const motivo = scattoDovuto();
    if (motivo) scatta({ motivo }).catch(() => {});
  };
  giro();
  _timer = setInterval(giro, CONTROLLO_MS);
  _timer.unref();
}

/** Per /health: dice se lo storico si sta riempiendo, e da quando. */
function statoRicchezza() {
  const giorni = giorniScattoRicchezza(RETENTION_GIORNI + 1);
  return {
    paese: PAESE_CODICE,
    giorniInArchivio: giorni.length,
    primoGiorno: giorni.at(-1)?.giorno || null,
    ultimoGiorno: giorni[0]?.giorno || null,
    scattoDiOggi: giorni[0]?.giorno === giornoDi(),
    serieCompleta: giorni.length >= GIORNI_SCATTO,
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
  const giorniArchivio = giorniScattoRicchezza(RETENTION_GIORNI + 1)
    .filter((g) => g.giorno >= dal)
    .sort((a, b) => (a.giorno < b.giorno ? -1 : 1));

  const perUtente = new Map(); // userId → Map(giorno → wealth)
  for (const r of scattiRicchezza(ids, dal)) {
    if (!perUtente.has(r.warUserId)) perUtente.set(r.warUserId, new Map());
    perUtente.get(r.warUserId).set(r.giorno, r.wealth);
  }

  // Intervalli chiusi: fra due scatti consecutivi. Se un giorno manca
  // (server giù) l'intervallo ne copre due, e lo dichiara invece di
  // spalmare la differenza su una giornata sola.
  const intervalli = [];
  for (let i = 0; i < giorniArchivio.length - 1; i++) {
    const da = giorniArchivio[i];
    const a = giorniArchivio[i + 1];
    intervalli.push({
      da: da.giorno,
      a: a.giorno,
      giorni: distanzaGiorni(da.giorno, a.giorno),
      ore: da.presoIl && a.presoIl ? Math.round((a.presoIl - da.presoIl) / 3600_000) : null,
      inCorso: false,
    });
  }
  // Il giorno che stiamo vivendo: dall'ultimo scatto a questo momento.
  const ultimo = giorniArchivio.at(-1) || null;
  if (ultimo) {
    intervalli.push({
      da: ultimo.giorno,
      a: null,
      giorni: distanzaGiorni(ultimo.giorno, oggi),
      ore: ultimo.presoIl ? Math.round((attuale.letteIl - ultimo.presoIl) / 3600_000) : null,
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
    copertura: {
      primoGiorno: giorniArchivio[0]?.giorno || null,
      ultimoGiorno: ultimo?.giorno || null,
      ultimoScattoIl: ultimo?.presoIl || null,
      giorniDisponibili: giorniArchivio.length,
      giorniRichiesti: GIORNI_SCATTO,
      completa: giorniArchivio.length >= GIORNI_SCATTO,
    },
    intervalli: mostrati,
    membri,
    totali,
    riassunto: {
      ricchezzaTotale: membri.reduce((s, m) => s + (m.attuale || 0), 0),
      inCorso: totali.at(-1)?.delta ?? null,
      settimana: chiusiTot.length ? chiusiTot.reduce((s, t) => s + t.delta, 0) : null,
      mediaGiornaliera: chiusiTot.length
        ? Math.round(chiusiTot.reduce((s, t) => s + t.delta, 0) / chiusiTot.length)
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

module.exports = { buildWealthRouter, initWealth, statoRicchezza, scatta };
