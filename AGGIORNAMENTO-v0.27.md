# Aggiornamento WarEra v0.27 — cosa cambia per WarEra+

Ricognizione fatta il **2026-10-23**, prima del rilascio, confrontando le API
del server di prova del gioco (`https://apidev.warera.io`) con quelle del live
(`api6` / `api2`). Nessuna riga di codice è ancora stata cambiata: questo file
raccoglie cosa si è scoperto, cosa si romperà e cosa si potrà usare, così che
il lavoro di adeguamento parta da qui e non da una nuova ricognizione.

- Note ufficiali (provvisorie, possono cambiare fino al rilascio):
  <https://pub-31266a5fa8d34efda3dcc08969029abf.r2.dev/versions/v0.27/index.html>
- ⚠️ apidev è un **mondo separato**: id di nazioni, regioni, utenti e aziende
  sono diversi dal live (le nazioni lì sono nate il 2026-09-18). Non mescolare
  id fra i due.
- ⚠️ Per le procedure protette serve una chiave API **valida su apidev** (quella
  del live non vale). Non va mai scritta in un file del repo: se servirà al
  codice, passa da una variabile d'ambiente.

---

## 1. Il gioco in breve (dalle note)

- **Niente più mercato del lavoro.** Le aziende assumono *dipendenti* (NPC)
  con nome, età, statistiche (Produzione, Fortuna, Responsabilità), tratti (53),
  felicità, addestramento a carte, eventi (78), pensione a 65 anni.
  Lavorare per un altro giocatore si può solo da **manager** (un posto per
  azienda, pagato per punto di Gestione, +2% produzione per punto fino a +22%).
- **Salari automatici ogni ora**, e i soldi pagati ai dipendenti **escono dal
  gioco** (nuovo grande pozzo di moneta). Se non si paga l'ora intera, quell'ora
  non lavora nessuno.
- **Area relax** = limite di dipendenti: liv. 1 → 1, liv. 2 → 2, liv. 3 → 3.
- **Attrezzi** (6 tipi × 6 rarità, +3% → +65%), solo da cassette, non
  commerciabili, durano ~500 ore lavorate.
- **Abilità**: via Imprenditoria (punti rimborsati), arriva Leadership (dal
  liv. 10). Energia 30 → 100 + 10/liv., Produzione (lavoro in proprio)
  10 → 30 + 3/liv., Gestione non limita più le assunzioni: +2% per punto.
  Un reset gratuito per tutti.
- **Tipi di governo al posto delle etiche dei partiti** (7: Repubblica,
  Stato nazionalista, Fronte patriottico, Federazione, Plutocrazia,
  Autocrazia, Stato mercenario; tutte le nazioni partono da Provvisorio). Cambio per legge, 30 giorni di attesa;
  i limiti del tipo scattano subito (si esce dall'alleanza, cadono patti o
  nemico giurato, si licenziano i ministri…).
- **Partiti**: niente più etiche, niente più resistenza avviata da un partito.
- **Entrate della nazione**: via specializzazione, **giacimenti spenti**, le
  risorse strategiche non danno più bonus di produzione ma una rendita
  giornaliera pari allo sviluppo della nazione d'origine. Due tasse: sul
  reddito (salari dei dipendenti) e sui manager; **via la tassa sul lavoro in
  proprio**. Ogni 1% di tassa sul reddito costa 1 di felicità ai dipendenti.
  Regioni conquistate: il proprietario originale prende il 10% della tassa sul
  reddito. Nuova vista di gioco "Daily revenue". Un trasloco d'azienda gratis.
- **Mappa: 726 → 742 regioni**, nuova nazione **Maldive** (`mv`), confini e
  nomi nuovi (Brasile, India, Libia, Corea del Sud, Sudan, USA…), quattro
  capitali spostate, 36 collegamenti nuovi, **71 rimossi** — questi restano
  aperti 10 giorni dopo il rilascio, poi chiudono.
- Altro: sondaggi negli articoli, articoli salvati, preset di abilità,
  aiuto MU +1 salute, casse di legno ribilanciate, offerte di item a prezzo
  singolo, nessun obbligo di magazzino vuoto per cambiare prodotto.

---

## 2. Cosa cambia nelle API (misurato su apidev)

### Procedure

| Procedura | Esito su apidev | Note |
|---|---|---|
| `worker.getWorkers` | **404, non esiste più** | usata dall'Ottimizzatore |
| `employee.getCompanyRoster`, `employee.getMyWorkforceSummary` | **403 con chiave API** | solo sessione di gioco |
| `tool.getMine`, `employeeEvent.getMine`, `manager.getMyJob`, `managerOffer.getMyProfile`, `user.getMe` | **403 con chiave API** | idem |
| `company.getCompaniesCount`, `company.getActiveCompaniesCount`, `company.canProduceAll` | **403 con chiave API** | idem |
| `work.getStatsByCompany {companyId}`, `work.getStatsByUserId {userId}` | ✅ con chiave | 31 giorni; ogni giorno `{dailyDate, total, wage, employeeProd, selfWork, automatedEngine}` |
| `transaction.getPaginatedTransactions` | ✅ con chiave | enum dei tipi invariato (`applicationFee trading itemMarket wage donation articleTip openCase craftItem dismantleItem battleLoot countryMoneyTransfer`), ma **nessuna transazione `wage`** su dev: i salari escono dal gioco e non arrivano a nessun giocatore |
| `company.getRecommendedRegionIdsByItemCode` | ✅ con chiave, **sempre `[]`** | senza giacimenti né specializzazione non c'è più una regione "migliore" |
| `company.getProductionBonus` | pubblica, `{depositBonus:0, total:0}` | sparite le voci `strategicBonus`, `ethicSpecializationBonus`, `ethicDepositBonus` |
| `managerOffer.getWageStats {}` | pubblica | `{allowedRange:{min,max,average,source}, topOffer, topEligibleOffer}` — paga dei manager per punto di Gestione |
| `manager.getByCompanyId`, `managerOffer.getByCompanyId` | pubbliche | `null` se l'azienda non ha manager/offerta |
| `gameStat.getPpMoneyValue` | pubblica, **senza `input`** (con `{}` dà 400) | un numero, es. `0.1087` |
| `upgrade.getUpgradeByTypeAndEntity` | pubblica, invariata | |
| `itemTrading.getPrices`, `gameConfig.getDates` | invariate | |
| `party.getById` | invariata | `ethics` è **ancora presente** ma il gioco non la usa più |

**Conseguenza principale:** nessuno — né il browser con la chiave dell'utente,
né il VPS — può leggere i dipendenti di un giocatore (statistiche, tratti,
felicità, attrezzi). Tutto ciò che il tool potrà dire sulla produzione di
un'azienda passa da `work.getStatsBy*` e da `company.getById`.

### `country.getAllCountries`

- **Spariti**: `allies` (era già un fossile, vedi CLAUDE.md), `orgs`,
  `currentBattleOrder`.
- **Nuovi**:
  - `govType` (es. `"homelandFront"`) e `dates.govTypeChangedAt`;
  - `income: { development, strategicResourcesBonus, employeeIncomeTax,
    managerIncomeTax, govType, total }` — le entrate giornaliere della nazione,
    già scomposte.
- `taxes` ha ancora `{income, market, selfWork}`: `selfWork` resta nel dato
  anche se le note dicono che la tassa non esiste più.
- 180 → 181 nazioni (`mv` Maldive).

### `region.getRegionsObject`

- **Spariti**: `deposit`, `hasCoast`, `currentPopulation`.
- **Nuovi**: `income` (stessa forma di quella della nazione) e `companyCount`.
- 726 → 742 regioni.

### `map.getMapData`

- Nuovo campo `overseasLinks` (i collegamenti via mare, che la mappa di gioco
  ora disegna come linee).
- Geometrie: `regions` e `regionLabels` 742. `countryLabels` resta a 183
  (ricontato il 2026-10-26: il "da 192 a 110" scritto qui era sbagliato), ma
  le etichette perdono `textColor`, `strokeColor` e `specializedItem` e
  portano `scheme`: vedi la sezione 6.

### `company.getById`

- **Sparito `workerCount`.** Nuovo `freeMoves` (il trasloco gratuito).
  `activeUpgradeLevels` invariato.

### `gameConfig.getGameConfig`

- **Spariti**: `skills.entrepreneurship`, `worker.maxFidelity`,
  `worker.fidelityProductionBonusPercent`, `upgradesConfig.breakRoom.*.dailyHires`,
  i livelli 4 e 5 dell'area relax, `region.resourcesBonus`,
  `region.citizenIncomeTaxPercent`.
- **Nuovi**: `skills.leadership` (0 → 10, dal livello 10), i 36 attrezzi
  (`sickle|pickaxe|skillet|hammer|flask|caliper` 1–6, `dynamicStats.production`
  da `[3,6]` a `[46,65]`, `isTradable:false`), `items.toolbox`,
  `region.depositsEnabled: false`, `country.conqueredRegionCoreTaxPercent: 10`,
  `mu.helperHealthPerHelp: 1`, `user.skillPresets`, `user.featureUnlockLevels`
  (mercato 10, lavoro da manager 10, MU 15, partito 15).
- **Cambiati**: energia 30…130 → 100…200; produzione 10…40 → 30…60;
  gestione 4…24 → 1…11; area relax `maxWorkers` 2/4/6 → 1/2/3, acciaio
  10/20 → 20/80.
- ⚠️ La config **non** contiene le regole dei tipi di governo: i numeri sono
  solo nelle note.

---

## 3. Cosa si rompe nel tool

| Area | Perché | File |
|---|---|---|
| **Ottimizzatore industriale** | `worker.getWorkers` non esiste più; Imprenditoria, fedeltà e `dailyHires` spariti; area relax a 3 livelli; Gestione cambia significato. La parte **Lavoratori** non si può portare sui dipendenti (403); la parte **Posizione** perde la sua fonte (`getRecommendedRegionIdsByItemCode` = `[]`) | `src/eco/{skills,workers,wage,hiring,account,positioning,gameData,main}.js` |
| **Censimento aziende** (scheda Produzione) | filtra le aziende da interrogare su `company.getById.workerCount`, che non c'è più → non interrogherebbe nessuna azienda e mostrerebbe zero salari | `server/companyCensus.js` (riga ~261) |
| **Bonus produzione** (vista mappa + pannello) | specializzazione, giacimenti e bonus delle risorse strategiche spariti; la regola "industrialism = 2 → +30%" non vale più | `src/diplomacy/countryEthics.js`, `productionHeatmap.js`, `src/panel/viewOverview.js`, `countryPanel.js` |
| **Rendite di produzione** | il modello usa fedeltà, `taxes.selfWork`, specializzazione, giacimenti; cambiano produzione ed energia del lavoro in proprio | `src/market/model.js`, `src/market/main.js`, `src/market/i18n.js` |
| **Stile di gioco** (Guerra vs Eco) | conta i punti in Imprenditoria, che spariscono (rimborsati) | `src/mu/playstyle.js`, `server/warera-cache-server.js` |
| **Etiche dei partiti** | il dato c'è ancora ma non significa più niente | `src/political/party.js`, `countryEthics.js` |
| **Confini** (area riservata) | `hasCoast` sparito → "costa: false" ovunque | `server/plusApi/confini.js` (riga ~437) |
| **Alleati** | `allies` sparito; il codice usa già `|| []`, quindi non dà errori, e la fonte giusta resta `allianceId` | `src/proxy/radar.js`, `server/proxyIndex.js`, `src/political/senate.js`, `src/app/timeMachineMap.js` |
| **Mappa e nomi** | 16 regioni nuove, decine di nomi cambiati, `mv` nuova: va controllato tutto ciò che è scritto a mano per nome o id (etichette, ancore delle Operazioni, seed e archivi del server) | `src/diplomacy/labels.js`, `src/private/mappaOperazione.js`, `server/import/*` |
| **Operazioni / percorsi** | 71 collegamenti chiudono 10 giorni dopo il rilascio; `overseasLinks` è la fonte dei collegamenti via mare | `src/private/operazioni.js`, `mappaOperazione.js` |

Ancora valida, nessuna modifica: la sezione **Lavoro e tasse** (archivio chiuso,
29 lug → 17 set 2026).

---

## 4. Cosa arriva di nuovo e si può usare

Tutto pubblico, quasi tutto già dentro le due chiamate del boot (costo zero):

- **Tipo di governo** per nazione (`govType`, `govTypeChangedAt`): pannello
  nazione, vista mappa, filtri. Entra anche nei conti dell'area riservata
  (Stato mercenario: danno ×2 con gli ordini; Federazione: +5% per un alleato;
  Stato nazionalista: bonus patriottico 30% e nemico giurato fino al 15%…).
- **Entrate giornaliere** per nazione e per regione (`income`), già scomposte:
  vista mappa "Rendita giornaliera" (l'equivalente della "Daily revenue" del
  gioco), riga nel pannello nazione, classifica in Statistiche nazioni.
  Rende in gran parte superflua la parte "tasse sui salari" del censimento
  aziende: il gettito lo dà il gioco stesso.
- **`companyCount`** per regione: dove stanno le aziende.
- **`overseasLinks`**: collegamenti via mare per mappa e Operazioni.
- **Paga dei manager** (`managerOffer.getWageStats`) e valore dei punti
  produzione (`gameStat.getPpMoneyValue`): nuovi riferimenti per Rendite e
  Ottimizzatore.
- **Attrezzi** nella config: tabelle di bonus per rarità.
- **Statistiche di lavoro** (`work.getStatsBy*`, con chiave): produzione dei
  dipendenti, lavoro in proprio e motore automatico separati, giorno per giorno.

---

## 5. Piano proposto

1. **Interruttore `?api=dev`**, solo nel deploy dev/locale (mai in live): punta
   `API_BASE_URL` (e il proxy tRPC) su apidev, per provare il tool contro la
   v0.27 prima che esca.
2. **Le rotture, con fallback vecchia/nuova API**: il codice riconosce da solo
   la forma del dato (es. presenza di `govType` / `income`, assenza di
   `worker.getWorkers`), così lo stesso codice funziona prima e dopo il
   rilascio — le note dicono che i dettagli possono cambiare fino all'ultimo.
   - censimento: filtrare su `employeeProd > 0` da `work.getStatsByCompany`
     invece che su `workerCount`, oppure passare a `income.employeeIncomeTax`;
   - Bonus produzione: senza giacimenti né specializzazione la vista perde il
     suo oggetto → sostituirla (o affiancarla) con la Rendita giornaliera;
   - Rendite: togliere fedeltà e `selfWork`, nuovi valori di energia e
     produzione, salario = costo che esce dal gioco;
   - playstyle: escludere Imprenditoria e decidere come contare Leadership;
   - confini: `hasCoast` assente → non dire "senza costa" ma "non noto"
     (o ricavarlo da `overseasLinks`).
3. **Ottimizzatore da ripensare**, non da rattoppare: Competenze, Posizione e
   Assunzioni perdono senso così come sono; ciò che si vede da fuori sono le
   statistiche di lavoro. La card di attribuzione ad ArgusIA è stata tolta:
   della logica del bot non resta più niente.
   **Fatto in parte (branch `v0.27`, 2026-10-23):** schede **Aziende**
   (`src/eco/companies.js`: valore e costo del punto, margine dei dipendenti
   sugli ultimi 7 giorni interi, segnali perdita / giorni fermi / tendenza /
   magazzino pieno, barretta dei 31 giorni) e **Competenze**
   (`src/eco/skills.js`: Companies / Energy / Production / Management sul
   budget dei punti già in queste abilità; Leadership e combattimento non si
   toccano). Tolti Posizione, Lavoratori, Assunzioni e paga da lavoro.
   Restano da fare **Posizione** (tasse, battaglie, tipo di governo) e
   **Manager**. Per provarlo prima del rilascio: `?api=dev` su localhost o sul
   deploy dev, e la chiave di apidev nel campo che compare (resta in memoria).

   Cosa si è misurato scrivendolo, su un giocatore di apidev con 6 aziende:
   - il **salario è fisso a ora**, non a punto: col dipendente che migliora,
     il costo per punto scende (acciaio: 0,099 → 0,040 in due settimane);
   - un giorno con **meno ore lavorate** fa calare insieme punti e salari
     (21 ottobre, −40% su tutte le aziende), quindi la tendenza si misura in
     punti per moneta, non in punti;
   - con i prezzi di apidev il **calcare è in perdita** (0,050 di salario per
     un punto che vale 0,011): esattamente il caso che la scheda deve
     mostrare.
4. **Novità**: tipo di governo, Rendita giornaliera, entrate nel pannello.
5. **Il giorno del rilascio**: risondare le stesse procedure sul live (la
   ricognizione si rifà in pochi minuti confrontando `gameConfig`,
   `getAllCountries`, `getRegionsObject`, `getMapData`), rideploy del
   cache-server e di warera-plus-api se toccati.

---

## 6. Fatto il 2026-10-26 (branch `v0.27`, giorno del rilascio)

Tutto riconosce la versione **dal dato**, non dalla data: lo stesso codice
gira sul live di oggi (v0.26) e su quello di domani. Provato nel browser
innestando nella pagina i dati veri di apidev (nazioni e regioni per codice)
e, per le Rendite, con `?api=dev`.

**Risondato su apidev la mattina del rilascio** (cambiato dal 23/10):
- `country.getAllCountries`: spariti anche `strategicResources.bonuses` e la
  classifica `rankings.countryProductionBonus`; `taxes` è ora
  `{income, market, manager}` (via `selfWork`); `govType` manca del tutto
  sulle nazioni ancora Provvisorie. Su apidev mancano anche `allianceId`,
  `enemy`, `rulingParty`, `specializedItem`: probabilmente perché vuoti in un
  mondo nuovo, ma va ricontrollato sul live.
- ⚠️ **`income` è ORARIO**: `income.development` dell'Egitto = 0,5046 =
  sviluppo 12,11 ÷ 24, e la rendita di una risorsa strategica torna allo stesso
  modo ("giornaliera, pari allo sviluppo" nelle note). Il tool moltiplica per
  24 e mostra il giorno.
- `company.getById` non ha nessun campo che dica quanti dipendenti ci sono.
- `gameStat.getPpMoneyValue` vuole l'input **vuoto**: con `{}`, anche dentro un
  batch, risponde 400. Si chiama con una GET a parte.

**Le rotture:**
- **Censimento aziende** (`server/companyCensus.js`): senza `workerCount` le
  statistiche si chiedono per tutte le aziende (~114.000, ~4.600 blocchi da 25:
  un'ora in più di notte; il tetto di 500/min conta le richieste HTTP),
  elaborate blocco per blocco per non tenerle in RAM; "con dipendenti" =
  dipendenti che ieri hanno prodotto, numero dei dipendenti `null`,
  `coverage.workersKnown: false`. La scheda Produzione toglie la colonna e lo
  dice nella nota.
- **Bonus produzione → Rendita giornaliera** (`productionHeatmap.js` e i suoi
  agganci in `map.js`, `labels.js`, `ui.js`, `viewOverview.js`): stessa vista e
  stesso bottone, ma con `income` racconta la rendita del tesoro (scala a
  radice, cifre sulle nazioni, classifica con le voci, regioni più redditizie).
  Niente più richieste per le etiche.
- **Pannello nazione**: la casella del bonus diventa "Rendita / giorno"; la
  sezione delle etiche del partito diventa **Tipo di governo** (nome, effetti
  dalle note, da quando, fine dei 30 giorni di attesa).
- **Rendite di produzione** (`src/market/*`): modalità dipendenti. Costo per
  punto = valore del punto × aspettativa ÷ (1 + bonus), **aspettativa di
  pareggio** per risorsa, simulatore con Produzione / Aspettativa / Bonus al
  posto di paga, energia, fedeltà. Niente più chiamate alle regioni consigliate.
- **Statistiche nazioni**: la colonna "Bonus produzione" diventa "Rendita /
  giorno" (stessa chiave `prod`).
- **Political**: le etiche del partito non si mostrano più.
- **Stile di gioco**: Leadership conta come economia (client e server). ⚠️ Il
  reset gratuito del rilascio sembrerà un travaso nelle tendenze a 7 giorni.
- **Confini**: `costa` è `null` quando `hasCoast` manca, non `false`.
- **La mia nazione**: tasse con quella sui manager, tessere Rendita e Tipo di
  governo (servono i campi nuovi di `server/plusApi/nazione.js`).

**Serve il rideploy** di cache-server (censimento, stile di gioco) e
warera-plus-api (confini, la mia nazione). Senza, il resto funziona: il
censimento resterebbe sul filtro vecchio e, dopo il rilascio, a zero
dipendenti.

**Secondo giro, lo stesso giorno:**
- **Colori dei nomi sulla mappa**: le etichette di `map.getMapData` non hanno
  più `textColor`/`strokeColor` (solo `scheme`). Il nome si colora schiarendo
  il colore di gioco della nazione (`gameColors.js: lightenForLabel`, prima
  privata della time machine); `strokeColor` assente non entra più né nella
  mappa colori né in `nationBaseColorMap`.
- **Bonus di battaglia per tipo di governo** (`src/shared/battleBonus.js`):
  patriottico 30/15/10 per Stato nazionalista/Federazione/Plutocrazia,
  Federazione +5% per un alleato, Fronte patriottico +5% al bunker (stimato:
  solo dove il bunker c'è), Stato mercenario ordini ×2 finché la capitale non
  è occupata. Numeri dalle note: la config del gioco non li ha.
- **Guida**: la vista Rendita giornaliera nell'elenco delle viste, governo e
  rendita nel pannello, terzo punto dell'Ottimizzatore.

**Non fatto:** Posizione e Manager dell'Ottimizzatore; una vista mappa per
tipo di governo; i nomi delle regioni scritti a mano (etichette, ancore delle
Operazioni, archivi importati) e gli `overseasLinks`, da controllare sul live
dopo il rilascio.
