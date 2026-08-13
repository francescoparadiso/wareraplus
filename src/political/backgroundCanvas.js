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
   ══════════════════════════════════════════════════════════════ */

export function initBackgroundCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  let W, H, nodes = [], animId;
  const NODE_COUNT = 60;
  const MAX_DIST = 180;
  let stopped = false;

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
    ctx.clearRect(0, 0, W, H);
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
      // glow
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3);
      grad.addColorStop(0, getColor(0.75));
      grad.addColorStop(1, getColor(0));
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // core
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = getColor(0.9);
      ctx.fill();
    });
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
