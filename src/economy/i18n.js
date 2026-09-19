/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: dizionario della SEZIONE
   ------------------------------------------------------------------
   Solo le etichette dello scheletro (titolo, tre schede) e della scheda
   NUOVA, i Prezzi. Le altre due schede portano il loro dizionario da
   prima e non lo perdono: `src/market/i18n.js` per le Rendite, i testi
   dentro `src/eco/main.js` per l'Ottimizzatore. Unire anche quelli
   sarebbe un diff enorme dentro codice che funziona, per zero vantaggi
   all'utente — la regola del repo è che le etichette usate da una vista
   sola stanno in un dizionario di quella vista.
   ══════════════════════════════════════════════════════════════ */

const DICT = {
  en: {
    title: 'Economy', subtitle: 'Prices, production yields and the industrial optimizer, in one place.',
    tabPrices: 'Goods prices', tabYields: 'Production yields', tabOptimizer: 'Industrial optimizer',
    pricesTitle: 'Goods prices', pricesSub: 'What every resource is worth now, and where that price comes from.',
    search: 'Search a resource…', loading: 'Loading prices…', empty: 'No resource to show.',
    resource: 'Resource', price: 'Price', buyAt: 'Buy at', sellAt: 'Sell at', spread: 'Spread',
    d1: '24h', d7: '7d', d30: '30d', range: 'Range',
    r30: '30 days', r90: '90 days', r365: '1 year', rAll: 'All',
    candles: 'Candles', line: 'Close', updated: 'Updated', refresh: 'Refresh', refreshing: 'Updating…',
    noHistory: 'The price archive is not reachable right now: only the current price is left.',
    coverage: 'The archive starts on {d} — before that nobody was recording.',
    noSeries: 'Not enough candles yet to draw a trend.',
    open: 'Open', high: 'High', low: 'Low', close: 'Close', samples: 'samples',
    raw: 'Raw', product: 'Product', thin: 'Only {n} units at this price',
    gap: 'A day with no candle is a gap, never a zero: the line breaks.',
    backToList: 'All resources', sortBy: 'Sort by', noBook: 'No orders',
  },
  it: {
    title: 'Economia', subtitle: 'Prezzi, rendite di produzione e ottimizzatore industriale, in un posto solo.',
    tabPrices: 'Prezzi dei beni', tabYields: 'Rendite di produzione', tabOptimizer: 'Ottimizzatore industriale',
    pricesTitle: 'Prezzi dei beni', pricesSub: 'Quanto vale adesso ogni risorsa, e da dove viene quel prezzo.',
    search: 'Cerca una risorsa…', loading: 'Carico i prezzi…', empty: 'Nessuna risorsa da mostrare.',
    resource: 'Risorsa', price: 'Prezzo', buyAt: 'Compri a', sellAt: 'Vendi a', spread: 'Forbice',
    d1: '24h', d7: '7g', d30: '30g', range: 'Periodo',
    r30: '30 giorni', r90: '90 giorni', r365: '1 anno', rAll: 'Tutto',
    candles: 'Candele', line: 'Chiusure', updated: 'Aggiornato', refresh: 'Aggiorna', refreshing: 'Aggiorno…',
    noHistory: "L'archivio dei prezzi non è raggiungibile adesso: resta il prezzo di questo momento.",
    coverage: "L'archivio parte dal {d} — prima di allora non stava guardando nessuno.",
    noSeries: 'Non ci sono ancora abbastanza candele per disegnare un andamento.',
    open: 'Apertura', high: 'Massimo', low: 'Minimo', close: 'Chiusura', samples: 'campioni',
    raw: 'Materia prima', product: 'Prodotto', thin: 'Solo {n} pezzi a questo prezzo',
    gap: 'Un giorno senza candela è un buco, mai uno zero: la linea si spezza.',
    backToList: 'Tutte le risorse', sortBy: 'Ordina per', noBook: 'Nessun ordine',
  },
  es: {
    title: 'Economía', subtitle: 'Precios, rendimientos de producción y optimizador industrial, en un solo sitio.',
    tabPrices: 'Precios de bienes', tabYields: 'Rendimientos de producción', tabOptimizer: 'Optimizador industrial',
    pricesTitle: 'Precios de bienes', pricesSub: 'Cuánto vale ahora cada recurso, y de dónde viene ese precio.',
    search: 'Buscar un recurso…', loading: 'Cargando precios…', empty: 'Ningún recurso que mostrar.',
    resource: 'Recurso', price: 'Precio', buyAt: 'Compras a', sellAt: 'Vendes a', spread: 'Horquilla',
    d1: '24h', d7: '7d', d30: '30d', range: 'Periodo',
    r30: '30 días', r90: '90 días', r365: '1 año', rAll: 'Todo',
    candles: 'Velas', line: 'Cierres', updated: 'Actualizado', refresh: 'Actualizar', refreshing: 'Actualizando…',
    noHistory: 'El archivo de precios no está disponible ahora: queda el precio actual.',
    coverage: 'El archivo empieza el {d} — antes nadie estaba mirando.',
    noSeries: 'Aún no hay suficientes velas para dibujar una tendencia.',
    open: 'Apertura', high: 'Máximo', low: 'Mínimo', close: 'Cierre', samples: 'muestras',
    raw: 'Materia prima', product: 'Producto', thin: 'Solo {n} unidades a este precio',
    gap: 'Un día sin vela es un hueco, nunca un cero: la línea se corta.',
    backToList: 'Todos los recursos', sortBy: 'Ordenar por', noBook: 'Sin órdenes',
  },
  de: {
    title: 'Wirtschaft', subtitle: 'Preise, Produktionserträge und Industrie-Optimierer an einem Ort.',
    tabPrices: 'Warenpreise', tabYields: 'Produktionserträge', tabOptimizer: 'Industrie-Optimierer',
    pricesTitle: 'Warenpreise', pricesSub: 'Was jede Ressource jetzt wert ist – und woher der Preis kommt.',
    search: 'Ressource suchen…', loading: 'Preise werden geladen…', empty: 'Keine Ressource anzuzeigen.',
    resource: 'Ressource', price: 'Preis', buyAt: 'Kaufst du für', sellAt: 'Verkaufst du für', spread: 'Spanne',
    d1: '24 Std', d7: '7 T', d30: '30 T', range: 'Zeitraum',
    r30: '30 Tage', r90: '90 Tage', r365: '1 Jahr', rAll: 'Alles',
    candles: 'Kerzen', line: 'Schlusskurse', updated: 'Aktualisiert', refresh: 'Aktualisieren', refreshing: 'Aktualisiere…',
    noHistory: 'Das Preisarchiv ist gerade nicht erreichbar: es bleibt der aktuelle Preis.',
    coverage: 'Das Archiv beginnt am {d} — davor hat niemand mitgeschrieben.',
    noSeries: 'Noch zu wenige Kerzen für einen Verlauf.',
    open: 'Eröffnung', high: 'Hoch', low: 'Tief', close: 'Schluss', samples: 'Messungen',
    raw: 'Rohstoff', product: 'Produkt', thin: 'Nur {n} Stück zu diesem Preis',
    gap: 'Ein Tag ohne Kerze ist eine Lücke, nie eine Null: die Linie bricht ab.',
    backToList: 'Alle Ressourcen', sortBy: 'Sortieren nach', noBook: 'Keine Aufträge',
  },
  fr: {
    title: 'Économie', subtitle: 'Prix, rendements de production et optimiseur industriel, au même endroit.',
    tabPrices: 'Prix des biens', tabYields: 'Rendements de production', tabOptimizer: 'Optimiseur industriel',
    pricesTitle: 'Prix des biens', pricesSub: "Ce que vaut chaque ressource maintenant, et d'où vient ce prix.",
    search: 'Chercher une ressource…', loading: 'Chargement des prix…', empty: 'Aucune ressource à afficher.',
    resource: 'Ressource', price: 'Prix', buyAt: 'Tu achètes à', sellAt: 'Tu vends à', spread: 'Écart',
    d1: '24 h', d7: '7 j', d30: '30 j', range: 'Période',
    r30: '30 jours', r90: '90 jours', r365: '1 an', rAll: 'Tout',
    candles: 'Chandeliers', line: 'Clôtures', updated: 'Mis à jour', refresh: 'Actualiser', refreshing: 'Actualisation…',
    noHistory: "L'archive des prix est injoignable : il reste le prix actuel.",
    coverage: "L'archive commence le {d} — avant, personne ne regardait.",
    noSeries: 'Pas encore assez de chandeliers pour tracer une tendance.',
    open: 'Ouverture', high: 'Haut', low: 'Bas', close: 'Clôture', samples: 'relevés',
    raw: 'Matière première', product: 'Produit', thin: 'Seulement {n} unités à ce prix',
    gap: 'Un jour sans chandelier est un trou, jamais un zéro : la ligne se coupe.',
    backToList: 'Toutes les ressources', sortBy: 'Trier par', noBook: 'Aucun ordre',
  },
  nl: {
    title: 'Economie', subtitle: 'Prijzen, productieopbrengsten en de industriële optimizer op één plek.',
    tabPrices: 'Goederenprijzen', tabYields: 'Productieopbrengsten', tabOptimizer: 'Industriële optimizer',
    pricesTitle: 'Goederenprijzen', pricesSub: 'Wat elke grondstof nu waard is, en waar die prijs vandaan komt.',
    search: 'Zoek een grondstof…', loading: 'Prijzen laden…', empty: 'Geen grondstof om te tonen.',
    resource: 'Grondstof', price: 'Prijs', buyAt: 'Je koopt voor', sellAt: 'Je verkoopt voor', spread: 'Spread',
    d1: '24u', d7: '7d', d30: '30d', range: 'Periode',
    r30: '30 dagen', r90: '90 dagen', r365: '1 jaar', rAll: 'Alles',
    candles: 'Kaarsen', line: 'Slotkoersen', updated: 'Bijgewerkt', refresh: 'Vernieuwen', refreshing: 'Bijwerken…',
    noHistory: 'Het prijsarchief is nu niet bereikbaar: alleen de huidige prijs blijft over.',
    coverage: 'Het archief begint op {d} — daarvoor keek niemand mee.',
    noSeries: 'Nog te weinig kaarsen voor een verloop.',
    open: 'Open', high: 'Hoog', low: 'Laag', close: 'Slot', samples: 'metingen',
    raw: 'Grondstof', product: 'Product', thin: 'Maar {n} stuks tegen deze prijs',
    gap: 'Een dag zonder kaars is een gat, nooit een nul: de lijn breekt.',
    backToList: 'Alle grondstoffen', sortBy: 'Sorteer op', noBook: 'Geen orders',
  },
  sv: {
    title: 'Ekonomi', subtitle: 'Priser, produktionsavkastning och industrioptimeraren på ett ställe.',
    tabPrices: 'Varupriser', tabYields: 'Produktionsavkastning', tabOptimizer: 'Industrioptimerare',
    pricesTitle: 'Varupriser', pricesSub: 'Vad varje resurs är värd nu, och varifrån priset kommer.',
    search: 'Sök en resurs…', loading: 'Laddar priser…', empty: 'Ingen resurs att visa.',
    resource: 'Resurs', price: 'Pris', buyAt: 'Du köper för', sellAt: 'Du säljer för', spread: 'Spread',
    d1: '24 tim', d7: '7 d', d30: '30 d', range: 'Period',
    r30: '30 dagar', r90: '90 dagar', r365: '1 år', rAll: 'Allt',
    candles: 'Ljus', line: 'Stängning', updated: 'Uppdaterad', refresh: 'Uppdatera', refreshing: 'Uppdaterar…',
    noHistory: 'Prisarkivet går inte att nå nu: bara dagens pris återstår.',
    coverage: 'Arkivet börjar {d} — innan dess tittade ingen.',
    noSeries: 'Ännu för få ljus för att rita en trend.',
    open: 'Öppning', high: 'Högsta', low: 'Lägsta', close: 'Stängning', samples: 'mätningar',
    raw: 'Råvara', product: 'Produkt', thin: 'Bara {n} enheter till det här priset',
    gap: 'En dag utan ljus är ett hål, aldrig en nolla: linjen bryts.',
    backToList: 'Alla resurser', sortBy: 'Sortera efter', noBook: 'Inga order',
  },
  pt: {
    title: 'Economia', subtitle: 'Preços, rendimentos de produção e otimizador industrial, num só sítio.',
    tabPrices: 'Preços dos bens', tabYields: 'Rendimentos de produção', tabOptimizer: 'Otimizador industrial',
    pricesTitle: 'Preços dos bens', pricesSub: 'Quanto vale agora cada recurso, e de onde vem esse preço.',
    search: 'Procurar um recurso…', loading: 'A carregar preços…', empty: 'Nenhum recurso a mostrar.',
    resource: 'Recurso', price: 'Preço', buyAt: 'Compras a', sellAt: 'Vendes a', spread: 'Diferencial',
    d1: '24h', d7: '7d', d30: '30d', range: 'Período',
    r30: '30 dias', r90: '90 dias', r365: '1 ano', rAll: 'Tudo',
    candles: 'Velas', line: 'Fechos', updated: 'Atualizado', refresh: 'Atualizar', refreshing: 'A atualizar…',
    noHistory: 'O arquivo de preços não está acessível agora: fica o preço atual.',
    coverage: 'O arquivo começa a {d} — antes disso ninguém estava a registar.',
    noSeries: 'Ainda não há velas suficientes para desenhar uma tendência.',
    open: 'Abertura', high: 'Máximo', low: 'Mínimo', close: 'Fecho', samples: 'amostras',
    raw: 'Matéria-prima', product: 'Produto', thin: 'Apenas {n} unidades a este preço',
    gap: 'Um dia sem vela é um buraco, nunca um zero: a linha parte-se.',
    backToList: 'Todos os recursos', sortBy: 'Ordenar por', noBook: 'Sem ordens',
  },
  ar: {
    title: 'الاقتصاد', subtitle: 'الأسعار وعوائد الإنتاج والمُحسِّن الصناعي في مكان واحد.',
    tabPrices: 'أسعار السلع', tabYields: 'عوائد الإنتاج', tabOptimizer: 'مُحسِّن صناعي',
    pricesTitle: 'أسعار السلع', pricesSub: 'كم تساوي كل مادة الآن، ومن أين جاء هذا السعر.',
    search: 'ابحث عن مادة…', loading: 'جارٍ تحميل الأسعار…', empty: 'لا توجد مادة لعرضها.',
    resource: 'المادة', price: 'السعر', buyAt: 'تشتري بـ', sellAt: 'تبيع بـ', spread: 'الفارق',
    d1: '٢٤ س', d7: '٧ أيام', d30: '٣٠ يوم', range: 'المدة',
    r30: '٣٠ يوماً', r90: '٩٠ يوماً', r365: 'سنة', rAll: 'الكل',
    candles: 'شموع', line: 'الإغلاق', updated: 'محدَّث', refresh: 'تحديث', refreshing: 'جارٍ التحديث…',
    noHistory: 'أرشيف الأسعار غير متاح الآن: يبقى سعر هذه اللحظة.',
    coverage: 'يبدأ الأرشيف في {d} — قبل ذلك لم يكن أحد يسجّل.',
    noSeries: 'لا توجد شموع كافية بعد لرسم الاتجاه.',
    open: 'الافتتاح', high: 'الأعلى', low: 'الأدنى', close: 'الإغلاق', samples: 'عيّنات',
    raw: 'مادة خام', product: 'منتج', thin: 'فقط {n} قطعة بهذا السعر',
    gap: 'يوم بلا شمعة هو فجوة وليس صفراً: الخط ينقطع.',
    backToList: 'كل المواد', sortBy: 'ترتيب حسب', noBook: 'لا أوامر',
  },
};

function lang() {
  const l = (localStorage.getItem('we_lang') || navigator.language || 'en').slice(0, 2).toLowerCase();
  return DICT[l] ? l : 'en';
}

/** `ecoT('coverage', { d: '9 apr' })` — stessa firma dei dizionari locali
 *  delle altre viste (mu, nations, battles, market). */
export function ecoT(key, vars) {
  const d = DICT[lang()] || DICT.en;
  let s = d[key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
