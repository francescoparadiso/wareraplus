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
import { creaPannelloAdmin, renderDeroghe } from './admin.js';
import { creaTavolo } from './board.js';

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
let pannelloAdmin = null;
let tavolo = null;

export async function initPrivateView(container, { authError = null } = {}) {
  rootEl = container;
  erroreAccesso = authError;
  render();
  await refresh();

  window.addEventListener('wareraplus:langchange', render);
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
  if (!rootEl) return;
  // Il conto alla rovescia si ferma ad ogni ridisegno: senza, ogni render
  // ne lascerebbe uno vivo e dopo dieci passaggi ce ne sarebbero dieci.
  if (tickScadenza) { clearInterval(tickScadenza); tickScadenza = null; }
  rootEl.textContent = '';

  const wrap = el('div', 'wp-pv');

  const errAccesso = pvErr(erroreAccesso);
  if (errAccesso) wrap.appendChild(el('p', 'wp-pv-error', errAccesso));

  wrap.appendChild(el('h1', 'wp-pv-title', pvT('title')));
  wrap.appendChild(el('p', 'wp-pv-lead', pvT('lead')));

  if (erroreRete) wrap.appendChild(cardIndisponibile());
  else if (!account) wrap.appendChild(cardOspite());
  else if (comeAltri) {
    // ── Con la lente attiva si vede SOLO quella persona ────────────────
    // Il flusso di verifica e il pannello amministratore riguardano me,
    // non lei: mostrarli qui accanto ai suoi ruoli faceva credere che
    // "personaggio collegato" fosse il suo stato quando era il mio.
    // La scheda dei ruoli si disegna sempre, anche vuota: "questa persona
    // non ha poteri" e' esattamente l'informazione che si sta cercando.
    wrap.appendChild(cardIdentita());
    wrap.appendChild(cardLente());
    wrap.appendChild(cardRuoli());
    wrap.appendChild(creaOTavolo().render());
  }
  else {
    wrap.appendChild(cardIdentita());

    if (account.verificato) wrap.appendChild(cardCollegato());
    else if (passo === 'codice' && claim) wrap.appendChild(cardCodice());
    else if (passo === 'scelta') wrap.appendChild(cardScelta());
    else wrap.appendChild(cardRicerca());

    if (ruoli && (ruoli.derivati || ruoli.deroghe?.length || ruoli.erroreGioco)) {
      wrap.appendChild(cardRuoli());
    }

    // Il tavolo si mostra solo a chi ha almeno un potere: a un cittadino
    // senza cariche sarebbe una scatola vuota con dentro una spiegazione
    // di qualcosa che non lo riguarda.
    const cap = ruoli?.capacita;
    if (cap && (cap.chiedePer?.length || cap.approvaPer?.length || cap.admin)) {
      wrap.appendChild(creaOTavolo().render());
    }

    if (account.admin) {
      if (!pannelloAdmin) pannelloAdmin = creaPannelloAdmin({ ridisegna: render, apriComeAltri: guardaCome });
      wrap.appendChild(pannelloAdmin.render());
    }
  }

  if (!IS_LIVE) wrap.appendChild(el('p', 'wp-pv-devnote', pvT('devWarning')));
  rootEl.appendChild(wrap);
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

/** Chi sei: sempre in cima quando sei entrato, in ogni passo del flusso. */
function cardIdentita() {
  const card = el('div', 'wp-pv-card wp-pv-card-id');
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

function cardCollegato() {
  const card = el('div', 'wp-pv-card wp-pv-card-ok');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('linkedAs')));
  card.appendChild(el('strong', 'wp-pv-name wp-pv-name-big', account.warUsername || account.warUserId));

  card.appendChild(el('h2', 'wp-pv-h2 wp-pv-h2-sep', pvT('nextStep')));
  // `nextStepDone` e non `nextStepBody`: quest'ultimo descrive il
  // collegamento, che a questo punto è già avvenuto. Dire a chi ha appena
  // finito che il prossimo passo è quello che ha appena fatto è il modo
  // più rapido per far dubitare che sia andata a buon fine.
  card.appendChild(el('p', 'wp-pv-body', pvT('nextStepDone')));

  card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('unlink'), () => conAttesa(async () => {
    account = (await scollegaPersonaggio()).account;
    passo = 'ricerca'; candidati = []; claim = null;
    await caricaRuoli({ refresh: true });
  })));

  const msg = boxMessaggio(); if (msg) card.appendChild(msg);
  return card;
}

/** Passa a guardare (in sola lettura) quello che vede un altro. */
async function guardaCome(accountId) {
  comeAltri = accountId;
  await caricaRuoli();
  // Il tavolo tiene in memoria le righe di CHI stava guardando prima:
  // senza questo, entrando in lente si vedrebbero per un istante le
  // proprie richieste attribuite a un'altra persona.
  tavolo = null;
  render();
}

function cardLente() {
  const card = el('div', 'wp-pv-card wp-pv-card-lente');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('viewingAs')));
  const chi = ruoli?.account;
  if (chi) card.appendChild(el('strong', 'wp-pv-name', chi.warUsername || chi.discordUsername));
  card.appendChild(el('p', 'wp-pv-note', pvT('readOnlyNote')));
  card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('backToMe'), async () => {
    comeAltri = null; await caricaRuoli(); tavolo = null; render();
  }));
  return card;
}

function cardRuoli() {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('rolesTitle')));
  card.appendChild(el('p', 'wp-pv-body', pvT('rolesBody')));

  // Puo' essere chiamata anche senza ruoli caricati (lente su un account
  // che il gioco non sa risolvere): non deve esplodere, deve dirlo.
  if (!ruoli || ruoli.erroreGioco) {
    card.appendChild(el('p', 'wp-pv-note', pvT('roleUnavailable')));
    if (!ruoli) return card;
  }

  const d = ruoli.derivati;
  if (d) {
    const griglia = el('div', 'wp-pv-ruoli');
    griglia.appendChild(voceRuolo(pvT('office'), d.carica ? pvT(d.carica) : pvT('noOffice')));
    griglia.appendChild(voceRuolo(pvT('unit'),
      d.ruoloMu ? `${pvT(d.ruoloMu)}${d.muNome ? ` · ${d.muNome}` : ''}` : pvT('noUnit')));
    card.appendChild(griglia);
  }

  // Le capacita' sono la domanda vera ("posso approvare?"), i ruoli sono
  // il come ci si arriva. Vanno mostrate entrambe, non solo la seconda.
  const cap = ruoli.capacita || {};
  const elencoCap = el('ul', 'wp-pv-capacita');
  if (cap.approvaPer?.length) elencoCap.appendChild(el('li', null, pvT('canApprove')));
  if (cap.chiedePer?.length) elencoCap.appendChild(el('li', null, pvT('canRequest')));
  if (!elencoCap.children.length) elencoCap.appendChild(el('li', 'wp-pv-cap-vuota', pvT('canNothingYet')));
  card.appendChild(elencoCap);

  const deroghe = renderDeroghe(ruoli.deroghe, account.admin && comeAltri
    ? { accountId: comeAltri, onCambio: async () => { await caricaRuoli(); render(); } }
    : {});
  if (deroghe) {
    card.appendChild(el('p', 'wp-pv-note', pvT('overridden')));
    card.appendChild(deroghe);
  }

  card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('refreshRoles'), async () => {
    await caricaRuoli({ refresh: true }); render();
  }));
  return card;
}

function voceRuolo(etichetta, valore) {
  const v = el('div', 'wp-pv-ruolo');
  v.appendChild(el('span', 'wp-pv-label', etichetta));
  v.appendChild(el('strong', 'wp-pv-ruolo-valore', valore));
  return v;
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
    });
  }
  return tavolo;
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
