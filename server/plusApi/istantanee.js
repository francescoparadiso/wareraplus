/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — i numeri di una nazione, un'ora dopo l'altra
   ----------------------------------------------------------------------
   Le tessere in cima alla scheda nazione portano una freccia: di quanto
   è cambiato quel numero, e rispetto a quando. Per il tesoro e i
   giocatori attivi la storia c'è già (il ticker del cache-server li
   registra da due settimane); per tutto il resto — sviluppo, danno per
   cittadino, bonus produzione, disordini, tasse, e le POSIZIONI in
   classifica — il gioco dà solo il valore di adesso, e ieri non esiste
   da nessuna parte.

   Quindi questo file fotografa, una volta all'ora, i numeri della scheda
   di ogni nazione a cui l'area è aperta (nazioni.js), dalla cache
   `countries` del cache-server: nessuna chiamata a WarEra. Alle :15,
   dopo il ricalcolo orario delle classifiche (hh:01) e il poll delle :10
   che lo contiene.

   ⚠️ Come ogni storia che si accumula (bonifici, ricchezza delle unità,
   danno orario): parte dal primo avvio. Finché non ha 24 ore la freccia
   confronta con la fotografia più VECCHIA che c'è, e dice quale — "da
   ieri" e "dalle 16:15" non sono la stessa promessa e non si scambiano.
   ══════════════════════════════════════════════════════════════════════ */

const { paesiMappa } = require('./fonti');
const { nazioniAmmesse } = require('./nazioni');
const { salvaIstantanea, istantaneaVicina, istantaneaPiuVecchia, potaIstantanee } = require('./db');

const ORA_MS = 3600_000;
const RETENTION_MS = 35 * 24 * ORA_MS;
const MINUTO_SCATTO = 15;

/** I numeri della scheda, dal documento nazione del gioco. Stessi campi
 *  che formaPaese() mette nelle tessere; `R` = posizione in classifica. */
function estrai(n) {
  const r = n?.rankings || {};
  const v = (x) => (x == null ? null : x);
  return {
    tesoro: v(r.countryWealth?.value), tesoroR: v(r.countryWealth?.rank),
    attivi: v(r.countryActivePopulation?.value), attiviR: v(r.countryActivePopulation?.rank),
    sviluppo: v(r.countryDevelopment?.value), sviluppoR: v(r.countryDevelopment?.rank),
    dannoSett: v(r.weeklyCountryDamages?.value), dannoSettR: v(r.weeklyCountryDamages?.rank),
    perCitt: v(r.weeklyCountryDamagesPerCitizen?.value), perCittR: v(r.weeklyCountryDamagesPerCitizen?.rank),
    bonusProd: v(r.countryProductionBonus?.value), bonusProdR: v(r.countryProductionBonus?.rank),
    disordini: n?.unrest?.barMax ? Math.round((n.unrest.bar / n.unrest.barMax) * 1000) / 10 : null,
    tassaReddito: v(n?.taxes?.income), tassaMercato: v(n?.taxes?.market), tassaProprio: v(n?.taxes?.selfWork),
    popolazione: v(n?.currentPopulation),
  };
}

let _ultimo = null;

async function scatta() {
  try {
    const paesi = await paesiMappa();
    const at = Date.now();
    let n = 0;
    for (const id of nazioniAmmesse()) {
      const paese = paesi.get(id);
      if (!paese) continue;
      salvaIstantanea(id, at, estrai(paese));
      n += 1;
    }
    potaIstantanee(at - RETENTION_MS);
    _ultimo = { at, nazioni: n };
  } catch (err) {
    console.error('[istantanee] fotografia fallita:', err.message);
  }
}

function initIstantanee() {
  // Una subito (dopo un minuto, che la cache sia calda), poi ogni ora al
  // minuto :15. setTimeout che si riprogramma da sé: un setInterval da
  // un'ora partito alle 14:37 scatterebbe per sempre alle :37.
  const prossima = () => {
    const d = new Date();
    const t = new Date(d); t.setUTCMinutes(MINUTO_SCATTO, 0, 0);
    if (t <= d) t.setUTCHours(t.getUTCHours() + 1);
    setTimeout(() => { scatta().finally(prossima); }, t - d).unref();
  };
  setTimeout(scatta, 60_000).unref();
  prossima();
}

function statoIstantanee() {
  return _ultimo ? { ultima: new Date(_ultimo.at).toISOString(), nazioni: _ultimo.nazioni } : null;
}

/**
 * Il riferimento per le frecce: la fotografia di ~24 ore fa se c'è (entro
 * due ore), altrimenti la più vecchia purché abbia almeno 50 minuti — una
 * freccia "rispetto a cinque minuti fa" non direbbe niente.
 */
function riferimento(countryId, ora = Date.now()) {
  return istantaneaVicina(countryId, ora - 24 * ORA_MS, 2 * ORA_MS)
    || istantaneaPiuVecchia(countryId, ora - 50 * 60_000);
}

module.exports = { initIstantanee, statoIstantanee, estrai, riferimento };
