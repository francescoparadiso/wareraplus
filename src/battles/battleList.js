/* ══════════════════════════════════════════════════════════════
   WarEra+ — Scheda "Archivio battaglie"
   ------------------------------------------------------------------
   Tabella delle battaglie concluse, più recenti prima: chi contro chi,
   quanto danno per lato, quanto è costata.

   Due modalità, entrambe legittime, distinte in interfaccia:
   · con il server storico i costi sono GIÀ nella riga;
   · senza, la riga nasce senza costi e un bottone li carica per quella
     sola battaglia (2+1 chiamate). Meglio un bottone onesto che uno
     zero inventato — da qui il campo `partial` in api.js.

   Nomi di nazione e regione NON si scaricano: stanno già in
   state.nationMap e state.regionData dal boot della mappa. L'archivio dal
   server porta solo id, ed è il motivo per cui pesa poco.

   ── BATTAGLIE IN CORSO (WarEra+) ───────────────────────────────────
   In cima all'elenco, sempre prima delle concluse e mai mescolate a
   loro: sono l'unica parte della tabella che si muove, e vanno lette
   come un blocco a sé. Arrivano da getLiveBattles() (vedi la testata di
   api.js: stessa sorgente dei marker sulla mappa, giro più lento).
   Sono `partial` per costruzione — taglia e contratti di una battaglia
   ancora aperta non stanno nell'elenco — quindi riusano il bottone
   "carica costo" già esistente per il fallback, che su una riga viva
   diventa "aggiorna" perché il numero continua a crescere.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { btlT } from './i18n.js';
import { getBattleBounty, getBattleContracts } from './api.js';

// Righe mostrate per blocco: stessa scelta dell'elenco MU (60 righe), che
// tiene la tabella scorrevole senza impaginare a mano.
const PAGE = 60;

let _shown = PAGE;
let _query = '';
let _typeFilter = 'all';

function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

/** I costi sono monete di gioco e stanno spesso sotto la decina: fmtNum
 *  (tarato sui danni) appiattirebbe tutto a "—" o a interi grossolani. */
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(2);
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** Da quanto va avanti una battaglia in corso. Una riga viva non ha una
 *  data di fine da mostrare, e "da 3h 20m" dice molto di più dell'ora in
 *  cui è cominciata. */
function fmtElapsed(startedAt) {
  if (!startedAt) return '';
  const mins = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
  if (mins < 60) return btlT('sinceMin', { n: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return btlT('sinceHour', { h, m: mins % 60 });
  return btlT('sinceDay', { d: Math.floor(h / 24), h: h % 24 });
}

function nationName(id) {
  return state.nationMap?.get(id)?.name || null;
}

function regionName(id) {
  const r = state.regionData?.[id];
  return r?.name || null;
}

function flagHtml(id) {
  const n = state.nationMap?.get(id);
  if (!n) return '';
  const url = getFlagUrl(getNationCode(id, n));
  return url ? `<img class="wp-btl-flag" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
}

function sideHtml(side, won) {
  const name = nationName(side.countryId);
  // Battaglie di torneo: non c'è una nazione, c'è una squadra. Meglio
  // dirlo che stampare "—" e lasciare l'utente a indovinare.
  const label = name ? escapeHtml(name) : `<span class="wp-btl-noname">${btlT('typeTournament')}</span>`;
  return `<span class="wp-btl-side${won ? ' won' : ''}">${flagHtml(side.countryId)}${label}</span>`;
}

function typeLabel(t) {
  if (t === 'resistance') return btlT('typeResistance');
  if (t === 'tournament') return btlT('typeTournament');
  return btlT('typeWar');
}

// Le chip mescolano due domande diverse in una riga sola: che TIPO di
// battaglia (guerra/rivolta/torneo) e in che STATO (in corso/conclusa).
// Sono poche e stanno bene insieme, ma solo le prime tre filtrano per
// tipo — le altre le gestisce renderBattleList scegliendo quali blocchi
// disegnare. Senza questo insieme, il filtro "in corso" confrontava
// 'live' con b.type e svuotava la tabella.
const TYPE_IDS = new Set(['war', 'resistance', 'tournament']);

function matches(b) {
  if (TYPE_IDS.has(_typeFilter) && b.type !== _typeFilter) return false;
  if (!_query) return true;
  const q = _query.toLowerCase();
  return [nationName(b.attacker.countryId), nationName(b.defender.countryId), regionName(b.regionId)]
    .some(s => s && s.toLowerCase().includes(q));
}

function rowHtml(b) {
  const atkWon = b.wonBy === 'attacker';
  const defWon = b.wonBy === 'defender';
  const bounty = (b.attacker.bounty ?? 0) + (b.defender.bounty ?? 0);
  const knowBounty = b.attacker.bounty != null || b.defender.bounty != null;
  const knowContracts = b.contracts != null;
  const total = (knowBounty ? bounty : 0) + (knowContracts ? b.contracts : 0);

  return `
    <tr data-id="${b.id}" class="wp-btl-row wp-btl-clickable wp-btl-type-${b.type}${b.live ? ' wp-btl-live' : ''}">
      <td class="wp-btl-when">${b.live
        ? `<span class="wp-btl-livetag"><span class="wp-btl-livedot"></span>${btlT('liveNow')}</span><span class="wp-btl-since">${escapeHtml(fmtElapsed(b.startedAt))}</span>`
        : fmtDate(b.endedAt)}</td>
      <td class="wp-btl-match">
        ${sideHtml(b.defender, defWon)}
        <span class="wp-btl-vs">vs</span>
        ${sideHtml(b.attacker, atkWon)}
        <span class="wp-btl-type">${typeLabel(b.type)}</span>
      </td>
      <td class="wp-btl-region">${escapeHtml(regionName(b.regionId) || '—')}</td>
      <td class="wp-btl-num">${fmtNum(b.defender.damages)}<span class="wp-btl-sep">/</span>${fmtNum(b.attacker.damages)}</td>
      <td class="wp-btl-num wp-btl-bounty">${knowBounty ? fmtMoney(bounty) : '<span class="wp-btl-unk">?</span>'}</td>
      <td class="wp-btl-num wp-btl-contracts">${knowContracts
        ? `${fmtMoney(b.contracts)}${b.contractCount ? `<span class="wp-btl-sub">×${b.contractCount}</span>` : ''}`
        : '<span class="wp-btl-unk">?</span>'}</td>
      <td class="wp-btl-num wp-btl-total">${(knowBounty || knowContracts)
        ? `${fmtMoney(total)}${b.live ? `<button type="button" class="wp-btl-load wp-btl-load-inline" data-load="${b.id}" data-live="1" title="${btlT('refreshCost')}">↻</button>` : ''}`
        : `<button type="button" class="wp-btl-load" data-load="${b.id}"${b.live ? ' data-live="1"' : ''}>${btlT('loadCost')}</button>`}</td>
    </tr>`;
}

export function renderBattleList(archive, presetCountry) {
  // Un filtro arrivato dalla scheda spese sostituisce la ricerca corrente:
  // è una scelta esplicita dell'utente, deve vincere su quella vecchia.
  if (presetCountry) {
    _query = nationName(presetCountry) || '';
    _shown = PAGE;
  }

  // Le battaglie in corso non entrano nella paginazione delle concluse:
  // sono poche decine, stanno tutte, e sono la parte che si guarda per
  // prima. Il filtro "in corso" mostra solo loro.
  const live = (archive.live || []).filter(matches);
  const showLive = _typeFilter !== 'ended';
  const showEnded = _typeFilter !== 'live';

  const list = showEnded ? archive.battles.filter(matches) : [];
  const visible = list.slice(0, _shown);
  const liveRows = showLive ? live : [];

  const notices = [];
  if (archive.degraded) notices.push(`<div class="wp-btl-notice warn">${btlT('degraded')}</div>`);
  else if (archive.retentionDays) {
    const days = Math.max(1, Math.round((Date.now() - (archive.battles.at(-1)?.endedAt || Date.now())) / 86400000));
    notices.push(`<div class="wp-btl-notice">${btlT('coverage', { n: days })}</div>`);
    if (days < archive.retentionDays - 2) notices.push(`<div class="wp-btl-notice">${btlT('bootstrapping')}</div>`);
  }

  // Riga di separazione fra il blocco vivo e l'archivio: senza, la prima
  // battaglia conclusa sembra ancora in corso.
  const divider = (liveRows.length && visible.length)
    ? `<tr class="wp-btl-divider"><td colspan="7">${btlT('endedSection')}</td></tr>`
    : '';

  return `
    ${notices.join('')}
    <div class="wp-btl-toolbar">
      <input type="search" class="wp-btl-search" id="wp-btl-search"
             placeholder="${btlT('search')}" value="${escapeHtml(_query)}">
      <div class="wp-btl-filters">
        ${[['all', 'filterAll'], ['live', 'filterLive'], ['ended', 'filterEnded'],
           ['war', 'typeWar'], ['resistance', 'typeResistance'], ['tournament', 'typeTournament']]
          .map(([id, k]) => `<button type="button" class="wp-btl-chip${_typeFilter === id ? ' active' : ''}${id === 'live' ? ' wp-btl-chip-live' : ''}" data-type="${id}">${id === 'live' ? '<span class="wp-btl-livedot"></span>' : ''}${btlT(k)}${id === 'live' && live.length ? ` <span class="wp-btl-sub">${live.length}</span>` : ''}</button>`)
          .join('')}
      </div>
      ${archive.liveAt ? `<span class="wp-btl-meta" id="wp-btl-liveat">${btlT('liveUpdated', { t: new Date(archive.liveAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</span>` : ''}
    </div>
    ${(liveRows.length || visible.length) ? `
      <div class="wp-btl-tablewrap">
        <table class="wp-btl-table">
          <thead><tr>
            <th>${liveRows.length ? btlT('colWhenMixed') : btlT('colWhen')}</th>
            <th>${btlT('colBattle')}</th>
            <th class="wp-btl-th-region">${btlT('colRegion')}</th>
            <th class="wp-btl-num">${btlT('colDamage')}</th>
            <th class="wp-btl-num">${btlT('colBounty')}</th>
            <th class="wp-btl-num">${btlT('colContracts')}</th>
            <th class="wp-btl-num">${btlT('colCost')}</th>
          </tr></thead>
          <tbody>${liveRows.map(rowHtml).join('')}${divider}${visible.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      ${list.length > _shown
        ? `<button type="button" class="wp-btl-more" id="wp-btl-more">+ ${Math.min(PAGE, list.length - _shown)} / ${list.length}</button>`
        : ''}
    ` : `<div class="wp-btl-empty">${btlT('empty')}</div>`}
    ${liveRows.length ? `<p class="wp-btl-foot">${btlT('liveNote')}</p>` : ''}
    <p class="wp-btl-foot">${btlT('bountyNote')}</p>`;
}

export function wireBattleList(root, archive, repaint, onOpenDetail) {
  const search = root.querySelector('#wp-btl-search');
  if (search) {
    search.addEventListener('input', () => {
      _query = search.value.trim();
      _shown = PAGE;
      repaint();
      // Ridisegnando si perde il fuoco: si rimette dov'era, altrimenti
      // scrivere una parola richiederebbe un click per lettera.
      const s = document.getElementById('wp-btl-search');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    });
  }

  root.querySelectorAll('.wp-btl-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _typeFilter = chip.dataset.type;
      _shown = PAGE;
      repaint();
    });
  });

  const more = root.querySelector('#wp-btl-more');
  if (more) more.addEventListener('click', () => { _shown += PAGE; repaint(); });

  const findRow = (id) =>
    (archive.live || []).find(x => x.id === id) || archive.battles.find(x => x.id === id);

  // ── Un solo ascoltatore sul corpo tabella, non uno per riga ──
  // Il bottone "carica costo" riscrive la propria riga con outerHTML: gli
  // ascoltatori appesi al vecchio <tr> muoiono con lui, e prima di questa
  // delega quella riga restava cliccabile solo in apparenza (il dettaglio
  // non si apriva più). Con le righe vive, che si ricaricano apposta, il
  // problema sarebbe diventato la norma invece che un caso di bordo.
  const tbody = root.querySelector('.wp-btl-table tbody');
  if (!tbody) return;

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.wp-btl-load');

    // Costo su richiesta: due chiamate per la taglia e una per i contratti,
    // per QUELLA battaglia. Su una battaglia conclusa api.js le memorizza,
    // quindi ricliccare non ricompra nulla; su una viva sì, apposta.
    if (btn) {
      e.stopPropagation();   // la riga apre il dettaglio: non qui
      if (btn.disabled) return;
      const id = btn.dataset.load;
      const isLive = btn.dataset.live === '1';
      btn.disabled = true;
      btn.textContent = btlT('loadingCost');
      const [bounty, contracts] = await Promise.all([
        getBattleBounty(id, { live: isLive }),
        getBattleContracts(id),
      ]);
      const row = findRow(id);
      const tr = btn.closest('tr');
      if (!row || !tr) return;
      row.attacker.bounty = bounty.atk;
      row.defender.bounty = bounty.def;
      row.contracts = contracts.total;
      row.contractCount = contracts.count;
      row.partial = false;
      // Si riscrive la sola riga toccata: ridisegnare tutta la tabella
      // farebbe saltare la posizione di scorrimento e il testo cercato.
      tr.outerHTML = rowHtml(row);
      return;
    }

    // Clic sulla riga = apri il dettaglio (scomposizione per nazione).
    const tr = e.target.closest('.wp-btl-row');
    if (!tr) return;
    const b = findRow(tr.dataset.id);
    if (b) onOpenDetail(b);
  });
}
