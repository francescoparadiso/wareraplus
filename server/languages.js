/* ═══════════════════════════════════════════════════════════════════════
   Dove una lingua è "di casa" nel mondo reale
   -----------------------------------------------------------------------
   Serve a UNA cosa sola, dentro server/proxyIndex.js: distinguere una
   lingua straniera da una lingua legittima.

   Il segnale "la lingua di chi governa" funziona così: si guarda la
   `preferences.locale` dei membri del governo di una nazione e si cerca
   quella che lì NON dovrebbe esserci. Il governo del Liechtenstein che
   gioca al 80% in italiano dice qualcosa; il governo svizzero che gioca al
   71% in tedesco non dice niente, perché in Svizzera il tedesco è di casa.

   Senza questa tabella Svizzera e Austria risulterebbero proxy tedeschi,
   la Moldova un proxy rumeno e il Belgio un proxy olandese: falsi positivi
   garantiti, tutti dovuti alla geografia linguistica reale.

   ⚠️ Il rovescio della medaglia, dichiarato: la tabella SPEGNE il segnale
   anche dove il proxy è vero ma la lingua è plausibile. Bosnia, Montenegro
   e Kosovo sono proxy serbi e il serbo lì è di casa — sono ciechi a questo
   segnale per costruzione, e vanno decisi con gli altri (composizione
   delle unità militari, e la storia delle cittadinanze quando c'è).
   Ex Jugoslavia e Moldova sono i casi in cui questa tabella costa più di
   quanto renda; ovunque altrove rende molto di più di quanto costi.

   Le lingue sono quelle che WarEra offre davvero (viste dal vivo sui
   profili: ar de el en es fr hr hu id it lt lv nl pl pt ro ru sr sv tr uk
   zh-Hant-TW, più 'meow' che è uno scherzo del gioco). I codici nazione
   sono ISO-3166 alpha-2 MAIUSCOLI, come `country.code` di WarEra una volta
   normalizzato.
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

/** locale → nazioni dove quella lingua è ufficiale o largamente parlata. */
const NATIVE = {
  de: 'DE AT CH LI LU BE',
  it: 'IT SM VA CH MT',
  es: 'ES MX AR CO VE PE CL EC GT CU BO DO HN PY SV NI CR PA UY GQ PR',
  pt: 'PT BR AO MZ GW CV ST TL',
  fr: 'FR BE CH CA LU MC HT SN CI ML BF NE TD CD CG GA CM BJ TG GN MG DJ RW BI KM VU',
  nl: 'NL BE SR',
  sr: 'RS BA ME XK',
  hr: 'HR BA',
  ro: 'RO MD',
  pl: 'PL',
  tr: 'TR CY AZ',
  id: 'ID MY BN',
  lv: 'LV',
  lt: 'LT',
  hu: 'HU RO SK',
  el: 'GR CY',
  uk: 'UA',
  ru: 'RU BY KZ KG UA MD AM AZ GE TJ TM UZ LV EE LT',
  sv: 'SE FI',
  ar: 'DZ BH KM DJ EG IQ JO KW LB LY MR MA OM PS QA SA SO SD SY TN AE YE TD ER IL',
  'zh-Hant-TW': 'TW CN SG MY',
};

const NATIVE_SETS = {};
for (const [locale, list] of Object.entries(NATIVE)) {
  NATIVE_SETS[locale] = new Set(list.split(' ').filter(Boolean));
}

/** Locali che NON dicono mai niente sulla provenienza di nessuno:
 *  l'inglese è il default dell'interfaccia e lo usa il 59% dei giocatori
 *  di tutto il mondo, 'meow' è uno scherzo, e l'assenza di dato non è
 *  un'informazione. */
const UNINFORMATIVE = new Set(['en', 'meow', '', null, undefined]);

function isUninformative(locale) {
  return UNINFORMATIVE.has(locale);
}

/**
 * La lingua `locale` è plausibile per un cittadino di `countryCode`?
 * Le lingue non informative sono plausibili ovunque per definizione, e una
 * lingua che non conosciamo si considera plausibile: nel dubbio non si
 * accusa nessuno.
 */
function isNativeLocale(locale, countryCode) {
  if (isUninformative(locale)) return true;
  const set = NATIVE_SETS[locale];
  if (!set) return true;
  return set.has(String(countryCode || '').toUpperCase());
}

/**
 * Le nazioni "casa" di una lingua, ordinate per popolazione attiva.
 *
 * Per lingue come l'italiano o il croato la prima è di fatto l'unica
 * risposta possibile. Per spagnolo, arabo, francese e portoghese NO: il
 * segnale linguistico identifica una COMUNITÀ, non una nazione, e
 * pretendere di nominare il patrono dalla sola lingua è l'errore che
 * farebbe finire Andorra e la Corea del Sud fra i proxy venezuelani
 * (misurato: succede davvero, il Venezuela è il paese ispanofono più
 * popoloso del gioco). Chi chiama questa funzione deve guardare
 * `ambiguous` e, se è vero, usare la lingua solo per CONFERMARE un
 * candidato che un altro segnale ha già proposto.
 *
 * @param {string} locale
 * @param {Array<{code: string, rankings: object}>} countries  da country.getAllCountries
 * @returns {{candidates: string[], ambiguous: boolean}} codici nazione
 */
function homelandsOf(locale, countries) {
  const set = NATIVE_SETS[locale];
  if (!set || isUninformative(locale)) return { candidates: [], ambiguous: true };

  const pop = c => c?.rankings?.countryActivePopulation?.value || 0;
  const ranked = countries
    .filter(c => set.has(String(c.code || '').toUpperCase()))
    .sort((a, b) => pop(b) - pop(a));

  if (!ranked.length) return { candidates: [], ambiguous: true };

  // Ambigua quando più di una nazione di quella lingua ha una popolazione
  // paragonabile alla prima: è lì che "la lingua è X" smette di voler dire
  // "il patrono è Y".
  const top = pop(ranked[0]);
  const rivals = ranked.filter(c => pop(c) >= top * 0.35).length;

  return {
    candidates: ranked.map(c => String(c.code).toUpperCase()),
    ambiguous: rivals > 1,
  };
}

module.exports = { NATIVE_SETS, isNativeLocale, isUninformative, homelandsOf };
