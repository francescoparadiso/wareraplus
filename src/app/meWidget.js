/* ══════════════════════════════════════════════════════════════
   WarEra+ — Blocco "Il mio personaggio" (Preferiti)
   ------------------------------------------------------------------
   In cima ai Preferiti, desktop e mobile: chi ha impostato il proprio
   personaggio trova subito tre righe — lui, la sua unità, la sua
   nazione — che aprono la scheda giusta; chi non l'ha fatto trova un
   campo di ricerca per collegarlo. Dallo stesso personaggio il resto del
   tool si orienta da sé: Tornei apre la squadra della tua unità,
   Giocatori parte da te, Unità segna la tua con una stella.

   Un solo modulo per le due barre perché la logica è identica e cambia
   solo il vestito: le classi delle righe arrivano da fuori (`cls`), così
   il blocco prende gli stili dei Preferiti accanto senza copiarli.
   `go(tipo, id)` è l'unica cosa che le barre devono dare: aprire un
   giocatore, un'unità o una nazione ognuna lo fa col suo modo di
   chiudere il drawer o i menù.

   Preferenza locale (vedi shared/me.js), non un login: serve a
   personalizzare, non a dimostrare chi sei.
   ══════════════════════════════════════════════════════════════ */

import '../styles/me.css';
import { state } from '../diplomacy/state.js';
import { getLang } from '../shared/i18n.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { getCachedMu } from '../mu/api.js';
import { getMuPinMeta } from './pins.js';
import { getMeId, getMeMeta, setMe, clearMe, loadMeProfile, ME_EVENT } from '../shared/me.js';

const DICT = {
  en: { me: 'My character', hint: 'Link your character: your unit, nation and tournament team are then followed everywhere.', ph: 'Your character name…', go: 'Link', searching: 'Searching…', none: 'No character found.', unlink: 'Unlink', unit: 'Unit', error: 'Search failed. Try again.' },
  it: { me: 'Il mio personaggio', hint: 'Collega il tuo personaggio: unità, nazione e squadra del torneo vengono seguite ovunque.', ph: 'Nome del tuo personaggio…', go: 'Collega', searching: 'Cerco…', none: 'Nessun personaggio trovato.', unlink: 'Scollega', unit: 'Unità', error: 'Ricerca non riuscita. Riprova.' },
  es: { me: 'Mi personaje', hint: 'Vincula tu personaje: tu unidad, nación y equipo del torneo se siguen en todas partes.', ph: 'Nombre de tu personaje…', go: 'Vincular', searching: 'Buscando…', none: 'No se encontró ningún personaje.', unlink: 'Desvincular', unit: 'Unidad', error: 'La búsqueda falló. Inténtalo de nuevo.' },
  de: { me: 'Mein Charakter', hint: 'Verknüpfe deinen Charakter: Einheit, Nation und Turnierteam werden überall verfolgt.', ph: 'Name deines Charakters…', go: 'Verknüpfen', searching: 'Suche…', none: 'Kein Charakter gefunden.', unlink: 'Trennen', unit: 'Einheit', error: 'Suche fehlgeschlagen. Versuch es erneut.' },
  fr: { me: 'Mon personnage', hint: 'Lie ton personnage : ton unité, ta nation et ton équipe de tournoi sont suivies partout.', ph: 'Nom de ton personnage…', go: 'Lier', searching: 'Recherche…', none: 'Aucun personnage trouvé.', unlink: 'Délier', unit: 'Unité', error: 'Recherche échouée. Réessaie.' },
  nl: { me: 'Mijn personage', hint: 'Koppel je personage: je eenheid, natie en toernooiteam worden overal gevolgd.', ph: 'Naam van je personage…', go: 'Koppelen', searching: 'Zoeken…', none: 'Geen personage gevonden.', unlink: 'Ontkoppelen', unit: 'Eenheid', error: 'Zoeken mislukt. Probeer opnieuw.' },
  sv: { me: 'Min karaktär', hint: 'Koppla din karaktär: din enhet, nation och turneringslag följs överallt.', ph: 'Din karaktärs namn…', go: 'Koppla', searching: 'Söker…', none: 'Ingen karaktär hittades.', unlink: 'Koppla bort', unit: 'Enhet', error: 'Sökningen misslyckades. Försök igen.' },
  pt: { me: 'A minha personagem', hint: 'Liga a tua personagem: a tua unidade, nação e equipa do torneio são seguidas em todo o lado.', ph: 'Nome da tua personagem…', go: 'Ligar', searching: 'A procurar…', none: 'Nenhuma personagem encontrada.', unlink: 'Desligar', unit: 'Unidade', error: 'A pesquisa falhou. Tenta de novo.' },
  ar: { me: 'شخصيتي', hint: 'اربط شخصيتك: تُتابَع وحدتك ودولتك وفريقك في البطولة في كل مكان.', ph: 'اسم شخصيتك…', go: 'ربط', searching: 'جارٍ البحث…', none: 'لم يُعثر على شخصية.', unlink: 'فك الربط', unit: 'الوحدة', error: 'فشل البحث. حاول مرة أخرى.' },
};
const t = (k) => DICT[getLang()]?.[k] ?? DICT.en[k] ?? k;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {object} o
 * @param {(tipo: 'player'|'mu'|'nation', id: string) => void} o.go
 * @param {{group: string, row: string, img: string, logo: string, name: string}} o.cls  classi della barra
 * @returns {HTMLElement} contenitore che si ridisegna da solo
 */
export function buildMeBlock({ go, cls }) {
  const root = el('div', 'wp-me');

  const riga = (src, logo, nome, onClick, extra) => {
    const r = el('div', `${cls.row} wp-me-row`);
    const img = el('img', `${cls.img}${logo ? ` ${cls.logo} wp-me-logo` : ''}`);
    img.alt = ''; img.loading = 'lazy';
    if (src) img.src = src; else img.style.visibility = 'hidden';
    img.onerror = () => { img.style.visibility = 'hidden'; };
    r.appendChild(img);
    r.appendChild(el('span', cls.name, nome));
    if (extra) r.appendChild(extra);
    r.addEventListener('click', onClick);
    return r;
  };

  function disegna() {
    root.textContent = '';
    root.appendChild(el('div', cls.group, t('me')));
    const id = getMeId();
    if (!id) { disegnaForm(); return; }

    const meta = getMeMeta();
    // I metadati possono mancare (impostato altrove senza profilo): si
    // disegna subito la riga col poco che c'è e si completa quando arrivano.
    const x = el('button', 'wp-me-x', '×');
    x.type = 'button'; x.title = t('unlink'); x.setAttribute('aria-label', t('unlink'));
    x.addEventListener('click', (e) => { e.stopPropagation(); clearMe(); });
    root.appendChild(riga(meta?.avatar, true, meta?.name || '…', () => go('player', id), x));

    if (meta?.muId) {
      const m = getCachedMu(meta.muId) || getMuPinMeta(meta.muId);
      root.appendChild(riga(m?.avatarUrl, true, meta.muName || m?.name || t('unit'), () => go('mu', meta.muId)));
    }
    if (meta?.countryId) {
      const n = state.nazioniGlobal?.find((c) => c._id === meta.countryId);
      if (n) {
        const flag = getFlagUrl(getNationCode(meta.countryId, n));
        root.appendChild(riga(flag, false, n.name, () => go('nation', meta.countryId)));
      }
    }
    loadMeProfile();
  }

  function disegnaForm() {
    root.appendChild(el('p', 'wp-me-hint', t('hint')));
    const form = el('form', 'wp-me-form');
    const input = el('input', 'wp-me-input');
    input.type = 'search'; input.placeholder = t('ph'); input.autocomplete = 'off'; input.maxLength = 40;
    const btn = el('button', 'wp-me-go', t('go'));
    btn.type = 'submit';
    form.appendChild(input); form.appendChild(btn);
    const esiti = el('div', 'wp-me-esiti');
    root.appendChild(form); root.appendChild(esiti);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q.length < 2) return;
      esiti.textContent = t('searching');
      btn.disabled = true;
      try {
        const { searchPlayers } = await import('../players/api.js');
        const list = await searchPlayers(q);
        esiti.textContent = '';
        if (!list.length) { esiti.textContent = t('none'); return; }
        for (const { id, lite } of list) {
          const naz = state.nazioniGlobal?.find((c) => c._id === lite.country);
          esiti.appendChild(riga(lite.avatarUrl, true,
            naz ? `${lite.username} · ${naz.name}` : lite.username,
            () => { setMe(id, lite); loadMeProfile(); }));
        }
      } catch (err) {
        console.warn('WarEra+ mio personaggio: ricerca fallita:', err.message);
        esiti.textContent = t('error');
      } finally { btn.disabled = false; }
    });
  }

  // Si ridisegna da solo: chi imposta il personaggio altrove (Giocatori,
  // area riservata) lo trova qui senza riaprire il menù.
  window.addEventListener(ME_EVENT, disegna);
  window.addEventListener('wareraplus:langchange', disegna);
  disegna();
  return root;
}
