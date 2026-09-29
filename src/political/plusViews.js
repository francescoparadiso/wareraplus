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

const NEW_VIEWS = { history: 'wp-pol-history-view', world: 'wp-pol-world-view' };

/** Nasconde le viste WarEra+ (chiamata dalle viste originali). */
export function hideWpPlusViews() {
  for (const id of Object.values(NEW_VIEWS)) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.querySelectorAll('#wp-political-root .wp-pol-nav-btn.active').forEach(b => b.classList.remove('active'));
}

/** Nasconde tutto tranne la vista WarEra+ `which`. */
export function hideOtherViews(which) {
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
