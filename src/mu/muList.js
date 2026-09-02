/* ══════════════════════════════════════════════════════════════
   WarEra+ — Esplora Unità Militari: elenco + ricerca
   ------------------------------------------------------------------
   Elenco SCHEMATICO a tabella, non una griglia di card: su richiesta
   esplicita dell'utente ("con la classifica a 3 colonne si perdono tanti
   dettagli"). Ogni unità è una riga con tutte le sue statistiche in
   colonna, così si confrontano leggendo in verticale invece di saltare
   da una card all'altra.

   Tre scelte di lettura, tutte richieste:

   1. **Sfondo riga colorato per tier** (bronze → master). Il tier mostrato
      è quello della colonna su cui si sta ordinando: se ordini per
      ricchezza, i colori raccontano la ricchezza. Tinta leggera (rgba a
      ~12%) più una barretta piena a sinistra — deve guidare l'occhio, non
      diventare il contenuto.
   2. **Nazione in chiaro**, bandiera + nome, colonna sua. Il filtro per
      nazione tiene anche le unità che sono di quella nazione solo DE FACTO
      (vedi matchesCountry): un'unità registrata in Italia ma composta da
      cittadini del Liechtenstein compare in entrambi gli elenchi.
   3. **Composizione dei membri in numeri**: la colonna "Composizione"
      elenca quanti membri vengono da ogni nazione ("12 🇱🇹 · 8 🇩🇪 · +5"),
      in ordine decrescente. Quando la nazionalità prevalente è DIVERSA da
      quella di registrazione — una MU registrata sotto una nazione ma di
      fatto composta da cittadini di un'altra — la cella prende il marchio
      "de facto" (vedi .wp-mu-defacto in mu.css). Il dato arriva dal server
      di cache (composizione calcolata lì una volta per tutti, vedi
      warera-cache-server.js: muComposition): senza server la colonna resta
      vuota, non sbagliata.

   Tutto in memoria: la directory arriva UNA volta (src/mu/api.js) e
   ricerca, filtro e ordinamento lavorano sull'array già sceso — nessuna
   chiamata di rete per tasto premuto. Le righe si disegnano a BLOCCHI di
   CHUNK: 1400 righe tutte insieme bloccherebbero il thread all'apertura.
   ══════════════════════════════════════════════════════════════ */

import { muT } from './i18n.js';
import { PLAYSTYLE_GROUPS } from './playstyle.js';
import { avatarImg, countryName, dominantCountry, escapeHtml, flagImg, fmtCompact, tierOf } from './ui.js';
import { ensureDailyDamage, muDamageToday } from '../shared/dailyDamage.js';
import { ensureMuReferrals, muReferrals, muReferralsInfo } from './referrals.js';

const CHUNK = 60;

// Colonne numeriche: sono anche i criteri di ordinamento (intestazione
// cliccabile) e la chiave i18n dell'etichetta è l'id stesso per i sei tipi
// di classifica.
const METRICS = [
  { id: 'muWeeklyDamages', short: 'colWeekly' },
  { id: 'muDamages',       short: 'colTotal' },
  { id: 'muTerrain',       short: 'colTerrain' },
  { id: 'muWealth',        short: 'colWealth' },
  { id: 'muBounty',        short: 'colBounty' },
  { id: 'muReputation',    short: 'colRep' },
];

// Ordinamenti non numerici (le colonne di sinistra).
const SORTS = {
  name:    { get: m => m.name || '', text: true },
  country: { get: m => countryName(m.country), text: true },
  members: { get: m => m.memberCount ?? 0 },
  // Referral: -1 (non 0) per chi non ha ancora il dato, cosi' ordinando per
  // questa colonna le unita' di cui non si sa nulla restano in fondo invece
  // di mescolarsi a quelle che hanno davvero zero inviti.
  referrals: { get: m => muReferrals(m) ?? -1 },
  // Ordina per QUOTA di membri in modalità guerra, non per numero assoluto:
  // altrimenti in cima ci sarebbero solo le unità grandi, che è già quello
  // che dice la colonna Membri.
  playstyle: { get: m => (m.playstyle?.known ? m.playstyle.war / m.playstyle.known : -1) },
  // Ordinando per "Composizione" vengono prima le unità DE FACTO di
  // un'altra nazione (è la domanda che uno si fa cliccando quella
  // intestazione), e fra quelle prima le più numerose — non le più
  // "pure": un'unità con un solo membro noto è al 100% straniera per
  // aritmetica, ma non dice niente. Le altre restano in coda ordinate
  // per omogeneità.
  defacto: {
    get: m => {
      const d = dominantCountry(m);
      if (!d) return -1;
      return d.foreign ? 1e6 + d.n : d.share;
    },
  },
  // -1 (non 0) per chi non ha il dato: ordinando per "Oggi" le unità senza
  // scatto restano in fondo invece di mescolarsi a chi oggi non ha colpito.
  today: { get: m => muDamageToday(m) ?? -1 },
};

// Stato della vista. Vive qui e non in main.js perché è tutto e solo suo:
// riaprendo la vista l'utente ritrova ricerca e ordinamento come li aveva
// lasciati.
let query = '';
let countryFilter = '';
let sortId = 'muWeeklyDamages';
let shown = CHUNK;

let hostEl = null;
let ctx = null;

/** Confronto senza accenti né maiuscole — stesso `norm` di newsView.js:
 *  cercare "Türkiye" scrivendo "turkiye" deve funzionare. */
function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function metricValue(m, id) {
  return m.rankings?.[id]?.value;
}

/** Il filtro per nazione tiene un'unità se è REGISTRATA lì oppure se è di
 *  quella nazione DE FACTO — cioè se la nazionalità prevalente dei suoi
 *  membri è quella. Non è un aut-aut: "Legio VI Ferrata" (registrata in
 *  Italia, 25 membri su 25 del Liechtenstein) compare sotto entrambe, che
 *  è come la vedono sia gli italiani sia i liechtensteinesi.
 *
 *  Stessa regola del marchio "de facto" in colonna (la nazione in cima a
 *  `composition.top`), apposta: se una riga è marcata "de facto
 *  Liechtenstein" ma poi filtrando per Liechtenstein sparisse, sarebbe una
 *  contraddizione a schermo. */
function matchesCountry(m, countryId) {
  if (!countryId) return true;
  if (m.country === countryId) return true;
  const dom = dominantCountry(m);
  return !!dom && dom.foreign && dom.country === countryId;
}

function sortedList() {
  const q = norm(query.trim());
  const arr = ctx.directory.filter(m => {
    if (!matchesCountry(m, countryFilter)) return false;
    if (q && !norm(m.name).includes(q)) return false;
    return true;
  }).slice(); // mai .sort() in place: `directory` è condivisa con classifiche e ricerca globale

  const textSort = SORTS[sortId]?.text;
  if (textSort) {
    const get = SORTS[sortId].get;
    arr.sort((a, b) => String(get(a)).localeCompare(String(get(b))));
  } else if (SORTS[sortId]) {
    const get = SORTS[sortId].get;
    arr.sort((a, b) => get(b) - get(a));
  } else {
    // Classifica: ordino per posizione, non per valore — chi non è in
    // classifica finisce in fondo invece di mescolarsi agli ultimi.
    arr.sort((a, b) => (a.rankings?.[sortId]?.rank ?? Infinity) - (b.rankings?.[sortId]?.rank ?? Infinity));
  }
  return arr;
}

export function renderMuList(host, context) {
  hostEl = host;
  ctx = context;
  shown = CHUNK;

  // Elenco nazioni per il filtro: quelle che hanno almeno un'unità, contando
  // anche le unità DE FACTO (vedi matchesCountry). Quattro nazioni —
  // Sierra Leone, Mali, Belize, Bangladesh — non hanno nessuna MU registrata
  // ma sono la nazionalità prevalente di qualcuna: senza questa unione non
  // comparirebbero affatto nella tendina, e il loro elenco sarebbe
  // irraggiungibile.
  const countryIds = new Set();
  for (const m of ctx.directory) {
    if (m.country) countryIds.add(m.country);
    const dom = dominantCountry(m);
    if (dom?.foreign) countryIds.add(dom.country);
  }
  const countries = [...countryIds]
    .map(id => ({ id, name: countryName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  host.innerHTML = `
    <div class="wp-mu-toolbar">
      <div class="wp-mu-search">
        <span class="wp-mu-search-icon" aria-hidden="true">🔍</span>
        <input type="search" class="wp-mu-search-input" id="wp-mu-search"
               placeholder="${escapeHtml(muT('searchPh'))}" aria-label="${escapeHtml(muT('searchPh'))}"
               value="${escapeHtml(query)}" autocomplete="off">
      </div>
      <label class="wp-mu-field">
        <span class="wp-mu-field-label">${escapeHtml(muT('country'))}</span>
        <select class="wp-mu-select" id="wp-mu-country">
          <option value="">${escapeHtml(muT('allCountries'))}</option>
          ${countries.map(c => `<option value="${escapeHtml(c.id)}"${c.id === countryFilter ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </label>
      <span class="wp-mu-count" id="wp-mu-count"></span>
    </div>
    <div class="wp-mu-table" id="wp-mu-table"></div>
    <div class="wp-mu-more-wrap"><button type="button" class="wp-mu-more" id="wp-mu-more" hidden></button></div>`;

  host.querySelector('#wp-mu-search').addEventListener('input', (e) => {
    query = e.target.value; shown = CHUNK; paint();
  });
  host.querySelector('#wp-mu-search').addEventListener('keydown', (e) => {
    // Esc svuota il campo invece di chiudere l'intero overlay.
    if (e.key === 'Escape' && e.target.value) {
      e.stopPropagation();
      e.target.value = ''; query = ''; shown = CHUNK; paint();
    }
  });
  host.querySelector('#wp-mu-country').addEventListener('change', (e) => {
    countryFilter = e.target.value; shown = CHUNK; paint();
  });
  host.querySelector('#wp-mu-more').addEventListener('click', () => {
    shown += CHUNK; paint();
  });

  paint();
  // La colonna "Oggi" arriva dal server di cache: quando lo scatto è pronto
  // si ridisegna, senza far aspettare l'elenco (che è già tutto in memoria).
  ensureDailyDamage().then(baseline => { if (baseline && hostEl === host) paint(); });
  // Stessa cosa per i referral: la classifica globale (una GET, vedi
  // src/mu/referrals.js) arriva dopo il primo disegno e la colonna si
  // riempie da sola. Finche' non c'e', resta un trattino.
  ensureMuReferrals().then(map => { if (map && hostEl === host) paint(); });
}

function headerHtml() {
  const th = (id, label, cls = '') =>
    `<button type="button" class="wp-mu-th ${cls}${id === sortId ? ' active' : ''}" data-sort="${id}">${escapeHtml(label)}</button>`;
  return `
    <div class="wp-mu-thead">
      <span class="wp-mu-th wp-mu-th-static">#</span>
      ${th('name', muT('sortName'), 'wp-mu-th-left')}
      ${th('country', muT('country'), 'wp-mu-th-left')}
      ${th('defacto', muT('colComposition'), 'wp-mu-th-left')}
      ${th('playstyle', muT('colPlaystyle'), 'wp-mu-th-left')}
      ${th('members', muT('colMembers'), 'wp-mu-th-num')}
      ${th('referrals', muT('colReferrals'), 'wp-mu-th-num')}
      ${METRICS.map((m, i) => th(m.id, muT(m.short), 'wp-mu-th-num')
          // "Oggi" sta subito dopo il settimanale, da cui è ricavata.
          + (i === 0 ? th('today', muT('colToday'), 'wp-mu-th-num') : '')).join('')}
    </div>`;
}

function paint() {
  const table = hostEl?.querySelector('#wp-mu-table');
  if (!table) return;
  const list = sortedList();
  const slice = list.slice(0, shown);

  const countEl = hostEl.querySelector('#wp-mu-count');
  if (countEl) {
    countEl.textContent = list.length ? `${muT('showing')} ${slice.length} ${muT('of')} ${list.length}` : '';
  }

  if (!list.length) {
    table.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('noResults'))}${query.trim() ? ` “${escapeHtml(query.trim())}”` : ''}</div>`;
  } else {
    table.innerHTML = headerHtml() + slice.map((m, i) => rowHtml(m, i + 1)).join('');
    table.querySelectorAll('.wp-mu-th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        sortId = th.dataset.sort; shown = CHUNK; paint();
      });
    });
    table.querySelectorAll('.wp-mu-row').forEach(row => {
      row.addEventListener('click', () => ctx.onOpenMu(row.dataset.muId));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onOpenMu(row.dataset.muId); }
      });
    });
  }

  const more = hostEl.querySelector('#wp-mu-more');
  if (more) {
    const remaining = list.length - slice.length;
    more.hidden = remaining <= 0;
    more.textContent = `${muT('loadMore')} (${remaining})`;
  }
}

// Quante nazionalità si mostrano per riga. Tre bastano: misurato sulle 60
// unità di vertice, una MU ha 1 nazionalità in mediana, 3 al 90° percentile,
// e le prime tre coprono il 99% dei membri. Quello che avanza finisce nel
// chip "+N", e il tooltip riporta comunque l'elenco per esteso.
//
// Il taglio a due su schermo stretto è QUI e non nel CSS apposta: nascondere
// un chip con `display:none` lascerebbe il "+N" a contare solo quelli oltre
// il terzo, cioè un numero sbagliato.
function maxChips() {
  return window.matchMedia('(max-width: 768px)').matches ? 2 : 3;
}

/** Composizione in NUMERI: "12 🇱🇹 · 8 🇩🇪 · +5", in ordine decrescente.
 *  Quando la nazionalità prevalente è diversa da quella di registrazione la
 *  cella prende il marchio "de facto" (bordo viola) — è lì che serve
 *  saltare all'occhio scorrendo l'elenco. */
function compositionCell(m) {
  const comp = m.composition;
  if (!comp?.known) return '<span class="wp-mu-cell-empty">—</span>';

  const shown = comp.top.slice(0, maxChips());
  const rest = comp.known - shown.reduce((sum, t) => sum + t.n, 0);
  const dom = dominantCountry(m);

  const chips = shown.map(t => `
    <span class="wp-mu-chip" title="${escapeHtml(countryName(t.country))}">
      <strong>${t.n}</strong>${flagImg(t.country)}
    </span>`);
  if (rest > 0) chips.push(`<span class="wp-mu-chip wp-mu-chip-rest">+${rest}</span>`);

  // Tooltip completo: i nomi per esteso, che nelle bandierine non si leggono.
  const title = comp.top.map(t => `${t.n} ${countryName(t.country)}`).join(' · ')
    + (rest > 0 ? ` · +${rest} ${muT('others')}` : '')
    + (comp.known < comp.total ? ` (${comp.known}/${comp.total})` : '');

  const flag = dom?.foreign ? ` wp-mu-defacto${dom.share < 0.5 ? ' wp-mu-defacto-weak' : ''}` : '';
  return `<span class="wp-mu-cell-comp${flag}" title="${escapeHtml(title)}">${chips.join('')}</span>`;
}

/** Quanti membri giocano di guerra, quanti di economia, quanti in mezzo —
 *  in numeri, come la colonna Composizione accanto. Il conteggio arriva dal
 *  server (mu.playstyle): qui non si possono classificare 1400 unità dal
 *  vivo, servirebbero le skill di 16k utenti. Nella scheda della singola
 *  unità lo stesso conto è invece fatto sul momento e completo.
 *
 *  "Indecisi" (nessun punto abilità speso) non ha un suo numero in riga: è
 *  l'assenza di una scelta, occuperebbe spazio senza dire niente. Resta nel
 *  tooltip e nella scheda. */
function playstyleCell(m) {
  const p = m.playstyle;
  if (!p?.known) return '<span class="wp-mu-cell-empty">—</span>';
  const title = PLAYSTYLE_GROUPS
    .filter(g => p[g] > 0)
    .map(g => `${p[g]} ${muT(PS_LABEL_KEY[g])}`)
    .join(' · ') + (p.known < (m.memberCount ?? p.known) ? ` (${p.known}/${m.memberCount})` : '');
  return `
    <span class="wp-mu-cell-ps" title="${escapeHtml(title)}">
      ${['war', 'eco', 'mixed'].map(g => `
        <span class="wp-mu-ps-chip${p[g] ? '' : ' wp-mu-ps-zero'}" aria-label="${escapeHtml(muT(PS_LABEL_KEY[g]))}">
          <span class="wp-ps-dot wp-ps-${g}"></span>${p[g]}
        </span>`).join('')}
    </span>`;
}

const PS_LABEL_KEY = { war: 'psWar', eco: 'psEco', mixed: 'psMixed', undecided: 'psUndecided' };

/* ── Colonna "Oggi" (WarEra+) ──
   Il danno di giornata dell'unità, ricavato dallo scatto che il server di
   cache prende al cambio giorno di gioco (vedi src/shared/dailyDamage.js):
   accanto al settimanale dice se un'unità in cima alla classifica sta
   ancora spingendo oggi o se il suo totale è l'eco di lunedì.

   Finché lo scatto non è arrivato (o se il server non ce l'ha) la cella
   resta un trattino, e l'elenco funziona come prima. */
function todayCell(m) {
  const v = muDamageToday(m);
  return `<span class="wp-mu-cell-num${sortId === 'today' ? ' wp-mu-cell-sorted' : ''}">
    ${v == null ? '<span class="wp-mu-cell-empty">—</span>' : escapeHtml(fmtCompact(v))}
  </span>`;
}

/* ── Colonna "Referral" (WarEra+) ──
   Quanti giocatori hanno portato nel gioco, in tutto, i membri di questa
   unita'. WarEra non pubblica chi ha invitato chi (vedi il blocco in testa
   a src/mu/referrals.js): questo e' la somma dei contatori personali dei
   membri, cosi' come la classifica globale li vedeva.

   Il tooltip porta sempre il massimo singolo perche' la distribuzione e'
   estremamente concentrata — misurato il 2026-09-02: la prima unita' al
   mondo ha 519 referral, di cui 515 di un solo membro. Senza quel numero
   la colonna farebbe leggere come reclutamento di squadra quello che quasi
   sempre e' il lavoro di una persona. */
function referralsCell(m) {
  const info = muReferralsInfo(m);
  const cls = `wp-mu-cell-num${sortId === 'referrals' ? ' wp-mu-cell-sorted' : ''}`;
  if (!info) return `<span class="${cls}"><span class="wp-mu-cell-empty">—</span></span>`;

  // Copertura: quanti membri la classifica vedeva davvero in questa unita'.
  // Si scrive solo quando NON coincide col totale dei membri, come fa la
  // colonna Composizione — un "24/24" su ogni riga sarebbe rumore.
  const total = m.memberCount ?? info.known;
  const parts = [`${info.total} ${muT('colReferrals')}`];
  if (info.known < total) parts.push(`${info.known}/${total} ${muT('refRanked')}`);
  if (info.total > 0) parts.push(`${muT('refTop')}: ${info.top}`);

  return `<span class="${cls}" title="${escapeHtml(parts.join(' · '))}">
    ${info.total ? escapeHtml(fmtCompact(info.total)) : '<span class="wp-mu-cell-empty">0</span>'}
  </span>`;
}

function rowHtml(m, position) {
  // Il colore della riga segue la colonna su cui si ordina: se non è una
  // classifica (nome, membri, nazione…) si ricade sul tier dei danni
  // settimanali, il metro di paragone principale fra unità.
  const tintRanking = m.rankings?.[sortId] || m.rankings?.muWeeklyDamages;
  const tier = tierOf(tintRanking);

  const composition = compositionCell(m);

  return `
    <div class="wp-mu-row${tier ? ` wp-mu-tint-${tier}` : ''}" data-mu-id="${escapeHtml(m._id)}" tabindex="0">
      <span class="wp-mu-cell-pos">${position}</span>
      <span class="wp-mu-cell-name">
        ${avatarImg(m.avatarUrl, m.name, 'wp-mu-avatar wp-mu-avatar-sm')}
        <span class="wp-mu-name-text">${escapeHtml(m.name)}</span>
      </span>
      <span class="wp-mu-cell-country">
        ${flagImg(m.country)}
        <span class="wp-mu-cell-country-name">${escapeHtml(countryName(m.country))}</span>
      </span>
      ${composition}
      ${playstyleCell(m)}
      <span class="wp-mu-cell-num">${m.memberCount}</span>
      ${referralsCell(m)}
      ${METRICS.map((metric, i) => {
        const v = metricValue(m, metric.id);
        const t = tierOf(m.rankings?.[metric.id]);
        return `<span class="wp-mu-cell-num${metric.id === sortId ? ' wp-mu-cell-sorted' : ''}">
          ${v == null ? '<span class="wp-mu-cell-empty">—</span>' : `${escapeHtml(fmtCompact(v))}<span class="wp-mu-cell-rank wp-mu-rank-${t}">#${m.rankings[metric.id].rank}</span>`}
        </span>` + (i === 0 ? todayCell(m) : '');
      }).join('')}
    </div>`;
}
