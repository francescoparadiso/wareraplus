/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Amministrazione
   ------------------------------------------------------------------
   Stessa meccanica degli altri overlay. La differenza è una sola: la
   voce di menù che lo apre compare SOLO a chi è amministratore.

   ── COME FA IL MENÙ A SAPERLO SENZA UNA CHIAMATA AL BOOT ───────────
   L'area riservata, quando si apre, scrive in localStorage se questo
   browser appartiene a un amministratore. La barra dei menù legge quel
   segno. Costa zero al boot — che è il punto: nessuno deve pagare una
   richiesta di rete per una voce di menù che non vedrà.

   Il prezzo è che la voce compare solo dopo la prima apertura dell'area
   riservata, e che resta finché non si esce. Accettabile: è un
   suggerimento dell'interfaccia, non un permesso. Il server rifiuta
   ogni chiamata da chi amministratore non è, e una voce di menù
   nascosta non ha mai protetto niente.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';

const CHIAVE_ADMIN = 'wp_plus_admin';

let overlayEl, backBtn, rootEl;

/** Vero se l'ultimo accesso da questo browser era di un amministratore. */
export function sembraAdmin() {
  try { return localStorage.getItem(CHIAVE_ADMIN) === '1'; } catch { return false; }
}

export function initAdminOverlay() {
  overlayEl = document.getElementById('wp-admin-overlay');
  backBtn = document.getElementById('wp-admin-back');
  rootEl = document.getElementById('wp-admin-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeAdminView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeAdminView();
  });
}

export async function openAdminView() {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'private');

  await withModuleLoading('private', async () => {
    const mod = await loadModule(() => import('../private/adminView.js'), 'private');
    mod.initAdminView(rootEl);
  });

  trackEvent('admin-view-open');
}

export function closeAdminView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
}

export function isAdminViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
