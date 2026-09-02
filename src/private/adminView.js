/* ══════════════════════════════════════════════════════════════
   AMMINISTRAZIONE — vista a sé
   ------------------------------------------------------------------
   Stava dentro l'area riservata, in fondo alla colonna. Sbagliato per
   due ragioni: chi entra lì dentro ci va per chiedere o approvare un
   contratto, non per amministrare, e ritrovarsi sotto l'elenco di tutti
   gli account è rumore; e soprattutto un pannello di amministrazione
   deve essere un posto in cui si entra apposta, non uno in cui si
   scivola scorrendo.

   ── CHI LA VEDE ────────────────────────────────────────────────────
   La voce di menù compare solo a chi è amministratore. È un
   suggerimento dell'interfaccia, non un permesso: il server rifiuta
   comunque ogni chiamata da chi non lo è, e la voce nascosta non ha mai
   protetto niente. Serve a non mostrare a tutti una porta che si apre
   solo per due persone.
   ══════════════════════════════════════════════════════════════ */

import '../styles/private.css';
import { pvT, pvErr } from './i18n.js';
import { fetchMe, ApiError } from './api.js';
import { creaPannelloAdmin } from './admin.js';

let rootEl = null;
let account = null;
let pannello = null;
let errore = null;

export async function initAdminView(container) {
  rootEl = container;
  render();
  try {
    account = await fetchMe();
  } catch (err) {
    errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
  }
  render();

  window.addEventListener('wareraplus:langchange', render);
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

  const wrap = el('div', 'wp-pv wp-pv-solo');

  const testata = el('header', 'wp-pv-testata');
  testata.appendChild(el('h1', 'wp-pv-title', pvT('adminTitle')));
  testata.appendChild(el('p', 'wp-pv-lead', pvT('adminBody')));
  wrap.appendChild(testata);

  if (errore) wrap.appendChild(el('p', 'wp-pv-error', errore));

  if (!account) {
    if (!errore) wrap.appendChild(el('p', 'wp-pv-note', '…'));
    rootEl.appendChild(wrap);
    return;
  }

  // Anche se il server rifiuterebbe comunque, dirlo qui evita di mostrare
  // un pannello vuoto a chi ci è arrivato per sbaglio.
  if (!account.admin) {
    const card = el('div', 'wp-pv-card');
    card.appendChild(el('p', 'wp-pv-body', pvT('errNon_autorizzato')));
    wrap.appendChild(card);
    rootEl.appendChild(wrap);
    return;
  }

  if (!pannello) {
    pannello = creaPannelloAdmin({
      ridisegna: render,
      // "Vedi come" apre l'AREA RISERVATA con la lente, non una finestra
      // qui dentro: il senso della lente è vedere la vista vera di quella
      // persona, e ricostruirne una copia nel pannello sarebbe una copia
      // che prima o poi diverge da quella che l'utente ha davvero.
      apriComeAltri: (accountId) => {
        window.dispatchEvent(new CustomEvent('wareraplus:private-view-as', { detail: { accountId } }));
      },
      ruoliCambiati: async () => { render(); },
    });
  }
  wrap.appendChild(pannello.render());

  rootEl.appendChild(wrap);
}
