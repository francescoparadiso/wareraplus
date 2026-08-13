/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: panels.js come modulo ES (Fase 2, Stage 7)
   ------------------------------------------------------------------
   Conversione diretta. Sortable da CDN a import npm.

   window._lastParliamentData (usato nella condizione del ResizeObserver,
   riga 100 dell'originale) non viene MAI scritto in nessuno dei 15 file
   originali (verificato via grep in fase di analisi) — la condizione
   `if (window._lastParliamentData && ...)` era quindi già sempre falsa
   nell'originale: il ResizeObserver esisteva ma non ri-renderizzava mai
   nulla. Comportamento preservato inalterato (stesso no-op), non
   "corretto" opportunisticamente: non è nello scope di una conversione
   1:1 decidere quale sarebbe il comportamento giusto qui.
   ══════════════════════════════════════════════════════════════ */

import Sortable from 'sortablejs';
import { seatsChart, membersChart, allPartiesChart, timelineChart } from './config.js';
import { render as parliamentRender } from './parliament.js';

let _parliamentResizeObserver = null;
let _lastParliamentData = null; // mai scritto altrove nell'originale, vedi header

export function initPanelSystem() {
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

export function updateAllGridLayouts(grids) {
  grids.forEach(grid => {
    const panels = grid.querySelectorAll('details.panel');
    const anyClosed = Array.from(panels).some(p => !p.open);
    // Aggiungi o rimuovi la classe 'single-col' in base al numero di pannelli o alla chiusura
    grid.classList.toggle('single-col', panels.length <= 1 || anyClosed);
  });
}

export function saveAllGridOrders(grids) {
  grids.forEach(grid => {
    const key = `panel_order_${grid.className.split(' ')[0]}`;
    const order = Array.from(grid.children).map(el => el.id);
    localStorage.setItem(key, JSON.stringify(order));
  });
}

export function loadAllGridOrders(grids) {
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

export function requestChartResize() {
  setTimeout(() => {
    [seatsChart, membersChart, allPartiesChart, timelineChart].forEach(c => c?.resize());
  }, 350);
}

/* ── PARLIAMENT RESIZE OBSERVER ── */
export function observeParliamentResize() {
  const container = document.getElementById('parliamentContainer');
  if (!container) return;
  if (_parliamentResizeObserver) _parliamentResizeObserver.disconnect();
  const observer = new ResizeObserver(() => {
    if (_lastParliamentData && container.clientWidth > 0) parliamentRender(_lastParliamentData);
  });
  observer.observe(container);
  _parliamentResizeObserver = observer;
}
