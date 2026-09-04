/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bilancio dell'unità (linguetta riservata)
   ------------------------------------------------------------------
   La sola parte CHIUSA della vista Unità militari. Tutto il resto —
   elenco, classifiche, schede — è aperto a chiunque; questa linguetta
   compare solo a chi comanda in gioco un'unità italiana (o italiana de
   facto) ed è entrato con Discord nell'area riservata.

   La linguetta non si disegna nemmeno se il server non la concede: vedi
   `caricaAccesso()` in main.js. Ma il permesso vero lo dà il server ad
   OGNI chiamata, non la linguetta nascosta — una linguetta nascosta non
   è un permesso negato (stessa regola di server/plusApi/index.js).

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

import { fetchBilancio, WealthError } from './wealthApi.js';
import { muT } from './i18n.js';
import { avatarImg, escapeHtml, fmtCompact, fmtFull } from './ui.js';
import { trackEvent } from '../shared/analytics.js';

// Sotto questa soglia, in valore assoluto, l'unità si dichiara "in pari":
// una manciata di monete su un patrimonio non è una tendenza, e chiamarla
// perdita farebbe sembrare drammatico un arrotondamento.
const SOGLIA_PARI = 0.005; // 0,5% della ricchezza totale

let hostEl = null;
let unitaDisponibili = [];
let muScelta = null;
let dati = null;
let stato = 'vuoto';     // 'vuoto' | 'carico' | 'pronto' | 'errore'
let errore = null;
let ordine = { campo: 'totale', verso: 'asc' }; // chi perde di più in cima

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
  if (!muScelta || !unitaDisponibili.some((u) => u.id === muScelta)) {
    muScelta = unitaDisponibili[0].id;
    dati = null;
  }
  if (!dati && stato !== 'carico') carica();
  else disegna();
}

async function carica({ forza = false } = {}) {
  stato = 'carico';
  errore = null;
  if (forza) dati = null;
  disegna();
  try {
    dati = await fetchBilancio(muScelta);
    stato = 'pronto';
    trackEvent('mu-wealth-open', { membri: dati?.riassunto?.membriTotali ?? 0 });
  } catch (err) {
    stato = 'errore';
    errore = err instanceof WealthError ? err.codice : 'errore';
    console.warn('WarEra+ bilancio unità:', err);
  }
  disegna();
}

// ---------------------------------------------------------------------------
// Pezzi di disegno
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

/** L'etichetta di colonna di un intervallo. Il giorno che si mostra è
 *  quello che l'intervallo COPRE (lo scatto di partenza), non quello in
 *  cui è stato chiuso: la colonna "lun" deve dire cos'è successo lunedì. */
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

function selettoreUnita() {
  if (unitaDisponibili.length < 2) {
    const u = unitaDisponibili[0];
    return `<span class="wp-mw-solo">${escapeHtml(u.nome || u.id)}${u.deFacto ? ` <span class="wp-mu-defacto">${escapeHtml(muT('deFacto'))}</span>` : ''}</span>`;
  }
  return `
    <label class="wp-mw-pick">
      <span>${escapeHtml(muT('wPickMu'))}</span>
      <select id="wp-mw-mu">
        ${unitaDisponibili.map((u) => `
          <option value="${escapeHtml(u.id)}"${u.id === muScelta ? ' selected' : ''}>
            ${escapeHtml(u.nome || u.id)}${u.deFacto ? ` (${escapeHtml(muT('deFacto'))})` : ''}
          </option>`).join('')}
      </select>
    </label>`;
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

/** Il verdetto: la risposta in una riga, prima di qualunque tabella. */
function pannelloVerdetto(r) {
  const settimana = r.riassunto.settimana;
  const patrimonio = Math.max(1, Math.abs(r.riassunto.ricchezzaTotale || 0));
  const verdetto = settimana == null ? null
    : Math.abs(settimana) / patrimonio < SOGLIA_PARI ? 'pari'
      : settimana > 0 ? 'su' : 'giu';

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
    // Chi non ha il dato resta in fondo comunque si ordini: un "—" in
    // cima alla classifica di chi perde di più sarebbe una risposta falsa.
    if (ka === kb) return 0;
    return (ka - kb) * v;
  });
}

function tabella(r) {
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

// ---------------------------------------------------------------------------
// Disegno e ascolto
// ---------------------------------------------------------------------------

function disegna() {
  if (!hostEl) return;

  const testa = `
    <header class="wp-mw-testa">
      <div class="wp-mw-testa-sx">
        <h2 class="wp-mw-titolo">${escapeHtml(muT('wTitle'))}</h2>
        <p class="wp-mw-lead">${escapeHtml(muT('wLead'))}</p>
      </div>
      <div class="wp-mw-testa-dx">
        ${selettoreUnita()}
        <button type="button" class="wp-mu-more" id="wp-mw-refresh">${escapeHtml(muT('wRefresh'))}</button>
      </div>
    </header>`;

  let corpo;
  if (stato === 'carico') {
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
  } else if (!dati) {
    corpo = `<div class="wp-mu-empty">${escapeHtml(muT('wLoading'))}</div>`;
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
      ${tabella(dati)}
      <p class="wp-mw-pie">
        ${escapeHtml(muT('wLegend'))} · ${escapeHtml(muT('wUpdated'))} ${escapeHtml(letto)}${
          dati.riassunto.nonRisolti
            ? ` · ${escapeHtml(muT('wNotResolved').replace('{n}', String(dati.riassunto.nonRisolti)))}`
            : ''}
      </p>`;
  }

  hostEl.innerHTML = `<div class="wp-mw-page">${testa}${corpo}</div>`;
  aggancia();
}

function aggancia() {
  hostEl.querySelector('#wp-mw-mu')?.addEventListener('change', (e) => {
    muScelta = e.target.value;
    dati = null;
    carica();
  });
  hostEl.querySelector('#wp-mw-refresh')?.addEventListener('click', () => carica({ forza: true }));
  hostEl.querySelector('#wp-mw-retry')?.addEventListener('click', () => carica({ forza: true }));

  hostEl.querySelectorAll('[data-ord]').forEach((b) => {
    b.addEventListener('click', () => {
      const campo = b.dataset.ord;
      // Ripremere la stessa colonna gira il verso; una colonna nuova parte
      // dal verso che ha senso per lei — i nomi dalla A, i soldi dai
      // numeri più grandi in valore, le perdite prima.
      if (ordine.campo === campo) ordine.verso = ordine.verso === 'asc' ? 'desc' : 'asc';
      else ordine = { campo, verso: campo === 'nome' ? 'asc' : campo === 'attuale' ? 'desc' : 'asc' };
      disegna();
    });
  });
}
