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
  - seuils exprimés en interlignes (`cal.interligne`), jamais en pixels ; le
    lecteur arrondit lui-même les traits au demi-pixel (`traits.js`) ;
  - une décision au ras d'un seuil devient un doute à réponse fermée
    (`MARGES`, `alternative`), jamais une lecture qui bascule en silence ;
  - toute lecture qui change sur `tests/pages/` passe par une mise à jour
    voulue de `tests/lecteur.test.mjs` ; avant et après un réglage, passer
    le banc d'essai (`node outils/banc-lecteur.mjs <sauvegarde> --json`, sur
    une sauvegarde d'Adrien gardée hors du dépôt) ;
  - les gabarits de son écriture (`gabarits.js`) sont une entrée
    facultative : sans eux, la lecture ne change pas (un test le garde). Ce
    sont ses données : jamais dans le dépôt. Dans la bibliothèque, ce sont
    des fiches cachées (`type: "gabarits"`, id `gabarits-<signe>`), toujours
    réunies par union, jamais « le plus récent gagne » ; tout ce qui liste
    des partitions les écarte (`montrable` dans `stockage.js`, `fiches()`
    dans `conversation.js`) ;
  - une calibration se charge toujours avec sa version :
    `calibration(modele, versionModele)` ;
  - piège abcjs : après une barre, le `startChar` d'une note pointe sur
    l'espace qui la précède (`debutDeNote`).
- **Modèles (`modeles/`)** : générés par `outils/generer_modeles.py`, jamais
  retouchés à la main. Changer un modèle change sa calibration : on
  incrémente `VERSION`, et chaque version garde la sienne
  (`<modèle>-v<N>.json`) : une page ne se lit jamais avec la calibration
  d'une autre version. `extraire_glyphes.py` n'ajoute que des signes : les
  PDF déjà imprimés restent identiques à l'octet près.
- **Connecteur (`supabase/functions/portee-remarkable/`)** : lecture seule du
  cloud reMarkable, en JavaScript que Deno (Supabase) et Node (tests) lisent
  tous deux ; seul `index.ts` est propre à Deno. Ne jamais afficher, journaliser
  ni recopier le jeton d'appareil : il vit, chiffré par `PORTEE_COFFRE`, dans
  le compartiment privé `portee-remarkable` du stockage Supabase. L'appli
  l'appelle par son nom, « Portée reMarkable » : le changer des deux côtés à
  la fois.
  - Deux époques de MCP sur la même adresse (`mcp.js`) : 2026-07-28 (version
    et en-têtes à chaque requête) et celles d'`initialize` (jusqu'à
    2025-11-25). Le site appelle `tools/call` sans `initialize` ni en-tête :
    ne pas le casser.
  - Clé de service : `SUPABASE_SECRET_KEYS` d'abord, en `apikey` seulement ;
    l'ancienne clé à défaut (`supabase.js`).
  - `PORTEE_COFFRE` est créé une fois par `outils/deployer-connecteur.mjs` :
    ne jamais le supprimer ni le remplacer (le jeton ne se déchiffrerait
    plus, et la tablette serait à relier).
  - Le connecteur est déployé seul et n'importe rien d'`app/` : les listes
    recopiées restent d'accord grâce à `tests/connecteur-conversation.test.mjs`.
  - Les outils pour Claude (`conversation.js`) passent par l'API de
    `Bibliotheque` et n'écrivent jamais par-dessus une partition :
    `idee_ecrire` crée, `suggestion_ecrire` range à part
    (`suggestions/<partition>/`).
  - La vue MCP Apps (`vue-partition.js`) déclare dans `_meta.ui.csp` tout
    domaine qu'elle charge ; l'empreinte SRI d'abcjs suit `node_modules` (un
    test le vérifie).
  - Une origine de navigateur inconnue reçoit 403 ; une de plus se déclare
    par `PORTEE_ORIGINES`. Une fiche de plus de 256 Ko ou des pages de plus
    de 5 Mo sont refusées par `{ accepte: false, refus }`.
  - Les tests ne visent jamais le vrai cloud : faux cloud, attentes simulées
    (`options.attendre`).
  - Tout changement poussé sur `main` dans ce dossier est déployé par
    `.github/workflows/connecteur.yml` : lancer `npm test` et `deno check`
    avant de pousser, et lire le **code de sortie** de `deno check` (un échec
    de typage ne se voit pas toujours dans la dernière ligne).
- **Dépôt public** : les journaux de GitHub Actions le sont aussi. N'y
  afficher aucune clé, aucune adresse de connecteur. La clé du connecteur
  vient du secret GitHub `PORTEE_CLE`. Les secrets ne vont qu'à l'étape qui
  s'en sert (« Déployer » de `connecteur.yml`) ; une empreinte d'action se
  change avec son commentaire de version ; `sentinelle.yml` n'affiche ni
  l'adresse ni la réponse. Ne jamais committer une fausse clé qui a la forme
  exacte d'une vraie (`sb_secret_…`, JWT signé) : la protection de GitHub
  refuse l'envoi. Dans un test, l'assembler à l'exécution.
- **Données (`app/fiche.js`, `app/stockage.js`, `app/synchro.js`)** : toute
  fiche qui entre (restauration, synchro, affichage) passe par
  `normaliserFiche` : un nouveau champ s'y déclare, avec son type et ses
  bornes. La synchro reçoit avant d'envoyer, et envoie sous condition
  (`base`, `baseRev`) ; un écran qui enregistre la fiche entière passe
  `{ depuis }` à `stockage.modifier`. Dans un patch, un champ à `undefined`
  est retiré, dans les trois stockages. `synchro.reessayer()` ne lève que
  les envois : une réception mise de côté se réessaie à chaque passage, avec
  sa fiche gardée. `tests/synchro-scenarios.test.mjs` doit rester vert.
  - Ce qui ne sert qu'avec la bibliothèque commune porte
    `data-avec-synchro` (montré ou caché par `synchronisation-ui.js`, comme
    `data-avec-claude`) : caché, jamais grisé.
  - Un compte d'éléments mêlés se dit par sorte (`compteParSorte`,
    `garde.js`) : jamais « partitions » pour des idées.
  - Les suggestions de Claude : du texte seulement, `validerSuggestion`
    juste avant d'appliquer ; l'éditeur se change par `editeur.changer(f)`,
    une page par `pageOuverte.changer(patch)`.
- **Son et temps (`app/piano.js`, `app/transport.js`, `app/eveil.js`)** :
  - tout ce qui joue passe par le transport (idées, morceaux, pages par
    `ecoute-page.js`), sur l'horloge du contexte audio, jamais par une
    minuterie ; `transport.arreter()` coupe tout ce qui est programmé :
    piano, clics, sortie MIDI ;
  - une note jouée en direct porte l'instant de son geste
    (`event.timeStamp`, `MIDIMessageEvent.timeStamp`) :
    `transport.position(instant, { latence })` ;
  - ce qui ouvre le micro passe la session audio en `"play-and-record"` et
    la rend à `"playback"`, refus compris (`sessionAudio`), et garde l'écran
    allumé (`garderEveille`, `laisserDormir`) ;
  - les échantillons du piano se refont par `outils/echantillons-piano.mjs`,
    jamais à la main ;
  - ce qui écoute les entrées MIDI ignore le retour de la sortie choisie
    (`enBoucle`, `sortie-midi.js`) ;
  - le dossier des .mid se garde dans la base `portee-appareil` (propre à
    l'appareil, jamais synchronisée), jamais dans la bibliothèque.
- **Notation et exports (`app/sequence.js`, `harmonie.js`, `accords.js`,
  `midi.js`, `musicxml.js`, `morceau.js`)** : un seul écrivain MIDI
  (`fichierMidi`) et un seul lecteur (`lireFichierMidi`), pour les idées, les
  morceaux et les pages lues : ne pas revenir à `getMidiFile` d'abcjs, qui
  perd les noms et les changements. Les textes MIDI s'écrivent en ASCII
  (`texteMidi`). La partition et le MusicXML passent par `mettreEnMesures`.
  `sequence.js` n'importe pas `harmonie.js` (qui l'importe) : ce qu'ils
  partagent sur les noms d'accords est dans `accords.js`. Un changement
  d'export se vérifie avec un lecteur indépendant (mido, music21) et
  `xmllint --schema` (MusicXML 4.0) ; le test « mille idées » reste vert.
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
  `<dialog>` doit être déclaré dans le `reculer()` et l'`aLaRacine()` de son
  écran, dans le registre des écrans (`app.js`, `navigation.js`). Une
  feuille ouverte depuis plusieurs écrans se pose à la racine de la page
  (comme `versions-ui.js`) : un `<dialog>` dans une vue cachée ne s'affiche
  pas.
  Tout bouton à icône a un `aria-label` ou un `title` : un appui long
  l'affiche en infobulle (`infobulles.js`). Un élément qui a son propre
  appui long porte `data-sans-infobulle`. Tout texte inséré en HTML passe
  par `echapper` (`app/ui.js`) : une fiche peut venir de la synchro, d'une
  sauvegarde ou de Claude.
  - Ce qui change se dit par `annoncer` (`ui.js`), en une phrase : jamais
    `aria-live` sur une liste entière. Chaque écran a un `h1` caché
    (`#titre-ecran-<vue>`) que `navigation.js` remplit, et `document.title`
    suit l'écran. Toute gravure abcjs avec `clickListener` passe par
    `gravureSansTabulation`.
  - Les tailles de texte, les rayons et les calques viennent des jetons
    `--t-*`, `--r-*`, `--z-*` ; ombres, voiles et lueurs de `--ombre-douce`,
    `--voile`, `--lueur`. Un bord de champ ou d'interrupteur prend
    `--bord-champ` (3:1), pas `--trait-fort`. Un jeton calculé à partir d'un
    autre se déclare sur `:root, .studio` : une propriété personnalisée se
    calcule là où elle est déclarée, sinon le Studio garde la valeur du
    Papier. Un texte pour le lecteur d'écran prend `visuellement-cache`.
  - Au doigt, `.btn`, `.puce`, `.champ` et `.seg > button` font 44 px de
    haut (`systeme.css`) : une feuille d'écran ne leur donne pas moins. Un
    nouvel écran ou une nouvelle feuille entre dans le tour de l'essai des
    44 px (`tests/e2e/interface.test.mjs`), qui passe à 390 et 320 px de
    large et couché ; toute exception y est commentée.
  - Une rangée qui doit tenir dans sa largeur suit son conteneur, en `em`
    (`@container … (max-width: 16em)`), placée après la règle qu'elle
    remplace ; elle ne peut pas styler le conteneur lui-même.
  - Les feuilles et les écrans s'animent en CSS (`@starting-style`), et
    plus du tout quand moins d'animations est demandé ; tout défilement
    animé passe par `defilement()` (`mouvement.js`). Pas de
    `closedby="any"` (au doigt, Chromium laisse le toucher traverser le
    voile : `feuilles.js` ferme au clic) ni de `startViewTransition` dans
    `montrer()` (l'éditeur se mesure dès qu'il s'affiche). La couleur de la
    barre du navigateur suit l'ambiance par `suivreAmbiance()`.
  - Carnet : une ligne est reprise telle quelle si `cleDeLigne` ne change
    pas ; toute donnée affichée qui ne vient pas de la fiche (le compte des
    suggestions) entre dans la clé. Pas de `will-change` sur la grille
    (mesuré : 105 ms par image). Un `[role=button]` de moins de 44 px est
    une exception actée et commentée (les touches du piano).
- **Appli installable (`app/manifest.webmanifest`)** : son `id`
  (`/Musique/`) se lit depuis l'origine, pas depuis le manifeste : ne
  jamais le changer, ce serait une autre appli. Icônes et captures se
  refont par `outils/images-appli.mjs` ; les raccourcis correspondent à
  `accueil.raccourci`. Un fichier reçu (`launchQueue`, partage) passe par
  `recevoir` (`import-pdf.js`), et le cache `portee-partage` ne s'efface
  jamais à l'activation du service worker.
- **Architecture (`app/`)** : `app.js` ne fait que composer. Chaque écran
  est une fabrique qui branche ses écouteurs une fois et s'inscrit dans le
  registre (`creerRegistre`, `navigation.js`) avec `fermer`, `reculer`
  (vrai s'il restait un pas à défaire), `aLaRacine` et, au besoin,
  `afficher`, `toucheBas`, `toucheHaut`, `partition`, `occupe`,
  `recharger` et `supprimee`. `navigation.js` ferme d'abord les `<dialog>`
  ouverts et ne transmet aucune touche tant qu'un `<dialog>` ou un champ de
  texte est actif.
  - Ce qui s'enregistre passe par `enregistreur.js` : la cible et une copie
    du contenu sont fixées quand on planifie (`planifier(cible, copie)`), la
    file se vide quand on quitte l'écran et quand la page se ferme, avec une
    copie de secours (`portee:secours`). Une session `{ id, cree, derniere }`
    donne `depuis` au stockage.
  - Une écoute par écran, par `ecoute.js`. Toute question passe par
    `dialogue.js` (`dialogue`, `confirmer`, `veutSupprimer`), jamais
    `window.confirm`. Toute erreur montrée passe par `erreurs.js`
    (`expliquer`), et on lance des `Error` avec leur cause
    (`erreur(code, message, { cause })`).
  - L'éditeur d'idée donne à ses modules un contexte explicite, et l'état en
    lecture seule à ceux qui n'ont qu'à le lire ; son API ne s'élargit
    qu'au besoin.
  - Les couleurs s'écrivent `light-dark(clair, sombre)` dans `systeme.css` ;
    en JS, `couleurDuJeton("--x")`.
  - Une JSDoc s'écrit type d'abord (`@param {Object} options { … }`) :
    sinon TypeScript lit la prose comme un type.
- **Claude dans la page (`sample`, version claude.ai seulement)** : la
  fonction n'existe que si `claude.use("sample")` rend une fonction (sur le
  site : absente, pas grisée). Un appel par geste d'Adrien, avec son
  `AbortController`, un bouton « Arrêter » et `cache: false` ; jamais au
  chargement, jamais de nouvel essai tout seul. Le texte de `onText` (du
  JSON) ne se montre jamais. On valide, puis on applique sur la copie
  envoyée, et rien ne s'applique si l'idée a changé entre-temps ; ce
  qu'Adrien garde passe par `remplacerIdee` ou `changerTitre` (un seul
  « Annuler »). Les échecs de `sample` passent par `lireEchec`
  (`claude-idee.js`), jamais par `expliquer`, qui prendrait
  `upstream_error` pour le connecteur. `permissions` ne se déclare pas : on
  appelle `manage()` sur un bouton. Le second avis sur un doute passe par
  `validerAvis`, puis s'applique par `repondre`, comme la réponse d'Adrien ;
  `issueAvis(err)` lit un échec de `sample` à son code et une `Error` de
  Portée par `erreurs.js`. Dans un essai, un faux `sample` dont le signal
  est déjà arrêté rejette sans rien envoyer : un essai qui touche
  « Arrêter » attend que la question soit partie. Une nouvelle classe CSS se préfixe
  (`.claude-…`) : `.gardee` et `.neuve` du mode Chanter ne le sont pas.
- **Correction au toucher (`app/edition.js`)** : Adrien ne lit pas l'ABC.
  Toute correction passe par un geste (bouton, glissé, clavier) qui réécrit
  l'ABC ; le texte reste en « mode avancé ».
- **Outillage** : Playwright reste en 1.56.1 (Dependabot ne le monte pas) ;
  un module sans DOM qui passe à zéro erreur s'ajoute à `tsconfig.json`.

## Carte de l'appli (`app/`)

- **Composer et naviguer** : `app.js` (crée et relie les écrans, tient le
  registre), `navigation.js` (montrer un écran, la pile, « précédent », les
  raccourcis par écran), `historique.js` (le bouton « précédent » du
  téléphone).
- **Petits outils** : `ui.js` (`$`, `el`, `pluriel`, les dates, `toast`,
  `annoncer`, `echapper`, `couleurDuJeton`), `dialogue.js`, `erreurs.js`,
  `feuilles.js`, `infobulles.js`, `icones.js`, `mouvement.js` (les
  défilements, selon les animations demandées), `preferences.js`.
- **Écrans** : `accueil.js` (les quatre onglets), `ecran-atelier.js`
  (« Corriger »), `ecran-lecteur.js` (« Écouter et exporter »),
  `page-ouverte.js` (la page lue que ces deux écrans partagent),
  `atelier.js` (leurs pièces communes), `vue-morceau.js` (un morceau),
  `gestes.js` (supprimer, dupliquer, ajouter à un morceau, le « ••• » de
  l'éditeur).
- **Éditeur d'idée** : `idee.js` (le cœur : état, annuler, la barre du
  haut, les modes), `idee-carnet.js`, `idee-tempo.js`, `idee-partition.js`
  (la gravure, `mettreEnPage`), `idee-ecoute.js`, `idee-enregistrement.js`,
  `idee-claude.js` (la feuille « Demander à Claude », version claude.ai),
  les modes `idee-clavier.js`, `idee-chant.js`, `idee-accords.js`, puis
  `idee-selection.js`, `idee-direct.js`, `grille.js`, `clavier.js`,
  `menu-radial.js`, `micro.js`.
- **Enregistrer et synchroniser** : `enregistreur.js`, `ecoute.js`,
  `stockage.js` (IndexedDB ou la base claude.ai), `fiche.js` (vérifier,
  remettre en forme, fusionner une fiche), `synchro.js`,
  `synchronisation-ui.js`, `sauvegarde-ui.js`, `garde.js` (ce qui protège
  la bibliothèque, le compte par sorte), `conflits.js` (la version de
  l'autre appareil), `versions.js` et `versions-ui.js` (versions
  précédentes, corbeille), `mises-a-jour.js` et `sw.js`.
- **Tablette et import** : `tablette.js` (le panneau « Ma reMarkable »),
  `connecteur.js`, `import-pdf.js` (PDF et .mid), `apercus.js`,
  `manuscrit.js`, `doutes.js`, `edition.js`.
- **Musique et sorties** : `sequence.js`, `harmonie.js`, `accords.js`,
  `morceau.js`, `midi.js`, `musicxml.js`, `exports.js`, `zip.js`,
  `piano.js`, `transport.js`, `ecoute-page.js`, `eveil.js`,
  `sortie-midi.js`, `dossier-midi.js`, `reglages-live.js`.
- **Claude dans Portée** (sans DOM : ce qui part vers Claude et ce qui est
  vérifié au retour) : `claude-idee.js`, `claude-outils.js` (les outils
  d'une demande libre, sur une copie), `claude-doute.js`, `suggestions.js` ;
  et leur écran, `suggestions-ui.js` (le bandeau des suggestions rangées
  depuis une conversation).

## Vérifier

```bash
npm ci && npm test
npm run lint && npm run types
npm run e2e        # assemble le site, puis le parcourt dans Chromium, réseau coupé
npm run lire -- tests/pages/2026-09-30-melodie-standard.pdf --svg   # image de contrôle
```

Ici, Chromium est déjà installé (`PLAYWRIGHT_BROWSERS_PATH`) ; ailleurs :
`npx playwright install chromium`. La CI (job `verifier` de `site.yml`) lance
tout cela, plus `deno check`, sur chaque PR.

Pièges des essais dans Chromium : un `<dialog>` fermé reste visible le
temps de redescendre (attendre `state: "hidden"`) ; `:focus-visible` ne distingue pas le
clavier de la souris dans un gestionnaire de touche ; sans écran, la carte
du clavier (`getLayoutMap`) est vide ; l'installabilité se vérifie avec
`launchPersistentContext` et `channel: "chromium"` ; la `launchQueue` se
remplace par `Object.defineProperty`, pas par une affectation.

L'image de contrôle colore chaque trait selon ce que le lecteur en a compris.
C'est le premier réflexe quand une lecture est fausse.

## Republier l'appli

**Le site** (https://adrienvada.fr/Musique/, servi par GitHub Pages) se republie tout seul à
chaque fusion sur `main` (`.github/workflows/site.yml`), après le job
`verifier`. Ses modules et ses
feuilles de style portent la version dans leur adresse (`?v=…`, ajouté par
`npm run appli -- --autonome`) : sans elle, le cache du navigateur mélangeait
deux versions juste après une mise en ligne. Les imports s'écrivent
`from "./x.js"`, littéralement : l'assembleur refuse ceux qu'il ne sait pas
versionner ; pdf.js s'importe sous la forme littérale
`"./vendor/pdfjs/pdf.min.mjs"`. Le service worker garde exactement ce que
sort l'assembleur : un fichier que l'appli demande doit en sortir. La page
porte une CSP : aucun script en ligne, aucun gestionnaire `on…=`, aucun
autre domaine que le site et `*.supabase.co` (`npm run e2e` le vérifie).
Hors de claude.ai, la
bibliothèque est dans IndexedDB (`portee`, version 3 : `partitions`, `pages`,
`envois`, `meta`, `bases`) et se synchronise par le connecteur (`app/synchro.js`,
`supabase/functions/portee-remarkable/bibliotheque.js`). Ne jamais changer la
base ni ses magasins sans migration (`onupgradeneeded`). Tout ce qui écrit
une partition doit passer par `stockage.creer/modifier/supprimer` : c'est ce
qui la met dans la file d'envois.

**La version claude.ai** est un artefact : https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj

1. `npm run appli` assemble `dist/` et écrit `dist.fichiers.json` : le
   lancer juste avant de publier, car `npm run e2e` réécrit `dist/`.
2. Republier avec l'outil `Artifact` en passant **cette URL** en `url` :
   - `file_path` : `dist/index.html` ;
   - `files` : le contenu de `dist.fichiers.json`, avec un `contentType`
     explicite pour `.mjs` (`text/javascript`), `.mp3` (`audio/mpeg`),
     `.pdf` (`application/pdf`), `.svg` (`image/svg+xml`), `.woff2`
     (`font/woff2`) et `.txt` (`text/plain`) ;
   - ne pas repasser `capabilities`, pour garder `db`, `downloads` et `mcp`
     (connecteur « Portée reMarkable » : `arborescence`, `document`, `relier`).
     Si on les repasse, redonner l'ensemble complet : ce qui manque est retiré.

   Sans l'URL, on crée une seconde appli vide, et Adrien perd sa bibliothèque.
3. La base de l'appli (`partitions/<id>`, `partitions/<id>/pages/<n>`) contient
   les vraies partitions d'Adrien : la lire avec `ArtifactData` si besoin, ne
   jamais y écrire sans qu'il l'ait demandé.

Avant de publier : `npm run e2e` joue l'import des pages d'essai, une
correction, l'écoute, le MIDI, la sauvegarde et la restauration, hors ligne,
et la version claude.ai simulée. L'essai à la main dans Chromium (lancé avec
`LANG=C.UTF-8`, sur `dist/` servi après `npm run appli -- --autonome`) ne sert
plus qu'à ce qu'il ne couvre pas ; un vrai iPhone, une vraie voix, un vrai
clavier MIDI et Live restent à essayer par Adrien. Pour le panneau « Ma
reMarkable », simuler `window.claude.use("mcp")` en appelant `traiter()`
(connecteur) sur le faux cloud de `tests/faux-cloud.mjs`. Pour Réglages ›
Avec Live, simuler `navigator.requestMIDIAccess` (un faux port qui note ce
qu'il reçoit) et `showDirectoryPicker` (un dossier de
`navigator.storage.getDirectory()`).
