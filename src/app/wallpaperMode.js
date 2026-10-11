/* ══════════════════════════════════════════════════════════════
   WarEra+ — Modalità sfondo (Wallpaper Engine)
   ------------------------------------------------------------------
   PERCHE' ESISTE
   WarEra+ si pubblica anche come sfondo animato di Wallpaper Engine.
   Lo sfondo NON contiene una copia del tool: è un involucro (cartella
   wallpaper/ in radice) che porta la pagina dello sfondo sul sito live
   con `?wallpaper=1`. Così ogni deploy aggiorna anche lo sfondo, e il
   sito gira sul suo origin vero (CORS, cache, service worker come sempre).

   ⚠️ NIENTE IFRAME, e non per scelta: nel browser di Wallpaper Engine
   (CEF 146, provato il 2026-10-12) QUALUNQUE iframe di un altro sito va
   in crash appena arriva la risposta — anche example.com. L'involucro
   quindi naviga la pagina intera verso il sito (location.replace), e da
   lì è il sito stesso a ricevere le proprietà da Wallpaper Engine.

   ⚠️ E NIENTE <select> VISIBILI: lo stesso browser va in crash su un
   <select> nativo dentro un antenato posizionato (fixed/absolute). La
   regola che li spegne sta in linea in testa a index.html, perché deve
   valere prima del primo layout.

   COSA CAMBIA CON ?wallpaper=1
   - via contatori e analytics (main.js, analytics.js): uno sfondo resta
     acceso tutto il giorno su ogni desktop e si ricarica a ogni avvio;
   - via la barra menù, i crediti in basso e tutto quello che vuole la
     tastiera: Wallpaper Engine passa i clic del mouse ma NON i tasti. La
     barra si può riaccendere dalle impostazioni (i menù funzionano col
     mouse, la ricerca no);
   - i riepiloghi delle viste restano dietro la linguetta "Vedi dettagli"
     invece di aprire il pannello (countryPanel.js: keepOverviewClosed);
   - una fascia spiega queste cose al primo avvio, e una "i" in basso a
     destra la riapre;
   - le impostazioni di Wallpaper Engine arrivano qui (sotto).

   COME ARRIVANO LE IMPOSTAZIONI
   - all'avvio, dall'involucro, come parametri dell'URL (vista, tema,
     lingua…), così la prima schermata è già quella giusta;
   - la CHIAVE API nel FRAMMENTO (`#k=…`): il frammento non parte mai
     verso un server e non finisce nei log, e qui lo si cancella appena
     letto (history.replaceState). Poi resta in memoria
     (shared/trpcProxy.js);
   - dopo, direttamente da Wallpaper Engine: questa pagina definisce
     window.wallpaperPropertyListener come farebbe uno sfondo locale.
     Se Wallpaper Engine richiama la pagina corrente (e non solo quella
     dell'involucro), cambiare una proprietà non ricarica la mappa.

   PAUSA
   Wallpaper Engine mette in pausa lo sfondo quando c'è un'app a schermo
   intero (setPaused). Qui la pausa ferma il lavoro di sfondo della mappa
   con lo stesso interruttore degli overlay (mapIdle.js): navi, polling
   dei marker, frecce animate.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { getLang, setLang, getSupportedLangs } from '../shared/i18n.js';
import { setUserApiKey, userApiKeyStatus } from '../shared/trpcProxy.js';
import { pauseMapBackgroundWork, resumeMapBackgroundWork } from './mapIdle.js';

const HINT_KEY = 'we_wallpaper_hint_seen';

// Canali dello sfondo (proprietà "Versione"): stessi indirizzi
// dell'involucro. Cambiarlo dal pannello porta la pagina sull'altro sito.
const CHANNELS = {
  live: 'https://wareraplus.vercel.app',
  dev: 'https://wareraplus-dev.vercel.app',
};

// Nome della proprietà in wallpaper/project.json → nome usato qui.
const WE_KEYMAP = {
  view: 'view', rotate: 'rotate', rotateminutes: 'rotateMinutes',
  framing: 'framing', country: 'country', theme: 'theme', language: 'lang',
  animations: 'animations', battles: 'battles', alliancelabels: 'blocLabels',
  ticker: 'ticker', menubar: 'menubar', apikey: 'apiKey',
};

// Le viste sono i bottoni #mode-<id> del markup Diplomacy: cambiare vista
// è un clic su quel bottone, lo stesso che fa la barra menù.
const VIEWS = [
  'diplomacy', 'blocs', 'sphereOfInfluence', 'weeklyDamage', 'population',
  'production', 'contested', 'warIntensity', 'playstyle', 'politics',
  'travel', 'migration', 'funding',
];
// In rotazione no "Distanze": senza un clic su una regione è una mappa vuota.
const ROTATION = VIEWS.filter(v => v !== 'travel');

// Inquadrature: centro e zoom di partenza. 'world' è quella del sito.
const FRAMINGS = {
  world: { center: [0, 20], zoom: 2 },
  europe: { center: [15, 50], zoom: 3.6 },
  americas: { center: [-80, 12], zoom: 2.4 },
  asia: { center: [95, 30], zoom: 2.8 },
  africa: { center: [20, 2], zoom: 3 },
  middleeast: { center: [45, 30], zoom: 3.8 },
};

const DEFAULTS = {
  view: 'diplomacy',
  rotate: false,
  rotateMinutes: 10,
  framing: 'world',
  country: '',
  theme: 'dark',
  lang: 'auto',
  animations: true,
  battles: true,
  blocLabels: true,
  ticker: true,
  menubar: false,
  apiKey: '',
};

/* ── Testi della fascia (9 lingue, chiave = id) ── */
const DICT = {
  en: {
    title: 'WarEra+ wallpaper',
    body: 'You can click nations, battles and news. The keyboard does not reach a wallpaper: to search, use the menus and open the sections, use the full tool in your browser.',
    open: 'Open WarEra+ in the browser',
    ok: 'Got it',
    info: 'About this wallpaper',
    key_none: 'Tip: add your WarEra API key in the wallpaper properties (request one in the game settings). Data then comes straight from WarEra on your own key.',
    key_ok: 'Your API key is active: data comes straight from WarEra.',
    key_rejected: 'WarEra rejected your API key, so the wallpaper is using the shared server. Check the key in the wallpaper properties.',
    by: 'Made by frappa10',
    support: 'Support the project',
  },
  it: {
    title: 'Sfondo WarEra+',
    body: 'Puoi cliccare su nazioni, battaglie e notizie. La tastiera non arriva a uno sfondo: per cercare, usare i menù e aprire le sezioni usa il tool completo nel browser.',
    open: 'Apri WarEra+ nel browser',
    ok: 'Ho capito',
    info: 'Informazioni sullo sfondo',
    key_none: 'Consiglio: aggiungi la tua chiave API di WarEra nelle proprietà dello sfondo (si richiede dalle impostazioni del gioco). I dati arrivano così direttamente da WarEra, sulla tua chiave.',
    key_ok: 'La tua chiave API è attiva: i dati arrivano direttamente da WarEra.',
    key_rejected: 'WarEra ha rifiutato la tua chiave API, quindi lo sfondo usa il server condiviso. Controlla la chiave nelle proprietà dello sfondo.',
    by: 'Creato da frappa10',
    support: 'Sostieni il progetto',
  },
  es: {
    title: 'Fondo de WarEra+',
    body: 'Puedes hacer clic en naciones, batallas y noticias. El teclado no llega a un fondo de pantalla: para buscar, usar los menús y abrir las secciones, usa la herramienta completa en el navegador.',
    open: 'Abrir WarEra+ en el navegador',
    ok: 'Entendido',
    info: 'Acerca de este fondo',
    key_none: 'Consejo: añade tu clave API de WarEra en las propiedades del fondo (se solicita en los ajustes del juego). Así los datos llegan directamente de WarEra con tu clave.',
    key_ok: 'Tu clave API está activa: los datos llegan directamente de WarEra.',
    key_rejected: 'WarEra rechazó tu clave API, así que el fondo usa el servidor compartido. Revisa la clave en las propiedades del fondo.',
    by: 'Creado por frappa10',
    support: 'Apoya el proyecto',
  },
  de: {
    title: 'WarEra+ Hintergrund',
    body: 'Du kannst Nationen, Schlachten und Nachrichten anklicken. Die Tastatur erreicht einen Hintergrund nicht: Zum Suchen, für die Menüs und die Bereiche nutze das vollständige Tool im Browser.',
    open: 'WarEra+ im Browser öffnen',
    ok: 'Verstanden',
    info: 'Über diesen Hintergrund',
    key_none: 'Tipp: Trage deinen WarEra-API-Schlüssel in den Eigenschaften des Hintergrunds ein (anzufordern in den Spieleinstellungen). Dann kommen die Daten direkt von WarEra über deinen Schlüssel.',
    key_ok: 'Dein API-Schlüssel ist aktiv: Die Daten kommen direkt von WarEra.',
    key_rejected: 'WarEra hat deinen API-Schlüssel abgelehnt, daher nutzt der Hintergrund den gemeinsamen Server. Prüfe den Schlüssel in den Eigenschaften.',
    by: 'Erstellt von frappa10',
    support: 'Projekt unterstützen',
  },
  fr: {
    title: 'Fond d’écran WarEra+',
    body: 'Tu peux cliquer sur les nations, les batailles et les actualités. Le clavier n’atteint pas un fond d’écran : pour chercher, utiliser les menus et ouvrir les sections, utilise l’outil complet dans le navigateur.',
    open: 'Ouvrir WarEra+ dans le navigateur',
    ok: 'Compris',
    info: 'À propos de ce fond d’écran',
    key_none: 'Astuce : ajoute ta clé API WarEra dans les propriétés du fond d’écran (elle se demande dans les paramètres du jeu). Les données arrivent alors directement de WarEra, avec ta clé.',
    key_ok: 'Ta clé API est active : les données arrivent directement de WarEra.',
    key_rejected: 'WarEra a refusé ta clé API, le fond d’écran utilise donc le serveur partagé. Vérifie la clé dans les propriétés.',
    by: 'Créé par frappa10',
    support: 'Soutenir le projet',
  },
  nl: {
    title: 'WarEra+ achtergrond',
    body: 'Je kunt op landen, veldslagen en nieuws klikken. Het toetsenbord bereikt een achtergrond niet: om te zoeken, de menu’s te gebruiken en de secties te openen, gebruik je de volledige tool in de browser.',
    open: 'WarEra+ openen in de browser',
    ok: 'Begrepen',
    info: 'Over deze achtergrond',
    key_none: 'Tip: voeg je WarEra API-sleutel toe in de eigenschappen van de achtergrond (aan te vragen in de spelinstellingen). De gegevens komen dan rechtstreeks van WarEra, op je eigen sleutel.',
    key_ok: 'Je API-sleutel is actief: de gegevens komen rechtstreeks van WarEra.',
    key_rejected: 'WarEra heeft je API-sleutel geweigerd, dus de achtergrond gebruikt de gedeelde server. Controleer de sleutel in de eigenschappen.',
    by: 'Gemaakt door frappa10',
    support: 'Steun het project',
  },
  sv: {
    title: 'WarEra+ bakgrund',
    body: 'Du kan klicka på nationer, strider och nyheter. Tangentbordet når inte en bakgrund: för att söka, använda menyerna och öppna sektionerna, använd hela verktyget i webbläsaren.',
    open: 'Öppna WarEra+ i webbläsaren',
    ok: 'Uppfattat',
    info: 'Om den här bakgrunden',
    key_none: 'Tips: lägg till din WarEra API-nyckel i bakgrundens egenskaper (begärs i spelets inställningar). Då kommer data direkt från WarEra, på din egen nyckel.',
    key_ok: 'Din API-nyckel är aktiv: data kommer direkt från WarEra.',
    key_rejected: 'WarEra avvisade din API-nyckel, så bakgrunden använder den delade servern. Kontrollera nyckeln i egenskaperna.',
    by: 'Skapad av frappa10',
    support: 'Stöd projektet',
  },
  pt: {
    title: 'Papel de parede WarEra+',
    body: 'Podes clicar em nações, batalhas e notícias. O teclado não chega a um papel de parede: para pesquisar, usar os menus e abrir as secções, usa a ferramenta completa no navegador.',
    open: 'Abrir o WarEra+ no navegador',
    ok: 'Entendido',
    info: 'Sobre este papel de parede',
    key_none: 'Dica: adiciona a tua chave API do WarEra nas propriedades do papel de parede (pede-se nas definições do jogo). Os dados chegam assim diretamente do WarEra, com a tua chave.',
    key_ok: 'A tua chave API está ativa: os dados chegam diretamente do WarEra.',
    key_rejected: 'O WarEra recusou a tua chave API, por isso o papel de parede usa o servidor partilhado. Verifica a chave nas propriedades.',
    by: 'Criado por frappa10',
    support: 'Apoiar o projeto',
  },
  ar: {
    title: 'خلفية WarEra+',
    body: 'يمكنك النقر على الدول والمعارك والأخبار. لوحة المفاتيح لا تصل إلى الخلفية: للبحث واستخدام القوائم وفتح الأقسام استخدم الأداة الكاملة في المتصفح.',
    open: 'افتح WarEra+ في المتصفح',
    ok: 'فهمت',
    info: 'حول هذه الخلفية',
    key_none: 'نصيحة: أضف مفتاح WarEra API الخاص بك في خصائص الخلفية (يُطلب من إعدادات اللعبة). عندها تصل البيانات مباشرة من WarEra بمفتاحك.',
    key_ok: 'مفتاح API الخاص بك فعّال: البيانات تصل مباشرة من WarEra.',
    key_rejected: 'رفض WarEra مفتاح API الخاص بك، لذلك تستخدم الخلفية الخادم المشترك. تحقق من المفتاح في الخصائص.',
    by: 'من إنشاء frappa10',
    support: 'ادعم المشروع',
  },
};

function tw(key) {
  return (DICT[getLang()] || DICT.en)[key] || DICT.en[key];
}

/* ── Stato ── */
let _props = { ...DEFAULTS };
let _ready = false;          // mappa pronta: si possono cliccare viste e interruttori
let _applied = {};           // ultimi valori applicati, per toccare solo ciò che cambia
let _rotateTimer = null;
let _rotateIndex = 0;
let _paused = false;

/* ── Lettura e pulizia ── */
function bool(v, fallback) {
  if (v === true || v === '1' || v === 'true') return true;
  if (v === false || v === '0' || v === 'false') return false;
  return fallback;
}

function normalizeProps(raw) {
  const p = { ..._props };
  if (!raw || typeof raw !== 'object') return p;
  if (VIEWS.includes(raw.view)) p.view = raw.view;
  if (raw.rotate !== undefined) p.rotate = bool(raw.rotate, p.rotate);
  const mins = Number(raw.rotateMinutes);
  if (Number.isFinite(mins) && mins >= 1) p.rotateMinutes = Math.min(120, Math.round(mins));
  if (FRAMINGS[raw.framing]) p.framing = raw.framing;
  if (typeof raw.country === 'string') p.country = raw.country.trim().slice(0, 60);
  if (raw.theme === 'dark' || raw.theme === 'light') p.theme = raw.theme;
  if (raw.lang === 'auto' || getSupportedLangs().includes(raw.lang)) p.lang = raw.lang;
  for (const k of ['animations', 'battles', 'blocLabels', 'ticker', 'menubar']) {
    if (raw[k] !== undefined) p[k] = bool(raw[k], p[k]);
  }
  if (typeof raw.apiKey === 'string') p.apiKey = raw.apiKey.trim().slice(0, 200);
  return p;
}

/** Le stesse proprietà dall'URL dell'iframe (tutte tranne la chiave). */
function propsFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const raw = {};
  // `focus` e non `country`: ?country= è già il deep-link del sito (un id,
  // apre il pannello — main.js), qui c'è un nome scritto a mano.
  const map = {
    view: 'view', rotate: 'rotate', rotatemin: 'rotateMinutes', framing: 'framing',
    focus: 'country', theme: 'theme', lang: 'lang', anim: 'animations',
    battles: 'battles', labels: 'blocLabels', ticker: 'ticker', menubar: 'menubar',
  };
  for (const [param, key] of Object.entries(map)) {
    if (q.has(param)) raw[key] = q.get(param);
  }
  return raw;
}

/** L'URL di uno stato: lo stesso formato che costruisce l'involucro
 *  (wallpaper/index.html), chiave esclusa. */
function queryFor(p) {
  const q = new URLSearchParams({
    wallpaper: '1', view: p.view, rotate: p.rotate ? '1' : '0',
    rotatemin: String(p.rotateMinutes), framing: p.framing, theme: p.theme,
    lang: p.lang, anim: p.animations ? '1' : '0', battles: p.battles ? '1' : '0',
    labels: p.blocLabels ? '1' : '0', ticker: p.ticker ? '1' : '0',
    menubar: p.menubar ? '1' : '0',
  });
  if (p.country) q.set('focus', p.country);
  return q.toString();
}

/** La chiave dal frammento `#k=…`, poi il frammento sparisce. */
function takeKeyFromHash() {
  const m = /[#&]k=([^&]*)/.exec(window.location.hash);
  if (!m) return '';
  try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* idem */ }
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}

/** Le proprietà come le manda Wallpaper Engine ({ nome: { value } }),
 *  tradotte nei nomi di qui. Solo quelle cambiate arrivano ogni volta. */
function fromWallpaperEngine(changed) {
  const raw = {};
  for (const [name, prop] of Object.entries(changed || {})) {
    const key = WE_KEYMAP[name];
    if (key && prop && 'value' in prop) raw[key] = prop.value;
  }
  return raw;
}

/** Parte appena il modulo è caricato (da main.js), prima della mappa: la
 *  chiave API deve essere impostata prima delle prime chiamate, e
 *  Wallpaper Engine può chiamare il listener molto presto. */
export function initWallpaperEarly() {
  _props = normalizeProps({ ...propsFromUrl(), apiKey: takeKeyFromHash() });
  setUserApiKey(_props.apiKey);
  document.body?.classList.add('wp-wallpaper');

  window.wallpaperPropertyListener = {
    applyUserProperties(changed) {
      console.debug('[wallpaper] proprietà da Wallpaper Engine:', Object.keys(changed || {}).join(', '));
      // "Versione" cambiata: si va sull'altro sito, con le stesse
      // proprietà nell'URL (la chiave di nuovo nel frammento).
      const ch = changed?.channel?.value;
      if (ch && CHANNELS[ch] && CHANNELS[ch] !== window.location.origin
          && /^https:/.test(window.location.origin)) {
        _props = normalizeProps(fromWallpaperEngine(changed));
        const k = _props.apiKey ? `#k=${encodeURIComponent(_props.apiKey)}` : '';
        window.location.replace(`${CHANNELS[ch]}/?${queryFor(_props)}${k}`);
        return;
      }
      _props = normalizeProps(fromWallpaperEngine(changed));
      setUserApiKey(_props.apiKey);
      if (_ready) applyProps();
    },
    setPaused(isPaused) {
      setPaused(Boolean(isPaused));
    },
  };
}

/** A mappa pronta (wareraplus:diplomacy-ready, da main.js). */
export function startWallpaperMode() {
  document.body.classList.add('wp-wallpaper');
  _ready = true;
  buildInfoUi();
  applyProps();
  window.addEventListener('wareraplus:apikey-status', paintKeyStatus);
  window.addEventListener('wareraplus:langchange', () => { if (_infoEl) renderInfo(); });
}

/* ── Applicazione ── */
function changed(key, value) {
  if (_applied[key] === value) return false;
  _applied[key] = value;
  return true;
}

function setCheckbox(id, on) {
  const cb = document.getElementById(id);
  if (!cb || cb.checked === on) return;
  cb.checked = on;
  cb.dispatchEvent(new Event('change'));
}

function setView(view) {
  const btn = document.getElementById(`mode-${view}`);
  if (!btn) return;
  btn.click();
}

function applyProps() {
  const p = _props;
  const body = document.body;
  body.classList.toggle('wp-wp-menubar', p.menubar);
  body.classList.toggle('wp-wp-no-ticker', !p.ticker);

  if (changed('lang', p.lang) && p.lang !== 'auto') setLang(p.lang);
  if (changed('theme', p.theme) && state.theme !== p.theme) {
    document.getElementById('theme-toggle-btn')?.click();
  }
  // Proprietà "Animazioni": l'interruttore unico (shared/motion.js) è
  // ancora solo su dev. Finché non arriva su main la proprietà non fa
  // niente; al merge di dev questo blocco torna quello di dev.
  if (changed('battles', p.battles)) setCheckbox('checkActiveBattles', p.battles);
  if (changed('blocLabels', p.blocLabels)) setCheckbox('wp-checkBlocLabels', p.blocLabels);

  const rotationKey = `${p.rotate}:${p.rotateMinutes}:${p.view}`;
  if (changed('rotation', rotationKey)) {
    setView(p.view);
    startRotation();
  }

  if (changed('place', `${p.country}|${p.framing}`)) frameMap();
  paintKeyStatus();
}

function startRotation() {
  clearInterval(_rotateTimer);
  _rotateTimer = null;
  if (!_props.rotate) return;
  // Solo le viste che questa versione del sito ha davvero: lo sfondo
  // pubblicato carica il live, che può avere meno viste di dev.
  const views = ROTATION.filter(v => document.getElementById(`mode-${v}`));
  if (!views.length) return;
  _rotateIndex = Math.max(0, views.indexOf(_props.view));
  _rotateTimer = setInterval(() => {
    if (_paused || document.hidden) return;
    _rotateIndex = (_rotateIndex + 1) % views.length;
    setView(views[_rotateIndex]);
  }, _props.rotateMinutes * 60 * 1000);
}

/* Nazione scritta a mano: codice ISO, nome, o inizio del nome, senza
   badare ad accenti e maiuscole ("italia", "IT", "Ital"). */
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function findNation(text) {
  const q = fold(text);
  if (!q) return null;
  const all = state.nazioniGlobal || [];
  return all.find(n => fold(n.code) === q)
    || all.find(n => fold(n.name) === q)
    || all.find(n => fold(n.name).startsWith(q))
    || null;
}

function frameMap() {
  const map = state.map;
  if (!map) return;
  const nation = findNation(_props.country);
  if (nation) {
    const label = state.labelsData.find(l => l.properties?.countryId === nation._id);
    if (label) {
      map.jumpTo({ center: label.coordinates, zoom: 3.6 });
      return;
    }
  }
  const f = FRAMINGS[_props.framing] || FRAMINGS.world;
  map.jumpTo(f);
}

function setPaused(paused) {
  if (paused === _paused) return;
  _paused = paused;
  if (paused) pauseMapBackgroundWork();
  else resumeMapBackgroundWork();
}

/* ── Fascia informativa + "i" ── */
let _infoEl = null;
let _infoBtn = null;

function buildInfoUi() {
  _infoBtn = document.createElement('button');
  _infoBtn.type = 'button';
  _infoBtn.className = 'wp-wallpaper-info-btn';
  _infoBtn.textContent = 'i';
  _infoBtn.addEventListener('click', () => toggleInfo(true));
  document.body.appendChild(_infoBtn);

  _infoEl = document.createElement('div');
  _infoEl.className = 'wp-wallpaper-info';
  _infoEl.hidden = true;
  document.body.appendChild(_infoEl);
  renderInfo();

  let seen = false;
  try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch { /* storage bloccato */ }
  if (!seen) toggleInfo(true);
}

function renderInfo() {
  _infoBtn.title = tw('info');
  _infoBtn.setAttribute('aria-label', tw('info'));
  const site = `${window.location.origin}/`;
  _infoEl.innerHTML = `
    <div class="wp-wallpaper-info-title">${tw('title')}</div>
    <p>${tw('body')}</p>
    <p class="wp-wallpaper-key" data-status=""></p>
    <div class="wp-wallpaper-info-actions">
      <a class="wp-wallpaper-open" href="${site}" target="_blank" rel="noopener">${tw('open')}</a>
      <button type="button" class="wp-wallpaper-ok">${tw('ok')}</button>
    </div>
    <div class="wp-wallpaper-credits">
      ${tw('by')} · <a href="https://ko-fi.com/frappa10" target="_blank" rel="noopener">${tw('support')}</a>
    </div>`;
  _infoEl.querySelector('.wp-wallpaper-ok').addEventListener('click', () => {
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* idem */ }
    toggleInfo(false);
  });
  paintKeyStatus();
}

function paintKeyStatus() {
  const el = _infoEl?.querySelector('.wp-wallpaper-key');
  if (!el) return;
  const status = userApiKeyStatus();
  el.dataset.status = status;
  el.textContent = status === 'ok' ? tw('key_ok')
    : status === 'rejected' ? tw('key_rejected')
    : status === 'none' ? tw('key_none')
    : '';
  // Una chiave rifiutata la si dice subito, anche a fascia chiusa: se no
  // l'utente crede di usarla e non lo saprà mai.
  if (status === 'rejected' && _infoEl.hidden) toggleInfo(true);
}

function toggleInfo(open) {
  _infoEl.hidden = !open;
  _infoBtn.classList.toggle('active', open);
}
