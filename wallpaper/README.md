# Sfondo WarEra+ per Wallpaper Engine

Questa cartella è lo sfondo che si pubblica sullo Steam Workshop. **Non
contiene il tool**: `index.html` carica il sito in un iframe con
`?wallpaper=1`, quindi ogni deploy del sito aggiorna anche lo sfondo e la
cartella si ripubblica solo se cambiano le proprietà (`project.json`) o
l'involucro stesso.

Cosa fa il sito in modalità sfondo: testata di `src/app/wallpaperMode.js`.
La cartella non entra nella build di Vite né nel deploy Vercel.

## File

- `index.html` — l'involucro: proprietà → URL all'avvio e `postMessage`
  dopo; pausa; attesa della rete all'avvio di Windows.
- `project.json` — titolo, descrizione, proprietà (con le etichette in
  inglese e italiano, le altre lingue di Wallpaper Engine ricadono
  sull'inglese).
- `preview.jpg` / `preview.gif` — **da aggiungere** prima di pubblicare
  (vedi sotto), e da dichiarare in `project.json` con `"preview"`.

## Provarlo nel browser

Con `npm run dev` attivo, Vite serve anche questa cartella:

```
http://localhost:5173/wallpaper/index.html?site=http://localhost:5173
```

`?site=` accetta solo `localhost`/`127.0.0.1` e Wallpaper Engine non lo
passa mai. Le proprietà si simulano dalla console:

```js
wallpaperPropertyListener.applyUserProperties({ view: { value: 'weeklyDamage' }, theme: { value: 'light' } });
wallpaperPropertyListener.setPaused(true);
```

## Provarlo in Wallpaper Engine

1. Copia la cartella in
   `…\steamapps\common\wallpaper_engine\projects\myprojects\wareraplus\`
   (oppure: editor → *Open wallpaper* → *Open from file* → `project.json`).
2. Le modifiche lato sito che non sono ancora su `main` si vedono mettendo
   la proprietà **Versione** su *Anteprima (dev)*: carica
   `wareraplus-dev.vercel.app`.
3. Da verificare la prima volta, perché dipendono da Wallpaper Engine e
   non dal codice:
   - che il link "Apri WarEra+ nel browser" si apra nel browser predefinito;
   - che le etichette delle proprietà compaiano tradotte (blocco
     `localization` di `project.json`) e che "Minuti per vista" compaia
     solo con la rotazione accesa (`condition`);
   - che i clic arrivino alla mappa (Wallpaper Engine → Impostazioni →
     *Input mouse* attivo).

## Pubblicare

1. Apri il progetto nell'editor di Wallpaper Engine.
2. Anteprima: una gif o un jpg quadrato (es. 512×512) della mappa con le
   battaglie accese. Mettila in questa cartella e aggiungi
   `"preview": "preview.gif"` a `project.json`.
3. *Share wallpaper on Workshop*: titolo, descrizione, tag (Type: Web),
   classificazione *Everyone*, visibilità (prima *Private* o *Friends
   only* per una prova). Al primo invio Steam chiede di accettare
   l'accordo del Workshop.
4. Dopo la prima pubblicazione l'editor scrive in `project.json` il
   `workshopid`: **va committato**, è quello che serve per aggiornare lo
   stesso elemento e per il contatore delle installazioni sul sito.

## Cose da sapere

- **Prima di pubblicare lo sfondo sul live** la modalità `?wallpaper=1`
  deve essere arrivata su `main`: lo sfondo carica
  `wareraplus.vercel.app`, e senza il codice nuovo vedrebbe il sito
  normale dentro un iframe.
- **La chiave API** dell'utente passa solo via `postMessage` verso
  l'origin esatto del sito, mai nell'URL, e resta in memoria. WarEra NON
  rifiuta una chiave sbagliata sulle procedure pubbliche (risponde 200
  come a un anonimo): la si verifica con una procedura protetta, vedi
  `src/shared/trpcProxy.js`.
- **Contatori**: con `?wallpaper=1` il sito non conta visite, non manda
  il battito degli "online" e non carica gli analytics. Un contatore
  dedicato agli sfondi è un passo successivo.
