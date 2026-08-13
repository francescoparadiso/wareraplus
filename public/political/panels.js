/* ── PANEL SYSTEM ── */
function initPanelSystem() {
  // Aggiungi anche .party-view-grid tra le griglie da rendere ordinabili
  const grids = document.querySelectorAll('.main-grid, .charts-row, .single-chart-row, .presidential-grid, .party-view-grid');
  const panelContainers = [];

  grids.forEach(grid => {
    if (!grid) return;
    panelContainers.push(grid);

    // Assegna un ID univoco a ogni pannello che non ne ha già uno
    grid.querySelectorAll('details.panel, .panel').forEach((el, idx) => {
      if (!el.id) el.id = `panel-${grid.className.replace(/[^a-z]/g, '')}-${Date.now()}-${idx}`;
    });

    // Inizializza Sortable
    new Sortable(grid, {
      group: { name: 'warera-panels', pull: true, put: true },
      animation: 250,
      handle: 'summary',          // per i details.panel; per i div.panel senza summary il trascinamento non funzionerà (ma va bene)
      delay: 200,
      delayOnTouchOnly: true,
      touchStartThreshold: 3,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: () => panelContainers.forEach(g => g.classList.add('dragging')),
      onEnd: () => {
        panelContainers.forEach(g => g.classList.remove('dragging'));
        updateAllGridLayouts(panelContainers);
        saveAllGridOrders(panelContainers);
        requestChartResize();   // non strettamente necessario in party view, ma innocuo
      },
    });
  });

  loadAllGridOrders(panelContainers);
  updateAllGridLayouts(panelContainers);

  // Eventi toggle per gestire il layout a colonna singola (opzionale)
  document.querySelectorAll('details.panel').forEach(panel => {
    panel.addEventListener('toggle', () => {
      updateAllGridLayouts(panelContainers);
      setTimeout(() => {
        const canvas = panel.querySelector('canvas');
        if (canvas && canvas.chart) canvas.chart.resize();
      }, 300);
    });
  });
}

function updateAllGridLayouts(grids) {
  grids.forEach(grid => {
    const panels = grid.querySelectorAll('details.panel');
    const anyClosed = Array.from(panels).some(p => !p.open);
    // Aggiungi o rimuovi la classe 'single-col' in base al numero di pannelli o alla chiusura
    if (grid.classList.contains('party-view-grid')) {
      // Per party view, se vuoi che occupi tutta la larghezza quando un pannello è chiuso
      grid.classList.toggle('single-col', panels.length <= 1 || anyClosed);
    } else {
      grid.classList.toggle('single-col', panels.length <= 1 || anyClosed);
    }
  });
}

function saveAllGridOrders(grids) {
  grids.forEach(grid => {
    const key = `panel_order_${grid.className.split(' ')[0]}`;
    const order = Array.from(grid.children).map(el => el.id);
    localStorage.setItem(key, JSON.stringify(order));
  });
}

function loadAllGridOrders(grids) {
  grids.forEach(grid => {
    const key = `panel_order_${grid.className.split(' ')[0]}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    try {
      JSON.parse(saved).forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentNode === grid) grid.appendChild(el);
      });
    } catch (e) {}
  });
}

function requestChartResize() {
  setTimeout(() => {
    [_seatsChart, _membersChart, _allPartiesChart, _timelineChart].forEach(c => c?.resize());
  }, 350);
}

/* ── PARLIAMENT RESIZE OBSERVER ── */
function observeParliamentResize() {
  const container = document.getElementById('parliamentContainer');
  if (!container) return;
  if (window._parliamentResizeObserver) window._parliamentResizeObserver.disconnect();
  const observer = new ResizeObserver(() => {
    if (window._lastParliamentData && container.clientWidth > 0) Parliament.render(window._lastParliamentData);
  });
  observer.observe(container);
  window._parliamentResizeObserver = observer;
}
