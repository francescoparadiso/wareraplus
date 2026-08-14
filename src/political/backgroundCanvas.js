/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: sfondo animato canvas (Fase 2, Stage 5)
   ------------------------------------------------------------------
   Conversione dell'IIFE inline a fine <body> di public/political/index.html
   (canvas#bgCanvas, particelle connesse). Comportamento invariato,
   solo avviata esplicitamente da src/political/main.js dopo il mount
   del template (Stage 8) invece che auto-eseguita al parse dello
   script inline. `initBackgroundCanvas()` è idempotente-safe da
   chiamare una sola volta per apertura: ogni chiamata avvia un nuovo
   requestAnimationFrame loop, quindi chi la richiama ripetutamente
   (es. riapertura della vista) deve fermare il loop precedente —
   `initBackgroundCanvas()` ritorna una funzione di cleanup per questo.

   WarEra+ perf (analisi CPU, vedi src/political/main.js:
   pausePoliticalRendering/resumePoliticalRendering): questo era il
   maggior consumatore di CPU dell'intera app. Due problemi distinti:
   1. `closePoliticalView()` (politicalOverlay.js) nascondeva l'overlay
      solo via CSS, senza mai chiamare la funzione di stop ritornata
      qui sotto — il loop restava quindi acceso PER SEMPRE dopo la
      prima apertura di Political View, anche tornati sulla mappa.
      Fix in main.js (pausePoliticalRendering/resumePoliticalRendering,
      chiamate da politicalOverlay.js su chiusura/riapertura).
   2. Ogni frame ricreava un `ctx.createRadialGradient(...)` NUOVO per
      OGNUNO dei 60 nodi (60 allocazioni + valutazioni gradiente/frame,
      60fps => ~3600/sec) solo per il "glow" — di gran lunga l'operazione
      più costosa del loop. Ora il glow è prerenderizzato UNA VOLTA per
      tema su un canvas offscreen (sprite) e ridisegnato con drawImage,
      molto più economico. Il lavoro pesante (update + connessioni +
      disegno) gira inoltre a ~30fps invece di 60 (impercettibile per
      particelle così lente) e si ferma del tutto quando `document.hidden`
      (tab in background/minimizzata).
   ══════════════════════════════════════════════════════════════ */

export function initBackgroundCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  let W, H, nodes = [], animId;
  const NODE_COUNT = 60;
  const MAX_DIST = 180;
  const GLOW_SPRITE_SIZE = 64;
  let stopped = false;
  let frameToggle = false;

  // ── Sprite del "glow" prerenderizzata (vedi nota perf in testa al file) ──
  let glowSprite = null;
  let glowSpriteIsLight = null;

  function buildGlowSprite(isLight) {
    const off = document.createElement('canvas');
    off.width = GLOW_SPRITE_SIZE;
    off.height = GLOW_SPRITE_SIZE;
    const octx = off.getContext('2d');
    const c = GLOW_SPRITE_SIZE / 2;
    const grad = octx.createRadialGradient(c, c, 0, c, c, c);
    const base = isLight ? '130,95,38' : '197,150,74';
    grad.addColorStop(0, `rgba(${base},0.75)`);
    grad.addColorStop(1, `rgba(${base},0)`);
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(c, c, c, 0, Math.PI * 2);
    octx.fill();
    return off;
  }

  function ensureGlowSprite(isLight) {
    if (!glowSprite || glowSpriteIsLight !== isLight) {
      glowSprite = buildGlowSprite(isLight);
      glowSpriteIsLight = isLight;
    }
    return glowSprite;
  }

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function init() {
    resize();
    nodes = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 2 + Math.random() * 2.5,
    }));
  }

  function getColor(alpha) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return isLight
      ? `rgba(130,95,38,${alpha})`
      : `rgba(197,150,74,${alpha})`;
  }

  function draw() {
    if (stopped) return;
    // ~30fps invece di 60: puramente ambientale, il dimezzamento è
    // impercettibile per nodi che si muovono a ±0.35px/frame.
    frameToggle = !frameToggle;
    // Niente lavoro mentre la tab non è visibile (minimizzata/altro tab in
    // foreground) — il loop resta "vivo" (RAF continua a essere richiesto,
    // i browser lo throttlano comunque da soli in background) ma non fa
    // nulla finché non si torna in foreground.
    if (frameToggle && !document.hidden) {
      ctx.clearRect(0, 0, W, H);
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const glow = ensureGlowSprite(isLight);
      // update
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      });
      // connections
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
            ctx.strokeStyle = getColor(a);
            ctx.lineWidth = 1.0;
            ctx.stroke();
          }
        }
      }
      // dots
      nodes.forEach(n => {
        // glow: sprite prerenderizzata invece di un gradiente nuovo per nodo
        const gr = n.r * 3;
        ctx.drawImage(glow, n.x - gr, n.y - gr, gr * 2, gr * 2);
        // core
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = getColor(0.9);
        ctx.fill();
      });
    }
    animId = requestAnimationFrame(draw);
  }

  const onResize = () => { resize(); };

  init();
  draw();
  window.addEventListener('resize', onResize);

  return function stop() {
    stopped = true;
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', onResize);
  };
}
