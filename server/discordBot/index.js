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
   ══════════════════════════════════════════════════════════════════════ */

const { Client, GatewayIntentBits } = require('discord.js');
const { attach } = require('./contratti');

const { DISCORD_TOKEN, PLUS_API_BASE, PLUS_BOT_TOKEN, GUILD_ID, TOOL_URL } = process.env;
for (const [k, v] of Object.entries({ DISCORD_TOKEN, PLUS_API_BASE, PLUS_BOT_TOKEN })) {
  if (!v) { console.error(`Manca ${k} nell'ambiente.`); process.exit(1); }
}

// Solo `Guilds`: comandi, bottoni e autocompletamento non leggono messaggi,
// quindi nessun intent privilegiato da abilitare nel portale.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

attach(client, {
  apiBase: PLUS_API_BASE,
  botToken: PLUS_BOT_TOKEN,
  guildId: GUILD_ID || undefined,
  toolUrl: TOOL_URL || undefined,
});

client.login(DISCORD_TOKEN);
