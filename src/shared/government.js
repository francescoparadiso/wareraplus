/* ═══════════════════════════════════════════════════════════════════════
   GOVERNO — chi siede in governo, da government.getByCountryId
   -----------------------------------------------------------------------
   Fino al 7 novembre 2026 il governo aveva tre ministri FISSI, uno per
   campo (`minOfDefense`, `minOfEconomy`, `minOfForeignAffairs`), e ogni
   vista del tool li leggeva per nome: pannello nazione, Political
   (congresso e senato), scheda giocatore. Con l'aggiornamento di quel
   giorno il presidente nomina fino a 20 ministri e la risposta porta un
   ELENCO:

     ministers: [{ user, title, customTitle?, rights: [...], appointedAt }]

   `title` è uno di sette (misurati su 181 governi l'8 novembre), e più
   persone possono avere lo stesso; `customTitle` è il titolo che il
   presidente scrive a mano ("Vice Ministro degli Esteri"). I tre campi
   vecchi restano su 4 governi su 181, coerenti con l'elenco: si leggono
   solo se `ministers` manca, così lo stesso codice gira su tutte e due le
   forme. Stesse regole lato server in `server/plusApi/governo.js`.

   Le etichette stanno qui e non nei dizionari delle viste perché sono le
   stesse ovunque: un titolo nuovo si aggiunge in un posto solo.
   ═══════════════════════════════════════════════════════════════════════ */

import { getLang } from './i18n.js';

export const MINISTER_TITLES = [
  'minOfDefense', 'minOfForeignAffairs', 'minOfEconomy', 'minOfInterior',
  'minOfCommunication', 'chiefOfStaff', 'advisor',
];
const LEGACY_FIELDS = ['minOfDefense', 'minOfForeignAffairs', 'minOfEconomy'];

const LABELS = {
  en: { president: 'President', vicePresident: 'Vice president', minOfDefense: 'Minister of defence', minOfForeignAffairs: 'Minister of foreign affairs', minOfEconomy: 'Minister of economy', minOfInterior: 'Minister of the interior', minOfCommunication: 'Minister of communication', chiefOfStaff: 'Chief of staff', advisor: 'Advisor', minister: 'Minister' },
  it: { president: 'Presidente', vicePresident: 'Vicepresidente', minOfDefense: 'Ministro della difesa', minOfForeignAffairs: 'Ministro degli esteri', minOfEconomy: 'Ministro dell’economia', minOfInterior: 'Ministro dell’interno', minOfCommunication: 'Ministro della comunicazione', chiefOfStaff: 'Capo di gabinetto', advisor: 'Consigliere', minister: 'Ministro' },
  es: { president: 'Presidente', vicePresident: 'Vicepresidente', minOfDefense: 'Ministro de defensa', minOfForeignAffairs: 'Ministro de exteriores', minOfEconomy: 'Ministro de economía', minOfInterior: 'Ministro del interior', minOfCommunication: 'Ministro de comunicación', chiefOfStaff: 'Jefe de gabinete', advisor: 'Asesor', minister: 'Ministro' },
  de: { president: 'Präsident', vicePresident: 'Vizepräsident', minOfDefense: 'Verteidigungsminister', minOfForeignAffairs: 'Außenminister', minOfEconomy: 'Wirtschaftsminister', minOfInterior: 'Innenminister', minOfCommunication: 'Kommunikationsminister', chiefOfStaff: 'Stabschef', advisor: 'Berater', minister: 'Minister' },
  fr: { president: 'Président', vicePresident: 'Vice-président', minOfDefense: 'Ministre de la défense', minOfForeignAffairs: 'Ministre des affaires étrangères', minOfEconomy: 'Ministre de l’économie', minOfInterior: 'Ministre de l’intérieur', minOfCommunication: 'Ministre de la communication', chiefOfStaff: 'Chef de cabinet', advisor: 'Conseiller', minister: 'Ministre' },
  nl: { president: 'President', vicePresident: 'Vicepresident', minOfDefense: 'Minister van defensie', minOfForeignAffairs: 'Minister van buitenlandse zaken', minOfEconomy: 'Minister van economie', minOfInterior: 'Minister van binnenlandse zaken', minOfCommunication: 'Minister van communicatie', chiefOfStaff: 'Stafchef', advisor: 'Adviseur', minister: 'Minister' },
  sv: { president: 'President', vicePresident: 'Vicepresident', minOfDefense: 'Försvarsminister', minOfForeignAffairs: 'Utrikesminister', minOfEconomy: 'Ekonomiminister', minOfInterior: 'Inrikesminister', minOfCommunication: 'Kommunikationsminister', chiefOfStaff: 'Stabschef', advisor: 'Rådgivare', minister: 'Minister' },
  pt: { president: 'Presidente', vicePresident: 'Vice-presidente', minOfDefense: 'Ministro da defesa', minOfForeignAffairs: 'Ministro dos negócios estrangeiros', minOfEconomy: 'Ministro da economia', minOfInterior: 'Ministro da administração interna', minOfCommunication: 'Ministro da comunicação', chiefOfStaff: 'Chefe de gabinete', advisor: 'Conselheiro', minister: 'Ministro' },
  ar: { president: 'الرئيس', vicePresident: 'نائب الرئيس', minOfDefense: 'وزير الدفاع', minOfForeignAffairs: 'وزير الخارجية', minOfEconomy: 'وزير الاقتصاد', minOfInterior: 'وزير الداخلية', minOfCommunication: 'وزير الاتصال', chiefOfStaff: 'رئيس الديوان', advisor: 'مستشار', minister: 'وزير' },
};

/** Il nome di una carica nella lingua di chi guarda. */
export function governmentRoleLabel(role, lang = getLang()) {
  const d = LABELS[lang] || LABELS.en;
  return d[role] || LABELS.en[role] || d.minister;
}

const titleOrder = (t) => {
  const i = MINISTER_TITLES.indexOf(t);
  return i < 0 ? MINISTER_TITLES.length : i;
};

/** I ministri, nella forma nuova anche se il dato è vecchio. */
export function governmentMinisters(gov) {
  if (!gov) return [];
  if (Array.isArray(gov.ministers)) {
    return gov.ministers
      .filter(m => m && m.user)
      .map(m => ({ user: m.user, title: m.title || 'advisor', customTitle: m.customTitle || null, rights: m.rights || [] }))
      .sort((a, b) => titleOrder(a.title) - titleOrder(b.title));
  }
  return LEGACY_FIELDS.filter(k => gov[k]).map(k => ({ user: gov[k], title: k, customTitle: null, rights: [] }));
}

/** Presidente, vice e ministri in quest'ordine (il congresso no).
 *  `role` è 'president' | 'vicePresident' | un titolo di ministro;
 *  `label` è già tradotto, col titolo personalizzato se c'è. */
export function governmentMembers(gov, lang = getLang()) {
  if (!gov) return [];
  const out = [];
  if (gov.president) out.push({ user: gov.president, role: 'president', customTitle: null });
  if (gov.vicePresident) out.push({ user: gov.vicePresident, role: 'vicePresident', customTitle: null });
  for (const m of governmentMinisters(gov)) out.push({ user: m.user, role: m.title, customTitle: m.customTitle });
  return out.map(m => ({ ...m, label: m.customTitle || governmentRoleLabel(m.role, lang) }));
}

/** Gli id di chi è al governo (senza doppioni). */
export function governmentUserIds(gov) {
  return [...new Set(governmentMembers(gov).map(m => m.user))];
}
