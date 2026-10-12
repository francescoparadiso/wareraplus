/* ══════════════════════════════════════════════════════════════
   WarEra+ — Unità Militari: confronto 1 vs 1
   ------------------------------------------------------------------
   Richiesta dell'utente: mettere un'unità contro un'altra, come il
   "1 vs 2" delle nazioni (src/nations/nationCompare.js). Stessa grafica
   e stesse regole, per non avere due modi diversi di leggere un
   confronto nello stesso tool: barre "A contro B" (versusBarHtml), chi
   vince la riga in grassetto col suo vantaggio, in cima il tabellone "chi
   è avanti in quante misure". Le classi wp-nat-* vengono da nations.css,
   importato qui sotto: Vite lo carica una volta sola anche se la vista
   nazioni lo importa a sua volta.

   Qui i lati sono UNA unità ciascuno: niente somme né medie, il dubbio
   del confronto fra nazioni non si pone.

   ZERO fetch: tutto quello che serve è già nella directory in memoria
   (src/mu/api.js) — le sei classifiche, i membri, composizione e stile
   di gioco calcolati dal server di cache. Senza server di cache lo stile
   di gioco manca, e il suo gruppo semplicemente non compare (mai zeri
   inventati).

   SELEZIONE: due elenchi, uno per lato, con la loro ricerca (stessa
   scelta delle nazioni: si aggiunge dove si intende aggiungere). Un'unità
   scelta da una parte che si sceglie dall'altra si SPOSTA. Di partenza
   l'elenco mostra le prime per danno settimanale.
   ══════════════════════════════════════════════════════════════ */

import '../styles/nations.css';
import { versusBarHtml } from '../nations/charts.js';
import { MU_RANKING_TYPES } from './api.js';
import { muT } from './i18n.js';
import { avatarImg, countryName, dominantCountry, escapeHtml, flagImg, fmtCompact, tierBadge } from './ui.js';

const PICK_LIMIT = 40;

const sost = (s, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split('{' + k + '}').join(String(v)), s);
const rv = (m, type) => m?.rankings?.[type]?.value ?? 0;
const weekly = m => rv(m, 'muWeeklyDamages');
const perMember = (v, m) => (m.memberCount ? v / m.memberCount : 0);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function vantaggio(hi, lo, fmt) {
  if (lo > 0) {
    const r = hi / lo;
    return r >= 2 ? '×' + r.toFixed(1) : '+' + ((r - 1) * 100).toFixed(0) + '%';
  }
  return '+' + fmt(hi - lo);
}

/** Il riquadro in cima a ogni lato: chi è, dove sta, quanti sono. */
function cardHtml(m, side) {
  if (!m) {
    return `<div class="wp-mu-cmp-card wp-mu-cmp-card-${side} wp-mu-cmp-card-empty">
      <span>${escapeHtml(muT(side === 'a' ? 'cmpUnitA' : 'cmpUnitB'))}</span>
      <em>${escapeHtml(muT('cmpEmpty'))}</em>
    </div>`;
  }
  const dom = dominantCountry(m);
  const defacto = dom?.foreign
    ? `<span class="wp-mu-cmp-defacto">${flagImg(dom.country)} ${escapeHtml(muT('deFacto'))}</span>` : '';
  return `<div class="wp-mu-cmp-card wp-mu-cmp-card-${side}">
    ${avatarImg(m.avatarUrl, m.name, 'wp-mu-avatar wp-mu-avatar-lg')}
    <div class="wp-mu-cmp-card-main">
      <button type="button" class="wp-mu-cmp-name" data-open="${escapeHtml(m._id)}" title="${escapeHtml(muT('cmpOpen'))}">${escapeHtml(m.name)}</button>
      <div class="wp-mu-cmp-meta">
        ${flagImg(m.country)}<span>${escapeHtml(countryName(m.country))}</span>${defacto}
      </div>
      <div class="wp-mu-cmp-meta">
        <span>${escapeHtml(muT('members'))} <strong>${m.memberCount ?? '—'}</strong></span>
        ${tierBadge(m.rankings?.muWeeklyDamages)}
      </div>
    </div>
    <button type="button" class="wp-mu-cmp-x" data-clear="${side}" title="${escapeHtml(muT('cmpClear'))}" aria-label="${escapeHtml(muT('cmpClear'))}">✕</button>
  </div>`;
}

function pickerHtml(directory, side, cmp) {
  const query = side === 'a' ? cmp.qA : cmp.qB;
  const q = norm(query);
  const items = directory
    .filter(m => !q || norm(m.name).includes(q))
    .sort((x, y) => weekly(y) - weekly(x))
    .slice(0, PICK_LIMIT)
    .map(m => {
      const cur = m._id === cmp.a ? 'a' : m._id === cmp.b ? 'b' : '';
      return `
        <button type="button" class="wp-nat-pick${cur ? ` wp-nat-pick-${cur}` : ''}" data-mu="${escapeHtml(m._id)}" data-side="${side}">
          ${avatarImg(m.avatarUrl, m.name, 'wp-mu-avatar wp-mu-avatar-sm')}
          <span class="wp-nat-pick-name">${escapeHtml(m.name)}</span>
          ${flagImg(m.country)}
          <span class="wp-nat-pick-val">${escapeHtml(fmtCompact(weekly(m)))}</span>
        </button>`;
    }).join('');
  return `
    <div class="wp-nat-picker wp-nat-picker-${side}">
      <h4>${escapeHtml(muT(side === 'a' ? 'cmpUnitA' : 'cmpUnitB'))}</h4>
      <input type="search" id="wp-mu-cmp-search-${side}" class="wp-nat-search" data-side="${side}"
             placeholder="${escapeHtml(muT('cmpSearch'))}" value="${escapeHtml(query || '')}">
      <div class="wp-nat-picker-grid">${items || `<span class="wp-nat-empty-inline">${escapeHtml(muT('noResults'))}</span>`}</div>
    </div>`;
}

/**
 * @param {HTMLElement} host
 * @param {{ directory: object[], cmp: { a, b, qA, qB, focus },
 *   onPick: (side, id) => void, onClear: (side) => void, onSwap: () => void,
 *   onSearch: (side, q) => void, onOpenMu: (id) => void }} ctx
 */
export function renderMuCompare(host, ctx) {
  const { directory, cmp } = ctx;
  const a = cmp.a ? directory.find(m => m._id === cmp.a) : null;
  const b = cmp.b ? directory.find(m => m._id === cmp.b) : null;

  const tally = { a: 0, b: 0, pari: 0, tot: 0 };
  const riga = (label, va, vb, fmt = fmtCompact, neutral = false) => {
    if (neutral) return versusBarHtml({ label, a: va, b: vb, fmt, neutral: true });
    tally.tot++;
    if (va === vb) { tally.pari++; return versusBarHtml({ label, a: va, b: vb, fmt }); }
    const win = va > vb ? 'a' : 'b';
    tally[win]++;
    return versusBarHtml({ label, a: va, b: vb, fmt, win, adv: vantaggio(Math.max(va, vb), Math.min(va, vb), fmt) });
  };

  let rows = '';
  let tabellone = `<p class="wp-nat-vs-note">${escapeHtml(muT('cmpPick'))}</p>`;
  if (a && b) {
    rows = MU_RANKING_TYPES.map(type => riga(muT(type), rv(a, type), rv(b, type))).join('')
      + riga(muT('members'), a.memberCount ?? 0, b.memberCount ?? 0)
      + riga(muT('cmpDmgPerMember'), perMember(weekly(a), a), perMember(weekly(b), b))
      + riga(muT('cmpWealthPerMember'), perMember(rv(a, 'muWealth'), a), perMember(rv(b, 'muWealth'), b));

    // Come giocano i membri: le QUOTE sono neutre, i CONTEGGI no (più
    // giocatori da guerra = più forza in battaglia). Dal server di cache:
    // se manca per uno dei due, il gruppo non c'è.
    const pa = a.playstyle, pb = b.playstyle;
    if (pa?.known && pb?.known) {
      const pct = v => v.toFixed(1) + '%';
      const q = (p, k) => ((p[k] || 0) / p.known) * 100;
      rows += `<li class="wp-nat-vs-group">${escapeHtml(muT('cmpBuilds'))}</li>`
        + riga(muT('cmpWarPct'), q(pa, 'war'), q(pb, 'war'), pct, true)
        + riga(muT('cmpEcoPct'), q(pa, 'eco'), q(pb, 'eco'), pct, true)
        + riga(muT('cmpWarN'), pa.war || 0, pb.war || 0)
        + riga(muT('cmpEcoN'), pa.eco || 0, pb.eco || 0)
        + riga(muT('cmpHybN'), pa.mixed || 0, pb.mixed || 0, fmtCompact, true);
    }

    tabellone = `<div class="wp-nat-score">
        ${['a', 'b'].map(l => {
          const vinte = tally[l], altre = tally[l === 'a' ? 'b' : 'a'];
          return `<div class="wp-nat-score-side wp-nat-score-${l}${vinte > altre ? ' lead' : ''}">
            <div class="wp-nat-score-n">${vinte}</div>
            <div class="wp-nat-score-name">${escapeHtml((l === 'a' ? a : b).name)}</div>
            <div class="wp-nat-score-sub">${escapeHtml(sost(muT('cmpAhead'), { n: vinte, t: tally.tot }))}</div>
          </div>`;
        }).join(`<div class="wp-nat-score-mid">
            <div class="wp-nat-score-bar"><span class="a" style="width:${(tally.a / tally.tot) * 100}%"></span><span class="pari" style="width:${(tally.pari / tally.tot) * 100}%"></span><span class="b" style="width:${(tally.b / tally.tot) * 100}%"></span></div>
            ${tally.pari ? `<div class="wp-nat-score-even">${escapeHtml(muT('cmpEven'))} · ${tally.pari}</div>` : ''}
          </div>`)}
      </div>
      <p class="wp-nat-vs-note">${escapeHtml(sost(muT('cmpNote'), { t: tally.tot }))}</p>`;
  }

  host.innerHTML = `
    <div class="wp-mu-cmp">
      <div class="wp-mu-cmp-cards">
        ${cardHtml(a, 'a')}
        <button type="button" class="wp-mu-cmp-swap" id="wp-mu-cmp-swap" title="${escapeHtml(muT('cmpSwap'))}"
                aria-label="${escapeHtml(muT('cmpSwap'))}"${a || b ? '' : ' disabled'}>⇄</button>
        ${cardHtml(b, 'b')}
      </div>
      ${tabellone}
      ${rows ? `<ul class="wp-nat-vs">${rows}</ul>` : ''}
      <div class="wp-nat-pickers">
        ${pickerHtml(directory, 'a', cmp)}
        ${pickerHtml(directory, 'b', cmp)}
      </div>
    </div>`;

  host.querySelectorAll('.wp-nat-pick[data-mu]').forEach(el => {
    el.addEventListener('click', () => ctx.onPick(el.dataset.side, el.dataset.mu));
  });
  host.querySelectorAll('[data-clear]').forEach(el => {
    el.addEventListener('click', () => ctx.onClear(el.dataset.clear));
  });
  host.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => ctx.onOpenMu(el.dataset.open));
  });
  host.querySelector('#wp-mu-cmp-swap')?.addEventListener('click', () => ctx.onSwap());

  ['a', 'b'].forEach(side => {
    const input = host.querySelector(`#wp-mu-cmp-search-${side}`);
    if (!input) return;
    input.addEventListener('input', e => ctx.onSearch(side, e.target.value));
    // Il render ricostruisce l'HTML: senza questo il cursore uscirebbe
    // dalla casella a ogni lettera (stesso trattamento delle nazioni).
    if (cmp.focus === side) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}
