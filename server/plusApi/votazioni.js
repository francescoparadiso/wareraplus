/* ══════════════════════════════════════════════════════════════════════
   VOTAZIONI — il congresso vota su WarEra+
   ----------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): una sezione dentro Political per
   far votare i parlamentari su una proposta, con login Discord. Il gioco
   ha le elezioni ma non le votazioni di un'assemblea: questa è la seconda
   metà del parlamento.

   ── IL CORPO ELETTORALE ───────────────────────────────────────────────
   Si sceglie quando si crea la votazione:
     · congresso    — `congressMembers` di government.getByCountryId;
     · istituzioni  — congresso più presidente, vice e ministri;
     · referendum   — tutti i cittadini.
   Congresso e istituzioni si FOTOGRAFANO all'apertura (votazione_elettore,
   con nome e partito). Le elezioni del congresso sono due al mese: senza
   fotografia una votazione aperta a cavallo di un'elezione cambierebbe
   elettori a metà, e la maggioranza assoluta perderebbe il denominatore.
   Il referendum invece si controlla al momento del voto (fotografare
   migliaia di cittadini non serve), con tre condizioni contro gli account
   di comodo: cittadino ADESSO, livello ≥ MIN_LIVELLO, personaggio creato
   prima dell'apertura. I suoi aventi diritto sono una STIMA (`n10` del
   censimento del cache-server: livello 10 o più, attivi negli ultimi tre
   giorni) e la risposta lo dichiara (`stimati`). Per questo il
   referendum non ha la maggioranza assoluta: sarebbe una soglia calcolata
   su un numero che non conosciamo davvero.

   Un voto vale per PERSONAGGIO di gioco (war_user_id), non per account
   Discord: è il personaggio che siede in congresso.

   ── CHI CREA, CHI VEDE ────────────────────────────────────────────────
   Crea il governo E il congresso della nazione (scelta dell'utente: in un
   parlamento le proposte nascono anche dai parlamentari). Ritira chi l'ha
   creata o il governo, ma solo PRIMA dell'apertura: dopo, il testo su cui
   qualcuno ha già votato non si tocca. L'amministratore può ritirarla
   sempre — è moderazione, e resta nell'audit.

   Che una votazione ESISTA, titolo, orari e affluenza sono pubblici. Il
   testo e l'esito dipendono da `visibility`:
     · pubblico     — tutti, anche senza login e anche stranieri;
     · istituzioni  — testo a chi vota (per il referendum, i cittadini) e
                      a governo e congresso di adesso; esito SOLO a governo
                      e congresso (di adesso o fotografati).

   ── IL SEGRETO ────────────────────────────────────────────────────────
   Il server deve sapere CHI ha votato, per impedire il doppio voto, ma non
   COSA. Le due cose stanno in tabelle senza alcun legame:
     votazione_partecipazione  (vote_id, war_user_id)       — niente scelta, niente ora
     votazione_scheda          (vote_id, id casuale, scelta) — niente utente, niente ora
   Entrambe WITHOUT ROWID: l'ordine fisico delle righe segue la chiave, non
   l'arrivo, quindi la terza scheda scritta non è "quella del terzo che ha
   votato". Al sigillo le schede si rimescolano (crypto), finiscono dentro
   votazione.result e le righe si CANCELLANO.
   ⚠️ Per lo stesso motivo un voto segreto NON va nell'audit: l'audit ha
   l'ora, e l'ora è proprio ciò che la partecipazione non porta.
   Cosa NON garantisce, e la vista lo dice: chi ha accesso al VPS mentre la
   votazione è aperta può confrontare due copie del database prima e dopo
   un voto. Contro quello servirebbero firme cieche, cioè un altro progetto.

   ── DURANTE E DOPO ────────────────────────────────────────────────────
   Durante il voto si vede solo l'affluenza, in tutti e due i modi: i voti
   parziali condizionerebbero chi non ha ancora votato. Un voto non si
   cambia. Allo scadere il giro qui sotto SIGILLA l'esito (al più GIRO_MS
   dopo) e lo scrutinio comincia per tutti alla stessa ora,
   `scrutinioAlle` = chiusura + ATTESA_SCRUTINIO_MS, e dura `durataMs`.
   Il client disegna la posizione dello scrutinio da `ora − scrutinioAlle`:
   chi guarda insieme vede la stessa scheda nello stesso istante. Per non
   rovinarlo, l'esito nelle liste compare solo a scrutinio FINITO; la
   sequenza (/:id/scrutinio) da `scrutinioAlle`.
   ══════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const express = require('express');
const { calcolaEffettivi } = require('./roles');
const { bearer } = require('./auth');
const { paesiMappa, conteggiCittadini, elezioniDi, nomiUtenti } = require('./fonti');
const { trpcGet, trpcBatchSame } = require('./wareraApi');
const { avvisa, urlWebhookValido } = require('./notify');
const {
  accountFromToken, audit, getWebhook, setWebhook, deleteWebhook, votazioniDaAvvisare, segnaAvviso,
  listaVotazioni, getVotazione, votazioniDaLavorare, contaVotazioniAttive, creaVotazione, ritiraVotazione,
  fissaElettori, elettoriDi, eElettore, haVotato, contaPartecipanti, partecipantiDi, votoPalese,
  registraVoto, schedeDi, votiPalesiDi, sigillaVotazione,
} = require('./db');

const ID_GIOCO = /^[a-f0-9]{24}$/i;
const CORPI = new Set(['congresso', 'istituzioni', 'referendum']);
const SCRUTINI = new Set(['palese', 'segreto']);
const VISIBILITA = new Set(['istituzioni', 'pubblico']);
const MAGGIORANZE = new Set(['semplice', 'assoluta', 'due_terzi']);
const SCELTE = new Set(['si', 'no', 'astenuto', 'nulla']);

// Le cariche di governo, dalla più alta (le stesse di roles.js).
const CARICHE = ['president', 'vicePresident', 'minOfDefense', 'minOfForeignAffairs', 'minOfEconomy'];

const MIN_LIVELLO = 10;
const MAX_TITOLO = 120;
const MAX_TESTO = 6000;
const MAX_NOTA = 280;
const DURATA_MIN = 60;            // minuti
const DURATA_MAX = 7 * 24 * 60;
const ANTICIPO_MAX_MS = 30 * 24 * 3600_000;
const MAX_ATTIVE_PER_NAZIONE = 20;

// Un'apertura entro un minuto da adesso è "subito": il modulo manda l'ora
// del clic, che arriva qui già nel passato di qualche secondo.
const SUBITO_MS = 60_000;
const ATTESA_SCRUTINIO_MS = 60_000;
const GIRO_MS = 20_000;

class Rifiuto extends Error {
  constructor(codice, stato = 400) { super(codice); this.codice = codice; this.stato = stato; }
}

// ---------------------------------------------------------------------------
// Tempi
// ---------------------------------------------------------------------------

/** Quanto dura lo scrutinio. Lo decide il server perché è lui che dice
 *  quando l'esito si può mostrare; il client adatta il passo a questo
 *  numero. Palese: l'emiciclo che si accende LENTAMENTE (richiesta
 *  dell'utente), da 20 s per un congresso piccolo a 45 s, più il tempo del
 *  tabellone in coda (vedi votesHemicycle.js: le ultime quote).
 *  Segreto: in congresso (e congresso + governo) ogni scheda ha lo STESSO
 *  tempo, 3 s, dalla prima all'ultima — accelerare lì era troppo veloce
 *  per leggerle (richiesta dell'utente, 2026-10-23). Si accelera SOLO nel
 *  referendum, dove le schede sono centinaia: 3 s le prime dieci, 1 s le
 *  prossime trenta, 20 s di spoglio rapido per tutte le altre. In entrambi
 *  i casi +6 s (apertura e chiusura dell'urna). ⚠️ La stessa scaletta sta
 *  in src/political/votesUrn.js: cambiarne una sola sfasa l'animazione. */
const URNA_SCHEDA_MS = 3_000;
// Dieci minuti: un congresso di 200 seggi a 3 s a scheda. Oltre, la
// scaletta del client si comprime in proporzione (sempre a passo costante).
const URNA_MAX_CONGRESSO_MS = 600_000;
const URNA_MAX_REFERENDUM_MS = 120_000;
function durataScrutinio(ballot, n, electorate) {
  if (ballot === 'palese') return Math.round(Math.min(45_000, Math.max(20_000, 15_000 + 150 * n)));
  if (electorate !== 'referendum') return Math.min(URNA_MAX_CONGRESSO_MS, 6_000 + URNA_SCHEDA_MS * n);
  const lente = Math.min(n, 10) * URNA_SCHEDA_MS;
  const medie = Math.max(0, Math.min(n, 40) - 10) * 1_000;
  const rapido = n > 40 ? 20_000 : 0;
  return Math.min(URNA_MAX_REFERENDUM_MS, 6_000 + lente + medie + rapido);
}

function stato(v, ora = Date.now()) {
  if (v.withdrawn_at) return 'ritirata';
  if (ora < v.opens_at) return 'programmata';
  if (ora < v.closes_at) return v.eligible_count == null ? 'in_apertura' : 'aperta';
  if (!v.sealed_at) return 'in_sigillo';
  return 'conclusa';
}

function tempiScrutinio(v) {
  const r = leggiRisultato(v);
  const scrutinioAlle = v.closes_at + ATTESA_SCRUTINIO_MS;
  const durataMs = r ? r.durataMs : null;
  return { scrutinioAlle, durataMs, fineScrutinio: durataMs != null ? scrutinioAlle + durataMs : null };
}

function leggiRisultato(v) {
  if (!v.result) return null;
  try { return JSON.parse(v.result); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Chi guarda
// ---------------------------------------------------------------------------

/** Login FACOLTATIVO per le letture: senza token si vede la parte
 *  pubblica, con il token anche quello che la carica permette. Sotto la
 *  lente dell'amministratore passa da risolviIdentita come ovunque. */
function identitaFacoltativa(risolviIdentita) {
  return (req, res, next) => {
    const account = accountFromToken(bearer(req));
    if (!account) {
      req.account = null; req.identita = null; req.lente = null;
      return next();
    }
    req.account = account;
    return risolviIdentita(req, res, next);
  };
}

async function chiGuarda(req) {
  const chi = req.identita;
  const amministra = Boolean(req.account?.is_admin) && !req.lente;
  const lente = Boolean(req.lente);
  if (!chi) return { loggato: false, verificato: false, amministra, lente, gestisce: [] };
  if (!chi.war_user_id) return { loggato: true, verificato: false, amministra, lente, gestisce: [] };
  const eff = await calcolaEffettivi(chi, {});
  return {
    loggato: true,
    verificato: true,
    amministra,
    lente,
    warUserId: chi.war_user_id,
    nome: chi.war_username || null,
    countryId: eff.derivati?.countryId || null,
    carica: eff.derivati?.carica || null,
    gestisce: eff.capacita?.gestisceNazione || [],
    erroreGioco: eff.erroreGioco || null,
  };
}

/** Governo o congresso di ADESSO di quella nazione (o amministratore). */
const istituzioni = (g, countryId) => g.amministra || g.gestisce.includes(countryId)
  || (g.countryId === countryId && Boolean(g.carica));

const governa = (g, countryId) => g.amministra || g.gestisce.includes(countryId);

const fotografato = (v, g) => Boolean(g.warUserId) && v.electorate !== 'referendum' && eElettore(v.id, g.warUserId);

function vedeTesto(v, g) {
  if (v.visibility === 'pubblico') return true;
  if (istituzioni(g, v.country_id) || fotografato(v, g)) return true;
  return v.electorate === 'referendum' && g.countryId === v.country_id;
}

function vedeEsito(v, g) {
  return v.visibility === 'pubblico' || istituzioni(g, v.country_id) || fotografato(v, g);
}

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

function testoBreve(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

/** Testo su più righe: si tengono gli a capo (una proposta si legge per
 *  articoli), si tolgono i doppi vuoti e gli spazi in coda. */
function testoLungo(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, max);
  return s || null;
}

async function campiVotazione(body) {
  const b = body || {};
  const countryId = String(b.nazione || '').trim();
  if (!ID_GIOCO.test(countryId) || !(await paesiMappa()).has(countryId)) throw new Rifiuto('nazione_non_valida');

  const title = testoBreve(b.titolo, MAX_TITOLO);
  if (!title) throw new Rifiuto('titolo_mancante');

  const electorate = String(b.corpo || '');
  const ballot = String(b.scrutinio || '');
  const visibility = String(b.visibilita || '');
  const majority = String(b.maggioranza || 'semplice');
  if (!CORPI.has(electorate)) throw new Rifiuto('corpo_non_valido');
  if (!SCRUTINI.has(ballot)) throw new Rifiuto('scrutinio_non_valido');
  if (!VISIBILITA.has(visibility)) throw new Rifiuto('visibilita_non_valida');
  if (!MAGGIORANZE.has(majority)) throw new Rifiuto('maggioranza_non_valida');
  if (electorate === 'referendum' && majority === 'assoluta') throw new Rifiuto('assoluta_non_per_referendum');

  let quorum = null;
  if (b.quorum != null && b.quorum !== '' && Number(b.quorum) !== 0) {
    quorum = Math.round(Number(b.quorum));
    if (!Number.isFinite(quorum) || quorum < 1 || quorum > 100) throw new Rifiuto('quorum_non_valido');
  }

  const ora = Date.now();
  let opensAt = ora;
  if (b.apre != null && b.apre !== '') {
    const t = Number(b.apre);
    if (!Number.isFinite(t) || t < ora - SUBITO_MS || t > ora + ANTICIPO_MAX_MS) throw new Rifiuto('apertura_non_valida');
    opensAt = t <= ora + SUBITO_MS ? ora : Math.round(t);
  }
  const durata = Math.round(Number(b.durataMin));
  if (!Number.isFinite(durata) || durata < DURATA_MIN || durata > DURATA_MAX) throw new Rifiuto('durata_non_valida');

  return {
    country_id: countryId,
    title,
    body: testoLungo(b.testo, MAX_TESTO),
    electorate, ballot, visibility, majority,
    quorum_pct: quorum,
    opens_at: opensAt,
    closes_at: opensAt + durata * 60_000,
  };
}

// ---------------------------------------------------------------------------
// Apertura: la fotografia del corpo elettorale
// ---------------------------------------------------------------------------

const _aperture = new Map(); // voteId → promessa: due giri non fotografano due volte

function apri(v) {
  if (!_aperture.has(v.id)) {
    _aperture.set(v.id, fotografa(v).finally(() => _aperture.delete(v.id)));
  }
  return _aperture.get(v.id);
}

async function fotografa(v) {
  if (v.electorate === 'referendum') {
    const c = await conteggiCittadini(v.country_id);
    const n = c?.n10 ?? c?.n;
    if (!n) throw new Error('censimento_non_disponibile');
    fissaElettori(v.id, [], n, true);
    return;
  }

  // Il governo si rilegge FRESCO, non dalla memo di fonti.js: la
  // fotografia è quella che vale per tutta la votazione.
  const gov = await trpcGet('government.getByCountryId', { countryId: v.country_id });
  if (!gov) throw new Error('governo_non_leggibile');
  const ruoli = new Map();
  if (v.electorate === 'istituzioni') {
    for (const k of CARICHE) if (gov[k] && !ruoli.has(gov[k])) ruoli.set(gov[k], k);
  }
  for (const id of gov.congressMembers || []) if (!ruoli.has(id)) ruoli.set(id, 'congress');
  const ids = [...ruoli.keys()];

  // Il partito di ciascuno: getUserLite non lo porta, gli eletti delle
  // ultime elezioni sì. Prima il congresso, poi la presidenziale.
  const partitoDi = new Map();
  try {
    const elezioni = await elezioniDi(v.country_id);
    const recenti = [...elezioni]
      .filter((e) => e.status === 'finished')
      .sort((a, b) => Date.parse(b.votesStartAt || 0) - Date.parse(a.votesStartAt || 0));
    for (const tipo of ['congress', 'president']) {
      const e = recenti.find((x) => x.type === tipo);
      for (const c of e?.candidates || []) {
        if (c.user && c.party && !partitoDi.has(c.user)) partitoDi.set(c.user, c.party);
      }
    }
  } catch { /* senza partiti l'emiciclo si dispone per carica, non è un guasto */ }

  const idPartiti = [...new Set(ids.map((id) => partitoDi.get(id)).filter(Boolean))];
  const nomiPartiti = new Map();
  if (idPartiti.length) {
    try {
      const partiti = await trpcBatchSame('party.getById', idPartiti.map((partyId) => ({ partyId })));
      idPartiti.forEach((id, i) => { if (partiti[i]?.name) nomiPartiti.set(id, partiti[i].name); });
    } catch { /* idem */ }
  }

  const nomi = await nomiUtenti(ids);
  const elettori = ids.map((id) => ({
    warUserId: id,
    nome: nomi[id]?.username || null,
    avatar: nomi[id]?.avatarUrl || null,
    ruolo: ruoli.get(id),
    partito: partitoDi.get(id) || null,
    partitoNome: nomiPartiti.get(partitoDi.get(id)) || null,
  }));
  fissaElettori(v.id, elettori, elettori.length, false);
}

// ---------------------------------------------------------------------------
// Sigillo: l'esito
// ---------------------------------------------------------------------------

/** Rimescolamento di Fisher–Yates con numeri crittografici. */
function rimescola(a) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Le regole, come alla Camera:
 *   presenti = chi ha messo una scheda (anche astenuti e nulle);
 *   votanti  = favorevoli + contrari;
 *   il quorum si conta sui PRESENTI, la maggioranza sui VOTANTI —
 *   tranne l'assoluta, che si conta sugli aventi diritto.
 */
function calcolaEsito(v, c) {
  const presenti = c.si + c.no + c.astenuto + c.nulla;
  const votanti = c.si + c.no;
  const aventi = v.eligible_count || 0;
  const quorumServe = v.quorum_pct ? Math.ceil((aventi * v.quorum_pct) / 100) : null;
  const quorumOk = quorumServe == null || presenti >= quorumServe;
  let soglia;
  if (v.majority === 'assoluta') soglia = Math.floor(aventi / 2) + 1;
  else if (v.majority === 'due_terzi') soglia = Math.ceil((votanti * 2) / 3);
  else soglia = Math.floor(votanti / 2) + 1;
  soglia = Math.max(1, soglia);
  const esito = !quorumOk ? 'quorum_mancato' : c.si >= soglia ? 'approvata' : 'respinta';
  return {
    conteggi: c, presenti, votanti, aventiDiritto: aventi, stimati: Boolean(v.eligible_estimated),
    soglia, quorumServe, quorumOk, esito,
  };
}

function sigilla(v) {
  const conta = { si: 0, no: 0, astenuto: 0, nulla: 0 };
  let sequenza = null;
  let voti = null;
  if (v.ballot === 'segreto') {
    const schede = schedeDi(v.id);
    for (const s of schede) conta[s.choice] = (conta[s.choice] || 0) + 1;
    sequenza = rimescola(schede).map((s) => (s.note ? { s: s.choice, n: s.note } : { s: s.choice }));
  } else {
    const righe = votiPalesiDi(v.id);
    for (const r of righe) conta[r.choice] = (conta[r.choice] || 0) + 1;
    // Rimescolati anche qui, e sigillati: l'ordine in cui l'emiciclo si
    // accende è lo stesso per tutti quelli che guardano.
    voti = rimescola(righe).map((r) => ({ id: r.war_user_id, nome: r.name, s: r.choice, ...(r.note ? { n: r.note } : {}) }));
  }
  const n = conta.si + conta.no + conta.astenuto + conta.nulla;
  const risultato = { ...calcolaEsito(v, conta), durataMs: durataScrutinio(v.ballot, n, v.electorate), sequenza, voti };
  return sigillaVotazione(v.id, risultato);
}

// ---------------------------------------------------------------------------
// Avvisi su Discord
// ---------------------------------------------------------------------------
// Un canale per nazione (scope `votazioni`), lo imposta il governo. Tre
// avvisi per votazione: apertura, INIZIO dello scrutinio (per guardarlo in
// diretta) ed esito — quest'ultimo a scrutinio FINITO, come nella vista:
// un esito su Discord prima della fine rovinerebbe la diretta a tutti.
// In inglese come gli altri avvisi (vedi notify.js). Mai il testo della
// proposta, e con esito riservato nemmeno i numeri: il canale può avere
// dentro chiunque, e non solo governo e congresso.

const BASE_CLIENT = process.env.WP_ENV === 'live' ? 'https://wareraplus.vercel.app' : 'https://wareraplus-dev.vercel.app';
const CORPI_EN = { congresso: 'congress', istituzioni: 'congress and government', referendum: 'referendum (all citizens)' };
const ESITI_EN = { approvata: '✅ **Approved**', respinta: '❌ **Rejected**', quorum_mancato: '⚠️ **No quorum**' };

const linkVotazione = (v) => `${BASE_CLIENT}/?section=political&country=${v.country_id}&tab=votes&vote=${v.id}`;
const quandoDiscord = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

function testoAvviso(tipo, v) {
  const titolo = String(v.title || '').replace(/[*_`~|]/g, '');
  if (tipo === 'apertura') {
    return `🗳️ **New vote** — ${titolo}\nWho votes: ${CORPI_EN[v.electorate]} · ${v.ballot} ballot · closes ${quandoDiscord(v.closes_at)}\n${linkVotazione(v)}`;
  }
  if (tipo === 'scrutinio') {
    return `📢 **The count is starting** — ${titolo}\nWatch it live: ${linkVotazione(v)}`;
  }
  const r = leggiRisultato(v);
  if (v.visibility !== 'pubblico' || !r) {
    return `🔒 **Vote closed** — ${titolo}\nThe result is reserved to government and congress: ${linkVotazione(v)}`;
  }
  const c = r.conteggi;
  const aff = r.aventiDiritto ? ` · turnout ${Math.round((r.presenti / r.aventiDiritto) * 100)}%` : '';
  return `${ESITI_EN[r.esito] || r.esito} — ${titolo}\nIn favour ${c.si} · Against ${c.no} · Abstained ${c.astenuto} · Spoiled ${c.nulla}${aff}\n${linkVotazione(v)}`;
}

function mandaAvvisi(ora) {
  for (const v of votazioniDaAvvisare()) {
    const tempi = tempiScrutinio(v);
    const passi = [
      // L'apertura solo se è ancora aperta: una fotografia arrivata tardi
      // non annuncia una votazione già chiusa.
      ['notified_open', true, 'apertura', ora < v.closes_at],
      ['notified_count', Boolean(v.sealed_at) && ora >= tempi.scrutinioAlle, 'scrutinio', tempi.fineScrutinio == null || ora < tempi.fineScrutinio],
      ['notified_result', tempi.fineScrutinio != null && ora >= tempi.fineScrutinio, 'esito', true],
    ];
    for (const [colonna, dovuto, tipo, utile] of passi) {
      if (!dovuto || v[colonna]) continue;
      if (!segnaAvviso(v.id, colonna)) continue;
      if (utile) avvisa('votazioni', v.country_id, testoAvviso(tipo, v));
    }
  }
}

// ---------------------------------------------------------------------------
// Il giro
// ---------------------------------------------------------------------------

const _giro = { ultimo: null, errore: null, aperte: 0, sigillate: 0 };

async function lavora() {
  const ora = Date.now();
  for (const v of votazioniDaLavorare(ora)) {
    try {
      if (v.eligible_count == null) {
        await apri(v);
        _giro.aperte++;
      }
      const fresca = getVotazione(v.id);
      if (fresca && fresca.closes_at <= Date.now() && !fresca.sealed_at && fresca.eligible_count != null) {
        if (sigilla(fresca)) _giro.sigillate++;
      }
    } catch (err) {
      // Si riprova al giro dopo: una votazione in apertura senza fotografia
      // non accetta voti, e la vista lo dice ("in apertura").
      _giro.errore = `${v.id}: ${err.message}`;
      console.warn(`[votazioni] votazione ${v.id} non lavorata:`, err.message);
    }
  }
  try { mandaAvvisi(Date.now()); } catch (err) { _giro.errore = `avvisi: ${err.message}`; }
  _giro.ultimo = Date.now();
}

/** Prima di rispondere su una votazione: se il giro non è ancora passato,
 *  lo si fa qui per lei. Chi apre la pagina allo scadere non deve vedere
 *  "in apertura" per venti secondi. */
async function aggiornata(v) {
  if (!v || v.withdrawn_at) return v;
  const ora = Date.now();
  try {
    if (v.eligible_count == null && v.opens_at <= ora) await apri(v);
    const f = getVotazione(v.id);
    if (f.closes_at <= ora && !f.sealed_at && f.eligible_count != null) sigilla(f);
  } catch (err) {
    console.warn(`[votazioni] votazione ${v.id} non aggiornata:`, err.message);
  }
  return getVotazione(v.id);
}

function initVotazioni() {
  setInterval(() => { lavora().catch((err) => { _giro.errore = err.message; }); }, GIRO_MS).unref();
  lavora().catch((err) => { _giro.errore = err.message; });
}

function statoVotazioni() {
  return { ..._giro };
}

// ---------------------------------------------------------------------------
// Forma esposta al client
// ---------------------------------------------------------------------------

function esitoSintetico(r) {
  if (!r) return null;
  const { sequenza, voti, ...resto } = r; // eslint-disable-line no-unused-vars
  return resto;
}

function forma(v, g, ora = Date.now()) {
  const st = stato(v, ora);
  const tempi = tempiScrutinio(v);
  const testo = vedeTesto(v, g);
  const esito = vedeEsito(v, g);
  const finito = tempi.fineScrutinio != null && ora >= tempi.fineScrutinio;

  // Il mio stato. "elettore" per il referendum è solo un'indicazione (la
  // cittadinanza in cache): livello ed età del personaggio si controllano
  // quando si vota.
  let mio = null;
  if (g.loggato) {
    const votato = g.warUserId ? haVotato(v.id, g.warUserId) : false;
    const elettore = !g.warUserId ? false
      : v.electorate === 'referendum' ? g.countryId === v.country_id
      : v.eligible_count == null ? null : eElettore(v.id, g.warUserId);
    // Il proprio voto palese lo si rivede; sotto la lente, a urne aperte,
    // l'amministratore no: sarebbe un voto palese visto prima di tutti.
    const voto = votato && v.ballot === 'palese' && !(g.lente && st === 'aperta')
      ? votoPalese(v.id, g.warUserId) : null;
    mio = {
      verificato: g.verificato,
      elettore,
      haVotato: votato,
      voto: voto ? { scelta: voto.choice, nota: voto.note || null } : null,
      puoRitirare: st === 'programmata' && (g.amministra || governa(g, v.country_id)
        || (g.warUserId && g.warUserId === v.created_war_user)),
    };
  }

  return {
    id: v.id,
    nazione: v.country_id,
    titolo: v.title,
    testo: testo ? v.body : null,
    testoRiservato: !testo,
    corpo: v.electorate,
    scrutinio: v.ballot,
    visibilita: v.visibility,
    maggioranza: v.majority,
    quorum: v.quorum_pct,
    apre: v.opens_at,
    chiude: v.closes_at,
    stato: st,
    scrutinioAlle: tempi.scrutinioAlle,
    durataScrutinio: tempi.durataMs,
    fineScrutinio: tempi.fineScrutinio,
    aventiDiritto: v.eligible_count,
    stimati: Boolean(v.eligible_estimated),
    partecipanti: contaPartecipanti(v.id),
    creataDa: v.created_war_user ? { id: v.created_war_user, nome: v.created_name } : null,
    creataIl: v.created_at,
    ritirataIl: v.withdrawn_at || null,
    esito: esito && finito ? esitoSintetico(leggiRisultato(v)) : null,
    esitoRiservato: Boolean(v.sealed_at) && !esito,
    mio,
  };
}

function formaElettori(v) {
  return elettoriDi(v.id).map((e) => ({
    id: e.war_user_id, nome: e.name, avatar: e.avatar, ruolo: e.role,
    partito: e.party_id, partitoNome: e.party_name,
  }));
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

function idVotazione(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Rifiuto('votazione_sconosciuta', 404);
  return n;
}

function buildVotazioniRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente }) {
  const router = express.Router();
  const facoltativa = identitaFacoltativa(risolviIdentita);
  const autenticato = [requireAuth, risolviIdentita, bloccaScrittureSottoLente];

  const gestisci = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof Rifiuto) return res.status(err.stato).json({ error: err.codice });
      console.error('[votazioni] errore:', err.message);
      res.status(500).json({ error: 'errore_server' });
    }
  };

  const carica = async (req) => {
    const v = await aggiornata(getVotazione(idVotazione(req.params.id)));
    if (!v) throw new Rifiuto('votazione_sconosciuta', 404);
    return v;
  };

  // ── Lettura: pubblica, con login facoltativo ─────────────────────────
  /** L'archivio di una nazione, più cosa può fare chi guarda. */
  router.get('/', facoltativa, gestisci(async (req, res) => {
    const countryId = String(req.query.nazione || '').trim();
    if (!ID_GIOCO.test(countryId)) throw new Rifiuto('nazione_non_valida');
    const g = await chiGuarda(req);
    const ora = Date.now();
    const righe = [];
    for (const v of listaVotazioni(countryId)) {
      const daAggiornare = !v.withdrawn_at && ((v.eligible_count == null && v.opens_at <= ora)
        || (!v.sealed_at && v.closes_at <= ora));
      righe.push(daAggiornare ? await aggiornata(v) : v);
    }
    res.json({
      votazioni: righe.map((v) => forma(v, g, ora)),
      poteri: {
        loggato: g.loggato,
        verificato: g.verificato,
        puoCreare: g.amministra || (g.verificato && istituzioni(g, countryId)),
        // Il canale Discord lo imposta il governo (non il congresso), come
        // gli altri canali dell'area riservata.
        governa: governa(g, countryId),
        canale: governa(g, countryId) ? Boolean(getWebhook('votazioni', countryId)) : null,
        erroreGioco: g.erroreGioco || null,
      },
      ora,
    });
  }));

  /** Il canale Discord delle votazioni della nazione: URL vuoto = toglierlo.
   *  Prima di /:id, o "canale" finirebbe letto come id di una votazione. */
  router.post('/canale', ...autenticato, gestisci(async (req, res) => {
    const countryId = String(req.body?.nazione || '').trim();
    if (!ID_GIOCO.test(countryId)) throw new Rifiuto('nazione_non_valida');
    const g = await chiGuarda(req);
    if (!governa(g, countryId)) throw new Rifiuto('non_governi_questa_nazione', 403);
    const url = String(req.body?.url || '').trim();
    if (!url) {
      deleteWebhook('votazioni', countryId);
      audit(req.account.id, 'webhook.remove', `votazioni:${countryId}`, null);
      return res.json({ configurato: false });
    }
    if (!urlWebhookValido(url)) throw new Rifiuto('url_non_valido');
    setWebhook({ scopeType: 'votazioni', scopeId: countryId, url, createdBy: req.account.id });
    // Mai l'URL nell'audit: dentro c'è il token del webhook.
    audit(req.account.id, 'webhook.set', `votazioni:${countryId}`, null);
    res.json({ configurato: true });
  }));

  router.get('/:id', facoltativa, gestisci(async (req, res) => {
    const v = await carica(req);
    const g = await chiGuarda(req);
    const ora = Date.now();
    const out = forma(v, g, ora);
    // La composizione del corpo elettorale si vede con il testo: è quello
    // che serve a disegnare l'emiciclo, e chi siede in congresso è già
    // pubblico nel gioco.
    out.elettori = vedeTesto(v, g) && v.electorate !== 'referendum' ? formaElettori(v) : null;
    res.json({ votazione: out, ora });
  }));

  /** La sequenza dello scrutinio: da `scrutinioAlle`, a chi vede l'esito. */
  router.get('/:id/scrutinio', facoltativa, gestisci(async (req, res) => {
    const v = await carica(req);
    const g = await chiGuarda(req);
    const ora = Date.now();
    if (!vedeEsito(v, g)) throw new Rifiuto('esito_riservato', 403);
    const r = leggiRisultato(v);
    const tempi = tempiScrutinio(v);
    if (!r || ora < tempi.scrutinioAlle) throw new Rifiuto('scrutinio_non_iniziato', 409);
    const segreto = v.ballot === 'segreto';
    res.json({
      scrutinio: {
        id: v.id,
        tipo: v.ballot,
        // L'urna accelera solo nel referendum: il client deve saperlo.
        corpo: v.electorate,
        scrutinioAlle: tempi.scrutinioAlle,
        durataMs: r.durataMs,
        esito: esitoSintetico(r),
        sequenza: segreto ? r.sequenza : null,
        voti: segreto ? null : r.voti,
        elettori: v.electorate === 'referendum' ? null : formaElettori(v),
        // Nel segreto si sa CHI ha partecipato (come alla Camera), non cosa.
        partecipanti: segreto && v.electorate !== 'referendum' ? partecipantiDi(v.id) : null,
      },
      ora,
    });
  }));

  // ── Scrittura: con login ─────────────────────────────────────────────
  router.post('/', ...autenticato, gestisci(async (req, res) => {
    const campi = await campiVotazione(req.body);
    const g = await chiGuarda(req);
    if (!g.amministra && !g.verificato) throw new Rifiuto('non_verificato', 403);
    if (!istituzioni(g, campi.country_id)) throw new Rifiuto('non_nelle_istituzioni', 403);
    if (contaVotazioniAttive(campi.country_id, Date.now()) >= MAX_ATTIVE_PER_NAZIONE) throw new Rifiuto('troppe_votazioni');
    let v = creaVotazione({
      ...campi,
      created_by: req.account.id,
      created_war_user: req.account.war_user_id || null,
      created_name: req.account.war_username || req.account.discord_username || null,
    });
    audit(req.account.id, 'votazione.crea', `votazione:${v.id}`, req.body);
    // "Subito" vuol dire subito: la fotografia si prova adesso. Se il gioco
    // non risponde la votazione nasce "in apertura" e il giro riprova.
    v = await aggiornata(v);
    res.json({ votazione: forma(v, g), ora: Date.now() });
  }));

  router.post('/:id/voto', ...autenticato, gestisci(async (req, res) => {
    const v = await carica(req);
    if (stato(v) !== 'aperta') throw new Rifiuto('votazione_non_aperta', 409);
    const acc = req.account;
    if (!acc.war_user_id) throw new Rifiuto('non_verificato', 403);

    const scelta = String(req.body?.scelta || '');
    if (!SCELTE.has(scelta)) throw new Rifiuto('scelta_non_valida');
    // La nota solo sulla scheda nulla, e lì è obbligatoria: su un voto
    // segreto una nota accanto a un "sì" è una firma.
    const nota = scelta === 'nulla' ? testoLungo(req.body?.nota, MAX_NOTA) : null;
    if (scelta === 'nulla' && !nota) throw new Rifiuto('nota_obbligatoria');

    if (v.electorate === 'referendum') {
      // Fresco, non dalla cache dei ruoli: è il momento in cui conta.
      const lite = await trpcGet('user.getUserLite', { userId: acc.war_user_id });
      if (lite?.country !== v.country_id) throw new Rifiuto('non_cittadino', 403);
      if ((lite?.leveling?.level || 0) < MIN_LIVELLO) throw new Rifiuto('livello_basso', 403);
      const nato = Date.parse(lite?.createdAt || '');
      if (!nato || nato >= v.opens_at) throw new Rifiuto('personaggio_recente', 403);
    } else if (!eElettore(v.id, acc.war_user_id)) {
      throw new Rifiuto('non_elettore', 403);
    }

    // Di nuovo l'ora, SUBITO prima di scrivere: il controllo qui sopra può
    // aver aspettato il gioco, e un voto dopo lo scadere non entra. Da qui
    // al COMMIT è tutto sincrono, quindi il sigillo non ci si infila.
    if (Date.now() >= v.closes_at) throw new Rifiuto('votazione_non_aperta', 409);
    const ok = registraVoto(v.id, {
      warUserId: acc.war_user_id,
      nome: acc.war_username || null,
      scelta, nota,
      segreto: v.ballot === 'segreto',
    });
    if (!ok) throw new Rifiuto('gia_votato', 409);
    // Il segreto NON va nell'audit, nemmeno senza la scelta: vedi la testata.
    if (v.ballot === 'palese') audit(acc.id, 'votazione.voto', `votazione:${v.id}`, { scelta, nota });

    const g = await chiGuarda(req);
    res.json({ votazione: forma(getVotazione(v.id), g), ora: Date.now() });
  }));

  router.post('/:id/ritira', ...autenticato, gestisci(async (req, res) => {
    const v = await carica(req);
    if (v.withdrawn_at) throw new Rifiuto('gia_ritirata', 409);
    const g = await chiGuarda(req);
    const prima = stato(v) === 'programmata';
    const autore = g.warUserId && g.warUserId === v.created_war_user;
    if (!g.amministra) {
      if (!prima) throw new Rifiuto('gia_aperta', 409);
      if (!autore && !governa(g, v.country_id)) throw new Rifiuto('non_autorizzato', 403);
    }
    const dopo = ritiraVotazione(v.id, req.account.id);
    audit(req.account.id, 'votazione.ritira', `votazione:${v.id}`, { titolo: v.title, testo: v.body, stato: stato(v) });
    res.json({ votazione: forma(dopo, g), ora: Date.now() });
  }));

  return router;
}

module.exports = {
  buildVotazioniRouter, initVotazioni, statoVotazioni,
  // Per le prove: le regole senza rete né database.
  _calcolaEsito: calcolaEsito, _durataScrutinio: durataScrutinio, _lavora: lavora,
  // Per votazioniFinte.js: la stessa fotografia del corpo elettorale.
  _apri: apri,
};
