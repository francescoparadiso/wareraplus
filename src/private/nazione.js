/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — la mia nazione
   ------------------------------------------------------------------
   Quello che un CITTADINO può vedere della sua nazione, senza bisogno
   di cariche: prima l'area riservata mostrava solo a chi aveva un
   potere quello che poteva fare, e a un cittadino semplice il suo
   profilo e basta. Il server (server/plusApi/nazione.js) decide quale
   nazione; qui si disegna e basta.

   Cinque schede, in quest'ordine, che è l'ordine delle domande:

     1. LA NAZIONE   tesoro, classifiche, relazioni, governo
     2. ALLARMI      cosa si è acceso ai nostri confini — sale in
                     CIMA a tutto quando c'è qualcosa di nuovo
     3. NEMICI       pillole, danno fatto, danno che potrebbero fare
     4. ATTIVITÀ     le nostre battaglie, le ultime 48 ore, i bonifici
     5. REGIONI      le nostre, e quelle straniere che le toccano, con
                     basi e bunker
     6. ACCESSI      solo al governo: chi altro vede questa pagina, e
                     la ricerca per aggiungere un cittadino

   ── CHI LA VEDE ────────────────────────────────────────────────────
   Il governo per carica, i cittadini che il governo sceglie, gli
   amministratori (vedi server/plusApi/nazione.js). Agli altri il server
   risponde 403 `accesso_nazione_negato` con dentro i nomi del governo,
   e la scheda diventa "chiedi a loro" invece di un errore.

   ── "NUOVO" SI RICORDA NEL BROWSER ─────────────────────────────────
   Quali allarmi uno ha già visto è una comodità di chi guarda, non uno
   stato condiviso: sta in localStorage, per nazione. Un browser nuovo
   rivede come nuovi gli ultimi 14 giorni, che è il verso giusto in cui
   sbagliare.
   ══════════════════════════════════════════════════════════════ */

import { nzT } from './i18nNazione.js';
import { pvT, pvErr } from './i18n.js';
import {
  leggiNazione, leggiNemici, impostaCanaleConfini, ApiError,
  leggiAccessi, cercaCittadini, aggiungiAccesso, togliAccesso, leggiGiocatoriNemico,
} from './api.js';
import { nomeNazione, urlBandiera, coloreNazione } from './battles.js';
import { state } from '../diplomacy/state.js';
import { getLang } from '../shared/i18n.js';

const CHIAVE_VISTI = 'wp_pv_confini_visti';
const EVENTI_ACCENSIONE = new Set(['attivazione', 'attivo', 'costruzione', 'livello_su']);
const OSTILI = new Set(['guerra', 'nemico_giurato']);
const ORDINE_RELAZIONI = ['nemico_giurato', 'guerra', 'neutrale', 'nap', 'patto', 'alleato'];
const MAX_EVENTI = 20;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bottone(cls, testo, onClick) {
  const b = el('button', `wp-pv-btn ${cls}`, testo);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// ── Numeri e tempi ──────────────────────────────────────────────────
const num = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString());
const compatto = (n) => (n == null ? '—'
  : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n)));
const ora = (ms) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');
const quando = (ms) => (ms ? new Date(ms).toLocaleString(undefined,
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const giornoBreve = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) : '—');

/** "fra 3 ore" / "20 min fa", nella lingua scelta: RelativeTimeFormat sa
 *  dove va la parola in ciascuna delle nove, cosa che un "fa" appeso in
 *  coda sbaglierebbe in metà di esse. */
function relativo(ms) {
  if (!ms) return '';
  let rtf;
  try { rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto', style: 'short' }); }
  catch { rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }); }
  const min = Math.round((ms - Date.now()) / 60000);
  if (Math.abs(min) < 90) return rtf.format(min, 'minute');
  return rtf.format(Math.round(min / 60), 'hour');
}

function bandiera(countryId, cls = 'wp-pv-nz-flag') {
  const url = urlBandiera(countryId);
  if (!url) return null;
  const i = el('img', cls);
  i.src = url; i.alt = ''; i.loading = 'lazy';
  i.addEventListener('error', () => { i.style.display = 'none'; });
  return i;
}

/** Bandiera + nome, la forma in cui una nazione compare ovunque qui. */
function gettonePaese(countryId, extra) {
  const g = el('span', 'wp-pv-nz-paese');
  const f = bandiera(countryId); if (f) g.appendChild(f);
  g.appendChild(el('span', null, nomeNazione(countryId) || '?'));
  if (extra) g.appendChild(el('span', 'wp-pv-nz-paese-extra', extra));
  return g;
}

/** Faccia e nome di un giocatore, con un'etichetta accanto. */
function personaEl(avatar, nome, extra) {
  const chi = el('span', 'wp-pv-nz-gov-chi');
  if (avatar) {
    const a = el('img', 'wp-pv-nz-avatar'); a.src = avatar; a.alt = ''; a.loading = 'lazy';
    a.addEventListener('error', () => { a.style.display = 'none'; });
    chi.appendChild(a);
  }
  chi.appendChild(el('strong', null, nome || '?'));
  if (extra) chi.appendChild(el('span', 'wp-pv-suggerimento', extra));
  return chi;
}

function badgeRelazione(rel) {
  return el('span', `wp-pv-nz-rel wp-pv-nz-rel-${rel}`, nzT(`rel_${rel}`));
}

// ── Grafici in SVG scritto a mano ───────────────────────────────────
// Come quelli di Statistiche nazioni: niente Chart.js per una linea e
// quattordici barre. Tutte le misure stanno nel viewBox, la larghezza la
// decide il riquadro: il grafico si stira con lo schermo.

const NS_SVG = 'http://www.w3.org/2000/svg';

function svgVuoto(W, H, etichetta) {
  const s = document.createElementNS(NS_SVG, 'svg');
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  // Proporzioni fisse (niente preserveAspectRatio none): stirato, il
  // testo dentro l'SVG si deformerebbe con la larghezza della scheda.
  s.setAttribute('class', 'wp-pv-nz-grafico');
  s.setAttribute('role', 'img');
  if (etichetta) s.setAttribute('aria-label', etichetta);
  return s;
}

function nodoSvg(s, tag, attrs, testo) {
  const n = document.createElementNS(NS_SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (testo != null) n.textContent = testo;
  s.appendChild(n);
  return n;
}

function titoloSvg(n, testo) {
  const t = document.createElementNS(NS_SVG, 'title');
  t.textContent = testo;
  n.appendChild(t);
}

// ── Il riquadro che segue il mouse ──────────────────────────────────
// Richiesta: passando sopra un grafico si deve poter LEGGERE il dato, e
// sapere cosa si sta guardando. Il `title` nativo dell'SVG non basta:
// compare dopo un secondo, senza stile, e su una barra sottile da 20px
// non ci si arriva nemmeno. Un solo riquadro per tutta la pagina, attaccato
// al body (fuori dagli overflow delle schede), che segue il puntatore e
// si gira da solo vicino ai bordi. Con i pointer event funziona anche col
// dito: il tocco lo mostra.

let _tip = null;

function tipEl() {
  if (_tip && document.body.contains(_tip)) return _tip;
  _tip = el('div', 'wp-pv-nz-tip');
  _tip.hidden = true;
  _tip.setAttribute('role', 'tooltip');
  document.body.appendChild(_tip);
  return _tip;
}

/** `contenuto`: { titolo, righe: [[etichetta, valore, colore?]], nota } */
function mostraTip(e, contenuto) {
  const t = tipEl();
  t.textContent = '';
  if (contenuto.titolo) t.appendChild(el('strong', 'wp-pv-nz-tip-titolo', contenuto.titolo));
  for (const [etichetta, valore, colore] of contenuto.righe || []) {
    const r = el('div', 'wp-pv-nz-tip-riga');
    if (colore) { const i = el('i', 'wp-pv-nz-tip-colore'); i.style.background = colore; r.appendChild(i); }
    r.appendChild(el('span', null, etichetta));
    r.appendChild(el('strong', null, valore));
    t.appendChild(r);
  }
  if (contenuto.nota) t.appendChild(el('span', 'wp-pv-nz-tip-nota', contenuto.nota));
  t.hidden = false;
  const pad = 14;
  const w = t.offsetWidth; const h = t.offsetHeight;
  let x = e.clientX + pad; let y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

function nascondiTip() { if (_tip) _tip.hidden = true; }

/** Lega il riquadro a un elemento: `contenuto(e)` dice cosa mostrare in
 *  quel punto (null = niente). */
function legaTip(nodo, contenuto) {
  const muovi = (e) => { const c = contenuto(e); if (c) mostraTip(e, c); else nascondiTip(); };
  nodo.addEventListener('pointermove', muovi);
  nodo.addEventListener('pointerdown', muovi);
  nodo.addEventListener('pointerleave', nascondiTip);
}

const GUIDA_COLORE = 'var(--pv-accent)';

/**
 * Una serie nel tempo, a linea con l'area sotto.
 * `gradino` per le serie che cambiano a scatti (la popolazione attiva
 * arriva solo quando varia): fra due valori il dato resta fermo, e una
 * diagonale inventerebbe un andamento che nessuno ha misurato.
 *
 * Al passaggio del mouse: una linea verticale sul punto più vicino, il
 * punto evidenziato, e il riquadro con quando, quanto, e la differenza
 * col punto prima.
 */
function graficoLinea(serie, { etichetta, nome, formato = compatto, gradino = false } = {}) {
  const wrap = el('div', 'wp-pv-nz-grafico-wrap');
  if (!serie?.length) { wrap.appendChild(el('p', 'wp-pv-note', nzT('histEmpty'))); return wrap; }
  const W = 600; const H = 150; const SU = 14; const GIU = 18; const DX = 4;
  const t0 = serie[0].t; const t1 = Math.max(serie[serie.length - 1].t, t0 + 1);
  const vs = serie.map((p) => p.v);
  let lo = Math.min(...vs); let hi = Math.max(...vs);
  if (hi === lo) { hi += 1; lo -= 1; }
  const margine = (hi - lo) * 0.08; lo -= margine; hi += margine;
  const x = (t) => DX + ((t - t0) / (t1 - t0)) * (W - DX * 2);
  const y = (v) => SU + (1 - (v - lo) / (hi - lo)) * (H - SU - GIU);
  const s = svgVuoto(W, H, etichetta);

  // Una tacca per giorno (ogni due se la finestra è lunga), sulla
  // mezzanotte UTC: il giorno di gioco comincia lì.
  const G = 86400000;
  const passo = t1 - t0 > 8 * G ? 2 * G : G;
  for (let t = Math.ceil(t0 / G) * G; t < t1; t += passo) {
    nodoSvg(s, 'line', { x1: x(t), x2: x(t), y1: SU, y2: H - GIU, class: 'wp-pv-nz-tacca' });
    nodoSvg(s, 'text', { x: x(t) + 2, y: H - 5, class: 'wp-pv-nz-testo' }, giornoBreve(new Date(t).toISOString().slice(0, 10)));
  }

  const punti = [];
  serie.forEach((p, i) => {
    if (gradino && i) punti.push(`${x(p.t).toFixed(1)},${y(serie[i - 1].v).toFixed(1)}`);
    punti.push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  });
  const ultimo = serie[serie.length - 1];
  nodoSvg(s, 'polygon', { points: `${x(t0).toFixed(1)},${H - GIU} ${punti.join(' ')} ${x(ultimo.t).toFixed(1)},${H - GIU}`, class: 'wp-pv-nz-area' });
  nodoSvg(s, 'polyline', { points: punti.join(' '), class: 'wp-pv-nz-linea-serie' });
  nodoSvg(s, 'circle', { cx: x(ultimo.t), cy: y(ultimo.v), r: 3.2, class: 'wp-pv-nz-punto' });
  nodoSvg(s, 'text', { x: DX, y: 11, class: 'wp-pv-nz-testo' }, `max ${formato(Math.max(...vs))}`);
  nodoSvg(s, 'text', { x: DX, y: H - GIU - 3, class: 'wp-pv-nz-testo' }, `min ${formato(Math.min(...vs))}`);

  const guida = nodoSvg(s, 'line', { x1: 0, x2: 0, y1: SU, y2: H - GIU, class: 'wp-pv-nz-guida', visibility: 'hidden' });
  const segno = nodoSvg(s, 'circle', { cx: 0, cy: 0, r: 4.5, class: 'wp-pv-nz-segno', visibility: 'hidden' });
  const xs = serie.map((p) => x(p.t));
  legaTip(s, (e) => {
    const m = s.getScreenCTM();
    if (!m) return null;
    const pt = s.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(m.inverse());
    let a = 0; let b = xs.length - 1;
    while (b - a > 1) { const mid = (a + b) >> 1; if (xs[mid] < loc.x) a = mid; else b = mid; }
    const i = Math.abs(xs[a] - loc.x) <= Math.abs(xs[b] - loc.x) ? a : b;
    const p = serie[i];
    guida.setAttribute('x1', xs[i]); guida.setAttribute('x2', xs[i]); guida.setAttribute('visibility', 'visible');
    segno.setAttribute('cx', xs[i]); segno.setAttribute('cy', y(p.v)); segno.setAttribute('visibility', 'visible');
    const prec = i ? serie[i - 1] : null;
    const diff = prec ? p.v - prec.v : null;
    return {
      titolo: nome || etichetta,
      righe: [[quando(p.t), formato(p.v), GUIDA_COLORE]],
      nota: prec ? `${diff > 0 ? '▲ +' : diff < 0 ? '▼ −' : '= '}${formato(Math.abs(diff))} ${nzT('tipVsPrev')} ${quando(prec.t)}` : null,
    };
  });
  s.addEventListener('pointerleave', () => {
    guida.setAttribute('visibility', 'hidden');
    segno.setAttribute('visibility', 'hidden');
  });
  wrap.appendChild(s);
  return wrap;
}

/**
 * Barre, anche impilate: `valori` è un array, una fetta per colore
 * (`classi`). Una barra `parziale` è un giorno misurato solo in parte, e
 * si vede più chiara invece di sembrare un giorno di calma.
 *
 * Il riquadro al passaggio del mouse sta su tutta la COLONNA, non solo
 * sulla barra: una barra bassa alta tre pixel non la prenderebbe nessuno.
 * `p.suggerimento` = { titolo, righe } dice cosa scriverci.
 */
function graficoBarre(punti, { etichetta, formato = compatto, classi = ['wp-pv-nz-barra'] } = {}) {
  const wrap = el('div', 'wp-pv-nz-grafico-wrap');
  if (!punti?.length || !punti.some((p) => p.valori.some((v) => v))) {
    wrap.appendChild(el('p', 'wp-pv-note', nzT('histEmpty')));
    return wrap;
  }
  const W = 600; const H = 150; const SU = 14; const GIU = 18;
  const max = Math.max(1, ...punti.map((p) => p.valori.reduce((t, v) => t + (v || 0), 0)));
  const larga = W / punti.length;
  const s = svgVuoto(W, H, etichetta);
  punti.forEach((p, i) => {
    let base = H - GIU;
    p.valori.forEach((v, k) => {
      if (!v) return;
      const h = (v / max) * (H - SU - GIU);
      nodoSvg(s, 'rect', {
        x: i * larga + larga * 0.14, y: base - h, width: larga * 0.72, height: h,
        class: `${classi[k] || classi[0]}${p.parziale ? ' wp-pv-nz-parziale' : ''}`,
      });
      base -= h;
    });
    if (punti.length <= 16 || i % 2 === 0) {
      nodoSvg(s, 'text', { x: i * larga + larga / 2, y: H - 5, class: 'wp-pv-nz-testo', 'text-anchor': 'middle' }, p.etichetta);
    }
  });
  // Le colonne sensibili vanno disegnate DOPO le barre, sopra di loro.
  punti.forEach((p, i) => {
    const col = nodoSvg(s, 'rect', { x: i * larga, y: SU, width: larga, height: H - SU - GIU, class: 'wp-pv-nz-colonna' });
    legaTip(col, () => p.suggerimento || { titolo: p.etichetta, righe: p.valori.map((v) => ['', formato(v)]) });
  });
  nodoSvg(s, 'text', { x: 2, y: 11, class: 'wp-pv-nz-testo' }, formato(max));
  wrap.appendChild(s);
  return wrap;
}

/** Barra divisa in fette colorate con la sua legenda sotto. */
function barraFette(fette) {
  const box = el('div', 'wp-pv-nz-fette');
  const tot = fette.reduce((t, f) => t + (f.n || 0), 0);
  const barra = el('div', 'wp-pv-nz-pillbar');
  for (const f of fette) {
    if (!f.n) continue;
    const s = el('span', f.cls);
    s.style.width = `${(f.n / (tot || 1)) * 100}%`;
    legaTip(s, () => ({ titolo: f.etichetta, righe: [[nzT('tipPlayers'), `${num(f.n)} · ${Math.round((f.n / (tot || 1)) * 100)}%`]] }));
    barra.appendChild(s);
  }
  box.appendChild(barra);
  const legenda = el('div', 'wp-pv-nz-legenda');
  for (const f of fette) {
    const v = el('span', 'wp-pv-nz-legenda-voce');
    v.appendChild(el('i', f.cls));
    v.appendChild(el('span', null, `${f.etichetta} ${num(f.n)}${tot ? ` · ${Math.round((f.n / tot) * 100)}%` : ''}`));
    legenda.appendChild(v);
  }
  box.appendChild(legenda);
  return box;
}

/** Le pillole di una nazione: titolo, barra e conti con le scadenze.
 *  La stessa per i nemici e per noi, così si confrontano a colpo d'occhio. */
function bloccoPillole(n) {
  const frag = document.createDocumentFragment();
  // Una popolazione sola: i giocatori visti nelle ultime 72 ore, ognuno
  // col suo stato. La prima versione mescolava i 90 più forti con un
  // conto nazionale fatto in un altro modo, e i numeri sembravano non
  // tornare (segnalato: "42 sotto pillola… 152 in tutta la nazione").
  const pl = n.pillole || {};
  const tot = (pl.buff || 0) + (pl.malus || 0) + (pl.pulito || 0) + (pl.ignoto || 0);
  frag.appendChild(el('p', 'wp-pv-nz-pill-titolo', nzT('enemyActiveTitle')
    .replace('{n}', num(n.attivi72h)).replace('{tot}', num(n.censiti))));
  if (tot) {
    const barra = el('div', 'wp-pv-nz-pillbar');
    const nomi = { buff: nzT('pillOn'), malus: nzT('pillHangover'), pulito: nzT('pillClean'), ignoto: nzT('pillUnknown') };
    for (const [k, v] of [['buff', pl.buff], ['malus', pl.malus], ['pulito', pl.pulito], ['ignoto', pl.ignoto]]) {
      if (!v) continue;
      const s = el('span', `wp-pv-nz-pill-${k}`);
      s.style.width = `${(v / tot) * 100}%`;
      legaTip(s, () => ({ titolo: nomi[k], righe: [[nzT('tipPlayers'), `${num(v)} · ${Math.round((v / tot) * 100)}%`]] }));
      barra.appendChild(s);
    }
    frag.appendChild(barra);
  }
  const pill = el('div', 'wp-pv-nz-pill-righe');
  const vocePill = (cls, n2, etichetta, dettaglio) => {
    const v = el('span', `wp-pv-nz-pill-voce wp-pv-nz-pv-${cls}`);
    v.appendChild(el('strong', null, num(n2 ?? 0)));
    v.appendChild(el('span', null, ` ${etichetta}`));
    if (dettaglio) v.appendChild(el('span', 'wp-pv-suggerimento', ` · ${dettaglio}`));
    pill.appendChild(v);
  };
  const primo = (l) => (l?.length ? `${ora(l[0])} (${relativo(l[0])})` : null);
  vocePill('buff', pl.buff, nzT('pillOn'), primo(pl.fineBuff) && `${nzT('pillFirstEnd')} ${primo(pl.fineBuff)}`);
  vocePill('malus', pl.malus, nzT('pillHangover'), primo(pl.fineMalus) && `${nzT('pillFirstClean')} ${primo(pl.fineMalus)}`);
  vocePill('pulito', pl.pulito, nzT('pillClean'));
  // Chi non si è riusciti a leggere né dal vivo né dal censimento: un
  // buco dichiarato, mai un "pulito".
  if (pl.ignoto) vocePill('ignoto', pl.ignoto, nzT('pillUnknown'));
  frag.appendChild(pill);
  return frag;
}

const TIER_ORDINE = ['diamond', 'platinum', 'gold', 'silver', 'bronze'];

// ── Allarmi già visti (per nazione, in questo browser) ─────────────
function leggiVisti() {
  try { return JSON.parse(localStorage.getItem(CHIAVE_VISTI) || '{}') || {}; } catch { return {}; }
}
function segnaVisti(countryId, idMax) {
  try {
    const v = leggiVisti(); v[countryId] = idMax;
    localStorage.setItem(CHIAVE_VISTI, JSON.stringify(v));
  } catch { /* modalita' privata: si rivedranno come nuovi, pazienza */ }
}

// ═════════════════════════════════════════════════════════════════════

/**
 * @param {object} ctx
 * @param {Function} ctx.ridisegna  richiama il render di tutta la vista
 * @param {Function} ctx.lente      () => id account guardato, o null
 */
export function creaQuadroNazione(ctx) {
  let dati = null;
  let nemici = null;
  let caricamento = false;
  let caricamentoNemici = false;
  let errore = null;
  let erroreNemici = null;
  let paeseScelto = null;         // solo l'amministratore lo cambia
  let occupato = false;
  let esitoCanale = null;
  // Le tabelle "tutti i giocatori" aperte, per nemico, e i loro nodi (che
  // sopravvivono ai ridisegni: vedi tabellaGiocatori).
  const tabelleAperte = new Set();
  const tabelle = new Map();
  // Il 403 di chi non ha accesso, con dentro i nomi del governo.
  let negato = null;
  // Chi altro vede la pagina: lo legge solo il governo.
  let accessi = null;
  let erroreAccessi = null;
  // La ricerca è un nodo che sopravvive ai ridisegni: ricrearla ad ogni
  // render le toglierebbe il fuoco a metà parola.
  let cercaWidget = null;

  async function carica() {
    caricamento = true; errore = null;
    // Le tabelle dei giocatori si rileggono con tutto il resto: una tabella
    // di un'ora fa accanto a un riepilogo di adesso direbbe due cose diverse.
    tabelle.clear();
    ctx.ridisegna();
    try {
      dati = await leggiNazione({ asAccount: ctx.lente(), paese: paeseScelto });
      negato = null;
    } catch (err) {
      if (err instanceof ApiError && err.codice === 'accesso_nazione_negato') {
        // Non è un guasto: è la regola. Si dice a chi chiedere.
        negato = err.dati || {};
        dati = null;
        return;
      }
      // Un server che la rotta non ce l'ha ancora (rideploy di
      // warera-plus-api non fatto) risponde 404 `rotta_sconosciuta`: detto
      // come "errore del server" sembrava un guasto, ed è solo un'attesa.
      errore = !(err instanceof ApiError) ? pvT('errErrore_server')
        : err.codice === 'nazione_sconosciuta' ? nzT('natNoCountry')
          : err.codice === 'rotta_sconosciuta' ? nzT('natServerOld')
            : pvErr(err.codice);
    } finally {
      caricamento = false; ctx.ridisegna();
    }
    // I nemici dopo, e senza aspettarli: sono la parte lenta (giocatori
    // letti dal vivo) e il resto del quadro non deve restare in bianco.
    if (dati) caricaNemici();
    if (dati && (dati.governa || dati.amministra)) caricaAccessi();
  }

  async function caricaAccessi() {
    try {
      accessi = (await leggiAccessi({ asAccount: ctx.lente(), paese: paeseScelto })).accessi || [];
      erroreAccessi = null;
    } catch (err) { erroreAccessi = messaggioErrore(err); }
    ctx.ridisegna();
  }

  /** Aggiunge o toglie, e rilegge l'elenco dalla risposta. Vero se è
   *  andata: la ricerca si svuota solo allora, così un errore non fa
   *  perdere quello che si stava cercando. */
  async function azioneAccessi(fn) {
    if (occupato) return false;
    occupato = true; erroreAccessi = null; ctx.ridisegna();
    try { accessi = (await fn()).accessi || []; return true; }
    catch (err) { erroreAccessi = messaggioErrore(err); return false; }
    finally { occupato = false; ctx.ridisegna(); }
  }

  function messaggioErrore(err) {
    if (!(err instanceof ApiError)) return pvT('errErrore_server');
    const k = `accErr_${err.codice}`;
    const t = nzT(k);
    return t !== k ? t : pvErr(err.codice);
  }

  async function caricaNemici() {
    caricamentoNemici = true; erroreNemici = null; ctx.ridisegna();
    try { nemici = await leggiNemici({ asAccount: ctx.lente(), paese: paeseScelto }); }
    catch { erroreNemici = nzT('enemiesError'); nemici = null; }
    finally { caricamentoNemici = false; ctx.ridisegna(); }
  }

  /** Quanti allarmi di accensione non ancora visti: main.js lo mostra
   *  anche a quadro chiuso. */
  function nuovi() {
    const ev = dati?.confini?.eventi || [];
    const visto = leggiVisti()[dati?.paese?.id] || 0;
    return ev.filter((e) => e.id > visto && EVENTI_ACCENSIONE.has(e.evento));
  }

  function render() {
    try { return disegna(); }
    catch (err) {
      console.error('[mia nazione] disegno fallito:', err);
      const f = document.createDocumentFragment();
      f.appendChild(el('p', 'wp-pv-error', pvT('errErrore_server')));
      f.appendChild(el('p', 'wp-pv-note', String(err?.message || err)));
      return f;
    }
  }

  function disegna() {
    // Il riquadro del mouse sta sul body: se la vista si ridisegna mentre
    // è aperto, l'elemento sotto il puntatore sparisce senza pointerleave
    // e il riquadro resterebbe appeso a metà schermo.
    nascondiTip();
    const frag = document.createDocumentFragment();
    if (!dati && !caricamento && !errore && !negato) carica();

    if (negato) { frag.appendChild(cardNegato()); return frag; }

    if (!dati) {
      const card = el('div', 'wp-pv-card');
      card.appendChild(el('h2', 'wp-pv-h2', nzT('natTitle')));
      if (errore) {
        card.appendChild(el('p', 'wp-pv-note', errore));
        card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('retry'), () => carica()));
      } else card.appendChild(el('p', 'wp-pv-note', nzT('natLoading')));
      frag.appendChild(card);
      return frag;
    }

    // ── Una griglia a 12 colonne, a tutta larghezza ───────────────────
    // Era una colonna di schede una sotto l'altra, e su un monitor largo
    // restava una striscia in mezzo allo schermo (segnalato così). Ora le
    // schede si affiancano: il numero accanto a ogni scheda è quante delle
    // 12 colonne prende. Sotto i 900px diventano tutte larghe (CSS), e
    // `grid-auto-flow: dense` riempie i buchi quando una manca.
    const griglia = el('div', 'wp-pv-nz-griglia');
    const metti = (card, span) => { card.classList.add(`wp-pv-nz-span-${span}`); griglia.appendChild(card); };

    // Un allarme nuovo passa davanti a tutto: è l'unica cosa di questa
    // pagina che può non aspettare.
    const daVedere = nuovi();
    if (daVedere.length) metti(cardAllarmi(true), 12);
    metti(cardNazione(), 12);
    metti(cardStorico(), 12);
    if (!daVedere.length) metti(cardAllarmi(false), 8);
    metti(cardElezioni(), 4);
    metti(cardForza(), 8);
    metti(cardCittadini(), 4);
    metti(cardNemici(), 12);
    metti(cardAttivita(), 6);
    metti(cardGuerra(), 6);
    metti(cardTop(), 4);
    metti(cardUnita(), 4);
    metti(cardClassifiche(), 4);
    metti(cardRegioni(), 12);
    if (dati.governa || dati.amministra) metti(cardAccessi(), 12);
    frag.appendChild(griglia);
    return frag;
  }

  // ── 0. Senza accesso ──────────────────────────────────────────────
  function cardNegato() {
    const card = el('div', 'wp-pv-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('natTitle')));
    card.appendChild(el('p', 'wp-pv-body', nzT('natDenied')));
    const persone = (negato.governo?.cariche || []).filter((c) => c.persona);
    if (persone.length) {
      card.appendChild(el('p', 'wp-pv-note', nzT('natDeniedAsk')));
      const lista = el('div', 'wp-pv-nz-chips');
      for (const { carica, persona } of persone) {
        lista.appendChild(personaEl(persona.avatar, persona.nome, nzT(`gov_${carica}`)));
      }
      card.appendChild(lista);
    }
    card.appendChild(el('p', 'wp-pv-note', nzT('natDeniedHow')));
    return card;
  }

  // ── 6. Chi vede questa pagina ─────────────────────────────────────
  function cardAccessi() {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('accTitle')));
    card.appendChild(el('p', 'wp-pv-body', nzT('accBody')));

    // Il governo non si aggiunge né si toglie: c'è per carica, e lo si
    // mostra accanto perché l'elenco risponda per intero a "chi la vede".
    const carica = el('div', 'wp-pv-nz-sezione');
    carica.appendChild(el('h3', 'wp-pv-h3', nzT('accByOffice')));
    const chips = el('div', 'wp-pv-nz-chips');
    for (const { carica: c, persona } of dati.governo?.cariche || []) {
      if (persona) chips.appendChild(personaEl(persona.avatar, persona.nome, nzT(`gov_${c}`)));
    }
    carica.appendChild(chips);
    card.appendChild(carica);

    const sez = el('div', 'wp-pv-nz-sezione');
    sez.appendChild(el('h3', 'wp-pv-h3', nzT('accDelegates')));
    if (erroreAccessi) sez.appendChild(el('p', 'wp-pv-error', erroreAccessi));
    if (accessi == null) sez.appendChild(el('p', 'wp-pv-note', '…'));
    else if (!accessi.length) sez.appendChild(el('p', 'wp-pv-note', nzT('accNone')));
    else {
      const lista = el('div', 'wp-pv-nz-acc-lista');
      for (const a of accessi) {
        const r = el('div', 'wp-pv-nz-acc-riga');
        r.appendChild(personaEl(a.avatar, a.nome || a.warUserId));
        // "Non ancora entrato" risponde in anticipo a "gliel'ho dato e non
        // vede niente": l'accesso c'è, manca il suo login.
        r.appendChild(el('span', `wp-pv-nz-tag${a.entrato ? '' : ' wp-pv-nz-tag-avviso'}`,
          a.entrato ? nzT('accSignedIn') : nzT('accNotSignedIn')));
        r.appendChild(el('span', 'wp-pv-suggerimento',
          [a.aggiuntoDa ? `${nzT('accAddedBy')} ${a.aggiuntoDa}` : null, a.aggiuntoIl ? quando(a.aggiuntoIl) : null]
            .filter(Boolean).join(' · ')));
        if (!ctx.lente()) {
          const via = bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('remove'),
            () => azioneAccessi(() => togliAccesso(a.warUserId, { paese: paeseScelto })));
          via.disabled = occupato;
          r.appendChild(via);
        }
        lista.appendChild(r);
      }
      sez.appendChild(lista);
    }
    card.appendChild(sez);

    if (!ctx.lente()) card.appendChild(widgetRicerca());
    return card;
  }

  /** La ricerca dei cittadini da aggiungere. Aggiorna i suoi risultati sul
   *  posto, senza ridisegnare la vista: è il modo per non perdere il fuoco
   *  del campo a ogni tasto (vedi il filtro di board.js). */
  function widgetRicerca() {
    if (cercaWidget) return cercaWidget;
    const wrap = el('div', 'wp-pv-nz-acc-cerca');
    const input = el('input', 'wp-pv-input');
    input.type = 'search'; input.placeholder = nzT('accSearchPh'); input.autocomplete = 'off';
    input.maxLength = 40;
    const nota = el('p', 'wp-pv-note');
    const lista = el('div', 'wp-pv-nz-acc-lista');

    let tick = null;
    let ultimo = '';
    const esegui = async () => {
      const q = input.value.trim();
      ultimo = q;
      if (q.length < 2) { lista.textContent = ''; nota.textContent = ''; return; }
      let r;
      try { r = await cercaCittadini(q, { paese: paeseScelto }); }
      catch (err) {
        if (q !== ultimo) return;
        lista.textContent = ''; nota.textContent = messaggioErrore(err);
        return;
      }
      // Una risposta lenta non deve scrivere sopra quella di una ricerca
      // più recente.
      if (q !== ultimo) return;
      disegnaTrovati(r);
    };
    input.addEventListener('input', () => { clearTimeout(tick); tick = setTimeout(esegui, 350); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    function disegnaTrovati(r) {
      lista.textContent = '';
      nota.textContent = (r.noti != null && r.censiti != null && r.noti < r.censiti) ? nzT('accPartial') : '';
      if (!r.trovati?.length) { lista.appendChild(el('p', 'wp-pv-note', nzT('accNoResults'))); return; }
      for (const c of r.trovati) {
        const riga = el('div', 'wp-pv-nz-acc-riga');
        riga.appendChild(personaEl(c.avatar, c.nome, c.livello != null ? `${nzT('lv')}${c.livello}` : null));
        if (c.perCarica) riga.appendChild(el('span', 'wp-pv-nz-tag', nzT('accByOfficeTag')));
        else if (c.delegato) riga.appendChild(el('span', 'wp-pv-nz-tag', nzT('accAlready')));
        else {
          const b = bottone('wp-pv-btn-primary wp-pv-btn-small', nzT('accGive'), async () => {
            b.disabled = true;
            const ok = await azioneAccessi(() => aggiungiAccesso(c.id, { paese: paeseScelto }));
            if (ok) { input.value = ''; lista.textContent = ''; nota.textContent = ''; } else b.disabled = false;
          });
          riga.appendChild(b);
        }
        lista.appendChild(riga);
      }
    }

    wrap.appendChild(input);
    wrap.appendChild(nota);
    wrap.appendChild(lista);
    cercaWidget = wrap;
    return wrap;
  }

  // ── 1. La nazione ─────────────────────────────────────────────────
  function cardNazione() {
    const p = dati.paese;
    const card = el('div', 'wp-pv-card wp-pv-nz-card');

    const testa = el('div', 'wp-pv-nz-testa');
    const f = bandiera(p.id, 'wp-pv-nz-flag-grande'); if (f) testa.appendChild(f);
    const nomi = el('div', 'wp-pv-nz-testa-nomi');
    nomi.appendChild(el('span', 'wp-pv-h2', nzT('natTitle')));
    nomi.appendChild(el('strong', 'wp-pv-nz-nome', p.nome || nomeNazione(p.id) || '?'));
    testa.appendChild(nomi);

    const meta = el('div', 'wp-pv-nz-meta');
    // Da dove viene il dato e quanti anni ha: "in diretta" e "dalla cache"
    // non sono la stessa promessa, e un tesoro di dieci minuti fa è già
    // un'altra cifra.
    meta.appendChild(el('span', 'wp-pv-note',
      `${nzT('natAsOf')} ${ora(p.letto || dati.generatoIl)} · ${p.fonte === 'live' ? nzT('natLive') : nzT('natCache')}`));
    if (dati.amministra && dati.ammesse?.length) meta.appendChild(sceltaPaese());
    const agg = bottone('wp-pv-btn-quiet wp-pv-btn-small', nzT('natRefresh'), () => carica());
    agg.disabled = caricamento;
    meta.appendChild(agg);
    testa.appendChild(meta);
    card.appendChild(testa);
    // Un accesso che qualcuno ha dato si può togliere: chi lo usa deve
    // saperlo, e sapere da chi viene.
    if (dati.via === 'delega') card.appendChild(el('p', 'wp-pv-note', nzT('accYouDelegate')));

    card.appendChild(tessereNumeri(p));
    // Relazioni e governo affiancati: su uno schermo largo, uno sotto
    // l'altro erano due strisce lunghe con metà riga vuota.
    const due = el('div', 'wp-pv-nz-due');
    due.appendChild(bloccoRelazioni(p));
    if (dati.governo) due.appendChild(bloccoGoverno(dati.governo));
    card.appendChild(due);
    return card;
  }

  function sceltaPaese() {
    const s = el('select', 'wp-pv-select wp-pv-select-piccola');
    s.setAttribute('aria-label', nzT('natPick'));
    for (const id of dati.ammesse) {
      const o = el('option', null, nomeNazione(id) || id);
      o.value = id;
      if (id === dati.paese.id) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => {
      paeseScelto = s.value; nemici = null; tabelleAperte.clear();
      accessi = null; cercaWidget = null;
      carica();
    });
    return s;
  }

  /**
   * Le tessere in cima alla scheda. Ognuna, se si sa com'era prima, porta
   * una freccia: di quanto è cambiato il numero e RISPETTO A QUANDO — "24 h
   * fa", "ieri a quest'ora", oppure l'ora esatta del confronto finché le
   * fotografie orarie non arrivano a un giorno (vedi formaVariazioni sul
   * server). Al passaggio del mouse: prima, adesso, differenza, posizione.
   *
   * "Taglie incassate" è stata tolta su richiesta: è quanto hanno incassato
   * i cittadini, e a chi governa non serve (vedi anche la trappola di
   * countryBounty in CLAUDE.md).
   */
  function tessereNumeri(p) {
    const box = el('div', 'wp-pv-totali wp-pv-nz-tessere');
    const vv = dati.variazioni || {};
    const GIORNO = 24 * 3600_000;
    const rif = (v) => (v.ieri ? nzT('varYesterday')
      : Math.abs(v.da - (Date.now() - GIORNO)) < 2 * 3600_000 ? nzT('var24h') : `${nzT('varSince')} ${quando(v.da)}`);
    const segnato = (d, formato) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${formato(Math.abs(d))}`;
    // La posizione con la sua freccia: ▲ vuol dire SALITA in classifica,
    // cioè un numero più piccolo.
    const posizione = (r, v) => {
      if (!r?.rank) return null;
      let t = `#${r.rank}`;
      const prima = v?.rank?.prima;
      if (prima != null && prima !== r.rank) t += prima > r.rank ? ` ▲${prima - r.rank}` : ` ▼${r.rank - prima}`;
      return t;
    };

    const voce = (etichetta, valore, sotto, { v = null, formato = num, meglioSeSale = true, neutro = false, esatto = null } = {}) => {
      const t = el('div', 'wp-pv-totale-voce');
      t.appendChild(el('span', 'wp-pv-label', etichetta));
      t.appendChild(el('strong', 'wp-pv-totale-val', valore));
      if (v && v.delta != null && !v.reset) {
        const su = v.delta > 0; const giu = v.delta < 0;
        const buono = neutro ? null : su ? meglioSeSale : giu ? !meglioSeSale : null;
        const d = el('span', `wp-pv-nz-delta ${buono === true ? 'wp-pv-nz-delta-buono' : buono === false ? 'wp-pv-nz-delta-cattivo' : 'wp-pv-nz-delta-piatto'}`);
        d.appendChild(el('span', 'wp-pv-nz-delta-freccia', su ? '▲' : giu ? '▼' : '='));
        d.appendChild(el('span', null, segnato(v.delta, formato)));
        d.appendChild(el('span', 'wp-pv-nz-delta-rif', rif(v)));
        t.appendChild(d);
      }
      if (sotto) t.appendChild(el('span', 'wp-pv-suggerimento', sotto));
      legaTip(t, () => {
        const righe = [[nzT('tipNow'), esatto ?? valore]];
        if (v && v.prima != null) {
          righe.push([v.ieri ? nzT('varYesterday') : quando(v.da), formato(v.prima)]);
          if (!v.reset) righe.push([nzT('tipChange'), segnato(v.delta, formato)]);
        }
        if (v?.rank) righe.push([nzT('rank'), `#${v.rank.prima} → #${v.rank.adesso}`]);
        return { titolo: etichetta, righe, nota: v ? null : nzT('varNoHistory') };
      });
      box.appendChild(t);
    };

    voce(nzT('kTreasury'), num(p.tesoro),
      [posizione(p.tesoroRank, vv.tesoro), nzT('kTreasuryHint')].filter(Boolean).join(' · '), { v: vv.tesoro });
    voce(nzT('kActivePop'), num(p.popolazioneAttiva?.valore),
      [posizione(p.popolazioneAttiva, vv.attivi), p.popolazione != null ? `${num(p.popolazione)} ${nzT('kPopulation')}` : null].filter(Boolean).join(' · '),
      { v: vv.attivi });
    voce(nzT('kDevelopment'), p.sviluppo?.valore != null ? Number(p.sviluppo.valore).toFixed(1) : '—',
      posizione(p.sviluppo, vv.sviluppo), { v: vv.sviluppo, formato: (x) => Number(x).toFixed(1) });
    voce(nzT('kDamageToday'), compatto(dati.oggi?.danno), nzT('kDamageTodayHint'),
      { v: vv.dannoOggi, formato: compatto, esatto: num(dati.oggi?.danno) });
    voce(nzT('kDamageWeek'), compatto(p.dannoSettimana?.valore), posizione(p.dannoSettimana, vv.dannoSett),
      { v: vv.dannoSett, formato: compatto, esatto: num(p.dannoSettimana?.valore) });
    voce(nzT('kPerCitizen'), compatto(p.dannoPerCittadino?.valore), posizione(p.dannoPerCittadino, vv.perCitt),
      { v: vv.perCitt, formato: compatto });
    if (p.tasse) {
      voce(nzT('kTaxes'), `${p.tasse.income ?? '—'}% · ${p.tasse.market ?? '—'}% · ${p.tasse.selfWork ?? '—'}%`, nzT('kTaxesHint'),
        { v: vv.tassaReddito, formato: (x) => `${x} pp`, neutro: true });
    }
    if (p.disordini?.max) {
      voce(nzT('kUnrest'), `${Math.round((p.disordini.barra / p.disordini.max) * 100)}%`, null,
        { v: vv.disordini, formato: (x) => `${Number(x).toFixed(1)} pp`, meglioSeSale: false });
    }
    if (p.bonusProduzione?.valore != null) {
      voce(nzT('kProduction'), `${p.bonusProduzione.valore}%`, posizione(p.bonusProduzione, vv.bonusProd),
        { v: vv.bonusProd, formato: (x) => `${x} pp` });
    }
    return box;
  }

  function bloccoRelazioni(p) {
    const box = el('div', 'wp-pv-nz-relazioni');
    const riga = (etichetta, ids, extra) => {
      const r = el('div', 'wp-pv-nz-rel-riga');
      r.appendChild(el('span', 'wp-pv-label', etichetta));
      const lista = el('div', 'wp-pv-nz-chips');
      if (!ids.length) lista.appendChild(el('span', 'wp-pv-note', nzT('relNone')));
      for (const id of ids) lista.appendChild(gettonePaese(id, extra?.(id)));
      r.appendChild(lista);
      box.appendChild(r);
    };
    riga(nzT('relWars'), p.guerre || []);
    riga(nzT('relSworn'), p.nemicoGiurato ? [p.nemicoGiurato] : []);
    riga(nzT('relAllies'), p.alleati || []);
    if (p.patti?.length) riga(nzT('relPacts'), p.patti);
    if (p.nap?.length) {
      const fino = new Map(p.nap.map((n) => [n.id, n.fino]));
      riga(nzT('relNaps'), p.nap.map((n) => n.id), (id) => `${nzT('until')} ${quando(fino.get(id))}`);
    }
    return box;
  }

  function bloccoGoverno(g) {
    const box = el('div', 'wp-pv-nz-governo');
    box.appendChild(el('h3', 'wp-pv-h3', nzT('govTitle')));
    const lista = el('div', 'wp-pv-nz-gov-lista');
    for (const { carica, persona } of g.cariche) {
      const r = el('div', 'wp-pv-nz-gov-riga');
      r.appendChild(el('span', 'wp-pv-label', nzT(`gov_${carica}`)));
      const chi = el('span', 'wp-pv-nz-gov-chi');
      if (persona?.avatar) {
        const a = el('img', 'wp-pv-nz-avatar'); a.src = persona.avatar; a.alt = ''; a.loading = 'lazy';
        a.addEventListener('error', () => { a.style.display = 'none'; });
        chi.appendChild(a);
      }
      chi.appendChild(el('strong', null, persona ? (persona.nome || '?') : nzT('vacant')));
      r.appendChild(chi);
      lista.appendChild(r);
    }
    const c = el('div', 'wp-pv-nz-gov-riga');
    c.appendChild(el('span', 'wp-pv-label', nzT('govCongress')));
    c.appendChild(el('strong', null, `${g.congresso} ${nzT('seats')}`));
    lista.appendChild(c);
    box.appendChild(lista);
    return box;
  }

  // ── 2. Allarmi dai confini ────────────────────────────────────────
  function cardAllarmi(inEvidenza) {
    const conf = dati.confini;
    const card = el('div', `wp-pv-card wp-pv-nz-allarmi${inEvidenza ? ' wp-pv-nz-allarmi-caldi' : ''}`);
    const testa = el('div', 'wp-pv-nz-card-testa');
    testa.appendChild(el('h2', 'wp-pv-h2', nzT('alertsTitle')));
    const daVedere = nuovi();
    if (daVedere.length) testa.appendChild(el('span', 'wp-pv-nz-nuovi', `${daVedere.length} · ${nzT('alertsNew')}`));
    card.appendChild(testa);
    card.appendChild(el('p', 'wp-pv-body', nzT('alertsBody')));

    if (!conf) { card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server'))); return card; }

    if (!conf.sorvegliata) card.appendChild(el('p', 'wp-pv-note', nzT('alertsNotWatched')));
    else {
      const meta = [];
      if (conf.ultimoGiro) meta.push(`${nzT('alertsLast')} ${ora(conf.ultimoGiro)}`);
      if (conf.sorvegliateDal) meta.push(`${nzT('alertsSince')} ${quando(conf.sorvegliateDal)}`);
      if (meta.length) card.appendChild(el('p', 'wp-pv-note', meta.join(' · ')));
    }

    const eventi = conf.eventi || [];
    const visto = leggiVisti()[dati.paese.id] || 0;
    if (conf.sorvegliata && !eventi.length) card.appendChild(el('p', 'wp-pv-note', nzT('alertsNone')));
    if (eventi.length) {
      const lista = el('div', 'wp-pv-nz-eventi');
      for (const e of eventi.slice(0, MAX_EVENTI)) lista.appendChild(rigaEvento(e, e.id > visto));
      card.appendChild(lista);
    }

    if (daVedere.length) {
      card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', nzT('alertsSeen'), () => {
        segnaVisti(dati.paese.id, Math.max(...eventi.map((e) => e.id)));
        ctx.ridisegna();
      }));
    }

    if (dati.canaleConfini && !ctx.lente()) card.appendChild(bloccoCanale());
    return card;
  }

  function rigaEvento(e, nuovo) {
    // Il peso: una base che si accende in casa di chi ci ha dichiarato
    // guerra non è la stessa notizia di un bunker spento da un alleato.
    const accende = EVENTI_ACCENSIONE.has(e.evento);
    const peso = accende && OSTILI.has(e.relazione) ? 'alta' : accende ? 'media' : 'bassa';
    const r = el('div', `wp-pv-nz-evento wp-pv-nz-peso-${peso}`);

    const testa = el('div', 'wp-pv-nz-evento-testa');
    if (nuovo && accende) testa.appendChild(el('span', 'wp-pv-nz-nuovo', nzT('alertsNew')));
    testa.appendChild(el('span', 'wp-pv-nz-evento-quando', quando(e.at)));
    testa.appendChild(el('strong', 'wp-pv-nz-evento-regione', e.regionNome || e.regionId));
    testa.appendChild(gettonePaese(e.ownerId));
    if (e.relazione) testa.appendChild(badgeRelazione(e.relazione));
    r.appendChild(testa);

    const lv = e.livelloA ? ` ${nzT('lv')}${e.livelloA}` : '';
    let testo = `${nzT(`tipo_${e.tipo}`)}${lv} ${nzT(`ev_${e.evento}`)}`;
    if (e.effettoIl) testo += ` — ${nzT('activeFrom')} ${ora(e.effettoIl)} (${relativo(e.effettoIl)})`;
    r.appendChild(el('div', 'wp-pv-nz-evento-cosa', testo));

    const sotto = [];
    if (e.confinaCon?.length) sotto.push(`${nzT('bordersWith')} ${e.confinaCon.join(', ')}`);
    sotto.push(nzT(e.tipo === 'base' ? 'baseEffect' : 'bunkerEffect'));
    r.appendChild(el('div', 'wp-pv-suggerimento', sotto.join(' · ')));
    return r;
  }

  function bloccoCanale() {
    const box = el('div', 'wp-pv-canale wp-pv-nz-canale');
    const testa = el('div', 'wp-pv-canale-testa');
    testa.appendChild(el('strong', null, nzT('channelTitle')));
    testa.appendChild(el('span', `wp-pv-badge${dati.canaleConfini.configurato ? ' wp-pv-badge-ok' : ''}`,
      dati.canaleConfini.configurato ? pvT('channelSet') : pvT('channelNone')));
    box.appendChild(testa);
    box.appendChild(el('p', 'wp-pv-suggerimento', nzT('channelBody')));

    const form = el('form', 'wp-pv-riga');
    const url = el('input', 'wp-pv-input');
    url.type = 'url'; url.placeholder = pvT('channelPh'); url.autocomplete = 'off';
    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('channelSave'));
    salva.type = 'submit'; salva.disabled = occupato;
    const invia = async (valore) => {
      if (occupato) return;
      occupato = true; esitoCanale = null; ctx.ridisegna();
      try {
        const r = await impostaCanaleConfini(valore, { paese: paeseScelto });
        dati.canaleConfini = { ...dati.canaleConfini, configurato: Boolean(r.configurato) };
      } catch (err) {
        esitoCanale = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
      } finally { occupato = false; ctx.ridisegna(); }
    };
    form.addEventListener('submit', (ev) => { ev.preventDefault(); invia(url.value.trim()); });
    form.appendChild(url); form.appendChild(salva);
    if (dati.canaleConfini.configurato) {
      const via = bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('channelClear'), () => invia(''));
      via.disabled = occupato;
      form.appendChild(via);
    }
    box.appendChild(form);
    if (esitoCanale) box.appendChild(el('p', 'wp-pv-error', esitoCanale));
    return box;
  }

  // ── 3. Nemici ─────────────────────────────────────────────────────
  function cardNemici() {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('enemiesTitle')));
    card.appendChild(el('p', 'wp-pv-body', nzT('enemiesBody')));

    if (erroreNemici) { card.appendChild(el('p', 'wp-pv-note', erroreNemici)); return card; }
    if (!nemici) { card.appendChild(el('p', 'wp-pv-note', caricamentoNemici ? nzT('enemiesLoading') : '…')); return card; }
    if (!nemici.nemici?.length) { card.appendChild(el('p', 'wp-pv-note', nzT('enemiesNone'))); return card; }

    const lista = el('div', 'wp-pv-nz-nemici');
    for (const n of nemici.nemici) lista.appendChild(schedaNemico(n));
    card.appendChild(lista);
    card.appendChild(el('p', 'wp-pv-note', nzT('potNote')));
    return card;
  }

  function schedaNemico(n) {
    const box = el('div', 'wp-pv-nz-nemico');
    const colore = coloreNazione(n.id);
    if (colore) box.style.borderLeftColor = colore;

    const testa = el('div', 'wp-pv-nz-nemico-testa');
    testa.appendChild(gettonePaese(n.id));
    if (n.giurato) testa.appendChild(badgeRelazione('nemico_giurato'));
    if (n.inGuerra) testa.appendChild(badgeRelazione('guerra'));
    if (n.danno?.settimanaRank) testa.appendChild(el('span', 'wp-pv-note', `#${n.danno.settimanaRank} ${nzT('dmgWeek')}`));
    box.appendChild(testa);

    if (n.errore && !n.pillole) { box.appendChild(el('p', 'wp-pv-note', nzT('enemiesError'))); return box; }

    box.appendChild(bloccoPillole(n));

    // ── Danno fatto, colpo di tutti ──────────────────────────────────
    const griglia = el('div', 'wp-pv-nz-numeri');
    const cella = (etichetta, valore, sotto, titolo) => {
      const c = el('div', 'wp-pv-nz-cella');
      c.appendChild(el('span', 'wp-pv-label', etichetta));
      const s = el('strong', null, valore);
      if (titolo) s.title = titolo;
      c.appendChild(s);
      if (sotto) c.appendChild(el('span', 'wp-pv-suggerimento', sotto));
      griglia.appendChild(c);
    };
    const oss = n.osservato || {};
    cella(nzT('dmgWeek'), compatto(n.danno?.settimana), null, num(n.danno?.settimana));
    cella(nzT('dmg24h'), compatto(oss.ultime24h),
      oss.ultime24h != null && oss.oreMisurate24h < 24 ? `${oss.oreMisurate24h} ${nzT('hours')} / 24` : null, num(oss.ultime24h));
    if (oss.piccoOra) {
      cella(nzT('dmgPeak'), compatto(oss.piccoOra.allOra), `${quando(oss.piccoOra.t)} · ${nzT('dmgPeakHint')}`, num(oss.piccoOra.allOra));
    }
    if (oss.giornoMax) cella(nzT('dmgBestDay'), compatto(oss.giornoMax.d), giornoBreve(oss.giornoMax.giorno), num(oss.giornoMax.d));
    const salva = n.salva || {};
    cella(nzT('volleyNow'), compatto(salva.adesso), nzT('volleyNowHint'), num(salva.adesso));
    cella(nzT('volleyMax'), compatto(salva.massimo), nzT('volleyMaxHint'), num(salva.massimo));
    box.appendChild(griglia);

    const piede = el('div', 'wp-pv-nz-nemico-piede');
    piede.appendChild(el('span', 'wp-pv-note', nzT('sourceNote')
      .replace('{n}', num(n.live)).replace('{ora}', ora(n.letto))));
    const aperto = tabelleAperte.has(n.id);
    piede.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small',
      aperto ? nzT('hidePlayers') : `${nzT('allPlayers')} (${num(n.censiti)})`, () => {
        if (aperto) tabelleAperte.delete(n.id); else tabelleAperte.add(n.id);
        ctx.ridisegna();
      }));
    box.appendChild(piede);
    if (aperto) box.appendChild(tabellaGiocatori(n.id));
    return box;
  }

  /**
   * Tutti i giocatori di un nemico, in una tabella che si cerca, si filtra
   * e si ordina. È un nodo che sopravvive ai ridisegni della vista e
   * ridisegna solo sé stesso: ricrearlo a ogni render toglierebbe il fuoco
   * al campo di ricerca a metà parola, e rileggerebbe centinaia di righe.
   * L'elenco arriva solo quando la si apre (la Germania ha 1.131 cittadini).
   */
  function tabellaGiocatori(nemicoId) {
    if (tabelle.has(nemicoId)) return tabelle.get(nemicoId);
    const PAGINA = 60;
    const st = { dati: null, errore: null, filtro: 'attivi', pill: 'tutte', ordine: 'colpo', q: '', mostra: PAGINA };
    const nodo = el('div', 'wp-pv-nz-tab');

    const barra = el('div', 'wp-pv-nz-tab-barra');
    const cerca = el('input', 'wp-pv-input');
    cerca.type = 'search'; cerca.placeholder = nzT('searchPlayer'); cerca.autocomplete = 'off'; cerca.maxLength = 40;
    const scelta = (opzioni, valore, imposta) => {
      const s = el('select', 'wp-pv-select wp-pv-select-piccola');
      for (const [v, t] of opzioni) {
        const o = el('option', null, t); o.value = v;
        if (v === valore) o.selected = true;
        s.appendChild(o);
      }
      s.addEventListener('change', () => { imposta(s.value); st.mostra = PAGINA; disegnaCorpo(); });
      return s;
    };
    barra.appendChild(cerca);
    barra.appendChild(scelta([['attivi', nzT('fltActive72')], ['tutti', nzT('fltAllPlayers')]], st.filtro, (v) => { st.filtro = v; }));
    barra.appendChild(scelta([['tutte', nzT('fltPillAny')], ['buff', nzT('pillOn')], ['malus', nzT('pillHangover')], ['pulito', nzT('pillClean')]],
      st.pill, (v) => { st.pill = v; }));
    barra.appendChild(scelta([['colpo', nzT('sortHit')], ['danno', nzT('sortWeek')], ['pillola', nzT('sortPill')]],
      st.ordine, (v) => { st.ordine = v; }));
    const corpo = el('div');
    nodo.appendChild(barra);
    nodo.appendChild(corpo);

    let tick = null;
    cerca.addEventListener('input', () => {
      clearTimeout(tick);
      tick = setTimeout(() => { st.q = cerca.value.trim().toLowerCase(); st.mostra = PAGINA; disegnaCorpo(); }, 150);
    });
    cerca.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    const PESO = { buff: 0, malus: 1, pulito: 2, ignoto: 3 };
    const ORDINI = {
      colpo: (a, b) => (b.perColpo ?? -1) - (a.perColpo ?? -1),
      danno: (a, b) => (b.settimana ?? -1) - (a.settimana ?? -1),
      // Prima chi è sotto pillola, dalla scadenza più vicina: è chi cambia
      // forza per primo. Poi i malus, dal primo che torna normale.
      pillola: (a, b) => ((PESO[a.pillola] ?? 9) - (PESO[b.pillola] ?? 9)) || ((a.fine ?? Infinity) - (b.fine ?? Infinity)),
    };

    function disegnaCorpo() {
      corpo.textContent = '';
      if (st.errore) { corpo.appendChild(el('p', 'wp-pv-error', st.errore)); return; }
      if (!st.dati) { corpo.appendChild(el('p', 'wp-pv-note', '…')); return; }
      let righe = st.dati.giocatori || [];
      if (st.filtro === 'attivi') righe = righe.filter((g) => g.attivo);
      if (st.pill !== 'tutte') righe = righe.filter((g) => g.pillola === st.pill);
      if (st.q) righe = righe.filter((g) => String(g.nome || '').toLowerCase().includes(st.q));
      righe = [...righe].sort(ORDINI[st.ordine] || ORDINI.colpo);

      const lista = el('div', 'wp-pv-nz-tab-lista');
      const testa = el('div', 'wp-pv-nz-tab-riga wp-pv-nz-tab-testa');
      for (const [t, numerica] of [[nzT('colPlayer')], [nzT('colPill')], [nzT('colHit'), 1],
        [nzT('colHitMax'), 1], [nzT('colWeek'), 1], [nzT('colSeen'), 1]]) {
        testa.appendChild(el('span', numerica ? 'wp-pv-nz-tab-num' : null, t));
      }
      lista.appendChild(testa);
      for (const g of righe.slice(0, st.mostra)) lista.appendChild(rigaGiocatore(g));
      corpo.appendChild(lista);

      const piede = el('div', 'wp-pv-nz-tab-piede');
      piede.appendChild(el('span', 'wp-pv-note', nzT('shownOf')
        .replace('{n}', num(Math.min(st.mostra, righe.length))).replace('{tot}', num(righe.length))));
      if (righe.length > st.mostra) {
        piede.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', nzT('showMore'), () => { st.mostra += PAGINA * 2; disegnaCorpo(); }));
      }
      corpo.appendChild(piede);
    }

    leggiGiocatoriNemico(nemicoId, { asAccount: ctx.lente(), paese: paeseScelto })
      .then((d) => { st.dati = d; disegnaCorpo(); })
      .catch((err) => { st.errore = messaggioErrore(err); disegnaCorpo(); });
    disegnaCorpo();
    tabelle.set(nemicoId, nodo);
    return nodo;
  }

  function rigaGiocatore(g) {
    const r = el('div', 'wp-pv-nz-tab-riga');
    const chi = personaEl(g.avatar, g.nome, g.livello != null ? `${nzT('lv')}${g.livello}` : null);
    // Tutti si leggono dal vivo; chi non ha risposto viene dal censimento,
    // che può avere ore, e si segna: la sua pillola potrebbe essere cambiata.
    if (g.fonte === 'censimento') chi.appendChild(el('span', 'wp-pv-nz-tag wp-pv-nz-tag-avviso', nzT('censusTag')));
    r.appendChild(chi);

    const pill = el('span', 'wp-pv-nz-tab-pill');
    const etichette = { buff: nzT('pillOn'), malus: nzT('pillHangover'), pulito: nzT('pillClean'), ignoto: nzT('pillUnknown') };
    pill.appendChild(el('span', `wp-pv-nz-pill-tag wp-pv-nz-pill-tag-${g.pillola}`, etichette[g.pillola] || g.pillola));
    if (g.fine) {
      const f = el('span', 'wp-pv-suggerimento', `→ ${ora(g.fine)}`);
      f.title = relativo(g.fine);
      pill.appendChild(f);
    }
    r.appendChild(pill);
    r.appendChild(el('span', 'wp-pv-nz-tab-num', g.perColpo == null ? '—' : num(g.perColpo)));
    r.appendChild(el('span', 'wp-pv-nz-tab-num', g.perColpoMax == null ? '—' : num(g.perColpoMax)));
    r.appendChild(el('span', 'wp-pv-nz-tab-num', compatto(g.settimana)));
    r.appendChild(el('span', 'wp-pv-nz-tab-num wp-pv-suggerimento', g.visto ? relativo(g.visto) : '—'));
    return r;
  }

  // ── Schede aggiunte l'11/09: più numeri sulla nazione ─────────────
  // Tutte da dati che il server ha già (vedi le forma* in nazione.js):
  // nessuna di queste costa una chiamata al gioco. Ognuna, se il suo pezzo
  // manca, scrive "non disponibile" al posto suo senza portarsi dietro le
  // altre.

  const nonDisponibile = (card) => { card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server'))); return card; };

  function scheda(titolo, corpo) {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', titolo));
    if (corpo) card.appendChild(el('p', 'wp-pv-body', corpo));
    return card;
  }

  function tessere(voci, cls = '') {
    const box = el('div', `wp-pv-totali wp-pv-nz-tessere ${cls}`);
    for (const [etichetta, valore, sotto, titolo] of voci) {
      const v = el('div', 'wp-pv-totale-voce');
      v.appendChild(el('span', 'wp-pv-label', etichetta));
      const s = el('strong', 'wp-pv-totale-val', valore);
      if (titolo) s.title = titolo;
      v.appendChild(s);
      if (sotto) v.appendChild(el('span', 'wp-pv-suggerimento', sotto));
      box.appendChild(v);
    }
    return box;
  }

  /** Tesoro, giocatori attivi e danno al giorno, due settimane. */
  function cardStorico() {
    const card = scheda(nzT('histTitle'));
    const st = dati.storico;
    const p = dati.paese;
    const tre = el('div', 'wp-pv-nz-tre');

    const pannello = (titolo, valore, variazioni, grafico) => {
      const b = el('div', 'wp-pv-nz-pannello');
      const t = el('div', 'wp-pv-nz-pannello-testa');
      t.appendChild(el('span', 'wp-pv-label', titolo));
      t.appendChild(el('strong', 'wp-pv-nz-pannello-val', valore));
      for (const [etich, v] of variazioni || []) {
        if (v == null) continue;
        t.appendChild(el('span', `wp-pv-nz-var${v > 0 ? ' wp-pv-nz-var-su' : v < 0 ? ' wp-pv-nz-var-giu' : ''}`,
          `${v > 0 ? '+' : ''}${num(v)} ${etich}`));
      }
      b.appendChild(t);
      b.appendChild(grafico);
      return b;
    };

    tre.appendChild(pannello(nzT('kTreasury'), num(p.tesoro),
      [[nzT('in24h'), st?.tesoro24h], [nzT('in7d'), st?.tesoro7g]],
      graficoLinea(st?.tesoro, { etichetta: nzT('kTreasury'), formato: num })));
    tre.appendChild(pannello(nzT('kActivePop'), num(p.popolazioneAttiva?.valore),
      [[nzT('in7d'), st?.popolazione7g]],
      graficoLinea(st?.popolazione, { etichetta: nzT('kActivePop'), formato: num, gradino: true })));

    const giorni = (dati.orario?.giorni || []).slice(-14);
    const pieni = giorni.filter((g) => !g.parziale && g.d != null);
    const media = pieni.length ? pieni.reduce((t, g) => t + g.d, 0) / pieni.length : null;
    tre.appendChild(pannello(nzT('histDailyDamage'), media != null ? `${compatto(media)} ${nzT('perDay')}` : '—', null,
      graficoBarre(giorni.map((g) => ({
        etichetta: giornoBreve(g.giorno),
        valori: [g.d || 0],
        parziale: g.parziale,
        suggerimento: {
          titolo: `${nzT('histDailyDamage')} · ${giornoBreve(g.giorno)}`,
          righe: [
            [nzT('tipDamage'), g.d == null ? nzT('tipNotMeasured') : num(g.d), 'var(--pv-accent)'],
            [nzT('tipMeasured'), `${g.ore}/24 ${nzT('hours')}`],
          ],
          nota: g.parziale ? nzT('tipPartialDay') : null,
        },
      })), { etichetta: nzT('histDailyDamage') })));

    card.appendChild(tre);
    card.appendChild(el('p', 'wp-pv-suggerimento', nzT('histHint')));
    return card;
  }

  /** Chi c'è, chi gioca, come: dal censimento. */
  function cardCittadini() {
    const c = dati.cittadini;
    const card = scheda(nzT('citTitle'));
    if (!c) return nonDisponibile(card);
    card.appendChild(tessere([
      [nzT('citTotal'), num(c.censiti), c.nuovi7g != null ? `+${num(c.nuovi24h)} ${nzT('in24h')} · +${num(c.nuovi7g)} ${nzT('in7d')}` : null],
      [nzT('citActive'), num(c.attivi24h), `${nzT('in24h')} · ${num(c.attivi72h)} ${nzT('in72h')} · ${num(c.attivi7g)} ${nzT('in7d')}`],
      [nzT('citWealth'), compatto(c.ricchezzaTotale), `${nzT('citWealthAvg')} ${compatto(c.ricchezzaMedia)}`, num(c.ricchezzaTotale)],
    ], 'wp-pv-nz-tessere-strette'));

    const stile = el('div', 'wp-pv-nz-sezione');
    stile.appendChild(el('h3', 'wp-pv-h3', nzT('citStyle')));
    stile.appendChild(barraFette([
      { n: c.stile.war, etichetta: nzT('ps_war'), cls: 'wp-pv-nz-f-guerra' },
      { n: c.stile.mixed, etichetta: nzT('ps_mixed'), cls: 'wp-pv-nz-f-misto' },
      { n: c.stile.eco, etichetta: nzT('ps_eco'), cls: 'wp-pv-nz-f-eco' },
      { n: c.stile.undecided, etichetta: nzT('ps_undecided'), cls: 'wp-pv-nz-f-nessuno' },
    ]));
    card.appendChild(stile);

    const liv = el('div', 'wp-pv-nz-sezione');
    liv.appendChild(el('h3', 'wp-pv-h3', nzT('citLevels')));
    const max = Math.max(1, ...c.livelli.map((l) => l.n));
    const isto = el('div', 'wp-pv-nz-isto');
    for (const l of c.livelli) {
      const col = el('div', 'wp-pv-nz-isto-col');
      legaTip(col, () => ({
        titolo: `${nzT('citLevels')} ${l.da}${l.a ? `–${l.a}` : '+'}`,
        righe: [[nzT('tipPlayers'), `${num(l.n)} · ${Math.round((l.n / (c.censiti || 1)) * 100)}%`]],
      }));
      col.appendChild(el('span', 'wp-pv-nz-isto-n', num(l.n)));
      const b = el('span', 'wp-pv-nz-isto-barra');
      b.style.height = `${Math.round((l.n / max) * 100)}%`;
      col.appendChild(b);
      col.appendChild(el('span', 'wp-pv-nz-isto-et', l.a ? `${l.da}–${l.a}` : `${l.da}+`));
      isto.appendChild(col);
    }
    liv.appendChild(isto);
    card.appendChild(liv);
    if (c.aggiornatoIl) card.appendChild(el('p', 'wp-pv-suggerimento', `${nzT('citCensus')} ${quando(c.aggiornatoIl)}`));
    return card;
  }

  /**
   * La nostra forza accanto a quella di ogni nemico: pillole e un colpo a
   * testa, letti nello stesso modo e nello stesso momento. È la domanda
   * che la pagina dei nemici non poteva fare da sola: "tanti" rispetto a
   * che cosa.
   */
  function cardForza() {
    const card = scheda(nzT('forceTitle'), nzT('forceBody'));
    if (erroreNemici) { card.appendChild(el('p', 'wp-pv-note', erroreNemici)); return card; }
    if (!nemici) { card.appendChild(el('p', 'wp-pv-note', caricamentoNemici ? nzT('enemiesLoading') : '…')); return card; }
    const noi = nemici.noi;
    if (!noi) { card.appendChild(el('p', 'wp-pv-note', nzT('enemiesError'))); return card; }

    card.appendChild(bloccoPillole(noi));

    const righe = [{ ...noi, noi: true }, ...(nemici.nemici || []).filter((n) => n.salva)];
    const max = Math.max(1, ...righe.map((r) => r.salva?.massimo || 0));
    const confronto = el('div', 'wp-pv-nz-confronto');
    const testa = el('div', 'wp-pv-nz-confronto-riga wp-pv-nz-confronto-testa');
    for (const t of ['', nzT('volleyNow'), nzT('pillOn'), nzT('pillHangover'), nzT('citActive')]) testa.appendChild(el('span', null, t));
    confronto.appendChild(testa);
    for (const r of righe) {
      const riga = el('div', `wp-pv-nz-confronto-riga${r.noi ? ' wp-pv-nz-noi' : ''}`);
      const chi = gettonePaese(r.id);
      if (r.noi) chi.appendChild(el('span', 'wp-pv-nz-tag', nzT('forceUs')));
      riga.appendChild(chi);
      // Due barre sovrapposte: piena = adesso, chiara = con la pillola.
      const barra = el('div', 'wp-pv-nz-confronto-barra');
      legaTip(riga, () => ({
        titolo: nomeNazione(r.id) || '?',
        righe: [
          [nzT('volleyNow'), num(r.salva?.adesso), 'var(--pv-accent)'],
          [nzT('volleyMax'), num(r.salva?.massimo)],
          [nzT('pillOn'), num(r.pillole?.buff), '#f0b429'],
          [nzT('pillHangover'), num(r.pillole?.malus), 'var(--pv-danger)'],
          [nzT('citActive'), num(r.attivi72h)],
        ],
        nota: nzT('volleyNowHint'),
      }));
      const pieno = el('span', 'wp-pv-nz-confronto-max');
      pieno.style.width = `${((r.salva?.massimo || 0) / max) * 100}%`;
      const ora2 = el('span', 'wp-pv-nz-confronto-ora');
      ora2.style.width = `${((r.salva?.adesso || 0) / max) * 100}%`;
      const col = r.noi ? null : coloreNazione(r.id);
      if (col) ora2.style.background = col;
      barra.appendChild(pieno); barra.appendChild(ora2);
      const cella = el('div', 'wp-pv-nz-confronto-cella');
      cella.appendChild(barra);
      cella.appendChild(el('span', 'wp-pv-nz-tab-num', `${compatto(r.salva?.adesso)} → ${compatto(r.salva?.massimo)}`));
      riga.appendChild(cella);
      riga.appendChild(el('span', 'wp-pv-nz-tab-num wp-pv-nz-pv-buff', num(r.pillole?.buff)));
      riga.appendChild(el('span', 'wp-pv-nz-tab-num wp-pv-nz-pv-malus', num(r.pillole?.malus)));
      riga.appendChild(el('span', 'wp-pv-nz-tab-num', num(r.attivi72h)));
      confronto.appendChild(riga);
    }
    card.appendChild(confronto);
    card.appendChild(el('p', 'wp-pv-suggerimento', `${nzT('volleyNowHint')} · ${nzT('volleyMax')}: ${nzT('volleyMaxHint')}`));

    const piede = el('div', 'wp-pv-nz-nemico-piede');
    piede.appendChild(el('span', 'wp-pv-note', nzT('sourceNote').replace('{n}', num(noi.live)).replace('{ora}', ora(noi.letto))));
    const aperto = tabelleAperte.has(noi.id);
    piede.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small',
      aperto ? nzT('hidePlayers') : `${nzT('ourPlayers')} (${num(noi.censiti)})`, () => {
        if (aperto) tabelleAperte.delete(noi.id); else tabelleAperte.add(noi.id);
        ctx.ridisegna();
      }));
    card.appendChild(piede);
    if (aperto) card.appendChild(tabellaGiocatori(noi.id));
    return card;
  }

  /** I nostri che fanno più danno, e i più ricchi. */
  function cardTop() {
    const c = dati.cittadini;
    const card = scheda(nzT('topTitle'));
    if (!c) return nonDisponibile(card);
    const elenco = (titolo, righe, valore) => {
      const sez = el('div', 'wp-pv-nz-sezione');
      sez.appendChild(el('h3', 'wp-pv-h3', titolo));
      const lista = el('div', 'wp-pv-nz-classifica');
      righe.forEach((g, i) => {
        const r = el('div', 'wp-pv-nz-classifica-riga');
        r.appendChild(el('span', 'wp-pv-nz-pos', String(i + 1)));
        r.appendChild(personaEl(g.avatar, g.nome, g.livello != null ? `${nzT('lv')}${g.livello}` : null));
        r.appendChild(el('span', 'wp-pv-nz-tab-num', valore(g)));
        lista.appendChild(r);
      });
      sez.appendChild(lista);
      return sez;
    };
    card.appendChild(elenco(nzT('topDamage'), c.topDanno, (g) => compatto(g.settimana)));
    card.appendChild(elenco(nzT('topWealth'), c.topRicchezza, (g) => compatto(g.ricchezza)));
    return card;
  }

  /** Le unità militari: registrate da noi e nostre di fatto. */
  function cardUnita() {
    const u = dati.unita;
    const card = scheda(nzT('muTitle'));
    if (!u) return nonDisponibile(card);
    card.appendChild(tessere([
      [nzT('muUnits'), num(u.n), `${num(u.registrate)} ${nzT('muRegistered')} · ${num(u.deFatto)} ${nzT('muDeFacto')}`],
      [nzT('muMembers'), num(u.membri), `${compatto(u.dannoSettimana)} ${nzT('dmgWeek')}`],
    ], 'wp-pv-nz-tessere-strette'));
    const lista = el('div', 'wp-pv-nz-classifica');
    u.top.forEach((m, i) => {
      const r = el('div', 'wp-pv-nz-classifica-riga');
      r.appendChild(el('span', 'wp-pv-nz-pos', String(i + 1)));
      const chi = personaEl(m.avatar, m.nome, `${num(m.membri)} ${nzT('muMembers')}`);
      // "Di fatto": registrata altrove ma coi membri in maggioranza nostri.
      if (!m.registrata) chi.appendChild(el('span', 'wp-pv-nz-tag', nzT('deFactoTag')));
      r.appendChild(chi);
      r.appendChild(el('span', 'wp-pv-nz-tab-num', compatto(m.dannoSettimana)));
      lista.appendChild(r);
    });
    card.appendChild(lista);
    return card;
  }

  /** Tutte le classifiche della nazione, e le risorse strategiche. */
  function cardClassifiche() {
    const p = dati.paese;
    const card = scheda(nzT('rankTitle'));
    const totale = state_nazioni();
    const voci = [
      ['kTreasury', p.tesoroRank, num],
      ['kActivePop', p.popolazioneAttiva, num],
      ['kDevelopment', p.sviluppo, (v) => Number(v).toFixed(1)],
      ['kDamageWeek', p.dannoSettimana, compatto],
      ['kPerCitizen', p.dannoPerCittadino, compatto],
      ['rkDamageTotal', p.dannoTotale, compatto],
      ['kProduction', p.bonusProduzione, (v) => `${v}%`],
      ['rkRegions', p.regioniDiff, (v) => `${v > 0 ? '+' : ''}${v}`],
    ];
    const lista = el('div', 'wp-pv-nz-classifica');
    for (const [chiave, r, formato] of voci) {
      if (!r) continue;
      const riga = el('div', 'wp-pv-nz-classifica-riga');
      riga.appendChild(el('span', `wp-pv-nz-tier wp-pv-nz-tier-${TIER_ORDINE.includes(r.tier) ? r.tier : 'bronze'}`, r.rank ? `#${r.rank}` : '—'));
      riga.appendChild(el('span', 'wp-pv-nz-classifica-nome', nzT(chiave)));
      riga.appendChild(el('span', 'wp-pv-nz-tab-num', r.valore != null ? formato(r.valore) : '—'));
      if (totale && r.rank) riga.title = `#${r.rank} / ${totale}`;
      lista.appendChild(riga);
    }
    card.appendChild(lista);

    const ris = el('div', 'wp-pv-nz-sezione');
    ris.appendChild(el('h3', 'wp-pv-h3', nzT('resTitle')));
    const chips = el('div', 'wp-pv-nz-chips');
    for (const [codice, n] of Object.entries(p.risorse || {})) {
      if (n) chips.appendChild(el('span', 'wp-pv-nz-tag', `${codice} ×${n}`));
    }
    if (!chips.childElementCount) chips.appendChild(el('span', 'wp-pv-note', nzT('relNone')));
    ris.appendChild(chips);
    const bonus = p.bonusStrategici || {};
    const righe = [];
    if (bonus.productionPercent) righe.push(`${nzT('kProduction')} +${bonus.productionPercent}%`);
    if (bonus.developmentPercent) righe.push(`${nzT('kDevelopment')} +${bonus.developmentPercent}%`);
    if (p.specializzazione) righe.push(`${nzT('specialized')}: ${p.specializzazione}`);
    if (righe.length) ris.appendChild(el('p', 'wp-pv-suggerimento', righe.join(' · ')));
    card.appendChild(ris);
    return card;
  }

  // Quante nazioni ci sono, per scrivere "#9 su 180": già in memoria dal
  // boot della mappa, nessuna richiesta.
  function state_nazioni() {
    return state.nationMap?.size || null;
  }

  /** Trenta giorni di guerra: come sono andate, contro chi, quanto è costata. */
  function cardGuerra() {
    const g = dati.guerra;
    const card = scheda(nzT('warTitle'));
    if (!g) return nonDisponibile(card);
    card.appendChild(tessere([
      [nzT('warBattles'), num(g.battaglie), `${num(g.vinte)} ${nzT('warWon')} · ${num(g.perse)} ${nzT('warLost')}`],
      [nzT('warAttacks'), num(g.attacchi), `${num(g.difese)} ${nzT('warDefenses')}`],
      [nzT('warDmgDone'), compatto(g.dannoFatto), `${compatto(g.dannoSubito)} ${nzT('warDmgTaken')}`, num(g.dannoFatto)],
      [nzT('warSpend'), compatto(g.spese.ultimi30g), `${compatto(g.spese.ultimi7g)} ${nzT('warSpend7')}`, num(g.spese.ultimi30g)],
    ], 'wp-pv-nz-tessere-strette'));

    if (g.avversari.length) {
      const sez = el('div', 'wp-pv-nz-sezione');
      sez.appendChild(el('h3', 'wp-pv-h3', nzT('warOpponents')));
      for (const a of g.avversari) {
        const r = el('div', 'wp-pv-nz-avversario');
        r.appendChild(gettonePaese(a.paese));
        r.appendChild(el('span', 'wp-pv-nz-tab-num', `${a.vinte}–${a.battaglie - a.vinte}`));
        // Il danno dei due lati in una barra sola: dove sta il confine fra
        // i due colori è chi ha picchiato di più.
        const tot = (a.dannoNoi + a.dannoLoro) || 1;
        const barra = el('div', 'wp-pv-nz-scontro');
        const noi = el('span', 'wp-pv-nz-scontro-noi'); noi.style.width = `${(a.dannoNoi / tot) * 100}%`;
        const loro = el('span', 'wp-pv-nz-scontro-loro'); loro.style.width = `${(a.dannoLoro / tot) * 100}%`;
        const col = coloreNazione(a.paese); if (col) loro.style.background = col;
        legaTip(r, () => ({
          titolo: `${nzT('warOpponents')}: ${nomeNazione(a.paese) || '?'}`,
          righe: [
            [nzT('warBattles'), `${num(a.battaglie)} · ${num(a.vinte)} ${nzT('warWon')} · ${num(a.battaglie - a.vinte)} ${nzT('warLost')}`],
            [nzT('forceUs'), num(a.dannoNoi), 'var(--pv-accent)'],
            [nomeNazione(a.paese) || '?', num(a.dannoLoro), col || 'var(--pv-danger)'],
          ],
        }));
        barra.appendChild(noi); barra.appendChild(loro);
        r.appendChild(barra);
        sez.appendChild(r);
      }
      card.appendChild(sez);
    }

    const spese = el('div', 'wp-pv-nz-sezione');
    spese.appendChild(el('h3', 'wp-pv-h3', nzT('warSpend')));
    spese.appendChild(graficoBarre(g.spese.giorni.map((d) => ({
      etichetta: giornoBreve(d.giorno),
      valori: [d.taglie, d.contratti],
      suggerimento: {
        titolo: `${nzT('warSpend')} · ${giornoBreve(d.giorno)}`,
        righe: [
          [nzT('warBounty'), num(d.taglie), '#d99a0b'],
          [`${nzT('warContracts')} (${num(d.nContratti)})`, num(d.contratti), 'var(--pv-accent)'],
          [nzT('warBattles'), num(d.battaglie)],
        ],
      },
    })), { etichetta: nzT('warSpend'), classi: ['wp-pv-nz-barra-taglie', 'wp-pv-nz-barra-contratti'] }));
    const leg = el('div', 'wp-pv-nz-legenda');
    for (const [cls, t] of [['wp-pv-nz-barra-taglie', nzT('warBounty')], ['wp-pv-nz-barra-contratti', nzT('warContracts')]]) {
      const v = el('span', 'wp-pv-nz-legenda-voce'); v.appendChild(el('i', cls)); v.appendChild(el('span', null, t)); leg.appendChild(v);
    }
    spese.appendChild(leg);
    card.appendChild(spese);

    if (g.ultime.length) {
      const sez = el('div', 'wp-pv-nz-sezione');
      sez.appendChild(el('h3', 'wp-pv-h3', nzT('warLast')));
      for (const b of g.ultime) {
        const r = el('div', 'wp-pv-nz-ultima');
        r.appendChild(el('span', 'wp-pv-suggerimento', quando(b.fine)));
        r.appendChild(el('strong', null, b.regione || '?'));
        r.appendChild(el('span', `wp-pv-nz-lato wp-pv-nz-lato-${b.lato}`, b.lato === 'attacker' ? nzT('weAttack') : nzT('weDefend')));
        r.appendChild(gettonePaese(b.avversario));
        r.appendChild(el('span', `wp-pv-nz-esito ${b.vinta ? 'wp-pv-nz-esito-v' : 'wp-pv-nz-esito-p'}`, b.vinta ? nzT('warWin') : nzT('warLoss')));
        r.appendChild(el('span', 'wp-pv-nz-tab-num', `${compatto(b.dannoNoi)} / ${compatto(b.dannoLoro)}`));
        sez.appendChild(r);
      }
      card.appendChild(sez);
    }
    return card;
  }

  /** Le ultime elezioni, quelle in corso e le prossime (stimate). */
  function cardElezioni() {
    const e = dati.elezioni;
    const card = scheda(nzT('elTitle'));
    if (!e) return nonDisponibile(card);
    for (const x of e.inCorso || []) {
      card.appendChild(el('p', 'wp-pv-nz-in-corso',
        `${nzT('elNow')}: ${x.tipo === 'president' ? nzT('elPresident') : nzT('elCongress')} · ${quando(x.inizio)} → ${quando(x.fine)}`));
    }
    const blocco = (titolo, x, righe) => {
      const b = el('div', 'wp-pv-nz-elezione');
      const t = el('div', 'wp-pv-nz-elezione-testa');
      t.appendChild(el('strong', null, titolo));
      if (x?.inizio) t.appendChild(el('span', 'wp-pv-suggerimento', giornoBreve(new Date(x.inizio).toISOString().slice(0, 10))));
      b.appendChild(t);
      for (const r of righe) if (r) b.appendChild(r);
      return b;
    };
    if (e.presidente) {
      const v = e.presidente.vincitore;
      card.appendChild(blocco(nzT('elPresident'), e.presidente, [
        v ? personaEl(v.avatar, v.nome, `${nzT('elWinner')} · ${num(v.voti)} / ${num(e.presidente.voti)} ${nzT('elVotes')}`) : null,
        el('span', 'wp-pv-suggerimento', `${num(e.presidente.candidati)} ${nzT('elCandidates')}`),
      ]));
    }
    if (e.congresso) {
      card.appendChild(blocco(nzT('elCongress'), e.congresso, [
        el('span', null, `${num(e.congresso.eletti)} ${nzT('elElected')} · ${num(e.congresso.voti)} ${nzT('elVotes')} · ${num(e.congresso.candidati)} ${nzT('elCandidates')}`),
      ]));
    }
    const prossime = [];
    if (e.prossime?.presidente) prossime.push(`${nzT('elPresident')} ${quando(e.prossime.presidente)}`);
    if (e.prossime?.congresso) prossime.push(`${nzT('elCongress')} ${quando(e.prossime.congresso)}`);
    if (prossime.length) card.appendChild(el('p', 'wp-pv-note', `${nzT('elNext')}: ${prossime.join(' · ')}`));
    return card;
  }

  // ── 4. Attività: battaglie, ore, bonifici ─────────────────────────
  function cardAttivita() {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('ourBattles')));

    const bt = dati.battaglie;
    if (bt == null) card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server')));
    else if (!bt.length) card.appendChild(el('p', 'wp-pv-note', nzT('noOurBattles')));
    else {
      const lista = el('div', 'wp-pv-nz-battaglie');
      for (const b of bt) lista.appendChild(rigaBattaglia(b));
      card.appendChild(lista);
    }

    const ore = el('div', 'wp-pv-nz-sezione');
    ore.appendChild(el('h3', 'wp-pv-h3', nzT('hourlyTitle')));
    ore.appendChild(graficoOrario(dati.orario));
    ore.appendChild(el('p', 'wp-pv-suggerimento', nzT('hourlyHint')));
    card.appendChild(ore);

    if (dati.bonifici) card.appendChild(bloccoBonifici(dati.bonifici));
    return card;
  }

  function rigaBattaglia(b) {
    const box = el('div', 'wp-pv-nz-battaglia');
    const testa = el('div', 'wp-pv-nz-battaglia-testa');
    testa.appendChild(el('strong', null, b.regione || '?'));
    testa.appendChild(el('span', `wp-pv-nz-lato wp-pv-nz-lato-${b.lato}`, b.lato === 'attacker' ? nzT('weAttack') : nzT('weDefend')));
    testa.appendChild(gettonePaese(b.avversario));
    testa.appendChild(el('span', 'wp-pv-nz-round',
      `${b.round.noi}–${b.round.loro}${b.round.perVincere ? ` / ${b.round.perVincere}` : ''} ${nzT('rounds')}`));
    box.appendChild(testa);

    const massimo = Math.max(1, b.danno.noi, b.danno.loro);
    for (const [countryId, danno, noi] of [[dati.paese.id, b.danno.noi, true], [b.avversario, b.danno.loro, false]]) {
      const riga = el('div', 'wp-pv-btl-parte');
      const capo = el('div', 'wp-pv-btl-capo');
      const f = bandiera(countryId, 'wp-pv-btl-bandiera'); if (f) capo.appendChild(f);
      capo.appendChild(el('strong', 'wp-pv-btl-nazione', nomeNazione(countryId) || '?'));
      riga.appendChild(capo);
      const barra = el('div', 'wp-pv-btl-barra');
      const dentro = el('div', 'wp-pv-btl-barra-piena');
      dentro.style.width = `${Math.round((danno / massimo) * 100)}%`;
      const col = noi ? null : coloreNazione(countryId);
      if (col) dentro.style.background = col;
      barra.appendChild(dentro);
      riga.appendChild(barra);
      riga.appendChild(el('span', 'wp-pv-btl-danno', num(danno)));
      box.appendChild(riga);
    }
    return box;
  }

  /**
   * Le ultime 48 ore in un SVG scritto a mano, come i grafici di
   * Statistiche nazioni (niente Chart.js per venti barre). Barre = danno
   * dello slot, linea = pillati, su due scale diverse e dichiarate ai due
   * lati. Un secchio senza misura resta un BUCO, mai una barra a zero.
   */
  function graficoOrario(orario) {
    const serie = orario?.serie || [];
    if (!serie.some((p) => p.d != null || p.p != null)) return el('p', 'wp-pv-note', nzT('hourlyEmpty'));

    const NS = 'http://www.w3.org/2000/svg';
    const W = 640; const H = 130; const SU = 14; const GIU = 18;
    const t0 = serie[0].t; const t1 = serie[serie.length - 1].to;
    const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const maxD = Math.max(1, ...serie.map((p) => p.d ?? 0));
    const maxP = Math.max(1, ...serie.map((p) => p.p ?? 0));
    const y = (v, max) => H - GIU - (v / max) * (H - SU - GIU);

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'wp-pv-nz-grafico');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', nzT('hourlyTitle'));
    const nodo = (tag, attrs, testo) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (testo != null) n.textContent = testo;
      svg.appendChild(n);
      return n;
    };

    nodo('line', { x1: 0, x2: W, y1: H - GIU, y2: H - GIU, class: 'wp-pv-nz-asse' });

    for (const p of serie) {
      if (p.d == null) continue;
      nodo('rect', {
        x: x(p.t) + 0.5, y: y(p.d, maxD),
        width: Math.max(1, x(p.to) - x(p.t) - 1), height: Math.max(0, H - GIU - y(p.d, maxD)),
        class: 'wp-pv-nz-barra',
      });
    }

    // La linea si spezza dove manca la misura: congiungere due punti
    // lontani inventerebbe un andamento che nessuno ha visto.
    let tratto = [];
    const chiudi = () => {
      if (tratto.length > 1) nodo('polyline', { points: tratto.join(' '), class: 'wp-pv-nz-linea' });
      tratto = [];
    };
    for (const p of serie) {
      if (p.p == null) { chiudi(); continue; }
      tratto.push(`${((x(p.t) + x(p.to)) / 2).toFixed(1)},${y(p.p, maxP).toFixed(1)}`);
    }
    chiudi();

    // Una tacca ogni sei ore, sull'ora locale di chi guarda.
    const SEI = 6 * 3600_000;
    for (let t = Math.ceil(t0 / SEI) * SEI; t < t1; t += SEI) {
      nodo('line', { x1: x(t), x2: x(t), y1: SU, y2: H - GIU, class: 'wp-pv-nz-tacca' });
      nodo('text', { x: x(t) + 2, y: H - 5, class: 'wp-pv-nz-testo' }, ora(t));
    }
    nodo('text', { x: 2, y: 10, class: 'wp-pv-nz-testo' }, compatto(maxD));
    nodo('text', { x: W - 2, y: 10, class: 'wp-pv-nz-testo wp-pv-nz-testo-pill', 'text-anchor': 'end' }, `${maxP} ${nzT('pillOn')}`);

    // Una colonna sensibile per ora, sopra tutto il resto: al passaggio del
    // mouse la finestra, il danno e i pillati di QUELL'ora.
    for (const p of serie) {
      const col = nodo('rect', { x: x(p.t), y: SU, width: Math.max(1, x(p.to) - x(p.t)), height: H - SU - GIU, class: 'wp-pv-nz-colonna' });
      legaTip(col, () => ({
        titolo: `${quando(p.t)} – ${ora(p.to)}`,
        righe: [
          [nzT('tipDamage'), p.d == null ? nzT('tipNotMeasured') : num(p.d), 'var(--pv-accent)'],
          ...(p.p != null ? [[nzT('pillOn'), num(p.p), '#f0b429']] : []),
        ],
      }));
    }

    const wrap = el('div', 'wp-pv-nz-grafico-wrap');
    wrap.appendChild(svg);
    return wrap;
  }

  function bloccoBonifici(b) {
    const box = el('div', 'wp-pv-nz-sezione');
    box.appendChild(el('h3', 'wp-pv-h3', `${nzT('transfersTitle')} · ${b.finestraOre} ${nzT('hours')}`));
    if (!b.entrati.length && !b.usciti.length) {
      box.appendChild(el('p', 'wp-pv-note', nzT('transfersNone')));
      box.appendChild(bloccoQuattordici(b));
      return box;
    }
    const due = el('div', 'wp-pv-nz-bonifici');
    for (const [titolo, righe, totale] of [
      [nzT('transfersIn'), b.entrati, b.totaleEntrati],
      [nzT('transfersOut'), b.usciti, b.totaleUsciti],
    ]) {
      const col = el('div', 'wp-pv-nz-bonifici-col');
      const t = el('div', 'wp-pv-nz-bonifici-testa');
      t.appendChild(el('span', 'wp-pv-label', titolo));
      t.appendChild(el('strong', null, num(totale)));
      col.appendChild(t);
      for (const r of righe.slice(0, 8)) {
        const riga = el('div', 'wp-pv-nz-bonifico');
        riga.appendChild(gettonePaese(r.paese));
        riga.appendChild(el('strong', null, num(r.soldi)));
        riga.appendChild(el('span', 'wp-pv-suggerimento', quando(r.at)));
        col.appendChild(riga);
      }
      due.appendChild(col);
    }
    box.appendChild(due);
    box.appendChild(bloccoQuattordici(b));
    return box;
  }

  /** Due settimane di bonifici per nazione: con chi scambiamo soldi, non
   *  solo le ultime righe. */
  function bloccoQuattordici(b) {
    const q = el('div', 'wp-pv-nz-bonifici-14');
    const t = b.quattordici;
    if (!t) return q;
    q.appendChild(el('span', 'wp-pv-label',
      `${nzT('trf14')} · ${nzT('transfersIn')} ${num(t.entrati)} · ${nzT('transfersOut')} ${num(t.usciti)}`));
    const chips = el('div', 'wp-pv-nz-chips');
    for (const p of t.partner || []) {
      chips.appendChild(gettonePaese(p.paese,
        [p.usciti ? `→ ${num(p.usciti)}` : null, p.entrati ? `← ${num(p.entrati)}` : null].filter(Boolean).join(' ')));
    }
    q.appendChild(chips);
    return q;
  }

  // ── 5. Regioni e confini ──────────────────────────────────────────
  function cardRegioni() {
    const conf = dati.confini;
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('regionsTitle')));
    if (!conf) { card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server'))); return card; }

    // Le nostre a sinistra, le confinanti a destra: è la frontiera vista
    // dai due lati, e sullo schermo largo sta tutta in una schermata.
    const due = el('div', 'wp-pv-nz-due');
    const proprie = el('div', 'wp-pv-nz-regioni');
    for (const r of conf.proprie) proprie.appendChild(rigaRegione(r, conf.pendingOre));
    due.appendChild(proprie);
    card.appendChild(due);

    const sez = el('div', 'wp-pv-nz-sezione wp-pv-nz-sezione-affiancata');
    sez.appendChild(el('h3', 'wp-pv-h3', nzT('bordersTitle')));
    sez.appendChild(el('p', 'wp-pv-suggerimento', nzT('bordersBody')));

    // Per nazione proprietaria, nemici in cima: è l'ordine in cui si
    // guarda una frontiera.
    const gruppi = new Map();
    for (const c of conf.confinanti) {
      if (!gruppi.has(c.ownerId)) gruppi.set(c.ownerId, { ownerId: c.ownerId, relazione: c.relazione, regioni: [] });
      gruppi.get(c.ownerId).regioni.push(c);
    }
    const ordinati = [...gruppi.values()].sort((a, b) =>
      (ORDINE_RELAZIONI.indexOf(a.relazione) - ORDINE_RELAZIONI.indexOf(b.relazione))
      || String(nomeNazione(a.ownerId) || '').localeCompare(String(nomeNazione(b.ownerId) || '')));

    for (const g of ordinati) {
      const gr = el('div', `wp-pv-nz-confine wp-pv-nz-confine-${g.relazione}`);
      const t = el('div', 'wp-pv-nz-confine-testa');
      t.appendChild(gettonePaese(g.ownerId));
      t.appendChild(badgeRelazione(g.relazione));
      gr.appendChild(t);
      for (const r of g.regioni) gr.appendChild(rigaRegione(r, conf.pendingOre, true));
      sez.appendChild(gr);
    }
    due.appendChild(sez);
    return card;
  }

  function rigaRegione(r, pendingOre, straniera = false) {
    const riga = el('div', 'wp-pv-nz-regione');
    const nome = el('div', 'wp-pv-nz-regione-nome');
    nome.appendChild(el('strong', null, r.nome));
    if (r.capitale) nome.appendChild(el('span', 'wp-pv-nz-tag', nzT('capital')));
    if (r.battaglia) nome.appendChild(el('span', 'wp-pv-nz-tag wp-pv-nz-tag-battaglia', nzT('inBattle')));
    if (!straniera && r.collegataCapitale === false) nome.appendChild(el('span', 'wp-pv-nz-tag wp-pv-nz-tag-avviso', nzT('notLinked')));
    riga.appendChild(nome);

    const dett = [];
    if (straniera && r.confinaCon?.length) dett.push(`${nzT('bordersWith')} ${r.confinaCon.join(', ')}`);
    if (!straniera) {
      if (r.sviluppo != null) dett.push(`${nzT('kDevelopment')} ${Number(r.sviluppo).toFixed(1)}`);
      if (r.resistenzaMax) dett.push(`${nzT('resistance')} ${Math.round((r.resistenza / r.resistenzaMax) * 100)}%`);
      if (r.giacimento) dett.push(`${nzT('deposit')} ${r.giacimento.tipo}${r.giacimento.bonus ? ` +${r.giacimento.bonus}%` : ''}`);
    }
    riga.appendChild(el('span', 'wp-pv-suggerimento wp-pv-nz-regione-dett', dett.join(' · ')));

    const difese = el('div', 'wp-pv-nz-difese');
    for (const tipo of ['base', 'bunker']) difese.appendChild(chipDifesa(tipo, r.difese?.[tipo], pendingOre));
    riga.appendChild(difese);
    return riga;
  }

  function chipDifesa(tipo, d, pendingOre) {
    // 'ignoto' arriva per le nazioni fuori sorveglianza, dove si sa solo
    // cosa è acceso: una costruzione spenta lì non si vede, e non la si
    // spaccia per "nessuna costruzione".
    const assente = !d || d.stato === 'assente' || d.stato === 'ignoto';
    const cls = assente ? 'none' : d.inCostruzione && !d.stato ? 'building' : (d.stato || 'none');
    const chip = el('span', `wp-pv-nz-df wp-pv-nz-df-${cls}`);
    chip.appendChild(el('span', 'wp-pv-nz-df-tipo', nzT(`tipo_${tipo}`)));
    if (assente) chip.appendChild(el('span', null, nzT('df_none')));
    else {
      let testo = `${nzT('lv')}${d.livello} ${nzT(`df_${cls === 'building' ? 'building' : (d.stato || 'none')}`)}`;
      if (d.bonus) testo += ` +${d.bonus}%`;
      if (d.inCostruzione && d.stato) testo += ` · ${nzT('df_building')}`;
      // L'ora in cui si accende la scrive il gioco (willBeActiveAt); la
      // stima da "cambio di stato + 12 ore" resta solo come ripiego.
      const acceso = d.attivoDal || (d.dal ? d.dal + pendingOre * 3600_000 : null);
      if (d.stato === 'pending' && acceso) testo += ` → ${ora(acceso)}`;
      chip.appendChild(el('span', null, testo));
    }
    chip.title = nzT(tipo === 'base' ? 'baseEffect' : 'bunkerEffect');
    return chip;
  }

  /** Carica senza disegnare: main.js la chiama quando si guarda un'altra
   *  pagina dell'area, perché gli allarmi nuovi compaiano sul bottone. */
  function precarica() {
    if (!dati && !caricamento && !errore && !negato) carica();
  }

  return { render, ricarica: carica, precarica, nuovi: () => (dati ? nuovi().length : 0) };
}
