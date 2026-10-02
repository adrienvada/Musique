# CLAUDE.md

Guide pour les sessions Claude Code qui travaillent sur ce dépôt.

## Avant toute chose

Lire [docs/PROPOSITIONS.md](docs/PROPOSITIONS.md) : décisions actées (avec
qui et quand), état de chaque étape, pièges connus. Le mettre à jour **dans
le même commit** que le travail qu'il décrit, en expliquant le *pourquoi*.

Adrien avance par étapes : ne pas lancer l'étape suivante sans sa demande. Un
problème hors du périmètre demandé se signale, il ne se corrige pas en passant.

## Conventions

- Tout en français : code, commentaires, messages, interface. On tutoie Adrien.
- Les commentaires expliquent pourquoi un choix a été fait, comme dans ses
  autres dépôts.
- **Lecteur (`lecteur/`)** :
  - JavaScript pur, sans dépendance : le même code tourne dans le navigateur
    et sous Node ;
  - seuils exprimés en interlignes (`cal.interligne`), jamais en pixels ;
  - toute lecture qui change sur `tests/pages/` passe par une mise à jour
    voulue de `tests/lecteur.test.mjs`.
- **Modèles (`modeles/`)** : générés par `outils/generer_modeles.py`, jamais
  retouchés à la main. Changer un modèle change sa calibration : on
  incrémente `VERSION`.
- **Connecteur (`supabase/functions/portee-remarkable/`)** : lecture seule du
  cloud reMarkable, en JavaScript que Deno (Supabase) et Node (tests) lisent
  tous deux ; seul `index.ts` est propre à Deno. Ne jamais afficher, journaliser
  ni recopier le jeton d'appareil : il vit dans le compartiment privé
  `portee-remarkable` du stockage Supabase. L'appli l'appelle par son nom,
  « Portée reMarkable » : le changer des deux côtés à la fois.
  Tout changement poussé sur `main` dans ce dossier est déployé par
  `.github/workflows/connecteur.yml` : lancer `npm test` et `deno check`
  avant de pousser.
- **Dépôt public** : les journaux de GitHub Actions le sont aussi. N'y
  afficher aucune clé, aucune adresse de connecteur. La clé du connecteur
  vient du secret GitHub `PORTEE_CLE`.
- **Interface (`app/styles/`, `app/icones.js`)** : deux ambiances, Papier
  (lire, ranger) et Studio (l'éditeur d'idée, classe `.studio`), mêmes jetons
  et mêmes composants, définis dans `styles/systeme.css`. Chaque écran a sa
  feuille (`bibliotheque`, `atelier`, `morceau`, `idee`) et n'y met que des
  jetons : une couleur ou un composant qui manque s'ajoute au système. Les
  icônes viennent toutes de `icones.js` (`ico("lire")`, ou
  `<svg class="ico"><use href="#i-lire"></use></svg>` dans la page) : jamais
  d'emoji ni de caractère (▶ ✕ ★) en guise d'icône. Au doigt, rien ne fait
  moins de 44 px. Les choix d'une action se font dans une feuille du bas
  (`<dialog class="feuille-bas">`, `feuilles.js`) : le bouton « précédent »
  la ferme tout seul (`historique.js`). Un calque qui ne serait pas un
  `<dialog>` doit être ajouté à `aLaRacine()` et `reculer()` (`app.js`).
  Tout bouton à icône a un `aria-label` ou un `title` : un appui long
  l'affiche en infobulle (`infobulles.js`). Un élément qui a son propre
  appui long porte `data-sans-infobulle`.
- **Correction au toucher (`app/edition.js`)** : Adrien ne lit pas l'ABC.
  Toute correction passe par un geste (bouton, glissé, clavier) qui réécrit
  l'ABC ; le texte reste en « mode avancé ».

## Vérifier

```bash
npm ci && npm test
npm run lire -- tests/pages/2026-09-30-melodie-standard.pdf --svg   # image de contrôle
```

L'image de contrôle colore chaque trait selon ce que le lecteur en a compris.
C'est le premier réflexe quand une lecture est fausse.

## Republier l'appli

**Le site** (https://adrienvada.fr/Musique/, servi par GitHub Pages) se republie tout seul à
chaque fusion sur `main` (`.github/workflows/site.yml`). Ses modules et ses
feuilles de style portent la version dans leur adresse (`?v=…`, ajouté par
`npm run appli -- --autonome`) : sans elle, le cache du navigateur mélangeait
deux versions juste après une mise en ligne. Les imports s'écrivent
`from "./x.js"`, littéralement : l'assembleur refuse ceux qu'il ne sait pas
versionner. Hors de claude.ai, la
bibliothèque est dans IndexedDB (`portee`, version 2 : `partitions`, `pages`,
`envois`, `meta`) et se synchronise par le connecteur (`app/synchro.js`,
`supabase/functions/portee-remarkable/bibliotheque.js`). Ne jamais changer la
base ni ses magasins sans migration (`onupgradeneeded`). Tout ce qui écrit
une partition doit passer par `stockage.creer/modifier/supprimer` : c'est ce
qui la met dans la file d'envois.

**La version claude.ai** est un artefact : https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj

1. `npm run appli` assemble `dist/` et écrit `dist.fichiers.json`.
2. Republier avec l'outil `Artifact` en passant **cette URL** en `url` :
   - `file_path` : `dist/index.html` ;
   - `files` : le contenu de `dist.fichiers.json`, avec un `contentType`
     explicite pour `.mjs` (`text/javascript`), `.mp3` (`audio/mpeg`),
     `.pdf` (`application/pdf`) et `.svg` (`image/svg+xml`) ;
   - ne pas repasser `capabilities`, pour garder `db`, `downloads` et `mcp`
     (connecteur « Portée reMarkable » : `arborescence`, `document`, `relier`).
     Si on les repasse, redonner l'ensemble complet : ce qui manque est retiré.

   Sans l'URL, on crée une seconde appli vide, et Adrien perd sa bibliothèque.
3. La base de l'appli (`partitions/<id>`, `partitions/<id>/pages/<n>`) contient
   les vraies partitions d'Adrien : la lire avec `ArtifactData` si besoin, ne
   jamais y écrire sans qu'il l'ait demandé.

Avant de publier, tester la version autonome dans Chromium (lancé avec
`LANG=C.UTF-8`) : servir `dist/` après `npm run appli -- --autonome`, importer
les pages d'essai, corriger une note, écouter, exporter le MIDI, sauvegarder
puis restaurer. Pour le panneau « Ma reMarkable », simuler `window.claude.use("mcp")`
en appelant `traiter()` (connecteur) sur le faux cloud de `tests/faux-cloud.mjs`.
