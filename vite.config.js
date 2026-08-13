import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Deploy su Vercel: root del dominio, nessun sub-path (a differenza del
  // vecchio Diplomacy View che era su GitHub Pages con base '/repo-name/').
  base: '/',

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      // Precache di tutto il bundle costruito (JS/CSS/HTML dell'app,
      // incluso il Political View invariato sotto /political/).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,csv}'],
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
