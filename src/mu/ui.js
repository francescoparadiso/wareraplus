/* ══════════════════════════════════════════════════════════════
   WarEra+ — Esplora Unità Militari: pezzi di UI condivisi
   ------------------------------------------------------------------
   Quello che elenco, dettaglio e classifiche disegnano allo stesso modo:
   bandiera della nazione, avatar dell'unità, badge del tier, formattazione
   dei numeri. Tenuto qui per non averne tre versioni leggermente diverse.

   Le bandiere si ricavano dai dati che Diplomacy ha GIÀ in memoria
   (state.nationMap / state.labelsData), non da una fetch: stessa fonte e
   stesso fallback del codice bandiere delle barre menù
   (desktopMenuBar.js: nationFlagCode).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

const FLAG_BASE = 'https://media.warera.io/images/flags';

/** Ordine dei tier come li usa il gioco, dal più basso al più alto — serve
 *  solo per dare a ognuno un colore nel CSS (.wp-mu-tier-<tier>). */
export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];

export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Nome nazione da countryId, con fallback al codice o a un trattino. */
export function countryName(countryId) {
  const n = state.nationMap?.get(countryId);
  return n?.name || n?.code || '—';
}

/** Codice bandiera (minuscolo) da countryId. Stessa doppia fonte di
 *  desktopMenuBar.js: prima il campo `code` della nazione, poi le label
 *  della mappa (che per alcune nazioni sono l'unico posto dove c'è). */
export function countryFlagCode(countryId) {
  const n = state.nationMap?.get(countryId);
  if (n?.code) return n.code.toLowerCase();
  const label = state.labelsData?.find(l => l.properties?.countryId === countryId);
  return (label?.properties?.countryCode || '').toLowerCase();
}

export function flagImg(countryId, cls = 'wp-mu-flag') {
  const code = countryFlagCode(countryId);
  if (!code) return `<span class="${cls}"></span>`;
  return `<img class="${cls}" src="${FLAG_BASE}/${code}.svg?v=16" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

/** Avatar dell'unità (o di un membro). Le MU senza avatar caricato — una
 *  settantina su ~1400 — mostrano l'iniziale del nome invece di un buco
 *  nella griglia.
 *
 *  L'iniziale sta SEMPRE nel markup, con l'immagine sovrapposta sopra
 *  (vedi .wp-mu-avatar img in mu.css): così se l'URL è morto basta che
 *  l'onerror tolga l'immagine e sotto c'è già il segnaposto — niente
 *  markup ricostruito dentro un attributo, che con nomi scelti dai
 *  giocatori (apostrofi, virgolette) sarebbe una via d'uscita dall'HTML. */
export function avatarImg(url, name, cls = 'wp-mu-avatar') {
  const ph = `<span class="wp-mu-avatar-ph">${escapeHtml(initial(name))}</span>`;
  const img = url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="${cls}">${ph}${img}</span>`;
}

function initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

/** Numeri compatti: 186.202.801 diventa "186,2M". I danni di una MU di
 *  vertice sono a nove cifre e in una card non ci stanno per intero. */
export function fmtCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const locale = document.documentElement.lang || undefined;
  if (abs >= 1e9) return `${(v / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })}G`;
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
  if (abs >= 1e4) return `${(v / 1e3).toLocaleString(locale, { maximumFractionDigits: 0 })}k`;
  return v.toLocaleString(locale, { maximumFractionDigits: 2 });
}

/** Numero per esteso (schede di dettaglio, dove lo spazio c'è). */
export function fmtFull(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: 2 });
}

export function fmtDate(iso) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  return new Date(ts).toLocaleDateString(document.documentElement.lang || undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Pastiglia con la POSIZIONE, colorata secondo il tier. Per i posti dove
 *  la posizione non è già scritta altrove (card dell'elenco, schede). */
export function tierBadge(ranking) {
  if (!ranking) return '';
  return `<span class="wp-mu-tier wp-mu-tier-${tierOf(ranking)}">#${ranking.rank}</span>`;
}

/** Pastiglia col NOME del tier. Usata in classifica, dove la posizione è
 *  già la prima colonna della riga e ripeterla nel badge sarebbe lo stesso
 *  numero due volte. I nomi dei tier restano in inglese: sono i termini del
 *  gioco, come i nomi delle nazioni. */
export function tierLabel(ranking) {
  if (!ranking) return '';
  const tier = tierOf(ranking);
  return `<span class="wp-mu-tier wp-mu-tier-${tier}">${tier}</span>`;
}

export function tierOf(ranking) {
  return ranking && TIERS.includes(ranking.tier) ? ranking.tier : null;
}

/** Nazionalità prevalente fra i MEMBRI, dalla composizione calcolata dal
 *  server (vedi warera-cache-server.js: muComposition). Una MU è registrata
 *  sotto una nazione, ma se i suoi membri sono in maggioranza di un'altra è
 *  di fatto di quell'altra — è questo che l'interfaccia segnala.
 *
 *  `share` è sulla quota dei membri di cui si CONOSCE la nazione (`known`),
 *  non sul totale: finché il server sta ancora riempiendo la mappa
 *  utente→nazione, la percentuale resta corretta su ciò che sa, invece di
 *  sembrare bassa perché il resto manca. Ritorna null se il dato non c'è
 *  (server di cache non raggiunto: la directory arriva senza composizione). */
export function dominantCountry(mu) {
  const c = mu?.composition;
  if (!c || !c.known || !c.top?.length) return null;
  const [first] = c.top;
  return {
    country: first.country,
    n: first.n,
    known: c.known,
    total: c.total,
    share: first.n / c.known,
    foreign: first.country !== mu.country,
  };
}
