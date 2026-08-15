/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bottone dedicato mostra/nascondi battaglie
   ------------------------------------------------------------------
   Componente NUOVO. Non duplica la logica di toggleBattleMarkers
   (già in battleMarkers.js, agganciata al checkbox #checkActiveBattles
   dentro il menu hamburger in diplomacy/main.js): questo bottone si
   limita a simulare un click/change su quel checkbox già esistente,
   così resta un'unica fonte di verità per lo stato "battaglie visibili".

   Motivo del bottone: prima l'unico modo per nascondere le battaglie
   era aprire il menu hamburger e trovare il checkbox — poco visibile
   per un'azione che si vuole fare al volo.
   ══════════════════════════════════════════════════════════════ */

import { trackEvent } from '../shared/analytics.js';

export function initBattleToggle() {
  const btn = document.getElementById('wp-battles-toggle-btn');
  const checkbox = document.getElementById('checkActiveBattles');
  if (!btn || !checkbox) return;

  const sync = () => {
    btn.classList.toggle('wp-battles-hidden', !checkbox.checked);
  };
  sync();

  btn.addEventListener('click', () => {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
    sync();
    trackEvent('battles-toggle', { visible: checkbox.checked });
  });

  // Se il checkbox viene cambiato da altrove (menu hamburger), tieni
  // sincronizzata l'icona del bottone.
  checkbox.addEventListener('change', sync);
}
