# Échantillons de piano (Splendid Grand Piano)

- **Origine** : instrument `SplendidGrandPiano` de la bibliothèque npm `smplr` (danigb, MIT), fichiers servis par https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples (d'après https://github.com/sfzinstruments/SplendidGrandPiano).
- **Licence** : échantillons de Steinway publiés dans le **domaine public** par AKAI (vers 2000), selon le README du dépôt source.
- **Sélection** : couche de vélocité MF (mezzo-forte) uniquement, 29 notes de MIDI 23 à 108, espacées d'environ 3 demi-tons (écart maximal 4) ; la liste est dans `index.json`.
- **Conversion** : fichiers `.m4a` d'origine convertis en MP3 mono 44,1 kHz (LAME VBR `-q:a 2`, ffmpeg), coupés à 6 s au maximum avec un fondu de sortie de 0,25 à 0,5 s.
