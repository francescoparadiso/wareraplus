/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: livelli × stile di gioco
   ------------------------------------------------------------------
   La scheda nazione diceva GIÀ quanti giocatori stanno sulla guerra e
   quanti sull'economia (la ciambella in cima), ma non a che punto della
   crescita stanno: una nazione con 200 economisti tutti sotto il livello
   10 e una con 200 economisti oltre il 40 hanno la stessa ciambella e non
   sono la stessa nazione. Qui i due dati si incrociano: una colonna per
   fascia di livello, dentro la colonna la ripartizione per stile.

   ZERO RICHIESTE NUOVE per la nazione aperta: `lv` e `ps` arrivano già
   dentro le righe di /country-citizens che la scheda ha scaricato per
   l'elenco cittadini (vedi src/nations/api.js). Il confronto con altre
   nazioni costa UNA richiesta per nazione aggiunta — la stessa
   fetchCountryCitizens con la sua cache in memoria, quindi una nazione già
   visitata nella sessione non si riscarica.

   TRE COMANDI, tutti sugli stessi numeri già in memoria (nessun render
   ricarica niente):
     · aggregazione — a fasce di 10 livelli (default) o livello per livello;
     · scala — numeri assoluti oppure percentuali;
     · legenda cliccabile — nascondere "senza punti spesi" è quasi sempre
       la prima cosa che si vuole fare: ai livelli bassi sono la
       maggioranza e schiacciano tutto il resto.

   ⚠️ LA BASE DELLA PERCENTUALE È SEMPRE LA FASCIA INTERA (tutti i
   cittadini di quel livello), non i soli gruppi accesi. Con la base sui
   soli gruppi visibili ogni colonna arrivava a 100% qualunque cosa
   contenesse — e con un gruppo solo acceso diventavano blocchi pieni tutti
   identici, che non dicono niente. Così invece, spegnendo un gruppo, le
   colonne si accorciano: si legge "la guerra è il 34% del livello 21-30",
   che è la domanda vera.

   Il tooltip di ogni colonna riporta SEMPRE conteggio E percentuale di
   ogni gruppo: la scala cambia cosa si vede, non cosa si può sapere.

   LARGHEZZA: le colonne si allargano fino a riempire la carta — si misura
   lo spazio disponibile DOPO il render e si disegna l'SVG su misura (vedi
   fitCharts), perché a cinque fasce un grafico stretto in un angolo è solo
   spazio sprecato. Livello per livello sono decine di colonne: lì si
   scende al passo minimo e il grafico scorre dentro la sua carta.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { fetchCountryCitizens, getNation, getNations } from './api.js';
import { classifyPlaystyle } from '../mu/playstyle.js';
import { escapeHtml, flagImg } from '../mu/ui.js';

const GROUPS = ['war', 'eco', 'mixed', 'undecided'];
const GROUP_COLORS = { war: '#e5484d', eco: '#3fb950', mixed: '#e3b341', undecided: '#6e7681' };

const MAX_COMPARE = 3;             // oltre, le colonne diventano illeggibili
const BIN_KEY = 'we_nat_lv_bin';
const MODE_KEY = 'we_nat_lv_mode';
const HIDDEN_KEY = 'we_nat_lv_hidden';

/* ── Stato della sezione ─────────────────────────────────────── */
let _host = null;
let _nation = null;
let _series = [];                  // [{ countryId, name, data, partial, loading, hist }]
let _bin = readBin();
let _mode = readStr(MODE_KEY, 'abs') === 'pct' ? 'pct' : 'abs';
const _hidden = new Set(readStr(HIDDEN_KEY, '').split(',').filter(g => GROUPS.includes(g)));
let _ro = null;                    // ResizeObserver: le carte cambiano larghezza
let _lastWidth = 0;

function readBin() {
  try {
    const v = parseInt(localStorage.getItem(BIN_KEY), 10);
    return v === 1 ? 1 : 10;
  } catch { return 10; }
}
function readStr(key, dflt) {
  try { return localStorage.getItem(key) ?? dflt; } catch { return dflt; }
}
function persist(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage negato */ }
}

/* ══════════════════════════════════════════════════════════════
   Conteggio: righe cittadino → colonne
   ══════════════════════════════════════════════════════════════ */

/** @returns {{bins: object[], counted: number, skipped: number}} */
export function levelHistogram(rows, binSize) {
  const byIdx = new Map();
  let maxIdx = -1, counted = 0, skipped = 0;

  for (const c of rows || []) {
    const lv = Number(c.lv);
    // Dal server lo stile arriva già classificato; dal fallback diretto
    // abbiamo le skill e si classifica qui, stesso identico criterio della
    // ciambella e della pastiglia in tabella.
    const mode = c.ps || (c.skills ? classifyPlaystyle(c).mode : null);
    if (!Number.isFinite(lv) || lv <= 0 || !GROUPS.includes(mode)) { skipped++; continue; }

    const idx = Math.floor((lv - 1) / binSize);
    let b = byIdx.get(idx);
    if (!b) {
      b = { idx, from: idx * binSize + 1, to: (idx + 1) * binSize, war: 0, eco: 0, mixed: 0, undecided: 0, total: 0 };
      byIdx.set(idx, b);
    }
    b[mode]++;
    b.total++;
    counted++;
    if (idx > maxIdx) maxIdx = idx;
  }

  // Le fasce vuote in mezzo restano come colonne a zero: un buco è
  // un'informazione ("nessuno fra il 30 e il 40"), saltarlo farebbe leggere
  // due fasce lontane come contigue.
  const bins = [];
  for (let i = 0; i <= maxIdx; i++) {
    bins.push(byIdx.get(i) || {
      idx: i, from: i * binSize + 1, to: (i + 1) * binSize,
      war: 0, eco: 0, mixed: 0, undecided: 0, total: 0,
    });
  }
  return { bins, counted, skipped };
}

const binLabel = (b, binSize) => (binSize === 1 ? String(b.from) : `${b.from}-${b.to}`);

/** Somma dei soli gruppi ACCESI: è l'altezza disegnata della colonna. La
 *  base delle percentuali resta invece `b.total`, vedi il ⚠️ in cima. */
const visibleTotal = b => GROUPS.reduce((s, g) => s + (_hidden.has(g) ? 0 : b[g]), 0);

/* ══════════════════════════════════════════════════════════════
   Disegno — SVG scritto a mano, come il resto di charts.js
   ══════════════════════════════════════════════════════════════ */

const PAD_L = 36, PAD_R = 8, PAD_T = 16, PAD_B = 28, PLOT_H = 170;
const MIN_STEP_BIN = 46, MIN_STEP_LEVEL = 24, MAX_STEP = 240, MAX_BAR_W = 96;

/** Tetto "tondo" dell'asse: 7 → 8, 23 → 25, 260 → 300. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const step = ([1, 2, 2.5, 5, 10].find(s => v <= s * mag) || 10) * mag;
  return Math.ceil(v / (step / 4)) * (step / 4);
}

function columnsSvg(bins, { binSize, mode, yMax, colStep }) {
  // Barra ~70% del passo: sotto sembra un pettine, sopra spariscono i
  // vuoti fra una fascia e l'altra.
  const barW = Math.max(8, Math.min(colStep - 10, colStep * 0.72, MAX_BAR_W));
  const W = PAD_L + bins.length * colStep + PAD_R;
  const H = PAD_T + PLOT_H + PAD_B;
  const top = mode === 'pct' ? 100 : yMax;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD_T + PLOT_H - f * PLOT_H;
    const val = mode === 'pct' ? `${Math.round(f * 100)}%` : String(Math.round(top * f));
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" class="wp-nat-lv-gridline"></line>
            <text x="${PAD_L - 6}" y="${(y + 3.5).toFixed(1)}" class="wp-nat-lv-ytick">${escapeHtml(val)}</text>`;
  }).join('');

  const cols = bins.map((b, i) => {
    const x = PAD_L + i * colStep + (colStep - barW) / 2;
    const shown = visibleTotal(b);
    // Base: la fascia intera in percentuale (così spegnere un gruppo
    // ACCORCIA la colonna invece di riempirla comunque), il tetto
    // dell'asse in numeri assoluti.
    const base = mode === 'pct' ? b.total : top;
    const colHeight = base > 0 ? (shown / base) * PLOT_H : 0;

    let y = PAD_T + PLOT_H;
    const segs = GROUPS.filter(g => !_hidden.has(g) && b[g] > 0).map(g => {
      const h = base > 0 ? (b[g] / base) * PLOT_H : 0;
      y -= h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(h, 0).toFixed(1)}"
                fill="${GROUP_COLORS[g]}" class="wp-nat-lv-seg"></rect>`;
    }).join('');

    // Etichette fitte a livello-per-livello: una ogni 5 più la prima,
    // altrimenti i numeri si sovrappongono e non si legge nessuno.
    const showLabel = binSize !== 1 || b.from === 1 || b.from % 5 === 0;
    const label = showLabel
      ? `<text x="${(x + barW / 2).toFixed(1)}" y="${PAD_T + PLOT_H + 14}" class="wp-nat-lv-xtick">${escapeHtml(binLabel(b, binSize))}</text>`
      : '';
    // Il conteggio resta scritto anche in percentuale: è l'unico modo per
    // vedere che un 80% è fatto di quattro persone.
    const cap = shown > 0
      ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(PAD_T + PLOT_H - colHeight - 5).toFixed(1)}" class="wp-nat-lv-cap">${shown}</text>`
      : '';

    // Zona sensibile a tutta altezza: il tooltip deve uscire puntando la
    // colonna, non il singolo segmento colorato (che a tre persone è alto
    // due pixel e col mouse non si azzecca).
    const hit = `<rect x="${(PAD_L + i * colStep).toFixed(1)}" y="${PAD_T}" width="${colStep}" height="${PLOT_H}"
                   class="wp-nat-lv-hit" data-bin="${i}"></rect>`;

    return segs + cap + label + hit;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="wp-nat-lv-svg" role="img"
            aria-label="${escapeHtml(natT('lvTitle'))}">${ticks}${cols}</svg>`;
}

/** Contenuto del tooltip di una colonna: conteggio E percentuale di ogni
 *  gruppo acceso, sempre sulla base della fascia intera. */
function tipHtml(b, binSize) {
  const pct = v => (b.total > 0 ? Math.round((v / b.total) * 100) : 0);
  const rows = GROUPS.filter(g => !_hidden.has(g) && b[g] > 0).map(g => `
    <li><span class="wp-nat-dot" style="background:${GROUP_COLORS[g]}"></span>
      <span class="wp-nat-lv-tip-name">${escapeHtml(natT(g))}</span>
      <strong>${b[g]}</strong><span class="wp-nat-lv-tip-pct">${pct(b[g])}%</span></li>`).join('');

  return `<div class="wp-nat-lv-tip-head">${escapeHtml(natT('level'))} ${escapeHtml(binLabel(b, binSize))} · ${b.total} ${escapeHtml(natT('lvCitizens'))}</div>
          <ul class="wp-nat-lv-tip-list">${rows || `<li>${escapeHtml(natT('lvNoData'))}</li>`}</ul>`;
}

/* ══════════════════════════════════════════════════════════════
   Sezione completa: comandi + una carta per nazione
   ══════════════════════════════════════════════════════════════ */

function seriesCard(s) {
  const head = `<div class="wp-nat-lv-head">
      ${flagImg(s.countryId)}<strong>${escapeHtml(s.name)}</strong>
      ${s.hist ? `<span class="wp-nat-lv-n">${s.hist.counted} ${escapeHtml(natT('lvCitizens'))}</span>` : ''}
      ${s.partial ? `<span class="wp-nat-lv-partial" title="${escapeHtml(natT('citizensPartial'))}">!</span>` : ''}
      ${s.countryId !== _nation?._id ? `<button type="button" class="wp-nat-lv-drop" data-drop="${escapeHtml(s.countryId)}" aria-label="${escapeHtml(natT('lvRemove'))}" title="${escapeHtml(natT('lvRemove'))}">×</button>` : ''}
    </div>`;

  // Il disegno arriva subito dopo (fitCharts): prima serve sapere quanto è
  // larga davvero la carta.
  const body = s.loading
    ? `<div class="wp-nat-empty">${escapeHtml(natT('citizensLoading'))}</div>`
    : (s.hist?.counted
      ? `<div class="wp-nat-lv-scroll" data-chart="${escapeHtml(s.countryId)}"></div><div class="wp-nat-lv-tip" hidden></div>`
      : `<div class="wp-nat-empty">${escapeHtml(natT('lvNoData'))}</div>`);

  return `<div class="wp-nat-lv-card" data-card="${escapeHtml(s.countryId)}">${head}${body}</div>`;
}

function paint() {
  if (!_host) return;

  for (const s of _series) s.hist = s.loading ? null : levelHistogram(s.data?.rows || [], _bin);

  const picked = new Set(_series.map(s => s.countryId));
  const options = getNations()
    .filter(n => !picked.has(n._id))
    .map(n => ({ id: n._id, name: n.name || '—' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const canAdd = _series.length < MAX_COMPARE + 1;

  _host.innerHTML = `
    <h3 class="wp-nat-section-title">
      ${escapeHtml(natT('lvTitle'))}
      <div class="wp-nat-tools">
        <div class="wp-nat-viewswitch" id="wp-nat-lv-bin" role="group">
          <button type="button" data-bin="10" class="${_bin === 10 ? 'active' : ''}">${escapeHtml(natT('lvGroup10'))}</button>
          <button type="button" data-bin="1" class="${_bin === 1 ? 'active' : ''}">${escapeHtml(natT('lvGroup1'))}</button>
        </div>
        <div class="wp-nat-viewswitch" id="wp-nat-lv-mode" role="group">
          <button type="button" data-mode="abs" class="${_mode === 'abs' ? 'active' : ''}">${escapeHtml(natT('lvAbs'))}</button>
          <button type="button" data-mode="pct" class="${_mode === 'pct' ? 'active' : ''}">${escapeHtml(natT('lvPct'))}</button>
        </div>
        ${canAdd ? `<label class="wp-nat-sort">
          <span>${escapeHtml(natT('lvCompare'))}</span>
          <select id="wp-nat-lv-add">
            <option value="">—</option>
            ${options.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('')}
          </select>
        </label>` : ''}
        ${_series.length > 1 ? `<button type="button" class="wp-nat-lv-clear" id="wp-nat-lv-clear">${escapeHtml(natT('lvClear'))}</button>` : ''}
      </div>
    </h3>

    <ul class="wp-nat-legend wp-nat-lv-legend" id="wp-nat-lv-legend">
      ${GROUPS.map(g => `
        <li><button type="button" class="wp-nat-lv-key${_hidden.has(g) ? ' off' : ''}" data-group="${g}">
          <span class="wp-nat-dot" style="background:${GROUP_COLORS[g]}"></span>${escapeHtml(natT(g))}
        </button></li>`).join('')}
    </ul>

    <div class="wp-nat-lv-grid${_series.length > 1 ? ' compare' : ''}">${_series.map(seriesCard).join('')}</div>`;

  bind();
  fitCharts();
  observeResize();
}

/** Disegna (o ridisegna) gli SVG sulla larghezza EFFETTIVA delle carte: le
 *  colonne si allargano fino a riempire lo spazio, entro un tetto oltre il
 *  quale sembrerebbero lenzuola. Sotto il passo minimo il grafico scorre. */
function fitCharts() {
  if (!_host) return;

  // In numeri assoluti la scala è UNA per tutte le nazioni a confronto:
  // altrimenti due colonne alte uguali direbbero numeri diversi. In
  // percentuale l'asse è sempre 0-100 e il problema non si pone.
  const peak = _series.reduce((m, s) => (s.hist
    ? Math.max(m, ...s.hist.bins.map(visibleTotal))
    : m), 0);
  const yMax = niceMax(peak);
  const minStep = _bin === 1 ? MIN_STEP_LEVEL : MIN_STEP_BIN;

  for (const s of _series) {
    if (!s.hist?.counted) continue;
    const slot = _host.querySelector(`.wp-nat-lv-scroll[data-chart="${CSS.escape(s.countryId)}"]`);
    if (!slot) continue;
    const avail = slot.clientWidth || 320;
    const n = s.hist.bins.length;
    const colStep = Math.max(minStep, Math.min(MAX_STEP, Math.floor((avail - PAD_L - PAD_R) / n)));
    slot.innerHTML = columnsSvg(s.hist.bins, { binSize: _bin, mode: _mode, yMax, colStep });
    bindTooltip(slot, s);
  }
}

/** Tooltip che segue il mouse dentro la carta. Le zone sensibili sono i
 *  rettangoli a tutta altezza di ogni colonna, non i segmenti colorati.
 *
 *  UNA VOLTA SOLA PER SLOT. Il listener sta sullo slot, non sui rettangoli
 *  dentro, quindi sopravvive al `slot.innerHTML = …` di fitCharts: e
 *  fitCharts non gira solo dopo paint() (che gli slot li ricrea da zero), ma
 *  anche da solo ad ogni cambio di larghezza, chiamato dal ResizeObserver.
 *  Registrandolo ogni volta, trascinare il bordo del pannello lasciava
 *  attaccati allo stesso elemento decine di gestori identici, ognuno dei
 *  quali ad ogni movimento del mouse riscriveva il tooltip e ne rimisurava
 *  la carta. La serie viaggia sull'elemento invece che nella chiusura,
 *  cosi' il gestore gia' attaccato legge sempre quella aggiornata. */
function bindTooltip(slot, s) {
  const card = slot.closest('.wp-nat-lv-card');
  const tip = card?.querySelector('.wp-nat-lv-tip');
  if (!tip) return;

  slot._wpSeries = s;
  if (slot._wpTipBound) return;
  slot._wpTipBound = true;

  slot.addEventListener('mousemove', (e) => {
    const hit = e.target.closest?.('.wp-nat-lv-hit');
    const b = hit ? slot._wpSeries?.hist?.bins[Number(hit.dataset.bin)] : null;
    if (!b) { tip.hidden = true; return; }

    tip.innerHTML = tipHtml(b, _bin);
    tip.hidden = false;
    // Clamp dentro la carta: vicino al bordo destro il tooltip passa a
    // sinistra del cursore invece di uscire dalla carta.
    const box = card.getBoundingClientRect();
    const x = Math.max(6, Math.min(box.width - tip.offsetWidth - 6, e.clientX - box.left + 14));
    const y = Math.max(6, e.clientY - box.top - tip.offsetHeight - 12);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  });
  slot.addEventListener('mouseleave', () => { tip.hidden = true; });
}

function observeResize() {
  if (_ro || typeof ResizeObserver === 'undefined' || !_host) return;
  _lastWidth = _host.clientWidth;
  _ro = new ResizeObserver(() => {
    // La scheda nazione puo' essere stata smontata (overlay chiuso, o
    // tornati all'elenco) senza che nessuno ce lo dica: l'osservatore
    // resterebbe attaccato a un nodo staccato per il resto della sessione.
    // Si stacca da solo appena se ne accorge.
    if (!_host?.isConnected) { dispose(); return; }
    const w = _host.clientWidth;
    if (!w || w === _lastWidth) return;   // solo la larghezza conta
    _lastWidth = w;
    fitCharts();
  });
  _ro.observe(_host);
}

/** Stacca l'osservatore e dimentica la carta. Chiamata da sola quando
 *  l'host sparisce dal documento; esportata perche' chi monta la scheda
 *  possa anticiparla se un giorno avra' un punto di smontaggio esplicito. */
export function dispose() {
  _ro?.disconnect();
  _ro = null;
  _lastWidth = 0;
  _host = null;
}

function bind() {
  _host.querySelector('#wp-nat-lv-bin')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-bin]');
    if (!btn) return;
    _bin = Number(btn.dataset.bin);
    persist(BIN_KEY, String(_bin));
    paint();
  });

  _host.querySelector('#wp-nat-lv-mode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    _mode = btn.dataset.mode;
    persist(MODE_KEY, _mode);
    paint();
  });

  _host.querySelector('#wp-nat-lv-legend')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-group]');
    if (!btn) return;
    const g = btn.dataset.group;
    if (_hidden.has(g)) _hidden.delete(g); else _hidden.add(g);
    // Mai tutti nascosti: l'ultimo acceso non si spegne, resterebbe un
    // grafico vuoto senza spiegazione.
    if (_hidden.size === GROUPS.length) _hidden.delete(g);
    persist(HIDDEN_KEY, [..._hidden].join(','));
    paint();
  });

  _host.querySelector('#wp-nat-lv-add')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (id) addNation(id);
  });

  _host.querySelector('#wp-nat-lv-clear')?.addEventListener('click', () => {
    _series = _series.slice(0, 1);
    paint();
  });

  _host.querySelectorAll('[data-drop]').forEach(btn => {
    btn.addEventListener('click', () => {
      _series = _series.filter(s => s.countryId !== btn.dataset.drop);
      paint();
    });
  });
}

async function addNation(countryId) {
  if (_series.some(s => s.countryId === countryId)) return;
  const nation = getNation(countryId);
  const entry = { countryId, name: nation?.name || '—', loading: true, data: null, partial: false, hist: null };
  _series.push(entry);
  paint();

  const openFor = _nation?._id;
  const data = await fetchCountryCitizens(countryId);
  // La scheda può essere già cambiata mentre la richiesta era in volo (o la
  // nazione tolta dal confronto): in quel caso i dati restano nella cache di
  // api.js e non si disegna niente.
  if (_nation?._id !== openFor || !_series.includes(entry)) return;
  entry.loading = false;
  entry.data = data;
  entry.partial = !!data.partial;
  paint();
}

/**
 * Monta la sezione. `citizens` sono le righe GIÀ scaricate dalla scheda per
 * l'elenco cittadini: la nazione aperta non costa nessuna richiesta.
 */
export function renderLevelPlaystyle(host, nation, citizens) {
  if (_ro && _host !== host) dispose();   // carta nuova: l'osservatore vecchio non serve piu'
  _host = host;
  if (_nation?._id !== nation._id) _series = [];   // confronto legato alla scheda aperta
  _nation = nation;

  const first = {
    countryId: nation._id, name: nation.name || '—',
    loading: false, data: citizens, partial: !!citizens?.partial, hist: null,
  };
  if (_series.length) _series[0] = first; else _series = [first];

  paint();
}
