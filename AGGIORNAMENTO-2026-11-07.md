# Aggiornamento WarEra del 7 novembre 2026 — cosa cambia per WarEra+

Il gioco si è aggiornato il **7 novembre 2026 verso le 15:20 UTC** (è l'ora
di `appointedAt` di tutti i ministri migrati). Ricognizione e adeguamento
fatti l'**8 novembre**, sul live (`api6`), partendo dall'elenco di RealMarijn
su Discord e dalle note del rilascio, e ricontrollando ogni punto sui dati.

---

## 1. Il gioco in breve (dalle note)

- **Risorse strategiche**: non pagano più soldi, danno abilità a ogni
  cittadino, condivise nell'alleanza. 1 / 4 / 9 copie = livello 1 / 2 / 3.
  Per livello: terre rare +3 Produzione, oro +1 Gestione, litio +10 Energia,
  carbone +5 Precisione, diamanti +10 Salute, uranio +2 Probabilità di
  bottino (le note dicevano rendita di sviluppo, l'API dice bottino).
  Cooldown delle alleanze spento fino al 15 novembre 00:00 UTC.
- **Gradi militari**: bonus danno raddoppiato (Capitano +40%, Comandante
  supremo +75%). `skills.attack.militaryRankPercent` è già raddoppiato.
- **Tipi di governo**: via **Stato nazionalista** e **Stato mercenario** (le
  nazioni tornano Provvisorie), attesa di 30 giorni azzerata una volta.
- **Congresso eletto da liste di partito** (il capo del partito ordina la
  lista, si vota un partito, i seggi scendono la lista).
- **Ministri**: via i tre posti fissi, il presidente ne nomina fino a 20
  (titoli: Difesa, Economia, Esteri, Interno, Comunicazione, Capo di
  gabinetto, Consigliere, più un titolo libero), con diritti che decide lui.
  Paga: presidente 5% dello sviluppo, vice 2,5%, ministri niente.
- Altro: sviluppo ×2 sulle regioni invece che sulla rendita, guide pagate a
  passi, ricompense giornaliere raddoppiate, tipo di governo preferito dei
  partiti (solo indicativo), prestigiati contati come livello 50.

## 2. Cosa cambia nelle API (misurato l'8 novembre)

| Dove | Cambio | Peso per il tool |
|---|---|---|
| `user.getUserLite` | **niente più `skills`** | ⚠️ alto: stile di gioco, colpo dei nemici, barre vita/fame, profilo |
| `user.getUserById` | ha tutto quello di getUserLite **più** `skills`; `skills.<x>.level` NON contiene più il livello del prestigio (sta in `.prestige`), `strategic` = bonus delle risorse; `leveling.prestige` = punti prestigio non spesi | ~6 KB contro ~2,7; 50 per GET passano, 100 → 414 |
| `government.getByCountryId` | **`ministers: [{user, title, customTitle?, rights[], appointedAt, badgeGrantedAt?}]`** al posto di `minOfDefense/ForeignAffairs/Economy` (restano, coerenti, su 4 governi su 181) | ⚠️ alto: area riservata, Votazioni, Political, pannello |
| `government.getCongressSeats {countryId}` | nuova: `[{user, party?, hasLeftParty}]` | non usata |
| `country.getStrategicResourceBonuses {countryId}` / `alliance.getStrategicResourceBonuses {allianceId}` | nuove, pubbliche: `{allianceId, countryIds, regionIds:{risorsa:[id]}, bonuses:{skills, developmentPercent}}`; `null` senza alleanza né risorse | usata dal pannello |
| `country.getAllCountries` | `income.strategicResourcesBonus` = 0 ovunque; `taxes` = `{income, market, manager}`; `dates.lastAllianceLeftAt` | rendita: voce a zero |
| `party.getById` | via `ethics`; nuovi `favoriteGovType`, `primaryWinner`, `councilMembers`, `members` | Political: tipo preferito |
| `gameConfig.government` | `{nominationCooldownDays:5, presidentWagePercent:5, vicePresidentWagePercent:2.5}` | — |
| `gameConfig.alliance` | `leaveCooldownDisabledUntil: 2026-11-15` | — |
| `workOffer.*`, `worker.*`, `work.getStatsByWorker*` | 404 | non usate |
| `contribution.*`, `shop.getTopGiftGivers`, `article.stats.gemTips`, `managerOffer.citizenship` | cambiati/spariti | non usati |

Titoli dei ministri visti su 181 governi: minOfDefense 190, minOfForeignAffairs
162, minOfEconomy 161, advisor 109, chiefOfStaff 68, minOfInterior 65,
minOfCommunication 51 (fino a 14 ministri in una nazione, titoli ripetuti).
Diritti: setOrders, openBattle, upgradeRegion, manageMercenaryContracts,
manageMercenaryContractProposals, manageResistance, manageInventory,
manageCitizenshipApplications, pinArticle, pinMessage, postAnnouncement,
registerTournament.

**Entrate per tipo di governo** riverificate su `income.govType`:
Repubblica = sviluppo proprie − conquistate (ora ci sono Repubbliche con
conquiste e torna: Argentina, Australia, Mauritania, Pakistan); Autocrazia
+25% sviluppo; **Plutocrazia +100% delle tasse** (era 40%: 14 su 18 entro
l'1%).

**Risorse strategiche**: il calcolo locale (alleanze da `allianceId`, copie
da `strategicResources.resources`) torna identico all'endpoint su 167
nazioni su 181; le altre sono 8 senza niente e 6 di un'alleanza in cui un
membro non ha ancora `allianceId` nella lista nazioni.

## 3. Cosa si è rotto, e cosa è stato fatto

| Area | Rottura | Correzione |
|---|---|---|
| **Area riservata** (`server/plusApi/roles.js`) | un ministro non veniva più riconosciuto: niente accesso a La mia nazione, Operazioni, Accordi | `governo.js` nuovo; carica dal titolo; **approva i contratti chi ha il diritto `manageMercenaryContracts`** (non più "il ministro della difesa"); tutti i ministri sono governo |
| **La mia nazione** (`nazione.js` server e client) | elenco del governo coi tre posti vuoti | governo intero coi titoli personalizzati; etichette nuove in 9 lingue |
| **Votazioni** (`votazioni.js`) | il corpo elettorale "congresso + governo" perdeva i ministri | elenco intero |
| **Storico governi** (`politicalHistory.js`) | dal 7 novembre registrava "tutti i ministri usciti" | `r` resta (primo ministro dei tre titoli storici) + `m` = elenco intero; le righe fantasma dopo il 7 novembre si tolgono da sole alla prima lettura nuova; Political e Giocatori leggono `m` |
| **Indice proxy** (`proxyIndex.js`) | governo ridotto a presidente e vice | ministri dall'elenco |
| **Pannello nazione, Political, Giocatori** | governo con soli presidente e vice | `src/shared/government.js`; tutti i ministri, titoli del presidente |
| **Stile di gioco** (cache-server) | ⚠️ ogni giocatore riletto diventava "senza punti spesi" (Italia: 307 su 307) | il giro usa `getUserById` a blocchi da 50; senza skills non si sovrascrive; i campioni dello storico fra il 7 nov 15:00 UTC e un'ora dopo il deploy si tolgono |
| **Colpo dei nemici** (cache-server `citizenStats` [8], [13..16]; `plusApi/nemici.js`) | attacco/precisione/critici nulli | `getUserById` |
| **Scheda unità, Tornei, Statistiche nazioni (ripiego), Giocatori, Ottimizzatore** | niente colonne attacco/critico, stile, barre vita/fame, abilità | `getUserById` |
| **Political: stile nei partiti e nella scheda giocatore** | pallini spariti | `/users-lite` del cache-server porta ora `ps`; `primePlaystyles` in `links.js` |
| **Profilo giocatore** | livello prestigio letto dal campo sbagliato | `prestigeLevel`; i livelli `prestige` delle abilità accanto al livello |
| **Entrate per tipo di governo** | Stato nazionalista nel confronto, Plutocrazia al 40% | tolto; 100%; testi aggiornati |

Nuovo: **sezione "Risorse strategiche"** nel pannello nazione (copie
dell'alleanza e proprie, livello, bonus, copie che mancano al livello dopo),
e il **tipo di governo preferito** nella scheda partito di Political.

## 4. Da fare / non verificabile ancora

- **Elezioni del congresso a liste**: l'ultima (Italia, 6 novembre) è ancora
  nella forma vecchia, a voti per candidato. Come arriveranno voti e seggi
  nella forma nuova si vede solo alla prossima elezione: da ricontrollare
  `election.getElection` (`candidates`, `votes`) per il simulatore del
  congresso, lo storico politico e gli articoli.
- Il **bonus del grado militare** non è calcolato da nessuna parte nel tool
  (l'attacco si legge già totale): niente da cambiare, ma va saputo per gli
  articoli.
- Area riservata: l'elenco ruoli per le deroghe (`src/private/admin.js`) ha
  ancora i soli tre titoli storici (bastano per concedere l'approvazione).
- **Deploy**: servono cache-server (`warera-cache-server.js`,
  `politicalHistory.js`, `proxyIndex.js`) e warera-plus-api (`governo.js`
  nuovo, `roles.js`, `nazione.js`, `votazioni.js`, `nemici.js`).
