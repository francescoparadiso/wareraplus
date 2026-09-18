/* ══════════════════════════════════════════════════════════════
   WarEra+ — Rendite di produzione: l'andamento del prezzo
   ------------------------------------------------------------------
   SVG scritto a mano, come i grafici di Statistiche nazioni e la fascia
   a ciambelle di Statistiche alleanze: sono una linea e un'area, e questa
   vista non deve tirarsi dietro una libreria di grafici.

   Disegna le CHIUSURE, non le candele intere. Le candele ci sono (massimo
   e minimo arrivano dal server) e servono alla banda grigia dietro la
   linea — ma un grafico a candele su novanta giorni dentro una riga di
   tabella è illeggibile, e la domanda a cui questa vista risponde non è
   "com'è andata martedì": è "sta salendo o sta scendendo, e da quanto".

   ⚠️ Un giorno senza candela è un BUCO, non uno zero: la linea si spezza.
   Stessa regola del danno ora per ora (src/nations/damageCurves.js) e per
   lo stesso motivo — un archivio che non stava guardando non è un mercato
   a prezzo zero, e disegnarlo come tale inventa un crollo che non c'è
   stato.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../mu/ui.js';

const W = 320, H = 88, PAD_T = 6, PAD_B = 14, PAD_X = 2;

/** La variazione percentuale fra la chiusura di `giorni` fa e l'ultima.
 *  `null` quando l'archivio non arriva così indietro: la vista lo lascia
 *  in bianco invece di misurare da dove capita. */
export function variazione(serie, giorni) {
  if (!serie || serie.length < 2) return null;
  const ultimo = serie[serie.length - 1];
  const bersaglio = new Date(`${ultimo[0]}T12:00:00Z`);
  bersaglio.setUTCDate(bersaglio.getUTCDate() - giorni);
  const giorno = bersaglio.toISOString().slice(0, 10);
  // La prima candela a partire da quel giorno: se manca esattamente
  // quella (un buco) si usa la successiva, che è ancora una risposta
  // onesta alla domanda "rispetto a un mese fa".
  const prima = serie.find(r => r[0] >= giorno);
  if (!prima || prima === ultimo) return null;
  const da = prima[4], a = ultimo[4];
  if (!da || !Number.isFinite(da) || !Number.isFinite(a)) return null;
  return ((a - da) / da) * 100;
}

/**
 * Il grafico. `serie` = righe [giorno, o, h, l, c, n] dal più vecchio.
 * Ritorna '' se non c'è abbastanza per una linea: chi chiama decide cosa
 * scrivere al posto suo.
 */
export function priceChartSvg(serie, { fmt = (v) => String(v) } = {}) {
  if (!serie || serie.length < 2) return '';

  const giorni = serie.map(r => r[0]);
  const primo = Date.parse(`${giorni[0]}T12:00:00Z`);
  const ultimo = Date.parse(`${giorni[giorni.length - 1]}T12:00:00Z`);
  const arco = Math.max(1, ultimo - primo);

  let min = Infinity, max = -Infinity;
  for (const r of serie) {
    if (Number.isFinite(r[3])) min = Math.min(min, r[3]);
    if (Number.isFinite(r[2])) max = Math.max(max, r[2]);
    if (Number.isFinite(r[4])) { min = Math.min(min, r[4]); max = Math.max(max, r[4]); }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  // Tutto piatto: una banda di zero altezza dividerebbe per zero e
  // disegnerebbe la linea sul bordo. Si allarga di un filo.
  if (max - min < 1e-9) { max = max * 1.05 || 1; min = min * 0.95; }

  const x = (giorno) => PAD_X + ((Date.parse(`${giorno}T12:00:00Z`) - primo) / arco) * (W - PAD_X * 2);
  const y = (v) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B);

  // Il tratto si spezza dove manca un giorno: `M` invece di `L` dopo un
  // buco. La soglia è due giorni — uno solo capita, e una linea tratteggiata
  // ad ogni campione saltato sarebbe illeggibile.
  const linea = [];
  const banda = [];
  let precedente = null;
  for (const r of serie) {
    const gx = x(r[0]);
    const salto = precedente && (Date.parse(`${r[0]}T12:00:00Z`) - Date.parse(`${precedente}T12:00:00Z`)) > 2.5 * 86400_000;
    linea.push(`${(!precedente || salto) ? 'M' : 'L'}${gx.toFixed(1)},${y(r[4]).toFixed(1)}`);
    if (Number.isFinite(r[2]) && Number.isFinite(r[3])) {
      banda.push({ gx, alto: y(r[2]), basso: y(r[3]), salto: !precedente || salto });
    }
    precedente = r[0];
  }

  // La banda massimo/minimo: un poligono per ogni tratto continuo.
  const bande = [];
  let corrente = [];
  for (const p of banda) {
    if (p.salto && corrente.length) { bande.push(corrente); corrente = []; }
    corrente.push(p);
  }
  if (corrente.length) bande.push(corrente);
  const areaPath = bande.filter(b => b.length > 1).map((b) => {
    const su = b.map(p => `${p.gx.toFixed(1)},${p.alto.toFixed(1)}`).join(' ');
    const giu = [...b].reverse().map(p => `${p.gx.toFixed(1)},${p.basso.toFixed(1)}`).join(' ');
    return `<polygon points="${su} ${giu}" class="wp-mkt-band"/>`;
  }).join('');

  const ultimaChiusura = serie[serie.length - 1][4];
  const etichetteX = [giorni[0], giorni[giorni.length - 1]];

  return `
    <svg class="wp-mkt-chart" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="${escapeHtml(`${fmt(min)} – ${fmt(max)}`)}">
      ${areaPath}
      <path d="${linea.join('')}" class="wp-mkt-line"/>
      <circle cx="${x(giorni[giorni.length - 1]).toFixed(1)}" cy="${y(ultimaChiusura).toFixed(1)}" r="2.5" class="wp-mkt-dot"/>
      <text x="${PAD_X}" y="${(PAD_T + 7).toFixed(0)}" class="wp-mkt-clab">${escapeHtml(fmt(max))}</text>
      <text x="${PAD_X}" y="${(H - PAD_B + 2).toFixed(0)}" class="wp-mkt-clab">${escapeHtml(fmt(min))}</text>
      <text x="${PAD_X}" y="${H - 2}" class="wp-mkt-clab wp-mkt-cday">${escapeHtml(etichetteX[0])}</text>
      <text x="${W - PAD_X}" y="${H - 2}" class="wp-mkt-clab wp-mkt-cday" text-anchor="end">${escapeHtml(etichetteX[1])}</text>
    </svg>`;
}
