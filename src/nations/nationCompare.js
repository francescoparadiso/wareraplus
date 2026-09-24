/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: confronto fra schieramenti (1 vs 2)
   ------------------------------------------------------------------
   Gemello del tab "Faction 1vs2" di Statistiche alleanze, un livello più
   in basso: lì si confrontano blocchi, qui le singole nazioni, che è la
   domanda pratica prima di una guerra ("noi due contro loro tre, come
   siamo messi?").

   SELEZIONE — DUE ELENCHI, UNO PER SCHIERAMENTO (richiesta esplicita
   dell'utente). Prima c'era un elenco solo con selezione a ciclo (un
   clic = A, due = B, tre = via), ereditata dal Faction 1vs2 delle
   alleanze: chi voleva mettere la seconda nazione in B la vedeva finire
   in A, perché il "due clic" è un'informazione che sta solo nella
   scritta di istruzioni. Ora ogni schieramento ha la SUA casella di
   ricerca e la sua griglia: si aggiunge dove si intende aggiungere, e
   basta. Un clic su una nazione già nel proprio schieramento la toglie;
   su una nazione dell'altro schieramento la SPOSTA (nessuna nazione può
   stare da entrambe le parti, altrimenti il confronto non vorrebbe dire
   niente).

   Le metriche sommate sono quelle di metrics.js — tasse e malcontento
   restano fuori, sommarli non vorrebbe dire niente (sono percentuali di
   cose diverse); si mostra invece la media.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { METRICS, metricValue } from './metrics.js';
import { versusBarHtml } from './charts.js';
import { escapeHtml, flagImg, fmtCompact } from '../mu/ui.js';

/* ══════════════════════════════════════════════════════════════
   WarEra+ — Chi è in vantaggio (come nel Faction 1 vs 2 delle alleanze)
   ------------------------------------------------------------------
   Ogni metrica ha un verso (`cmp` in metrics.js). Chi vince la riga va in
   grassetto col suo vantaggio (+34%, ×2,3 oltre il doppio, differenza
   quando c'è uno zero), il perdente si spegne; guerre, tasse e quote di
   build sono neutre. In cima un tabellone: chi è avanti in quante misure.
   Sotto, le BUILD dei giocatori (guerra/economia), dal censimento del
   server di cache: arrivano con una fetch per sessione, e finché non ci
   sono il gruppo non compare (mai zeri inventati).
   ══════════════════════════════════════════════════════════════ */
let _ps = null;          // /mu-playstyle-by-country, o {} se il server manca
let _psInCorso = false;

function caricaBuild(onReady) {
  if (_ps || _psInCorso) return;
  _psInCorso = true;
  import('../mu/api.js')
    .then(m => m.fetchPlaystyleByCountry())
    .then(d => { _ps = d || {}; onReady(); })
    .catch(() => { _ps = {}; });
}

function sommaBuild(list) {
  if (!_ps) return null;
  const out = { war: 0, eco: 0, mixed: 0, known: 0 };
  for (const n of list) {
    const c = _ps[n._id];
    if (!c?.known) continue;
    out.war += c.war || 0; out.eco += c.eco || 0; out.mixed += c.mixed || 0; out.known += c.known;
  }
  return out.known ? out : null;
}

function vantaggio(hi, lo, fmt) {
  if (lo > 0) {
    const r = hi / lo;
    return r >= 2 ? '×' + r.toFixed(1) : '+' + ((r - 1) * 100).toFixed(0) + '%';
  }
  return '+' + fmt(hi - lo);
}

const sost = (s, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split('{' + k + '}').join(String(v)), s);

// Percentuali: la somma non ha senso, si fa la media.
const AVERAGED = new Set(['taxes', 'unrest', 'dev', 'coreDev', 'perCit']);
// Fuori dal confronto: "regioni" è già un differenziale col segno, sommarlo
// fra nazioni diverse mescolerebbe guadagni e perdite non confrontabili.
const SKIPPED = new Set(['regions']);

export function renderNationCompare(host, ctx) {
  const { nations, sides } = ctx;   // sides: Map(countryId → 'a' | 'b')

  const listOf = side => nations.filter(n => sides.get(n._id) === side);
  const a = listOf('a');
  const b = listOf('b');

  const agg = (list, m) => {
    if (!list.length) return 0;
    const sum = list.reduce((s, n) => s + metricValue(n, m.key), 0);
    return AVERAGED.has(m.key) ? sum / list.length : sum;
  };

  const tally = { a: 0, b: 0, pari: 0, tot: 0 };
  const riga = (label, va, vb, fmt, cmp = 1) => {
    if (cmp === 0) return versusBarHtml({ label, a: va, b: vb, fmt, neutral: true });
    tally.tot++;
    // cmp -1: vince il valore più basso (malcontento).
    const aMeglio = cmp === 1 ? va > vb : va < vb;
    const bMeglio = cmp === 1 ? vb > va : vb < va;
    if (!aMeglio && !bMeglio) { tally.pari++; return versusBarHtml({ label, a: va, b: vb, fmt, lowerNote: cmp === -1 ? natT('vsLower') : '' }); }
    const win = aMeglio ? 'a' : 'b';
    tally[win]++;
    const hi = Math.max(va, vb), lo = Math.min(va, vb);
    // Dove vince il più basso il vantaggio è "quanto meno": differenza.
    const adv = cmp === -1 ? '−' + fmt(hi - lo) : vantaggio(hi, lo, fmt);
    return versusBarHtml({ label, a: va, b: vb, fmt, win, adv, lowerNote: cmp === -1 ? natT('vsLower') : '' });
  };

  const bothSides = a.length && b.length;
  let rows = METRICS.filter(m => !SKIPPED.has(m.key))
    .map(m => riga(natT(m.label), agg(a, m), agg(b, m), m.fmt, bothSides ? (m.cmp ?? 1) : 0))
    .join('');

  // Build dei giocatori: le QUOTE sono neutre, i CONTEGGI no (più giocatori
  // da guerra = più forza militare).
  if (bothSides) {
    if (!_ps) caricaBuild(() => { if (host.isConnected) renderNationCompare(host, ctx); });
    const pa = sommaBuild(a), pb = sommaBuild(b);
    if (pa && pb) {
      const pct = v => v.toFixed(1) + '%';
      const q = (p, k) => (p[k] / p.known) * 100;
      rows += `<li class="wp-nat-vs-group">${escapeHtml(natT('vsBuilds'))}</li>`
        + riga(natT('vsWarPct'), q(pa, 'war'), q(pb, 'war'), pct, 0)
        + riga(natT('vsEcoPct'), q(pa, 'eco'), q(pb, 'eco'), pct, 0)
        + riga(natT('vsWarN'), pa.war, pb.war, fmtCompact)
        + riga(natT('vsEcoN'), pa.eco, pb.eco, fmtCompact)
        + riga(natT('vsHybN'), pa.mixed, pb.mixed, fmtCompact, 0);
    }
  }

  const nomeLato = list => list.map(n => n.name).join(' + ');
  const tabellone = !bothSides
    ? `<p class="wp-nat-vs-note">${escapeHtml(natT('vsPick'))}</p>`
    : `<div class="wp-nat-score">
        ${['a', 'b'].map(l => {
          const vinte = tally[l], altre = tally[l === 'a' ? 'b' : 'a'];
          return `<div class="wp-nat-score-side wp-nat-score-${l}${vinte > altre ? ' lead' : ''}">
            <div class="wp-nat-score-n">${vinte}</div>
            <div class="wp-nat-score-name">${escapeHtml(nomeLato(l === 'a' ? a : b))}</div>
            <div class="wp-nat-score-sub">${escapeHtml(sost(natT('vsAhead'), { n: vinte, t: tally.tot }))}</div>
          </div>`;
        }).join(`<div class="wp-nat-score-mid">
            <div class="wp-nat-score-bar"><span class="a" style="width:${(tally.a / tally.tot) * 100}%"></span><span class="pari" style="width:${(tally.pari / tally.tot) * 100}%"></span><span class="b" style="width:${(tally.b / tally.tot) * 100}%"></span></div>
            ${tally.pari ? `<div class="wp-nat-score-even">${escapeHtml(natT('vsEven'))} · ${tally.pari}</div>` : ''}
          </div>`)}
      </div>
      <p class="wp-nat-vs-note">${escapeHtml(sost(natT('vsNote'), { t: tally.tot }))}</p>`;

  const chip = n => `
    <button type="button" class="wp-nat-chip wp-nat-chip-${sides.get(n._id)}" data-country="${escapeHtml(n._id)}">
      ${flagImg(n._id)}<span>${escapeHtml(n.name)}</span><span class="wp-nat-chip-x">✕</span>
    </button>`;

  // Un elenco per schieramento. Le nazioni già schierate restano visibili
  // (marcate con la tinta del lato in cui stanno): servono per togliere o
  // spostare senza doverle cercare fra i chip.
  const pickerHtml = (side) => {
    const query = (side === 'a' ? ctx.searchA : ctx.searchB) || '';
    const q = query.toLowerCase();
    const items = nations
      .filter(n => !q || n.name?.toLowerCase().includes(q))
      .slice()
      .sort((x, y) => metricValue(y, 'weekly') - metricValue(x, 'weekly'))
      .map(n => {
        const cur = sides.get(n._id);
        return `
          <button type="button" class="wp-nat-pick${cur ? ` wp-nat-pick-${cur}` : ''}" data-country="${escapeHtml(n._id)}" data-side="${side}">
            ${flagImg(n._id)}<span class="wp-nat-pick-name">${escapeHtml(n.name)}</span>
            <span class="wp-nat-pick-val">${escapeHtml(fmtCompact(metricValue(n, 'weekly')))}</span>
          </button>`;
      }).join('');
    return `
      <div class="wp-nat-picker wp-nat-picker-${side}">
        <h4>${escapeHtml(natT(side === 'a' ? 'sideA' : 'sideB'))}</h4>
        <input type="search" id="wp-nat-pick-search-${side}" class="wp-nat-search" data-side="${side}"
               placeholder="${escapeHtml(natT('search'))}" value="${escapeHtml(query)}">
        <div class="wp-nat-picker-grid">${items}</div>
      </div>`;
  };

  host.innerHTML = `
    <p class="wp-nat-hint">${escapeHtml(natT('pickSide'))}</p>

    <div class="wp-nat-sides">
      <div class="wp-nat-side wp-nat-side-a">
        <h4>${escapeHtml(natT('sideA'))} <span>${a.length}</span></h4>
        <div class="wp-nat-chips">${a.map(chip).join('') || `<span class="wp-nat-empty-inline">${escapeHtml(natT('noSelection'))}</span>`}</div>
      </div>
      <div class="wp-nat-side wp-nat-side-b">
        <h4>${escapeHtml(natT('sideB'))} <span>${b.length}</span></h4>
        <div class="wp-nat-chips">${b.map(chip).join('') || `<span class="wp-nat-empty-inline">${escapeHtml(natT('noSelection'))}</span>`}</div>
      </div>
      <button type="button" class="wp-nat-reset" id="wp-nat-reset">${escapeHtml(natT('reset'))}</button>
    </div>

    ${(a.length || b.length) ? `${tabellone}<ul class="wp-nat-vs">${rows}</ul>` : ''}

    <div class="wp-nat-pickers">
      ${pickerHtml('a')}
      ${pickerHtml('b')}
    </div>`;

  // Griglia: il lato è quello dell'elenco su cui si è cliccato.
  host.querySelectorAll('.wp-nat-pick').forEach(el => {
    el.addEventListener('click', () => ctx.onPick(el.dataset.country, el.dataset.side));
  });
  // Chip già schierato: il clic (o la ✕) lo toglie e basta.
  host.querySelectorAll('.wp-nat-chip').forEach(el => {
    el.addEventListener('click', () => ctx.onRemove(el.dataset.country));
  });
  host.querySelector('#wp-nat-reset')?.addEventListener('click', () => ctx.onResetSides());

  ['a', 'b'].forEach(side => {
    const searchEl = host.querySelector(`#wp-nat-pick-search-${side}`);
    if (!searchEl) return;
    searchEl.addEventListener('input', (e) => ctx.onSearch(side, e.target.value));
    // Rifocalizza solo la casella su cui si stava scrivendo: il render
    // ricostruisce l'HTML, e senza questo il cursore uscirebbe dal campo
    // ad ogni lettera (stesso trattamento dell'elenco panoramica).
    if (ctx.searchFocusedSide === side) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  });
}
