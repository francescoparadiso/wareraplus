import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// WarEra+: ambiente di deploy deciso a build time. Vercel mette
// VERCEL_ENV a 'production' sul branch di produzione e a 'preview' su
// ogni altro branch (è così che nasce la versione "dev" del tool: un
// branch a parte, un URL a parte). In locale la variabile non esiste e
// vale 'local'. Il perché e cosa cambia: src/shared/deployEnv.js.
//
// WP_DEPLOY_ENV ha la precedenza, e non è un capriccio: dal settembre 2026
// la copia dev NON è più un preview del progetto principale ma un SECONDO
// progetto Vercel sullo stesso repo, che tratta `dev` come proprio branch
// di produzione — serviva un URL pubblico, apribile da chi non ha un
// account Vercel, mentre i preview stanno dietro l'SSO. Conseguenza: là
// dentro VERCEL_ENV vale 'production', perché Vercel guarda il branch di
// produzione DEL PROGETTO, non il nome del branch. Senza questo override
// il progetto dev si crederebbe live e riaccenderebbe le tre cose che
// deployEnv.js esiste per spegnere (analytics, Umami, pill visite).
// Si imposta a 'preview' fra le env var di quel progetto, e basta.
const DEPLOY_ENV = process.env.WP_DEPLOY_ENV || process.env.VERCEL_ENV || 'local';
const IS_LIVE = DEPLOY_ENV === 'production';

export default defineConfig({
  define: {
    __WP_DEPLOY_ENV__: JSON.stringify(DEPLOY_ENV),
  },

  // Deploy su Vercel: root del dominio, nessun sub-path (a differenza del
  // vecchio Diplomacy View che era su GitHub Pages con base '/repo-name/').
  base: '/',

  // Porta del dev server presa da PORT quando c'e' (l'ambiente di sviluppo
  // puo' assegnarne una diversa se la 5173 e' gia' occupata da un'altra
  // istanza); default invariato a 5173.
  server: { port: Number(process.env.PORT) || 5173 },

  plugins: [
    // WarEra+: la copia di prova non deve finire nei motori di ricerca.
    // Ha un URL pubblico (secondo progetto Vercel, vedi WP_DEPLOY_ENV
    // sopra), quindi senza questo prima o poi un giocatore ci arriva da
    // una ricerca e segnala un bug già corretto in live — o peggio, legge
    // dati di prova credendoli veri. Iniettato a build time e non da JS
    // perché i crawler leggono l'HTML servito, non il DOM dopo gli script.
    {
      name: 'wp-noindex-non-live',
      transformIndexHtml(html) {
        if (IS_LIVE) return html;
        return html.replace(
          /<head>/i,
          '<head>\n  <meta name="robots" content="noindex, nofollow" />'
        );
      },
    },

    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      // WarEra+: sul deploy di prova il service worker si DISINSTALLA
      // invece di installarsi. Motivo pratico: un preview serve a vedere
      // se una modifica funziona, e un SW che serve il bundle precedente
      // dalla cache è esattamente il modo migliore per guardare una
      // modifica che c'è e credere che non ci sia. Conseguenza accettata:
      // il comportamento PWA (offline, installazione) si prova solo in
      // produzione o con una build locale a mano.
      selfDestroying: !IS_LIVE,

      // Precache di tutto il bundle costruito (JS/CSS/HTML dell'app,
      // incluso il Political View invariato sotto /political/).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,csv}'],
        // WarEra+ perf (mobile): le illustrazioni decorative dell'oceano
        // (navi/mostro/relitto/onde, public/icons/ocean/) sono da sole ~8 MB
        // degli 11,1 MB di precache — cioè il primo accesso da telefono
        // scaricava in background 8 MB di easter egg prima ancora che
        // servissero, e per metà erano quelli del tema non attivo. Fuori dal
        // precache: le prende a richiesta il tema che le usa (vedi
        // src/diplomacy/oceanImages.js) e da lì restano in cache 60 giorni
        // grazie alla regola runtime qui sotto.
        // Conseguenza accettata: alla PRIMA apertura offline gli easter egg
        // non ci sono. La mappa, i dati e tutta la UI sì — sono decorazioni.
        globIgnores: ['**/icons/ocean/**'],
        // I file politici sono tanti e alcuni superano il default:
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,

        // Le chiamate verso questi path (tRPC WarEra) NON sono servite
        // dal nostro dominio quindi non rientrano nel precache statico:
        // vanno gestite con runtimeCaching (vedi sotto).
        navigateFallbackDenylist: [/^\/political\//],

        runtimeCaching: [
          // ── API WarEra (tRPC) — network-first: dati sempre freschi se
          //    c'è connessione, ma utilizzabili offline con l'ultima
          //    risposta nota se la rete cade. TTL breve perché sono dati
          //    di gioco che cambiano spesso. ──
          {
            urlPattern: ({ url }) =>
              /^(api2|api4|api6|apidev)\.warera\.io$/.test(url.hostname) ||
              url.hostname.endsWith('workers.dev'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'warera-api-cache',
              networkTimeoutSeconds: 6,
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 10 * 60, // 10 minuti
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── Immagini bandiere / asset statici WarEra — cache-first,
          //    cambiano raramente. ──
          {
            urlPattern: ({ url }) => url.hostname === 'media.warera.io' || url.hostname === 'app.warera.io',
            handler: 'CacheFirst',
            options: {
              cacheName: 'warera-images-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 giorni
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── Illustrazioni oceano (nostro dominio) — tolte dal precache
          //    (vedi globIgnores sopra): si scaricano quando il tema che le
          //    usa le chiede, e poi restano in cache a lungo. Sono file che
          //    cambiano solo se li sostituiamo noi, e in quel caso cambia
          //    anche il nome/deploy. ──
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/icons/ocean/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'warera-ocean-art-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 giorni
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── CSV esterni (NAP, Sphere of Influence) da GitHub raw ──
          {
            urlPattern: ({ url }) => url.hostname === 'raw.githubusercontent.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'warera-csv-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 },
            },
          },
          // ── Google Fonts ──
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── MapLibre GL CSS/JS da unpkg ──
          {
            urlPattern: ({ url }) => url.hostname === 'unpkg.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'maplibre-cdn-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },

      manifest: {
        id: '/',
        name: 'WarEra+',
        short_name: 'WarEra+',
        description: 'Mappa diplomatica e situazione politica di tutte le nazioni WarEra, in un\u2019unica app.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0d1117',
        theme_color: '#0d1117',
        orientation: 'any',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      devOptions: {
        // Abilita il service worker anche in `vite dev`, utile per testare
        // subito il comportamento offline senza dover fare una build.
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
