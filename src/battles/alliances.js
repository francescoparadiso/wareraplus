/* ══════════════════════════════════════════════════════════════
   WarEra+ — Battaglie: le viste "per alleanza" di Guerre e Archivio
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-26): «aggregare i dati delle wars anche
   per alleanza, idem nel battle archive». Le due schede sommavano per
   guerra o elencavano battaglia per battaglia; qui le stesse righe
   d'archivio si sommano per ALLEANZA: quante battaglie, vinte e perse,
   danno fatto e subito, taglie e contratti, contro chi (i "fronti"), con
   quali nazioni e in quali guerre. Un modulo solo per le due schede, così
   contano allo stesso modo: Guerre gli passa le battaglie che hanno una
   guerra, l'Archivio quelle che passano i suoi filtri.

   ── DI CHE ALLEANZA È UNA BATTAGLIA ───────────────────────────────
   Quella del giorno della battaglia, non quella di oggi: stesso registro
   della time machine e del dettaglio battaglia (/alliance-history,
   blocIdAt in app/timeMachineAlliances.js, secchi di 6 ore), con l'ora
   presa dall'id della battaglia (i primi 8 caratteri di un ObjectId sono
   l'istante di creazione). Senza registro si usa l'appartenenza di oggi
   (state.nationAlliancesMap) e la vista lo dichiara (`today`): con
   novanta giorni d'archivio un blocco che ha cambiato membri
   prenderebbe battaglie non sue senza che niente lo dica.

   ── I CONTI ────────────────────────────────────────────────────────
   · A un'alleanza va il danno, la taglia e i contratti del LATO delle sue
     nazioni (come nelle Guerre: splitArchiveContracts, conta per chi si
     combatte, non chi firma).
   · Una battaglia fra due membri della stessa alleanza è "interna": conta
     una volta fra le battaglie, il danno e i costi dei due lati sono suoi,
     ma non è né una vittoria né una sconfitta e non apre un fronte.
   · Le battaglie in corso contano solo come "in corso": danno e costi
     arrivano quando finiscono.
   · "Senza alleanza" è una riga a parte, sempre in fondo: non è un blocco.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { btlT } from './i18n.js';
import { warLinkHtml } from './links.js';

export const NO_ALLIANCE = '__none';
const PAGE = 40;
const FLAGS = 8;
const LAST_BATTLES = 25;

/* ── Registro delle alleanze nel tempo (una volta per sessione) ── */
let _hist = null;
let _histPromise = null;

export function loadBlocHistory() {
  if (_histPromise) return _histPromise;
  _histPromise = import('../app/timeMachineAlliances.js')
    .then(async (m) => { if (await m.loadAllianceHistory()) _hist = m; return Boolean(_hist); })
    .catch(() => false);
  return _histPromise;
}

/** Istante della battaglia: inizio se c'è, altrimenti dall'id (ObjectId). */
/** Chiave di memo per un archivio: cambia se arrivano battaglie nuove o
 *  si rileggono le vive. */
export function archiveKey(archive) {
  return `${archive?.battles?.length || 0}|${archive?.battles?.[0]?.id || ''}|${archive?.liveAt || 0}`;
}

export function battleTs(b) {
  if (b.startedAt) return b.startedAt;
  const id = String(b.id || '');
  if (/^[0-9a-f]{24}$/i.test(id)) return parseInt(id.slice(0, 8), 16) * 1000;
  return b.endedAt || null;
}

/** Le alleanze di una nazione in quel momento: { ids, today }. */
export function alliancesOf(countryId, ts) {
  if (_hist) {
    const a = _hist.blocIdAt(countryId, ts);
    if (a !== undefined) return { ids: a ? [a] : [], today: false };
  }
  return { ids: [...(state.nationAlliancesMap?.get(countryId) || [])], today: true };
}

export function allianceName(id) {
  if (!id || id === NO_ALLIANCE) return btlT('noAlliance');
  return state.allianceMap?.get(id)?.name || _hist?.blocName?.(id) || '—';
}
export function allianceSwatch(id) {
  const color = id && id !== NO_ALLIANCE ? state.allianceColorMap?.get(id) : null;
  return `<i class="wp-btl-aswatch"${color ? ` style="background:${escapeHtml(color)}"` : ''}></i>`;
}

/* ── Formati (gli stessi dell'archivio) ── */
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

/* ══ AGGREGAZIONE ══════════════════════════════════════════════
   Pura: battaglie in, righe per alleanza fuori. Memorizzata sull'ultima
   chiamata con la stessa chiave: le schede si ridisegnano a ogni lettera
   della ricerca, e ~4.000 battaglie non vanno risommate ogni volta. La
   chiave la dà chi chiama e deve cambiare quando cambiano i dati (lunghezza
   dell'archivio, ora delle battaglie vive, filtri): gli array filtrati sono
   nuovi a ogni disegno, quindi l'identità non servirebbe. */
let _memo = null;

export function buildAllianceAgg(battles, live = [], memoKey = null) {
  const hist = Boolean(_hist);
  if (memoKey && _memo && _memo.key === memoKey && _memo.hist === hist) return _memo.out;
  const rows = new Map();
  let today = false;
  const row = (aid) => {
    let r = rows.get(aid);
    if (!r) {
      r = { aid, seen: new Set(), battles: 0, live: 0, won: 0, lost: 0, internal: 0, damage: 0, damageTaken: 0,
            bounty: 0, contracts: 0, partialCost: 0, members: new Map(), opp: new Map(), wars: new Map(), list: [] };
      rows.set(aid, r);
    }
    return r;
  };

  const handle = (b, isLive) => {
    const ts = battleTs(b);
    const al = {};
    for (const s of ['attacker', 'defender']) {
      const cid = b[s]?.countryId;
      if (!cid) { al[s] = null; continue; }
      const r = alliancesOf(cid, ts);
      if (r.today) today = true;
      al[s] = r.ids.length ? r.ids : [NO_ALLIANCE];
    }
    if (!al.attacker && !al.defender) return;            // torneo: nessuna nazione
    const known = !isLive && (b.attacker.bounty != null || b.defender.bounty != null);

    for (const s of ['attacker', 'defender']) {
      if (!al[s]) continue;
      const o = s === 'attacker' ? 'defender' : 'attacker';
      const S = b[s], O = b[o];
      for (const aid of al[s]) {
        const R = row(aid);
        const internal = aid !== NO_ALLIANCE && Boolean(al[o]?.includes(aid));
        if (!R.seen.has(b.id)) {
          R.seen.add(b.id);
          R.list.push(b);
          if (isLive) R.live++; else R.battles++;
          if (internal) R.internal++;
          if (b.warId) R.wars.set(b.warId, (R.wars.get(b.warId) || 0) + 1);
          if (!isLive && !known) R.partialCost++;
        }
        let M = R.members.get(S.countryId);
        if (!M) { M = { cid: S.countryId, battles: 0, live: 0, won: 0, lost: 0, damage: 0, bounty: 0, contracts: 0 }; R.members.set(S.countryId, M); }
        if (isLive) { M.live++; continue; }
        M.battles++;
        M.damage += S.damages || 0;
        R.damage += S.damages || 0;
        if (!internal) {
          if (b.wonBy === s) { R.won++; M.won++; } else if (b.wonBy === o) { R.lost++; M.lost++; }
          R.damageTaken += O.damages || 0;
        }
        if (known) {
          R.bounty += S.bounty || 0; R.contracts += S.contracts || 0;
          M.bounty += S.bounty || 0; M.contracts += S.contracts || 0;
        }
        if (!internal && al[o]) {
          for (const oa of al[o]) {
            let P = R.opp.get(oa);
            if (!P) { P = { aid: oa, battles: 0, won: 0, lost: 0, dmgFor: 0, dmgAgainst: 0, cost: 0 }; R.opp.set(oa, P); }
            P.battles++;
            if (b.wonBy === s) P.won++; else if (b.wonBy === o) P.lost++;
            P.dmgFor += S.damages || 0;
            P.dmgAgainst += O.damages || 0;
            if (known) P.cost += (S.bounty || 0) + (S.contracts || 0);
          }
        }
      }
    }
  };
  for (const b of battles || []) handle(b, false);
  for (const b of live || []) handle(b, true);

  const out = [];
  for (const R of rows.values()) {
    delete R.seen;
    R.total = R.bounty + R.contracts;
    R.membersList = [...R.members.values()].sort((a, b) => b.damage - a.damage || b.live - a.live);
    R.oppList = [...R.opp.values()].sort((a, b) => (a.aid === NO_ALLIANCE) - (b.aid === NO_ALLIANCE) || b.battles - a.battles);
    R.list.sort((a, b) => (b.endedAt ?? Infinity) - (a.endedAt ?? Infinity));
    out.push(R);
  }
  const res = { rows: out, today };
  if (memoKey) _memo = { key: memoKey, hist, out: res };
  return res;
}

/* ══ DISEGNO ═══════════════════════════════════════════════════
   Una fabbrica per scheda: ognuna tiene il suo ordinamento, la sua
   ricerca e le sue righe aperte, e le due schede non si pestano i piedi. */
const SORTS = {
  cost: r => r.total, damage: r => r.damage, battles: r => r.battles + r.live,
  won: r => r.won, wars: r => r.wars.size,
};

function wlHtml(won, lost) {
  return `<span class="wp-btl-pos">${won}</span>–<span class="wp-btl-neg">${lost}</span>`;
}

function flagsHtml(members) {
  const f = members.slice(0, FLAGS).map(m => `<span title="${escapeHtml(nationName(m.cid) || '')}">${flagHtml(m.cid)}</span>`).join('');
  return `<span class="wp-btl-ally-flags">${f}${members.length > FLAGS ? `<span class="wp-btl-ally-more">+${members.length - FLAGS}</span>` : ''}</span>`;
}

/** Tabella compatta per alleanza dentro il dettaglio di una guerra: niente
 *  righe espandibili, solo i numeri. */
export function allianceSummaryTable(agg) {
  const rows = agg.rows.slice().sort((a, b) => (a.aid === NO_ALLIANCE) - (b.aid === NO_ALLIANCE) || b.damage - a.damage);
  if (!rows.length) return '';
  return `
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table">
        <thead><tr>
          <th>${btlT('colAlliance')}</th>
          <th class="wp-btl-num">${btlT('colBattles')}</th>
          <th class="wp-btl-num">${btlT('colWonLost')}</th>
          <th class="wp-btl-num">${btlT('colDamage')}</th>
          <th class="wp-btl-num">${btlT('colBounty')}</th>
          <th class="wp-btl-num">${btlT('colContracts')}</th>
          <th class="wp-btl-num">${btlT('colCost')}</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td class="wp-btl-nation">${allianceSwatch(r.aid)}${escapeHtml(allianceName(r.aid))}${flagsHtml(r.membersList)}</td>
            <td class="wp-btl-num">${r.battles}${r.live ? `<span class="wp-btl-sub"> +${r.live}</span>` : ''}</td>
            <td class="wp-btl-num">${wlHtml(r.won, r.lost)}</td>
            <td class="wp-btl-num">${fmtNum(r.damage)}</td>
            <td class="wp-btl-num wp-btl-bounty">${fmtMoney(r.bounty)}</td>
            <td class="wp-btl-num wp-btl-contracts">${fmtMoney(r.contracts)}</td>
            <td class="wp-btl-num wp-btl-total">${fmtMoney(r.total)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    ${agg.today ? `<p class="wp-btl-foot">${btlT('allyTodayNote')}</p>` : ''}`;
}

/**
 * @param {object} cfg
 * @param {'wars'|'archive'} cfg.mode
 */
export function createAllianceView({ mode }) {
  let sort = 'cost';
  let shown = PAGE;
  const open = new Set();
  let lastOpen = null;
  let focus = null;           // da un link: aprila e portala in vista

  function oppTable(R) {
    if (!R.oppList.length) return '';
    return `
      <h3 class="wp-btl-h3">${btlT('allyFronts')}</h3>
      <div class="wp-btl-tablewrap">
        <table class="wp-btl-table">
          <thead><tr>
            <th>${btlT('allyAgainst')}</th>
            <th class="wp-btl-num">${btlT('colBattles')}</th>
            <th class="wp-btl-num">${btlT('colWonLost')}</th>
            <th class="wp-btl-num">${btlT('allyDmgFor')}</th>
            <th class="wp-btl-num">${btlT('allyDmgAgainst')}</th>
            <th class="wp-btl-num">${btlT('colCost')}</th>
          </tr></thead>
          <tbody>${R.oppList.map(P => `
            <tr class="wp-btl-row wp-btl-clickable" data-ally-jump="${escapeHtml(P.aid)}">
              <td class="wp-btl-nation">${allianceSwatch(P.aid)}${escapeHtml(allianceName(P.aid))}</td>
              <td class="wp-btl-num">${P.battles}</td>
              <td class="wp-btl-num">${wlHtml(P.won, P.lost)}</td>
              <td class="wp-btl-num">${fmtNum(P.dmgFor)}</td>
              <td class="wp-btl-num">${fmtNum(P.dmgAgainst)}</td>
              <td class="wp-btl-num wp-btl-total">${fmtMoney(P.cost)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function membersTable(R) {
    return `
      <h3 class="wp-btl-h3">${btlT('membersTitle')}</h3>
      <div class="wp-btl-tablewrap">
        <table class="wp-btl-table">
          <thead><tr>
            <th>${btlT('colNation')}</th>
            <th class="wp-btl-num">${btlT('colBattles')}</th>
            <th class="wp-btl-num">${btlT('colWonLost')}</th>
            <th class="wp-btl-num">${btlT('colDamage')}</th>
            <th class="wp-btl-num">${btlT('colBounty')}</th>
            <th class="wp-btl-num">${btlT('colContracts')}</th>
            <th class="wp-btl-num">${btlT('colCost')}</th>
          </tr></thead>
          <tbody>${R.membersList.map(M => `
            <tr>
              <td class="wp-btl-nation">${flagHtml(M.cid)}${escapeHtml(nationName(M.cid) || '—')}</td>
              <td class="wp-btl-num">${M.battles}${M.live ? `<span class="wp-btl-sub"> +${M.live}</span>` : ''}</td>
              <td class="wp-btl-num">${wlHtml(M.won, M.lost)}</td>
              <td class="wp-btl-num">${fmtNum(M.damage)}</td>
              <td class="wp-btl-num wp-btl-bounty">${fmtMoney(M.bounty)}</td>
              <td class="wp-btl-num wp-btl-contracts">${fmtMoney(M.contracts)}</td>
              <td class="wp-btl-num wp-btl-total">${fmtMoney(M.bounty + M.contracts)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  /** Le guerre in cui l'alleanza ha combattuto, ognuna col suo link. */
  function warsTable(R, warInfo) {
    if (!R.wars.size || !warInfo) return '';
    const list = [...R.wars.entries()].map(([id, n]) => ({ id, n, w: warInfo(id) }))
      .sort((a, b) => (b.w?.total || 0) - (a.w?.total || 0) || b.n - a.n);
    const party = (id) => `<span class="wp-btl-side">${flagHtml(id)}${escapeHtml(nationName(id) || '—')}</span>`;
    return `
      <h3 class="wp-btl-h3">${btlT('tabWars')} <span class="wp-btl-sub">${list.length}</span></h3>
      <div class="wp-btl-tablewrap">
        <table class="wp-btl-table">
          <thead><tr>
            <th>${btlT('colWar')}</th>
            <th class="wp-btl-num">${btlT('allyBattlesHere')}</th>
            <th class="wp-btl-num">${btlT('colCost')}</th>
            <th></th>
          </tr></thead>
          <tbody>${list.map(({ id, n, w }) => `
            <tr>
              <td class="wp-btl-match">${w?.parties?.length
                ? `${party(w.parties[0])}${w.parties[1] ? `<span class="wp-btl-vs">vs</span>${party(w.parties[1])}` : ''}` : '—'}</td>
              <td class="wp-btl-num">${n}</td>
              <td class="wp-btl-num wp-btl-total">${w ? fmtMoney(w.total) : '—'}</td>
              <td>${warLinkHtml(id)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function battlesTable(R) {
    const list = R.list.slice(0, LAST_BATTLES);
    if (!list.length) return '';
    const sd = (s, won) => `<span class="wp-btl-side${won ? ' won' : ''}">${flagHtml(s.countryId)}${escapeHtml(nationName(s.countryId) || '—')}</span>`;
    return `
      <h3 class="wp-btl-h3">${btlT('allyLastBattles')} <span class="wp-btl-sub">${list.length} / ${R.list.length}</span></h3>
      <div class="wp-btl-tablewrap">
        <table class="wp-btl-table wp-btl-list">
          <thead><tr>
            <th>${btlT('colWhen')}</th><th>${btlT('colBattle')}</th><th class="wp-btl-th-region">${btlT('colRegion')}</th>
            <th class="wp-btl-num">${btlT('colDamage')}</th><th class="wp-btl-num">${btlT('colCost')}</th>
          </tr></thead>
          <tbody>${list.map(b => {
            const total = (b.attacker.bounty != null || b.defender.bounty != null)
              ? (b.attacker.bounty ?? 0) + (b.defender.bounty ?? 0) + (b.contracts ?? 0) : null;
            return `
            <tr class="wp-btl-row wp-btl-clickable" data-battle="${escapeHtml(b.id)}">
              <td class="wp-btl-when">${b.live ? `<span class="wp-btl-livetag"><span class="wp-btl-livedot"></span>${btlT('liveNow')}</span>` : fmtDateTime(b.endedAt)}</td>
              <td class="wp-btl-match">${sd(b.defender, b.wonBy === 'defender')}<span class="wp-btl-vs">vs</span>${sd(b.attacker, b.wonBy === 'attacker')}${warLinkHtml(b.warId, { label: false })}</td>
              <td class="wp-btl-region">${escapeHtml(state.regionData?.[b.regionId]?.name || '—')}</td>
              <td class="wp-btl-num wp-btl-dmg">${fmtNum(b.defender.damages)}<span class="wp-btl-sep">/</span>${fmtNum(b.attacker.damages)}</td>
              <td class="wp-btl-num wp-btl-total">${total == null ? '<span class="wp-btl-unk">?</span>' : fmtMoney(total)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function rowHtml(R, i, cols, warInfo) {
    const isOpen = open.has(R.aid);
    return `
      <tr class="wp-btl-row wp-btl-clickable wp-ally-row${isOpen ? ' open' : ''}${R.live ? ' wp-btl-live' : ''}" data-ally="${escapeHtml(R.aid)}">
        <td class="wp-btl-rank">${i + 1}</td>
        <td class="wp-btl-xp-name"><span class="wp-btl-nation">${allianceSwatch(R.aid)}${escapeHtml(allianceName(R.aid))}
          <span class="wp-btl-sub">${btlT('nationsCount', { n: R.members.size })}</span></span>${flagsHtml(R.membersList)}</td>
        ${mode === 'wars' ? `<td class="wp-btl-num">${R.wars.size}</td>` : ''}
        <td class="wp-btl-num">${R.battles}${R.live ? `<span class="wp-btl-livetag"><span class="wp-btl-livedot"></span>${R.live}</span>` : ''}${R.internal ? `<span class="wp-btl-sub" title="${escapeHtml(btlT('allyInternalTip'))}"> ⇄${R.internal}</span>` : ''}</td>
        <td class="wp-btl-num">${wlHtml(R.won, R.lost)}</td>
        <td class="wp-btl-num wp-btl-dmg" data-label="${escapeHtml(btlT('colDamage'))}">${fmtNum(R.damage)}<span class="wp-btl-sep">/</span>${fmtNum(R.damageTaken)}</td>
        <td class="wp-btl-num wp-btl-bounty">${fmtMoney(R.bounty)}</td>
        <td class="wp-btl-num wp-btl-contracts">${fmtMoney(R.contracts)}</td>
        <td class="wp-btl-num wp-btl-total" data-label="${escapeHtml(btlT('colCost'))}">${fmtMoney(R.total)}${R.partialCost
          ? `<span class="wp-btl-unk" title="${escapeHtml(btlT('warPartialCost', { n: R.partialCost }))}"> ≥</span>` : ''}</td>
      </tr>
      ${isOpen ? `
      <tr class="wp-war-exp"><td colspan="${cols}">
        <div class="wp-war-exp-in">
          ${oppTable(R)}
          ${membersTable(R)}
          ${warsTable(R, warInfo)}
          ${mode === 'archive' ? battlesTable(R) : ''}
        </div>
      </td></tr>` : ''}`;
  }

  function matches(R, q) {
    if (!q) return true;
    q = q.toLowerCase();
    if (allianceName(R.aid).toLowerCase().includes(q)) return true;
    return R.membersList.some(m => (nationName(m.cid) || '').toLowerCase().includes(q));
  }

  return {
    getOpen: () => (lastOpen && open.has(lastOpen) ? lastOpen : (open.size ? [...open].at(-1) : null)),
    setOpen(aid) { if (!aid) return; open.add(aid); lastOpen = aid; focus = aid; },
    takeFocus() { const f = focus; focus = null; return f; },

    /** @param agg      risultato di buildAllianceAgg
     *  @param query    testo cercato (nome alleanza o di una nazione membro)
     *  @param warInfo  (warId) → { parties, total } per i link alle guerre */
    render(agg, { query = '', warInfo = null } = {}) {
      const key = SORTS[sort] || SORTS.cost;
      const list = agg.rows.filter(r => matches(r, query))
        .sort((a, b) => (a.aid === NO_ALLIANCE) - (b.aid === NO_ALLIANCE) || key(b) - key(a) || b.damage - a.damage);
      // Un'alleanza aperta da un link deve stare dentro la pagina mostrata.
      if (focus) { const i = list.findIndex(r => r.aid === focus); if (i >= shown) shown = i + 1; }
      const visible = list.slice(0, shown);
      const cols = mode === 'wars' ? 9 : 8;
      const sortChips = [['cost', 'warSortCost'], ['damage', 'warSortDamage'], ['battles', 'warSortBattles'], ['won', 'allySortWon'],
        ...(mode === 'wars' ? [['wars', 'tabWars']] : [])];
      return `
        <div class="wp-btl-toolbar wp-btl-toolbar-sub" data-nosort>
          <div class="wp-btl-filters">
            <span class="wp-btl-meta">${btlT('warsSortBy')}</span>
            ${sortChips.map(([id, k]) => `<button type="button" class="wp-btl-chip${sort === id ? ' active' : ''}" data-asort="${id}">${btlT(k)}</button>`).join('')}
          </div>
        </div>
        ${agg.today ? `<div class="wp-btl-notice">${btlT('allyTodayNote')}</div>` : ''}
        ${visible.length ? `
          <div class="wp-btl-tablewrap">
            <table class="wp-btl-table wp-btl-list wp-ally-table">
              <thead><tr>
                <th class="wp-btl-rank">#</th>
                <th>${btlT('colAlliance')}</th>
                ${mode === 'wars' ? `<th class="wp-btl-num">${btlT('tabWars')}</th>` : ''}
                <th class="wp-btl-num">${btlT('colBattles')}</th>
                <th class="wp-btl-num">${btlT('colWonLost')}</th>
                <th class="wp-btl-num" title="${escapeHtml(btlT('allyDmgTip'))}">${btlT('allyDmgCol')}</th>
                <th class="wp-btl-num">${btlT('colBounty')}</th>
                <th class="wp-btl-num">${btlT('colContracts')}</th>
                <th class="wp-btl-num">${btlT('colCost')}</th>
              </tr></thead>
              <tbody>${visible.map((r, i) => rowHtml(r, i, cols, warInfo)).join('')}</tbody>
            </table>
          </div>
          ${list.length > shown
            ? `<button type="button" class="wp-btl-more" data-ally-more>+ ${Math.min(PAGE, list.length - shown)} / ${list.length}</button>` : ''}
        ` : `<div class="wp-btl-empty">${btlT('allyEmpty')}</div>`}
        <p class="wp-btl-foot">${btlT('allyNoteMain')}</p>`;
    },

    wire(root, { repaint, onOpenBattle, findBattle }) {
      root.querySelectorAll('[data-asort]').forEach(btn => {
        btn.addEventListener('click', () => { sort = btn.dataset.asort; shown = PAGE; repaint(); });
      });
      root.querySelector('[data-ally-more]')?.addEventListener('click', () => { shown += PAGE; repaint(); });
      root.querySelector('.wp-ally-table tbody')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-war-link]')) return;          // lo gestisce main.js
        const bt = e.target.closest('[data-battle]');
        if (bt) { const b = findBattle(bt.dataset.battle); if (b) onOpenBattle(b); return; }
        // Un fronte: apre (e porta in vista) l'alleanza avversaria.
        const jump = e.target.closest('[data-ally-jump]');
        if (jump) { const a = jump.dataset.allyJump; open.add(a); lastOpen = a; focus = a; repaint(); return; }
        const tr = e.target.closest('.wp-ally-row');
        if (!tr) return;
        const id = tr.dataset.ally;
        if (open.has(id)) open.delete(id); else { open.add(id); lastOpen = id; }
        repaint();
      });
    },
  };
}
