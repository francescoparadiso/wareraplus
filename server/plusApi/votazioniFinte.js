/* ══════════════════════════════════════════════════════════════════════
   VOTAZIONI FINTE — per provare emiciclo e urna
   ----------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): due votazioni finte, una palese e
   una segreta, per guardare le animazioni dello scrutinio senza aspettare
   una votazione vera. Crea le due votazioni (titolo "[PROVA]", esito
   pubblico), fotografa il congresso VERO della nazione come farebbe
   l'apertura, e mette voti finti a nome di ~85% dei membri (gli altri
   restano "non ha votato", per vedere anche i seggi spenti). Le urne
   chiudono fra `--tra` minuti; lo scrutinio parte un minuto dopo, e il
   processo in esecuzione lo sigilla da sé.

   ⚠️ SOLO sul database dev: con WP_ENV=live o una DATA_DIR che finisce in
   "data" si rifiuta. I voti finti stanno nel database come quelli veri,
   e sul live finirebbero nell'archivio di una nazione vera.

   Sul VPS, nella cartella del processo, con il dev in esecuzione:
     DATA_DIR=./data-dev WP_ENV=dev node --disable-warning=ExperimentalWarning votazioniFinte.js --tra 3
   Opzioni: --nazione <id> (predefinita: Italia), --tra <minuti> (3).
   ══════════════════════════════════════════════════════════════════════ */

const path = require('path');

const arg = (nome, predefinito) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : predefinito;
};

const dataDir = path.resolve(process.env.DATA_DIR || '');
if (process.env.WP_ENV === 'live' || !process.env.DATA_DIR || path.basename(dataDir) === 'data') {
  console.error('Rifiuto: le votazioni finte vanno solo nel database dev (DATA_DIR=./data-dev, WP_ENV=dev).');
  process.exit(1);
}

const db = require('./db');
const vot = require('./votazioni');

const NAZIONE = arg('nazione', '6813b6d446e731854c7ac7a2');
const TRA_MIN = Math.max(1, Number(arg('tra', 3)) || 3);
const NOTE = [
  'Il testo non dice da dove si prendono i soldi',
  'Prima serve un accordo con gli alleati',
  'Votazione convocata troppo in fretta',
];

/** Un voto finto: più sì che no, qualche astenuto e qualche nulla. */
function sceltaFinta(i) {
  const x = ((i * 7919) % 100) / 100;
  if (x < 0.52) return 'si';
  if (x < 0.82) return 'no';
  if (x < 0.93) return 'astenuto';
  return 'nulla';
}

async function crea(titolo, ballot) {
  const ora = Date.now();
  const v = db.creaVotazione({
    country_id: NAZIONE,
    title: `[PROVA] ${titolo}`,
    body: 'Votazione finta, creata da votazioniFinte.js per provare l\'animazione dello scrutinio. I voti non sono veri.',
    electorate: 'congresso', ballot, visibility: 'pubblico', majority: 'semplice', quorum_pct: null,
    opens_at: ora - 60_000, closes_at: ora + TRA_MIN * 60_000,
    created_by: null, created_war_user: null, created_name: 'votazioniFinte.js',
  });
  await vot._apri(v);
  const elettori = db.elettoriDi(v.id);
  let votati = 0;
  elettori.forEach((e, i) => {
    if (i % 7 === 6) return; // ~1 su 7 non vota
    const scelta = sceltaFinta(i + (ballot === 'segreto' ? 3 : 0));
    db.registraVoto(v.id, {
      warUserId: e.war_user_id, nome: e.name, scelta,
      nota: scelta === 'nulla' ? NOTE[i % NOTE.length] : null,
      segreto: ballot === 'segreto',
    });
    votati++;
  });
  const chiude = new Date(v.closes_at);
  console.log(`#${v.id} ${ballot}: ${votati} voti su ${elettori.length}, chiude alle ${chiude.toLocaleTimeString('it-IT')}, scrutinio alle ${new Date(v.closes_at + 60_000).toLocaleTimeString('it-IT')}`);
  return v;
}

(async () => {
  db.initDb();
  await crea('Emiciclo: legge sulla leva', 'palese');
  await crea('Urna: fiducia al governo', 'segreto');
  console.log('Fatto. Aprile in Political → Votazioni.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
