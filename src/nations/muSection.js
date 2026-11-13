/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: unità militari della nazione
   ------------------------------------------------------------------
   Le unità REGISTRATE in questa nazione (`mu.country`), con membri, danno,
   ricchezza e come si dividono fra guerra ed economia. Zero richieste
   nuove: la directory delle unità è già quella della sezione Unità
   militari (src/mu/api.js: fetchMuDirectory, una fetch per sessione).

   ⚠️ «Della nazione» vuol dire REGISTRATA lì, non «composta da suoi
   cittadini»: un'unità può avere membri di molte cittadinanze (la
   directory porta `composition`, ma qui non serve). Le unità senza
   nessun membro (appena create, o abbandonate) non si elencano ma si
   contano: dichiararle è meglio che farle sparire.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, fmtCompact, avatarImg } from '../mu/ui.js';
import { fetchMuDirectory } from '../mu/api.js';
import { tipAttr } from '../shared/chartTip.js';
import { barsHtml } from './charts.js';
import { ecoT } from './i18nEco.js';

const SORTS = [
  { key: 'members', label: 'muMembers', get: m => m.memberCount || 0 },
  { key: 'weekly',  label: 'muWeekly',  get: m => m.rankings?.muWeeklyDamages?.value || 0 },
  { key: 'total',   label: 'muTotal',   get: m => m.rankings?.muDamages?.value || 0 },
  { key: 'wealth',  label: 'muWealth',  get: m => m.rankings?.muWealth?.value || 0 },
  { key: 'bounty',  label: 'muBounty',  get: m => m.rankings?.muBounty?.value || 0 },
  { key: 'level',   label: 'muLevel',   get: m => m.level || 0 },
];

let _host = null;
let _nation = null;
let _sort = 'weekly';

export async function renderMuSection(host, nation) {
  _host = host;
  _nation = nation;
  host.innerHTML = `<div class="wp-nat-empty">${escapeHtml(ecoT('muLoading'))}</div>`;

  let dir;
  try {
    dir = await fetchMuDirectory();
  } catch (err) {
    console.warn('WarEra+ nations: directory unità non caricata:', err.message);
    if (_nation?._id === nation._id) host.innerHTML = `<div class="wp-nat-empty">${escapeHtml(ecoT('muFailed'))}</div>`;
    return;
  }
  if (_nation?._id !== nation._id) return;   // nazione cambiata nel frattempo

  const mine = (dir || []).filter(m => m.country === nation._id);
  paint(mine);
}

function paint(all) {
  const mine = all.filter(m => (m.memberCount || 0) > 0);
  const hidden = all.length - mine.length;
  const name = _nation?.name || '—';

  if (!mine.length) {
    _host.innerHTML = `
      <h3 class="wp-nat-section-title">${escapeHtml(ecoT('muTitle', { nation: name }))}</h3>
      <div class="wp-nat-empty">${escapeHtml(ecoT('muNone'))}</div>`;
    return;
  }

  const sum = (get) => mine.reduce((s, m) => s + get(m), 0);
  const tiles = [
    [ecoT('muUnits'), String(mine.length)],
    [ecoT('muMembers'), fmtCompact(sum(m => m.memberCount || 0))],
    [ecoT('muWeekly'), fmtCompact(sum(SORTS[1].get))],
    [ecoT('muTotal'), fmtCompact(sum(SORTS[2].get))],
    [ecoT('muWealth'), fmtCompact(Math.round(sum(SORTS[3].get)))],
  ].map(([lab, val]) => `
    <div class="wp-nat-lab-tile">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val">${escapeHtml(val)}</strong>
    </div>`).join('');

  // Barre e non ciambella: con decine di unità quasi pari (la Germania ne ha
  // 85, da 14 a 25 membri) ogni fetta valeva il 2% e "altre" l'86%.
  const membersBars = barsHtml({
    title: ecoT('muChartMembers'),
    rows: mine.slice().sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).slice(0, 10)
      .map(m => ({ label: m.name || '—', value: m.memberCount || 0 })),
    fmt: v => String(v),
    color: '#3fb950',
  });
  const bars = barsHtml({
    title: ecoT('muChartWeekly'),
    rows: mine.slice().sort((a, b) => SORTS[1].get(b) - SORTS[1].get(a)).slice(0, 10)
      .map(m => ({ label: m.name || '—', value: SORTS[1].get(m) })),
  });

  const sorted = sortedRows(mine);
  _host.innerHTML = `
    <h3 class="wp-nat-section-title">
      ${escapeHtml(ecoT('muTitle', { nation: name }))}
      <div class="wp-nat-tools">
        <label class="wp-nat-sort">
          <span>${escapeHtml(ecoT('muSortBy'))}</span>
          <select id="wp-nat-mu-sort">
            ${SORTS.map(s => `<option value="${s.key}"${s.key === _sort ? ' selected' : ''}>${escapeHtml(ecoT(s.label))}</option>`).join('')}
          </select>
        </label>
      </div>
    </h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('muSub'))}${hidden ? ` ${escapeHtml(ecoT('muHidden', { n: hidden }))}` : ''}</p>
    <div class="wp-nat-lab-tiles">${tiles}</div>
    <section class="wp-nat-charts">${membersBars}${bars}</section>
    <div class="wp-nat-mut-wrap"><div class="wp-nat-mut" id="wp-nat-mut">${tableHtml(sorted)}</div></div>`;

  _host.querySelector('#wp-nat-mu-sort').addEventListener('change', (e) => {
    _sort = e.target.value;
    paint(all);
  });
  _host.querySelector('#wp-nat-mut').addEventListener('click', openUnit);
}

function sortedRows(rows) {
  const s = SORTS.find(x => x.key === _sort) || SORTS[1];
  return rows.slice().sort((a, b) => s.get(b) - s.get(a));
}

function tableHtml(rows) {
  const head = ['muUnit', 'muMembers', 'muLevel', 'muWeekly', 'muTotal', 'muWealth', 'muBounty'].map(k => ecoT(k));
  head.push(`${ecoT('muWar')} / ${ecoT('muEco')}`);
  const header = `<div class="wp-nat-mut-row wp-nat-mut-head">${head.map((k, i) =>
    `<span class="${i && i < 7 ? 'wp-nat-num' : ''}">${escapeHtml(k)}</span>`).join('')}</div>`;

  const body = rows.map(m => {
    const p = m.playstyle;
    // Quota guerra/eco fra i membri di cui si conosce lo stile: se `known`
    // è zero non si disegna nulla invece di un 0% che direbbe "tutti eco".
    const split = p?.known
      ? `<span class="wp-nat-mut-split"${tipAttr(
          m.name || '',
          `${ecoT('muWar')}\t${p.war}`, `${ecoT('muEco')}\t${p.eco}`,
          `${ecoT('muMembers')}\t${p.known}`)}>`
        + `<span class="wp-nat-mut-war" style="width:${(p.war / p.known) * 100}%"></span>`
        + `<span class="wp-nat-mut-mix" style="width:${((p.mixed + p.undecided) / p.known) * 100}%"></span>`
        + `<span class="wp-nat-mut-eco" style="width:${(p.eco / p.known) * 100}%"></span></span>`
      : '—';
    return `
      <a class="wp-nat-mut-row" href="#" data-mu="${escapeHtml(m._id)}" title="${escapeHtml(ecoT('muOpen'))}">
        <span class="wp-nat-cname">${avatarImg(m.avatarUrl, m.name || '', 'wp-mu-avatar wp-mu-avatar-xs')}<span class="wp-nat-cnick">${escapeHtml(m.name || '—')}</span></span>
        <span class="wp-nat-num">${m.memberCount || 0}</span>
        <span class="wp-nat-num">${m.level ?? '—'}</span>
        <span class="wp-nat-num wk">${escapeHtml(fmtCompact(SORTS[1].get(m)))}</span>
        <span class="wp-nat-num">${escapeHtml(fmtCompact(SORTS[2].get(m)))}</span>
        <span class="wp-nat-num money" title="${escapeHtml(ecoT('muWealthHint'))}">${escapeHtml(fmtCompact(Math.round(SORTS[3].get(m))))}</span>
        <span class="wp-nat-num">${escapeHtml(fmtCompact(Math.round(SORTS[4].get(m))))}</span>
        <span>${split}</span>
      </a>`;
  }).join('');
  return header + body;
}

/* Un clic su un'unità apre la sua scheda nella sezione Unità militari. Si
   chiude prima Statistiche nazioni: gli overlay si impilano nel DOM nello
   stesso ordine in cui sono stati creati, e uno aperto dopo ma creato prima
   resterebbe sotto, invisibile (stesso motivo del ponte verso Political). */
async function openUnit(e) {
  const a = e.target.closest('a[data-mu]');
  if (!a) return;
  e.preventDefault();
  const [nat, mu] = await Promise.all([import('../app/nationsOverlay.js'), import('../app/muOverlay.js')]);
  nat.closeNationsView();
  mu.openMuView(a.dataset.mu);
}
