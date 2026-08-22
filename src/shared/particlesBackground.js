/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sfondo animato a particelle, condiviso dagli overlay
   ------------------------------------------------------------------
   Generalizzazione di src/political/backgroundCanvas.js (che ora è un
   sottile wrapper su questo file): stessi nodi connessi da linee, ma
   canvas e colore passati dal chiamante, così ogni sezione di
   "Approfondimenti" ha lo stesso sfondo nella propria tinta —
   Political oro, Eco verde, Unità Militari blu, News rosso.

   Tutte le ottimizzazioni nate sul canvas di Political sono conservate
   qui (erano la voce di CPU più pesante dell'app, vedi la nota storica
   in src/political/backgroundCanvas.js):
     · glow prerenderizzato UNA volta per tema su un canvas offscreen e
       ridisegnato con drawImage — non un createRadialGradient nuovo per
       nodo per frame (erano ~3600 gradienti/sec);
     · lavoro pesante a ~30fps invece di 60 (impercettibile per nodi che
       si muovono a ±0.35px/frame);
     · nessun lavoro mentre `document.hidden`;
     · `stop()` ritornata al chiamante, che DEVE chiamarla alla chiusura
       dell'overlay — altrimenti il loop resta acceso per sempre sotto
       una vista che nessuno guarda.

   Il canvas è dimensionato sul suo box (getBoundingClientRect), non su
   window: negli overlay sta sotto la topbar, quindi non occupa tutta la
   finestra.
   ══════════════════════════════════════════════════════════════ */

const GLOW_SPRITE_SIZE = 64;
// Ogni sezione ha DUE tinte, non una: ogni nodo nasce con la sua
// posizione `t` fissa sulla rampa fra le due, e le linee prendono la
// media dei due nodi che collegano. Il glow però è una sprite
// prerenderizzata (era l'ottimizzazione che ha tolto ~3600 gradienti/sec
// dal thread principale): non se ne può fare una per ogni `t` continuo,
// quindi la rampa è quantizzata in questo numero di gradini — a occhio
// indistinguibile dal continuo, ma sono 6 sprite per tema in tutto.
const GLOW_STEPS = 6;

function parseRgb(str) {
  const [r, g, b] = String(str).split(',').map(n => parseFloat(n) || 0);
  return [r, g, b];
}

/** Mescola due "r,g,b" con fattore t ∈ [0,1]. */
function mixRgb(a, b, t) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)).join(',');
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {string} [opts.rgbDark]   - prima tinta sul tema scuro, "r,g,b"
 * @param {string} [opts.rgbDark2]  - seconda tinta sul tema scuro (default: la prima)
 * @param {string} [opts.rgbLight]  - prima tinta sul tema chiaro
 * @param {string} [opts.rgbLight2] - seconda tinta sul tema chiaro
 * @param {() => boolean} [opts.isLight] - come stabilire il tema attivo
 * @param {number} [opts.count]     - numero di nodi
 * @param {number} [opts.maxDist]   - distanza massima per tracciare una linea
 * @returns {() => void} stop
 */
export function startParticles(canvas, opts = {}) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  // Le due estremità della rampa, per tema. Se la seconda manca si ricade
  // sul comportamento a tinta unica di prima.
  const rampDark = [parseRgb(opts.rgbDark || '197,150,74'),
                    parseRgb(opts.rgbDark2 || opts.rgbDark || '197,150,74')];
  const rampLight = [parseRgb(opts.rgbLight || '130,95,38'),
                     parseRgb(opts.rgbLight2 || opts.rgbLight || '130,95,38')];
  const NODE_COUNT = opts.count || 60;
  const MAX_DIST = opts.maxDist || 180;
  // Default: il tema chiaro dello shell è `body.light-theme`, quello di
  // Political è l'attributo data-theme sull'<html> — accettiamo entrambi,
  // così lo stesso modulo va bene in tutti e due i contesti.
  const isLightFn = opts.isLight || (() =>
    document.body.classList.contains('light-theme') ||
    document.documentElement.getAttribute('data-theme') === 'light');

  let W, H, nodes = [], animId;
  let stopped = false;
  let frameToggle = false;
  let glowSprites = null;          // una per gradino della rampa
  let glowSpritesAreLight = null;

  function buildGlowSprite(rgb) {
    const off = document.createElement('canvas');
    off.width = GLOW_SPRITE_SIZE;
    off.height = GLOW_SPRITE_SIZE;
    const octx = off.getContext('2d');
    const c = GLOW_SPRITE_SIZE / 2;
    const grad = octx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, `rgba(${rgb},0.75)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(c, c, c, 0, Math.PI * 2);
    octx.fill();
    return off;
  }

  function ensureGlowSprites(isLight) {
    if (!glowSprites || glowSpritesAreLight !== isLight) {
      const ramp = isLight ? rampLight : rampDark;
      glowSprites = Array.from({ length: GLOW_STEPS }, (_, i) =>
        buildGlowSprite(mixRgb(ramp[0], ramp[1], i / (GLOW_STEPS - 1))));
      glowSpritesAreLight = isLight;
    }
    return glowSprites;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    // Fallback a window: se l'overlay è ancora display:none al momento
    // dell'avvio il box misura 0x0 e non si vedrebbe nulla.
    W = canvas.width = Math.max(1, Math.round(r.width) || window.innerWidth);
    H = canvas.height = Math.max(1, Math.round(r.height) || window.innerHeight);
  }

  function init() {
    resize();
    nodes = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 2 + Math.random() * 2.5,
      // Posizione fissa sulla rampa fra le due tinte della sezione: i
      // nodi restano riconoscibili individualmente invece di pulsare.
      t: Math.random(),
    }));
  }

  function color(alpha, isLight, t) {
    const ramp = isLight ? rampLight : rampDark;
    return `rgba(${mixRgb(ramp[0], ramp[1], t)},${alpha})`;
  }

  function draw() {
    if (stopped) return;
    frameToggle = !frameToggle;
    if (frameToggle && !document.hidden) {
      ctx.clearRect(0, 0, W, H);
      const isLight = isLightFn();
      const glows = ensureGlowSprites(isLight);
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      });
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const a = (1 - dist / MAX_DIST) * 0.65;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            // La linea prende la media delle due tinte che collega: è
            // quello che fa "sfumare" il campo invece di lasciare due
            // gruppi di pallini di colore diverso.
            ctx.strokeStyle = color(a, isLight, (nodes[i].t + nodes[j].t) / 2);
            ctx.lineWidth = 1.0;
            ctx.stroke();
          }
        }
      }
      nodes.forEach(n => {
        const gr = n.r * 3;
        const sprite = glows[Math.round(n.t * (GLOW_STEPS - 1))];
        ctx.drawImage(sprite, n.x - gr, n.y - gr, gr * 2, gr * 2);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = color(0.9, isLight, n.t);
        ctx.fill();
      });
    }
    animId = requestAnimationFrame(draw);
  }

  const onResize = () => {
    const oldW = W, oldH = H;
    resize();
    // Riposiziona i nodi in proporzione invece di lasciarli fuori campo
    // quando la finestra si rimpicciolisce.
    if (oldW && oldH) {
      nodes.forEach(n => { n.x = n.x / oldW * W; n.y = n.y / oldH * H; });
    }
  };

  init();
  draw();
  window.addEventListener('resize', onResize);

  return function stop() {
    stopped = true;
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', onResize);
  };
}
