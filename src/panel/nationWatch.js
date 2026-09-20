/* ══════════════════════════════════════════════════════════════
   WarEra+ — "Sotto osservazione": il blocco da consultare ogni giorno
   ------------------------------------------------------------------
   Segnalato dall'utente: «nella schermata a destra metterei in primo
   piano aspetti come lista dei proxy ufficiali e detectati dal sistema,
   gente in war/eco e relativi passaggi recenti, info utili che una
   persona deve consultare periodicamente».

   È una richiesta di ORDINE, non di dati nuovi: il pannello nazione
   apriva con il grafico del parlamento — bello da vedere, ma un
   parlamento cambia alle elezioni, cioè una volta ogni tanto. Le cose
   che cambiano tutti i giorni (chi ti orbita intorno, dove sta andando
   la popolazione, chi entra e chi esce) stavano sotto o non c'erano.
   Qui stanno in cima, tutte insieme, nell'ordine in cui ci si guarda.

   Tre sezioni:

   1. SFERA — i proxy di questa nazione, CSV e rilevati dal radar
      insieme, ognuno col suo marchio di provenienza (vedi
      src/proxy/radar.js). E, se invece è lei a orbitare intorno a
      qualcuno, chi è il patrono. Costo: zero, è tutto già in memoria.

   2. GUERRA / ECO — non è disegnata qui: il contenitore
      #wp-panel-playstyle resta quello di sempre e lo riempie
      countryPanel.js:renderPlaystyle, delta a 24 ore compreso. Questo
      modulo si limita a tenergli il posto in cima invece che a metà
      pannello.

   3. MOVIMENTI — chi è arrivato e chi se n'è andato negli ultimi 7
      giorni, da /citizen-moves.

   ── ⚠️ I MOVIMENTI NON HANNO UN RIPIEGO, ED È VOLUTO ──────────────
   La regola di cacheClient.js («ogni funzione ha un fallback, il server
   è un'ottimizzazione e mai un nuovo punto di fallimento») qui non si
   può applicare: non esiste una chiamata diretta che dica chi ha
   cambiato nazione. WarEra pubblica dove uno sta ADESSO, punto. Il
   trasferimento è una differenza fra due fotografie, e le fotografie le
   tiene solo il VPS (server/citizenMoves.js). Quindi il degrado è lo
   stesso di /damage-timeline: senza server la sezione non compare
   affatto, e il resto del pannello resta identico.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { t } from '../shared/i18n.js';
import { getFlagUrl, getNationCode } from './nationFlag.js';
import { proxiesOfPrimary, patronOf, MAP_THRESHOLD } from '../proxy/radar.js';

const MOVES_DAYS = 7;
// Il server è un'ottimizzazione anche quando non ha ripieghi: se è giù,
// meglio accorgersene in fretta e non mostrare la sezione che tenere il
// pannello in attesa. Stesso ordine di grandezza di cacheClient.js.
const FETCH_TIMEOUT_MS = 4000;

/* ── Sezione 1: la sfera ──────────────────────────────────────── */

function proxyBadge(proxy) {
  if (proxy.source === 'csv') {
    const conflict = proxy.conflictWith
      ? ` <span class="wp-proxy-conflict" title="${escapeHtml((t('radar_conflict_title') || '').replace('{patron}', state.nationMap.get(proxy.conflictWith)?.name || '?'))}">≠</span>`
      : '';
    return `<span class="wp-proxy-badge csv" title="${escapeHtml(t('radar_csv_title'))}">${t('radar_csv_badge')}</span>${conflict}`;
  }
  const pct = Math.round(proxy.p * 100);
  const weak = proxy.p < MAP_THRESHOLD ? ' weak' : '';
  return `<span class="wp-proxy-badge radar${weak}" title="${escapeHtml(t('radar_detected_title'))}">${pct}%</span>`;
}

function nationRow(id, extraHtml = '') {
  const n = state.nationMap.get(id);
  if (!n) return '';
  const flag = getFlagUrl(getNationCode(id, n));
  return `
    <button type="button" class="wp-watch-row" data-watch-nation="${id}">
      ${flag ? `<img class="wp-watch-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : '<span class="wp-watch-flag"></span>'}
      <span class="wp-watch-name">${escapeHtml(n.name)}</span>
      ${extraHtml}
    </button>`;
}

function sphereSectionHtml(nationId) {
  const proxies = proxiesOfPrimary(nationId).filter(p => state.nationMap.has(p.id));
  const patron = patronOf(nationId);

  if (!proxies.length && !patron) return '';

  let html = `<div class="wp-panel-section-title">${t('watch_sphere_title')}</div>`;

  if (patron) {
    html += `<div class="wp-watch-patron">${t('watch_patron_of')}</div>${nationRow(patron)}`;
  }

  if (proxies.length) {
    // Ordinati per popolazione attiva: la domanda "chi mi orbita intorno"
    // si legge dal più pesante, non in ordine alfabetico.
    const pop = id => state.nationMap.get(id)?.rankings?.countryActivePopulation?.value || 0;
    const sorted = [...proxies].sort((a, b) => pop(b.id) - pop(a.id));
    const csvN = sorted.filter(p => p.source === 'csv').length;
    html += `
      <div class="wp-watch-sub">${t('watch_proxies_label')}
        <span class="wp-panel-ps-count">${sorted.length}</span>
        <span class="wp-watch-split">${t('watch_proxies_split', { csv: csvN, radar: sorted.length - csvN })}</span>
      </div>
      ${sorted.map(p => nationRow(p.id, proxyBadge(p))).join('')}`;
  }

  return html;
}

/* ── Sezione 3: chi entra e chi esce ──────────────────────────── */

async function fetchMoves(countryId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${WARERA_CACHE_BASE}/citizen-moves?countryId=${encodeURIComponent(countryId)}&days=${MOVES_DAYS}`,
      { signal: controller.signal });
    if (!res.ok) return null;          // 404 = server non ancora rideployato
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function playerLink(row) {
  const name = row.username || row.u.slice(-6);
  const avatar = row.avatarUrl
    ? `<img class="wp-watch-avatar" src="${escapeHtml(row.avatarUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '<span class="wp-watch-avatar"></span>';
  return `<a class="wp-watch-player" href="https://app.warera.io/user/${encodeURIComponent(row.u)}"
             target="_blank" rel="noopener">${avatar}<span>${escapeHtml(name)}</span></a>`;
}

function otherNation(id) {
  if (!id) return `<span class="wp-watch-gone">${t('watch_left_game')}</span>`;
  const n = state.nationMap.get(id);
  if (!n) return '<span class="wp-watch-gone">—</span>';
  const flag = getFlagUrl(getNationCode(id, n));
  return `<span class="wp-watch-other" data-watch-nation="${id}">
      ${flag ? `<img class="wp-watch-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
      ${escapeHtml(n.name)}
    </span>`;
}

function movesListHtml(rows, dirKey, arrow) {
  if (!rows.length) return `<div class="wp-watch-empty">${t('watch_moves_none')}</div>`;
  return rows.map(r => `
    <div class="wp-watch-move">
      ${playerLink(r)}
      <span class="wp-watch-arrow">${arrow}</span>
      ${otherNation(dirKey === 'in' ? r.from : r.to)}
    </div>`).join('');
}

function movesHtml(data) {
  const { arrivals, departures } = data;
  // La fascia compare finché l'archivio è più giovane della finestra che
  // sta mostrando: prima di quella data l'assenza di un movimento non
  // vuol dire che non ce ne siano stati. Stessa regola dei bonifici fra
  // tesori e del danno orario.
  const windowStart = Date.now() - MOVES_DAYS * 24 * 60 * 60 * 1000;
  const partial = data.coverageFrom && data.coverageFrom > windowStart
    ? `<div class="wp-watch-partial">${t('watch_moves_partial', {
        date: new Date(data.coverageFrom).toLocaleDateString(),
      })}</div>`
    : '';

  return `
    <div class="wp-panel-section-title">${t('watch_moves_title', { d: MOVES_DAYS })}</div>
    ${partial}
    <div class="wp-watch-moves-head">
      <span class="in">↘ ${t('watch_moves_in')} <b>${arrivals.length}</b></span>
      <span class="out">↗ ${t('watch_moves_out')} <b>${departures.length}</b></span>
    </div>
    <div class="wp-watch-moves-cols">
      <div class="wp-watch-moves-col in">${movesListHtml(arrivals, 'in', '←')}</div>
      <div class="wp-watch-moves-col out">${movesListHtml(departures, 'out', '→')}</div>
    </div>`;
}

/* ── API del modulo ───────────────────────────────────────────── */

/**
 * Lo scheletro, sincrono: va dentro buildPanelHtml subito sotto
 * l'intestazione. Include il contenitore #wp-panel-playstyle, che resta
 * di countryPanel.js — qui gli si tiene solo il posto in cima.
 */
export function nationWatchHtml(nationId) {
  return `
    <div class="wp-watch">
      <div id="wp-panel-sphere-watch">${sphereSectionHtml(nationId)}</div>
      <div id="wp-panel-playstyle"></div>
      <div id="wp-panel-moves"></div>
    </div>`;
}

/**
 * Solo la sezione sfera, per quando il radar finisce DOPO che il pannello
 * è già aperto.
 *
 * ⚠️ Ha un contenitore suo apposta: rigenerare l'intero blocco a radar
 * pronto sostituirebbe anche #wp-panel-playstyle, e renderPlaystyle —
 * che quel nodo se lo è preso PRIMA dell'await — finirebbe per scrivere
 * dentro un elemento ormai staccato dal documento. Sintomo: la sezione
 * guerra/eco resta vuota su una nazione che i dati ce li ha. Verificato
 * dal vivo (Italia, 411 cittadini classificati e riquadro bianco).
 */
export function refreshSphereWatch(nationId, openNation) {
  const host = document.getElementById('wp-panel-sphere-watch');
  if (!host) return;
  host.innerHTML = sphereSectionHtml(nationId);
  if (openNation) wireNationWatch(host, openNation);
}

/**
 * La parte che arriva dalla rete. `stillCurrent` è lo stesso guard delle
 * altre pitture del pannello: se nel frattempo si è aperta un'altra
 * nazione, non si scrive niente.
 */
export async function paintNationWatch(nationId, stillCurrent, openNation) {
  const host = document.getElementById('wp-panel-moves');
  if (!host) return;
  const data = await fetchMoves(nationId);
  if (!stillCurrent() || !document.getElementById('wp-panel-moves')) return;
  // Server vecchio o irraggiungibile: la sezione non compare, il resto
  // del pannello è identico. Vedi il ⚠️ in testa al file.
  if (!data || !Array.isArray(data.arrivals)) return;
  host.innerHTML = movesHtml(data);
  // Le nazioni nominate qui dentro arrivano DOPO wireNationWatch, quindi
  // si agganciano da sole: altrimenti sarebbero le uniche righe morte.
  if (openNation) wireNationWatch(host, openNation);
}

/** Aggancia i click: ogni nazione nominata qui apre il proprio pannello. */
export function wireNationWatch(root, openNation) {
  root.querySelectorAll('[data-watch-nation]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openNation(el.dataset.watchNation);
    });
  });
}
