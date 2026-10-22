/* ══════════════════════════════════════════════════════════════
   WarEra+ — Tooltip comune dei grafici
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-22): «tutti i grafici del tool
   esplorabili: passandoci sopra col mouse mi diano le info che
   mostrano». Alcuni avevano già un loro tooltip (timeline battaglia,
   danno orario, candele, livelli…) e quelli restano com'erano. Gli altri
   erano muti, o avevano il solo <title> nativo dell'SVG: compare dopo
   un secondo di mouse fermo, senza stile, e su telefono mai.

   Un solo tooltip per tutta l'app, agganciato al documento:
     · qualunque elemento con `data-tip` lo mostra. Il testo è a righe
       (separate da "\n"): la prima è la testata in grassetto, le altre
       il contenuto; una riga "nome\tvalore" va in due colonne. È TESTO,
       mai HTML: si scappa tutto qui, chi scrive data-tip non deve
       pensarci (tipAttr lo prepara già scappato per l'attributo);
     · un elemento di un SVG con un <title> figlio è promosso al primo
       passaggio: il testo passa in data-tip e il <title> si toglie,
       altrimenti dopo un secondo comparirebbe anche quello nativo. Così
       i grafici che già scrivevano un <title> diventano esplorabili
       senza toccarli uno per uno.

   Mouse: segue il puntatore. Touch: un tocco su un elemento lo apre, un
   tocco altrove lo chiude. Costo: un listener passivo su pointermove che
   fa un closest() — sulla mappa (canvas) esce al primo controllo.
   ══════════════════════════════════════════════════════════════ */

let _tip = null;
let _current = null;

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Attributo pronto da mettere in un template: ` data-tip="…"`. Le righe
 *  vuote o nulle si saltano; "\t" divide nome e valore. */
export function tipAttr(...lines) {
  const txt = lines.flat().filter(l => l != null && l !== '').join('\n');
  return txt ? ` data-tip="${esc(txt).replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')}"` : '';
}

function render(txt) {
  const [head, ...rest] = String(txt).split('\n');
  const body = rest.map(l => {
    const [k, v] = l.split('\t');
    return v != null
      ? `<div class="wp-chart-tip-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`
      : `<div class="wp-chart-tip-row"><span>${esc(k)}</span></div>`;
  }).join('');
  return `<div class="wp-chart-tip-head">${esc(head)}</div>${body}`;
}

/** L'elemento sotto il puntatore che ha qualcosa da dire, o null. */
function targetOf(node) {
  if (!node || !node.closest) return null;
  const withTip = node.closest('[data-tip]');
  if (withTip) return withTip;
  // <title> nativo dentro un SVG: si promuove a data-tip una volta sola.
  if (!node.closest('svg')) return null;
  for (let el = node; el && el.tagName && el.tagName.toLowerCase() !== 'svg'; el = el.parentNode) {
    const title = Array.from(el.children || []).find(c => c.tagName && c.tagName.toLowerCase() === 'title');
    if (title) {
      el.setAttribute('data-tip', title.textContent.trim());
      title.remove();
      return el;
    }
  }
  return null;
}

function place(x, y) {
  const w = _tip.offsetWidth, h = _tip.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x + 14;
  if (left + w > vw - 6) left = x - 14 - w;
  let top = y - h - 12;
  if (top < 6) top = y + 18;
  _tip.style.transform = `translate(${Math.max(6, Math.min(vw - w - 6, left))}px, ${Math.max(6, Math.min(vh - h - 6, top))}px)`;
}

function show(el, x, y) {
  if (el !== _current) {
    const txt = el.getAttribute('data-tip');
    if (!txt) { hide(); return; }
    _tip.innerHTML = render(txt);
    _current?.classList?.remove('wp-tip-on');
    el.classList?.add('wp-tip-on');
    _current = el;
  }
  _tip.hidden = false;
  place(x, y);
}

function hide() {
  if (!_current && _tip?.hidden) return;
  _current?.classList?.remove('wp-tip-on');
  _current = null;
  if (_tip) _tip.hidden = true;
}

export function initChartTips() {
  if (_tip) return;
  _tip = document.createElement('div');
  _tip.className = 'wp-chart-tip';
  _tip.setAttribute('role', 'tooltip');
  _tip.hidden = true;
  document.body.appendChild(_tip);

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const el = targetOf(e.target);
    if (el) show(el, e.clientX, e.clientY); else hide();
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const el = targetOf(e.target);
    if (el) show(el, e.clientX, e.clientY); else hide();
  }, { passive: true });
  document.addEventListener('pointerleave', hide, { passive: true });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
}
