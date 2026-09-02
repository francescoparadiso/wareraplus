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
     1. non loggato      → cos'è + "Entra con Discord"
     2. loggato          → chi sei, e cosa manca ancora
     3. server giù       → lo dice, e chiarisce che il resto del tool
                           non ne risente
   Lo stato 3 è distinto dall'1 di proposito: "non sei entrato" e "non
   si può entrare" sono due cose diverse, e confonderle manda l'utente
   a premere un bottone che non può funzionare.
   ══════════════════════════════════════════════════════════════ */

import '../styles/private.css';
import { IS_LIVE } from '../shared/deployEnv.js';
import { pvT, pvErr } from './i18n.js';
import { fetchMe, logout, loginUrl, getToken } from './api.js';

let rootEl = null;
let account = null;
let erroreRete = false;
let erroreAccesso = null;

export async function initPrivateView(container, { authError = null } = {}) {
  rootEl = container;
  erroreAccesso = authError;
  render();          // subito qualcosa, prima della rete
  await refresh();

  // Ritraduce a overlay già aperto, come le altre viste.
  window.addEventListener('wareraplus:langchange', render);
}

async function refresh() {
  erroreRete = false;
  erroreAccesso = null;
  try {
    account = await fetchMe();
  } catch {
    account = null;
    erroreRete = true;
  }
  render();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render() {
  if (!rootEl) return;
  rootEl.textContent = '';

  const wrap = el('div', 'wp-pv');

  // L'errore resta visibile anche dopo un cambio lingua (si ritraduce),
  // ma sparisce appena l'utente riprova: a quel punto parla il nuovo esito.
  const err = pvErr(erroreAccesso);
  if (err) wrap.appendChild(el('p', 'wp-pv-error', err));

  wrap.appendChild(el('h1', 'wp-pv-title', pvT('title')));
  wrap.appendChild(el('p', 'wp-pv-lead', pvT('lead')));

  if (erroreRete) wrap.appendChild(cardIndisponibile());
  else if (account) wrap.appendChild(cardLoggato());
  else wrap.appendChild(cardAccesso());

  // Sul dev l'accesso è vero (account Discord vero, database vero) ma
  // separato dal live: senza dirlo, chi si verifica qui poi non capisce
  // perché sul tool pubblico non risulta niente.
  if (!IS_LIVE) wrap.appendChild(el('p', 'wp-pv-devnote', pvT('devWarning')));

  rootEl.appendChild(wrap);
}

function cardAccesso() {
  const card = el('div', 'wp-pv-card');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('whatFor')));
  card.appendChild(el('p', 'wp-pv-body', pvT('whatForBody')));

  const btn = el('button', 'wp-pv-btn wp-pv-btn-discord', pvT('signIn'));
  btn.type = 'button';
  // location.assign e non fetch: il giro OAuth è una navigazione, deve
  // portarsi dietro il browser fino a Discord e riportarlo indietro.
  btn.addEventListener('click', () => { location.assign(loginUrl()); });
  card.appendChild(btn);

  card.appendChild(el('p', 'wp-pv-note', pvT('signInNote')));
  return card;
}

function cardLoggato() {
  const card = el('div', 'wp-pv-card');

  const riga = el('div', 'wp-pv-who');
  if (account.discordAvatar) {
    const img = el('img', 'wp-pv-avatar');
    img.src = account.discordAvatar;
    img.alt = '';
    img.width = 40; img.height = 40;
    riga.appendChild(img);
  }
  const nomi = el('div', 'wp-pv-names');
  nomi.appendChild(el('span', 'wp-pv-label', pvT('signedInAs')));
  nomi.appendChild(el('strong', 'wp-pv-name', account.discordUsername));
  riga.appendChild(nomi);

  if (account.admin) riga.appendChild(el('span', 'wp-pv-badge wp-pv-badge-admin', 'admin'));
  if (!account.verificato) riga.appendChild(el('span', 'wp-pv-badge', pvT('notVerified')));
  card.appendChild(riga);

  card.appendChild(el('h2', 'wp-pv-h2', pvT('nextStep')));
  card.appendChild(el('p', 'wp-pv-body', pvT('nextStepBody')));

  const esci = el('button', 'wp-pv-btn wp-pv-btn-quiet', pvT('signOut'));
  esci.type = 'button';
  esci.addEventListener('click', async () => {
    esci.disabled = true;
    await logout();
    account = null;
    render();
  });
  card.appendChild(esci);

  return card;
}

function cardIndisponibile() {
  const card = el('div', 'wp-pv-card wp-pv-card-down');
  card.appendChild(el('h2', 'wp-pv-h2', pvT('unavailable')));
  card.appendChild(el('p', 'wp-pv-body', pvT('unavailableBody')));

  const btn = el('button', 'wp-pv-btn wp-pv-btn-quiet', pvT('retry'));
  btn.type = 'button';
  btn.addEventListener('click', async () => { btn.disabled = true; await refresh(); });
  card.appendChild(btn);
  return card;
}

/** Vero se c'è un token salvato — non garantisce che valga ancora, serve
 *  solo a decidere se vale la pena chiedere al server. */
export function haSessione() { return Boolean(getToken()); }
