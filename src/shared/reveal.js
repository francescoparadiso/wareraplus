/* ══════════════════════════════════════════════════════════════
   WarEra+ — Numeri che contano e grafici che si disegnano
   ------------------------------------------------------------------
   Richiesta dell'utente: i numeri dei pannelli (tesoro, danni,
   popolazione…) salgono fino al valore invece di comparire di colpo, e
   quando un aggiornamento li cambia si vede DI QUANTO; i grafici in SVG
   scritto a mano si tracciano da sinistra a destra all'apertura.

   Un osservatore solo (MutationObserver su <body>) invece di toccare
   ogni vista: chi disegna continua a scrivere il suo innerHTML come
   prima, e qui si riconoscono i pezzi da animare dai loro selettori.
   Le liste NUM_SELECTOR / CHART_SELECTOR sono l'unico posto da toccare
   per aggiungerne altri.

   ── Numeri ───────────────────────────────────────────────────
   Ogni valore ha una chiave: la vista (contenitore) + il titolo di ciò
   che si sta guardando (nazione, unità…) + la sua etichetta. La memoria
   è di sessione:
     · chiave mai vista → sale da zero;
     · stesso valore di prima (ridisegno, cambio lingua) → fermo;
     · valore diverso → parte dal vecchio, e accanto un badge "+12,3K"
       che svanisce.
   Si anima solo un testo con UN numero (niente "12 / 24", date, ore,
   classifiche "#12"), e si riscrive con lo stesso formato che aveva:
   separatori, decimali e suffisso (K, M, %) restano quelli della vista.

   ── Grafici ──────────────────────────────────────────────────
   Un grafico nuovo si apre con un sipario da sinistra (clip-path), una
   ciambella ruota entrando. Ma se nello stesso giro di mutazioni è
   sparito un grafico della stessa classe che era GIÀ a schermo, è un
   AGGIORNAMENTO sul posto (prezzi ogni 5 minuti, battaglia in corso ogni
   minuto, cambio di periodo): niente sipario, o lampeggerebbe a ogni giro.

   Tutto spento con l'interruttore "Animazioni" (shared/motion.js): i
   numeri compaiono subito, il badge del cambiamento resta (è
   un'informazione, non un effetto), il CSS toglie il sipario
   (body.wp-no-motion).
   ══════════════════════════════════════════════════════════════ */

import { animationsOn } from './motion.js';

const NUM_SELECTOR = [
  '.wp-stat-value',            // pannello nazione / alleanza
  '.wp-nat-statcard-value',    // scheda nazione
  '.wp-mu-statcard-value',     // scheda unità militare
  '.wp-pv-totale-val',         // area riservata: totali della nazione
  '.wp-pv-nz-cella > strong',  // area riservata: danno, colpo di tutti
  '#wp-political-root .stat-value', // Political: seggi, voti, affluenza
].join(', ');

const CHART_SELECTOR = [
  '.wp-btl-chart', '.bs-cv-svg', '.wp-ecn-chart', '.wp-mkt-chart',
  '.wp-nat-curve-svg', '.wp-nat-lab-chart', '.wp-nat-lv-svg',
  '.wp-mig-tl-svg', '.wp-pol-ch', '.wp-pol-strip', '.wp-pv-nz-grafico',
].join(', ');
const DONUT_SELECTOR = '.wp-nat-donut, .bs-donut';

// Dove si guarda qualcosa: la chiave di un numero ne include il titolo,
// così la Germania e l'Italia non si scambiano i valori di partenza.
const CONTEXTS = [
  ['#wp-country-panel', '.wp-panel-name'],
  ['#wp-nations-overlay', 'h2, h1'],
  ['#wp-mu-overlay', '.wp-mu-detail-name, h2, h1'],
  ['#wp-private-root', 'h2, h1'],
  ['#wp-political-root', '#wp-political-title, h1'],
];

const DURATION = 750;
// Grafici già visti in un giro precedente dell'osservatore. Solo la loro
// sparizione dice "aggiornamento sul posto": un grafico disegnato e subito
// ridisegnato alla misura giusta nello STESSO giro (candele dei Prezzi) è
// ancora un'apertura, e va animato.
const knownCharts = new WeakSet();
const memory = new Map();   // chiave → ultimo valore numerico
const written = new WeakMap(); // elemento → testo che abbiamo scritto noi

// ── Lettura e scrittura di un numero col formato della vista ──────────

const TOKEN = /[-+−]?\d[\d.,   ]*\d|[-+−]?\d/g;

/** Scompone "€ 1.234,5K" in prefisso, numero, suffisso e formato.
 *  null se non c'è esattamente un numero o se non è un valore da contare. */
function parse(text) {
  const s = text.trim();
  if (!s || s.startsWith('#') || /[:/]/.test(s)) return null;
  const tokens = s.match(TOKEN);
  if (!tokens || tokens.length !== 1) return null;
  const tok = tokens[0];
  const at = s.indexOf(tok);
  const body = tok.replace(/^[-+−]/, '');
  const neg = /^[-−]/.test(tok);
  const seps = body.match(/[.,   ]/g) || [];
  let dec = null; let group = null;
  const lastSep = seps.at(-1);
  if (seps.length) {
    const kinds = [...new Set(seps)];
    if (kinds.length > 1) { dec = lastSep; group = kinds.find(k => k !== dec); }
    else if (seps.length > 1) group = lastSep;
    else {
      // Un separatore solo: seguito da esattamente tre cifre è delle
      // migliaia (1.234), altrimenti è il decimale (12.5).
      const after = body.slice(body.lastIndexOf(lastSep) + 1);
      if (/[   ]/.test(lastSep) || after.length === 3) group = lastSep;
      else dec = lastSep;
    }
  }
  const decimals = dec ? body.length - body.lastIndexOf(dec) - 1 : 0;
  let n = body;
  if (group) n = n.split(group).join('');
  if (dec) n = n.replace(dec, '.');
  const value = Number(n) * (neg ? -1 : 1);
  if (!Number.isFinite(value)) return null;
  return {
    value, decimals, dec: dec || '.', group,
    sign: /^\+/.test(tok),
    prefix: s.slice(0, at), suffix: s.slice(at + tok.length),
  };
}

function format(v, f, { forceSign = false } = {}) {
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(f.decimals);
  let [int, frac] = fixed.split('.');
  if (f.group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, f.group);
  const num = frac ? `${int}${f.dec}${frac}` : int;
  const sign = neg ? '−' : (forceSign || f.sign) && v > 0 ? '+' : '';
  return `${sign}${num}`;
}

function contextOf(el) {
  for (const [root, title] of CONTEXTS) {
    const r = el.closest(root);
    if (r) return `${root}|${r.querySelector(title)?.textContent.trim() || ''}`;
  }
  return '';
}

function labelOf(el) {
  const prev = el.previousElementSibling;
  if (prev) return prev.textContent.trim();
  return el.parentElement?.firstElementChild?.textContent.trim() || '';
}

function keyOf(el) {
  return `${contextOf(el)}|${labelOf(el)}`;
}

/** Il solo nodo di testo del valore: con figli elemento non si tocca nulla. */
function textNodeOf(el) {
  if (el.childNodes.length !== 1 || el.firstChild.nodeType !== Node.TEXT_NODE) return null;
  return el.firstChild;
}

function write(el, node, text) {
  node.nodeValue = text;
  written.set(el, text);
}

function showDelta(el, diff, f) {
  el.parentElement?.querySelector(':scope > .wp-num-delta')?.remove();
  const b = document.createElement('span');
  b.className = `wp-num-delta ${diff > 0 ? 'up' : 'down'}`;
  b.textContent = `${format(diff, f, { forceSign: true })}${f.suffix.trim().match(/^[KMBkmb%]+/)?.[0] || ''}`;
  // Il badge è assoluto (non sposta niente): serve un genitore posizionato.
  const parent = el.parentElement;
  if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  el.insertAdjacentElement('afterend', b);
  setTimeout(() => b.remove(), 4200);
}

function animateNumber(el) {
  const node = textNodeOf(el);
  if (!node) return;
  const text = node.nodeValue;
  if (written.get(el) === text) return; // l'abbiamo scritto noi
  const f = parse(text);
  if (!f) return;
  const key = keyOf(el);
  const prev = memory.get(key);
  memory.set(key, f.value);
  if (prev === f.value) return;

  if (prev !== undefined) showDelta(el, f.value - prev, f);
  if (!animationsOn()) return;

  const from = prev ?? 0;
  const to = f.value;
  const start = performance.now();
  el.classList.add('wp-num-counting');
  const step = (now) => {
    // L'elemento è stato riscritto da altri (o è uscito dal documento):
    // si lascia stare, il testo nuovo è il loro.
    if (!el.isConnected || node.parentNode !== el || (written.has(el) && node.nodeValue !== written.get(el))) {
      el.classList.remove('wp-num-counting');
      return;
    }
    const k = Math.min(1, (now - start) / DURATION);
    const e = 1 - Math.pow(1 - k, 3);
    if (k < 1) {
      write(el, node, `${f.prefix}${format(from + (to - from) * e, f)}${f.suffix}`);
      requestAnimationFrame(step);
    } else {
      write(el, node, text); // il testo originale, esatto al carattere
      el.classList.remove('wp-num-counting');
    }
  };
  write(el, node, `${f.prefix}${format(from, f)}${f.suffix}`);
  requestAnimationFrame(step);
  // Rete di sicurezza: in una scheda nascosta requestAnimationFrame non
  // scatta, e il numero resterebbe a metà (o a zero). Allo scadere si
  // scrive comunque il valore vero, se nessun altro l'ha già riscritto.
  setTimeout(() => {
    if (el.isConnected && node.parentNode === el && node.nodeValue === written.get(el) && node.nodeValue !== text) {
      write(el, node, text);
      el.classList.remove('wp-num-counting');
    }
  }, DURATION + 250);
}

// ── Grafici ───────────────────────────────────────────────────────────

function classesOf(svg) {
  return String(svg.getAttribute('class') || '').split(/\s+/).filter(Boolean);
}

function revealChart(svg, replaced) {
  if (!animationsOn()) return;
  if (classesOf(svg).some(c => replaced.has(c))) return; // aggiornamento sul posto
  const cls = svg.matches(DONUT_SELECTOR) ? 'wp-draw-spin' : 'wp-draw-in';
  svg.classList.remove(cls);
  svg.classList.add(cls);
  svg.addEventListener('animationend', () => svg.classList.remove(cls), { once: true });
}

// ── L'osservatore ─────────────────────────────────────────────────────

function collect(node, selector, out) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.matches(selector)) out.add(node);
  node.querySelectorAll?.(selector).forEach(n => out.add(n));
}

function onMutations(records) {
  const nums = new Set();
  const charts = new Set();
  const replaced = new Set();
  for (const r of records) {
    if (r.type === 'characterData') {
      const el = r.target.parentElement;
      if (el?.matches(NUM_SELECTOR)) nums.add(el);
      continue;
    }
    if (r.target.nodeType === Node.ELEMENT_NODE && r.target.matches(NUM_SELECTOR)) nums.add(r.target);
    r.removedNodes.forEach(n => {
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const gone = new Set();
      collect(n, `${CHART_SELECTOR}, ${DONUT_SELECTOR}`, gone);
      gone.forEach(svg => { if (knownCharts.has(svg)) classesOf(svg).forEach(c => replaced.add(c)); });
    });
    r.addedNodes.forEach(n => {
      collect(n, NUM_SELECTOR, nums);
      collect(n, `${CHART_SELECTOR}, ${DONUT_SELECTOR}`, charts);
    });
  }
  nums.forEach(el => { if (el.isConnected) animateNumber(el); });
  charts.forEach(svg => {
    if (!svg.isConnected) return;
    knownCharts.add(svg);
    revealChart(svg, replaced);
  });
}

export function initReveal() {
  if (!document.body || initReveal._on) return;
  initReveal._on = true;
  new MutationObserver(onMutations).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });
}
