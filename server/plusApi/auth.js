/* ═══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — accesso con Discord (OAuth2)
   -----------------------------------------------------------------------
   Serve un'identità STABILE a cui appendere le prenotazioni. Discord è la
   scelta ovvia perché è dove la cosa già succede: oggi il comandante scrive
   in chat che ha tot danni e il ministro risponde "ok". Non stiamo
   spostando le persone altrove, stiamo dando una memoria a quel gesto.

   ── NIENTE BOT ─────────────────────────────────────────────────────────
   Solo OAuth2 con scope `identify`. Un bot serve a stare DENTRO un server
   Discord, con inviti e permessi: qui non serve, e sarebbe un pezzo in più
   da tenere vivo. Leggiamo nome utente, id e avatar. Non l'email (che
   richiederebbe lo scope `email` e non ci serve a niente), non i server,
   non i messaggi.

   ── COSA PROVA E COSA NON PROVA ────────────────────────────────────────
   Questo giro dimostra "sei il proprietario di quell'account Discord", e
   nient'altro. Non dice NIENTE su chi sei nel gioco: quello è il lavoro di
   verify.js (il codice da mettere nel nome di un'azienda). Tenere separate
   le due cose è deliberato — sono due domande diverse e falliscono per
   ragioni diverse.

   ── IL SEGRETO STA QUI, NON NEL BROWSER ────────────────────────────────
   Per questo il redirect URI registrato su Discord punta a QUESTO server e
   non a Vercel: lo scambio codice→identità va firmato col client secret, e
   un segreto nel bundle servito al browser non è un segreto. È l'errore che
   si fa la prima volta, ed è anche il motivo per cui l'area riservata non
   poteva essere solo client-side.

   ── DUE APPLICAZIONI, UNA PER AMBIENTE ─────────────────────────────────
   La schermata di consenso mostra il nome dell'applicazione: un tester che
   legge "WarEra+ dev" sa cosa sta autorizzando. E i due segreti si possono
   ruotare separatamente.
   ═══════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const express = require('express');
const {
  upsertDiscordAccount, createSession, accountFromToken, destroySession, audit,
} = require('./db');

const DISCORD_API = 'https://discord.com/api/v10';

// Gli Application ID sono PUBBLICI (compaiono nell'URL di autorizzazione che
// vede chiunque premi il bottone), quindi stanno nel codice: una cosa in meno
// da ricordarsi di mettere nell'ambiente di pm2 al deploy. Il SECRET no —
// quello arriva solo da DISCORD_CLIENT_SECRET, e se manca il server parte
// lo stesso ma /health lo dichiara MANCANTE.
const CLIENT_IDS = {
  live: '1544716064087347242', // applicazione "WarEra+"
  dev:  '1544716478853681202', // applicazione "WarEra+ dev"
};

// Lo state è FIRMATO invece che salvato in una tabella: è usa-e-getta e vive
// dieci minuti, tenerne traccia su disco vorrebbe dire scrivere una riga per
// ogni click sul bottone di login, comprese le migliaia che non arrivano mai
// in fondo. La firma HMAC dà la stessa garanzia (non l'ha fabbricato un
// altro) senza stato da pulire.
const STATE_TTL_MS = 10 * 60 * 1000;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

function signState(secret, payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyState(secret, state) {
  const [body, mac] = String(state || '').split('.');
  if (!body || !mac) return null;

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  // timingSafeEqual e non `===`: confrontare stringa per stringa perde in
  // media dopo il primo carattere diverso, e quel tempo è un'informazione.
  // Costa niente farlo giusto.
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')); }
  catch { return null; }

  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Limite di tentativi
// ---------------------------------------------------------------------------
// In memoria e non su disco: si azzera a ogni restart, che qui va benissimo.
// Non protegge da un attacco distribuito — protegge dal caso vero, cioè un
// bottone che parte in loop per un bug e riempie i log di richieste a Discord.
const _hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (_hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  _hits.set(key, arr);
  if (_hits.size > 500) for (const [k, v] of _hits) if (!v.length || now - v[v.length - 1] > windowMs) _hits.delete(k);
  return arr.length > max;
}

/**
 * @param {object} cfg
 * @param {'live'|'dev'} cfg.env
 * @param {string} cfg.publicBase   URL pubblico di QUESTO server, senza barra finale
 * @param {string} cfg.clientSecret
 * @param {string} cfg.sessionSecret
 * @param {string[]} cfg.allowedOrigins
 */
function buildAuthRouter(cfg) {
  const router = express.Router();
  const clientId = process.env.DISCORD_CLIENT_ID || CLIENT_IDS[cfg.env] || CLIENT_IDS.dev;

  // DEVE combaciare carattere per carattere con quello registrato su Discord,
  // altrimenti la risposta è `Invalid OAuth2 redirect_uri` e non spiega altro.
  const redirectUri = `${cfg.publicBase}/auth/discord/callback`;

  // Il ritorno passa dal FRAMMENTO (#) e non dalla query (?) per due motivi:
  // il frammento non viene mandato al server nelle richieste successive e non
  // finisce nei log di nessuno, e la query è già occupata dai deep-link del
  // tool (?country=, ?tm=) che non vanno disturbati.
  const back = (origin, params) => `${origin}/#${new URLSearchParams(params)}`;

  // ── 1. Partenza ──────────────────────────────────────────────────────────
  router.get('/discord/start', (req, res) => {
    const origin = String(req.query.origin || cfg.allowedOrigins[0] || '');
    // L'origin torna dentro allo state firmato e viene ricontrollato al
    // ritorno: senza allowlist, chiunque potrebbe farsi rimandare il token
    // di sessione su un sito qualsiasi passando ?origin=.
    if (!cfg.allowedOrigins.includes(origin)) {
      return res.status(400).json({ error: 'origin_non_ammessa', origin });
    }
    if (!cfg.clientSecret) {
      return res.status(503).json({ error: 'discord_non_configurato' });
    }
    if (rateLimited(`start:${req.ip}`, 20, 60_000)) {
      return res.status(429).json({ error: 'troppi_tentativi' });
    }

    const state = signState(cfg.sessionSecret, {
      origin,
      nonce: crypto.randomBytes(12).toString('base64url'),
      exp: Date.now() + STATE_TTL_MS,
    });

    const url = new URL(`${DISCORD_API.replace('/api/v10', '')}/oauth2/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    // NIENTE `prompt=none`, deliberatamente. Salterebbe la schermata di
    // consenso a chi ha già autorizzato — un clic in meno — ma il
    // comportamento per chi NON ha mai autorizzato non è garantito, e se lì
    // rispondesse errore invece di mostrare il consenso nessuno riuscirebbe
    // a registrarsi: il percorso critico. Un clic contro il rischio che non
    // entri nessuno non è uno scambio conveniente. Il default di Discord
    // mostra il consenso, e mostrare a ogni accesso cosa si sta
    // autorizzando non è comunque un difetto.

    res.redirect(url.toString());
  });

  // ── 2. Ritorno ───────────────────────────────────────────────────────────
  router.get('/discord/callback', async (req, res) => {
    const fallbackOrigin = cfg.allowedOrigins[0] || '';
    const payload = verifyState(cfg.sessionSecret, req.query.state);
    // State non valido o scaduto: si rimanda alla home senza sessione. È il
    // caso normale di chi lascia la scheda aperta un'ora e poi conferma.
    if (!payload) return res.redirect(back(fallbackOrigin, { wp_auth_error: 'stato_scaduto' }));

    const origin = cfg.allowedOrigins.includes(payload.origin) ? payload.origin : fallbackOrigin;

    // L'utente ha premuto "Annulla" sulla schermata di Discord.
    if (req.query.error) return res.redirect(back(origin, { wp_auth_error: 'annullato' }));
    const code = String(req.query.code || '');
    if (!code) return res.redirect(back(origin, { wp_auth_error: 'codice_mancante' }));

    try {
      // Scambio codice → access token. È l'unico punto in cui il secret esce
      // da questo processo, e va a Discord su TLS.
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: cfg.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        console.error('[auth] scambio token fallito:', tokenRes.status, (await tokenRes.text()).slice(0, 300));
        return res.redirect(back(origin, { wp_auth_error: 'scambio_fallito' }));
      }
      const { access_token: accessToken } = await tokenRes.json();

      const meRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!meRes.ok) {
        console.error('[auth] lettura profilo fallita:', meRes.status);
        return res.redirect(back(origin, { wp_auth_error: 'profilo_illeggibile' }));
      }
      const me = await meRes.json();

      // L'access token di Discord finisce qui: non lo salviamo. Ci serviva
      // per una domanda sola ("chi sei"), e tenerlo vorrebbe dire custodire
      // una credenziale altrui per nessun uso previsto.
      const account = upsertDiscordAccount({
        discordId: me.id,
        username: me.global_name || me.username,
        avatar: me.avatar || null,
      });

      const token = createSession(account.id);
      audit(account.id, 'login', 'account', { discordId: me.id });

      return res.redirect(back(origin, { wp_auth: token }));
    } catch (err) {
      console.error('[auth] errore inatteso nel callback:', err.message);
      return res.redirect(back(origin, { wp_auth_error: 'errore_server' }));
    }
  });

  // ── 3. Chi sono ──────────────────────────────────────────────────────────
  router.get('/me', (req, res) => {
    const account = accountFromToken(bearer(req));
    if (!account) return res.status(401).json({ error: 'non_autenticato' });
    res.json({ account: publicAccount(account) });
  });

  // ── 4. Esci ──────────────────────────────────────────────────────────────
  router.post('/logout', (req, res) => {
    destroySession(bearer(req));
    res.json({ ok: true });
  });

  return router;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Solo i campi che il client può vedere. Gli id interni e gli hash restano
 *  di qua: quello che non esce non si può sbagliare a mostrare. */
function publicAccount(a) {
  return {
    discordUsername: a.discord_username,
    discordAvatar: a.discord_avatar
      ? `https://cdn.discordapp.com/avatars/${a.discord_id}/${a.discord_avatar}.png?size=64`
      : null,
    warUserId: a.war_user_id || null,
    warUsername: a.war_username || null,
    verificato: Boolean(a.war_user_id),
  };
}

module.exports = { buildAuthRouter, bearer, publicAccount, CLIENT_IDS };
