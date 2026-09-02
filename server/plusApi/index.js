/* ═══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — processo API
   -----------------------------------------------------------------------
   Processo SEPARATO dal cache-server, e non per capriccio:

     · Il cache-server legge dati pubblici e li serve a tutti con
       origin:'*'. Questo scrive, è autenticato e custodisce un segreto.
       Due modelli di minaccia diversi non stanno bene nello stesso
       processo con la stessa politica CORS.
     · Il cache-server ha i poller: un restart interrompe il polling e
       perde il tempismo dei giri. Questo si riavvia ad ogni modifica,
       decine di volte al giorno mentre si sviluppa. Tenerli insieme
       significherebbe pagare l'uno per l'altro.
     · Esistono DUE istanze di questo processo (live e dev) con database
       separati, mentre di cache-server ce n'è uno solo che serve entrambi
       i deploy. Una prenotazione di prova di un tester non deve comparire
       ai ministri veri; una cache di dati pubblici invece si condivide
       senza pensarci.

   Porte: 3002 (live) e 3003 (dev), entrambe in ascolto SOLO su 127.0.0.1 —
   fuori ci arriva nginx, e le porte non vanno aperte nel firewall.

   ── AMBIENTE ATTESO (pm2) ──────────────────────────────────────────────
     WP_ENV                 'live' | 'dev'
     PORT                   3002 | 3003
     DATA_DIR               ./data | ./data-dev
     DISCORD_CLIENT_SECRET  il segreto dell'applicazione corrispondente
     SESSION_SECRET         stringa casuale lunga, diversa fra i due
     PUBLIC_BASE            URL pubblico di questo server, senza barra finale
     ALLOWED_ORIGINS        elenco separato da virgole
   Gli Application ID di Discord NON stanno qui: sono pubblici e vivono in
   auth.js. /health dichiara se il segreto c'è, mai il suo valore — stessa
   convenzione di trpcProxy.apiKey nel cache-server.
   ═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cors = require('cors');

const {
  initDb, purgeExpiredSessions, purgeExpiredClaims, dbStatus, syncAdminsFromEnv, accountFromToken,
} = require('./db');
const { buildAuthRouter, bearer, publicAccount } = require('./auth');
const { buildVerifyRouter } = require('./verify');
const { buildRolesRouter } = require('./roles');
const { buildRequestsRouter } = require('./requests');
const { risolviIdentita, bloccaScrittureSottoLente } = require('./identity');

const WP_ENV = process.env.WP_ENV === 'live' ? 'live' : 'dev';
const PORT = Number(process.env.PORT) || (WP_ENV === 'live' ? 3002 : 3003);
const PUBLIC_BASE = (process.env.PUBLIC_BASE || '').replace(/\/+$/, '');
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';

// Il file ecosystem nasce con un segnaposto al posto del secret, che va
// sostituito a mano sul VPS. Senza questo controllo /health direbbe
// "caricato" anche col segnaposto dentro — cioè esattamente la risposta
// sbagliata alla domanda "l'ho già configurato?".
const PLACEHOLDER = /^METTI-QUI/i;
const secretStato = !CLIENT_SECRET ? 'MANCANTE'
  : PLACEHOLDER.test(CLIENT_SECRET) ? 'SEGNAPOSTO (sostituiscilo in ecosystem.config.js)'
  : 'caricato';
const secretUsabile = CLIENT_SECRET && !PLACEHOLDER.test(CLIENT_SECRET);

// Senza SESSION_SECRET si genera una chiave casuale all'avvio: il server
// parte e si può provare, ma ogni restart invalida tutte le sessioni. È un
// degrado rumoroso di proposito — /health lo dichiara, così non capita di
// scoprirlo fra sei mesi da un "mi deslogga in continuazione".
const SESSION_SECRET = process.env.SESSION_SECRET
  || require('crypto').randomBytes(32).toString('hex');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

// Amministratori del tool, per id Discord. Stanno nell'AMBIENTE e vengono
// riapplicati a ogni avvio: se una query sbagliata azzerasse la colonna
// is_admin, un riavvio rimette in piedi l'amministratore invece di lasciare
// il tool chiuso a chiave con la chiave dentro. Altri admin si nominano poi
// normalmente e quelli vivono nel database.
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// CORS: allowlist, non '*'
// ---------------------------------------------------------------------------
// Il cache-server sta a origin:'*' e per dati pubblici in sola lettura va
// bene. Qui no: le richieste portano un Bearer e cambiano stato. L'elenco è
// corto e conosciuto (live, dev, localhost) — non c'è motivo di essere larghi.
app.use(cors({
  origin(origin, cb) {
    // Richieste senza Origin (curl, un health check, un redirect del browser)
    // non sono cross-origin e non hanno niente da autorizzare.
    if (!origin) return cb(null, true);
    cb(null, ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, '')));
  },
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '32kb' }));

// ---------------------------------------------------------------------------
// CHI SEI, E PUOI FARLO?
// ---------------------------------------------------------------------------
// Due sbarramenti soli, applicati per rotta. Il client riceve `admin` in
// /auth/me e lo usa per decidere COSA DISEGNARE; il permesso vero si
// controlla sempre qui, ad ogni chiamata — un bottone nascosto non e' un
// permesso negato.
function requireAuth(req, res, next) {
  const account = accountFromToken(bearer(req));
  if (!account) return res.status(401).json({ error: 'non_autenticato' });
  req.account = account;
  // Le rotte restituiscono account ripuliti passando da qui, cosi' la
  // forma esposta al client resta definita in un posto solo (auth.js).
  req.publicAccount = publicAccount;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.account?.is_admin) return res.status(403).json({ error: 'non_autorizzato' });
  next();
}

app.use('/verify', buildVerifyRouter({ requireAuth, requireAdmin }));
app.use('/roles', buildRolesRouter({ requireAuth, requireAdmin }));
app.use('/requests', buildRequestsRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente }));

app.use('/auth', buildAuthRouter({
  env: WP_ENV,
  publicBase: PUBLIC_BASE,
  clientSecret: secretUsabile ? CLIENT_SECRET : '',
  sessionSecret: SESSION_SECRET,
  allowedOrigins: ALLOWED_ORIGINS,
}));

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------
// Prima verifica dopo ogni deploy. Dice cosa MANCA senza mai stampare un
// valore: dopo un redeploy che perde una env var il sintomo altrimenti è
// "il login non funziona" e si perde un'ora a cercarlo nel posto sbagliato.
app.get('/health', (req, res) => res.json({
  status: 'ok',
  env: WP_ENV,
  now: Date.now(),
  discord: {
    clientSecret: secretStato,
    redirectUri: PUBLIC_BASE ? `${PUBLIC_BASE}/auth/discord/callback` : 'PUBLIC_BASE MANCANTE',
  },
  sessionSecret: process.env.SESSION_SECRET ? 'caricato' : 'EFFIMERO (le sessioni cadono ad ogni restart)',
  allowedOrigins: ALLOWED_ORIGINS,
  // Quanti ne sono dichiarati, non CHI: un id Discord e' un dato personale
  // e /health e' una rotta pubblica.
  adminDaAmbiente: ADMIN_DISCORD_IDS.length,
  db: dbStatus(),
}));

app.use((req, res) => res.status(404).json({ error: 'rotta_sconosciuta', path: req.path }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[plusApi] errore non gestito:', err.message);
  res.status(500).json({ error: 'errore_server' });
});

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
initDb();

const promossi = syncAdminsFromEnv(ADMIN_DISCORD_IDS);
if (promossi) console.log(`[plusApi] ${promossi} account promossi ad admin da ADMIN_DISCORD_IDS`);

// Le sessioni scadute si cancellano da sole quando qualcuno prova a usarle;
// questo giro serve alle altre, quelle di chi non torna più. Un'ora è
// abbondante per una tabella che cresce di poche righe al giorno.
setInterval(() => {
  const n = purgeExpiredSessions();
  if (n) console.log(`[plusApi] ${n} sessioni scadute rimosse`);
  // Le richieste di verifica scadute si intercettano gia' quando qualcuno
  // ci ritorna sopra; questo giro serve a quelle abbandonate.
  const c = purgeExpiredClaims();
  if (c) console.log(`[plusApi] ${c} richieste di verifica scadute rimosse`);
}, 3600_000).unref();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[plusApi] area riservata (${WP_ENV}) in ascolto su http://127.0.0.1:${PORT}`);
  if (!secretUsabile) console.warn(`[plusApi] ATTENZIONE: DISCORD_CLIENT_SECRET ${secretStato}, il login non funzionerà`);
  if (!PUBLIC_BASE) console.warn('[plusApi] ATTENZIONE: PUBLIC_BASE manca, il redirect_uri sarà sbagliato');
  if (!ALLOWED_ORIGINS.length) console.warn('[plusApi] ATTENZIONE: ALLOWED_ORIGINS vuoto, nessun origin potrà partire');
});
