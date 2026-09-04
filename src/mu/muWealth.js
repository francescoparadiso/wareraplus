/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bilancio dell'unità (linguetta riservata)
   ------------------------------------------------------------------
   La sola parte CHIUSA della vista Unità militari. Tutto il resto —
   elenco, classifiche, schede — è aperto a chiunque; questa linguetta
   compare solo a chi comanda in gioco un'unità italiana (o italiana de
   facto) ed è entrato con Discord nell'area riservata.

   La linguetta non si disegna se il server non la concede. Ma il
   permesso vero lo dà il server ad OGNI chiamata, non la linguetta
   nascosta — una linguetta nascosta non è un permesso negato (stessa
   regola di server/plusApi/index.js).

   ── DUE SCHERMATE, E PERCHÉ IN QUEST'ORDINE ────────────────────────
   1. ELENCO: una riga per unità, coi suoi numeri. Costa ZERO richieste
      a WarEra (il server la calcola in SQL sugli scatti in archivio),
      quindi con trenta unità la domanda «chi sta perdendo» si risponde
      guardando, non aprendo trenta schede. Si cerca, si filtra, si
      ordina.
   2. SCHEDA: una riga per membro, dentro una sola unità. Qui sì che si
      legge la ricchezza dal vivo, perché serve il giorno IN CORSO — ed
      è il motivo per cui si paga solo sull'unità che si apre davvero.

   Chi comanda una sola unità salta il primo passo: un elenco di una
   riga è un clic chiesto per niente.

   ── COSA MOSTRA, E COSA NON PRETENDE DI MOSTRARE ───────────────────
   Il numero è il SALDO NETTO della ricchezza fra due scatti: entrate
   meno uscite. Risponde a «la mia unità si sta dissanguando?», che è la
   domanda di chi comanda, ma NON è la spesa militare isolata: un membro
   a −80k può essersi armato o aver sbagliato una compravendita, e questa
   vista non li distingue. Lo dice in testa invece di far passare il
   saldo per un conto della guerra — la stessa trappola di
   `rankings.countryBounty`, che sembra la spesa di una nazione e non lo è.

   ── L'ARCHIVIO PARTE VUOTO, E SI VEDE ──────────────────────────────
   Nessuna API di WarEra dice quanto aveva un giocatore ieri, quindi lo
   storico si accumula da quando il server ha cominciato a fotografarlo:
   il primo giorno non c'è niente da confrontare e i sette giorni pieni
   arrivano dopo una settimana. La fascia di copertura lo dichiara: un
   giorno mancante è «non lo sappiamo», mai uno zero.
   ══════════════════════════════════════════════════════════════ */

import { fetchBilancio, fetchPanoramica, WealthError } from './wealthApi.js';
import { muT } from './i18n.js';
import { avatarImg, escapeHtml, fmtCompact, fmtFull } from './ui.js';
import { trackEvent } from '../shared/analytics.js';

// Sotto questa soglia, in valore assoluto, un'unità si dichiara "in pari":
// una manciata di monete su un patrimonio non è una tendenza, e chiamarla
// perdita farebbe sembrare drammatico un arrotondamento.
const SOGLIA_PARI = 0.005; // 0,5% della ricchezza

let hostEl = null;
let unitaDisponibili = [];

// ── Elenco ──────────────────────────────────────────────────────────
let pano = null;
let statoPano = 'vuoto';   // 'vuoto' | 'carico' | 'pronto' | 'errore'
let erroreP = null;
let cerca = '';
let filtro = 'tutte';      // 'tutte' | 'perdita' | 'guadagno'
let soloMie = false;
let ordineElenco = { campo: 'settimana', verso: 'asc' }; // chi perde di più in cima

// ── Scheda ──────────────────────────────────────────────────────────
let muScelta = null;
let dati = null;
let stato = 'vuoto';
let errore = null;
let ordine = { campo: 'totale', verso: 'asc' };

/**
 * @param {HTMLElement} host   contenitore della linguetta
 * @param {object[]} unita     le unità concesse (da /wealth/unita)
 */
export function renderMuWealth(host, unita) {
  hostEl = host;
  unitaDisponibili = unita || [];

  if (!unitaDisponibili.length) {
    hostEl.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('wNoUnits'))}</div>`;
    return;
  }

  // Una sola unità: l'elenco sarebbe una riga sola, e un clic per
  // arrivare all'unica cosa che si può guardare è un clic di troppo.
  if (unitaDisponibili.length === 1) {
    if (!muScelta) muScelta = unitaDisponibili[0].id;
    if (!dati && stato !== 'carico') caricaScheda();
    else disegnaScheda();
    return;
  }

  if (muScelta) { disegnaScheda(); return; }
  if (!pano && statoPano !== 'carico') caricaElenco();
  else disegnaElenco();
}

// ---------------------------------------------------------------------------
// Caricamenti
// ---------------------------------------------------------------------------

async function caricaElenco({ forza = false } = {}) {
  statoPano = 'carico';
  erroreP = null;
  if (forza) pano = null;
  disegnaElenco();
  try {
    pano = await fetchPanoramica();
    statoPano = 'pronto';
    trackEvent('mu-wealth-overview', { unita: pano?.unita?.length ?? 0 });
  } catch (err) {
    statoPano = 'errore';
    erroreP = err instanceof WealthError ? err.codice : 'errore';
    console.warn('WarEra+ bilancio unità (elenco):', err);
  }
  disegnaElenco();
}

async function caricaScheda({ forza = false } = {}) {
  stato = 'carico';
  errore = null;
  if (forza) dati = null;
  disegnaScheda();
  try {
    dati = await fetchBilancio(muScelta);
    stato = 'pronto';
    trackEvent('mu-wealth-open', { membri: dati?.riassunto?.membriTotali ?? 0 });
  } catch (err) {
    stato = 'errore';
    errore = err instanceof WealthError ? err.codice : 'errore';
    console.warn('WarEra+ bilancio unità:', err);
  }
  disegnaScheda();
}

function apriUnita(muId) {
  muScelta = muId;
  dati = null;
  stato = 'vuoto';
  caricaScheda();
}

function tornaAllElenco() {
  muScelta = null;
  dati = null;
  stato = 'vuoto';
  if (!pano && statoPano !== 'carico') caricaElenco();
  else disegnaElenco();
}

// ---------------------------------------------------------------------------
// Pezzi condivisi
// ---------------------------------------------------------------------------

const segno = (v) => (v > 0 ? 'su' : v < 0 ? 'giu' : 'pari');

/** Numero col segno davanti: "+12,4k" / "−8,1k". Il meno è quello vero
 *  (U+2212), non un trattino: allineato ai numeri e non spezza la riga. */
function delta(v) {
  if (v == null) return '—';
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${fmtCompact(Math.abs(v))}`;
}

function deltaCella(v, extra = '') {
  if (v == null) return `<span class="wp-mw-nd" title="${escapeHtml(muT('wNoHistory'))}">—</span>`;
  return `<span class="wp-mw-d wp-mw-${segno(v)}${extra}">${escapeHtml(delta(v))}</span>`;
}

/** Verdetto di una serie: guadagna, perde o è in pari. La soglia è
 *  relativa al patrimonio, non assoluta: +2k valgono diversamente per
 *  un'unità da 40k e per una da un milione. */
function verdettoDi(saldo, patrimonio) {
  if (saldo == null) return null;
  const base = Math.max(1, Math.abs(patrimonio || 0));
  if (Math.abs(saldo) / base < SOGLIA_PARI) return 'pari';
  return saldo > 0 ? 'su' : 'giu';
}

/** L'etichetta di colonna di un intervallo. Il giorno mostrato è quello
 *  che l'intervallo COPRE (lo scatto di partenza), non quello in cui è
 *  stato chiuso: la colonna "lun" deve dire cos'è successo lunedì. */
function etichettaIntervallo(iv) {
  if (iv.inCorso) return muT('wToday');
  const locale = document.documentElement.lang || undefined;
  const [y, m, d] = iv.da.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** Il sottotitolo di colonna: quanto copre davvero quell'intervallo. Si
 *  mostra SOLO quando non sono le solite 24 ore — un giorno saltato o il
 *  primo scatto di sempre — perché è lì che il numero va letto diverso. */
function noteIntervallo(iv) {
  if (iv.inCorso) return iv.ore != null ? `${iv.ore}${muT('wHours')}` : muT('wSoFar');
  if (iv.giorni > 1) return `${iv.giorni}${muT('wDaysSpan')}`;
  if (iv.ore != null && (iv.ore < 20 || iv.ore > 28)) return `${iv.ore}${muT('wHours')}`;
  return '';
}

/** La fascia di copertura. Non è un avviso d'errore: è la differenza fra
 *  «nessuno ha speso niente» e «non lo sappiamo», che senza questa riga il
 *  lettore non ha modo di fare. */
function fasciaCopertura(c) {
  if (!c || c.completa) {
    return c?.primoGiorno
      ? `<div class="wp-mw-cov wp-mw-cov-ok">${escapeHtml(muT('wCoverageFrom'))} ${escapeHtml(c.primoGiorno)}</div>`
      : '';
  }
  const testo = muT('wCoverageShort')
    .replace('{n}', String(c.giorniDisponibili || 0))
    .replace('{tot}', String(c.giorniRichiesti || 8));
  return `
    <div class="wp-mw-cov wp-mw-cov-parziale">
      <strong>${escapeHtml(muT('wBuilding'))}</strong>
      <span>${escapeHtml(testo)}</span>
    </div>`;
}

function intestazione(sottotitolo, bottoni) {
  return `
    <header class="wp-mw-testa">
      <div class="wp-mw-testa-sx">
        <h2 class="wp-mw-titolo">${escapeHtml(muT('wTitle'))}</h2>
        <p class="wp-mw-lead">${sottotitolo}</p>
      </div>
      <div class="wp-mw-testa-dx">${bottoni}</div>
    </header>`;
}

// ---------------------------------------------------------------------------
// SCHERMATA 1 — l'elenco delle unità
// ---------------------------------------------------------------------------

/** Micro-grafico della settimana dentro la cella: barrette sulla linea
 *  dello zero, in su i guadagni e in giù le perdite. La scala è COMUNE a
 *  tutte le righe — è quello che rende confrontabili due unità a colpo
 *  d'occhio, che è tutto il motivo per cui l'elenco esiste. */
function scintilla(serie, max) {
  const n = serie.length || 1;
  const larghezza = 100 / n;
  const barre = serie.map((v, i) => {
    if (v == null) return '';
    const h = Math.max(2, (Math.abs(v) / max) * 48);
    const y = v < 0 ? 50 : 50 - h;
    return `<rect x="${(i * larghezza + larghezza * 0.15).toFixed(2)}" y="${y.toFixed(2)}"
      width="${(larghezza * 0.7).toFixed(2)}" height="${h.toFixed(2)}"
      class="wp-mw-sc-${segno(v)}"></rect>`;
  }).join('');
  return `
    <svg class="wp-mw-scintilla" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="50" x2="100" y2="50" class="wp-mw-sc-zero"></line>
      ${barre}
    </svg>`;
}

function unitaFiltrate() {
  const q = cerca.trim().toLowerCase();
  const comandate = new Set(pano.comandate || []);
  return pano.unita.filter((u) => {
    if (q && !String(u.nome || u.id).toLowerCase().includes(q)) return false;
    if (soloMie && !comandate.has(u.id)) return false;
    if (filtro === 'perdita' && !(u.settimana < 0)) return false;
    if (filtro === 'guadagno' && !(u.settimana > 0)) return false;
    return true;
  });
}

function ordinaElenco(righe) {
  const v = ordineElenco.verso === 'asc' ? 1 : -1;
  const chiave = (u) => {
    switch (ordineElenco.campo) {
      case 'nome': return String(u.nome || u.id).toLowerCase();
      case 'membri': return u.membri ?? 0;
      case 'ricchezza': return u.ricchezza ?? 0;
      case 'ultimo': return u.ultimo ?? 0;
      case 'media': return u.media ?? 0;
      default: return u.settimana ?? 0;
    }
  };
  return [...righe].sort((a, b) => {
    const ka = chiave(a);
    const kb = chiave(b);
    if (typeof ka === 'string') return ka.localeCompare(kb) * v;
    return (ka - kb) * v;
  });
}

function tabellaElenco(righe) {
  const th = (campo, testo, cls = '') => `
    <button type="button" class="wp-mu-th ${cls}${ordineElenco.campo === campo ? ' active' : ''}" data-ordu="${escapeHtml(campo)}">
      ${escapeHtml(testo)}
    </button>`;

  const max = Math.max(1, ...pano.unita.flatMap((u) => u.serie.filter((x) => x != null).map(Math.abs)));
  const comandate = new Set(pano.comandate || []);

  const corpo = righe.map((u) => {
    const verdetto = verdettoDi(u.settimana, u.ricchezza);
    return `
      <div class="wp-mw-urow wp-mw-u-${verdetto || 'vuoto'}" role="button" tabindex="0" data-mu="${escapeHtml(u.id)}">
        <span class="wp-mw-cell-nome">
          ${avatarImg(u.avatar, u.nome)}
          <span class="wp-mw-nome" title="${escapeHtml(u.nome || u.id)}">${escapeHtml(u.nome || u.id)}</span>
          ${u.deFacto ? `<span class="wp-mu-defacto wp-mw-tag-df">${escapeHtml(muT('deFacto'))}</span>` : ''}
          ${comandate.has(u.id) ? `<span class="wp-mw-tag wp-mw-tag-mia">${escapeHtml(muT('wYours'))}</span>` : ''}
        </span>
        <span class="wp-mw-num">${u.membri ?? '—'}</span>
        <span class="wp-mw-num" title="${escapeHtml(fmtFull(u.ricchezza))}">${u.ricchezza != null ? escapeHtml(fmtCompact(u.ricchezza)) : '—'}</span>
        <span class="wp-mw-cell-sc">${scintilla(u.serie, max)}</span>
        <span class="wp-mw-num">${deltaCella(u.ultimo)}</span>
        <span class="wp-mw-num wp-mw-tot">${deltaCella(u.settimana)}</span>
        <span class="wp-mw-num">${deltaCella(u.media)}</span>
      </div>`;
  }).join('');

  return `
    <div class="wp-mw-utable">
      <div class="wp-mw-uthead">
        ${th('nome', muT('wColUnit'), 'wp-mu-th-left')}
        ${th('membri', muT('wColMembers'), 'wp-mu-th-num')}
        ${th('ricchezza', muT('wCurrent'), 'wp-mu-th-num')}
        <span class="wp-mu-th wp-mu-th-static">${escapeHtml(muT('wTrend'))}</span>
        ${th('ultimo', muT('wYesterday'), 'wp-mu-th-num')}
        ${th('settimana', muT('wTotal7'), 'wp-mu-th-num')}
        ${th('media', muT('wAvgDay'), 'wp-mu-th-num')}
      </div>
      ${corpo || `<div class="wp-mu-empty">${escapeHtml(muT('wNoMatch'))}</div>`}
    </div>`;
}

function disegnaElenco() {
  if (!hostEl) return;

  const bottoni = `<button type="button" class="wp-mu-more" id="wp-mw-refresh">${escapeHtml(muT('wRefresh'))}</button>`;
  let corpo;

  if (statoPano === 'carico' || (!pano && statoPano !== 'errore')) {
    corpo = `<div class="wp-mu-empty">${escapeHtml(muT('wLoading'))}</div>`;
  } else if (statoPano === 'errore') {
    const messaggio = erroreP === 'non_autenticato' ? muT('wAuthNeeded') : muT('wError');
    corpo = `
      <div class="wp-mu-empty">
        ${escapeHtml(messaggio)}
        <button type="button" class="wp-mu-more" id="wp-mw-retry">${escapeHtml(muT('wRetry'))}</button>
      </div>`;
  } else if (!pano.intervalli.length) {
    corpo = `${fasciaCopertura(pano.copertura)}<div class="wp-mu-empty">${escapeHtml(muT('wNoData'))}</div>`;
  } else {
    const righe = ordinaElenco(unitaFiltrate());
    const r = pano.riassunto;
    const chip = (v, testo) => `
      <button type="button" class="wp-mw-chip${filtro === v ? ' active' : ''}" data-filtro="${v}">${escapeHtml(testo)}</button>`;

    corpo = `
      ${fasciaCopertura(pano.copertura)}
      <section class="wp-mw-somma">
        <span class="wp-mw-somma-cifra wp-mw-${segno(r.settimana ?? 0)}">${escapeHtml(delta(r.settimana))}</span>
        <span class="wp-mw-somma-et">${escapeHtml(muT('wWeek7'))}</span>
        <span class="wp-mw-somma-nota">${escapeHtml(muT('wUnitsLine').replace('{u}', String(r.unita)).replace('{p}', String(r.giocatori)))}
          · ${escapeHtml(fmtCompact(r.ricchezza))}</span>
      </section>
      <div class="wp-mw-filtri">
        <input type="search" id="wp-mw-cerca" class="wp-mw-cerca" placeholder="${escapeHtml(muT('wSearchPh'))}" value="${escapeHtml(cerca)}">
        <div class="wp-mw-chips">
          ${chip('tutte', muT('wFilterAll'))}
          ${chip('perdita', muT('wFilterLosing'))}
          ${chip('guadagno', muT('wFilterGaining'))}
          ${(pano.comandate || []).length && pano.admin
            ? `<button type="button" class="wp-mw-chip${soloMie ? ' active' : ''}" id="wp-mw-mie">${escapeHtml(muT('wOnlyMine'))}</button>`
            : ''}
        </div>
      </div>
      ${tabellaElenco(righe)}
      <p class="wp-mw-pie">
        ${escapeHtml(muT('wLegend'))}
        ${pano.copertura.ultimoGiorno ? ` · ${escapeHtml(muT('wAsOf'))} ${escapeHtml(pano.copertura.ultimoGiorno)}` : ''}
        · ${escapeHtml(muT('wOpenForToday'))}
      </p>`;
  }

  hostEl.innerHTML = `<div class="wp-mw-page">${intestazione(escapeHtml(muT('wLead')), bottoni)}${corpo}</div>`;
  agganciaElenco();
}

function agganciaElenco() {
  hostEl.querySelector('#wp-mw-refresh')?.addEventListener('click', () => caricaElenco({ forza: true }));
  hostEl.querySelector('#wp-mw-retry')?.addEventListener('click', () => caricaElenco({ forza: true }));

  const campo = hostEl.querySelector('#wp-mw-cerca');
  campo?.addEventListener('input', (e) => {
    cerca = e.target.value;
    disegnaElenco();
    // Ridisegnando si perde il fuoco: si rimette dov'era, altrimenti
    // scrivere una parola richiede un clic per lettera.
    const nuovo = hostEl.querySelector('#wp-mw-cerca');
    nuovo?.focus();
    nuovo?.setSelectionRange(nuovo.value.length, nuovo.value.length);
  });

  hostEl.querySelectorAll('[data-filtro]').forEach((b) => {
    b.addEventListener('click', () => { filtro = b.dataset.filtro; disegnaElenco(); });
  });
  hostEl.querySelector('#wp-mw-mie')?.addEventListener('click', () => { soloMie = !soloMie; disegnaElenco(); });

  hostEl.querySelectorAll('[data-ordu]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = b.dataset.ordu;
      if (ordineElenco.campo === c) ordineElenco.verso = ordineElenco.verso === 'asc' ? 'desc' : 'asc';
      else ordineElenco = { campo: c, verso: c === 'nome' ? 'asc' : c === 'settimana' || c === 'ultimo' || c === 'media' ? 'asc' : 'desc' };
      disegnaElenco();
    });
  });

  hostEl.querySelectorAll('[data-mu]').forEach((r) => {
    r.addEventListener('click', () => apriUnita(r.dataset.mu));
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apriUnita(r.dataset.mu); }
    });
  });
}

// ---------------------------------------------------------------------------
// SCHERMATA 2 — la scheda di una unità
// ---------------------------------------------------------------------------

/** Il verdetto: la risposta in una riga, prima di qualunque tabella. */
function pannelloVerdetto(r) {
  const settimana = r.riassunto.settimana;
  const verdetto = verdettoDi(settimana, r.riassunto.ricchezzaTotale);

  const titolo = verdetto === 'su' ? muT('wGaining')
    : verdetto === 'giu' ? muT('wLosing')
      : verdetto === 'pari' ? muT('wEven')
        : muT('wNoData');

  const inCorso = r.riassunto.inCorso;
  const ivCorrente = r.intervalli.at(-1);

  return `
    <section class="wp-mw-verdetto wp-mw-v-${verdetto || 'vuoto'}">
      <div class="wp-mw-v-testa">
        <span class="wp-mw-v-icona" aria-hidden="true">${verdetto === 'su' ? '▲' : verdetto === 'giu' ? '▼' : verdetto === 'pari' ? '=' : '·'}</span>
        <h3>${escapeHtml(titolo)}</h3>
      </div>
      <div class="wp-mw-v-cifre">
        <div class="wp-mw-v-cifra">
          <span class="wp-mw-v-et">${escapeHtml(muT('wWeek7'))}</span>
          <span class="wp-mw-v-val wp-mw-${segno(settimana ?? 0)}">${escapeHtml(delta(settimana))}</span>
          ${r.riassunto.mediaGiornaliera != null
            ? `<span class="wp-mw-v-nota">${escapeHtml(delta(r.riassunto.mediaGiornaliera))} ${escapeHtml(muT('wPerDay'))}</span>`
            : ''}
        </div>
        <div class="wp-mw-v-cifra">
          <span class="wp-mw-v-et">${escapeHtml(muT('wToday'))}</span>
          <span class="wp-mw-v-val wp-mw-${segno(inCorso ?? 0)}">${escapeHtml(delta(inCorso))}</span>
          ${ivCorrente?.ore != null
            ? `<span class="wp-mw-v-nota">${ivCorrente.ore}${escapeHtml(muT('wHours'))} · ${escapeHtml(muT('wSoFar'))}</span>`
            : ''}
        </div>
        <div class="wp-mw-v-cifra">
          <span class="wp-mw-v-et">${escapeHtml(muT('wTotalWealth'))}</span>
          <span class="wp-mw-v-val">${escapeHtml(fmtCompact(r.riassunto.ricchezzaTotale))}</span>
          <span class="wp-mw-v-nota">${r.riassunto.membriTotali} ${escapeHtml(muT('wMembersN'))}${
            r.riassunto.membriSenzaStorico
              ? ` · ${r.riassunto.membriSenzaStorico} ${escapeHtml(muT('wNoHistory'))}`
              : ''}</span>
        </div>
      </div>
    </section>`;
}

/** Le barre giorno per giorno dell'INTERA unità. Barre e non un grafico a
 *  linea: quello che conta è il segno e la grandezza relativa di ogni
 *  giornata, non l'andamento continuo di una curva.
 *
 *  Crescono da una LINEA DELLO ZERO a metà altezza — in su i guadagni, in
 *  giù le perdite. Non è decorazione: con tutte le barre appoggiate in
 *  basso, una giornata da −112k disegna una colonna alta esattamente come
 *  una da +112k, e il colpo d'occhio dice "grande giornata" a chi ha
 *  appena perso un patrimonio. */
function barre(r) {
  const max = Math.max(1, ...r.totali.map((t) => Math.abs(t.delta)));
  return `
    <section class="wp-mw-barre" role="img" aria-label="${escapeHtml(muT('wSub'))}">
      ${r.intervalli.map((iv, i) => {
        const t = r.totali[i];
        // Metà altezza per lato: una barra piena occupa la sua metà, non
        // tutta la traccia.
        const h = Math.max(1.5, (Math.abs(t.delta) / max) * 50);
        const nota = noteIntervallo(iv);
        const verso = t.delta < 0 ? 'top:50%' : 'bottom:50%';
        return `
          <div class="wp-mw-barra${iv.inCorso ? ' wp-mw-barra-corso' : ''}" title="${escapeHtml(`${etichettaIntervallo(iv)} · ${delta(t.delta)} · ${t.membri} ${muT('wMembersN')}`)}">
            <div class="wp-mw-barra-corpo">
              <span class="wp-mw-barra-zero" aria-hidden="true"></span>
              <span class="wp-mw-barra-riemp wp-mw-bg-${segno(t.delta)}" style="${verso};height:${h.toFixed(1)}%"></span>
            </div>
            <span class="wp-mw-barra-val wp-mw-${segno(t.delta)}">${escapeHtml(delta(t.delta))}</span>
            <span class="wp-mw-barra-et">${escapeHtml(etichettaIntervallo(iv))}</span>
            ${nota ? `<span class="wp-mw-barra-nota">${escapeHtml(nota)}</span>` : ''}
          </div>`;
      }).join('')}
    </section>`;
}

function membriOrdinati(r) {
  const v = ordine.verso === 'asc' ? 1 : -1;
  const chiave = (m) => {
    if (ordine.campo === 'nome') return (m.username || '').toLowerCase();
    if (ordine.campo === 'attuale') return m.attuale ?? 0;
    if (ordine.campo === 'oggi') return m.serie.at(-1) ?? 0;
    if (ordine.campo.startsWith('g')) return m.serie[Number(ordine.campo.slice(1))] ?? 0;
    return m.totale ?? 0;
  };
  return [...r.membri].sort((a, b) => {
    const ka = chiave(a);
    const kb = chiave(b);
    if (typeof ka === 'string') return ka.localeCompare(kb) * v;
    if (ka === kb) return 0;
    return (ka - kb) * v;
  });
}

function tabellaMembri(r) {
  const th = (campo, testo, nota = '', cls = '') => `
    <button type="button" class="wp-mu-th ${cls}${ordine.campo === campo ? ' active' : ''}" data-ord="${escapeHtml(campo)}">
      ${escapeHtml(testo)}${nota ? `<span class="wp-mw-th-nota">${escapeHtml(nota)}</span>` : ''}
    </button>`;

  const colonneGiorni = r.intervalli.map((iv, i) => {
    const campo = iv.inCorso ? 'oggi' : `g${i}`;
    return th(campo, etichettaIntervallo(iv), noteIntervallo(iv), 'wp-mu-th-num');
  }).join('');

  const righe = membriOrdinati(r).map((m) => `
    <div class="wp-mw-row${m.nuovo ? ' wp-mw-row-nuovo' : ''}">
      <span class="wp-mw-cell-nome">
        ${avatarImg(m.avatar, m.username)}
        <span class="wp-mw-nome" title="${escapeHtml(m.username || '')}">${escapeHtml(m.username || '—')}</span>
        ${m.nuovo ? `<span class="wp-mw-tag">${escapeHtml(muT('wNew'))}</span>` : ''}
      </span>
      <span class="wp-mw-num" title="${escapeHtml(fmtFull(m.attuale))}">${escapeHtml(fmtCompact(m.attuale))}</span>
      ${m.serie.map((v, i) => `<span class="wp-mw-num">${deltaCella(v, r.intervalli[i].inCorso ? ' wp-mw-corso' : '')}</span>`).join('')}
      <span class="wp-mw-num wp-mw-tot">${deltaCella(m.totale)}</span>
    </div>`).join('');

  return `
    <div class="wp-mw-table" style="--wp-mw-giorni:${r.intervalli.length}">
      <div class="wp-mw-thead">
        ${th('nome', muT('wMember'), '', 'wp-mu-th-left')}
        ${th('attuale', muT('wCurrent'), '', 'wp-mu-th-num')}
        ${colonneGiorni}
        ${th('totale', muT('wTotal7'), '', 'wp-mu-th-num')}
      </div>
      ${righe}
    </div>`;
}

function disegnaScheda() {
  if (!hostEl) return;

  const meta = unitaDisponibili.find((u) => u.id === muScelta) || {};
  const nome = dati?.unita?.nome || meta.nome || muScelta;
  const indietro = unitaDisponibili.length > 1
    ? `<button type="button" class="wp-mu-more wp-mw-indietro" id="wp-mw-back">← ${escapeHtml(muT('wBackToUnits'))}</button>`
    : '';
  const bottoni = `${indietro}<button type="button" class="wp-mu-more" id="wp-mw-refresh">${escapeHtml(muT('wRefresh'))}</button>`;

  const sottotitolo = `<span class="wp-mw-solo">${escapeHtml(nome)}${
    (dati?.unita?.deFacto ?? meta.deFacto) ? ` <span class="wp-mu-defacto">${escapeHtml(muT('deFacto'))}</span>` : ''}</span>`;

  let corpo;
  if (stato === 'carico' || (!dati && stato !== 'errore')) {
    corpo = `<div class="wp-mu-empty">${escapeHtml(muT('wLoading'))}</div>`;
  } else if (stato === 'errore') {
    const messaggio = errore === 'non_autorizzato' ? muT('wNotItalian')
      : errore === 'non_autenticato' ? muT('wAuthNeeded')
        : muT('wError');
    corpo = `
      <div class="wp-mu-empty">
        ${escapeHtml(messaggio)}
        <button type="button" class="wp-mu-more" id="wp-mw-retry">${escapeHtml(muT('wRetry'))}</button>
      </div>`;
  } else if (!dati.intervalli.length) {
    // Archivio del tutto vuoto: è il primo giorno, e non c'è niente di
    // rotto da segnalare — c'è solo un domani da aspettare.
    corpo = `${fasciaCopertura(dati.copertura)}<div class="wp-mu-empty">${escapeHtml(muT('wNoData'))}</div>`;
  } else {
    const locale = document.documentElement.lang || undefined;
    const letto = new Date(dati.letteIl).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    corpo = `
      ${fasciaCopertura(dati.copertura)}
      ${pannelloVerdetto(dati)}
      ${barre(dati)}
      ${tabellaMembri(dati)}
      <p class="wp-mw-pie">
        ${escapeHtml(muT('wLegend'))} · ${escapeHtml(muT('wUpdated'))} ${escapeHtml(letto)}${
          dati.riassunto.nonRisolti
            ? ` · ${escapeHtml(muT('wNotResolved').replace('{n}', String(dati.riassunto.nonRisolti)))}`
            : ''}
      </p>`;
  }

  hostEl.innerHTML = `<div class="wp-mw-page">${intestazione(sottotitolo, bottoni)}${corpo}</div>`;
  agganciaScheda();
}

function agganciaScheda() {
  hostEl.querySelector('#wp-mw-back')?.addEventListener('click', tornaAllElenco);
  hostEl.querySelector('#wp-mw-refresh')?.addEventListener('click', () => caricaScheda({ forza: true }));
  hostEl.querySelector('#wp-mw-retry')?.addEventListener('click', () => caricaScheda({ forza: true }));

  hostEl.querySelectorAll('[data-ord]').forEach((b) => {
    b.addEventListener('click', () => {
      const campo = b.dataset.ord;
      // Ripremere la stessa colonna gira il verso; una colonna nuova parte
      // dal verso che ha senso per lei — i nomi dalla A, i patrimoni dai
      // più grandi, le perdite prima.
      if (ordine.campo === campo) ordine.verso = ordine.verso === 'asc' ? 'desc' : 'asc';
      else ordine = { campo, verso: campo === 'nome' ? 'asc' : campo === 'attuale' ? 'desc' : 'asc' };
      disegnaScheda();
    });
  });
}
