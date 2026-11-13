/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sezioni chiudibili e spostabili
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-13): «rendi chiudibili e spostabili le
   sezioni». Come per le colonne (shared/tableSort.js) non si tocca vista per
   vista: l'osservatore di viewTools.js passa qui i nodi comparsi e le
   sezioni si riconoscono dai TITOLI, elencati in FLOW e CARD più sotto —
   l'unico posto da toccare per includerne altre.

   ── Due modi in cui una sezione è fatta ──────────────────────
   · FLOW: un titolo e, sotto, i fratelli che seguono fino al titolo
     successivo (la maggior parte delle viste: «Bonifici fra tesori» e tutto
     quello che segue). Si sposta il blocco intero; chiudere nasconde i
     fratelli.
   · CARD: un riquadro con il suo titolo dentro (i grafici). Chiudere nasconde
     il contenuto del riquadro; si sposta il riquadro tra i suoi fratelli, ma
     solo se il contenitore NON è già fatto di sezioni FLOW (lì il riquadro è
     parte di una sezione e si muove con lei).

   ── Comandi ─────────────────────────────────────────────────
   A sinistra del titolo: una freccia (chiude/apre) e, dove la sezione si può
   spostare, una maniglia ⠿. La maniglia si TRASCINA (mouse e tocco: sono
   eventi puntatore) oppure, con la tastiera, ↑ e ↓. Vicino ai bordi dello
   schermo trascinando la pagina scorre da sola.

   ── Cosa si ricorda ─────────────────────────────────────────
   Chiuse e ordine, per contenitore, in localStorage (`we_layout`). La chiave
   di una sezione è `data-sec` se la vista lo mette sul titolo, altrimenti
   la classe del titolo + il suo ordinale nel contenitore. ⚠️ L'ordinale
   cambia se una sezione compare solo a volte (dati che mancano): per quelle
   conviene mettere `data-sec`. Chi ridisegna la vista butta via i nostri
   segni e li ritrova qui: lo stato si riapplica da sé.

   ── Cosa NON è una sezione ──────────────────────────────────
   Le schede (tab) e le intestazioni di pagina: non hanno questi titoli, e
   chiudere una scheda sarebbe un modo di perdersi.
   ══════════════════════════════════════════════════════════════ */

import { getLang } from './i18n.js';

// Titoli che aprono una sezione FLOW (titolo + fratelli seguenti).
const FLOW = [
  '.wp-nat-section-title', '.wp-btl-h3', '.wp-ply-h3', '.wp-trn-h3', '.wp-vt-h3',
  '.wp-mu-section-title', '.wp-crf-h3', '.wp-vs-gtitle',
];
// Titoli dentro un riquadro (CARD): il riquadro è il genitore del titolo. Oltre
// ai titoli con classe, ogni <h3>/<h4> che sia il PRIMO figlio del suo riquadro
// (Soldi, Crafting, Political… scrivono un <h3> nudo in cima a ogni grafico).
const CARD = ['.wp-nat-chart-title', '.wp-ecn-psec', 'h3', 'h4'];

const FLOW_SEL = FLOW.join(', ');
const CARD_SEL = CARD.join(', ');

/** Un titolo di riquadro è tale se non è già un titolo FLOW, ha del testo e
 *  non è dentro un comando nostro. */
const isCardTitle = (el) => el.matches(CARD_SEL) && !el.matches(FLOW_SEL) && el.textContent.trim() !== '';
const STORE_KEY = 'we_layout';

const T = {
  en: { fold: 'Collapse / expand', move: 'Drag to move (or use the up and down arrows)' },
  it: { fold: 'Chiudi / apri', move: 'Trascina per spostare (o usa le frecce su e giù)' },
  es: { fold: 'Contraer / expandir', move: 'Arrastra para mover (o usa las flechas arriba y abajo)' },
  de: { fold: 'Ein- / ausklappen', move: 'Zum Verschieben ziehen (oder Pfeil hoch / runter)' },
  fr: { fold: 'Replier / déplier', move: 'Glisser pour déplacer (ou flèches haut et bas)' },
};
const tt = (k) => (T[getLang()] || T.en)[k];

/* ── Memoria ────────────────────────────────────────────────── */

let _store = null;
function store() {
  if (_store) return _store;
  try { _store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { _store = {}; }
  return _store;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(_store || {})); } catch { /* storage negato */ }
}
const EMPTY = Object.freeze({ order: [], closed: [] });
/** Lo stato di un contenitore, senza crearne uno vuoto per ogni visita. */
function peek(ck) { return store()[ck] || EMPTY; }
function slot(ck) {
  const s = store();
  return (s[ck] = s[ck] || { order: [], closed: [] });
}

/** Dove sta questo contenitore: la vista, l'antenato con un id (la scheda
 *  attiva) e la sua classe. Stabile fra un ridisegno e l'altro. */
function containerKey(parent) {
  const view = parent.closest('[id$="-overlay"], #wp-country-panel, #wp-political-root')?.id || '';
  const idEl = parent.id ? parent : parent.closest('[id]');
  return `${view}|${idEl?.id || ''}|${parent.classList[0] || parent.tagName}`;
}

/* ── Unità: le sezioni di un contenitore ────────────────────── */

function keyed(units) {
  const seen = new Map();
  for (const u of units) {
    const cls = [...u.heading.classList].find(c => c !== 'wp-sec-h' && c !== 'wp-sec-closed') || u.heading.tagName;
    const n = (seen.get(cls) || 0) + 1;
    seen.set(cls, n);
    u.key = u.heading.dataset.sec || `${cls}#${n}`;
  }
  return units;
}

/** Sezioni FLOW di `parent`: ogni titolo con i fratelli che lo seguono. */
function flowUnits(parent) {
  const kids = [...parent.children];
  const idx = kids.map((k, i) => (k.matches(FLOW_SEL) ? i : -1)).filter(i => i >= 0);
  return keyed(idx.map((start, n) => {
    const els = kids.slice(start, idx[n + 1] ?? kids.length);
    return { heading: kids[start], els, body: els.slice(1), kind: 'flow' };
  }));
}

/** Sezioni CARD di `parent`: i figli che hanno un titolo CARD come primo figlio. */
function cardUnits(parent) {
  const out = [];
  for (const k of parent.children) {
    const h = k.firstElementChild;
    if (h && isCardTitle(h) && k.children.length >= 2) {
      out.push({ heading: h, els: [k], body: [...k.children].filter(c => c !== h), kind: 'card' });
    }
  }
  return keyed(out);
}

/** Quelle che si possono SPOSTARE: le FLOW se il contenitore ne ha, altrimenti
 *  le CARD. Un riquadro dentro una pagina fatta di sezioni FLOW si muove con la
 *  sezione che lo contiene, non da solo. */
function orderUnits(parent) {
  const f = flowUnits(parent);
  return f.length ? f : cardUnits(parent);
}

/** Tutte, per trovare quella di un titolo. */
function allUnits(parent) {
  return [...flowUnits(parent), ...cardUnits(parent)];
}

/** Rimette le sezioni nell'ordine `keys`. Solo le posizioni occupate dalle
 *  sezioni cambiano: quello che sta prima della prima (l'«anteprima» di una
 *  pagina) o fra card che non sono sezioni resta dov'è. */
function applyOrder(parent, units, keys) {
  const byKey = new Map(units.map(u => [u.key, u]));
  const wanted = [
    ...keys.filter(k => byKey.has(k)).map(k => byKey.get(k)),
    ...units.filter(u => !keys.includes(u.key)),
  ];
  if (wanted.every((u, i) => u === units[i])) return false;

  const kids = [...parent.children];
  const taken = new Set(units.flatMap(u => u.els));
  const slots = kids.map((el, i) => (taken.has(el) ? i : -1)).filter(i => i >= 0);
  const flat = wanted.flatMap(u => u.els);
  const order = kids.slice();
  slots.forEach((s, j) => { order[s] = flat[j]; });
  const frag = document.createDocumentFragment();
  for (const el of order) frag.appendChild(el);
  parent.appendChild(frag);
  return true;
}

/* ── Controlli ──────────────────────────────────────────────── */

function setClosed(u, closed) {
  for (const el of u.body) el.classList.toggle('wp-sec-collapsed', closed);
  u.heading.classList.toggle('wp-sec-closed', closed);
  u.heading.querySelector(':scope > .wp-sec-ctl .wp-sec-toggle')?.setAttribute('aria-expanded', String(!closed));
}

function makeControls(u, movable) {
  const ctl = document.createElement('span');
  ctl.className = 'wp-sec-ctl';
  const tg = document.createElement('button');
  tg.type = 'button';
  tg.className = 'wp-sec-toggle';
  tg.title = tt('fold');
  tg.setAttribute('aria-label', tt('fold'));
  ctl.appendChild(tg);
  if (movable) {
    const gr = document.createElement('span');
    gr.className = 'wp-sec-grip';
    gr.tabIndex = 0;
    gr.setAttribute('role', 'button');
    gr.title = tt('move');
    gr.setAttribute('aria-label', tt('move'));
    ctl.appendChild(gr);
  }
  u.heading.insertBefore(ctl, u.heading.firstChild);
}

/** Aggiunge i comandi a una sezione (una volta) e riapplica lo stato. */
function dress(u, movable, saved) {
  const h = u.heading;
  if (!h.classList.contains('wp-sec-h')) {
    h.classList.add('wp-sec-h');
    // Una sezione senza niente sotto non ha cosa chiudere; e una sola
    // sezione nel contenitore non ha dove spostarsi.
    const canFold = u.body.length > 0;
    if (!canFold && !movable) return;
    makeControls(u, movable);
    if (!canFold) h.querySelector('.wp-sec-toggle')?.remove();
  }
  setClosed(u, saved.closed.includes(u.key));
}

/* ── Trascinamento ──────────────────────────────────────────── */

function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

function rectOf(u) {
  const rs = u.els.map(e => e.getBoundingClientRect());
  return { top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) };
}

function move(parent, from, to, after, quiet) {
  const units = orderUnits(parent);
  const keys = units.map(u => u.key).filter(k => k !== from);
  const at = keys.indexOf(to);
  if (at < 0) return;
  keys.splice(after ? at + 1 : at, 0, from);
  quiet(() => applyOrder(parent, units, keys));
  slot(containerKey(parent)).order = keys;
  save();
}

function startDrag(e, parent, key, quiet) {
  const grip = e.currentTarget;
  const units = orderUnits(parent);
  const me = units.find(u => u.key === key);
  if (!me) return;
  e.preventDefault();
  // Con un puntatore "finto" (prove, strumenti) la cattura può fallire: il
  // trascinamento funziona lo stesso, perché ascolta la maniglia.
  try { grip.setPointerCapture(e.pointerId); } catch { /* niente cattura */ }
  me.els.forEach(el => el.classList.add('wp-sec-dragging'));
  document.body.classList.add('wp-sec-drag-on');
  const scroller = scrollParent(parent);
  let y = e.clientY;
  let target = null;
  let after = false;
  let raf = 0;

  const clearMark = () => {
    parent.querySelectorAll('.wp-sec-drop-before, .wp-sec-drop-after').forEach(el => el.classList.remove('wp-sec-drop-before', 'wp-sec-drop-after'));
  };
  const update = () => {
    clearMark();
    target = null;
    const others = orderUnits(parent).filter(u => u.key !== key);
    let best = null;
    for (const u of others) {
      const r = rectOf(u);
      if (y >= r.top && y <= r.bottom) { best = { u, r }; break; }
    }
    if (!best && others.length) {
      // Fuori da ogni sezione: la più vicina.
      best = others
        .map(u => ({ u, r: rectOf(u) }))
        .sort((a, b) => Math.min(Math.abs(y - a.r.top), Math.abs(y - a.r.bottom)) - Math.min(Math.abs(y - b.r.top), Math.abs(y - b.r.bottom)))[0];
    }
    if (!best) return;
    target = best.u;
    after = y > (best.r.top + best.r.bottom) / 2;
    (after ? target.els[target.els.length - 1] : target.els[0]).classList.add(after ? 'wp-sec-drop-after' : 'wp-sec-drop-before');
  };
  // Scorrimento automatico vicino ai bordi.
  const tick = () => {
    const box = scroller === document.scrollingElement
      ? { top: 0, bottom: innerHeight }
      : scroller.getBoundingClientRect();
    const zone = 48;
    if (y < box.top + zone) scroller.scrollBy(0, -14);
    else if (y > box.bottom - zone) scroller.scrollBy(0, 14);
    update();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onMove = (ev) => { y = ev.clientY; update(); };
  const finish = (ev) => {
    cancelAnimationFrame(raf);
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', finish);
    grip.removeEventListener('pointercancel', finish);
    if (ev.type === 'pointerup') { y = ev.clientY; update(); }
    const finalTarget = target;
    const finalAfter = after;
    clearMark();
    me.els.forEach(el => el.classList.remove('wp-sec-dragging'));
    document.body.classList.remove('wp-sec-drag-on');
    if (ev.type === 'pointerup' && finalTarget) move(parent, key, finalTarget.key, finalAfter, quiet);
  };
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
}

function bindContainer(parent, quiet) {
  if (parent.dataset.wpSecBound) return;
  parent.dataset.wpSecBound = '1';

  // Un listener per contenitore, delegato: sopravvive ai ridisegni dei figli.
  parent.addEventListener('click', (e) => {
    const tg = e.target.closest('.wp-sec-toggle');
    if (!tg) return;
    const h = tg.closest('.wp-sec-h');
    const u = allUnits(parent).find(x => x.heading === h);
    if (!u) return;
    const closed = !h.classList.contains('wp-sec-closed');
    quiet(() => setClosed(u, closed));
    const s = slot(containerKey(parent));
    s.closed = s.closed.filter(k => k !== u.key);
    if (closed) s.closed.push(u.key);
    save();
  });

  parent.addEventListener('pointerdown', (e) => {
    const gr = e.target.closest('.wp-sec-grip');
    if (!gr || e.button > 0) return;
    // La sezione è quella il cui titolo contiene la maniglia: per una CARD
    // il titolo sta nel riquadro, che è il figlio del contenitore.
    const h = gr.closest('.wp-sec-h');
    const u = orderUnits(parent).find(x => x.heading === h);
    if (!u) return;
    startDrag({ currentTarget: gr, pointerId: e.pointerId, clientY: e.clientY, preventDefault: () => e.preventDefault() }, parent, u.key, quiet);
  });

  parent.addEventListener('keydown', (e) => {
    const gr = e.target.closest('.wp-sec-grip');
    if (!gr || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const units = orderUnits(parent);
    const i = units.findIndex(x => x.heading === gr.closest('.wp-sec-h'));
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (i < 0 || j < 0 || j >= units.length) return;
    move(parent, units[i].key, units[j].key, e.key === 'ArrowDown', quiet);
    // Muovere i nodi può togliere il fuoco: lo si rimette sulla stessa maniglia.
    gr.focus?.();
  });
}

/* ── Aggancio ───────────────────────────────────────────────── */

/** Da chiamare con ogni nodo comparso. */
export function enhanceSections(root, quiet) {
  if (!root || root.nodeType !== 1) return;
  const heads = [];
  if (root.matches?.(`${FLOW_SEL}, ${CARD_SEL}`)) heads.push(root);
  heads.push(...root.querySelectorAll?.(`${FLOW_SEL}, ${CARD_SEL}`) || []);
  // I titoli di riquadro si riconoscono dalla posizione: devono essere il
  // primo figlio.
  const isHead = (h) => h.matches(FLOW_SEL) || (isCardTitle(h) && h.parentElement?.firstElementChild === h);

  // Il contenitore di un titolo FLOW è il suo genitore; di uno CARD, il
  // genitore del riquadro.
  const parents = new Set();
  for (const h of heads) {
    if (h.classList.contains('wp-sec-h') || !isHead(h)) continue;
    if (h.closest('[data-nosections]')) continue;
    const p = h.matches(FLOW_SEL) ? h.parentElement : h.parentElement?.parentElement;
    if (p) parents.add(p);
  }

  for (const parent of parents) {
    if (!allUnits(parent).length) continue;
    const saved = peek(containerKey(parent));
    quiet(() => {
      if (saved.order.length) applyOrder(parent, orderUnits(parent), saved.order);
      const movables = orderUnits(parent);
      const canMove = movables.length > 1;
      for (const u of allUnits(parent)) dress(u, canMove && movables.some(m => m.heading === u.heading), saved);
    });
    bindContainer(parent, quiet);
  }
}
