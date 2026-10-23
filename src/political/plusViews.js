/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: le due viste nuove accanto alle originali
   ------------------------------------------------------------------
   Political nasce con tre viste che si scambiano a mano i display
   (congresso, presidenziali, partito — vedi showView/showPartyView in
   ui.js). Le due nuove ("Storia" e "Mondo") entrano nello stesso
   gioco: chi apre una vista nuova nasconde tutte le altre qui, e le
   funzioni originali nascondono le nuove con UNA riga aggiunta
   (hideWpPlusViews), senza cambiare nient'altro del loro comportamento.
   ══════════════════════════════════════════════════════════════ */

import { updateBackParams } from '../app/backNav.js';

const NEW_VIEWS = { history: 'wp-pol-history-view', world: 'wp-pol-world-view', votes: 'wp-pol-votes-view' };

/** Le Votazioni scrivono nel link ?tab=votes&vote=…: chi passa a un'altra
 *  vista lo toglie, o il link copiato riaprirebbe la votazione. */
const _clearVotesParams = () => updateBackParams('political', { tab: undefined, vote: undefined });

/** Nasconde le viste WarEra+ (chiamata dalle viste originali). */
export function hideWpPlusViews() {
  _clearVotesParams();
  for (const id of Object.values(NEW_VIEWS)) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.querySelectorAll('#wp-political-root .wp-pol-nav-btn.active').forEach(b => b.classList.remove('active'));
}

/** Nasconde tutto tranne la vista WarEra+ `which`. */
export function hideOtherViews(which) {
  if (which !== 'votes') _clearVotesParams();
  ['president-view', 'congress-view', 'party-view', 'candidatesContainer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const statsRow = document.querySelector('#wp-political-root .stats-row');
  if (statsRow) statsRow.style.display = 'none';
  const timeline = document.getElementById('timelinePanel');
  if (timeline) timeline.style.display = 'none';
  for (const [k, id] of Object.entries(NEW_VIEWS)) {
    const el = document.getElementById(id);
    if (el && k !== which) el.style.display = 'none';
  }
  document.querySelectorAll('#wp-political-root .wp-pol-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === which);
  });
}
