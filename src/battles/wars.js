/* ══════════════════════════════════════════════════════════════
   WarEra+ — Scheda "Guerre"
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-12): una sezione "War" con l'aggregato
   dei COSTI delle battaglie, raggruppate per guerra. L'archivio le
   elencava una per una; qui si somma per guerra: quante battaglie, chi le
   ha vinte, quanto danno, quanto è uscito di taglie e di contratti.

   ── DA DOVE VIENE LA GUERRA ────────────────────────────────────────
   Ogni battaglia ha un campo `war`. Le righe del server d'archivio lo
   portano in `wr` dal 2026-11-12; quelle scritte prima le recupera una
   notte di `pollBattleWarBackfill` (server/battleArchive.js). Finché non
   l'ha fatto `warKnown` è false e la scheda lo dichiara: una guerra con
   metà delle battaglie senza guerra assegnata mostrerebbe totali bassi
   senza dirlo. Una battaglia di torneo non ha guerra e non compare.

   ── COSA È "LA SPESA DI UNA NAZIONE" QUI ───────────────────────────
   Per ogni battaglia, a una nazione si addebita la taglia del suo lato
   più i contratti ingaggiati per quel lato (splitArchiveContracts). Il
   pagante di un contratto può essere un alleato (vedi battleSpending.js):
   qui conta per chi si combatte, non chi ha firmato l'assegno. La somma
   dei due lati torna col costo totale della riga d'archivio.

   ⚠️ I contratti sono il PATTUITO (come nel dettaglio battaglia): un'unità
   sotto il danno minimo può incassare meno. Lo dice la nota in fondo.
   ⚠️ Una guerra iniziata prima dell'archivio (90 giorni) ha solo le
   battaglie dentro la finestra: non è un difetto dei conti, è il dato.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { btlT } from './i18n.js';

const PAGE = 40;
let _shown = PAGE;
let _query = '';
let _sort = 'cost';            // 'cost' | 'damage' | 'last' | 'battles'
const _open = new Set();       // guerre espanse

/* ── Formati (gli stessi dell'elenco battaglie: monete sotto la decina) ── */
function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(2);
}
function fmtDay(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const nationName = (id) => state.nationMap?.get(id)?.name || null;
function flagHtml(id) {
  const n = state.nationMap?.get(id);
  if (!n) return '';
  const url = getFlagUrl(getNationCode(id, n));
  return url ? `<img class="wp-btl-flag" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
}
const nameOr = (id) => escapeHtml(nationName(id) || '—');

/* ══ AGGREGAZIONE ══════════════════════════════════════════════
   Pura: archivio in, elenco di guerre fuori. Niente DOM, niente fetch. */
export function buildWars(archive) {
  const wars = new Map();
  const get = (id) => {
    let w = wars.get(id);
    if (!w) {
      w = { id, battles: [], live: 0, first: null, last: null, damage: 0,
            bounty: 0, contracts: 0, partialCost: 0, byCountry: new Map(), atkVotes: new Map() };
      wars.set(id, w);
    }
    return w;
  };
  const cty = (w, id) => {
    let c = w.byCountry.get(id);
    if (!c) { c = { id, damage: 0, won: 0, battles: 0, bounty: 0, contracts: 0 }; w.byCountry.set(id, c); }
    return c;
  };

  let withoutWar = 0;
  for (const b of archive.battles || []) {
    if (!b.warKnown) { withoutWar++; continue; }
    if (!b.warId) continue;                    // torneo o senza guerra
    const w = get(b.warId);
    w.battles.push(b);
    if (b.endedAt) {
      w.first = w.first == null ? b.endedAt : Math.min(w.first, b.endedAt);
      w.last = w.last == null ? b.endedAt : Math.max(w.last, b.endedAt);
    }
    const known = b.attacker.bounty != null || b.defender.bounty != null;
    if (!known) w.partialCost++;
    for (const side of ['attacker', 'defender']) {
      const s = b[side];
      if (!s.countryId) continue;
      const c = cty(w, s.countryId);
      c.battles++;
      c.damage += s.damages || 0;
      w.damage += s.damages || 0;
      if (b.wonBy === side) c.won++;
      if (known) {
        c.bounty += s.bounty || 0;
        c.contracts += s.contracts || 0;
        w.bounty += s.bounty || 0;
        w.contracts += s.contracts || 0;
      }
      // Chi attacca di solito nelle battaglie "war": serve a ordinare i due
      // nomi della guerra (attaccante prima). Una rivolta ribalta i ruoli.
      if (side === 'attacker' && b.type === 'war') w.atkVotes.set(s.countryId, (w.atkVotes.get(s.countryId) || 0) + 1);
    }
  }
  // Le battaglie in corso non hanno costi: contano solo per "in corso".
  for (const b of archive.live || []) {
    if (!b.warId) continue;
    const w = get(b.warId);
    w.live++;
    w.battles.push(b);
    for (const side of ['attacker', 'defender']) if (b[side].countryId) cty(w, b[side].countryId);
  }

  const out = [];
  for (const w of wars.values()) {
    w.total = w.bounty + w.contracts;
    w.countries = [...w.byCountry.values()].sort((a, b) => b.damage - a.damage);
    // Le due parti: le due nazioni con più battaglie; l'attaccante per primo.
    const parties = [...w.byCountry.values()].sort((a, b) => b.battles - a.battles).slice(0, 2).map(c => c.id);
    parties.sort((a, b) => (w.atkVotes.get(b) || 0) - (w.atkVotes.get(a) || 0));
    w.parties = parties;
    w.battles.sort((a, b) => (b.endedAt ?? Infinity) - (a.endedAt ?? Infinity));
    if (w.live) w.last = Date.now();
    out.push(w);
  }
  return { wars: out, withoutWar };
}

function sortWars(list) {
  const key = { cost: w => w.total, damage: w => w.damage, last: w => w.last || 0, battles: w => w.battles.length }[_sort];
  return list.slice().sort((a, b) => key(b) - key(a) || (b.last || 0) - (a.last || 0));
}

function matches(w) {
  if (!_query) return true;
  const q = _query.toLowerCase();
  return w.countries.some(c => (nationName(c.id) || '').toLowerCase().includes(q));
}

/* ══ DISEGNO ═══════════════════════════════════════════════════ */
function partiesHtml(w) {
  const [a, d] = w.parties;
  if (!a) return `<span class="wp-btl-noname">—</span>`;
  const one = (id) => `<span class="wp-btl-side">${flagHtml(id)}${nameOr(id)}</span>`;
  return `${one(a)}${d ? `<span class="wp-btl-vs">vs</span>${one(d)}` : ''}`;
}

/** Vittorie di battaglia "A–D" fra le due parti. */
function winsHtml(w) {
  const [a, d] = w.parties;
  if (!a) return '';
  const wa = w.byCountry.get(a)?.won || 0;
  const wd = d ? (w.byCountry.get(d)?.won || 0) : 0;
  return `<span class="wp-btl-sub">${wa}–${wd}</span>`;
}

function rowHtml(w) {
  const open = _open.has(w.id);
  const ended = w.battles.length - w.live;
  const [a, d] = w.parties;
  const dmg = (id) => (id ? fmtNum(w.byCountry.get(id)?.damage) : '—');
  return `
    <tr class="wp-btl-row wp-btl-clickable wp-war-row${open ? ' open' : ''}${w.live ? ' wp-btl-live' : ''}" data-war="${w.id}">
      <td class="wp-btl-match">${partiesHtml(w)}${w.live
        ? `<span class="wp-btl-livetag"><span class="wp-btl-livedot"></span>${btlT('warLive')}${w.live > 1 ? ` ×${w.live}` : ''}</span>` : ''}</td>
      <td class="wp-btl-when">${fmtDay(w.first)} → ${w.live ? btlT('liveNow') : fmtDay(w.last)}</td>
      <td class="wp-btl-num">${ended}${winsHtml(w)}</td>
      <td class="wp-btl-num wp-btl-dmg" data-label="${escapeHtml(btlT('colDamage'))}">${dmg(a)}<span class="wp-btl-sep">/</span>${dmg(d)}</td>
      <td class="wp-btl-num wp-btl-bounty">${fmtMoney(w.bounty)}</td>
      <td class="wp-btl-num wp-btl-contracts">${fmtMoney(w.contracts)}</td>
      <td class="wp-btl-num wp-btl-total" data-label="${escapeHtml(btlT('colCost'))}">${fmtMoney(w.total)}${w.partialCost
        ? `<span class="wp-btl-unk" title="${escapeHtml(btlT('warPartialCost', { n: w.partialCost }))}"> ≥</span>` : ''}</td>
    </tr>`;
}

function battleLineHtml(b) {
  const total = (b.attacker.bounty != null || b.defender.bounty != null)
    ? (b.attacker.bounty ?? 0) + (b.defender.bounty ?? 0) + (b.contracts ?? 0) : null;
  const sd = (s, won) => `<span class="wp-btl-side${won ? ' won' : ''}">${flagHtml(s.countryId)}${nameOr(s.countryId)}</span>`;
  const region = state.regionData?.[b.regionId]?.name;
  return `
    <tr class="wp-btl-row wp-btl-clickable" data-battle="${b.id}">
      <td class="wp-btl-when">${b.live ? `<span class="wp-btl-livetag"><span class="wp-btl-livedot"></span>${btlT('liveNow')}</span>` : fmtDateTime(b.endedAt)}</td>
      <td class="wp-btl-match">${sd(b.defender, b.wonBy === 'defender')}<span class="wp-btl-vs">vs</span>${sd(b.attacker, b.wonBy === 'attacker')}</td>
      <td class="wp-btl-region">${escapeHtml(region || '—')}</td>
      <td class="wp-btl-num wp-btl-dmg">${fmtNum(b.defender.damages)}<span class="wp-btl-sep">/</span>${fmtNum(b.attacker.damages)}</td>
      <td class="wp-btl-num wp-btl-total">${total == null ? '<span class="wp-btl-unk">?</span>' : fmtMoney(total)}</td>
    </tr>`;
}

function detailHtml(w) {
  return `
    <tr class="wp-war-exp"><td colspan="7">
      <div class="wp-war-exp-in">
        <h3 class="wp-btl-h3">${btlT('warSides')}</h3>
        <div class="wp-btl-tablewrap">
          <table class="wp-btl-table">
            <thead><tr>
              <th>${btlT('colNation')}</th>
              <th class="wp-btl-num">${btlT('colBattles')}</th>
              <th class="wp-btl-num">${btlT('colWon')}</th>
              <th class="wp-btl-num">${btlT('colDamage')}</th>
              <th class="wp-btl-num">${btlT('colBounty')}</th>
              <th class="wp-btl-num">${btlT('colContracts')}</th>
              <th class="wp-btl-num">${btlT('colCost')}</th>
            </tr></thead>
            <tbody>${w.countries.map(c => `
              <tr>
                <td class="wp-btl-nation">${flagHtml(c.id)}${nameOr(c.id)}</td>
                <td class="wp-btl-num">${c.battles}</td>
                <td class="wp-btl-num">${c.won}</td>
                <td class="wp-btl-num">${fmtNum(c.damage)}</td>
                <td class="wp-btl-num wp-btl-bounty">${fmtMoney(c.bounty)}</td>
                <td class="wp-btl-num wp-btl-contracts">${fmtMoney(c.contracts)}</td>
                <td class="wp-btl-num wp-btl-total">${fmtMoney(c.bounty + c.contracts)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <h3 class="wp-btl-h3">${btlT('warBattlesTitle')} <span class="wp-btl-sub">${w.battles.length}</span></h3>
        <div class="wp-btl-tablewrap">
          <table class="wp-btl-table wp-btl-list">
            <thead><tr>
              <th>${btlT('colWhen')}</th><th>${btlT('colBattle')}</th><th class="wp-btl-th-region">${btlT('colRegion')}</th>
              <th class="wp-btl-num">${btlT('colDamage')}</th><th class="wp-btl-num">${btlT('colCost')}</th>
            </tr></thead>
            <tbody>${w.battles.map(battleLineHtml).join('')}</tbody>
          </table>
        </div>
        ${w.partialCost ? `<p class="wp-btl-foot">${btlT('warPartialCost', { n: w.partialCost })}</p>` : ''}
      </div>
    </td></tr>`;
}

export function renderWars(archive) {
  const { wars, withoutWar } = buildWars(archive);
  const list = sortWars(wars.filter(matches));
  const visible = list.slice(0, _shown);

  const notices = [];
  if (archive.degraded) notices.push(`<div class="wp-btl-notice warn">${btlT('warsDegraded')}</div>`);
  else if (archive.retentionDays) notices.push(`<div class="wp-btl-notice">${btlT('warsCoverage', { n: archive.retentionDays })}</div>`);
  if (withoutWar) notices.push(`<div class="wp-btl-notice">${btlT('warsPending', { n: withoutWar })}</div>`);

  return `
    ${notices.join('')}
    <div class="wp-btl-toolbar">
      <input type="search" class="wp-btl-search" id="wp-war-search" placeholder="${btlT('warsSearch')}" value="${escapeHtml(_query)}">
      <div class="wp-btl-filters">
        <span class="wp-btl-meta">${btlT('warsSortBy')}</span>
        ${[['cost', 'warSortCost'], ['damage', 'warSortDamage'], ['last', 'warSortLast'], ['battles', 'warSortBattles']]
          .map(([id, k]) => `<button type="button" class="wp-btl-chip${_sort === id ? ' active' : ''}" data-wsort="${id}">${btlT(k)}</button>`).join('')}
      </div>
    </div>
    ${visible.length ? `
      <div class="wp-btl-tablewrap">
        <table class="wp-btl-table wp-btl-list wp-war-table">
          <thead><tr>
            <th>${btlT('colWar')}</th>
            <th>${btlT('colPeriod')}</th>
            <th class="wp-btl-num">${btlT('colBattles')}</th>
            <th class="wp-btl-num">${btlT('colDamage')}</th>
            <th class="wp-btl-num">${btlT('colBounty')}</th>
            <th class="wp-btl-num">${btlT('colContracts')}</th>
            <th class="wp-btl-num">${btlT('colCost')}</th>
          </tr></thead>
          <tbody>${visible.map(w => rowHtml(w) + (_open.has(w.id) ? detailHtml(w) : '')).join('')}</tbody>
        </table>
      </div>
      ${list.length > _shown
        ? `<button type="button" class="wp-btl-more" id="wp-war-more">+ ${Math.min(PAGE, list.length - _shown)} / ${list.length}</button>` : ''}
    ` : `<div class="wp-btl-empty">${btlT('warsEmpty')}</div>`}
    <p class="wp-btl-foot">${btlT('warsNote')}</p>`;
}

export function wireWars(root, repaint, onOpenBattle, findBattle) {
  const search = root.querySelector('#wp-war-search');
  if (search) {
    search.addEventListener('input', () => {
      _query = search.value.trim();
      _shown = PAGE;
      repaint();
      const s = document.getElementById('wp-war-search');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    });
  }
  root.querySelectorAll('[data-wsort]').forEach(btn => {
    btn.addEventListener('click', () => { _sort = btn.dataset.wsort; _shown = PAGE; repaint(); });
  });
  root.querySelector('#wp-war-more')?.addEventListener('click', () => { _shown += PAGE; repaint(); });

  root.querySelector('.wp-war-table tbody')?.addEventListener('click', (e) => {
    const bt = e.target.closest('[data-battle]');
    if (bt) { const b = findBattle(bt.dataset.battle); if (b) onOpenBattle(b); return; }
    const tr = e.target.closest('.wp-war-row');
    if (!tr) return;
    const id = tr.dataset.war;
    if (_open.has(id)) _open.delete(id); else _open.add(id);
    repaint();
  });
}
