/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay "Altri strumenti"
   ------------------------------------------------------------------
   Stessa meccanica dell'overlay Guida: full-screen sopra la mappa,
   aperto da "Approfondimenti → Altri strumenti". La vista
   (src/tools/main.js) arriva con un import() alla prima apertura: è
   poco, ma sono nove lingue e non servono a nessuno finché non la apre.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';
import { loadModule } from '../shared/lazyModule.js';
import { withModuleLoading } from '../shared/loadingScreen.js';
import { enterOverlay, leaveOverlay } from './overlayChrome.js';
import { pushBack, dropBack } from './backNav.js';

let overlayEl, backBtn, rootEl;

export function initToolsOverlay() {
  overlayEl = document.getElementById('wp-tools-overlay');
  backBtn = document.getElementById('wp-tools-back');
  rootEl = document.getElementById('wp-tools-root');
  if (!overlayEl) return;

  backBtn.addEventListener('click', closeToolsView);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) closeToolsView();
  });
}

export async function openToolsView() {
  if (!overlayEl) return;
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');
  rootEl.style.display = 'block';

  enterOverlay(overlayEl, 'tools');
  // Indietro del browser/telefono = closeToolsView (vedi backNav.js).
  pushBack('tools', closeToolsView, isToolsViewOpen, { section: 'tools' });

  await withModuleLoading('tools', async () => {
    const mod = await loadModule(() => import('../tools/main.js'), 'tools');
    mod.initToolsView(rootEl);
  });

  trackEvent('tools-view-open');
}

export function closeToolsView() {
  if (!overlayEl) return;
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  leaveOverlay(overlayEl);
  dropBack('tools');
}

export function isToolsViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
