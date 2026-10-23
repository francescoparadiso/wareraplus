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
import { pushBack, dropBack } from './backNav.js';
import { state } from '../diplomacy/state.js';

let overlayEl, backBtn, rootEl;

// Esito dell'ultimo ritorno da Discord, raccolto al boot e consegnato alla
// vista quando si apre. Vive qui e non in src/private/api.js perche' quello
// sta nel chunk pigro: leggerlo al boot vorrebbe dire scaricare l'intera
// vista anche a chi non la aprira' mai.
let authError = null;
let _comeAccount = null;

const TOKEN_KEY = 'wp_plus_token';

// Il token anche in memoria: se localStorage non lo prende, la sessione
// vale almeno finché la scheda resta aperta (src/private/api.js lo legge
// da qui quando lo storage non ce l'ha).
let _tokenInMemoria = null;
export function tokenPlusInMemoria() { return _tokenInMemoria; }
export function azzeraTokenInMemoria() { _tokenInMemoria = null; }

/* ⚠️ 2026-09-29: sul live il login con Discord "non andava": il server
   creava la sessione (4 accessi in audit), ma al ritorno la vista ripartiva
   dal pulsante di accesso e non chiedeva nemmeno /auth/me. Il localStorage
   di quel browser era PIENO — mesi di cache tRPC sullo stesso dominio — e
   setItem lanciava QuotaExceeded, che qui veniva ignorato in silenzio.
   Sul dev (dominio suo, storage quasi vuoto) non si vedeva.

   Si fa posto con quello che si può buttare senza perdere niente: le voci
   di cache di src/shared/trpcClient.js (`we_*` con dentro {data, ts, ttl}),
   che si riscaricano da sole. Preferenze e bozze non si toccano. */
function faiPostoNelloStorage() {
  let tolte = 0;
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('we_')) continue;
      const v = localStorage.getItem(k) || '';
      if (!v.startsWith('{"data"') || !v.includes('"ttl"')) continue;
      localStorage.removeItem(k);
      tolte++;
    }
  } catch { /* storage inaccessibile: resta la memoria */ }
  return tolte;
}

function salvaToken(token) {
  _tokenInMemoria = token;
  try { localStorage.setItem(TOKEN_KEY, token); return; } catch { /* pieno? */ }
  const tolte = faiPostoNelloStorage();
  try {
    localStorage.setItem(TOKEN_KEY, token);
    console.warn(`[area riservata] localStorage pieno: liberate ${tolte} voci di cache per salvare l'accesso`);
  } catch {
    console.warn("[area riservata] localStorage non disponibile: l'accesso vale finché la scheda resta aperta");
  }
}

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
  if (token) salvaToken(token);
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
  try { if (localStorage.getItem(TOKEN_KEY)) return true; } catch { /* sotto: la memoria */ }
  return Boolean(_tokenInMemoria);
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
  // WarEra+ Accordi: chi è partito da "Entra con Discord" nella sezione
  // Accordi torna lì, non qui (src/accordi/api.js: entraConDiscord). Un
  // errore di login si mostra comunque qui, dove c'è chi sa spiegarlo.
  let ritorno = null;
  try { ritorno = sessionStorage.getItem('wp_after_login'); sessionStorage.removeItem('wp_after_login'); } catch { /* si atterra qui */ }
  if (appenaEntrato && !authError && ritorno === 'accordi') {
    window.addEventListener('wareraplus:diplomacy-ready', () => {
      import('./accordiOverlay.js').then(m => m.openAccordiView()).catch(() => openPrivateView());
    }, { once: true });
  } else if (appenaEntrato && !authError && ritorno?.startsWith('votazioni:')) {
    // Le Votazioni di Political (src/political/votesApi.js): si torna sulla
    // nazione e sulla votazione da cui si era premuto "Entra con Discord".
    const [, paese, voto] = ritorno.split(':');
    window.addEventListener('wareraplus:diplomacy-ready', () => {
      import('./politicalOverlay.js')
        .then(m => m.openPoliticalView(paese || undefined, (paese && state.nationMap?.get(paese)?.name) || '',
          { openVotes: true, voteId: voto || null }))
        .catch(() => openPrivateView());
    }, { once: true });
  } else if (appenaEntrato || authError) {
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
  // Indietro del browser/telefono = closePrivateView (vedi backNav.js).
  pushBack('private', closePrivateView, isPrivateViewOpen, { section: 'private' });

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
  dropBack('private');
}

export function isPrivateViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
