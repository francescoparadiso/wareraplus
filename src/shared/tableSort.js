/* ══════════════════════════════════════════════════════════════
   WarEra+ — Colonne ordinabili in TUTTE le tabelle
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-13): «tutte le colonne di tutte le tabelle
   ordinabili: clicco su una colonna e si ordina per quella».

   Le tabelle del tool sono disegnate in molti modi (decine di viste, ognuna
   col suo innerHTML), quindi invece di toccarle una per una questo modulo le
   RICONOSCE dalla struttura, come fa shared/reveal.js coi numeri. Lo chiama
   l'osservatore di viewTools.js sui nodi appena comparsi.

   ── Cosa si riconosce ────────────────────────────────────────
   1. <table> con intestazione (thead, o prima riga di <th>);
   2. «tabelle a griglia»: un contenitore il cui PRIMO figlio è una riga di
      intestazione (classe che finisce in head/thead/hdr…) con almeno tre
      celle, seguita da almeno due righe con lo STESSO numero di celle.
      Righe che non rientrano (separatori, totali) restano dove sono.

   ── Cosa NON si tocca ────────────────────────────────────────
   · tabelle che hanno già un loro ordinamento: se un'intestazione contiene
     un pulsante, un link, un campo o un [data-sort] la tabella si lascia
     stare (elenco cittadini, panoramica nazioni…): due ordinamenti sulla
     stessa tabella si contraddirebbero a ogni ridisegno;
   · `data-nosort` sul contenitore (o su un antenato): per chi mostra solo
     una parte dell'elenco e ha il suo selettore (ordinare 15 righe già
     tagliate direbbe una cosa falsa);
   · righe con celle unite (colspan/rowspan).

   ── Come si legge una cella ─────────────────────────────────
   `data-sort` se c'è, poi <time datetime>, poi il testo. Una colonna è
   NUMERICA se almeno il 60% delle sue celle piene è un numero ("1.234",
   "12,5K", "3G", "45%", "#7", "−10.0K"): altrimenti si ordina come testo,
   con i numeri dentro le parole in ordine naturale. Le celle vuote o "—"
   vanno SEMPRE in fondo, in qualunque verso.

   ── Dopo un ridisegno ───────────────────────────────────────
   Chi ridisegna la vista butta via i nostri segni. La scelta si ricorda per
   (vista + intestazioni) e si riapplica alla tabella nuova: cambiare
   periodo o nazione non fa perdere l'ordine scelto.
   ══════════════════════════════════════════════════════════════ */

const HEAD_CLASS = /(^|[-_\s])(thead|head|hdr|header|colhead|cthead)$|(thead|hdr)$/i;
const INTERACTIVE = 'button, a, input, select, textarea, [data-sort], [role="button"], [onclick]';
const MIN_COLS = 3;

const state = new Map();            // chiave tabella → { col, dir }
const origin = new WeakMap();       // riga → posizione di partenza
const tables = new WeakMap();       // contenitore → { head, key }

/* ── Lettura dei valori ─────────────────────────────────────── */

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, g: 1e9, t: 1e12 };
const NUM = /^[#+\-−~≈]?\s*[$€£]?\s*(\d[\d.,\s  ]*)\s*([kmbgt]|%)?\s*(?:\/.*)?$/i;

/** "1.234,5" / "1,234.5" / "12,5K" / "−10.0K" → numero, o null. */
export function parseNumber(text) {
  const s = String(text).trim().replace(/−/g, '-');
  if (!s) return null;
  const m = s.match(NUM);
  if (!m) return null;
  let body = m[1].replace(/[\s  ]/g, '');
  const suf = (m[2] || '').toLowerCase();
  const hasSep = /[.,]/.test(body);
  if (hasSep) {
    const dots = (body.match(/\./g) || []).length;
    const commas = (body.match(/,/g) || []).length;
    if (dots && commas) {
      const dec = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
      body = body.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else {
      const sep = dots ? '.' : ',';
      const parts = body.split(sep);
      // Un solo separatore seguito da esattamente tre cifre, senza suffisso:
      // migliaia (1.234). Con suffisso (12,500K → no) o altrimenti: decimale.
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && !SUFFIX[suf])) body = parts.join('');
      else body = parts.join('.');
    }
  }
  let v = Number(body);
  if (!Number.isFinite(v)) return null;
  if (SUFFIX[suf]) v *= SUFFIX[suf];
  if (/^[-−]/.test(s)) v = -v;
  return v;
}

function cellValue(cell) {
  if (cell.dataset.sort != null && cell.dataset.sort !== '') return cell.dataset.sort;
  const t = cell.querySelector('time[datetime]');
  if (t) return t.getAttribute('datetime');
  // Senza i badge «+12K» che l'animazione dei numeri (reveal.js) appiccica
  // accanto a un valore: non fanno parte del dato.
  let txt = '';
  const walk = (n) => {
    for (const ch of n.childNodes) {
      if (ch.nodeType === 3) txt += ch.nodeValue;
      else if (ch.nodeType === 1 && !ch.classList.contains('wp-num-delta')) walk(ch);
    }
  };
  walk(cell);
  return txt.replace(/\s+/g, ' ').trim();
}

const EMPTY = /^(—|–|-|n\/a|n\.d\.|\?)?$/i;

function columnKind(values) {
  const full = values.filter(v => !EMPTY.test(v));
  if (!full.length) return 'text';
  const nums = full.filter(v => parseNumber(v) != null).length;
  if (nums / full.length >= 0.6) return 'num';
  if (full.every(v => /^\d{4}-\d{2}-\d{2}T/.test(v))) return 'date';
  return 'text';
}

/* ── Riconoscimento ─────────────────────────────────────────── */

function cellsOf(row) {
  return row.tagName === 'TR' ? [...row.cells] : [...row.children];
}

function hasMergedCells(cells) {
  return cells.some(c => c.colSpan > 1 || c.rowSpan > 1);
}

function interactive(headCells) {
  return headCells.some(c => c.matches(INTERACTIVE) || c.querySelector(INTERACTIVE));
}

function headerTexts(headCells) {
  return headCells.map(c => c.textContent.replace(/\s+/g, ' ').trim());
}

/** I contenitori-tabella dentro `root` (o `root` stesso). */
function findTables(root) {
  const out = [];

  // 1. <table> veri
  const real = root.matches?.('table') ? [root] : [];
  real.push(...root.querySelectorAll?.('table') || []);
  for (const t of real) {
    const headRow = t.tHead?.rows[0]
      || (t.rows[0] && [...t.rows[0].cells].every(c => c.tagName === 'TH') ? t.rows[0] : null);
    if (!headRow) continue;
    const body = t.tBodies[0];
    if (!body) continue;
    const headCells = [...headRow.cells];
    if (headCells.length < 2 || hasMergedCells(headCells)) continue;
    const rows = [...body.rows].filter(r => r !== headRow);
    if (rows.length < 2) continue;
    if (rows.some(r => r.cells.length !== headCells.length || hasMergedCells([...r.cells]))) continue;
    out.push({ container: body, headEl: headRow, headCells, rows: () => [...body.rows].filter(r => r !== headRow), real: true, host: t });
  }

  // 2. tabelle a griglia: il primo figlio è la riga di intestazione
  const cands = root.matches?.('[class*="head"], [class*="hdr"]') ? [root] : [];
  cands.push(...root.querySelectorAll?.('[class*="head"], [class*="hdr"]') || []);
  for (const h of cands) {
    const parent = h.parentElement;
    if (!parent || parent.tagName === 'THEAD' || parent.tagName === 'TABLE') continue;
    if (/^H[1-6]$/.test(h.tagName) || parent.firstElementChild !== h) continue;
    if (![...h.classList].some(c => HEAD_CLASS.test(c))) continue;
    const headCells = [...h.children];
    if (headCells.length < MIN_COLS) continue;
    const n = headCells.length;
    const rows = [...parent.children].filter(r => r !== h && r.children.length === n);
    if (rows.length < 2) continue;
    // La maggior parte dei fratelli deve avere la stessa forma: altrimenti
    // è un riquadro con un'intestazione, non una tabella.
    if (rows.length < (parent.children.length - 1) * 0.6) continue;
    if (!headCells.some(c => c.textContent.trim())) continue;
    out.push({ container: parent, headEl: h, headCells, rows: () => [...parent.children].filter(r => r !== h && r.children.length === n), real: false, host: parent });
  }
  return out;
}

function optedOut(el) {
  return !!el.closest('[data-nosort]');
}

function keyFor(host, headCells) {
  const view = host.closest('[id$="-overlay"], #wp-country-panel, #wp-political-root')?.id || '';
  return `${view}|${headerTexts(headCells).join('|')}`;
}

/* ── Ordinamento ────────────────────────────────────────────── */

function sortBy(tab, col, dir) {
  const rows = tab.rows();
  rows.forEach((r, i) => { if (!origin.has(r)) origin.set(r, i); });
  const values = rows.map(r => cellValue(cellsOf(r)[col]));
  const kind = columnKind(values);
  const cmpText = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const keyed = rows.map((r, i) => {
    const raw = values[i];
    const empty = EMPTY.test(raw);
    let k = raw;
    if (kind === 'num') k = parseNumber(raw);
    else if (kind === 'date') k = Date.parse(raw);
    return { r, k, empty: empty || (kind !== 'text' && (k == null || Number.isNaN(k))), i: origin.get(r) };
  });
  keyed.sort((a, b) => {
    if (a.empty !== b.empty) return a.empty ? 1 : -1;     // vuoti sempre in fondo
    if (a.empty) return a.i - b.i;
    const c = kind === 'text' ? cmpText.compare(a.k, b.k) : a.k - b.k;
    return (c * dir) || (a.i - b.i);
  });

  // Solo le posizioni delle righe riconosciute cambiano: gli altri figli
  // (separatori, totali) restano dove erano.
  const parent = tab.container;
  const kids = [...parent.children];
  const slots = [];
  kids.forEach((el, i) => { if (rows.includes(el)) slots.push(i); });
  const order = kids.slice();
  slots.forEach((slot, j) => { order[slot] = keyed[j].r; });
  const frag = document.createDocumentFragment();
  for (const el of order) frag.appendChild(el);
  parent.appendChild(frag);
  return kind;
}

function mark(tab, col, dir) {
  tab.headCells.forEach((c, i) => {
    if (i === col) c.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
    else c.removeAttribute('aria-sort');
  });
}

function activate(tab, col, kind) {
  const key = tab.key;
  const prev = state.get(key);
  // Primo clic: il verso «naturale» — il più grande in alto per i numeri,
  // A→Z per il testo. Secondo clic sulla stessa colonna: inverte.
  const natural = kind === 'text' ? 1 : -1;
  const dir = prev && prev.col === col ? -prev.dir : natural;
  state.set(key, { col, dir });
  sortBy(tab, col, dir);
  mark(tab, col, dir);
}

/* ── Aggancio ───────────────────────────────────────────────── */

/** Da chiamare con ogni nodo comparso. Idempotente: una tabella già
 *  agganciata si salta. `quiet` serve all'osservatore per ignorare le
 *  mutazioni che questo modulo stesso provoca riordinando le righe. */
export function enhanceTables(root, quiet) {
  if (!root || root.nodeType !== 1) return;
  for (const tab of findTables(root)) {
    if (tables.has(tab.container) || optedOut(tab.host)) continue;
    if (interactive(tab.headCells)) continue;
    tab.key = keyFor(tab.host, tab.headCells);
    tables.set(tab.container, tab);

    tab.headCells.forEach((cell, col) => {
      if (!cell.textContent.trim()) return;       // colonna senza titolo: avatar, icona
      cell.classList.add('wp-sort-h');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'columnheader');
    });

    const handler = (e) => {
      const cell = e.target.closest?.('.wp-sort-h');
      if (!cell || !tab.headCells.includes(cell)) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const col = tab.headCells.indexOf(cell);
      const kind = columnKind(tab.rows().map(r => cellValue(cellsOf(r)[col])));
      quiet(() => activate(tab, col, kind));
    };
    tab.headEl.addEventListener('click', handler);
    tab.headEl.addEventListener('keydown', handler);

    // Ridisegno: si riapplica la scelta di prima.
    const prev = state.get(tab.key);
    if (prev && prev.col < tab.headCells.length) {
      quiet(() => {
        const kind = sortBy(tab, prev.col, prev.dir);
        void kind;
        mark(tab, prev.col, prev.dir);
      });
    }
  }
}
