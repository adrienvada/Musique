# Portée

Un carnet de musique de poche : note une mélodie dès qu'elle te vient (au
clavier, en chantant, en direct avec le métronome), écoute-la au piano,
ajoute des accords, envoie-la en MIDI dans Ableton. Tes partitions écrites à
la main sur la reMarkable y entrent aussi, lues et corrigées. Gratuitement.

**L'appli : https://adrienvada.fr/Musique/**, sur l'ordinateur comme
sur le téléphone. Elle s'installe comme une appli (bouton « Installer
l'appli » du navigateur) et marche hors ligne. Une version privée existe aussi
sur claude.ai : https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj (bibliothèque
enregistrée sur ton compte claude.ai).

## Noter une idée

1. **Carnet → « Noter une idée »** : *Jouer* (le clavier), *Chanter* ou
   *Mémo* (un mémo vocal tout de suite, tu l'écriras plus tard). Sur
   Android, aussi par un appui long sur l'icône de l'appli installée.
2. **Joue** sur le clavier du pupitre : chaque touche écrit une note de la
   durée choisie, à la suite. La gamme de l'idée est marquée sur les
   touches ; le mode *Gamme* n'en garde que les huit notes, en grosses
   touches, pour ne jamais faire de fausse note. Sur l'ordinateur, le
   clavier joue comme dans Ableton (A W S E D F…, Z X pour l'octave), et un
   clavier MIDI branché aussi (Chrome, Edge).
3. Ou **chante** (mode *Chanter*) : ta voix se dessine sur la grille, et
   une note tenue un instant s'écrit. Ou **joue en direct** (le bouton
   rouge) : un décompte, le métronome, puis tu choisis comment arrondir le
   rythme en voyant ce que ça change.
4. **Corrige au doigt** dans la grille (toucher, glisser, tirer le bord) ou
   sur la partition : on passe de l'une à l'autre en haut de l'écran
   (Grille | Partition). Pince la grille en largeur pour zoomer dans le
   temps, en hauteur pour agrandir les notes. Un doute sur une icône ?
   Laisse le doigt dessus : une bulle dit ce qu'elle fait. La pilule au-dessus des notes choisies les monte, les
   descend ou les efface ; « ••• » range le reste (durées, plus lent, à
   l'envers, miroir…). Une note choisie prend la hauteur de la touche que tu
   joues. Tout s'annule. Pour supprimer une idée, une partition ou un
   morceau : « ••• » sur sa ligne, puis Supprimer.
5. **Envoie le MIDI** (bouton Partager) : AirDrop, Fichiers, mail… ou un
   téléchargement. Une piste par voix, au tempo de l'idée. Aussi en
   MusicXML pour MuseScore.

Et pour aller plus loin : des **accords** (mode *Accords*, ou la roue de la
tonalité : Portée cercle ceux qui suivent souvent et teinte ceux qui vont
avec ta mélodie) et un accompagnement qui les joue ; des **morceaux** faits
d'idées bout à bout (intro, couplet, refrain…), vus en frise ; un
**carnet** (note, étiquettes, favoris, mémo vocal).

L'éditeur est en ambiance *Studio* (sombre) ; Réglages › Éditeur la remet en
*Papier* si tu préfères.

## Une page écrite sur la reMarkable

1. **Une fois** : Partitions → « Modèles pour la tablette » → télécharge un
   modèle et mets-le sur ta reMarkable (my.remarkable.com ou l'appli de
   l'ordinateur).
2. **Pour chaque pièce** : duplique le modèle, renomme la copie avec le titre,
   écris.
3. **Importe** la page : Partitions → « Importer de ma reMarkable », puis
   « Importer » à côté du document. À défaut, dépose son PDF (sur la
   tablette *Partager → PDF*).
4. **Relis** : les passages douteux sont numérotés sur ta page, et Portée
   te pose ses questions une à une (« Croche ou noire ? », « Il manque une
   croche »). Ta réponse corrige la bonne note. Pour le reste, touche une
   note de la partition lue et choisis un geste. Rien à écrire, tout
   s'annule.
5. **Écoute et exporte** : piano, tempo, transposition, puis « Télécharger le
   MIDI » (une piste par main, prête pour Ableton, MuseScore ou GarageBand).
   Aussi : imprimer ou PDF, MusicXML.

Sur le site, ta bibliothèque se **synchronise entre tes appareils** :
Réglages → « Synchroniser mes appareils », puis colle l'adresse de ton
connecteur (une fois par appareil). Elle marche aussi hors ligne : les
changements partent au retour du réseau. Réglages › Sauvegarde en fait en
plus un fichier, et exporte tout en MIDI d'un coup. Le connecteur
(reMarkable et synchronisation) se branche une fois : voir
[docs/PROPOSITIONS.md](docs/PROPOSITIONS.md), « Brancher la reMarkable ».

## Le dépôt

| Dossier | Contenu |
|---|---|
| `lecteur/` | Le lecteur de traits (JavaScript, sans dépendance) : PDF → traits → notes → ABC |
| `app/` | L'appli : accueil (`accueil.js`), éditeur d'idée (`idee.js` et ses modules `idee-clavier`, `idee-chant`, `idee-accords`, `idee-selection`, `idee-direct` ; `sequence.js`, `grille.js`, `clavier.js`, `micro.js`, `transport.js`, `midi.js`, `musicxml.js`, `harmonie.js`, `menu-radial.js`), morceaux (`morceau.js`, `vue-morceau.js`), pages relues (`atelier.js`, `doutes.js`, `edition.js`), écoute et exports, piano échantillonné, site installable ; le système visuel (`styles/systeme.css`, `icones.js`, `feuilles.js`) et une feuille de style par écran (`styles/`) |
| `supabase/functions/portee-remarkable/` | Le connecteur « Portée reMarkable » : lit le cloud reMarkable au clic (fonction Supabase) |
| `modeles/` | Les modèles de papier calibré (PDF, calibration JSON, aperçus) |
| `outils/` | Générateur de modèles (Python), lecture en ligne de commande, assemblage de l'appli, déploiement du connecteur |
| `tests/` | Les pages d'essai d'Adrien et les tests qui figent leur lecture ; ceux de l'éditeur d'idée (notation, MIDI, accords, micro) |
| `docs/PROPOSITIONS.md` | Le plan, les décisions, l'état de chaque étape, les pièges connus |

```bash
npm ci                      # pdf.js et abcjs, versions figées
npm test                    # le lecteur relit les pages d'essai
npm run lire -- page.pdf --svg   # lit une page, image de contrôle en prime
npm run appli               # assemble l'appli dans dist/ (pour claude.ai)
npm run appli -- --autonome # le site GitHub Pages (publié par .github/workflows/site.yml)
SUPABASE_ACCESS_TOKEN=… npm run connecteur -- <ref>   # déploie le connecteur
```

Plan illustré des choix de départ : https://claude.ai/artifact/99p6MDcPHbxYz8z1yvEfAn
