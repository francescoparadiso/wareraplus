/* ══════════════════════════════════════════════════════════════════════
   GOVERNO — chi siede in governo, letto da government.getByCountryId
   ----------------------------------------------------------------------
   Fino al 7 novembre 2026 il governo aveva tre ministri FISSI, uno per
   campo: `minOfDefense`, `minOfForeignAffairs`, `minOfEconomy`. Con
   l'aggiornamento di quel giorno il presidente nomina fino a 20 ministri,
   e la risposta porta un elenco:

     ministers: [{ user, title, customTitle?, rights: [...], appointedAt,
                   badgeGrantedAt? }]

   - `title` è uno di sette (misurato su 181 governi l'8 novembre):
     minOfDefense, minOfEconomy, minOfForeignAffairs, minOfInterior,
     minOfCommunication, chiefOfStaff, advisor. Più persone possono avere
     lo STESSO titolo (due ministri della difesa in Uzbekistan).
   - `rights` sono i poteri veri, che il presidente cambia a piacere:
     setOrders, openBattle, upgradeRegion, manageMercenaryContracts,
     manageMercenaryContractProposals, manageResistance, manageInventory,
     manageCitizenshipApplications, pinArticle, pinMessage,
     postAnnouncement, registerTournament.
   - I tre campi vecchi restano su 4 governi su 181, coerenti con
     l'elenco: sono un fossile. Si leggono SOLO se `ministers` manca, così
     lo stesso codice gira sul dato di prima e su quello di adesso.

   Un modulo solo perché le stesse tre domande ("chi è al governo", "che
   carica ha questa persona", "può fare X") le fanno roles.js, nazione.js,
   votazioni.js e fonti.js: con tre campi fissi bastava scriverli in un
   array in ogni file, con un elenco no.
   ══════════════════════════════════════════════════════════════════════ */

// L'ordine conta solo per mostrare UNA carica quando una persona ne ha più
// d'una, e per mettere in fila il governo nelle viste.
const TITOLI_MINISTRO = [
  'minOfDefense', 'minOfForeignAffairs', 'minOfEconomy', 'minOfInterior',
  'minOfCommunication', 'chiefOfStaff', 'advisor',
];
const CAMPI_VECCHI = ['minOfDefense', 'minOfForeignAffairs', 'minOfEconomy'];

// Diritti predefiniti dei tre titoli di prima: servono solo quando il dato
// è nella forma vecchia (senza `rights`), per non togliere l'approvazione
// dei contratti al ministro della difesa.
const DIRITTI_VECCHI = {
  minOfDefense: ['setOrders', 'openBattle', 'upgradeRegion', 'manageMercenaryContracts', 'manageMercenaryContractProposals', 'manageResistance'],
  minOfForeignAffairs: ['setOrders', 'openBattle'],
  minOfEconomy: ['manageInventory', 'manageMercenaryContracts', 'manageMercenaryContractProposals'],
};

const ordineTitolo = (t) => {
  const i = TITOLI_MINISTRO.indexOf(t);
  return i < 0 ? TITOLI_MINISTRO.length : i;
};

/** I ministri, nella forma nuova anche se il dato è vecchio. */
function ministri(gov) {
  if (!gov) return [];
  if (Array.isArray(gov.ministers)) {
    return gov.ministers
      .filter((m) => m && m.user)
      .map((m) => ({
        user: m.user,
        title: m.title || 'advisor',
        customTitle: m.customTitle || null,
        rights: Array.isArray(m.rights) ? m.rights : (DIRITTI_VECCHI[m.title] || []),
        appointedAt: m.appointedAt || null,
      }))
      .sort((a, b) => ordineTitolo(a.title) - ordineTitolo(b.title));
  }
  return CAMPI_VECCHI.filter((k) => gov[k]).map((k) => ({
    user: gov[k], title: k, customTitle: null, rights: DIRITTI_VECCHI[k], appointedAt: null,
  }));
}

/** Presidente, vice e ministri, in quest'ordine (il congresso no: è
 *  parlamento). `carica` è 'president' | 'vicePresident' | un titolo. */
function membriGoverno(gov) {
  if (!gov) return [];
  const out = [];
  if (gov.president) out.push({ user: gov.president, carica: 'president', customTitle: null, rights: null });
  if (gov.vicePresident) out.push({ user: gov.vicePresident, carica: 'vicePresident', customTitle: null, rights: null });
  for (const m of ministri(gov)) out.push({ user: m.user, carica: m.title, customTitle: m.customTitle, rights: m.rights });
  return out;
}

/** Gli id di chi è al governo (senza doppioni). */
function idGoverno(gov) {
  return [...new Set(membriGoverno(gov).map((m) => m.user))];
}

/** La carica più alta di questa persona, o 'congress', o null. */
function caricaDi(gov, userId) {
  if (!gov || !userId) return null;
  const m = membriGoverno(gov).find((x) => x.user === userId);
  if (m) return m.carica;
  return (gov.congressMembers || []).includes(userId) ? 'congress' : null;
}

/** La voce del ministro (con titolo personalizzato e diritti), o null. */
function ministroDi(gov, userId) {
  return ministri(gov).find((m) => m.user === userId) || null;
}

/** Presidente e vice hanno tutti i diritti; un ministro quelli che porta. */
function haDiritto(gov, userId, diritto) {
  if (!gov || !userId) return false;
  if (gov.president === userId || gov.vicePresident === userId) return true;
  return ministri(gov).some((m) => m.user === userId && m.rights.includes(diritto));
}

const eCaricaDiGoverno = (c) => c === 'president' || c === 'vicePresident' || TITOLI_MINISTRO.includes(c);

module.exports = {
  TITOLI_MINISTRO, ministri, membriGoverno, idGoverno, caricaDi, ministroDi, haDiritto, eCaricaDiGoverno,
};
