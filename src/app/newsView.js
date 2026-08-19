/* ══════════════════════════════════════════════════════════════
   WarEra+ — Vista "News" (Approfondimenti)
   ------------------------------------------------------------------
   Richiesta esplicita dell'utente: "nella sezione insight vorrei che
   facessi un notiziario con tutte le info del ticker, chiamato News".

   Il ticker in cima alla mappa fa scorrere un ASSAGGIO delle notizie
   (max 5 per categoria, mescolate, tagliate a 30 — vedi
   newsTicker.js:_rebuildMessages): passano una alla volta e non si
   possono rileggere. Qui c'è lo stesso materiale ma completo, fermo e
   raggruppato per categoria, con il conteggio di quante notizie ci sono
   per ognuna.

   Zero logica duplicata e zero nuove chiamate di rete: i testi già
   tradotti arrivano da newsTicker.js:getNewsGroups(), che riusa i dati
   grezzi che il ticker ha comunque scaricato (le elezioni sono una
   chiamata per OGNI nazione — rifarle qui riaprirebbe il problema dei
   429 risolto col batching).

   i18n: dizionario LOCALE come per le barre menù (desktopMenuBar.js:
   MB_DICT) invece di aggiungere chiavi a shared/i18n.js — le etichette
   sono solo di questa vista, tenerle qui la lascia autonoma. I testi
   delle notizie sono invece già tradotti a monte (chiavi ticker_*).
   ══════════════════════════════════════════════════════════════ */

import '../styles/news.css';
import { getNewsGroups, ensureNewsData } from './newsTicker.js';
import { getLang } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';

const NV_DICT = {
  en: { masthead: 'The WarEra Times', tagline: 'World edition · Live from the front', breaking: 'BREAKING', refresh: 'Refresh', loading: 'Printing the edition…', empty: 'No news at the moment', emptyCat: 'Nothing in this category', updated: 'Updated at', stories: 'stories', searchPh: 'Search the edition — e.g. Italy, sworn…', results: 'results for', noMatch: 'No story matches', clear: 'Clear', battles: 'Ongoing battles', elections: 'Elections', wars: 'New wars', sworn: 'Sworn enemies', stats24: 'Last 24 hours', sinceVisit: 'Since your last visit' },
  it: { masthead: 'Il WarEra Times', tagline: 'Edizione mondiale · In diretta dal fronte', breaking: 'ULTIM\'ORA', refresh: 'Aggiorna', loading: 'Stampa dell\'edizione…', empty: 'Nessuna notizia al momento', emptyCat: 'Nulla in questa categoria', updated: 'Aggiornato alle', stories: 'notizie', searchPh: 'Cerca nell\'edizione — es. Italy, sworn…', results: 'risultati per', noMatch: 'Nessuna notizia corrisponde a', clear: 'Pulisci', battles: 'Battaglie in corso', elections: 'Elezioni', wars: 'Nuove guerre', sworn: 'Nemici giurati', stats24: 'Ultime 24 ore', sinceVisit: 'Dall\'ultima visita' },
  es: { masthead: 'El WarEra Times', tagline: 'Edición mundial · En directo desde el frente', breaking: 'ÚLTIMA HORA', refresh: 'Actualizar', loading: 'Imprimiendo la edición…', empty: 'No hay noticias por ahora', emptyCat: 'Nada en esta categoría', updated: 'Actualizado a las', stories: 'noticias', searchPh: 'Buscar en la edición — p. ej. Italy, sworn…', results: 'resultados para', noMatch: 'Ninguna noticia coincide con', clear: 'Limpiar', battles: 'Batallas en curso', elections: 'Elecciones', wars: 'Nuevas guerras', sworn: 'Enemigos jurados', stats24: 'Últimas 24 horas', sinceVisit: 'Desde tu última visita' },
  de: { masthead: 'Die WarEra Times', tagline: 'Weltausgabe · Live von der Front', breaking: 'EILMELDUNG', refresh: 'Aktualisieren', loading: 'Ausgabe wird gedruckt…', empty: 'Derzeit keine Nachrichten', emptyCat: 'Nichts in dieser Kategorie', updated: 'Aktualisiert um', stories: 'Meldungen', searchPh: 'Ausgabe durchsuchen — z. B. Italy, sworn…', results: 'Treffer für', noMatch: 'Keine Meldung passt zu', clear: 'Löschen', battles: 'Laufende Schlachten', elections: 'Wahlen', wars: 'Neue Kriege', sworn: 'Erzfeinde', stats24: 'Letzte 24 Stunden', sinceVisit: 'Seit deinem letzten Besuch' },
  fr: { masthead: 'Le WarEra Times', tagline: 'Édition mondiale · En direct du front', breaking: 'DERNIÈRE HEURE', refresh: 'Actualiser', loading: 'Impression de l\'édition…', empty: 'Aucune actualité pour le moment', emptyCat: 'Rien dans cette catégorie', updated: 'Mis à jour à', stories: 'actualités', searchPh: 'Rechercher dans l\'édition — ex. Italy, sworn…', results: 'résultats pour', noMatch: 'Aucune actualité ne correspond à', clear: 'Effacer', battles: 'Batailles en cours', elections: 'Élections', wars: 'Nouvelles guerres', sworn: 'Ennemis jurés', stats24: 'Dernières 24 heures', sinceVisit: 'Depuis votre dernière visite' },
  nl: { masthead: 'De WarEra Times', tagline: 'Wereldeditie · Live vanaf het front', breaking: 'LAATSTE NIEUWS', refresh: 'Vernieuwen', loading: 'Editie wordt gedrukt…', empty: 'Momenteel geen nieuws', emptyCat: 'Niets in deze categorie', updated: 'Bijgewerkt om', stories: 'berichten', searchPh: 'Zoek in de editie — bv. Italy, sworn…', results: 'resultaten voor', noMatch: 'Geen bericht komt overeen met', clear: 'Wissen', battles: 'Lopende veldslagen', elections: 'Verkiezingen', wars: 'Nieuwe oorlogen', sworn: 'Aartsvijanden', stats24: 'Laatste 24 uur', sinceVisit: 'Sinds je laatste bezoek' },
  sv: { masthead: 'The WarEra Times', tagline: 'Världsupplaga · Direkt från fronten', breaking: 'SENASTE NYTT', refresh: 'Uppdatera', loading: 'Upplagan trycks…', empty: 'Inga nyheter just nu', emptyCat: 'Inget i den här kategorin', updated: 'Uppdaterad kl.', stories: 'nyheter', searchPh: 'Sök i upplagan — t.ex. Italy, sworn…', results: 'träffar för', noMatch: 'Ingen nyhet matchar', clear: 'Rensa', battles: 'Pågående strider', elections: 'Val', wars: 'Nya krig', sworn: 'Svurna fiender', stats24: 'Senaste 24 timmarna', sinceVisit: 'Sedan ditt senaste besök' },
  pt: { masthead: 'O WarEra Times', tagline: 'Edição mundial · Em direto da frente', breaking: 'ÚLTIMA HORA', refresh: 'Atualizar', loading: 'A imprimir a edição…', empty: 'Sem notícias de momento', emptyCat: 'Nada nesta categoria', updated: 'Atualizado às', stories: 'notícias', searchPh: 'Procurar na edição — ex. Italy, sworn…', results: 'resultados para', noMatch: 'Nenhuma notícia corresponde a', clear: 'Limpar', battles: 'Batalhas em curso', elections: 'Eleições', wars: 'Novas guerras', sworn: 'Inimigos jurados', stats24: 'Últimas 24 horas', sinceVisit: 'Desde a sua última visita' },
  ar: { masthead: 'ووركيرا تايمز', tagline: 'الطبعة العالمية · مباشرة من الجبهة', breaking: 'عاجل', refresh: 'تحديث', loading: 'جارٍ طباعة العدد…', empty: 'لا توجد أخبار حالياً', emptyCat: 'لا شيء في هذه الفئة', updated: 'آخر تحديث', stories: 'أخبار', searchPh: '…ابحث في العدد — مثل Italy أو sworn', results: 'نتائج لـ', noMatch: 'لا يوجد خبر مطابق لـ', clear: 'مسح', battles: 'معارك جارية', elections: 'الانتخابات', wars: 'حروب جديدة', sworn: 'أعداء محلفون', stats24: 'آخر 24 ساعة', sinceVisit: 'منذ زيارتك الأخيرة' },
};
function nvT(key) {
  return NV_DICT[getLang()]?.[key] ?? NV_DICT.en[key] ?? key;
}

let rootEl = null;
let loading = false;
// Ultimi gruppi disegnati e testo cercato: la ricerca filtra SOLO il corpo
// (vedi renderBody), senza rifare né la testata né il ticker — che
// altrimenti si ricostruirebbero ad ogni tasto premuto, riavviando
// l'animazione del nastro e facendo perdere il fuoco al campo.
let lastGroups = null;
let query = '';

// Confronto senza accenti né maiuscole: cercare "italy" o "ITALY" o
// "Türkiye" scrivendo "turkiye" deve funzionare comunque.
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Filtro: tutti i termini scritti devono comparire (AND), ciascuno nel
// testo della notizia OPPURE nel nome/chiave della categoria. La chiave
// serve perché è in inglese e stabile: l'utente ha chiesto esplicitamente
// che scrivere "sworn" trovi i nemici giurati anche con l'interfaccia in
// italiano, dove la notizia dice "nemico giurato".
function filterGroups(groups, q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;
  return groups.map(g => {
    const cat = `${norm(g.key)} ${norm(nvT(g.key))}`;
    return {
      ...g,
      messages: g.messages.filter(m => {
        const hay = `${norm(m)} ${cat}`;
        return terms.every(term => hay.includes(term));
      }),
    };
  });
}

export async function initNewsView(container) {
  rootEl = container;
  bindLangChange();
  render({ pending: true });
  // Alla PRIMA apertura i dati potrebbero non essere ancora arrivati (il
  // ticker fa il suo primo giro poco dopo il boot): ensureNewsData li
  // aspetta invece di mostrare una pagina vuota, e non tocca la rete se
  // ci sono già.
  await load(false);
  trackEvent('news-view-open');
}

// BUG FIX (segnalato dall'utente): cambiando lingua l'intestazione si
// traduceva subito ma le NOTIZIE restavano nella lingua precedente fino a
// un ricaricamento della pagina. Il ticker sulla mappa questo caso lo
// gestiva già (newsTicker.js si riformatta su 'wareraplus:langchange'),
// questa vista no.
//
// Basta ridisegnare: getNewsGroups() riformatta i messaggi dai dati grezzi
// già scaricati chiamando t() con la lingua nuova — nessuna chiamata di
// rete (rifare le elezioni, una per nazione, ad ogni cambio lingua
// riaprirebbe il problema dei 429 risolto col batching). Il testo cercato
// resta quello che è: è roba scritta dall'utente, non da tradurre.
let langBound = false;
function bindLangChange() {
  if (langBound) return; // una sola volta: initNewsView gira ad ogni apertura
  langBound = true;
  window.addEventListener('wareraplus:langchange', () => {
    if (!rootEl || !lastGroups) return;
    lastGroups = getNewsGroups() || lastGroups;
    render({ groups: lastGroups });
  });
}

async function load(force) {
  if (loading) return;
  loading = true;
  try {
    lastGroups = await ensureNewsData({ force });
    render({ groups: lastGroups });
  } catch (err) {
    console.warn('WarEra+ newsView: caricamento fallito', err);
    lastGroups = getNewsGroups();
    render({ groups: lastGroups });
  } finally {
    loading = false;
  }
}

function render({ groups, pending } = {}) {
  if (!rootEl) return;

  if (pending) {
    rootEl.innerHTML = `<div class="wp-news-empty">${escapeHtml(nvT('loading'))}</div>`;
    return;
  }

  const locale = document.documentElement.lang || undefined;
  const now = new Date();
  const total = (groups || []).reduce((sum, g) => sum + g.messages.length, 0);
  const time = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Testata in stile quotidiano: nome del giornale, filetti sopra/sotto e
  // riga di colophon con data, ora di chiusura dell'edizione e numero di
  // pezzi — le stesse informazioni di prima, vestite da prima pagina.
  const masthead = `
    <header class="wp-news-masthead">
      <div class="wp-news-mast-rule"></div>
      <h1 class="wp-news-mast-title">${escapeHtml(nvT('masthead'))}</h1>
      <div class="wp-news-mast-rule wp-news-mast-rule-thin"></div>
      <div class="wp-news-colophon">
        <span>${escapeHtml(date)}</span>
        <span class="wp-news-colophon-sep">✦</span>
        <span>${escapeHtml(nvT('tagline'))}</span>
        <span class="wp-news-colophon-sep">✦</span>
        <span>${total} ${escapeHtml(nvT('stories'))}</span>
        <span class="wp-news-colophon-sep">✦</span>
        <span>${escapeHtml(nvT('updated'))} ${escapeHtml(time)}</span>
        <button type="button" class="wp-news-refresh" id="wp-news-refresh">↻ ${escapeHtml(nvT('refresh'))}</button>
      </div>
    </header>`;

  if (!groups || !total) {
    rootEl.innerHTML = `<div class="wp-news-paper">${masthead}<div class="wp-news-empty">${escapeHtml(nvT('empty'))}</div></div>`;
    bindRefresh();
    return;
  }

  // Campo di ricerca (richiesta esplicita dell'utente): filtra l'edizione
  // già scaricata, nessuna chiamata di rete. `search` con type="search"
  // per avere la crocetta nativa di svuotamento sui browser che la danno.
  const searchBar = `
    <div class="wp-news-search">
      <span class="wp-news-search-icon" aria-hidden="true">🔍</span>
      <input type="search" id="wp-news-search-input" class="wp-news-search-input"
             placeholder="${escapeHtml(nvT('searchPh'))}" aria-label="${escapeHtml(nvT('searchPh'))}"
             value="${escapeHtml(query)}" autocomplete="off" />
      <span class="wp-news-search-count" id="wp-news-search-count"></span>
    </div>`;

  // Fascia ULTIM'ORA in stile telegiornale (richiesta esplicita: "che
  // rimanesse il ticker che scorre"). Il nastro è duplicato due volte e
  // l'animazione CSS trasla di -50%: quando la prima copia esce a sinistra
  // la seconda è esattamente al suo posto, quindi il ciclo si richiude
  // senza stacco (stesso trucco del ticker in cima alla mappa, qui però
  // basta il CSS: nessun rAF, nessun costo quando la vista è chiusa).
  //
  // Il nastro mostra un CAMPIONE (TICKER_MAX), non tutta l'edizione: ora
  // che le notizie coprono tutti i paesi possono essere centinaia, e un
  // giro completo diventerebbe lungo decine di minuti — nessuno lo
  // vedrebbe mai per intero, in compenso il DOM peserebbe il doppio di
  // quei nodi. L'archivio completo è sotto, nelle rubriche, con la
  // ricerca per trovarci dentro. Il ticker NON è filtrato dalla ricerca:
  // è la striscia "in diretta" del telegiornale e ricrearla ad ogni tasto
  // riavvierebbe l'animazione.
  const allMessages = groups.flatMap(g => g.messages.map(m => ({ icon: g.icon, text: m })));
  const tickerMessages = allMessages.slice(0, TICKER_MAX);
  const strip = tickerMessages
    .map(m => `<span class="wp-news-tick-item"><span class="wp-news-tick-icon">${m.icon}</span>${escapeHtml(m.text)}</span>`)
    .join('');
  const tickerSeconds = Math.max(30, tickerMessages.length * 5);
  const ticker = `
    <div class="wp-news-breaking">
      <div class="wp-news-breaking-label">${escapeHtml(nvT('breaking'))}</div>
      <div class="wp-news-breaking-viewport">
        <div class="wp-news-breaking-track" style="animation-duration:${tickerSeconds}s">${strip}${strip}</div>
      </div>
    </div>`;

  rootEl.innerHTML = `
    <div class="wp-news-paper">
      ${masthead}
      ${searchBar}
      ${ticker}
      <div class="wp-news-body" id="wp-news-body"></div>
    </div>`;
  bindRefresh();
  bindSearch();
  renderBody();
}

// Numero massimo di notizie nel nastro scorrevole — vedi il commento
// sopra: campione, non archivio.
const TICKER_MAX = 60;

// Corpo dell'edizione (apertura + rubriche), l'unica parte che la ricerca
// ridisegna. Testata, campo di ricerca e nastro restano dov'erano: così
// l'animazione del ticker non riparte e il campo non perde il fuoco
// mentre si scrive.
function renderBody() {
  const body = rootEl?.querySelector('#wp-news-body');
  if (!body || !lastGroups) return;

  const groups = filterGroups(lastGroups, query);
  const shown = groups.reduce((sum, g) => sum + g.messages.length, 0);

  const countEl = rootEl.querySelector('#wp-news-search-count');
  if (countEl) countEl.textContent = query.trim() ? `${shown} ${nvT('results')} “${query.trim()}”` : '';

  if (!shown) {
    body.innerHTML = `<div class="wp-news-empty">${escapeHtml(nvT('noMatch'))} “${escapeHtml(query.trim())}”</div>`;
    return;
  }

  const first = groups.find(g => g.messages.length);
  const lead = first
    ? `<article class="wp-news-lead">
         <div class="wp-news-lead-kicker">${first.icon} ${escapeHtml(nvT(first.key))}</div>
         <h2 class="wp-news-lead-title">${escapeHtml(first.messages[0])}</h2>
       </article>`
    : '';

  // Con la ricerca attiva le categorie senza risultati sparirebbero
  // lasciando titoli a zero: si mostrano solo quelle che hanno qualcosa.
  // Senza ricerca restano tutte (anche vuote, con la riga "nulla qui"),
  // così l'indice della pagina non balla fra un aggiornamento e l'altro.
  const filtering = !!query.trim();
  const sections = groups
    .filter(g => !filtering || g.messages.length)
    .map(g => `
    <section class="wp-news-rubric">
      <h3 class="wp-news-rubric-title">
        <span class="wp-news-rubric-icon">${g.icon}</span>
        ${escapeHtml(nvT(g.key))}
        <span class="wp-news-count">${g.messages.length}</span>
      </h3>
      ${g.messages.length
        ? `<ul class="wp-news-list">${g.messages.map(m => `<li class="wp-news-item">${escapeHtml(m)}</li>`).join('')}</ul>`
        : `<div class="wp-news-group-empty">${escapeHtml(nvT('emptyCat'))}</div>`}
    </section>`).join('');

  body.innerHTML = `${lead}<div class="wp-news-columns">${sections}</div>`;
}

function bindSearch() {
  const input = rootEl?.querySelector('#wp-news-search-input');
  if (!input) return;
  input.addEventListener('input', () => { query = input.value; renderBody(); });
  // Esc svuota il campo senza doverlo selezionare tutto a mano.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation(); // altrimenti l'Esc chiuderebbe l'intero overlay
      input.value = ''; query = ''; renderBody();
    }
  });
}

function bindRefresh() {
  const btn = rootEl?.querySelector('#wp-news-refresh');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    trackEvent('news-view-refresh');
    load(true).finally(() => { /* render() ricrea il bottone, niente da riabilitare */ });
  });
}

// I messaggi contengono nomi di nazioni/alleanze scelti dai giocatori:
// vanno trattati come testo, mai come markup.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
