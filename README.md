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

1. **« Nouvelle idée »**, en tête de la bibliothèque (sur Android, aussi par
   un appui long sur l'icône de l'appli installée).
2. **Joue** sur le clavier à l'écran : chaque touche écrit une note de la
   durée choisie, à la suite. Plusieurs doigts font un accord. Sur
   l'ordinateur, le clavier joue comme dans Ableton (A W S E D F…, Z X pour
   l'octave), et un clavier MIDI branché aussi (Chrome, Edge).
3. Ou **chante** (🎤) : chaque note tenue s'écrit. Ou **joue en direct** (●) :
   un décompte, le métronome, et les notes se recalent sur la grille.
4. **Corrige au doigt** dans la grille (toucher, glisser, tirer le bord) ou
   sur la partition. Une note choisie prend la hauteur de la touche que tu
   joues. Tout s'annule (↶).
5. **Envoie le MIDI** : AirDrop, Fichiers, mail… ou un téléchargement. Une
   piste par voix, au tempo de l'idée. Aussi en MusicXML pour MuseScore.

Et pour aller plus loin : des **accords** au-dessus de la grille (Portée
propose ceux qui vont avec ta mélodie) et un accompagnement qui les joue ;
des **morceaux** faits d'idées bout à bout (intro, couplet, refrain…) ; un
**carnet** (note, étiquettes, favoris, mémo vocal) ; un **menu en cercle**
(appui long sur une note) pour transposer, ralentir, retourner une phrase.

## Une page écrite sur la reMarkable

1. **Une fois** : « Modèles pour la tablette » → télécharge un modèle et mets-le
   sur ta reMarkable (my.remarkable.com ou l'appli de l'ordinateur).
2. **Pour chaque pièce** : duplique le modèle, renomme la copie avec le titre,
   écris.
3. **Importe** la page : « Importer de ma reMarkable », puis « Importer » à
   côté du document. À défaut, dépose son PDF (sur la tablette *Partager → PDF*).
4. **Corrige en touchant les notes** : touche une note de la partition (ou
   glisse-la), puis plus haut, plus bas, noire, croche, ♯, silence… Les points
   douteux sont surlignés sur ta page. Rien à écrire, tout s'annule.
5. **Écoute et exporte** : piano, tempo, transposition, puis « Télécharger le
   MIDI » (une piste par main, prête pour Ableton, MuseScore ou GarageBand).
   Aussi : imprimer ou PDF, tout exporter en MIDI d'un coup.

Sur le site, ta bibliothèque se **synchronise entre tes appareils** :
« Synchroniser mes appareils » en bas de la bibliothèque, puis colle
l'adresse de ton connecteur (une fois par appareil). Elle marche aussi hors
ligne : les changements partent au retour du réseau. « Sauvegarder ma
bibliothèque » en fait en plus un fichier. Le connecteur (reMarkable et
synchronisation) se branche une fois : voir
[docs/PROPOSITIONS.md](docs/PROPOSITIONS.md), « Brancher la reMarkable ».

## Le dépôt

| Dossier | Contenu |
|---|---|
| `lecteur/` | Le lecteur de traits (JavaScript, sans dépendance) : PDF → traits → notes → ABC |
| `app/` | L'appli : bibliothèque, éditeur d'idée (`idee.js`, `sequence.js`, `grille.js`, `clavier.js`, `micro.js`, `transport.js`, `midi.js`, `musicxml.js`, `harmonie.js`, `menu-radial.js`), morceaux (`morceau.js`, `vue-morceau.js`), correction au toucher (`edition.js`), écoute et exports, piano échantillonné, site installable |
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
