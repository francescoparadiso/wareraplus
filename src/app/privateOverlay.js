/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Area riservata
   ------------------------------------------------------------------
   Stessa meccanica di Guida / Political / Eco / Battaglie: full-screen
   sopra la mappa, aperto da "Approfondimenti → Area riservata", vista
   caricata con import() dinamico alla prima apertura.

   La voce di menù resta visibile a TUTTI, anche a chi non entrerà mai:
   nasconderla a chi non è loggato vorrebbe dire che nessuno scopre che
   esiste. Chi ci clicca legge cos'è e chiude.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

let overlayEl, backBtn, rootEl;

// Esito dell'ultimo ritorno da Discord, raccolto al boot e consegnato alla
// vista quando si apre. Vive qui e non in src/private/api.js perche' quello
// sta nel chunk pigro: leggerlo al boot vorrebbe dire scaricare l'intera
// vista anche a chi non la aprira' mai.
let authError = null;
let _comeAccount = null;

const TOKEN_KEY = 'wp_plus_token';

/**
 * Raccoglie `#wp_auth=` / `#wp_auth_error=` dal frammento e ripulisce
 * subito la barra degli indirizzi, cosi' il token non resta in un URL che
 * si puo' copiare e incollare in una chat.
 * @returns {boolean} true se e' appena arrivata una sessione nuova
 */
function catturaRitornoDaDiscord() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!raw) return false;

  const p = new URLSearchParams(raw);
  const token = p.get('wp_auth');
  const err = p.get('wp_auth_error');
  if (!token && !err) return false;

  // localStorage puo' lanciare (modalita' privata, storage pieno): l'area
  // riservata non deve poter buttare giu' il boot del tool.
  if (token) { try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignora */ } }
  if (err) authError = err;

  // Si tolgono SOLO le due chiavi nostre: se un domani il tool usasse il
  // frammento per altro, buttare via tutto sarebbe un bug silenzioso.
  p.delete('wp_auth'); p.delete('wp_auth_error');
  const resto = p.toString();
  history.replaceState(null, '', location.pathname + location.search + (resto ? `#${resto}` : ''));

  return Boolean(token);
}

/**
 * C'e' una sessione dell'area riservata? Non dice se da' diritto a
 * qualcosa — solo se ha senso chiederlo al server.
 *
 * Vive QUI e non in src/private/api.js per lo stesso motivo di authError
 * qui sopra: chi vuole saperlo (la linguetta "Bilancio" della vista unita'
 * militari) deve poterlo chiedere senza tirarsi dietro il chunk pigro
 * dell'area riservata. Il TOKEN_KEY resta scritto in un posto solo.
 */
export function haSessionePlus() {
  try { return Boolean(localStorage.getItem(TOKEN_KEY)); } catch { return false; }
}

export function initPrivateOverlay() {
  overlayEl = document.getElementById('wp-private-overlay');
  backBtn = document.getElementById('wp-private-back');
  rootEl = document.getElementById('wp-private-root');
  if (!overlayEl) return;

  // Chi torna da Discord ha appena premuto "Entra": aprirgli la mappa e
  // lasciargli ritrovare la voce di menu' da solo sarebbe un vicolo cieco.
  // Si aspetta pero' che la mappa sia pronta, per non montare un overlay
  // sopra la schermata di caricamento.
  const appenaEntrato = catturaRitornoDaDiscord();
  if (appenaEntrato || authError) {
    window.addEventListener('wareraplus:diplomacy-ready', () => { openPrivateView(); }, { once: true });
  }

  // L'amministrazione e' una sezione a parte: quando chiede "vedi come",
  // si apre QUESTA vista con la lente, invece di ricostruirne una copia
  // di la' che prima o poi divergerebbe da quella vera.
  window.addEventListener('wareraplus:private-view-as', (e) => {
    _comeAccount = e.detail?.accountId || null;
    openPrivateView();
  });

  backBtn.addEventListener('click', closePrivateView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closePrivateView();
  });
}

export async function openPrivateView() {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'private');

  await withModuleLoading('private', async () => {
    const mod = await loadModule(() => import('../private/main.js'), 'private');
    // L'errore si consegna una volta sola: riaprendo la vista non deve
    // ricomparire un messaggio su un tentativo di mezz'ora fa.
    const err = authError; authError = null;
    const come = _comeAccount; _comeAccount = null;
    if (come && mod.guardaComeDaFuori) {
      mod.initPrivateView(rootEl, { authError: err, comeAccount: come });
    } else {
      mod.initPrivateView(rootEl, { authError: err });
    }
  });

  trackEvent('private-view-open');
}

export function closePrivateView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isPrivateViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
