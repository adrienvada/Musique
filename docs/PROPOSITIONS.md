# Propositions — de la tablette au piano

*Mis à jour le 1er octobre 2026 : Portée devient un carnet MIDI de poche (idées notées au clavier, au chant ou en direct).*

**L'appli** :
- **https://adrienvada.fr/Musique/** (site public sur GitHub Pages, installable, bibliothèque synchronisée) ;
- https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj (privée, bibliothèque sur claude.ai).

Version illustrée (schémas, maquettes jouables de l'interface) :
https://claude.ai/artifact/99p6MDcPHbxYz8z1yvEfAn

## Décisions actées

- **30/09 · Contenu des pages : mélodie seule ou piano à deux mains.** Avec
  Adrien. Le moteur de lecture doit donc gérer deux portées liées. JAZZMUS ne
  lit qu'une ligne mélodique : il ne peut être qu'un second avis.
- **30/09 · reMarkable 2 avec abonnement Connect.** Avec Adrien. La
  synchronisation cloud est complète : la voie `rmapi` est retenue, et le doute
  sur les comptes gratuits ne nous concerne plus.
- **30/09 · Pas de Gemini.** Avec Adrien. Son abonnement Gemini est l'offre
  grand public, sans accès à l'API, et l'API gratuite pose problème (voir plus
  bas). **Le papier calibré devient le moteur de lecture principal.**
- **30/09 · Plusieurs modèles de papier calibré.** Demandé par Adrien. Quatre
  modèles v1 sont livrés dans `modeles/` : mélodie large, mélodie standard,
  piano large et piano standard. Ils sont générés par
  `outils/generer_modeles.py` au format exact de l'écran de la reMarkable 2.

- **30/09 · Calibration vérifiée sur deux pages réelles.** Adrien a exporté
  deux pages en PDF (`tests/pages/`). Le premier vérificateur (Python) y repère les
  55 têtes pleines. Chacune tombe sur sa ligne ou son interligne, avec un
  écart maximal de 0,23 interligne pour une tolérance de 0,25. La gamme
  ressort exacte : do4 ré4 mi4 fa4 sol4 la4 si4 do5.

- **30/09 · Version 1 fonctionnelle, sur claude.ai.** Demandé par Adrien
  (« continue jusqu'à ce que l'outil soit fonctionnel »). Son trajet est
  celui de la formule C, sans aucune installation :
  1. Adrien exporte la page en PDF depuis la tablette ;
  2. il la dépose dans l'appli ;
  3. le lecteur tourne dans le navigateur ;
  4. Adrien relit dans l'atelier, puis écoute au piano.

  Les partitions et leurs traits sont rangés dans la base de la page claude.ai
  (capacité `db`) : ils suivent Adrien sur tous ses appareils, sans Supabase ni
  hébergement. La synchronisation automatique prévue alors a laissé place à
  l'import à la demande (décision plus bas).

  **Pourquoi ce choix plutôt que B tout de suite.** Supabase et Cloudflare
  demandent des accès que la session n'a pas (clés, tableau de bord). Là,
  l'appli marche dès maintenant. Le code est prêt pour un autre hébergement :
  `npm run appli -- --autonome`, avec repli sur le stockage du navigateur.
- **30/09 · Le lecteur est réécrit en JavaScript** (`lecteur/`). Le même code
  sert au navigateur et aux tests Node. Le vérificateur Python
  (`verifier_page.py`, PyMuPDF sous licence AGPL) est retiré.
- **30/09 · Import à la demande depuis la reMarkable.** Demandé par Adrien :
  un bouton dans l'appli, l'arborescence de la tablette, un import au clic,
  « à la demande, pas régulièrement ». Ni synchro planifiée ni routine.
  - La page claude.ai ne peut joindre aucun serveur. Elle passe par un
    **connecteur claude.ai personnel**, « Portée reMarkable », qu'elle appelle
    avec la capacité `mcp`.
  - Ce connecteur est une fonction Supabase
    (`supabase/functions/portee-remarkable/`) dans le projet du site : gratuit,
    rien de plus à héberger. Il reprend le protocole du cloud de `rmapi` et lit
    les `.rm` v6 comme `rmscene`, en JavaScript. Il n'écrit jamais dans le cloud.
  - Trois outils : `arborescence`, `document` et `relier`. La tablette se relie
    depuis l'appli avec le code à 8 lettres de my.remarkable.com. Le jeton
    d'appareil va dans un compartiment privé du stockage Supabase : il ne
    passe ni par la conversation, ni par l'appli, ni par le dépôt.
  - Protection : l'adresse du connecteur finit par une clé aléatoire (secret
    `PORTEE_CLE`) ; sans elle, la fonction répond 404. Un connecteur OAuth
    serait disproportionné pour un seul utilisateur.
  - Le lecteur reçoit les traits des `.rm`, pas un PDF exporté. Le repère est
    le même une fois l'abscisse décentrée (+702) et l'échelle corrigée
    (226/227, voir plus bas). Les tests vérifient que la lecture ne change
    pas, même en arrondissant les traits au demi-pixel pour le transport.

- **30/09 (nuit) · Dépôt public, appli sur GitHub Pages.** Adrien a rendu le
  dépôt public et demandé un site « beaucoup plus user friendly ».
  - Le site (`.github/workflows/site.yml`) se republie à chaque fusion sur
    `main`. Hors de claude.ai, la bibliothèque vit dans le navigateur
    (IndexedDB). Une sauvegarde `.json` la passe d'un appareil à l'autre, et
    aussi de claude.ai au site.
  - Le bouton reMarkable y appelle le connecteur directement : CORS réservé à
    `adrienvada.fr` (le domaine d'Adrien, vers lequel GitHub Pages redirige
    `adrienvada.github.io`). L'adresse (avec sa clé) se colle une fois par
    navigateur : elle ne peut pas vivre dans le code d'un site public.
  - **Incident** : le premier déploiement avait écrit l'adresse du connecteur
    dans les journaux d'Actions, devenus publics avec le dépôt. Les journaux
    ont été supprimés et la clé changée. Désormais, la clé vient du secret
    GitHub `PORTEE_CLE` et n'est jamais affichée ; sans ce secret, le
    déploiement verrouille le connecteur par une clé que personne ne connaît.
- **30/09 (nuit) · Corriger sans ABC.** Adrien ne comprend pas le texte ABC
  (c'est normal). Dans « Corriger », on touche une note de la partition (ou on
  la glisse) et on choisit un geste : plus haut, plus bas, durée, point,
  altération, silence, une de plus, supprimer. Tout se fait aussi au clavier
  et s'annule. `app/edition.js` réécrit l'ABC, qui reste la seule source de
  vérité ; le texte passe en « mode avancé ».
- **30/09 (nuit) · MIDI en un clic.** Sur le site, c'est un `.mid` direct ;
  sur claude.ai, il reste zippé (liste des formats). Il est disponible depuis
  chaque carte, depuis l'écran d'écoute, et pour toute la bibliothèque d'un
  coup. Tempo et transposition sont gardés avec la partition et repris par le
  MIDI.

- **30/09 (nuit) · Bibliothèque synchronisée entre les appareils (site).**
  Choisie par Adrien parmi les suggestions.
  - Chaque appareil garde toute la bibliothèque dans son navigateur, hors
    ligne compris, et note ce qu'il change dans une file d'envois
    (IndexedDB v2).
  - La référence commune vit dans le compartiment privé
    `portee-remarkable` du stockage Supabase : `bibliotheque/<id>.json` et
    `pages/<id>.json`. Pas de table dans la base du site, pas de compte à
    créer.
  - Le connecteur la tient avec trois outils : `bibliotheque_changements`,
    `bibliotheque_pages` et `bibliotheque_ecrire`. L'adresse à coller sur
    chaque appareil est donc la même que pour la reMarkable.
  - Le plus récent gagne (`modifieLe`). Une suppression voyage comme une
    « pierre tombale ». Le curseur « depuis » suit l'horloge du stockage, pas
    celle des appareils.
  - Pourquoi pas Supabase Auth et une table avec RLS : cela voulait dire un
    compte, une migration dans la base du site et une clé anon dans le site
    public, pour un seul utilisateur.
  - La version claude.ai garde sa propre base. On passe de l'une à l'autre
    par « Sauvegarder » puis « Restaurer ».

- **01/10 · Le mémo vocal voyage avec les « pages ».** Une idée n'a pas de
  traits : son contenu lourd (le magasin `pages`, envoyé à part et seulement
  quand il change, `pagesLe`) porte son mémo, en base64. La synchronisation
  et le connecteur n'y voient que des pages : rien à redéployer. Sur
  claude.ai, il va dans `partitions/<id>/memo/audio`. Une minute au plus,
  32 kbit/s : environ 300 Ko en base64. Enregistré en MP4 quand le
  navigateur sait le faire (Safari le lit partout), sinon en WebM.
- **01/10 · Morceaux : des renvois, pas des copies.** Un bloc de morceau
  renvoie à une idée de la bibliothèque (avec un nom de section et un nombre
  de fois) : corriger l'idée corrige le morceau. Chaque bloc dure un nombre
  entier de mesures de son idée ; le tempo est celui du morceau. Un bloc dont
  l'idée a été supprimée est sauté, et le dit.
- **01/10 · L'accompagnement est calculé, pas écrit.** Il se déduit des
  accords et du style (plaqués, basse et accords, arpège) à chaque lecture,
  gravure ou export : on change l'accord, pas les notes. Le premier accord
  posé met les accords plaqués en route, pour qu'on les entende.
- **01/10 · Portée devient un carnet MIDI de poche.** Demandé par Adrien :
  « un véritable éditeur MIDI on the go pour la prise de notes de mélodies,
  de phrases musicales et de structures. Priorité : la praticité et
  l'intuitivité ». Il a validé le plan en trois étapes ci-dessous et demandé,
  pour le chant, « juste de pouvoir rentrer une note en la chantant » : pas
  de transcription d'une mélodie entière, trop fragile sur le rythme.
  - **Une idée vit en notes, pas en ABC.** Les pages lues sur la tablette
    restent en ABC (le lecteur l'écrit, l'atelier le corrige). Une idée
    notée dans l'appli est une liste de notes { début, durée, hauteur MIDI },
    comme dans Ableton (`app/sequence.js`). La grille, le clavier, le micro
    et l'enregistrement la manipulent sans se soucier de notation. La
    partition n'en est qu'une traduction en ABC, refaite à chaque changement,
    avec la carte de ses jetons pour retrouver la note touchée. Le MIDI part
    des notes (`app/midi.js`), une piste nommée par voix.
  - Pourquoi pas l'ABC pour tout : écrire au clavier ou poser une note dans
    la grille obligerait à recalculer barres, liaisons et altérations dans le
    texte à chaque geste. En notes, c'est trivial, et l'ABC se régénère.
  - Le temps se compte en **pas** (double croche) ; le jeu en direct est
    recalé sur une grille (croche par défaut).
  - Dans la bibliothèque, une idée est un document comme les autres
    (`type: "idee"`, `sequence`, et un `abc` régénéré pour les exports) : la
    synchronisation et la sauvegarde la prennent sans changement.
  - Une page lue peut **continuer en idée** (« Écouter et exporter ») :
    abcjs la joue en notes (reprises dépliées), la page d'origine ne change pas.

## Carnet MIDI de poche : le plan (01/10)

Étape 1, le cœur : noter vite, corriger au doigt, envoyer vers Ableton.
1. **« Nouvelle idée »** : un bouton en tête de la bibliothèque, et le
   raccourci de l'appli installée (Android : appui long sur l'icône). L'idée
   s'enregistre toute seule dès la première note ; vide, elle ne laisse rien.
2. **Le clavier** : à l'écran (plusieurs doigts pour un accord, ‹ › pour
   l'octave), de l'ordinateur (disposition d'Ableton : rangée A S D F… et
   W E T Y U, Z X pour l'octave) ou MIDI (Chrome et Edge ; Safari ne sait
   pas). Sans note choisie, une touche écrit à la suite, de la durée choisie,
   comme dans un texte ; avec une note choisie, elle lui donne sa hauteur.
   « Jouer en direct » : un décompte, le métronome, et les notes se recalent.
3. **La grille** au doigt : toucher une case vide pose une note, toucher une
   note la choisit, deux fois l'efface, la glisser la déplace, tirer son bord
   l'allonge. La **partition** se touche aussi. Tout s'annule et se refait.
4. **Envoyer le MIDI** : le partage du téléphone (AirDrop, Fichiers, mail),
   sinon un téléchargement. Une piste par voix, tempo, mesure et armure.

Étape 2 : **chanter une note**. Le micro reconnaît la note tenue un quart de
seconde (algorithme YIN) et l'écrit comme une touche du clavier. Une même
note redite s'écrit après une respiration. Le son ne quitte pas l'appareil.

Étape 3 : construire et ranger.
5. **Accords** sous la mélodie (proposés d'après les notes de la mesure) et
   un **accompagnement** calculé : plaqués, basse et accords, ou arpège.
6. **Boucle, métronome, tempo tapé** ; on peut modifier l'idée pendant
   qu'elle tourne.
7. **Morceaux** : des idées en blocs (intro, couplet, refrain…) qu'on
   réordonne et qu'on répète ; l'enchaînement s'écoute et part en MIDI.
8. **Carnet** : étiquettes, favoris, une note de contexte et un mémo vocal
   par idée ; recherche.
9. **Transformer une phrase** (menu en cercle sous le doigt) : transposer,
   doubler ou diviser les durées, à l'envers, en miroir, recaler, répéter.
10. **MusicXML** pour MuseScore.

## Ce que les pages d'essai ont appris

- **L'export PDF de la tablette garde les traits en vecteurs.** Chaque trait
  devient un chemin noir de largeur 1,9 pt, ajouté au PDF d'origine dans le
  repère de la page ; les lignes du modèle restent grises. Le sujet du PDF
  (`portee:<modèle>:v1`) survit à l'export. La voie manuelle (formule C, et
  secours des autres) marche donc sans `rmapi`. Le décalage d'abscisse des
  fichiers `.rm` ne concerne plus que la voie `rmapi`.
- **Une tête pleine peut être faite de plusieurs traits.** Sur la page de
  piano, presque chaque tête est noircie en deux coups. Le vérificateur fusionne
  les gribouillis dont les centres sont à moins de 0,6 interligne.
- **Les têtes sont des gribouillis compacts** (0,6 à 0,8 interligne), tracés
  bien plus longs que leur taille. C'est ce qui les distingue d'un accent,
  d'un chiffre ou d'un bémol de même taille.
- **Hampes, ligatures, crochets et lignes supplémentaires sont des traits
  séparés.** Les ligatures peuvent être très obliques et traverser d'une
  portée à l'autre (page de piano) : une note appartient à la portée de sa
  tête, pas à celle de sa hampe.
- **Sur un document PDF, la tablette compte 227 unités par pouce, pas 226.**
  Vérifié le 30/09 sur les deux pages d'essai lues par le connecteur, trait
  pour trait contre leur export PDF : l'écart vaut exactement 227/226
  (0,44 %) en x comme en y ; corrigé, il reste 0,2 px. Sans correction, le bas
  de la page glissait de 3 à 4 px : deux mesures de la mélodie étaient lues un
  cran trop bas. `tests/fixtures/rm/melodie-standard-tablette.json` garde les
  coordonnées brutes de cette page.
- **Écriture présente sur les pages**, à reconnaître aux étapes 2 et 4 :
  - chiffrage 12/8, armure à trois bémols ;
  - reprises `||:` et `:||`, accent `>` ;
  - demi-soupir et soupir, lignes supplémentaires au-dessus et au-dessous.

## Le besoin

Des partitions écrites à la main sur la reMarkable, synchronisées avec le
cloud reMarkable, doivent devenir des partitions lisibles sur le portable et
jouables avec un son de piano correct. Contrainte : **0 €**.

## Le trajet d'une page

| # | Étape | Qui | Ce qui en sort |
|---|---|---|---|
| 1 | Écrire | Adrien, sur la tablette | traits vectoriels `.rm` (format v6) |
| 2 | Récupérer | Adrien, au clic | les traits de chaque page |
| 3 | **Lire** | automatique | ABC + mesures douteuses |
| 4 | Relire | Adrien, 1 à 2 min | ABC validé |
| 5 | Écouter | le portable | SVG, MIDI, MusicXML |

**Format pivot : l'ABC.** C'est du texte : le lecteur l'écrit, on le corrige à
la main, il se convertit en partition gravée, MIDI et MusicXML (MuseScore).

**Seule l'étape 3 est incertaine.** Les autres sont de la plomberie connue.

## Les briques retenues ou à tester

- **Récupérer** : le connecteur « Portée reMarkable » (décision du 30/09,
  import à la demande). Il reprend le protocole de
  [`rmapi`](https://github.com/ddvk/rmapi) (fork maintenu par ddvk) et le
  format `.rm` v6 de [`rmscene`](https://github.com/ricklupton/rmscene), en
  JavaScript : `rmc` et Python ne servent plus.
  - API non officielle, qui a déjà cassé une fois lors d'un changement de protocole.
  - Adrien a l'abonnement Connect (30/09) : la synchro cloud est complète.
  - Secours : l'export PDF depuis la tablette, déposé dans l'appli.
- **Lire** : le papier calibré est le moteur principal (décision du 30/09).
    Les trois pistes étudiées sont gardées ci-dessous pour mémoire.
  - **Gemini** (vision), *écarté le 30/09*. Un test public de septembre 2026 sur du manuscrit
    conclut que les hauteurs se lisent, pas le rythme.
    ⚠ Les conditions de l'API réservent l'usage aux fins professionnelles et,
    pour les utilisateurs de l'EEE, aux offres payantes. En gratuit, Google
    réutilise les contenus envoyés.
  - **[JAZZMUS](https://huggingface.co/JuanCarlosMartinezSevilla/jazzmus-model)** :
    modèle libre (MIT, 16 M de paramètres) entraîné sur des grilles de jazz
    manuscrites (mélodie + accords). Il sort du `**kern` et tourne sur CPU.
    Il ne lit qu'une ligne mélodique.
  - **Papier calibré** : l'outil génère un PDF de portées aux positions
    connues. On écrit dessus, et la hauteur de chaque note se calcule à partir
    des coordonnées des traits. Le rythme se lit aux formes (têtes, hampes,
    ligatures). Silences et altérations passent par un classifieur entraîné
    sur [HOMUS](https://grfia.dlsi.ua.es/homus/).
  - Écartés : Audiveris, oemer, homr, LEGATO, tous entraînés sur de l'imprimé.
  - Retenu : le papier calibré lit hauteurs et rythmes à partir des traits.
    JAZZMUS peut servir de second avis sur les mélodies ; leurs désaccords
    deviennent des mesures à relire.
  - Piste pour plus tard, sans coût supplémentaire : une routine Claude Code
    (dans l'abonnement d'Adrien) qui relit les pages douteuses.
- **Relire** : un atelier dans l'appli. La page manuscrite et la partition
  gravée sont côte à côte, avec l'ABC éditable dessous et les doutes surlignés.
  MuseScore sert pour les gros chantiers.
- **Afficher** : [abcjs](https://www.abcjs.net/) 6.7.1 (MIT), qui gère
  gravure, curseur et transposition. Verovio reste en réserve.
- **Piano** : [smplr](https://github.com/danigb/smplr) `SplendidGrandPiano`,
  un Steinway sur 4 nuances en domaine public. Le Salamander (CC-BY) reste en
  réserve.
- **Ableton Live 12 (licence d'Adrien) et ses VST**, en plus du navigateur.
  - L'appli exporte un MIDI avec une piste par main et le tempo (vérifié :
    `ABCJS.synth.getMidiFile` sort un format 1 avec une piste par voix).
  - Glissé dans Live, il joue sur le piano de Live ou sur les VST, pour arranger.
  - Plus tard : un dossier de `.mid` synchronisé, ajouté aux « Places » de Live.
  - Plus tard : une « version enregistrée », c'est-à-dire le rendu audio de Live
    rangé avec la partition. Le lecteur la suit avec le curseur (même tempo,
    même départ).
  - Ne pas extraire les sons des VST pour le piano du navigateur sans vérifier
    leurs licences.

## Trois formules

| | A · Carnet GitHub | **B · Atelier (recommandée)** | C · Glisser-déposer |
|---|---|---|---|
| Récupération | auto (rmapi) | auto + bouton | manuelle |
| Stockage | fichiers dans le dépôt | Supabase (projet du site, schéma `musique`) | navigateur |
| Corriger dans l'appli | non | oui, avec historique | oui, un appareil |
| Pièce fragile | rmapi | rmapi | aucune |

## Contraintes relevées dans les autres dépôts

- **Supabase** : l'offre gratuite plafonne à 2 projets actifs. Le site
  (`adrienvada-site`) et Candela en occupent déjà deux. Musique irait donc dans
  le projet du site. Un projet s'endort après une semaine sans requête.
- **GitHub Pages** n'est gratuit que pour un dépôt public : c'est le cas
  depuis le 30/09.
- **Dépôt public** : tout ce qui s'écrit dans les journaux d'Actions est
  public. Ne jamais y afficher de clé ni d'adresse secrète.

## Où en est chaque étape

0. **Modèles de papier calibré** : *fait (v1)*.
1. **Pages d'essai** : *fait*. Import depuis la reMarkable : *code fait, connecteur
   déployé le 30/09 dans le projet du site* (par GitHub Actions), ajouté à
   claude.ai, tablette reliée. Vérifié sur les deux vraies pages d'essai :
   même lecture que leur PDF, après correction de l'échelle (227/226).
2. **Lecture des notes** : *fait (v1)*. Le lecteur reconnaît :
   - hauteurs, têtes pleines et vides, hampes, crochets et ligatures (niveaux compris) ;
   - points de durée, barres simples, doubles et reprises ;
   - armure ;
   - chiffrage, deviné d'après la durée des mesures (compte en croches, groupes de trois → x/8).
3. **Écouter et exporter** : *fait*. Gravure abcjs, piano Steinway
   échantillonné, curseur, tempo, transposition, mains séparables, raccourci
   Espace. MIDI en un clic (tempo et transposition compris), impression ou
   PDF, texte ABC.
4. **Autres signes** : *en partie*.
   - Reconnus : soupirs et demi-soupirs, bémols (un ou deux traits), dièses
     (au moins trois traits), accents.
   - Pas encore : pauses et demi-pauses, silences courts, liaisons de durée,
     triolets, lecture des chiffres du chiffrage. Le classifieur HOMUS reste à faire.
5. **Corriger** : *fait*. Correction au toucher (voir la décision du 30/09),
   ta page redessinée à côté, les doutes surlignés, « Annuler », enregistrement
   automatique. L'ABC reste accessible en mode avancé.
6. **Bouton « Parcourir ma reMarkable »** : *fait*. Arborescence, recherche,
   import au clic, « Réimporter » pour une page complétée depuis. Même état que
   l'étape 1.
7. **Site GitHub Pages** : *fait*. Installable (manifeste, icônes), hors ligne
   (service worker), bibliothèque IndexedDB, sauvegarde et restauration,
   modèles téléchargeables, accueil en trois étapes. **Bibliothèque
   synchronisée** entre les appareils : *fait et testé* (Node : deux
   appareils, conflits, hors ligne ; Chromium : ordinateur et téléphone).
8. *(option)* Second avis JAZZMUS. 9. *(option)* MusicXML.
11. **Carnet MIDI de poche** (plan du 01/10, plus haut) :
    - étape 1 (« Nouvelle idée », clavier à l'écran, de l'ordinateur et
      MIDI, jeu en direct, grille, partition touchable, envoi du MIDI) :
      *fait et testé* (Node : écriture ABC relue par abcjs sur mille idées
      au hasard, MIDI relu octet par octet ; Chromium au format téléphone :
      saisie, sélection, annuler, partition, écoute, rechargement) ;
    - étape 2 (chanter une note) : *fait et testé* (Node : sons fabriqués ;
      Chromium : un « chanteur » de synthèse dans un faux micro) ;
    - étape 3 : accords (proposés d'après la mélodie, feuille au-dessus de
      la grille, « Proposer pour toute l'idée »), accompagnement (plaqués,
      basse et accords, arpège), boucle, métronome, tempo tapé, morceaux en
      blocs : *faits et testés* (Node : suggestions, accompagnement,
      assemblage ; Chromium : accords sur ordinateur, morceau au téléphone).
      Carnet (note, étiquettes, favori, mémo vocal d'une minute, recherche,
      filtres, groupes par date, « Mémo vocal » d'un toucher), menu en
      cercle (appui long sur une note, ou « Transformer… »), choix d'une
      phrase au doigt (« + suivante », « Tout »), MusicXML (idées et pages
      lues) : *faits et testés* (Node : MusicXML relu, mémo synchronisé
      entre deux appareils ; Chromium : carnet, mémo au faux micro, menu en
      cercle, MusicXML).
   10. *(option)* Passerelle Ableton : le MIDI (une piste par main) y va déjà en un glisser.

## Brancher la reMarkable (une fois)

1. **Déployer le connecteur** dans le projet Supabase du site. GitHub Actions
   s'en charge (`.github/workflows/connecteur.yml`) à chaque changement du
   connecteur fusionné sur `main`. Il faut deux secrets du dépôt :
   - `SUPABASE_ACCESS_TOKEN` : un jeton d'accès Supabase
     (supabase.com/dashboard/account/tokens) ;
   - `PORTEE_CLE` : la clé de l'adresse, au moins 24 caractères aléatoires.
     Elle n'apparaît jamais dans les journaux, publics.

   L'adresse du connecteur est
   `https://omekkqjinvppadsoinvj.supabase.co/functions/v1/portee-remarkable/<PORTEE_CLE>`.
   Sans GitHub, depuis un terminal : `SUPABASE_ACCESS_TOKEN=sbp_… npm run connecteur -- <ref>`.
2. **L'ajouter à claude.ai** : Paramètres → Connecteurs → Ajouter un connecteur
   personnalisé. Nom : **Portée reMarkable**, exactement (l'appli l'appelle par
   ce nom). URL : celle du script.
3. **Relier la tablette depuis Portée** : « Importer de ma reMarkable ».
   claude.ai demande d'autoriser la page. Ensuite, recopier le code à 8
   lettres de my.remarkable.com/device/desktop/connect, puis « Relier ».
4. **Sur le site GitHub Pages**, coller une fois l'adresse du connecteur dans
   chaque navigateur (« Importer de ma reMarkable » la demande). La tablette,
   elle, reste reliée : c'est le même connecteur.

Changer la clé : mettre la nouvelle valeur dans le secret `PORTEE_CLE`, relancer
le workflow « Connecteur reMarkable » (Actions → Run workflow), puis mettre la
nouvelle adresse dans claude.ai et sur le site.

Pour couper l'accès : retirer l'appareil « desktop-linux » sur my.remarkable.com,
ou supprimer la fonction dans Supabase.

## Pièges connus

- **pdf.js 6** utilise `Map.prototype.getOrInsertComputed`, absent des
  navigateurs de 2026 : il faut prendre la version `legacy/`.
- **Le publieur de claude.ai refuse les caractères de contrôle bruts.** Le
  worker de pdf.js en contient 719 dans une table de données.
  `assembler-appli.mjs` les réécrit en `\xNN`, ce qui revient au même.
- **Les téléchargements d'une page claude.ai suivent une liste fermée de
  formats**, sans `.mid`. Le MIDI part donc dans un `.zip` (`app/zip.js`).
- **Tête noircie en deux coups, hampe repassée, ligature tracée en deux
  fois** : le lecteur fusionne, recolle et ignore ces retouches. Ne pas
  retirer ces étapes sans relancer `npm test`.
- **Seuils du lecteur** : ils sont exprimés en interlignes et réglés sur les
  pages du 30/09. Tout réglage qui change une lecture doit mettre à jour
  `tests/lecteur.test.mjs` dans le même commit.
- **Traits arrondis au demi-pixel par le connecteur.** Des seuils trop justes
  font basculer une lecture (une ligature à 0,80 interligne, deux bémols
  fusionnés). Le test « arrondir les traits » garde la lecture identique pour
  des pas de 0 à 1 px.
- **Le projet Supabase gratuit s'endort** après une semaine sans requête. Le
  connecteur répond alors « ne répond pas » : relancer le projet depuis le
  tableau de bord.
- **Supabase ne rend jamais la valeur d'un secret.** L'adresse du connecteur
  se note au déploiement. Perdue : `npm run connecteur -- <ref> --nouvelle-cle`,
  puis changer l'URL dans claude.ai.
- **Code à 8 lettres** : il expire en quelques minutes et ne sert qu'une fois.
- **Synchronisation et horloges** : un appareil dont l'horloge retarde
  pourrait écrire un `modifieLe` plus ancien que la version qu'il vient de
  recevoir, et la bibliothèque commune refuserait sa correction.
  `stockage.modifier` rend donc chaque `modifieLe` strictement plus récent que
  le précédent. Un envoi refusé applique aussitôt la version gagnante.
- **IndexedDB `portee`, version 2** : magasins `partitions`, `pages`, `envois`
  (file à synchroniser) et `meta` (curseur, adresse, « rejoint »). Changer
  l'adresse du connecteur remet le curseur à zéro : une autre adresse, c'est
  une autre bibliothèque commune.
- **Domaine du site** : GitHub Pages sert le site sous le domaine personnalisé
  d'Adrien (`adrienvada.fr/Musique/`). Le navigateur envoie donc l'origine
  `https://adrienvada.fr`, qui doit figurer dans `ORIGINES` (`http.js`).
  Sinon, il bloque les appels au connecteur (reMarkable et synchronisation).
- **Préflight CORS** : la fonction y répond 204 même avec une mauvaise clé.
  Sinon, le navigateur bloque tout, et le site ne peut pas distinguer
  « adresse incorrecte » de « connecteur injoignable ».
- **abcjs capte les clics sur toute la partition** et retrouve la note la
  plus proche : dans les tests Playwright, cliquer aux coordonnées de la note
  (`page.mouse.click`), pas sur l'élément. Un glissé compte les degrés vers
  le bas (`drag.step` positif = plus grave).
- **Noms de fichiers accentués** : sans locale UTF-8, le Chromium des tests
  les télécharge sous le nom « download ». Il faut lancer Chromium avec
  `LANG=C.UTF-8`. Les vrais navigateurs gardent les accents.
- **Clé posée avant le déploiement.** La fonction lit `PORTEE_CLE` à son
  démarrage : posée après, une instance déjà chaude répondrait 404. Si la
  première mise en place échoue, le script retire la clé neuve, pour que
  l'essai suivant en tire une autre et affiche l'adresse.

- **abcjs et les liaisons dans les accords.** abcjs ne lie, d'un accord au
  suivant, que l'accord entier, ou la note de même rang (ce qui casse dès
  qu'une note s'ajoute ou part). `sequence.js` range donc les notes d'une voix
  en couches (« & » en ABC) où chaque accord est homogène, et écrit chaque
  couche dans toutes les mesures, même vide (sinon abcjs y invente un
  silence). abcjs oublie aussi les altérations d'une couche à l'autre : une
  note altérée ailleurs dans la mesure redit la sienne.
- **Noms de classes CSS.** `.vide` et `.grille` existaient déjà (accueil,
  cartes de la bibliothèque) : la grille de notes s'appelle `.grille-notes`,
  ses éléments `g-…`.
- **Écran Idée en pleine hauteur** (`body.plein`) : `main` y perd sa marge
  automatique, sinon un élément trop large (la barre de sélection) élargit
  toute la page sur téléphone.
- **Micro et clavier MIDI** : ni l'un ni l'autre dans la page claude.ai
  (cadre sans ces permissions) ; Safari (iPhone, iPad) ne lit pas les
  claviers MIDI. Le micro et le son ne marchent pas en même temps : on coupe
  l'un pour l'autre (sinon le piano repasse dans le micro).

## Questions ouvertes

1. Tes pages d'essai du 30/09 : ce que tu voulais écrire. La 3ᵉ mesure de la
   ligne 2 fait 11 croches au lieu de 12 : est-ce le petit trait au bout d'une
   hampe, un crochet oublié ?
2. Les modèles v1 conviennent-ils à la main (interlignes, nombre de portées) ?
