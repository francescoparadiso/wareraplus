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
  en: { masthead: 'The WarEra Times', tagline: 'World edition · Live from the front', breaking: 'BREAKING', refresh: 'Refresh', loading: 'Printing the edition…', empty: 'No news at the moment', emptyCat: 'Nothing in this category', updated: 'Updated at', stories: 'stories', battles: 'Ongoing battles', elections: 'Elections', wars: 'New wars', sworn: 'Sworn enemies', stats24: 'Last 24 hours', sinceVisit: 'Since your last visit' },
  it: { masthead: 'Il WarEra Times', tagline: 'Edizione mondiale · In diretta dal fronte', breaking: 'ULTIM\'ORA', refresh: 'Aggiorna', loading: 'Stampa dell\'edizione…', empty: 'Nessuna notizia al momento', emptyCat: 'Nulla in questa categoria', updated: 'Aggiornato alle', stories: 'notizie', battles: 'Battaglie in corso', elections: 'Elezioni', wars: 'Nuove guerre', sworn: 'Nemici giurati', stats24: 'Ultime 24 ore', sinceVisit: 'Dall\'ultima visita' },
  es: { masthead: 'El WarEra Times', tagline: 'Edición mundial · En directo desde el frente', breaking: 'ÚLTIMA HORA', refresh: 'Actualizar', loading: 'Imprimiendo la edición…', empty: 'No hay noticias por ahora', emptyCat: 'Nada en esta categoría', updated: 'Actualizado a las', stories: 'noticias', battles: 'Batallas en curso', elections: 'Elecciones', wars: 'Nuevas guerras', sworn: 'Enemigos jurados', stats24: 'Últimas 24 horas', sinceVisit: 'Desde tu última visita' },
  de: { masthead: 'Die WarEra Times', tagline: 'Weltausgabe · Live von der Front', breaking: 'EILMELDUNG', refresh: 'Aktualisieren', loading: 'Ausgabe wird gedruckt…', empty: 'Derzeit keine Nachrichten', emptyCat: 'Nichts in dieser Kategorie', updated: 'Aktualisiert um', stories: 'Meldungen', battles: 'Laufende Schlachten', elections: 'Wahlen', wars: 'Neue Kriege', sworn: 'Erzfeinde', stats24: 'Letzte 24 Stunden', sinceVisit: 'Seit deinem letzten Besuch' },
  fr: { masthead: 'Le WarEra Times', tagline: 'Édition mondiale · En direct du front', breaking: 'DERNIÈRE HEURE', refresh: 'Actualiser', loading: 'Impression de l\'édition…', empty: 'Aucune actualité pour le moment', emptyCat: 'Rien dans cette catégorie', updated: 'Mis à jour à', stories: 'actualités', battles: 'Batailles en cours', elections: 'Élections', wars: 'Nouvelles guerres', sworn: 'Ennemis jurés', stats24: 'Dernières 24 heures', sinceVisit: 'Depuis votre dernière visite' },
  nl: { masthead: 'De WarEra Times', tagline: 'Wereldeditie · Live vanaf het front', breaking: 'LAATSTE NIEUWS', refresh: 'Vernieuwen', loading: 'Editie wordt gedrukt…', empty: 'Momenteel geen nieuws', emptyCat: 'Niets in deze categorie', updated: 'Bijgewerkt om', stories: 'berichten', battles: 'Lopende veldslagen', elections: 'Verkiezingen', wars: 'Nieuwe oorlogen', sworn: 'Aartsvijanden', stats24: 'Laatste 24 uur', sinceVisit: 'Sinds je laatste bezoek' },
  sv: { masthead: 'The WarEra Times', tagline: 'Världsupplaga · Direkt från fronten', breaking: 'SENASTE NYTT', refresh: 'Uppdatera', loading: 'Upplagan trycks…', empty: 'Inga nyheter just nu', emptyCat: 'Inget i den här kategorin', updated: 'Uppdaterad kl.', stories: 'nyheter', battles: 'Pågående strider', elections: 'Val', wars: 'Nya krig', sworn: 'Svurna fiender', stats24: 'Senaste 24 timmarna', sinceVisit: 'Sedan ditt senaste besök' },
  pt: { masthead: 'O WarEra Times', tagline: 'Edição mundial · Em direto da frente', breaking: 'ÚLTIMA HORA', refresh: 'Atualizar', loading: 'A imprimir a edição…', empty: 'Sem notícias de momento', emptyCat: 'Nada nesta categoria', updated: 'Atualizado às', stories: 'notícias', battles: 'Batalhas em curso', elections: 'Eleições', wars: 'Novas guerras', sworn: 'Inimigos jurados', stats24: 'Últimas 24 horas', sinceVisit: 'Desde a sua última visita' },
  ar: { masthead: 'ووركيرا تايمز', tagline: 'الطبعة العالمية · مباشرة من الجبهة', breaking: 'عاجل', refresh: 'تحديث', loading: 'جارٍ طباعة العدد…', empty: 'لا توجد أخبار حالياً', emptyCat: 'لا شيء في هذه الفئة', updated: 'آخر تحديث', stories: 'أخبار', battles: 'معارك جارية', elections: 'الانتخابات', wars: 'حروب جديدة', sworn: 'أعداء محلفون', stats24: 'آخر 24 ساعة', sinceVisit: 'منذ زيارتك الأخيرة' },
};
function nvT(key) {
  return NV_DICT[getLang()]?.[key] ?? NV_DICT.en[key] ?? key;
}

let rootEl = null;
let loading = false;

export async function initNewsView(container) {
  rootEl = container;
  render({ pending: true });
  // Alla PRIMA apertura i dati potrebbero non essere ancora arrivati (il
  // ticker fa il suo primo giro poco dopo il boot): ensureNewsData li
  // aspetta invece di mostrare una pagina vuota, e non tocca la rete se
  // ci sono già.
  await load(false);
  trackEvent('news-view-open');
}

async function load(force) {
  if (loading) return;
  loading = true;
  try {
    const groups = await ensureNewsData({ force });
    render({ groups });
  } catch (err) {
    console.warn('WarEra+ newsView: caricamento fallito', err);
    render({ groups: getNewsGroups() });
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

  // Fascia ULTIM'ORA in stile telegiornale (richiesta esplicita: "che
  // rimanesse il ticker che scorre"). Scorre TUTTE le notizie, non il
  // campione ridotto del ticker sulla mappa. Il nastro è duplicato due
  // volte e l'animazione CSS trasla di -50%: quando la prima copia esce a
  // sinistra la seconda è esattamente al suo posto, quindi il ciclo si
  // richiude senza stacco (stesso trucco del ticker in cima alla mappa,
  // qui però basta il CSS: nessun rAF, nessun costo quando la vista è
  // chiusa). Durata proporzionale al numero di notizie, così la velocità
  // di lettura resta la stessa con 10 o con 100 pezzi.
  const allMessages = groups.flatMap(g => g.messages.map(m => ({ icon: g.icon, text: m })));
  const strip = allMessages
    .map(m => `<span class="wp-news-tick-item"><span class="wp-news-tick-icon">${m.icon}</span>${escapeHtml(m.text)}</span>`)
    .join('');
  const tickerSeconds = Math.max(30, allMessages.length * 5);
  const ticker = `
    <div class="wp-news-breaking">
      <div class="wp-news-breaking-label">${escapeHtml(nvT('breaking'))}</div>
      <div class="wp-news-breaking-viewport">
        <div class="wp-news-breaking-track" style="animation-duration:${tickerSeconds}s">${strip}${strip}</div>
      </div>
    </div>`;

  // La prima notizia disponibile fa da apertura: titolo grande a piena
  // larghezza, come il pezzo di spalla di una prima pagina.
  const lead = allMessages[0]
    ? `<article class="wp-news-lead">
         <div class="wp-news-lead-kicker">${allMessages[0].icon} ${escapeHtml(nvT(groups.find(g => g.messages.length)?.key || 'battles'))}</div>
         <h2 class="wp-news-lead-title">${escapeHtml(allMessages[0].text)}</h2>
       </article>`
    : '';

  // Categorie vuote mostrate comunque (con la loro riga "nulla qui"): la
  // lista di sezioni resta stabile fra un aggiornamento e l'altro, invece
  // di veder sparire e riapparire blocchi interi.
  const sections = groups.map(g => `
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

  rootEl.innerHTML = `
    <div class="wp-news-paper">
      ${masthead}
      ${ticker}
      ${lead}
      <div class="wp-news-columns">${sections}</div>
    </div>`;
  bindRefresh();
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
