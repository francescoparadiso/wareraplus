/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: il grafico a candele
   ------------------------------------------------------------------
   SVG scritto a mano, come `src/market/priceChart.js` (da cui riusa
   `variazione`), `src/nations/charts.js` e le curve del danno: sono
   rettangoli e segmenti, e questa sezione non deve tirarsi dietro una
   libreria di grafici per disegnarli.

   ── PERCHÉ QUI LE CANDELE E LÀ NO ─────────────────────────────────
   `priceChart.js` disegna di proposito le sole CHIUSURE, e il motivo è
   scritto in testa: sta dentro una riga di tabella alta 88 pixel, dove
   un grafico a candele su novanta giorni è una macchia. Qui la domanda
   è un'altra e lo spazio pure — questa è la scheda che risponde a
   «com'è andato il pane questo mese», quindi massimo, minimo e corpo
   della giornata servono davvero. I due grafici restano separati per
   questa ragione, non per svista: non unificarli "per pulizia".

   ── ⚠️ UN GIORNO SENZA CANDELA È UN BUCO ──────────────────────────
   Non una candela piatta a zero, non l'ultimo prezzo ripetuto: niente.
   Lo spazio resta vuoto e la linea delle chiusure si spezza. Stessa
   regola del danno ora per ora (src/nations/damageCurves.js) e per lo
   stesso motivo: un archivio che non stava guardando non è un mercato
   a prezzo zero, e disegnarlo come tale inventa un crollo mai avvenuto.
   ══════════════════════════════════════════════════════════════ */

const PAD_L = 52, PAD_R = 8, PAD_T = 10, PAD_B = 22;

/** Un giorno 'YYYY-MM-DD' come numero di giorni dall'epoca: le candele
 *  vanno spaziate sul CALENDARIO, non sull'indice dell'array, o un buco
 *  di tre giorni si stringerebbe fino a sparire. */
function giornoNum(g) {
  return Math.round(Date.parse(`${g}T12:00:00Z`) / 86400000);
}

function fmtGiorno(g, lingua) {
  const d = new Date(`${g}T12:00:00Z`);
  return new Intl.DateTimeFormat(lingua, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

/**
 * @param {Array} serie righe [giorno, o, h, l, c, n] dal più vecchio.
 * @param {object} opts
 *   `w`/`h` dimensioni, `fmt` come si scrive un prezzo, `lingua` per le
 *   date, `mode` 'candles' | 'line'.
 * @returns {string} SVG, o '' se non c'è abbastanza per un grafico.
 */
export function candleChartSvg(serie, { w = 880, h = 320, fmt = (v) => String(v), lingua = 'it', mode = 'candles' } = {}) {
  if (!serie || serie.length < 2) return '';

  const x0 = PAD_L, x1 = w - PAD_R, y0 = PAD_T, y1 = h - PAD_B;
  const gio = serie.map(r => giornoNum(r[0]));
  const gMin = gio[0], gMax = gio[gio.length - 1];
  const arco = Math.max(1, gMax - gMin);

  let min = Infinity, max = -Infinity;
  for (const r of serie) {
    for (const v of [r[2], r[3], r[4]]) {
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  // Un margine sopra e sotto: una candela che tocca il bordo si legge
  // come "fuori scala" anche quando è solo il massimo del periodo.
  const span = (max - min) || Math.abs(max) || 1;
  min -= span * 0.06; max += span * 0.06;

  const X = (g) => x0 + ((g - gMin) / arco) * (x1 - x0);
  const Y = (v) => y1 - ((v - min) / (max - min)) * (y1 - y0);

  // ── griglia orizzontale: cinque livelli, etichettati a sinistra ──
  const livelli = 4;
  let griglia = '';
  for (let i = 0; i <= livelli; i++) {
    const v = min + ((max - min) * i) / livelli;
    const y = Y(v);
    griglia += `<line x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" class="wp-ecn-grid"/>`
      + `<text x="${x0 - 6}" y="${(y + 3.5).toFixed(1)}" class="wp-ecn-axis" text-anchor="end">${fmt(v)}</text>`;
  }

  // ── asse dei giorni: quattro date, non una per candela ──
  let assex = '';
  const passi = Math.min(4, serie.length - 1);
  for (let i = 0; i <= passi; i++) {
    const idx = Math.round((i / passi) * (serie.length - 1));
    const x = X(gio[idx]);
    assex += `<text x="${x.toFixed(1)}" y="${h - 6}" class="wp-ecn-axis" text-anchor="${
      i === 0 ? 'start' : i === passi ? 'end' : 'middle'}">${fmtGiorno(serie[idx][0], lingua)}</text>`;
  }

  let corpo = '';
  if (mode === 'line') {
    // Le chiusure. Un buco spezza la linea: `d` riparte con M.
    let d = '', staccato = true;
    serie.forEach((r, i) => {
      const c = r[4];
      if (!Number.isFinite(c)) { staccato = true; return; }
      // Due candele a più di un giorno di distanza sono un buco: si
      // stacca anche qui, altrimenti la linea lo attraverserebbe dritta
      // facendo sembrare misurato quello che non lo è.
      if (i > 0 && gio[i] - gio[i - 1] > 1) staccato = true;
      d += `${staccato ? 'M' : 'L'}${X(gio[i]).toFixed(1)},${Y(c).toFixed(1)}`;
      staccato = false;
    });
    corpo = `<path d="${d}" class="wp-ecn-line"/>`;
  } else {
    // Larghezza della candela: lo spazio disponibile diviso i giorni del
    // periodo, con un minimo di 1px e un massimo che eviti i mattoni.
    const largh = Math.max(1.5, Math.min(14, ((x1 - x0) / (arco + 1)) * 0.72));
    serie.forEach((r, i) => {
      const [, o, hi, lo, c] = r;
      if (!Number.isFinite(c)) return;
      const x = X(gio[i]);
      const su = Number.isFinite(o) ? c >= o : true;
      const cls = su ? 'wp-ecn-up' : 'wp-ecn-down';
      // L'ombra: massimo e minimo della giornata.
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        corpo += `<line x1="${x.toFixed(1)}" y1="${Y(hi).toFixed(1)}" x2="${x.toFixed(1)}" y2="${Y(lo).toFixed(1)}" class="wp-ecn-wick ${cls}"/>`;
      }
      // Il corpo: apertura→chiusura. Una candela "piatta" (o === c, cioè
      // un solo campione nella giornata) resta una riga sottile, non
      // sparisce: c'è stato un prezzo, e va visto.
      const yA = Y(Number.isFinite(o) ? o : c), yB = Y(c);
      const top = Math.min(yA, yB), alt = Math.max(1, Math.abs(yA - yB));
      corpo += `<rect x="${(x - largh / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${largh.toFixed(1)}" height="${alt.toFixed(1)}" class="wp-ecn-body ${cls}"/>`;
    });
  }

  return `<svg class="wp-ecn-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-hidden="true">
    ${griglia}${corpo}${assex}
  </svg>`;
}

/* ── Esplorare il grafico (WarEra+) ────────────────────────────────
   Segnalato: le candele si guardavano e basta. Ora:
   - al passaggio del mouse una guida verticale si aggancia alla candela
     più vicina e un riquadro dice giorno, apertura, massimo, minimo,
     chiusura, variazione dalla chiusura PRECEDENTE (con la sua data: dopo
     un buco "ieri" non è il giorno prima) e da quanti campioni è fatta;
   - un clic la FISSA, per leggerla con calma o confrontarla; un secondo
     clic (o Esc) la libera;
   - con il grafico a fuoco, ← → passano da una candela all'altra.
   La candela più vicina si trova dalla sola x del puntatore: l'SVG è
   stirato sulla larghezza (preserveAspectRatio="none"), quindi basta la
   stessa proporzione usata per disegnare, senza un rettangolo invisibile
   per candela. Guida e riquadro sono HTML sopra l'SVG, così non si
   deformano con lo stiramento. */
export function attachCandleExplorer(wrap, serie, { w = 880, h = 320, fmt = (v) => String(v), lingua = 'it', t = (k) => k } = {}) {
  const svg = wrap?.querySelector('.wp-ecn-chart');
  if (!svg || !serie || serie.length < 2) return;

  const x0 = PAD_L, x1 = w - PAD_R;
  const gio = serie.map(r => giornoNum(r[0]));
  const arco = Math.max(1, gio[gio.length - 1] - gio[0]);
  const X = (g) => x0 + ((g - gio[0]) / arco) * (x1 - x0);
  // Solo le candele con una chiusura: un buco non si esplora, non c'è niente.
  const valide = serie.map((r, i) => i).filter(i => Number.isFinite(serie[i][4]));
  if (!valide.length) return;

  const guida = document.createElement('div');
  guida.className = 'wp-ecn-guide';
  const tip = document.createElement('div');
  tip.className = 'wp-ecn-tip';
  wrap.append(guida, tip);
  wrap.tabIndex = 0;
  wrap.classList.add('wp-ecn-explorable');

  let fissata = null;   // indice in `valide`, o null
  let attuale = null;

  const dataLunga = (g) => new Intl.DateTimeFormat(lingua, {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${g}T12:00:00Z`));

  function contenuto(k) {
    const i = valide[k];
    const [g, o, hi, lo, c, n] = serie[i];
    const prec = k > 0 ? serie[valide[k - 1]] : null;
    let delta = '';
    if (prec && Number.isFinite(prec[4]) && prec[4] !== 0) {
      const pct = ((c - prec[4]) / prec[4]) * 100;
      const cls = pct > 0 ? 'wp-ecn-up' : pct < 0 ? 'wp-ecn-down' : '';
      const segno = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
      delta = `<div class="wp-ecn-tip-delta ${cls}">${segno} ${Math.abs(pct).toFixed(2)}% <span>${t('vsDay', { date: fmtGiorno(prec[0], lingua) })}</span></div>`;
    }
    const riga = (k2, v) => `<span>${t(k2)}</span><strong>${Number.isFinite(v) ? fmt(v) : '—'}</strong>`;
    return `
      <div class="wp-ecn-tip-day">${dataLunga(g)}</div>
      <div class="wp-ecn-tip-grid">${riga('open', o)}${riga('high', hi)}${riga('low', lo)}${riga('close', c)}</div>
      ${delta}
      ${Number.isFinite(n) ? `<div class="wp-ecn-tip-n">${n} ${t('samples')}</div>` : ''}`;
  }

  function mostra(k) {
    attuale = k;
    const sr = svg.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const px = sr.left - wr.left + (X(gio[valide[k]]) / w) * sr.width;
    guida.style.left = `${px}px`;
    guida.style.top = `${sr.top - wr.top + (PAD_T / h) * sr.height}px`;
    guida.style.height = `${((h - PAD_T - PAD_B) / h) * sr.height}px`;
    guida.classList.add('visible');
    tip.innerHTML = contenuto(k);
    tip.classList.toggle('pinned', fissata === k);
    // A destra della guida, o a sinistra se non ci sta.
    const tw = tip.offsetWidth || 180;
    const sinistra = px + 12 + tw > wr.width;
    tip.style.left = `${sinistra ? px - 12 - tw : px + 12}px`;
    tip.style.top = `${sr.top - wr.top + 8}px`;
    tip.classList.add('visible');
  }

  function nascondi() {
    if (fissata != null) { mostra(fissata); return; }
    attuale = null;
    guida.classList.remove('visible');
    tip.classList.remove('visible');
  }

  function piuVicina(clientX) {
    const sr = svg.getBoundingClientRect();
    const vx = ((clientX - sr.left) / sr.width) * w;
    if (vx < x0 - 12 || vx > x1 + 12) return null;
    let best = 0, dist = Infinity;
    valide.forEach((i, k) => { const d = Math.abs(X(gio[i]) - vx); if (d < dist) { dist = d; best = k; } });
    return best;
  }

  svg.addEventListener('pointermove', (e) => {
    if (fissata != null) return;
    const k = piuVicina(e.clientX);
    if (k == null) nascondi(); else mostra(k);
  });
  svg.addEventListener('pointerleave', nascondi);
  svg.addEventListener('click', (e) => {
    const k = piuVicina(e.clientX);
    if (k == null) return;
    fissata = fissata === k ? null : k;
    mostra(k);
    if (fissata == null) tip.classList.remove('pinned');
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fissata != null) { fissata = null; nascondi(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const da = fissata ?? attuale ?? (valide.length - 1);
    const k = Math.min(valide.length - 1, Math.max(0, da + (e.key === 'ArrowRight' ? 1 : -1)));
    // Con la tastiera la candela resta fissata: senza mouse non c'è un
    // "passaggio" da seguire.
    fissata = k;
    mostra(k);
  });
}
