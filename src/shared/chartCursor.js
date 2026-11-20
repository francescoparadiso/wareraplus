/* ══════════════════════════════════════════════════════════════
   WarEra+ — Cursore comune dei grafici
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-20): «quando passo col mouse devo poter
   vedere graficamente dove punto», ovunque. Il tooltip comune
   (chartTip.js) diceva COSA c'era sotto il puntatore ma non DOVE: al più
   una fascia chiara sulla colonna, che su un grafico a linea lascia a
   indovinare quale punto della linea si sta leggendo.

   Questo modulo disegna, sulla colonna puntata di qualunque grafico SVG
   costruito a colonne invisibili:
     · una linea verticale tratteggiata al centro della colonna;
     · un punto su ogni LINEA del grafico all'altezza di quella colonna,
       del colore della linea.
   Senza che i grafici lo sappiano: riconosce le colonne dalla struttura,
   come viewTools.js riconosce tabelle e sezioni.

   ── COSA È UNA COLONNA ─────────────────────────────────────────────
   Un <rect> dentro un <svg> che sia:
     · `.wp-tip-hit` (la convenzione del tooltip comune), o una delle
       colonne dei grafici col tooltip proprio (`.bs-cv-hit` delle curve
       dei blocchi, `.wp-nat-lv-hit` di danno/livelli in Statistiche
       nazioni), oppure
     · trasparente, con un tooltip (data-tip o <title>), e alto almeno
       il 40% del grafico — le colonne scritte prima della convenzione.
   Le barre VISIBILI non hanno cursore: si illuminano già da sole
   (shell.css, `[data-tip].wp-tip-on`) e una linea in mezzo a una barra
   non aggiunge niente. Restano fuori i grafici che il cursore se lo
   disegnano da sé (battaglie, membri dei partiti, stile di gioco nel
   tempo, candele, 1 vs 1 unità, La mia nazione): non usano queste
   colonne, quindi qui non passano.

   ── COME TROVA IL PUNTO SU UNA LINEA ───────────────────────────────
   Ogni <path>/<polyline> col tratto e senza riempimento (le aree hanno
   il riempimento, le linee no) che attraversa il grafico per almeno un
   quinto della sua larghezza. Ricerca binaria sulla lunghezza del
   tracciato finché la x coincide con quella della colonna: funziona
   perché le linee dei grafici nel tempo vanno da sinistra a destra. Se
   la x trovata è lontana (la linea ha un buco lì, o non è una linea nel
   tempo) il punto non si disegna: meglio nessun punto che uno falso.

   ⚠️ Molti grafici sono `preserveAspectRatio="none"`: un <circle> lì
   diventa un'ellisse. Il punto è quindi una linea di lunghezza zero con
   l'estremo tondo e il tratto non scalato, che resta un cerchio di
   pixel veri a qualunque proporzione.

   Mouse: segue il puntatore. Touch: un tocco su una colonna la accende,
   un tocco altrove la spegne — stesse regole del tooltip comune.
   ══════════════════════════════════════════════════════════════ */

const NS = 'http://www.w3.org/2000/svg';
const COLONNE = 'rect.wp-tip-hit, rect.bs-cv-hit, rect.wp-nat-lv-hit';
// Grafici che il cursore lo disegnano già da sé, con colonne di questo tipo.
const PROPRIO = '.wp-crf-hcol, .wp-nat-cur-col, [data-own-cursor]';
const MAX_PUNTI = 8;

let _col = null;     // la colonna accesa
let _g = null;       // il gruppo del cursore dentro il suo svg

function trasparente(el) {
  const cs = getComputedStyle(el);
  if (cs.fill === 'none' || cs.fill === 'transparent') return true;
  if (/rgba\([^)]*,\s*0\)$/.test(cs.fill)) return true;
  return Number(cs.fillOpacity) === 0;
}

/** Il viewBox (o le dimensioni) dell'svg in unità utente. */
function quadro(svg) {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width && vb.height) return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  const r = svg.getBoundingClientRect();
  return { x: 0, y: 0, w: r.width || 1, h: r.height || 1 };
}

function colonnaDi(target) {
  const rect = target?.closest?.('rect');
  if (!rect || !(rect.ownerSVGElement)) return null;
  if (rect.closest(PROPRIO)) return null;
  if (rect.matches(COLONNE)) return rect;
  const conTip = rect.hasAttribute('data-tip') || Array.from(rect.children).some(c => c.tagName?.toLowerCase() === 'title');
  if (!conTip || !trasparente(rect)) return null;
  const h = rect.height?.baseVal?.value || 0;
  return h >= quadro(rect.ownerSVGElement).h * 0.4 ? rect : null;
}

/** Matrice che porta le coordinate di `el` in quelle dell'svg radice. */
function versoRadice(el, svg) {
  try {
    const a = svg.getScreenCTM(), b = el.getScreenCTM();
    if (a && b) return a.inverse().multiply(b);
  } catch (_) { /* svg non ancora in pagina */ }
  return null;
}

const punto = (m, x, y) => {
  const p = new DOMPoint(x, y);
  return m ? p.matrixTransform(m) : p;
};

/** La y (in coordinate radice) di una linea alla x radice `cx`, o null. */
function yDellaLinea(path, svg, cx, tol) {
  let tot;
  try { tot = path.getTotalLength(); } catch (_) { return null; }
  if (!tot) return null;
  const m = versoRadice(path, svg);
  const at = (l) => { const q = path.getPointAtLength(l); return punto(m, q.x, q.y); };
  const a = at(0), b = at(tot);
  if (!(b.x > a.x)) return null;                       // non va da sinistra a destra
  if (cx < a.x - tol || cx > b.x + tol) return null;   // la linea non arriva lì
  let lo = 0, hi = tot, p = a;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    p = at(mid);
    if (p.x < cx) lo = mid; else hi = mid;
  }
  return Math.abs(p.x - cx) <= tol ? p.y : null;
}

function linee(svg, q) {
  const out = [];
  for (const el of svg.querySelectorAll('path, polyline')) {
    if (el.closest('.wp-chart-cursor, defs, clipPath, mask, marker')) continue;
    if (/grid|axis|guide|spk-cost|cursor|hair/i.test(el.getAttribute('class') || '')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if (!cs.stroke || cs.stroke === 'none' || parseFloat(cs.strokeWidth) === 0) continue;
    if (!trasparente(el)) continue;                    // un'area, non una linea
    let bb;
    try { bb = el.getBBox(); } catch (_) { continue; }
    if (bb.width < q.w * 0.2) continue;                // un segno, non una serie
    out.push({ el, colore: cs.stroke });
    if (out.length >= MAX_PUNTI * 2) break;
  }
  return out;
}

function spegni() {
  _g?.remove();
  _g = null;
  _col = null;
}

function accendi(col) {
  if (col === _col && _g?.isConnected) return;
  spegni();
  const svg = col.ownerSVGElement;
  if (!svg) return;
  const q = quadro(svg);
  const m = versoRadice(col, svg);
  const x = col.x.baseVal.value, y = col.y.baseVal.value;
  const w = col.width.baseVal.value, h = col.height.baseVal.value;
  const p0 = punto(m, x + w / 2, y), p1 = punto(m, x + w / 2, y + h);
  const cx = p0.x;
  // Tolleranza: mezza colonna, almeno l'1% del grafico.
  const tol = Math.max(w / 2, q.w * 0.01);

  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'wp-chart-cursor');
  g.setAttribute('aria-hidden', 'true');
  const ln = document.createElementNS(NS, 'line');
  ln.setAttribute('class', 'wp-chart-cursor-line');
  ln.setAttribute('x1', cx); ln.setAttribute('x2', cx);
  ln.setAttribute('y1', p0.y); ln.setAttribute('y2', p1.y);
  ln.setAttribute('vector-effect', 'non-scaling-stroke');
  g.appendChild(ln);

  let n = 0;
  for (const { el, colore } of linee(svg, q)) {
    if (n >= MAX_PUNTI) break;
    const py = yDellaLinea(el, svg, cx, tol);
    if (py == null) continue;
    for (const [cls, col2] of [['wp-chart-cursor-ring', null], ['wp-chart-cursor-dot', colore]]) {
      const d = document.createElementNS(NS, 'line');
      d.setAttribute('class', cls);
      d.setAttribute('x1', cx); d.setAttribute('x2', cx);
      d.setAttribute('y1', py); d.setAttribute('y2', py);
      d.setAttribute('vector-effect', 'non-scaling-stroke');
      if (col2) d.style.stroke = col2;
      g.appendChild(d);
    }
    n++;
  }
  svg.appendChild(g);
  _g = g;
  _col = col;
}

let _init = false;
export function initChartCursor() {
  if (_init) return;
  _init = true;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const col = colonnaDi(e.target);
    if (col) accendi(col); else if (_col) spegni();
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const col = colonnaDi(e.target);
    if (col) accendi(col); else if (_col) spegni();
  }, { passive: true });
  window.addEventListener('blur', () => { if (_col) spegni(); });
}

/**
 * Lo stesso cursore per i grafici Chart.js (Political: seggi nel tempo,
 * affluenza delle presidenziali): una linea verticale tratteggiata sul
 * punto attivo del tooltip. I punti li ingrandisce già Chart.js.
 * Da passare in `plugins: [chartJsCursor]` della configurazione.
 */
export const chartJsCursor = {
  id: 'wpCursor',
  afterDatasetsDraw(chart) {
    const attivi = chart.tooltip?.getActiveElements?.() || [];
    if (!attivi.length) return;
    const x = attivi[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = document.body.classList.contains('light-theme') ? 'rgba(36,41,47,.7)' : 'rgba(230,237,243,.7)';
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};
