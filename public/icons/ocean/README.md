# Immagini nave/mostro marino/relitto/onde

Queste immagini sono state incollate in chat (non salvate su disco), quindi
vanno aggiunte qui a mano, con **questi nomi esatti**:

- `ship.png` — il veliero (usato sia come icona animata sulle rotte
  commerciali del tema scuro, sia come easter egg statico sul tema chiaro).
  Ha sfondo bianco pieno: viene reso trasparente automaticamente al volo
  (vedi `src/diplomacy/oceanImages.js`), non serve pre-ritagliarlo.
- `sea-monster.png` — il mostro marino, già con sfondo trasparente.
- `shipwreck.png` — la nave affondata, già con sfondo trasparente.
- `wave-1.png` / `wave-2.png` — le due texture "onda" in stile schizzo a
  inchiostro, sparse in pochi punti sull'oceano come dettaglio decorativo
  (tema chiaro, vedi WAVE_TEXTURE in `src/diplomacy/antiqueTheme.js`). Sfondo
  bianco pieno: reso trasparente automaticamente come per `ship.png`.

Se un file manca, il layer corrispondente viene semplicemente saltato senza
errori (l'app funziona comunque, solo senza quell'elemento decorativo).

## Round 2 — easter egg per il tema SCURO (`darkFleetTheme.js`)

Stesso meccanismo di sopra, altro batch incollato in chat, da salvare qui
con **questi nomi esatti**:

- `fleet-destroyers.png` — la formazione di 6 navi (sommergibile +
  cacciatorpediniere/fregate/pattugliatore). Easter egg statico, Atlantico.
- `fleet-carrier.png` — il gruppo portaerei da 7 navi. Easter egg statico,
  Pacifico.
- `cargo-ship.png` — la nave container/mercantile. Easter egg statico,
  Oceano Indiano.
- `wave-dark.png` — l'illustrazione dell'onda singola (stile "cresta/
  maremoto", diversa dalle wave-1/wave-2 sopra — non le sostituisce).
  Texture sparsa sull'oceano, stesso schema di WAVE_TEXTURE ma tema scuro.

Se hanno sfondo bianco pieno vengono resi trasparenti automaticamente allo
stesso modo di `ship.png` sopra (vedi `keyOutWhiteBackground` in
`src/diplomacy/oceanImages.js`); se sono già trasparenti la funzione si
accorge da sola che non c'è nulla da togliere e non tocca l'immagine.

## Round 3 — varietà onde tema scuro

`wave-dark.png` da solo si ripeteva identico su tutti gli 8 punti sparsi
sull'oceano (troppo riconoscibile come pattern). Altre 2 texture "onda",
alternate alle prime (vedi WAVE_TEXTURE in `src/diplomacy/darkFleetTheme.js`):

- `wave-dark-2.png`
- `wave-dark-3.png`

Stesso trattamento trasparenza automatica delle altre.
