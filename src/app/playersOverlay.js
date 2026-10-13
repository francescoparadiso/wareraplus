/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Giocatori
   ------------------------------------------------------------------
   Stessa meccanica degli overlay Statistiche nazioni / Unità Militari:
   full-screen sopra la mappa, aperto da "Approfondimenti → Giocatori"
   o da un clic su un cittadino. La vista vera (src/players/main.js) si
   carica via import() dinamico alla PRIMA apertura, così il suo chunk
   non pesa sul boot.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';
import { pushBack, dropBack } from './backNav.js';

let overlayEl, backBtn, rootEl;
let _mod = null;

export function initPlayersOverlay() {
  overlayEl = document.getElementById('wp-players-overlay');
  backBtn = document.getElementById('wp-players-back');
  rootEl = document.getElementById('wp-players-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closePlayersView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closePlayersView();
  });
}

/** Con `userId` apre direttamente la scheda di quel giocatore. */
export async function openPlayersView(userId) {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'players');
  pushBack('players', closePlayersView, isPlayersViewOpen, { section: 'players' });

  await withModuleLoading('players', async () => {
    _mod = await loadModule(() => import('../players/main.js'), 'players');
    if (userId) _mod.openPlayer(userId);
    await _mod.initPlayersView(rootEl);
  });

  trackEvent('players-view-open', { deepLink: !!userId });
}

export function closePlayersView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
  _mod?.stopPlayersView();
  dropBack('players');
}

export function isPlayersViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
