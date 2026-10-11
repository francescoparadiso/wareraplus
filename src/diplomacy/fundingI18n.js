/* ══════════════════════════════════════════════════════════════
   WarEra+ — Traduzioni della vista mappa "Finanziamenti" (fundingFlows.js)
   ------------------------------------------------------------------
   Stesso schema di migrationI18n.js: la CHIAVE è il testo inglese, una
   traduzione mancante ricade sull'inglese. Variabili fra graffe.
   Riga = [it, es, de, fr, nl, sv, pt, ar].
   ══════════════════════════════════════════════════════════════ */

import { getLang } from '../shared/i18n.js';

const ORDINE = ['it', 'es', 'de', 'fr', 'nl', 'sv', 'pt', 'ar'];

const T = {
  'Funding': ['Finanziamenti', 'Financiación', 'Finanzierung', 'Financements', 'Financiering', 'Finansiering', 'Financiamentos', 'التمويل'],
  'Money sent from treasury to treasury. Gold: nations receiving more than they send; violet: nations sending more than they receive. Click a nation to see who funds it and whom it funds.': [
    'Il denaro mandato da tesoro a tesoro. Oro: nazioni che ricevono più di quanto mandano; viola: nazioni che mandano più di quanto ricevono. Clicca una nazione per vedere chi la finanzia e chi finanzia lei.',
    'El dinero enviado de tesoro a tesoro. Oro: naciones que reciben más de lo que envían; violeta: naciones que envían más de lo que reciben. Haz clic en una nación para ver quién la financia y a quién financia.',
    'Geld, das von Staatskasse zu Staatskasse geschickt wird. Gold: Nationen, die mehr erhalten als senden; Violett: Nationen, die mehr senden als erhalten. Klicke auf eine Nation, um zu sehen, wer sie finanziert und wen sie finanziert.',
    'L’argent envoyé de trésor à trésor. Or : nations qui reçoivent plus qu’elles n’envoient ; violet : nations qui envoient plus qu’elles ne reçoivent. Clique sur une nation pour voir qui la finance et qui elle finance.',
    'Geld dat van schatkist naar schatkist wordt gestuurd. Goud: naties die meer ontvangen dan ze sturen; violet: naties die meer sturen dan ze ontvangen. Klik op een natie om te zien wie haar financiert en wie zij financiert.',
    'Pengar som skickas från statskassa till statskassa. Guld: nationer som tar emot mer än de skickar; violett: nationer som skickar mer än de tar emot. Klicka på en nation för att se vem som finansierar den och vem den finansierar.',
    'O dinheiro enviado de tesouro para tesouro. Dourado: nações que recebem mais do que enviam; violeta: nações que enviam mais do que recebem. Clica numa nação para ver quem a financia e quem ela financia.',
    'الأموال المرسلة من خزينة إلى خزينة. ذهبي: دول تتلقى أكثر مما ترسل؛ بنفسجي: دول ترسل أكثر مما تتلقى. انقر على دولة لترى من يمولها ومن تموّل.'],
  'Click a nation to see who funds it.': ['Clicca una nazione per vedere chi la finanzia.', 'Haz clic en una nación para ver quién la financia.', 'Klicke auf eine Nation, um zu sehen, wer sie finanziert.', 'Clique sur une nation pour voir qui la finance.', 'Klik op een natie om te zien wie haar financiert.', 'Klicka på en nation för att se vem som finansierar den.', 'Clica numa nação para ver quem a financia.', 'انقر على دولة لترى من يمولها.'],
  'Tap a nation to see who funds it.': ['Tocca una nazione per vedere chi la finanzia.', 'Toca una nación para ver quién la financia.', 'Tippe auf eine Nation, um zu sehen, wer sie finanziert.', 'Touche une nation pour voir qui la finance.', 'Tik op een natie om te zien wie haar financiert.', 'Tryck på en nation för att se vem som finansierar den.', 'Toca numa nação para ver quem a financia.', 'المس دولة لترى من يمولها.'],
  'Window': ['Finestra', 'Ventana', 'Zeitraum', 'Fenêtre', 'Periode', 'Period', 'Janela', 'الفترة'],
  '{n} days': ['{n} giorni', '{n} días', '{n} Tage', '{n} jours', '{n} dagen', '{n} dagar', '{n} dias', '{n} يومًا'],
  'All': ['Tutto', 'Todo', 'Alles', 'Tout', 'Alles', 'Allt', 'Tudo', 'الكل'],
  'Money moved': ['Denaro mosso', 'Dinero movido', 'Bewegtes Geld', 'Argent transféré', 'Verplaatst geld', 'Flyttade pengar', 'Dinheiro movido', 'الأموال المحوّلة'],
  'Transfers': ['Bonifici', 'Transferencias', 'Überweisungen', 'Virements', 'Overboekingen', 'Överföringar', 'Transferências', 'التحويلات'],
  'Receiving': ['Ricevono', 'Reciben', 'Erhalten', 'Reçoivent', 'Ontvangen', 'Tar emot', 'Recebem', 'تتلقى'],
  'Giving': ['Danno', 'Dan', 'Geben', 'Donnent', 'Geven', 'Ger', 'Dão', 'تعطي'],
  'Receive the most': ['Ricevono di più', 'Reciben más', 'Erhalten am meisten', 'Reçoivent le plus', 'Ontvangen het meest', 'Tar emot mest', 'Recebem mais', 'الأكثر تلقيًا'],
  'Give the most': ['Danno di più', 'Dan más', 'Geben am meisten', 'Donnent le plus', 'Geven het meest', 'Ger mest', 'Dão mais', 'الأكثر عطاءً'],
  'Biggest flows': ['Flussi principali', 'Flujos principales', 'Größte Ströme', 'Principaux flux', 'Grootste stromen', 'Största flöden', 'Maiores fluxos', 'أكبر التدفقات'],
  'received {i} · sent {o}': ['ricevuti {i} · mandati {o}', 'recibido {i} · enviado {o}', 'erhalten {i} · gesendet {o}', 'reçu {i} · envoyé {o}', 'ontvangen {i} · gestuurd {o}', 'mottaget {i} · skickat {o}', 'recebido {i} · enviado {o}', 'تلقّت {i} · أرسلت {o}'],
  '{n} transfers': ['{n} bonifici', '{n} transferencias', '{n} Überweisungen', '{n} virements', '{n} overboekingen', '{n} överföringar', '{n} transferências', '{n} تحويلات'],
  '1 transfer': ['1 bonifico', '1 transferencia', '1 Überweisung', '1 virement', '1 overboeking', '1 överföring', '1 transferência', 'تحويل واحد'],
  '← All nations': ['← Tutte le nazioni', '← Todas las naciones', '← Alle Nationen', '← Toutes les nations', '← Alle naties', '← Alla nationer', '← Todas as nações', '← كل الدول'],
  'Received': ['Ricevuti', 'Recibido', 'Erhalten', 'Reçu', 'Ontvangen', 'Mottaget', 'Recebido', 'المتلقّى'],
  'Sent': ['Mandati', 'Enviado', 'Gesendet', 'Envoyé', 'Gestuurd', 'Skickat', 'Enviado', 'المُرسَل'],
  'Balance': ['Saldo', 'Saldo', 'Saldo', 'Solde', 'Saldo', 'Netto', 'Saldo', 'الرصيد'],
  'Arrows': ['Frecce', 'Flechas', 'Pfeile', 'Flèches', 'Pijlen', 'Pilar', 'Setas', 'الأسهم'],
  'Incoming': ['In arrivo', 'Entrantes', 'Eingehend', 'Entrants', 'Inkomend', 'Inkommande', 'A entrar', 'الواردة'],
  'Outgoing': ['In uscita', 'Salientes', 'Ausgehend', 'Sortants', 'Uitgaand', 'Utgående', 'A sair', 'الصادرة'],
  'Both': ['Entrambi', 'Ambos', 'Beides', 'Les deux', 'Beide', 'Båda', 'Ambos', 'كلاهما'],
  'Who funds it': ['Chi la finanzia', 'Quién la financia', 'Wer sie finanziert', 'Qui la finance', 'Wie haar financiert', 'Vem som finansierar den', 'Quem a financia', 'من يمولها'],
  'Whom it funds': ['Chi finanzia lei', 'A quién financia', 'Wen sie finanziert', 'Qui elle finance', 'Wie zij financiert', 'Vem den finansierar', 'Quem ela financia', 'من تموّل'],
  '{p}% of what it received': ['{p}% di quanto ha ricevuto', '{p}% de lo recibido', '{p}% des Erhaltenen', '{p}% de ce qu’elle a reçu', '{p}% van wat ze ontving', '{p}% av det mottagna', '{p}% do que recebeu', '{p}% مما تلقّت'],
  '{p}% of what it sent': ['{p}% di quanto ha mandato', '{p}% de lo enviado', '{p}% des Gesendeten', '{p}% de ce qu’elle a envoyé', '{p}% van wat ze stuurde', '{p}% av det skickade', '{p}% do que enviou', '{p}% مما أرسلت'],
  'No transfers in this window.': ['Nessun bonifico in questa finestra.', 'Ninguna transferencia en esta ventana.', 'Keine Überweisungen in diesem Zeitraum.', 'Aucun virement sur cette période.', 'Geen overboekingen in deze periode.', 'Inga överföringar under perioden.', 'Nenhuma transferência nesta janela.', 'لا تحويلات في هذه الفترة.'],
  'No transfers to or from this nation in this window.': ['Nessun bonifico da o verso questa nazione in questa finestra.', 'Ninguna transferencia desde o hacia esta nación en esta ventana.', 'Keine Überweisungen von oder an diese Nation in diesem Zeitraum.', 'Aucun virement depuis ou vers cette nation sur cette période.', 'Geen overboekingen van of naar deze natie in deze periode.', 'Inga överföringar till eller från denna nation under perioden.', 'Nenhuma transferência de ou para esta nação nesta janela.', 'لا تحويلات من هذه الدولة أو إليها في هذه الفترة.'],
  'The archive starts on {date}: earlier transfers do not show up.': ['L’archivio comincia il {date}: i bonifici di prima non risultano.', 'El archivo empieza el {date}: las transferencias anteriores no aparecen.', 'Das Archiv beginnt am {date}: frühere Überweisungen erscheinen nicht.', 'L’archive commence le {date} : les virements antérieurs n’apparaissent pas.', 'Het archief begint op {date}: eerdere overboekingen staan er niet in.', 'Arkivet börjar {date}: tidigare överföringar syns inte.', 'O arquivo começa em {date}: as transferências anteriores não aparecem.', 'يبدأ الأرشيف في {date}: التحويلات السابقة لا تظهر.'],
  'Cache server unreachable: only the last few days the game remembers.': ['Server di cache irraggiungibile: solo gli ultimi giorni che il gioco ricorda.', 'Servidor de caché inaccesible: solo los últimos días que el juego recuerda.', 'Cache-Server nicht erreichbar: nur die letzten Tage, an die sich das Spiel erinnert.', 'Serveur de cache injoignable : seulement les derniers jours dont le jeu se souvient.', 'Cacheserver onbereikbaar: alleen de laatste dagen die het spel onthoudt.', 'Cacheservern går inte att nå: bara de senaste dagarna som spelet minns.', 'Servidor de cache inacessível: só os últimos dias de que o jogo se lembra.', 'تعذّر الوصول إلى خادم التخزين المؤقت: فقط الأيام الأخيرة التي تتذكرها اللعبة.'],
  'Loading…': ['Caricamento…', 'Cargando…', 'Wird geladen…', 'Chargement…', 'Laden…', 'Laddar…', 'A carregar…', 'جارٍ التحميل…'],
  'Transfers are not available right now — reopen this view to retry.': ['I bonifici non sono disponibili in questo momento: riapri la vista per riprovare.', 'Las transferencias no están disponibles ahora: vuelve a abrir la vista para reintentar.', 'Überweisungen sind gerade nicht verfügbar – öffne die Ansicht erneut.', 'Les virements ne sont pas disponibles pour l’instant : rouvre la vue pour réessayer.', 'Overboekingen zijn nu niet beschikbaar — open de weergave opnieuw.', 'Överföringar är inte tillgängliga just nu – öppna vyn igen.', 'As transferências não estão disponíveis agora — reabre a vista.', 'التحويلات غير متاحة الآن — أعد فتح العرض للمحاولة مجددًا.'],
  'Open the nation panel': ['Apri la scheda nazione', 'Abrir el panel de la nación', 'Nationspanel öffnen', 'Ouvrir le panneau de la nation', 'Natiepaneel openen', 'Öppna nationspanelen', 'Abrir o painel da nação', 'افتح لوحة الدولة'],
};

/** Testo tradotto; la chiave È l'inglese, che fa da ripiego. */
export function fT(chiave, vars) {
  const i = ORDINE.indexOf(getLang());
  let s = (i >= 0 && T[chiave]?.[i]) || chiave;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
