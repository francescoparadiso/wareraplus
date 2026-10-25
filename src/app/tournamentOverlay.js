/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Tornei
   ------------------------------------------------------------------
   Stessa meccanica degli altri overlay di "Approfondimenti" (vedi
   battlesOverlay.js): la vista vera (src/tournament/main.js) arriva con
   un import() dinamico alla PRIMA apertura, poi si rimonta nello stesso
   #wp-tournament-root.

   Come Battaglie, alla chiusura c'è un giro da fermare: il torneo in
   corso si riaggiorna ogni tre minuti, e dietro un overlay chiuso sarebbe
   consumo puro.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';
import { pushBack, dropBack } from './backNav.js';

let overlayEl, backBtn, rootEl;
let _mod = null;

export function initTournamentOverlay() {
  overlayEl = document.getElementById('wp-tournament-overlay');
  backBtn = document.getElementById('wp-tournament-back');
  rootEl = document.getElementById('wp-tournament-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeTournamentView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeTournamentView();
  });
}

/** `type` = 'mu' | 'country', `team` = id della squadra da aprire (link
 *  ?section=tournament&tab=country&team=). */
export async function openTournamentView({ type, team } = {}) {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'tournament');
  pushBack('tournament', closeTournamentView, isTournamentViewOpen, { section: 'tournament' });

  await withModuleLoading('tournament', async () => {
    _mod = await loadModule(() => import('../tournament/main.js'), 'tournament');
    if (type || team) _mod.openTournamentTeam({ type, team });
    await _mod.initTournamentView(rootEl);
  });

  trackEvent('tournament-overlay-open', { deepLink: !!team });
}

export function closeTournamentView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
  dropBack('tournament');
  _mod?.stopTournamentView?.();
}

export function isTournamentViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
