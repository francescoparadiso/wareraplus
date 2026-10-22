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

   STILE: dal 2026-10-18 il versus dei giocatori, comune a tutti i
   confronti (src/shared/versus.js), al posto delle barre "A contro B" di
   charts.js. Richiesta dell'utente: un modo solo di leggere un confronto.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { METRICS, metricValue } from './metrics.js';
import { escapeHtml, flagImg, fmtCompact } from '../mu/ui.js';
import { vsRow, vsGroup, vsTally, vsFighter, vsHero, countUpScore } from '../shared/versus.js';
import { animationsOn } from '../shared/motion.js';

let _lastSides = null;   // l'ultimo schieramento completo disegnato: l'intro parte solo su uno nuovo

/* ══════════════════════════════════════════════════════════════
   WarEra+ — Chi è in vantaggio (come nel Faction 1 vs 2 delle alleanze)
   ------------------------------------------------------------------
   Ogni metrica ha un verso (`cmp` in metrics.js). Chi vince la riga prende
   il colore del suo lato, il perdente si spegne; guerre, tasse e quote di
   build sono neutre (vsRow `neutral`), il malcontento vince col valore più
   basso (`lower`). In cima il punteggio: chi è avanti in quante misure.
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


const sost = (s, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split('{' + k + '}').join(String(v)), s);

// Percentuali: la somma non ha senso, si fa la media.
const AVERAGED = new Set(['taxes', 'unrest', 'dev', 'coreDev', 'perCit']);
// Fuori dal confronto: "regioni" è già un differenziale col segno, sommarlo
// fra nazioni diverse mescolerebbe guadagni e perdite non confrontabili.
const SKIPPED = new Set(['regions']);

/* ══════════════════════════════════════════════════════════════
   WarEra+ — Danno ora per ora e pillati dei due schieramenti
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-15): «nel 1vs2 delle nazioni abilita
   anche i grafici delle pill e damage come per le alleanze, ma anche qui
   sempre solo per chi fa parte di un governo in P.A.S.T.A.».
   È lo stesso modulo del Faction 1 vs 2 (diplomacy/blocDamageCurves.js),
   con i due gruppi = le nazioni di A e di B, nei colori dei due lati.
   Il cancello (governo P.A.S.T.A. o admin) sta TUTTO lì dentro: per gli
   altri il contenitore resta vuoto e non parte nessuna richiesta.

   Il render qui si rifà a ogni lettera digitata nelle caselle di ricerca:
   se gli schieramenti (e la lingua) non sono cambiati si rimette al suo
   posto il grafico già disegnato, invece di ridisegnarlo da "Caricamento…"
   ad ogni tasto.
   ══════════════════════════════════════════════════════════════ */
// I colori dei due lati del versus (--vs-a/--vs-b di versus.css), letti al
// momento: cambiano col tema chiaro/scuro.
const curveColors = () => {
  const cs = getComputedStyle(document.body);
  return { a: cs.getPropertyValue('--vs-a').trim() || '#ec4899', b: cs.getPropertyValue('--vs-b').trim() || '#38bdf8' };
};
// Riuso solo entro REUSE_MS dal disegno: la vista riaperta un'ora dopo
// ridisegna (e rilegge la serie, che il server allunga ogni ora) invece di
// mostrare quella vecchia.
const REUSE_MS = 2 * 60 * 1000;
let _curve = { key: '', el: null, at: 0 };

function montaCurve(host, a, b, nomeLato) {
  const slot = host.querySelector('.wp-nat-vs-curves');
  if (!slot) { _curve = { key: '', el: null, at: 0 }; return; }
  const key = [document.documentElement.lang, a.map(n => n._id).join(','), b.map(n => n._id).join(',')].join('|');
  if (_curve.key === key && _curve.el && Date.now() - _curve.at < REUSE_MS) {
    slot.replaceWith(_curve.el);
    return;
  }
  _curve = { key, el: slot, at: Date.now() };
  const groups = [['a', a], ['b', b]]
    .filter(([, list]) => list.length)
    .map(([side, list]) => ({ label: nomeLato(list), color: curveColors()[side], ids: list.map(n => n._id) }));
  import('../diplomacy/blocDamageCurves.js')
    .then(m => m.renderGroupCurves(slot, groups))
    .catch(() => { slot.innerHTML = ''; });
}

/* Le metriche in due riquadri, come i gruppi del versus dei giocatori.
   Una metrica che metrics.js aggiunge un giorno e che qui non è elencata
   finisce nel primo: meglio una riga in più che una misura sparita. */
const GROUPS = [
  { key: 'war', title: 'vsGroupWar', icon: '⚔', metrics: ['weekly', 'total', 'perCit', 'dmgCore', 'bounty', 'allies', 'wars'] },
  { key: 'eco', title: 'vsGroupEco', icon: '💰', metrics: ['pop', 'wealth', 'dev', 'coreDev', 'prod', 'taxes', 'unrest'] },
];

/** Il ritratto di un lato: la bandiera se è una nazione sola, la prima
 *  bandiera col numero se sono di più (e sotto la fila di tutte). */
function fighterLato(list, side, leader, nomeLato) {
  if (!list.length) {
    return vsFighter({
      side,
      avatar: '<span class="wp-vs-av wp-vs-av-empty">?</span>',
      name: `<span class="wp-vs-name wp-vs-name-empty">${escapeHtml(natT(side === 'a' ? 'sideA' : 'sideB'))}</span>`,
      sub: escapeHtml(natT('noSelection')),
    });
  }
  const many = list.length > 1;
  return vsFighter({
    side, leader,
    avatar: `<span class="wp-vs-av wp-vs-av-flag">${flagImg(list[0]._id, '')}${many ? `<b class="wp-vs-av-count">${list.length}</b>` : ''}</span>`,
    name: `<span class="wp-vs-name">${escapeHtml(nomeLato(list))}</span>`,
    lines: [many ? `<div class="wp-vs-flags">${list.map(n => flagImg(n._id, '')).join('')}</div>` : ''],
    tags: [
      many ? `<span class="wp-vs-lv">${escapeHtml(sost(natT('vsNations'), { n: list.length }))}</span>` : '',
      `<span class="wp-vs-lv">${escapeHtml(natT('citizens'))} ${escapeHtml(fmtCompact(list.reduce((s, n) => s + metricValue(n, 'pop'), 0)))}</span>`,
    ],
  });
}

export function renderNationCompare(host, ctx) {
  const { nations, sides } = ctx;   // sides: Map(countryId → 'a' | 'b')

  const listOf = side => nations.filter(n => sides.get(n._id) === side);
  const a = listOf('a');
  const b = listOf('b');
  const bothSides = a.length && b.length;
  const nomeLato = list => list.map(n => n.name).join(' + ');

  const agg = (list, m) => {
    if (!list.length) return 0;
    if (m.ratio) {
      const den = list.reduce((s, n) => s + metricValue(n, m.ratio[1]), 0);
      return den > 0 ? list.reduce((s, n) => s + metricValue(n, m.ratio[0]), 0) / den : 0;
    }
    const sum = list.reduce((s, n) => s + metricValue(n, m.key), 0);
    return AVERAGED.has(m.key) ? sum / list.length : sum;
  };
  // cmp 0 = neutra (si vede, non si conta), -1 = vince il più basso.
  const riga = (m) => {
    const lower = m.cmp === -1;
    const label = natT(m.label) + (lower ? ` (${natT('vsLower')})` : '');
    return vsRow(label, agg(a, m), agg(b, m), { fmt: m.fmt, lower, neutral: m.cmp === 0 });
  };

  let section = '';
  let intro = false;
  if (bothSides) {
    const byKey = new Map(METRICS.filter(m => !SKIPPED.has(m.key)).map(m => [m.key, m]));
    const groups = GROUPS.map(g => ({ title: natT(g.title), icon: g.icon, rows: g.metrics.filter(k => byKey.has(k)).map(k => riga(byKey.get(k))) }));
    const listed = new Set(GROUPS.flatMap(g => g.metrics));
    for (const [k, m] of byKey) if (!listed.has(k)) groups[0].rows.push(riga(m));

    // Build dei giocatori: le QUOTE sono neutre, i CONTEGGI no (più giocatori
    // da guerra = più forza militare).
    if (!_ps) caricaBuild(() => { if (host.isConnected) renderNationCompare(host, ctx); });
    const pa = sommaBuild(a), pb = sommaBuild(b);
    if (pa && pb) {
      const pct = v => v.toFixed(1) + '%';
      const q = (p, k) => (p[k] / p.known) * 100;
      groups.push({ title: natT('vsBuilds'), icon: '🎯', rows: [
        vsRow(natT('vsWarN'), pa.war, pb.war, { fmt: fmtCompact }),
        vsRow(natT('vsEcoN'), pa.eco, pb.eco, { fmt: fmtCompact }),
        vsRow(natT('vsWarPct'), q(pa, 'war'), q(pb, 'war'), { fmt: pct, neutral: true }),
        vsRow(natT('vsEcoPct'), q(pa, 'eco'), q(pb, 'eco'), { fmt: pct, neutral: true }),
        vsRow(natT('vsHybN'), pa.mixed, pb.mixed, { fmt: fmtCompact, neutral: true }),
      ] });
    }

    const t = vsTally(groups.flatMap(g => g.rows));
    const verdict = t.a === t.b
      ? sost(natT('vsTie'), { n: t.a })
      : sost(natT('vsLead'), { name: nomeLato(t.a > t.b ? a : b), n: Math.max(t.a, t.b), t: t.tot });
    // L'intro solo per uno schieramento nuovo: la ricerca ridisegna a ogni
    // lettera, e le barre ripartirebbero ogni volta.
    const key = [a.map(n => n._id).sort().join(','), b.map(n => n._id).sort().join(',')].sort().join('|');
    if (key !== _lastSides) { _lastSides = key; intro = animationsOn(); }
    section = `
      <section class="wp-vs${intro ? ' wp-vs-intro' : ''}">
        ${vsHero({ a: fighterLato(a, 'a', t.a > t.b, nomeLato), b: fighterLato(b, 'b', t.b > t.a, nomeLato), winsA: t.a, winsB: t.b, verdict, intro })}
        ${groups.map((g, gi) => vsGroup({ ...g, g: gi })).join('')}
      </section>
      <p class="wp-vs-note">${escapeHtml(sost(natT('vsNote'), { t: t.tot }))}</p>
      <div class="wp-nat-vs-curves"></div>`;
  } else {
    section = `
      <section class="wp-vs">
        ${vsHero({ a: fighterLato(a, 'a', false, nomeLato), b: fighterLato(b, 'b', false, nomeLato), winsA: 0, winsB: 0, verdict: natT('vsPick'), score: false })}
      </section>`;
  }

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
    <div class="wp-vs-scope">
      ${section}

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

      <div class="wp-nat-pickers">
        ${pickerHtml('a')}
        ${pickerHtml('b')}
      </div>
    </div>`;

  if (intro) countUpScore(host);
  montaCurve(host, a, b, nomeLato);

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
