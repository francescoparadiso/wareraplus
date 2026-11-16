/* ══════════════════════════════════════════════════════════════════════
   BOT DISCORD — avvio da solo
   ----------------------------------------------------------------------
   Serve SOLO se il bot dei contratti gira come processo suo. Se invece lo
   si vuole dentro un bot già esistente (stessa applicazione Discord, stesso
   processo), questo file non serve: basta, nel file principale di quel bot,

       const { attach } = require('./contratti');
       attach(client, { apiBase: process.env.PLUS_API_BASE, botToken: process.env.PLUS_BOT_TOKEN });

   Vedi README.md per quando conviene l'una o l'altra.

   Ambiente:
     DISCORD_TOKEN    token del bot Discord
     PLUS_API_BASE    https://warera-oracle.duckdns.org/warera-plus-api   (live)
                      https://warera-oracle.duckdns.org/warera-plus-api-dev (dev)
     PLUS_BOT_TOKEN   lo stesso BOT_TOKEN dell'istanza di plusApi scelta
     GUILD_ID         (facoltativo) registra i comandi solo in quel server
     TOOL_URL         (facoltativo) dove si collega l'account (default il live)

   ── L'INTENT `MessageContent` E' FACOLTATIVO, E NON PUO' FAR CADERE IL BOT ──
   La risposta automatica a "10m pro" scritto a mano legge i messaggi, e per
   questo serve l'intent PRIVILEGIATO MessageContent, che si abilita a mano
   nel portale (Bot → Privileged Gateway Intents). Se non e' abilitato Discord
   rifiuta il login con "Used disallowed intents": invece di restare in un
   ciclo di riavvii, si riprova SENZA quell'intent e il bot funziona come
   prima (comandi, bottoni, avvisi), dicendolo nel log.
   ══════════════════════════════════════════════════════════════════════ */

const { Client, GatewayIntentBits } = require('discord.js');
const { attach } = require('./contratti');

const { DISCORD_TOKEN, PLUS_API_BASE, PLUS_BOT_TOKEN, GUILD_ID, TOOL_URL } = process.env;
for (const [k, v] of Object.entries({ DISCORD_TOKEN, PLUS_API_BASE, PLUS_BOT_TOKEN })) {
  if (!v) { console.error(`Manca ${k} nell'ambiente.`); process.exit(1); }
}

async function avvia(conMessaggi) {
  // Comandi, bottoni e moduli non leggono messaggi: bastano gli intent di base.
  const intents = [GatewayIntentBits.Guilds];
  if (conMessaggi) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  const client = new Client({ intents });

  attach(client, {
    apiBase: PLUS_API_BASE,
    botToken: PLUS_BOT_TOKEN,
    guildId: GUILD_ID || undefined,
    toolUrl: TOOL_URL || undefined,
  });

  try {
    await client.login(DISCORD_TOKEN);
    console.log(`[bot] connesso${conMessaggi ? ' (con lettura dei messaggi: risposta automatica a "10m pro" attiva)' : ' (senza lettura dei messaggi)'}`);
  } catch (err) {
    // discord.js lo dice in due modi a seconda di dove cade l'errore: codice
    // `DisallowedIntents` ("Privileged intent provided is not enabled…") oppure
    // la chiusura 4014 del gateway ("Used disallowed intents").
    const intentNegato = err?.code === 'DisallowedIntents' || err?.code === 4014
      || /disallowed intents|privileged intent/i.test(String(err?.message || err));
    if (conMessaggi && intentNegato) {
      console.warn('[bot] Message Content Intent NON abilitato nel portale: parto senza. '
        + 'Per la risposta automatica a "10m pro": Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent, poi riavvia.');
      await client.destroy().catch(() => {});
      return avvia(false);
    }
    console.error('[bot] login fallito:', err);
    process.exit(1);
  }
  return client;
}

avvia(true);
