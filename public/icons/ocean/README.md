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
