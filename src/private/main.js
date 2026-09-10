/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — la vista
   ------------------------------------------------------------------
   L'unica stanza chiusa del tool. Tutto il resto — mappa, unità,
   battaglie, rendite, statistiche — resta aperto a chiunque senza
   login: questa è una stanza in più, non un portone davanti
   all'ingresso, e la vista lo dice a chi ci entra per la prima volta.

   Arriva con import() dinamico alla prima apertura: chi non la apre
   non ne scarica un byte.

   ── STATI ──────────────────────────────────────────────────────────
     server-giu   → lo dice, e chiarisce che il resto del tool non ne
                    risente. Distinto da "non entrato" di proposito:
                    "non sei entrato" e "non si può entrare" sono cose
                    diverse, e confonderle manda l'utente a premere un
                    bottone che non può funzionare.
     ospite       → cos'è + "Entra con Discord"
     ricerca      → cerca il tuo nome nel gioco
     scelta       → quale di questi omonimi sei
     codice       → metti WP-XXXXXX nel nome di un'azienda
     collegato    → chi sei, in gioco e su Discord

   Il collegamento è a passi separati e non un modulo unico perché ogni
   passo fallisce per conto suo (nome inesistente, gioco che non
   risponde, personaggio già preso da un altro account), e ogni
   fallimento deve poter dire cosa fare senza far ricominciare da capo.
   ══════════════════════════════════════════════════════════════ */

import '../styles/private.css';
import { IS_LIVE } from '../shared/deployEnv.js';
import { pvT, pvErr } from './i18n.js';
import {
  fetchMe, logout, loginUrl, getToken,
  cercaPersonaggio, iniziaVerifica, controllaVerifica, annullaVerifica,
  scollegaPersonaggio, statoVerifica, leggiRuoli, ApiError,
} from './api.js';
import { state } from '../diplomacy/state.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { renderDeroghe, creaPannelloAdmin } from './admin.js';
import { creaTavolo } from './board.js';
import { creaQuadroNazione } from './nazione.js';
import { nzT } from './i18nNazione.js';

let rootEl = null;
let account = null;
let erroreRete = false;
let erroreAccesso = null;

// Stato del solo flusso di collegamento. Vive qui e non sul server
// perché sono passaggi di interfaccia: il server conosce la richiesta in
// corso (il codice), non a che schermata è arrivato l'utente.
let passo = 'ricerca';        // 'ricerca' | 'scelta' | 'codice'
let candidati = [];
let claim = null;             // { code, expiresAt, warUsername }
let messaggio = null;         // { testo, aziende? }
let occupato = false;
let tickScadenza = null;

// Ruoli: derivati dal gioco, deroghe e capacita' effettive, tenuti
// separati perche' l'interfaccia deve poter mostrare che una capacita'
// viene da una correzione e non dalla carica.
let ruoli = null;
let comeAltri = null;         // id dell'account che si sta guardando
let tavolo = null;
let quadro = null;            // la mia nazione (nazione.js)
let pannelloAdmin = null;

// Quante richieste aspettano una decisione, per scriverlo sulla sezione
// Contratti anche quando è chiusa: un presidente che non la apre deve
// comunque sapere che c'è qualcosa da firmare.
let attesaContratti = null;
let attesaChiesta = false;

// Quali sezioni apribili sono aperte: una preferenza di chi guarda, in
// localStorage come ogni altra comodità per-browser del tool.
const SEZIONI_KEY = 'wp_pv_sezioni_aperte';

export async function initPrivateView(container, { authError = null, comeAccount = null } = {}) {
  rootEl = container;
  erroreAccesso = authError;
  if (comeAccount && comeAccount !== comeAltri) {
    // Si arriva qui dall'amministrazione con un'altra persona da guardare:
    // tavolo e nazione in memoria sono di chi si guardava prima.
    comeAltri = comeAccount;
    tavolo = null; quadro = null; azzeraAttesa();
  }
  render();
  await refresh();

  // Il modulo resta in memoria fra un'apertura e l'altra, e con lui i dati
  // della nazione: riaprendo la vista dopo un'ora si leggeva ancora il
  // tesoro di un'ora prima. Si rilegge ad ogni apertura — "aggiornate" è
  // metà della promessa di questa scheda.
  if (quadro) quadro.ricarica();

  window.addEventListener('wareraplus:langchange', render);
}

/** Chiamata dall'esterno quando l'amministrazione chiede di guardare con
 *  gli occhi di un altro: la lente vive QUI, dove sta la vista vera. */
export async function guardaComeDaFuori(accountId) {
  await guardaCome(accountId);
}

async function refresh() {
  erroreRete = false;
  erroreAccesso = null;
  try {
    account = await fetchMe();
    // Una richiesta lasciata a metà si ritrova riaprendo la vista: il
    // codice vive mezz'ora, e non deve costare un giro da capo solo
    // perché nel frattempo si è chiuso l'overlay per guardare la mappa.
    if (account && !account.verificato) {
      claim = await statoVerifica();
      passo = claim ? 'codice' : 'ricerca';
    }
    if (account) await caricaRuoli();
  } catch {
    account = null;
    erroreRete = true;
  }
  render();
}

async function caricaRuoli({ refresh = false } = {}) {
  try {
    ruoli = await leggiRuoli({ asAccount: comeAltri, refresh });
  } catch {
    // I ruoli sono un di piu': se il gioco non risponde la vista resta
    // usabile e lo dice, invece di sembrare vuota.
    ruoli = null;
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bottone(cls, testo, onClick) {
  const b = el('button', `wp-pv-btn ${cls}`, testo);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Traduce l'errore dell'API e ridisegna. Gli errori del server arrivano
 *  come codici (`personaggio_gia_collegato`), mai come frasi: la lingua la
 *  sceglie il client, che è l'unico a sapere quale ha scelto l'utente. */
function segnala(err) {
  messaggio = { testo: err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server') };
  if (err instanceof ApiError && err.codice === 'non_autenticato') { account = null; claim = null; }
}

async function conAttesa(fn) {
  if (occupato) return;
  occupato = true; messaggio = null; render();
  try { await fn(); } catch (err) { segnala(err); } finally { occupato = false; render(); }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  try { disegna(); }
  catch (err) {
    // ⚠️ Una vista che lancia lasciava la pagina VUOTA, e una pagina vuota
    // non dice niente: e' successo davvero — un nome sbagliato dentro una
    // funzione e tutta l'area riservata spariva aprendo una linguetta.
    // Meglio un riquadro che ammette il guasto: si vede che c'e' un
    // problema invece di credere che non ci sia niente da vedere.
    console.error('[area riservata] disegno fallito:', err);
    if (!rootEl) return;
    rootEl.textContent = '';
    const box = el('div', 'wp-pv');
    box.appendChild(el('p', 'wp-pv-error', pvT('errErrore_server')));
    const dett = el('p', 'wp-pv-note', String(err?.message || err));
    box.appendChild(dett);
    rootEl.appendChild(box);
  }
}

function disegna() {
  if (!rootEl) return;
  // Il conto alla rovescia si ferma ad ogni ridisegno: senza, ogni render
  // ne lascerebbe uno vivo e dopo dieci passaggi ce ne sarebbero dieci.
  if (tickScadenza) { clearInterval(tickScadenza); tickScadenza = null; }
  rootEl.textContent = '';

  const wrap = el('div', 'wp-pv');

  const errAccesso = pvErr(erroreAccesso);
  if (errAccesso) wrap.appendChild(el('p', 'wp-pv-error', errAccesso));

  const testata = el('header', 'wp-pv-testata');
  testata.appendChild(el('h1', 'wp-pv-title', pvT('title')));
  testata.appendChild(el('p', 'wp-pv-lead', pvT('lead')));
  wrap.appendChild(testata);

  // ── Due zone, non un elenco ────────────────────────────────────────
  // A sinistra CHI SEI: profilo, poteri, prossimo passo. Sta in alto a
  // sinistra e ci resta mentre si scorre, perche' e' il contesto di
  // tutto il resto — non una scheda fra le altre.
  // A destra COSA PUOI FARE: battaglie prima di tutto (e' la domanda con
  // cui un comandante apre la pagina), poi il tavolo, poi le cose di
  // governo. Prima erano tutte in fila e si assomigliavano.
  const colonnaSx = el('aside', 'wp-pv-sx');
  const colonnaDx = el('div', 'wp-pv-dx');

  if (erroreRete) colonnaDx.appendChild(cardIndisponibile());
  else if (!account) colonnaDx.appendChild(cardOspite());
  else if (comeAltri) {
    // ── Con la lente attiva si vede SOLO quella persona ────────────────
    // Il flusso di verifica e il pannello amministratore riguardano me,
    // non lei: mostrarli qui accanto ai suoi ruoli faceva credere che
    // "personaggio collegato" fosse il suo stato quando era il mio.
    // La scheda dei ruoli si disegna sempre, anche vuota: "questa persona
    // non ha poteri" e' esattamente l'informazione che si sta cercando.
    colonnaSx.appendChild(cardLente());
    colonnaSx.appendChild(cardProfilo());
    colonnaDx.appendChild(creaOQuadro().render());
    colonnaDx.appendChild(sezioneContratti());
  }
  else {
    colonnaSx.appendChild(cardProfilo());

    if (!account.verificato) {
      if (passo === 'codice' && claim) colonnaDx.appendChild(cardCodice());
      else if (passo === 'scelta') colonnaDx.appendChild(cardScelta());
      else colonnaDx.appendChild(cardRicerca());
    }

    // Nazione non abilitata: si dice, e si dice PRIMA. Il permesso vero e'
    // il filtro sul server (server/plusApi/nazioni.js) — questo e' solo
    // l'annuncio, e come per ogni altra cosa qui dentro vale la regola che
    // nascondere un bottone non e' negare un permesso. Ma senza questa
    // card l'utente vedrebbe le sezioni fallire una per una con un 403
    // muto, senza mai capire il perche'.
    const nazione = ruoli?.nazione;
    if (account.verificato && nazione && nazione.abilitata === false) {
      colonnaDx.appendChild(cardNazioneNonAbilitata(nazione));
    } else if (account.verificato || account.admin) {
      // ── Prima quello che si VEDE, poi quello che si FA ─────────────────
      // La nazione la vede ogni cittadino, carica o no: è la risposta a
      // "cosa posso vedere io". I contratti e l'amministrazione sono
      // mestieri di pochi, e stanno sotto, chiusi finché non si aprono —
      // prima occupavano tutta la pagina anche a chi voleva solo sapere
      // come stava la sua nazione.
      colonnaDx.appendChild(creaOQuadro().render());

      // Il tavolo resta a chi ha almeno un potere: a un cittadino senza
      // cariche sarebbe una scatola vuota con dentro una spiegazione di
      // qualcosa che non lo riguarda.
      const cap = ruoli?.capacita;
      if (cap && (cap.chiedePer?.length || cap.approvaPer?.length || cap.gestisceNazione?.length || cap.admin)) {
        colonnaDx.appendChild(sezioneContratti());
      }
      // L'amministrazione era una linguetta DENTRO il tavolo dei contratti,
      // ma non è una cosa di contratti: account, deroghe, lente. Sezione
      // sua, che per quasi tutti non esiste.
      if (account.admin) {
        colonnaDx.appendChild(sezioneApribile('admin', nzT('secAdmin'), nzT('secAdminHint'),
          () => creaOAdmin().render()));
      }
    }

  }

  wrap.appendChild(colonnaSx);
  wrap.appendChild(colonnaDx);

  if (!IS_LIVE) wrap.appendChild(el('p', 'wp-pv-devnote', pvT('devWarning')));
  rootEl.appendChild(wrap);
}

/**
 * "L'area non e' aperta alla tua nazione". Elenca QUALI sono le nazioni
 * ammesse invece di dire solo di no: senza l'elenco l'unica reazione
 * possibile e' chiedere in chat se sia un guasto, e il piu' delle volte
 * la risposta e' che non lo e'.
 *
 * L'elenco arriva dal server (`ammesse`) e non da una costante nel
 * bundle: sarebbe la seconda copia della stessa lista, e si scoprirebbe
 * disallineata il giorno in cui se ne aggiunge una.
 */
function cardNazioneNonAbilitata(nazione) {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('natTitle')));
  card.appendChild(el('p', 'wp-pv-body', pvT('natBody')));

  const elenco = el('ul', 'wp-pv-nazioni');
  for (const n of nazione.ammesse || []) {
    const li = el('li');
    // La bandiera e' la stessa che la scheda profilo mette accanto al
    // nome: qui riconoscere la propria (o non trovarla) e' il punto.
    const naz = state.nationMap?.get(n.id);
    const url = naz ? getFlagUrl(getNationCode(n.id, naz)) : null;
    if (url) {
      const img = el('img', 'wp-pv-nazione-flag');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      li.appendChild(img);
    }
    li.appendChild(el('span', null, naz?.name || n.nome || n.id));
    elenco.appendChild(li);
  }
  if (elenco.childElementCount) card.appendChild(elenco);

  // Perche' proprio io sono fuori: "non ti sei ancora verificato" si
  // risolve in due minuti, "la tua nazione non c'e'" no. Dirle con lo
  // stesso messaggio manda a chiedere aiuto chi doveva solo finire.
  if (nazione.motivo === 'non_verificato' || nazione.motivo === 'nazione_sconosciuta') {
    card.appendChild(el('p', 'wp-pv-note', pvT('natUnverified')));
  } else {
    const mia = ruoli?.derivati?.countryId;
    const nome = mia ? (state.nationMap?.get(mia)?.name || mia) : pvT('natUnknown');
    card.appendChild(el('p', 'wp-pv-note', `${pvT('natYours')}: ${nome}`));
  }
  return card;
}

function cardOspite() {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('whatFor')));
  card.appendChild(el('p', 'wp-pv-body', pvT('whatForBody')));
  // location.assign e non fetch: il giro OAuth è una navigazione, deve
  // portarsi dietro il browser fino a Discord e riportarlo indietro.
  card.appendChild(bottone('wp-pv-btn-discord', pvT('signIn'), () => location.assign(loginUrl())));
  card.appendChild(el('p', 'wp-pv-note', pvT('signInNote')));
  return card;
}

/**
 * La card profilo: tutto quello che dice "chi sei" in un posto solo, in
 * alto a sinistra. Nome Discord e personaggio di gioco sono due identita'
 * diverse e vanno lette insieme; bandiera e stemma dell'unita' rendono
 * la cosa riconoscibile prima ancora di leggere.
 *
 * Ci sta dentro anche il "prossimo passo": era una card separata, ma
 * parla di TE, non di quello che puoi fare — accanto alle battaglie
 * sembrava un'altra sezione da guardare.
 */
function cardProfilo() {
  const card = el('div', 'wp-pv-card wp-pv-profilo');

  // ── Discord ─────────────────────────────────────────────────────────
  const testa = el('div', 'wp-pv-profilo-testa');
  if (account.discordAvatar) {
    const img = el('img', 'wp-pv-avatar');
    img.src = account.discordAvatar; img.alt = '';
    img.width = 48; img.height = 48;
    testa.appendChild(img);
  }
  const nomi = el('div', 'wp-pv-profilo-nomi');
  nomi.appendChild(el('strong', 'wp-pv-profilo-pg', account.warUsername || account.discordUsername));
  const sotto = el('span', 'wp-pv-profilo-discord', account.discordUsername);
  nomi.appendChild(sotto);
  testa.appendChild(nomi);
  if (account.admin) testa.appendChild(el('span', 'wp-pv-badge wp-pv-badge-admin', 'admin'));
  card.appendChild(testa);

  const d = ruoli?.derivati;

  // ── Nazione e unita', con bandiera e stemma ────────────────────────
  if (d) {
    const righe = el('div', 'wp-pv-profilo-righe');
    righe.appendChild(rigaProfilo(
      pvT('profileNation'),
      bandieraNazione(d.countryId),
      nomeNazionePv(d.countryId) || pvT('profileNoNation'),
      d.carica ? pvT(d.carica) : null,
    ));
    righe.appendChild(rigaProfilo(
      pvT('profileUnit'),
      d.muAvatar ? immagine(d.muAvatar) : null,
      d.muNome || pvT('profileNoUnit'),
      d.ruoloMu ? pvT(d.ruoloMu) : null,
    ));
    card.appendChild(righe);
  }

  // ── Cosa puoi fare ─────────────────────────────────────────────────
  const cap = ruoli?.capacita || {};
  const elenco = el('ul', 'wp-pv-capacita');
  if (cap.approvaPer?.length) elenco.appendChild(el('li', null, pvT('canApprove')));
  if (cap.chiedePer?.length) elenco.appendChild(el('li', null, pvT('canRequest')));
  if (!elenco.children.length) elenco.appendChild(el('li', 'wp-pv-cap-vuota', pvT('canNothingYet')));
  card.appendChild(elenco);

  const deroghe = renderDeroghe(ruoli?.deroghe, account.admin && comeAltri
    ? { accountId: comeAltri, onCambio: async () => { await caricaRuoli(); render(); } }
    : {});
  if (deroghe) {
    card.appendChild(el('p', 'wp-pv-note', pvT('overridden')));
    card.appendChild(deroghe);
  }

  if (ruoli?.erroreGioco || !ruoli) card.appendChild(el('p', 'wp-pv-note', pvT('roleUnavailable')));

  // ── Azioni sul proprio account ─────────────────────────────────────
  if (!comeAltri) {
    const azioni = el('div', 'wp-pv-azioni');
    azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('refreshRoles'), async () => {
      await caricaRuoli({ refresh: true }); render();
    }));
    if (account.verificato) {
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('unlink'), () => conAttesa(async () => {
        account = (await scollegaPersonaggio()).account;
        passo = 'ricerca'; candidati = []; claim = null;
        await caricaRuoli({ refresh: true });
      })));
    }
    azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('signOut'), async () => {
      await logout(); account = null; claim = null; passo = 'ricerca'; candidati = [];
      tavolo = null; quadro = null; pannelloAdmin = null; azzeraAttesa(); render();
    }));
    card.appendChild(azioni);
  }

  const msg = boxMessaggio(); if (msg) card.appendChild(msg);
  return card;
}

function rigaProfilo(etichetta, immagineEl, nome, ruolo) {
  const riga = el('div', 'wp-pv-profilo-riga');
  riga.appendChild(el('span', 'wp-pv-label', etichetta));
  const corpo = el('div', 'wp-pv-profilo-corpo');
  if (immagineEl) corpo.appendChild(immagineEl);
  corpo.appendChild(el('strong', 'wp-pv-profilo-valore', nome));
  riga.appendChild(corpo);
  if (ruolo) riga.appendChild(el('span', 'wp-pv-profilo-ruolo', ruolo));
  return riga;
}

function immagine(url, cls = 'wp-pv-stemma') {
  const i = el('img', cls);
  i.src = url; i.alt = ''; i.loading = 'lazy';
  i.addEventListener('error', () => { i.style.display = 'none'; });
  return i;
}

/** Bandiera dalla stessa sorgente del pannello nazione: nessuna seconda
 *  strada per la stessa immagine. */
function bandieraNazione(countryId) {
  if (!countryId) return null;
  const n = state.nationMap?.get(countryId);
  if (!n) return null;
  const url = getFlagUrl(getNationCode(countryId, n));
  return url ? immagine(url, 'wp-pv-bandiera') : null;
}

function nomeNazionePv(countryId) {
  return state.nationMap?.get(countryId)?.name || null;
}

/** Resta per la lente, dove serve solo sapere chi si sta guardando. */
function cardIdentita() {
  const card = el('div', 'wp-pv-id');
  const riga = el('div', 'wp-pv-who');

  if (account.discordAvatar) {
    const img = el('img', 'wp-pv-avatar');
    img.src = account.discordAvatar; img.alt = '';
    img.width = 40; img.height = 40;
    riga.appendChild(img);
  }
  const nomi = el('div', 'wp-pv-names');
  nomi.appendChild(el('span', 'wp-pv-label', pvT('signedInAs')));
  nomi.appendChild(el('strong', 'wp-pv-name', account.discordUsername));
  riga.appendChild(nomi);

  // Il personaggio di gioco accanto al nome Discord: sono due identita'
  // diverse e vanno lette insieme, non una nella card sotto.
  if (account.warUsername) {
    riga.appendChild(el('span', 'wp-pv-id-sep', '·'));
    riga.appendChild(el('strong', 'wp-pv-id-pg', account.warUsername));
  }
  if (account.admin) riga.appendChild(el('span', 'wp-pv-badge wp-pv-badge-admin', 'admin'));
  riga.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('signOut'), async () => {
    await logout(); account = null; claim = null; passo = 'ricerca'; candidati = []; render();
  }));

  card.appendChild(riga);
  return card;
}

function boxMessaggio() {
  if (!messaggio) return null;
  const box = el('div', 'wp-pv-msg');
  box.appendChild(el('p', 'wp-pv-msg-testo', messaggio.testo));
  // L'elenco delle aziende lette non è un dettaglio tecnico: è ciò che
  // permette di capire da soli cos'è andato storto (azienda sbagliata,
  // codice scritto male, gioco non ancora aggiornato).
  if (messaggio.aziende?.length) {
    const ul = el('ul', 'wp-pv-aziende');
    for (const nome of messaggio.aziende) ul.appendChild(el('li', null, nome));
    box.appendChild(ul);
  }
  return box;
}

function cardRicerca() {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('linkTitle')));
  card.appendChild(el('p', 'wp-pv-body', pvT('linkBody')));

  const form = el('form', 'wp-pv-form');
  const lab = el('label', 'wp-pv-label', pvT('nameLabel'));
  lab.htmlFor = 'wp-pv-nome';

  const input = el('input', 'wp-pv-input');
  input.id = 'wp-pv-nome';
  input.type = 'text';
  input.placeholder = pvT('namePh');
  input.autocomplete = 'off';
  input.maxLength = 40;
  input.disabled = occupato;

  const invia = el('button', 'wp-pv-btn wp-pv-btn-primary', occupato ? pvT('searching') : pvT('search'));
  invia.type = 'submit';
  invia.disabled = occupato;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = input.value.trim();
    conAttesa(async () => {
      const r = await cercaPersonaggio(nome);
      candidati = r.candidati || [];
      if (!candidati.length) { messaggio = { testo: pvT('noCandidates') }; return; }
      passo = 'scelta';
    });
  });

  form.appendChild(lab);
  const riga = el('div', 'wp-pv-riga');
  riga.appendChild(input); riga.appendChild(invia);
  form.appendChild(riga);
  card.appendChild(form);

  const msg = boxMessaggio(); if (msg) card.appendChild(msg);
  // Il focus dopo il render: prima l'elemento non è ancora nel documento.
  queueMicrotask(() => { if (!occupato) input.focus(); });
  return card;
}

function cardScelta() {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('pickTitle')));

  const lista = el('div', 'wp-pv-candidati');
  for (const c of candidati) {
    const b = el('button', 'wp-pv-candidato');
    b.type = 'button';
    b.disabled = occupato;
    if (c.avatarUrl) {
      const img = el('img', 'wp-pv-avatar wp-pv-avatar-sm');
      img.src = c.avatarUrl; img.alt = ''; img.width = 32; img.height = 32;
      img.loading = 'lazy';
      b.appendChild(img);
    }
    b.appendChild(el('span', 'wp-pv-candidato-nome', c.username));
    b.addEventListener('click', () => conAttesa(async () => {
      claim = await iniziaVerifica(c.warUserId);
      passo = 'codice';
    }));
    lista.appendChild(b);
  }
  card.appendChild(lista);

  card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('cancel'), () => {
    passo = 'ricerca'; candidati = []; messaggio = null; render();
  }));

  const msg = boxMessaggio(); if (msg) card.appendChild(msg);
  return card;
}

function cardCodice() {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('codeTitle')));

  const box = el('div', 'wp-pv-codice');
  box.appendChild(el('code', 'wp-pv-codice-testo', claim.code));
  card.appendChild(box);

  card.appendChild(el('p', 'wp-pv-body', pvT('codeBody')));

  // Il tempo che resta si aggiorna da solo: un codice scaduto senza
  // preavviso è la strada più breve per un tentativo sprecato.
  const resta = el('p', 'wp-pv-note');
  const aggiorna = () => {
    const ms = claim ? claim.expiresAt - Date.now() : 0;
    if (ms <= 0) {
      claim = null; passo = 'ricerca';
      messaggio = { testo: pvT('errCodice_scaduto') };
      render();
      return;
    }
    resta.textContent = `${pvT('expiresIn')} ${Math.ceil(ms / 60000)} ${pvT('minutes')}`;
  };
  aggiorna();
  tickScadenza = setInterval(aggiorna, 15000);
  card.appendChild(resta);

  const azioni = el('div', 'wp-pv-azioni');

  const controlla = el('button', 'wp-pv-btn wp-pv-btn-primary', occupato ? pvT('checking') : pvT('checkNow'));
  controlla.type = 'button';
  controlla.disabled = occupato;
  controlla.addEventListener('click', () => conAttesa(async () => {
    const r = await controllaVerifica();
    if (r.ok) { account = r.account; claim = null; await caricaRuoli({ refresh: true }); return; }
    messaggio = r.motivo === 'nessuna_azienda'
      ? { testo: pvT('noCompanies') }
      : { testo: pvT('notFound'), aziende: r.aziende };
  }));
  azioni.appendChild(controlla);

  azioni.appendChild(bottone('wp-pv-btn-quiet', pvT('cancel'), () => conAttesa(async () => {
    await annullaVerifica();
    claim = null; passo = 'ricerca'; candidati = [];
  })));
  card.appendChild(azioni);

  const msg = boxMessaggio(); if (msg) card.appendChild(msg);
  return card;
}

/** Passa a guardare (in sola lettura) quello che vede un altro. */
async function guardaCome(accountId) {
  comeAltri = accountId;
  await caricaRuoli();
  // Il tavolo tiene in memoria le righe di CHI stava guardando prima:
  // senza questo, entrando in lente si vedrebbero per un istante le
  // proprie richieste attribuite a un'altra persona. Lo stesso vale per
  // il quadro della nazione: sotto la lente è la SUA nazione.
  tavolo = null;
  quadro = null;
  azzeraAttesa();
  render();
}

function cardLente() {
  const card = el('div', 'wp-pv-card wp-pv-card-lente');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('viewingAs')));
  const chi = ruoli?.account;
  if (chi) card.appendChild(el('strong', 'wp-pv-name', chi.warUsername || chi.discordUsername));
  card.appendChild(el('p', 'wp-pv-note', pvT('readOnlyNote')));
  card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('backToMe'), async () => {
    comeAltri = null; await caricaRuoli(); tavolo = null; quadro = null; azzeraAttesa(); render();
  }));
  return card;
}

/** Il tavolo si costruisce una volta sola: ricrearlo ad ogni render
 *  perderebbe il suo stato (modulo aperto, righe caricate) ogni volta che
 *  qualcuno preme un bottone qualsiasi della pagina. */
function creaOTavolo() {
  if (!tavolo) {
    tavolo = creaTavolo({
      ridisegna: render,
      lente: () => comeAltri,
      nomeUnita: (id) => (ruoli?.derivati?.muId === id ? ruoli.derivati.muNome : null),
      apriComeAltri: guardaCome,
      ruoliCambiati: async () => { await caricaRuoli({ refresh: true }); render(); },
    });
  }
  return tavolo;
}

/** Stessa regola del tavolo: costruito una volta, tiene il suo stato
 *  (dati letti, nemici aperti) fra un ridisegno e l'altro. */
function creaOQuadro() {
  if (!quadro) quadro = creaQuadroNazione({ ridisegna: render, lente: () => comeAltri });
  return quadro;
}

function creaOAdmin() {
  if (!pannelloAdmin) {
    pannelloAdmin = creaPannelloAdmin({
      ridisegna: render,
      // "Vedi come" cambia l'identità di tutta l'area, non solo di questa
      // sezione: per questo vive qui e non nel pannello.
      apriComeAltri: guardaCome,
      // Una deroga appena concessa cambia i poteri: ruoli e tavolo vanno
      // riletti, altrimenti restano quelli di un minuto fa. Era un bug
      // reale — si concedeva una carica e il bottone non compariva.
      ruoliCambiati: async () => { await caricaRuoli({ refresh: true }); await tavolo?.ricarica(); render(); },
    });
  }
  return pannelloAdmin;
}

function azzeraAttesa() { attesaContratti = null; attesaChiesta = false; }

// ---------------------------------------------------------------------------
// Sezioni apribili
// ---------------------------------------------------------------------------

function sezioniAperte() {
  try { return new Set(JSON.parse(localStorage.getItem(SEZIONI_KEY) || '[]')); } catch { return new Set(); }
}

function impostaAperta(chiave, aperta) {
  try {
    const s = sezioniAperte();
    if (aperta) s.add(chiave); else s.delete(chiave);
    localStorage.setItem(SEZIONI_KEY, JSON.stringify([...s]));
  } catch { /* modalità privata: si riapre chiusa, pazienza */ }
}

/**
 * Una sezione che si apre cliccando la testa. Il contenuto si costruisce
 * SOLO se è aperta: una sezione chiusa non scarica niente, che per il
 * tavolo dei contratti vuol dire battaglie, liste permessi e canali —
 * mezza dozzina di richieste risparmiate a chi non lo apre.
 */
function sezioneApribile(chiave, titolo, sottotitolo, contenuto, { badge = null } = {}) {
  const aperta = sezioniAperte().has(chiave);
  const box = el('section', `wp-pv-apribile${aperta ? ' aperta' : ''}`);

  const testa = el('button', 'wp-pv-apribile-testa');
  testa.type = 'button';
  testa.setAttribute('aria-expanded', String(aperta));
  testa.appendChild(el('span', 'wp-pv-apribile-freccia', aperta ? '▾' : '▸'));
  const testi = el('span', 'wp-pv-apribile-testi');
  testi.appendChild(el('strong', 'wp-pv-apribile-titolo', titolo));
  testi.appendChild(el('span', 'wp-pv-apribile-sotto', sottotitolo));
  testa.appendChild(testi);
  if (badge) testa.appendChild(el('span', 'wp-pv-apribile-badge', `${badge} · ${nzT('secWaiting')}`));
  testa.addEventListener('click', () => { impostaAperta(chiave, !aperta); render(); });
  box.appendChild(testa);

  if (aperta) {
    const corpo = el('div', 'wp-pv-apribile-corpo');
    corpo.appendChild(contenuto());
    box.appendChild(corpo);
  }
  return box;
}

/** I contratti mercenari, chiusi di partenza. Il conteggio di cosa aspetta
 *  una firma si chiede una volta sola anche a sezione chiusa: è l'unico
 *  pezzo del tavolo che deve farsi vedere senza essere aperto. */
function sezioneContratti() {
  const t = creaOTavolo();
  let n = t.inAttesa();
  if (n == null) {
    n = attesaContratti;
    if (attesaContratti === null && !attesaChiesta) {
      attesaChiesta = true;
      t.contaAttesa().then((x) => { attesaContratti = x; render(); });
    }
  }
  return sezioneApribile('contratti', nzT('secContracts'), nzT('secContractsHint'),
    () => t.render(), { badge: n || null });
}

function cardIndisponibile() {
  const card = el('div', 'wp-pv-card wp-pv-card-down');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('unavailable')));
  card.appendChild(el('p', 'wp-pv-body', pvT('unavailableBody')));
  card.appendChild(bottone('wp-pv-btn-quiet', pvT('retry'), () => refresh()));
  return card;
}

/** Vero se c'è un token salvato — non garantisce che valga ancora, serve
 *  solo a decidere se vale la pena chiedere al server. */
export function haSessione() { return Boolean(getToken()); }
