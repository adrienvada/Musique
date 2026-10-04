# Propositions — de la tablette au piano

*Mis à jour le 2 octobre 2026 : refonte visuelle complète (système Papier et Studio, puis les écrans un à un).*

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
    recalé sur une grille (croche par défaut). Jeu lié : une note relâchée
    au plus un pas de grille avant la suivante tient jusqu'à elle (des
    noires jouées un peu détachées restent des noires) ; au-delà, c'est un
    silence.
  - Dans la bibliothèque, une idée est un document comme les autres
    (`type: "idee"`, `sequence`, et un `abc` régénéré pour les exports) : la
    synchronisation et la sauvegarde la prennent sans changement.
  - Une page lue peut **continuer en idée** (« Écouter et exporter ») :
    abcjs la joue en notes (reprises dépliées), la page d'origine ne change pas.

- **02/10 · Refonte visuelle complète, dans l'ordre proposé.** Adrien a
  vu les dix prototypes (https://claude.ai/artifact/8Wbx95N15P8EtKF4yVBroA)
  et demandé de les implémenter tous, dans l'ordre conseillé : le système
  d'abord (1), puis l'écran Idée (3), puis les autres (voir « La refonte
  visuelle : le plan » plus bas).
  - **Deux ambiances, un seul système.** Papier pour lire et ranger
    (bibliothèque, pages, morceaux ; suit le clair ou sombre du téléphone),
    Studio pour jouer (l'éditeur d'idée, sombre par défaut : les notes et le
    clavier ressortent, et l'écran n'éblouit pas le soir). Un réglage rend
    le Papier à l'éditeur.
  - **Une seule famille d'icônes** (`app/icones.js`), au trait : les
    caractères (▶ ↶ ✕ ★ ⠿ •••) et l'emoji du micro se dessinaient
    différemment selon la police et se lisaient mal au lecteur d'écran.
  - **Une feuille de style par écran** (`app/styles/`) au lieu d'un seul
    bloc dans la page : chaque écran ne prend que les jetons et composants
    du système, et plusieurs refontes avancent sans se marcher dessus.
  - **Les messages passagers en haut** : en bas, ils cachaient le clavier
    et la liste, là où va le pouce.
- **02/10 · Chanter : la voix se voit sur la grille (refonte 7).** On
  devinait sa voix à une aiguille, sans voir où elle allait ni combien de
  temps il restait à tenir. Les rangées de la grille sont déjà les notes : la
  voix s'y trace en direct (un trait surligneur qui défile, un point au bout
  dont l'anneau se remplit pendant la tenue, la rangée visée qui s'allume, et
  la grille qui défile en hauteur pour la suivre ; une couche isolée de
  `grille.js`, qui ne prend aucun toucher).
  - L'accordeur du pupitre devient lisible de loin : le nom de la note en très
    grand, un verdict en mots (« juste », « un peu haut », « un peu bas »),
    une jauge dont le milieu est la zone juste (± 10 centièmes), une barre de
    tenue puis un éclat quand la note s'écrit, et les dernières notes de
    l'idée en puces (elles viennent de l'idée : « Annuler » les corrige).
  - La durée des notes chantées se choisit sans quitter le mode ; c'est la
    même que celle du mode Clavier.
  - Rien d'enregistré, rien de transcrit : la détection (YIN) n'a pas changé,
    `micro.js` dit seulement en plus la hauteur exacte et l'avancée de la
    tenue. Une note tenue s'écrit toujours toute seule, comme Adrien l'a
    demandé. Le verdict est lissé (le vibrato ne le fait pas sauter) et un
    saut d'octave isolé n'est pas tracé.
  - Le curseur d'écriture reste visible en Chanter : il dit où la note
    s'écrira, ce que le trait ne dit pas.
- **02/10 · Les accords sur une roue, l'accompagnement visible (refonte 8).**
  La feuille des accords n'était qu'une liste de boutons : on n'y voyait ni
  la logique de la tonalité ni ce que l'accompagnement allait jouer, et son
  style se cachait dans la feuille Tempo.
  - Elle montre la bande des mesures (une mesure à deux accords s'y coupe en
    deux), un aperçu de la mesure en mini rouleau de piano (mélodie en bleu,
    accompagnement calculé en gris, qu'on écoute), la roue des sept accords
    de la tonalité (l'accord posé au centre avec ses notes en clair), les
    couleurs (simple, septième, sus4, add9) et quatre cartes de style qui
    dessinent leur motif et s'entendent.
  - Deux marques, les mêmes sur la roue et sur les six touches du pupitre :
    *cerclés*, les accords qui viennent souvent après celui de la mesure
    d'avant (une petite table de fonctions dans `harmonie.js` : tonique,
    sous-dominante, dominante ; si tout était cerclé, rien ne se
    détacherait) ; *teintés*, ceux que `suggerer` propose d'après la mélodie.
  - Le style reste `seq.accompagnement` : les cartes et le menu de la feuille
    Tempo affichent la même donnée. Le motif des cartes est calculé par
    l'accompagnement lui-même (`motifAccompagnement`) : il ne peut pas
    s'écarter de ce qui sonne, et il suit la mesure.
  - En mineur, la dominante de la roue est le V majeur (mi en la mineur),
    comme dans `harmoniser` : c'est elle qui tire vers la tonique ; le v reste
    dans « Un autre accord ». « Septième » donne la septième de la tonalité
    (Cmaj7, G7, Dm7, Bm7b5).
- **02/10 · Supprimer depuis la liste.** Adrien : « c'est normal que je ne
  puisse supprimer aucune partition ? ». Supprimer n'existait que de
  l'intérieur (le « ••• » de l'écran d'une partition, d'une idée ou d'un
  morceau) ; le « ••• » d'une ligne du carnet ou d'une carte, là où on le
  cherche, ne le proposait pas. Il le propose maintenant, en dernier et en
  rouge, et la question vient ensuite, dans la fenêtre de l'appli (Annuler
  garde tout). Pour une idée qui sert dans un morceau, la question le dit :
  sa partie y sera sautée. La suppression d'une idée et celle d'un morceau
  ouverts posent la même question au lieu de `window.confirm` : la fenêtre
  du navigateur ne suit pas l'ambiance, et une page intégrée (claude.ai)
  peut ne pas avoir le droit de l'ouvrir, la réponse est alors « non » sans
  rien montrer. (Le mémo vocal s'efface encore avec `window.confirm`.)
- **02/10 · Le site ne mélange plus deux versions après une mise en ligne.**
  Adrien a ouvert le site une minute après la fusion de la PR #8 : barre
  sans titre, anciennes icônes, grille vide (« je ne vois plus rien »). La
  page était neuve et ses modules anciens : GitHub Pages laisse chaque
  fichier dix minutes dans le cache du navigateur (`max-age=600`), et un
  rechargement reprend même les modules gardés en mémoire sans rien
  demander, pas même au service worker. L'ancien `idee.js` cherchait le
  bouton de zoom disparu et l'éditeur plantait. Reproduit dans Chromium avec
  un serveur qui cache comme Pages, puis corrigé :
  - à l'assemblage du site, chaque module et chaque feuille de style porte
    la version dans son adresse (`idee.js?v=…`, tous les imports relatifs ;
    l'assembleur refuse un import qu'il n'a pas su versionner, car un
    module importé sous deux adresses serait chargé deux fois). Pourquoi
    plutôt que des en-têtes : Pages ne laisse pas choisir son `Cache-Control`,
    et une adresse neuve échappe à tous les caches à la fois ;
  - le service worker redemande la page (et les fichiers sans version) au
    serveur plutôt qu'au cache du navigateur : la page est toujours la
    dernière, et ses modules suivent ;
  - la version claude.ai n'est pas touchée (pas de service worker, pas de
    cache Pages).
  La première mise en ligne de cette correction peut encore montrer
  l'ancienne version entière (jamais un mélange) jusqu'au rechargement suivant.
- **02/10 · Un appui long sur une icône dit ce qu'elle fait.** Demandé par
  Adrien (« quand je laisse appuyé mon doigt sur une icône, il faudrait
  qu'il y ait sa description »). Au doigt, il n'y a pas de survol : le titre
  d'un bouton ne se voyait jamais. Une demi-seconde de doigt sur un bouton à
  icône montre une infobulle au-dessus (dessous dans la barre du haut) ; le
  doigt levé, le bouton ne se déclenche pas, et la bulle part au bout d'une
  seconde et demie. Glisser avant annule (on fait défiler).
  - Pourquoi un seul module (`app/infobulles.js`, en capture sur toute la
    page) plutôt qu'un appui long par bouton : les icônes naissent partout
    (barres, pilule, feuilles, lignes du carnet), et chacune a déjà sa
    description, celle du lecteur d'écran (`title` ou `aria-label`). La
    bulle prend la plus longue des deux, sans les raccourcis clavier
    (« (Maj + ↑) » ne sert à rien au doigt).
  - Ce qui a déjà son propre appui long garde le sien et porte
    `data-sans-infobulle` : le bouton rouge (le réglage du décompte), le
    clavier et sa carte (tenir la note). Les notes de la grille ne sont pas
    des boutons à icône : leur appui long ouvre toujours le cercle.
  - À la souris, rien ne change (le navigateur montre le titre au survol).
  - Piège : la classe `.bulle` était déjà prise (la pastille des onglets du
    bas) ; c'est `.infobulle`.
- **02/10 · La grille zoome aussi en hauteur ; Grille | Partition dans la
  barre.** Demandé par Adrien (« zoomer dans le piano roll sur l'axe
  vertical aussi », « switcher en piano roll et partition »).
  - **Le zoom** : pincer en largeur étire le temps (comme avant), pincer en
    hauteur agrandit les rangées (de 6 px, plus de quatre octaves dans la
    vue d'un téléphone, à 44 px, la taille d'un doigt), en biais les deux ;
    la vue suit le milieu des doigts. Pourquoi deux axes séparés plutôt
    qu'un zoom d'ensemble : la mélodie demande souvent plus de place en
    hauteur qu'en temps (ou l'inverse), comme dans GarageBand. Un écart de
    moins de 60 px entre les doigts sur un axe compte pour 60 px
    (`facteursPince`) : deux doigts posés côte à côte ne sont jamais à la
    même hauteur, et ce petit écart ne doit pas faire bondir les rangées
    pendant qu'on zoome dans le temps. À la souris : Ctrl + molette (le
    temps), Alt + molette (la hauteur), comme dans Ableton ; dans « Tempo
    et mesure », des boutons − et + pour chaque axe. Le zoom choisi se
    garde sur l'appareil (`portee:zoom-grille`) : on le règle une fois à
    sa main. Sous 13 px de haut, une note ne porte plus son nom.
  - **Grille | Partition** : les deux côte à côte dans la barre du haut,
    celui qu'on voit allumé (au téléphone en icônes, avec les mots dès
    que la barre a la place). Avant, un seul bouton montrait l'autre
    affichage, avec une icône de lignes qu'on prenait pour un menu :
    Adrien ne trouvait pas la partition. Les icônes sont redessinées : des
    barres décalées au bord d'un clavier (la grille), deux croches liées
    (la partition).
- **02/10 · Le bouton « précédent » recule dans l'appli.** Demandé par
  Adrien (« que ça gère mieux quand on fait précédent »). Portée est une
  seule page : le précédent du téléphone (ou du navigateur, ou le geste de
  retour) la quittait au lieu de fermer la feuille ouverte ou de revenir à
  l'écran d'avant. Chaque « précédent » défait maintenant un pas, du plus
  proche au plus lointain : la feuille ou le menu ouvert, le jeu en direct
  (il s'arrête, et la feuille de l'arrondi s'ouvre), les notes choisies,
  l'écran (celui d'où l'on venait : le morceau quand on avait ouvert l'idée
  d'un de ses blocs, sinon l'accueil), puis l'onglet Carnet ; au carnet, le
  précédent suivant quitte Portée, comme partout. La flèche de retour des
  écrans ramène aussi à l'écran d'avant, pas toujours à l'accueil.
  - Pourquoi une seule entrée d'historique « de garde » (`app/historique.js`)
    plutôt qu'une par écran et par feuille : tout ce qui s'ouvre et se
    ferme d'un toucher, d'Échap ou du voile aurait dû rester en phase avec
    l'historique, et un retrait d'entrée (`history.back()`) est asynchrone.
    La garde se pose dès que l'appli quitte sa racine (le carnet, rien
    d'ouvert) et s'en va quand elle y revient ; le module voit ce qui
    s'ouvre (`<dialog open>`, `hidden`, onglets) sans que les écrans aient à
    le prévenir.
- **02/10 · La sélection : une pilule, une boîte à outils, un cercle rangé
  (refonte 5).** Le menu en cercle alignait douze gestes en symboles sans
  les regrouper, et c'était le seul chemin vers la moitié d'entre eux.
  Chaque geste a maintenant sa place, du plus rapide au plus complet.
  - **La pilule** garde ce qu'on fait cent fois : ½ ton et octave, plus haut
    ou plus bas, effacer, et « ••• ». Les durées ×2 et ÷2 n'y tenaient pas
    au téléphone : elles passent dans la boîte.
  - **La boîte à outils** (« ••• », une feuille du bas) est titrée par ce qui
    est choisi (« si4, croche », « 4 notes choisies ») et rangée en Durée,
    Rythme (plus lent, plus vite, recaler, répéter), Motif (à l'envers,
    miroir) et Ailleurs (idée à part, effacer). Un geste s'applique et la
    feuille reste ouverte, parce qu'on en enchaîne plusieurs : la grille
    bouge derrière et une ligne dit ce qui s'est passé. La feuille rend le
    pupitre inerte, donc elle a son propre « Annuler ». Un geste qui ne
    changerait rien ne laisse pas d'« Annuler » pour rien.
  - **Le cercle** reste le raccourci de l'appui long : dix gestes en quatre
    familles, chacune sur sa bande avec son nom ; la hauteur monte le long
    du côté gauche, le creux est en bas, sous la main. « Répéter » et
    « recaler » n'y sont plus (la boîte et la rangée jaune les ont).
- **02/10 · Jouer en direct, avec une scène (refonte 6).** Avant, rien ne
  disait qu'on enregistrait, ni quel temps tombait, et le recalage se faisait
  d'office sans rien montrer. Pendant le décompte et la prise, la grille
  laisse la place à une scène lisible à bout de bras ; le pupitre et son
  clavier restent dessous, parce qu'on joue avec.
  - Le décompte est un chiffre géant au vrai tempo, sur un aplat du
    surligneur (du jaune seul n'a pas le contraste sur le Papier clair).
    Pendant la prise : un cadre rouge, un point qui clignote et le chrono, le
    numéro de la mesure en grand, les points des temps et un ruban des notes
    jouées avec la tête de lecture ; « Arrêter » en gros.
  - **L'arrondi se choisit après coup, en voyant ce qu'il change** : à
    l'arrêt, une feuille montre « Tel que joué » et « Arrondi » côte à côte,
    avec la grille (noire, croche, double croche) ; l'aperçu suit le choix.
    « Garder » écrit en un seul pas d'« Annuler » ; fermer la feuille sans
    choisir garde aussi (on ne perd jamais ce qu'on a joué) ; « Recommencer »
    relance le décompte. La grille choisie est retenue (`portee:arrondi`) et
    sert aussi à « Recaler » ; elle vit donc aussi dans la feuille Tempo.
  - Le décompte (aucun, 1 ou 2 mesures, `portee:decompte`) se règle dans la
    feuille Tempo, ou d'un appui long sur le bouton rouge. Pendant une
    prise, « Annuler » et « Refaire » ne font rien : ils l'arrêtaient au
    passage.
- **02/10 · Le clavier montre la gamme (refonte 4).** Le clavier à l'écran ne
  disait rien de l'idée : neuf touches sans repère, aucune idée de la gamme,
  une octave invisible qu'on changeait à l'aveugle.
  - Une pastille bleue marque les touches de la gamme de l'idée (la tonique
    cerclée ; les autres restent jouables, atténuées), et chaque touche
    blanche porte son nom (do4 pour le do). En mineur, la gamme est le
    mineur naturel, celui de l'armure.
  - **Piano ou Gamme** (retenu) : en Gamme, huit grosses touches, les sept
    degrés et l'octave, épelées dans la tonalité (Fa♯, Si♭) : pas de fausse
    note possible. Elles écrivent par le même chemin que le piano, donc le
    jeu en direct et la note choisie marchent pareil.
  - **La carte des octaves** (do2 à do6) montre l'octave affichée et y saute
    d'un toucher ou d'un glissé ; Z / X la suivent, et les touches de
    l'ordinateur jouent l'octave montrée (avant, Z / X bougeaient une octave
    invisible).
  - Le pupitre garde sa hauteur, pour que la grille ne rétrécisse pas : le
    choix Piano / Gamme et la carte tiennent sur une rangée, et les chevrons
    quittent les flancs du clavier, dont les touches passent de 34 à 46 px de
    large (mais de 155 à 113 px de haut au téléphone, 78 px sur un écran de
    667 px). Quand une note est choisie, la rangée de sélection prend la
    place de cette barre, et le clavier montre de lui-même sa hauteur.
  - Réglage : « Montrer la gamme sur le clavier » (Réglages › Éditeur, oui
    par défaut) coupe les pastilles, pas le mode Gamme ni les noms.
- **02/10 · L'écran Idée en studio de poche (refonte 3).** Une seule barre
  en haut : le titre, et dessous le tempo, la mesure et la tonalité, qu'on
  touche pour ouvrir « Tempo et mesure ». La grille passe de 41 % à 52 % de
  l'écran du téléphone : trois rangées de commandes et des volets posés sur
  les notes la mangeaient. Les réglages, « ••• », le carnet et les accords
  passent dans des feuilles du bas. Le pupitre reste sous le pouce : le
  transport, puis trois modes, Clavier, Chanter (l'accordeur dans le
  pupitre ; le micro écoute tant que le mode est ouvert et se tait quand le
  piano joue) et Accords (les six accords de la tonalité, posés sur la
  mesure choisie). Le dernier mode est retenu ; l'accueil ouvre une idée
  directement en Chanter.
  - **La sélection** : une pilule au-dessus des notes choisies, qui ne sort
    jamais de l'écran, et une rangée dans le pupitre pour le reste. La barre
    qui défilait de côté cachait la moitié de ses gestes. La rangée s'ajoute
    au-dessus du mode au lieu de remplacer les durées : la durée est la
    correction la plus fréquente, et changer de mode ne doit pas obliger à
    désélectionner.
  - **La règle** n'écrit « + accord » que sur la mesure choisie : répété
    partout, c'était du bruit. La note choisie est jaune avec un anneau du
    fond, sans bord brun. La partition remplit la place de la grille.
  - **Un module par refonte à venir** : `idee.js` garde le cœur (état,
    annuler, sauvegarde, dessin, transport, barre, feuilles) ; le mode
    Clavier, le chant, les accords, la sélection et le jeu en direct vivent
    chacun dans un `idee-*.js` (et un `idee-*.css`) qui reçoit un contexte
    explicite.
  - Pièges : une feuille du bas ouverte au `pointerdown` se referme aussitôt
    (le clic du même doigt tombe sur son voile) : on l'ouvre au `click`. Hors
    d'un geste, Safari peut garder le son du micro endormi : au bout d'une
    seconde et demie, on demande un toucher.
- **02/10 · Pages manuscrites : la page d'abord, les doutes un par un
  (refonte 10).** Un doute en prose, sous une page de boutons grisés, ne se
  règle pas quand on ne lit pas l'ABC. « Corriger » et « Écouter » ont
  désormais leur barre, et les doutes passent dans un panneau fixé en bas
  (pas une fenêtre : la page reste sous les yeux).
  - **Corriger** : « Ta page | Lue | Les deux » (côte à côte à
    l'ordinateur), des repères numérotés sur la page, un doute à la fois
    avec une loupe sur le passage, une question fermée (« Croche ou
    noire ? », « Il manque une croche ») et de gros boutons. Une réponse
    applique le vrai geste d'`edition.js` sur la bonne note et règle le
    doute dans le même pas : « Annuler » défait les deux. « Je corrige
    moi-même » et « C'est voulu » restent possibles. Les outils d'une note
    n'apparaissent qu'avec une note choisie.
  - **Pourquoi ça marche sans lire l'ABC** : le lecteur écrit pour chaque
    doute son `type` et sa `cible` (où tombe la note ou la mesure dans l'ABC
    produit), sans changer l'ABC (les tests du lecteur n'ont pas bougé).
    `app/doutes.js` fait suivre ces places à chaque correction ; si la note
    disparaît, la question se pose sans réponse fermée. Les pages lues avant
    retrouvent leurs cibles en relisant leurs traits, tant qu'on n'y a pas
    touché. Les réponses se calculent sur l'ABC d'aujourd'hui.
  - **Écouter** : transport fixé en bas, MIDI et impression en haut, les
    autres formats et « Supprimer » dans « ••• ».
  - Pas fait : « Non, sans armure » pour le doute d'armure, qu'aucun geste
    d'`edition.js` ne sait écrire.
- **02/10 · L'accueil en quatre onglets (refonte 2).** L'accueil se lit comme
  un carnet : on note d'abord, on retrouve ensuite. Il avait ~520 px
  d'en-tête, de filtres et de boutons avant la première partition, et quatre
  boutons empilés en pied de page ; il montre maintenant six lignes sur un
  téléphone.
  - Quatre onglets (Carnet, Partitions, Morceaux, Réglages) vivent dans la
    vue `biblio`, qui reste une seule vue pour `montrer()`. La barre
    d'onglets se fixe en bas au téléphone et n'existe que sur l'accueil.
    L'onglet courant est retenu (`portee:onglet`).
  - Le Carnet commence par « Noter une idée » : Jouer, Chanter (l'éditeur
    s'ouvre dans ce mode) et Mémo. Chaque ligne a son étoile et « ••• », une
    feuille du bas qui porte les actions de l'ancienne carte (ouvrir ou
    corriger, écouter, MIDI, favori).
  - Partitions regroupe les pages de la tablette, leurs imports et les
    modèles ; le dépôt d'un PDF marche sur tout l'accueil. Réglages
    rassemble la tablette, la synchronisation, l'ambiance de l'éditeur
    (Studio ou Papier), la sauvegarde et l'installation.
  - Le dessin de l'accueil est dans `app/accueil.js`, qui reçoit ses
    dépendances comme l'éditeur ; `app.js` garde le stockage, la tablette
    et la synchro. Piège : le dépôt d'un PDF doit faire `preventDefault`,
    sinon le navigateur quitte Portée pour afficher le fichier.
- **02/10 · Morceaux : la structure en frise colorée (refonte 9).** L'écran
  montre d'abord le morceau d'en haut : une frise, un segment par bloc aussi
  long que son passage (mesures × fois), avec une tête de lecture qui suit le
  transport ; dessous, une carte par bloc, compacte, sauf celle qu'on choisit,
  qui montre ses gestes (plus tôt, plus tard, une fois de plus ou de moins,
  écouter, ouvrir l'idée, retirer). « Ajouter une partie » et « ••• » (tempo,
  MIDI, suppression) ouvrent des feuilles du bas. Pourquoi : huit boutons par
  bloc noyaient la structure, qu'on cherche d'abord à voir.
  - **Une même idée garde sa couleur partout** (frise, cartes, choix d'une
    idée, vignette de la bibliothèque) : la couleur vient de l'idée
    (`couleursDesIdees`, `morceau.js`), pas de la place du bloc ni du nom de
    la section, pour que réordonner ou répéter ne recolore rien. Six couleurs
    (`--section-1` à `--section-6`, dans `morceau.css`), tirées des jetons du
    système, lisibles en clair comme en sombre.
  - Les cartes ne sont reconstruites que si le morceau change : choisir ou
    renommer ne touche qu'à des classes, sinon le toucher suivant se perd. Le
    nom d'une carte ne s'édite qu'une fois la carte choisie (le premier
    toucher choisit, il ne fait pas surgir le clavier). Modifier le morceau
    pendant l'écoute l'arrête.
- **04/10 · Audit complet, puis toutes ses recommandations.** Demandé par
  Adrien : « Lance un audit complet de l'outil et propose-moi toutes les
  implémentations dernier cri permettant de faire passer l'application au
  niveau suivant », puis « Implémente ensuite toutes tes recommandations
  avant de me proposer une PR complète ». Le rapport, les recommandations
  (repères S1, D4, L1…) et l'état de chacune sont dans
  [AUDIT-2026-10.md](AUDIT-2026-10.md) ; ce qui a été décidé en chemin, et
  pourquoi, est rangé lot par lot juste en dessous.
  - Huit audits en parallèle (lecteur, sécurité et données, interface,
    moteur musical, code, et trois veilles), chacun avec ses mesures. Les
    constats graves ont été rejoués avant d'être retenus.
  - **Deux exceptions à « tout implémenter »**, gardées pour Adrien : ce qui
    reviendrait sur une de ses décisions (la phrase chantée entière, une
    seule bibliothèque pour le site et claude.ai…), et ce qui demande une
    action de sa part (un réglage de GitHub, son iPhone, son DNS). Les deux
    listes sont dans le rapport.
  - Pourquoi des lots plutôt qu'un seul chantier : le lecteur, le
    connecteur, les données, le son et l'outillage ne partagent presque
    aucun fichier ; ils avancent en parallèle, puis `app.js` est découpé
    avant que les écrans changent, pour que les lots suivants ne se
    marchent pas dessus.

## Évolutions du 04/10, lot par lot

Chaque lot dit ce qu'il a changé et pourquoi, avec les repères du rapport.

### Sécurité de base (S1)

- **Tout texte inséré en HTML passe par `echapper` (`app/ui.js`).** L'audit
  a fait exécuter du code par une sauvegarde piégée, à quatre endroits : la
  durée du mémo dans le carnet, le nom d'une piste, le nom d'un accord sur la
  règle de la grille, l'identifiant d'une note. Le code lisait l'adresse du
  connecteur, et la fiche repartait par la synchro vers les autres appareils.
  Corrigé, puis vérifié avec les mêmes essais dans Chromium : plus rien ne
  s'exécute. La fonction locale d'`idee-accords.js` devient la fonction
  commune ; celle de `musicxml.js` reste à part (c'est du XML).
  - Pourquoi pas tout en `textContent` : ces morceaux de page mêlent des
    icônes (`ico()`) et du texte, et sont reconstruits souvent ; échapper la
    seule partie variable garde le code tel qu'il est. La CSP (S2) et la
    vérification des fiches (S6) ferment la porte une seconde fois.

### Lecteur (L1 à L19, C7)

<!-- lot lecteur -->

### Connecteur (S3 à S5, C1 à C6)

- **Les nouvelles clés de Supabase (C1).** Supabase retire les clés
  `service_role` d'ici fin 2026, et un projet réveillé peut déjà revenir
  sans elles : plus de tablette ni de synchro. La fonction lit maintenant
  `SUPABASE_SECRET_KEYS` (la clé `default`), et l'ancienne clé seulement à
  défaut (`supabase.js`). Rien à faire de ton côté : Supabase donne les deux
  à la fonction.
  - Une clé `sb_secret_…` n'est pas un JWT : elle part dans l'en-tête
    `apikey`, et seulement là. En `Authorization: Bearer`, la plateforme
    répond « Invalid JWT ». L'ancienne clé garde ses deux en-têtes.
  - Le faux stockage des tests refuse une clé secrète en `Bearer`, comme
    la plateforme : un retour en arrière ne passerait pas les tests.
- **La porte du connecteur (S4, côté HTTP).** Trois gardes avant le
  protocole (`http.js`) :
  - **la clé se compare à temps constant** : `!==` s'arrête au premier
    caractère faux, et le temps de réponse pouvait dire combien étaient
    justes. On compare les empreintes SHA-256 jusqu'au bout ;
  - **l'en-tête `Origin` est vérifié**, comme la spécification MCP l'exige :
    une page d'ailleurs reçoit 403, même avec la bonne clé (avant, elle
    faisait agir le connecteur, le navigateur lui cachait seulement la
    réponse). Passent : sans `Origin` (les serveurs de claude.ai, le
    script de déploiement), ton site (et `PORTEE_ORIGINES`), et les
    origines de Claude (`claude.ai`, `claude.com`, `anthropic.com` et leurs
    sous-domaines) au cas où ses serveurs en mettraient une ;
  - **le corps est borné à 6 Mo** (413 au-delà), compté en lisant : la
    longueur annoncée peut manquer ou mentir. Une page dense pèse 60 Ko.
- **MCP 2026-07-28 et les versions d'avant, sur la même adresse (C2).** La
  version du 28 juillet 2026 n'a plus d'`initialize` : chaque requête porte
  sa version dans `params._meta`, redite par l'en-tête
  `MCP-Protocol-Version`, avec `Mcp-Method` et `Mcp-Name`. claude.ai la
  déploie ; on sert les deux époques requête par requête (`mcp.js`), sans
  rien changer à ce qui marche.
  - Pourquoi les deux plutôt que la nouvelle seule : ton site appelle
    `tools/call` directement, sans `initialize` ni en-tête, et claude.ai
    passera d'une version à l'autre quand il voudra. Une requête sans
    version dans `_meta` est servie comme avant.
  - Nouveau : `server/discover` (versions, capacités, identité du
    serveur) ; en 2026-07-28, chaque résultat dit `resultType` et l'identité
    du serveur, et les listes disent combien de temps les garder (cinq
    minutes, `private` : l'adresse porte une clé).
  - Corrigé (écarts relevés par l'audit) : une version inconnue n'est plus
    renvoyée telle quelle (`initialize` répond 2025-11-25 ; en 2026-07-28,
    400 et l'erreur -32022 avec la liste) ; un outil inconnu est une erreur
    de protocole (-32602) ; une notification `tools/call` n'écrit plus rien
    (202) ; une réponse JSON-RPC du client reçoit 202 ; un en-tête absent
    ou contraire au corps, 400 (-32020) ; `ping` et une méthode inconnue,
    404 en 2026-07-28 ; GET et DELETE, 405.
  - On ne réclame pas `clientCapabilities`, que la spécification veut à
    chaque requête : le serveur ne dépend d'aucune capacité du client, et un
    client un peu en retard sur ce point ne doit pas perdre la tablette.
  - Les échanges de la synchro et les traits d'un document ne sont plus
    redits en texte : ils voyageaient deux fois (JSON dans le JSON). Un mot
    les résume ; l'appli lit le résultat structuré, comme avant.
- **La lecture de la tablette, durcie (C3).** reMarkable renvoie des 429
  depuis avril 2026, et une seule erreur faisait tout échouer.
  - **Nouvel essai** sur un 429, un 5xx ou une coupure : quatre essais au
    plus, en attendant ce que dit `Retry-After`, sinon 0,5 puis 1 puis 2 s
    environ (la moitié tirée au hasard, pour ne pas revenir tous ensemble),
    jamais plus de 30 s (claude.ai coupe un appel à 240 s). Pas pour
    `relier` : le code ne sert qu'une fois.
  - **Six requêtes à la fois** au lieu de douze : une rafale de douze est
    la première à se faire refuser (429).
  - **Un document illisible** ne fait plus tomber l'arborescence : il est
    dans `illisibles` ({ id, raison }), les autres s'affichent. **Une page
    illisible** est dans `pagesIllisibles`, les autres pages arrivent.
  - **L'hôte de synchro se règle** par un secret facultatif,
    `PORTEE_HOTE_SYNC`, s'il change un jour d'adresse. S'il ne répond plus
    (réseau, 5xx, 404), on se replie sur `eu.tectonic.remarkable.com`,
    celui que rmapi-js lit par défaut, et on y reste.
  - **Le sujet du PDF sans tout le PDF** : on lit ses 32 premiers Ko
    (reportlab y écrit le sujet de tes modèles, à 3 Ko), puis ses 32
    derniers s'il le faut (un PDF réenregistré l'y met). Si le cloud ignore
    `Range`, la lecture s'arrête quand même après la tête ; seul un PDF de
    plus de 2 Mo dont le sujet est à la fin serait alors manqué. Un même
    modèle importé plusieurs fois a la même empreinte : il n'est lu qu'une
    fois par instance. Avant, un livre de 50 Mo ouvert par erreur était
    téléchargé en entier. Pas pu vérifier sur le vrai cloud qu'il sert
    `Range` : les deux cas sont testés sur le faux.
  - **`document` par pages** : un paramètre facultatif `pages` ([1, 2] ou
    { de, a }) ; la réponse dit `nombrePages` et `pagesEcrites`, et s'arrête
    avant 140 000 caractères (claude.ai coupe vers 150 000, trois pages
    denses suffisaient) en listant `pagesRestantes`. **Sans paramètre, rien
    ne change** : toutes les pages, comme l'appli les attend.
- **Le jeton de la tablette, chiffré au repos (S5).** Il dormait en clair
  dans le stockage, et il permet d'écrire dans ton cloud reMarkable (même
  si Portée ne le fait jamais). Il est maintenant chiffré en AES-GCM
  (WebCrypto, le même code sous Deno et Node), avec une clé tirée par HKDF
  d'un secret de la fonction, `PORTEE_COFFRE` (`coffre.js`).
  - **Rien à faire de ton côté** : le script de déploiement crée ce secret
    s'il n'existe pas (il lit la liste des noms de secrets, jamais leurs
    valeurs), ne l'affiche nulle part, et **ne le remplace jamais** : un
    autre secret rendrait le jeton illisible.
  - **Migration douce** : le jeton déjà rangé (en clair) se lit, puis se
    range chiffré à la première lecture. Ta tablette reste reliée.
  - **Secret perdu ou changé** : le jeton ne se déchiffre plus, la tablette
    apparaît « à relier », comme après une révocation (un nouveau code de
    my.remarkable.com, et c'est reparti). Pas d'erreur incompréhensible.
  - Sans `PORTEE_COFFRE` (une fonction déployée à la main, sans le
    script), le coffre range le jeton en clair, comme avant.
  - Pourquoi pas la clé de service comme clé de chiffrement : quelqu'un qui
    lit le stockage a justement cette clé. `PORTEE_COFFRE` vit ailleurs (les
    secrets de la fonction), et ne sert qu'à ça.
- **Le déploiement du connecteur, durci (S3).** Le jeton Supabase
  (`SUPABASE_ACCESS_TOKEN`) ouvre tous tes projets ; il était dans
  l'environnement de tout le job, donc lisible par `npm ci` et les tests
  (une dépendance piégée l'aurait lu). Dans `connecteur.yml` :
  - les deux secrets ne sont donnés qu'à l'étape « Déployer » ;
  - `permissions: contents: read` : le jeton GitHub du job ne peut rien
    écrire ; `checkout` ne le garde pas dans `.git/config`
    (`persist-credentials: false`) ;
  - `npm ci --ignore-scripts` : aucun script d'installation ne s'exécute ;
  - `deno check` avant de déployer (CLAUDE.md le demandait, rien ne le
    vérifiait) ;
  - les actions sont épinglées par empreinte, la version en commentaire :
    une étiquette (`@v4`) peut être déplacée vers un autre code ;
  - le job tourne dans l'environnement `supabase`, que GitHub crée tout
    seul. **À faire de ton côté** : y déplacer les deux secrets et n'y
    autoriser que `main` (Settings → Environments → supabase). Tant qu'ils
    restent des secrets du dépôt, tout marche comme avant, mais un workflow
    poussé sur une autre branche peut encore les lire.
- **Une sentinelle chaque lundi (C4).** Le projet Supabase gratuit s'endort
  après une semaine sans activité, et tu ne le découvrais qu'à l'import
  suivant. `sentinelle.yml` appelle le connecteur le lundi à 6 h 47 UTC
  (et à la main, « Run workflow ») : l'outil `arborescence`, comme le
  bouton de l'appli. Si le connecteur ne répond pas 200, ou répond par une
  erreur, la tâche échoue, et GitHub t'écrit. Une tablette déliée donne
  seulement un avertissement.
  - Muette : `curl -s` sans message, ni l'adresse (elle porte la clé) ni la
    réponse (les noms de tes documents) ne s'affichent, et un test le
    vérifie en faisant tourner le script avec un faux `curl`.
  - `permissions: {}` ; `PORTEE_CLE` n'est donné qu'à l'étape ; même
    environnement `supabase` que le déploiement (sans relecteur obligatoire,
    sinon la tâche du lundi attendrait ton accord).
  - Pourquoi 6 h 47 : à une heure ronde, la tâche attend derrière toutes
    celles de GitHub, et saute parfois.
  - **La règle des 60 jours** : dans un dépôt public, GitHub désactive une
    tâche planifiée après 60 jours sans commit. Il te prévient ; un commit,
    ou « Enable workflow » dans l'onglet Actions, la relance.
  - Supabase compte surtout l'activité de la base : si le projet s'endort
    quand même, la sentinelle te le dira dès le lundi ; on pourra alors
    passer à un appel par jour.
- **Claude dans tes conversations (C5).** Les outils `bibliotheque_*`
  servent la synchro : ils lisent ou réécrivent des fiches entières.
  Dans une conversation, Claude ne pouvait que tout lire ou tout écraser.
  Nouveaux outils (`conversation.js`), aux schémas stricts et aux
  descriptions écrites pour lui :
  - `partitions_lister` (titre, type, doutes à lever ; recherche sans
    accents) et `partition_lire` : une partition sans ses traits (titre,
    ABC, doutes encore ouverts, tempo, mesure, tonalité ; les notes d'une
    idée ; les blocs d'un morceau). `partitions_lister` n'était pas dans la
    liste de l'audit, mais sans lui Claude ne peut pas trouver
    l'identifiant de « Pluie ».
  - `idee_ecrire` : une **nouvelle** idée, avec un identifiant neuf (le
    format de `nouvelId()`), jamais par-dessus une autre
    (`destructiveHint: false`). Elle a exactement la forme d'une idée de
    l'appli (vérifié : l'appli l'écrit en partition, et sa vraie synchro
    la reçoit), plus `source: { claude: true }`. Son `abc` reste vide :
    l'appli le réécrit d'après les notes. Les entrées sont bornées (hauteur
    21 à 108, durées positives, 4 000 notes et 256 mesures au plus, deux
    notes de même hauteur sans chevauchement, chiffrages que l'appli sait
    jouer) et une erreur dit à Claude quel champ corriger.
  - `suggestion_ecrire` (accords, suite, variation, ou un mot : titre,
    étiquettes, réponse à un doute), `suggestions_lister`,
    `suggestion_retirer` : la proposition est rangée à part,
    `suggestions/<partition>/<sid>.json`, sans toucher la partition ni la
    synchro (`suggestions.js`). C'est toi qui l'appliques d'un geste dans
    Portée (l'écran viendra avec H3).
  - Le prompt `relire_page` (argument `id`) : lire la page, regarder les
    doutes, proposer chaque réponse par `suggestion_ecrire`, ne jamais
    écrire dans la bibliothèque sans que tu l'aies demandé, et te parler en
    noms de notes, pas en ABC.
  - Les listes de l'appli (tonalités, mesures, chiffrages) sont recopiées
    dans le connecteur, qui est déployé seul ; un test vérifie qu'elles ne
    s'écartent pas.
  - Pour lire une seule fiche, ces outils passent par
    `changements(null)` (toute la bibliothèque) : c'est l'API publique de
    la bibliothèque, et quelques centaines de fiches se lisent en une ou
    deux secondes.
- **Une partition jouable dans la conversation (C6).** claude.ai affiche
  maintenant une petite page fournie par un connecteur (extension MCP Apps,
  `io.modelcontextprotocol/ui`). L'outil `partition_montrer({ id })` porte
  `_meta.ui.resourceUri` ; la ressource `ui://portee/partition`
  (`text/html;profile=mcp-app`, `vue-partition.js`) grave l'ABC avec
  abcjs 6.7.1 et le joue au piano, les notes jouées allumées.
  - **Sans dépendance** : le protocole (JSON-RPC par postMessage :
    `ui/initialize`, les arguments puis le résultat de l'outil, la hauteur
    annoncée, `ping`, le démontage) est écrit à la main, d'après la
    spécification du 2026-01-26 et l'exemple officiel `sheet-music-server`.
    Si l'hôte garde le résultat structuré pour lui, la page le redemande à
    l'outil, par l'hôte.
  - **Ce qu'elle charge est déclaré** (`_meta.ui.csp`), sinon l'hôte le
    bloque : abcjs sur cdnjs, vérifié par son empreinte (SRI : un CDN
    détourné ne pourrait rien glisser ; un test vérifie qu'elle est celle
    de `node_modules`), et les sons du synthé d'abcjs (paulrosen.github.io).
  - Elle suit le clair ou sombre et les jetons de claude.ai, garde les
    icônes de l'appli, et son bouton fait 44 px.
  - **Une idée notée par Claude n'a pas encore d'ABC** (l'appli l'écrit à la
    réception) : `abc.js` en écrit une partition simple d'après ses notes
    (la mélodie, ses accords, silences et liaisons), pour la montrer tout
    de suite. Pourquoi pas le code de l'appli : le connecteur est déployé
    seul, et une copie de `sequence.js` divergerait. abcjs y relit les
    mêmes notes sur deux cents idées au hasard (et quinze mille à l'essai).
    Piège trouvé en chemin : abcjs ne compte pas l'altération écrite sur la
    suite d'une liaison ; la même note, après, redit donc la sienne, comme
    dans l'appli.
  - **Essayée dans Chromium** avec un faux hôte qui joue le protocole et
    applique la CSP que la spécification lui fait construire : gravure,
    thème, hauteur, écoute (les sons viennent du domaine déclaré), `ping`,
    démontage, redemande à l'outil, erreur dite en clair, aucune requête
    ailleurs, aucune erreur de console. Sans Playwright (en CI), l'essai se
    saute.

### Données et synchronisation (S6, D1 à D10)

<!-- lot données -->

### Son, temps, notation et exports (M1 à M12, N1 à N7)

**Son, temps et micro**

Mesures avant et après dans Chromium, avec les bancs d'essai de l'audit
(contexte audio hors ligne, l'appli assemblée, téléphone simulé), et en Node
avec un faux contexte audio (`tests/faux-audio.mjs`).

- **« Arrêter » coupe vraiment (M1).** Le transport programme les notes un
  peu d'avance ; à l'arrêt, le piano baissait seulement le gain de ce qui
  sonnait, et le gain programmé d'une note à venir la faisait repartir après
  coup. Chaque voix, programmée ou qui sonne, est maintenant tenue dans une
  liste (`piano.js`) : celles qui n'ont pas commencé ne partent pas, les
  autres s'éteignent en 100 ms ; les clics du métronome aussi, et couper le
  métronome pendant la lecture retire ceux qui étaient déjà programmés.
  Mesuré dans l'appli (arpège, six pauses) : 0 note et 0 clic après la
  pause, contre 2 notes et un clic sur 6 avant ; 150 ms après, le niveau
  passe de −12 à −40 dB à moins de −100 dB.
  - La fin naturelle d'une écoute, elle, ne coupe rien : la dernière note
    finit de sonner.
  - Une écoute arrêtée pendant que le piano se télécharge ne part plus quand
    il arrive (avant, elle partait seule) ; touchée deux fois, seule la
    dernière demande part.
- **La boucle ne bégaie plus au téléphone (M2).** 350 ms d'avance de
  planification au lieu de 150, et la partition se regrave moins souvent :
  pendant la lecture, une fois toutes les 300 ms au plus, d'un seul passage
  (avec la mise en page de la gravure d'avant) ; en écrivant, 150 ms après la
  dernière note (une idée de 64 mesures coûtait 424 ms par note au
  téléphone, relevé par l'audit de l'interface) ; et choisir une note ne
  regrave plus rien, seules ses couleurs changent. Mesuré (téléphone
  simulé, processeur ralenti 4 puis 6 fois, vue Partition, dix notes
  ajoutées pendant la boucle) : 0 note en retard, contre 2 sur 56 et 14 sur
  58 avant.
  - Pourquoi pas plus d'avance : ce qu'on change pendant la boucle s'entend
    après elle ; 350 ms reste sous la demi-seconde, et la plus longue tâche
    mesurée à 6 fois plus lent (300 ms) y tient.
- **Le premier son vient vite (audit de l'interface), et le piano se
  recharge après un échec (M3).** Les 29 échantillons partaient ensemble :
  en 4G lente, rien ne sonnait avant dix secondes, et un toucher bref avant
  ce moment était perdu (même sur un bon réseau, le premier l'était). Ils se
  téléchargent maintenant quatre à la fois : celui de la note touchée
  d'abord, puis ceux de l'octave montrée par le clavier, puis le reste. Une
  note touchée trop tôt attend son échantillon et part à son arrivée (relevée
  entre-temps, elle s'entend brièvement) ; « Piano en chargement… La
  première fois, il se télécharge avec le réseau » s'affiche si l'attente
  dure. À l'ouverture d'une idée, l'octave montrée se télécharge d'avance,
  sans être décodée (il faudrait un contexte audio, qui attend un geste), et
  pas du tout si le navigateur demande d'économiser les données. Mesuré au
  téléphone (processeur 4 fois plus lent, 4G lente : 1,6 Mbit/s, 150 ms),
  dix touchers à une demi-seconde d'écart : avant, aucun son ; après, le
  premier son 0,6 s après le premier toucher (1,3 s si l'on touche 0,3 s
  après l'ouverture), et chaque toucher sonne.
  - Un échec ne se garde plus : la liste des échantillons se redemande au
    toucher suivant, un échantillon manquant est remplacé par son voisin et
    redemandé cinq secondes plus tard. Le problème est dit, en français
    (`surProbleme`, branché sur les messages de l'appli), même quand le
    geste qui jouait l'ignorait : avant, « Failed to fetch », ou rien.
- **Un son plus propre (M4).** Un limiteur (seuil −6 dB, sans genou, ratio
  20, attaque d'1 ms) et une sortie à 0,6 au lieu d'un compresseur à
  −14 dB et 0,9 : un accord de six notes à 127 culminait à +4,1 dBFS (531
  échantillons écrêtés), il reste à −0,8 dBFS ; une note seule sonne comme
  avant (−7,3 dBFS de crête contre −8,5).
  - Les échantillons sont repris des enregistrements d'origine
    (`outils/echantillons-piano.mjs`, voir `app/piano/LISEZMOI.md`) : −1 dB
    de marge (9 fichiers sur 29 s'écrêtaient au décodage, aucun sur 82
    maintenant), et un gain par échantillon qui ramène chaque note sur une
    courbe lisse du clavier : chaque enregistrement est normalisé à sa
    crête, et deux voisins pouvaient sonner à 10 dB l'un de l'autre ; ils
    restent à ±3 dB.
  - Le la5 (81) s'éteignait très vite (−55 dB à une seconde, −35 à −42 pour
    ses voisins) : le la♯5 (82) le remplace. À égale distance de deux
    échantillons, celui du dessus est pris (descendre un son s'entend moins
    que le monter).
  - Les nuances : un passe-bas d'autant plus bas que la note est douce, et
    deux couches de plus, PP et FF (0,9 et 0,8 Mo), téléchargées seulement
    quand une note jouée doucement (jusqu'à 64) ou fort (dès 101) les
    demande ; en attendant, la couche MF les remplace. Pourquoi les trois
    couches à la même hauteur sonore : les enregistrements sont normalisés
    chacun à sa crête, la force fait déjà le volume ; les couches donnent le
    timbre, sans saut de volume quand on passe de l'une à l'autre.
  - Les fichiers changent de nom (`060-mf.mp3`, `echantillons.json`) : le
    service worker garde le piano sans jamais le redemander, et les anciens
    noms auraient gardé les anciens sons.
- **Les pages lues jouent sur l'horloge du son (M5).** abcjs les jouait au
  fil de ses minuteries, au rythme des images de l'écran : des croches de
  250 ms en faisaient de 238 à 270 ms au repos, de 119 à 392 ms quand le fil
  principal était occupé (150 ms toutes les 700 ms). Leurs notes passent
  maintenant par le transport (`ecoute-page.js`), comme une idée, avec leur
  force (accents et temps forts), la transposition et les mains coupées ;
  TimingCallbacks ne sert plus qu'à surligner, à la position du transport.
  Mesuré : chaque croche à 250 ms exactement, au repos comme sous charge.
  - Au passage : abcjs compte son tempo en temps de la mesure (la noire
    pointée en 6/8 ou 12/8). L'écoute d'avant lui donnait des noires : une
    page en 12/8 allait une fois et demie trop vite, notes chevauchées. Le
    transport compte en noires, comme le curseur de l'écran.
- **Le son, l'écran et l'écran verrouillé, sur l'iPhone surtout (M8).**
  Un seul petit module, `eveil.js`, que le piano, le transport, le micro et
  le mémo vocal appellent ; tout y est facultatif (un navigateur qui ne sait
  pas, ou claude.ai, ne voit rien).
  - La session audio (Safari, iOS 16.4 et plus) : « playback » avant de
    créer le contexte du piano, qui sonne alors même quand l'iPhone est en
    silencieux (avant, il obéissait au bouton, comme une sonnerie) ;
    « play-and-record » le temps que le micro écoute (Chanter, le mémo
    vocal), puis « playback » de nouveau.
  - Au retour d'arrière-plan, d'un appel ou de l'écran verrouillé, le son
    reprend (`piano.reveiller()`) ; si Safari garde le contexte endormi, un
    autre le remplace, avec les sons déjà décodés, et le prochain toucher le
    réveille. Une écoute en cours s'arrête alors proprement (son bouton
    revient).
  - L'écran reste allumé (Screen Wake Lock) pendant l'écoute, le jeu en
    direct, Chanter et le mémo vocal : sinon il s'éteint au bout de trente
    secondes sans toucher, en plein enregistrement. Le navigateur le rend
    quand la page se cache ; il est redemandé au retour. Refusé (cadre
    isolé, économie d'énergie), rien ne casse.
  - L'écran verrouillé montre ce qui joue (le titre de l'idée, du morceau
    ou de la page), avec lecture, pause et arrêt (Media Session). Le
    navigateur ne montre ces commandes que pour un élément `<audio>` qui
    joue : une seconde de silence en boucle tient ce rôle pendant l'écoute,
    le piano passant par Web Audio. Pourquoi ce son muet plutôt que de faire
    passer le piano par un `<audio>` : il faudrait un flux de sortie, et la
    latence du jeu en direct y passerait.
  - Essayé dans Chromium (l'appli assemblée) : pendant l'écoute d'une idée,
    son titre et « playing », pause, arrêt et lecture ; « arrêt » depuis
    l'écran verrouillé arrête l'idée, remet le bouton et rend le verrou ;
    « lecture » la relance ; page cachée puis revenue : le verrou est
    redemandé ; verrou refusé : tout joue pareil, sans erreur.
- **Jeu en direct : chaque note à l'instant de son geste (M6).** L'instant
  était pris quand le code s'exécutait ; au téléphone, le fil principal
  occupé le retardait, et des doubles croches tombaient un cran trop tard.
  Chaque touche apporte maintenant l'instant de son geste
  (`event.timeStamp`, l'horodatage du message MIDI, ramené à maintenant
  s'il vient d'une autre horloge), que le transport rapporte à ce qu'on
  entendait (`getOutputTimestamp`, avec repli sur l'horloge du contexte
  moins ses latences). Mesuré dans l'appli : des doubles croches à 120
  horodatées juste, traitées jusqu'à 58 ms en retard (le fil principal
  occupé 60 ms toutes les 100 ms) : 24 sur 24 au bon pas, contre 6 sur 24
  avant.
  - **La latence de l'appareil se règle d'un geste** (« Régler en tapant
    avec le clic », feuille Tempo) : douze clics à 100, on tape huit fois
    avec eux (sur un grand pavé, ou au clavier MIDI : c'est ce dont on joue
    qui compte), et la médiane de l'écart au clic devient la latence de
    l'appareil (`portee:latence-jeu`, bornée de −150 à 400 ms), retranchée
    de chaque note jouée en direct. Pourquoi la médiane : une tape oubliée
    ou doublée ne déplace pas le réglage. Essayé avec des tapes horodatées
    40 ms après chaque clic : « Réglée : 40 ms ».
- **Le micro entend le vibrato, le sifflement et les cartes son rapides
  (M7).** Mesuré sur les 29 sons de synthèse de l'audit (voix d'homme, de
  femme, de soprano, sifflements, vibratos, bruit de fond, fondamentale
  absente…) et sur des vibratos de ±30 à ±100 centièmes, à 5 et 6,5 Hz.
  - Le vibrato : une mesure (toutes les 40 ms) compte pour la note tenue
    tant qu'elle en reste à 0,8 demi-ton, la note suit la médiane des six
    dernières mesures, et il faut deux mesures de suite au-delà pour faire
    une autre note : une seule, c'est la crête d'un vibrato. Avant, une
    seule mesure à plus de 0,6 demi-ton de la moyenne remettait la tenue à
    zéro : dès ±45 centièmes à 5 Hz, un vibrato ordinaire, la note ne
    s'écrivait jamais. Maintenant, jusqu'à ±60 centièmes, elle s'écrit en
    240 ms comme une note droite ; à ±80 et ±100, en 400 à 640 ms. Le
    legato glissé (la → do en 150 ms, la → mi en 300 ms) s'écrit au même
    moment qu'avant.
  - Ce que ça coûte : une autre note, attaquée sans glisser, s'affiche une
    mesure plus tard (40 ms), et s'écrit toujours au bout de six ; une
    attaque glissée de −150 centièmes s'écrit en 360 ms au lieu de 320.
  - Le sifflement : on cherche jusqu'à 2 500 Hz au lieu de 1 200 ; un mi5
    ou un la5 sifflés s'écrivaient une octave trop bas (76 et 81 au lieu de
    88 et 93). Aucune nouvelle erreur d'octave sur les sons d'essai, pour le
    même calcul (0,3 ms par mesure).
  - Les cartes son à 88,2 et 96 kHz : le son est ramené vers 24 kHz (un
    échantillon sur quatre, moyenné) et la fenêtre double ; avant, rien
    sous 94 Hz, le mi1 d'une basse n'était pas entendu.
  - Le micro s'ouvre sans gain automatique (il l'était déjà sans
    annulation d'écho ni réduction de bruit) : le gain remontait le bruit de
    fond entre deux notes. Sur l'iPhone, la session audio passe en
    « play-and-record » le temps que le micro écoute, et l'écran reste
    allumé (M8).
- **La pédale de maintien du clavier MIDI (M9).** Elle était ignorée.
  Enfoncée (CC64, à partir de 64), le piano tient les touches relâchées
  jusqu'à ce qu'elle se relève ; la même note rejouée efface vite la
  précédente au lieu de s'y ajouter. En direct, une note tenue par la
  pédale dure jusqu'à son lever, ou jusqu'à la même note rejouée. Essayé
  avec un faux clavier MIDI dans la page : une note relâchée sous la
  pédale ne s'arrête qu'au lever ; enregistrée, elle dure une mesure au lieu
  de la croche jouée. Ce que le transport programme ne dépend pas de la
  pédale : la durée des notes est déjà écrite.
- **La levée jouée pendant le décompte se dit (M11).** Elle disparaissait
  sans un mot. Le comportement ne change pas : la prise commence au premier
  temps (garder la levée, ou non, reste à décider par Adrien) ; la feuille
  de l'arrondi le dit (« 2 notes jouées pendant le décompte : pas gardées,
  la prise commence au premier temps »), et si tout a été joué pendant le
  décompte, le message le dit au lieu de « rien n'a été joué ».
- **Le tempo tapé compte les temps de la mesure (M12).** On tape ce que
  bat le métronome : la noire pointée en 6/8, 9/8 et 12/8, la blanche en
  2/2, la croche en 3/8 ; l'idée garde ses noires par minute. Avant, taper
  la noire pointée d'un 12/8 réglait le métronome aux deux tiers.
- **Proposé, à valider par Adrien : la capture après coup (M13).** Comme
  « Capture MIDI » dans Live et dans Ableton Note : sans avoir touché le
  bouton rouge, ce qu'on joue au clavier (à l'écran, de l'ordinateur ou
  MIDI) s'écrit note à note, de la durée choisie, comme avant ; Portée garde
  aussi en mémoire la dernière phrase jouée, avec son rythme (seize mesures
  au plus ; quatre secondes de silence, ou deux mesures, en commencent une
  autre ; oubliée après une minute sans jouer). Une pastille « Capturer »
  apparaît sur la grille dès deux notes (ou C au clavier) et ouvre la
  feuille de l'arrondi, « Tel que joué | Arrondi » : « Garder » remplace les
  notes écrites pendant qu'on jouait par celles-ci, avec leur rythme ;
  « Jeter » laisse l'idée comme elle est. La phrase se cale sur la musique
  si l'idée tournait (dans la boucle, si elle bouclait), sinon sur le tempo
  de l'idée, à partir de la première note. Essayé dans l'appli : croche,
  croche, noire, croche, croche jouées à 120 sans le bouton rouge s'écrivent
  en cinq noires, puis « Capturer », « Garder » : 2, 2, 4, 2, 2 pas.
  - Pourquoi une pastille sur la grille plutôt qu'un bouton du transport :
    la rangée du transport est pleine au téléphone (320 px sur 366), et la
    pastille ne se montre que quand il y a quelque chose à capturer.
  - Pourquoi remplacer plutôt qu'ajouter : la même phrase, écrite deux fois,
    se chevaucherait. Seules les notes que la capture a vues s'écrire (et
    qui sont encore là) partent ; une note choisie qui change de hauteur au
    clavier n'est pas une phrase jouée, et n'y entre pas.

<!-- lot musique -->

### Outillage, hors ligne et dépendances (S2, I5, T1, T2, T6)

<!-- lot outillage -->

### Notation, harmonie et exports (N1 à N7)

- **N1 · En 6/8, 9/8 et 12/8, chaque temps se voit.** Une note posée sur
  un temps n'y prend d'abord qu'un nombre entier de temps (noire, blanche ou
  ronde pointée), puis le reste, lié. Avant, le plus grand signe gagnait :
  quatre croches en tête d'un 6/8 devenaient une blanche, qui finit au
  milieu du deuxième temps, et une mesure entière de 12/8 s'écrivait ronde,
  croche et noire pointée. La ronde pointée (24 pas) rejoint les durées
  écrites. La partition et le MusicXML passent par la même mise en mesures
  (`mettreEnMesures`) : MuseScore reçoit la même chose. Les mesures simples
  (2/4, 3/4, 4/4, 2/2) ne changent pas.
- **B8 · En 3/8, les trois croches de la mesure se lient**, comme on les
  écrit à la main. Le temps reste la croche pour le métronome et le
  découpage : seule la ligature change (`groupeDeLigature`).
  - Un accord aux durées différentes (do noire, mi blanche, sol blanche
    pointée, partant ensemble) : abcjs le dessine en couches qui partagent
    une hampe ; on lit les têtes (pleine, vides, le point), pas trois voix
    bien séparées. abcjs ne sait pas mieux : une liaison par note dans un
    accord y suit le rang de la note, pas sa hauteur (le piège déjà noté).
    Le MIDI et le MusicXML, eux, sont justes : music21 relit trois voix
    (sol blanche pointée, mi blanche, do noire), mido les trois durées.
  - Pas demandé, pas fait : une levée en tête d'idée reste une mesure de
    silences (une idée commence sur une barre). Une page lue, elle, cale
    sa levée en fin de mesure de silences pour l'idée et le MIDI, et en fait
    une vraie mesure incomplète dans le MusicXML quand elle arrive en cours
    de page.
- **N2 · Les notes s'épellent d'après l'accord, puis d'après la ligne.**
  Une note hors de la tonalité s'écrivait d'après l'armure seule : ré 7 en
  fa donnait sol♭ au lieu de fa♯, mi 7 en do un la♭, si♭ en sol un la♯. Dans
  l'ordre, maintenant (`epeler`) : la gamme, puis la note de l'accord posé à
  ce moment, telle que l'accord l'écrit, puis la sixte et la sensible du
  mineur, puis, pour une note étrangère à tout cela, le sens de la ligne :
  dièse si elle monte (do do♯ ré), bémol si elle descend (ré ré♭ do).
  L'accompagnement, fait des notes de ses accords, s'écrit donc toujours
  comme eux ; la partition et le MusicXML aussi (music21 relit fa♯, sol♯,
  ré♯, mi♭ là où il lisait sol♭, la♭, mi♭, ré♯).
  - La lecture des noms d'accords passe dans `app/accords.js` : la
    partition en a besoin, et `harmonie.js` importe déjà `sequence.js` (un
    import dans l'autre sens aurait fait un cycle). `harmonie.js` redonne
    `lireAccord` et `QUALITES` : rien ne change pour les écrans.
  - Hors partition (le nom d'une note sur la grille, `nomNote`), rien ne
    change : sans accord ni ligne, c'est l'armure qui décide.
- **N3 · L'accompagnement se joue comme un pianiste.** **Tes idées avec
  des accords sonneront autrement** (mieux, on l'espère) : comme il est
  calculé à chaque écoute, rien n'est à refaire, mais rien n'est comme
  avant. Chaque accord était plaqué en position fondamentale à partir du
  do3 ; tout bougeait en parallèle et passait parfois au-dessus de la
  mélodie. Maintenant :
  - chaque accord prend le renversement le plus proche du précédent, sous
    la note la plus grave que la mélodie joue pendant qu'il sonne (jamais
    plus haut que do5), et la basse reste dessous, dans l'octave du do2.
    L'enchaînement se choisit en entier (`conduire`), pas accord par accord ;
  - mesuré avec le script de l'audit : C Am F G C passe de 64 à 12
    demi-tons parcourus par les voix du dessus, sans enchaînement parallèle
    ni note au-dessus de la mélodie ; C G7 Am Em F C F G de 81 à 25 (trois
    voix serrées ne peuvent guère faire moins : fa → sol en coûte déjà 6) ;
    G B♭ E♭ B sous un ré4, de 5 notes au-dessus de la mélodie à aucune ;
  - l'arpège joue toutes les notes de l'accord, la septième et la neuvième
    comprises (E7 a son ré, « Septième » s'entend enfin), en montant puis
    en redescendant ;
  - avec une neuvième, les voix du dessus laissent la racine à la basse et
    sonnent en tierces (fa la do mi pour Dm9) au lieu d'une grappe ;
  - le style « Basse et accords » joue l'accord sans sa racine après la
    basse, comme avant ; les cartes des styles dessinent le nouveau motif
    (elles le calculent avec le même code).
- **N4 · « Harmoniser toute l'idée » respecte les cadences.**
  **L'harmonisation proposée changera** sur tes idées (seulement si tu la
  redemandes : les accords déjà posés ne bougent pas). Avant : un accord par
  mesure, et « garder l'accord d'avant » effaçait la demi-cadence (l'Hymne
  à la joie restait en ré à la 4ᵉ mesure). Maintenant (`harmoniser`) :
  - les phrases vont par quatre mesures (une levée à part) ; la fin de
    chaque phrase prend la dominante quand la mélodie s'y prête
    (demi-cadence), la dernière mesure finit sur la tonique, la dominante
    d'abord si la mesure se partage (cadence parfaite : « la ré » à la fin
    de l'Hymne) ;
  - deux accords par mesure quand une moitié de mesure passe les trois
    quarts de son temps hors de l'accord de la mesure : « do mi | ré ré »
    dans Au clair de la lune devient do puis sol ; une note de passage ne
    suffit pas (Frère Jacques reste en do). Seules les mesures qui se
    coupent en deux temps égaux se partagent (4/4, 2/4, 2/2, 6/8, 12/8) ;
  - une règle (cadence, tonique, résolution) ne choisit qu'un accord presque
    aussi bon que le meilleur (`MARGE`) : elle départage, elle n'impose pas
    un accord qui jure ;
  - les dominantes secondaires entrent dans `suggerer` quand la mélodie joue
    leur note étrangère (fa♯ en do appelle D7, sol♯ E7, si♭ C7, do♯ A7 en la
    mineur), et `harmoniser` les résout sur leur accord : une ligne
    chromatique en do donne C D7 G E7 Am G7 C. La roue, elle, ne montre
    toujours que ses sept accords : une dominante secondaire n'y apparaît
    pas (à voir avec l'écran des accords, si tu veux la proposer là aussi).
- **N5 · Le MIDI, pensé pour Live.** Relu avec mido, @tonejs/midi et
  music21, comme pendant l'audit :
  - **la basse et les accords sur deux pistes** : l'accompagnement devient
    deux voix, « Accords » et « Basse des accords » (pas « Basse » : ta
    propre piste de basse ne s'y mélange pas, dans un morceau non plus).
    Dans Live, la basse part vers une vraie basse. La partition et le
    MusicXML les gardent sur une seule portée en clé de fa, comme avant
    (les voix partagent une `portee`) ;
  - **des noms lisibles partout : en ASCII** (« Melodie »). Un fichier
    MIDI ne dit pas l'encodage de ses textes, chaque logiciel devine :
    mido et @tonejs/midi lisaient « MÃ©lodie » (Latin-1), music21 l'UTF-8,
    et Live, impossible à essayer ici, dépend de son système. L'ASCII est
    le seul texte lu pareil par tous ; perdre l'accent vaut mieux qu'un nom
    illisible. Les signes se traduisent (♯ → #), les emoji partent ;
  - **chaque piste finit à la barre** de la dernière mesure, piste de tempo
    comprise : un clip tombe juste et boucle sans trou ;
  - **une même note n'est jamais rejouée pendant qu'elle sonne** : la
    première s'arrête où la suivante commence (deux do posés qui se
    chevauchent sur la grille) ;
  - **un morceau garde le chiffrage et l'armure de chaque bloc**, au début
    du bloc (un refrain en 3/4 et en sol dans un morceau en 4/4 et en do) ;
  - **les pages lues passent par le même écrivain**, plus par abcjs
    (`getMidiFile`), qui écrivait des pistes sans nom, une piste vide de
    plus pour une page de piano, et perdait les changements de la page
    (Live restait en 4/4 et en do sur ta page de mélodie, qui passe en
    12/8 et en mi♭). `lirePage` (`sequence.js`) fait jouer la page par
    abcjs, au temps exact (un triolet reste un triolet : 160 tics la
    croche) ; `midiDeLaPage` (`midi.js`) écrit « Main droite » et « Main
    gauche » (ou « Melodie »), chaque changement de tonalité où il arrive,
    chaque changement de mesure à la barre qui suit, précédé d'une mesure
    de la longueur de la levée (1/8 sur ta page) : la grille de Live tombe
    sur les barres de la page. Les notes y ont leur durée écrite (abcjs les
    raccourcissait un peu pour le son). Pourquoi pas une idée au passage :
    une idée vit au pas de double croche, le triolet y serait arrondi ;
  - « Continuer en idée » profite de `lirePage` : une idée n'a qu'une
    mesure et une tonalité, celles de la plus longue section de la page
    (ta page de mélodie devient une idée en 12/8 et en mi♭, plus en 4/4 et
    en do), et ses barres tombent sur celles de l'idée ; une levée en tête
    de page tombe à la fin d'une mesure de silences, comme dans une idée.
    Une tonalité que le menu n'a pas prend son nom enharmonique (sol♭ →
    fa♯) au lieu de do ;
  - le zip (claude.ai) est daté du jour, plus du « 0 janvier 1980 » ;
  - l'en-tête de `midi.js` dit vrai : « Basse » n'existe que si tu as
    ajouté une piste de basse.
- **N6 · Le MusicXML dit tout ce que la partition dit.** Validé contre le
  schéma officiel 4.0 (xmllint) et relu par music21 :
  - **les accords que MusicXML n'a pas** s'écrivent avec leurs degrés :
    G7sus4 en « suspended-fourth » plus une septième mineure, Cadd9 et
    Dmadd9 en majeur et mineur plus une neuvième. music21 lisait « Gsus »
    et un do majeur ; il lit « Gsus add b7 » (sol do ré fa), « C add 9 » ;
  - **le tempo dans l'unité du temps** : en 6/8, 9/8 et 12/8, la noire
    pointée (90 à la noire devient 60 à la noire pointée), arrondie à
    l'unité pour l'affichage ; `<sound>` garde le tempo exact, à la noire,
    comme le veut MusicXML ;
  - **un morceau s'exporte** (« ••• » du morceau, « MusicXML ») : ses blocs
    bout à bout, comme pour le MIDI, chacun avec sa mesure, sa tonalité et
    ses accords à sa première mesure (`musicXmlDuMorceau`). La mise en
    mesures sait maintenant qu'une partition a des sections ;
  - **une page lue** (`musicXmlDeLaPage`) garde ses changements de
    tonalité et de mesure, et sa levée devient une mesure incomplète
    (« implicit ») sous le nouveau chiffrage, comme on l'écrit à la main :
    ta page de mélodie fait deux mesures de 4/4 (la gamme, en mesure
    libre), une croche de levée, puis huit mesures de 12/8 en mi♭. Un
    changement de tonalité seul prend effet à la barre qui suit ;
  - **pas fait : le triolet d'une page.** La mise en mesures est celle des
    idées, qui vivent au pas de double croche : un triolet s'y arrondit.
    Le garder demanderait des n-olets dans cette mise en mesures commune
    (des durées en tiers de pas, `<time-modification>`), pour des pages que
    le lecteur ne sait pas encore lire (L12). En attendant, l'arrondi se
    fait aux bornes des notes, pour qu'elles se touchent : double, croche,
    double, au lieu de do, ré, silence, mi. Le MIDI de la page, lui, garde
    le triolet exact.
- **N7 · La transposition d'une page la suit partout.** Le MIDI la prenait,
  le MusicXML et « Continuer en idée » l'oubliaient. Les deux la prennent
  maintenant (`transposerIdee` après `sequenceDepuisAbc`, et la
  transposition passée à `musicXmlDeLaPage`, armures comprises). Le MIDI
  de la page transposée change aussi d'armure : abcjs, avant, montait les
  notes et laissait l'armure (une page en do jouée en ré arrivait en do
  dans Live).
- **N8 (nouveau) · Un fichier MIDI devient une idée : l'aller-retour avec
  Live.** Venu de l'audit de l'interface : une phrase retravaillée dans
  Ableton revenait dans Portée… par le clavier. Maintenant, un `.mid`
  déposé sur l'accueil ou choisi par « Importer un PDF » (qui accepte aussi
  les fichiers MIDI) devient une nouvelle idée, titrée par le nom du
  fichier, et s'ouvre.
  - Le lecteur est à nous (`lireFichierMidi`, `midi.js`), comme l'écrivain :
    un fichier MIDI standard est simple à lire, et une bibliothèque aurait
    été une dépendance de plus pour le site et pour claude.ai. Il lit les
    formats 0 et 1, le « running status », le note-on de vélocité 0 qui vaut
    note-off, les noms de pistes en UTF-8 ou en Latin-1, et saute le reste
    (sysex, contrôleurs, blocs inconnus). Vérifié contre mido sur 49
    fichiers (les nôtres, ceux d'abcjs, un fichier fabriqué à la main) :
    mêmes notes, vélocités, canaux, tempo, mesure et armure.
  - L'idée (`ideeDepuisMidi`) : une piste par piste du fichier qui joue, et
    par canal quand une piste en mêle plusieurs (format 0) ; au plus quatre
    pistes (une idée n'est pas un arrangement), sans la batterie (canal
    10) : le message dit ce qui est laissé de côté. Les notes sont recalées
    au pas de double croche par le même arrondi que le jeu en direct
    (`quantifier`, avec ton jeu lié) : un fichier sorti de Live, déjà sur la
    grille, ne bouge pas. Le tempo, la mesure et la tonalité sont ceux du
    fichier (les premiers : une idée n'en a qu'un) ; sans eux, 120, 4/4 et
    do, comme le veut la norme. « Melodie », que Portée écrit en ASCII,
    redevient « Mélodie ».
  - Hors de mes fichiers, deux retouches d'une ligne : l'`accept` du bouton
    d'import (`index.html`) et le filtre du dépôt (`accueil.js`), qui ne
    laissait passer que les PDF. Le libellé du bouton dit encore « Importer
    un PDF » : à ajuster avec l'interface.
- **B9 · L'arrondi traite la dernière note comme les autres.** Ta règle du
  jeu lié ne change pas (une note relâchée au plus un pas de grille avant la
  suivante tient jusqu'à elle). Mais la dernière note d'une prise n'a pas de
  suivante : des noires un peu détachées restaient des noires, sauf la
  dernière, qui devenait une croche. Elle tient maintenant jusqu'à la fin du
  temps où elle commence, avec la même tolérance ; une syncope finale (qui
  dépasse déjà son temps) ne bouge pas, et au-delà d'un pas de grille c'est
  toujours un silence.
  - Deux attaques de la même note dans le même pas de grille n'en font plus
    qu'une, la plus longue, dès l'arrondi. Avant, `poser` en effaçait une
    ensuite, mais le message disait « 3 notes gardées » pour deux écrites.
  - À intégrer (lot son) : `arrondir` (`idee-direct.js`) peut passer
    `temps: sq.pasParTemps(e.seq)` à `quantifier`. Sans, le temps vaut la
    noire : juste en 2/4, 3/4 et 4/4 ; en 6/8, la dernière note se règle
    sur la noire au lieu de la noire pointée.
  - Pas touché, comme tu l'as décidé : à la grille noire, des croches swing
    ou un triolet se fondent encore en accords. C'est le prix d'une grille
    grossière ; la croche ou la double croche les gardent.
- **Vérifié dans l'appli assemblée** (Chromium, version autonome) : les
  pages d'essai importées, la page de mélodie transposée de +2 exportée en
  MIDI (ré puis fa, 1/8 puis 12/8) et en MusicXML (valide), « Continuer en
  idée » en 12/8 et fa majeur, un `.mid` importé en idée, harmonisé (cinq
  accords) et gravé (l'accompagnement sur une portée, plaqué et arpégé),
  un morceau exporté en MusicXML et en MIDI ; aucune erreur dans la page.
  Pas essayé ici : Ableton Live lui-même, MuseScore (music21 et le schéma
  officiel en tiennent lieu).
- **Pièges rencontrés en chemin :**
  - `i += vlq()` quand `vlq` avance `i` : JavaScript lit l'ancien `i`
    avant l'appel, l'octet lu se perd. Calculer d'abord, ajouter ensuite ;
  - abcjs prend « M:none » pour du 4/4 (`getMeterFraction`) : la mesure
    libre se lit dans l'en-tête de l'ABC ;
  - abcjs range un `[K:][M:]` écrit en début de ligne à la fin de la ligne
    d'avant ; `lirePage` suit donc les éléments dans l'ordre, lignes
    comprises, et regarde si une barre précède le changement ;
  - mido refuse un bloc inconnu dans un fichier MIDI (la norme dit de le
    sauter, notre lecteur le saute) : pour comparer avec mido, un fichier
    sans bloc inconnu ;
  - `sequence.js` ne peut pas importer `harmonie.js` (qui l'importe) : ce
    qu'ils partagent sur les noms d'accords est dans `accords.js`.

### Architecture (T3 à T5)

<!-- lot architecture -->

### Atelier et pages manuscrites (intégration des L, H1)

<!-- lot atelier -->

### Écrans des données (D6, D7, D9, H3)

<!-- lot écrans des données -->

### Interface (I1 à I4, I6 à I15)

<!-- lot interface -->

### Claude dans l'éditeur d'idée (H2)

<!-- lot claude -->

## La refonte visuelle : le plan (02/10)

Dans l'ordre (le numéro est celui du classement) :
1. **Système** : jetons Papier et Studio, icônes, boutons d'au moins 44 px
   au doigt, commutateurs à segments, feuilles du bas.
3. **Écran Idée, studio de poche** : une barre en haut (toucher le titre
   ouvre tempo et mesure), la grille prend l'écran, un pupitre en bas à
   trois modes (Clavier, Chanter, Accords).
2. **Accueil-carnet** : « Noter une idée » (Jouer, Chanter, Mémo), une
   liste compacte, quatre onglets (Carnet, Partitions, Morceaux, Réglages).
4. **Clavier** : la gamme marquée, des modes Gamme et Accords, une carte
   des octaves.
5. **Sélection** : une barre flottante au-dessus des notes choisies, les
   gestes rangés par familles.
6. **Jouer en direct** : plein écran, décompte et battue en grand,
   l'arrondi du rythme choisi après coup.
7. **Chanter** : un accordeur lisible de loin, la trace de la voix.
8. **Accords** : la roue de la tonalité, les suites probables,
   l'accompagnement visible.
9. **Morceaux** : la structure en frise colorée.
10. **Pages manuscrites** : la page d'abord, les doutes un par un, en
    questions fermées.

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
- **Piano** : un lecteur maison (`app/piano.js`) sur les échantillons du
  Steinway de SplendidGrandPiano (AKAI, domaine public), tels que
  [smplr](https://github.com/danigb/smplr) les sert ; smplr lui-même n'est
  pas utilisé. Trois couches de nuances (MF au premier son, PP et FF à la
  demande), reprises des enregistrements par `outils/echantillons-piano.mjs`
  (voir `app/piano/LISEZMOI.md`). Le Salamander (CC-BY) reste en réserve.
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
8. *(option)* Second avis JAZZMUS. 9. **MusicXML** : *fait* (le 01/10, avec le carnet ; pages lues comprises).
   10. *(option)* Passerelle Ableton : le MIDI (une piste par main) y va déjà en un glisser.
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
      cercle, MusicXML) ;
    - partout : deux navigateurs synchronisés par le vrai code du connecteur
      (une idée, son étiquette et son mémo passent du téléphone à
      l'ordinateur ; la note ajoutée sur l'ordinateur arrive dans l'idée
      ouverte sur le téléphone) ; la version claude.ai essayée avec une
      fausse base et localStorage refusé ; les anciens écrans (import,
      correction au toucher, écoute, MIDI) inchangés.
12. **Refonte visuelle** (plan du 02/10, plus haut) : les dix refontes sont
    *faites*. Le système (1), l'écran Idée (3), l'accueil (2), les morceaux
    (9) et les pages manuscrites (10) sont fusionnés le 02/10 (PR #5 et
    #6) ; le clavier (4), la sélection (5), le jeu en direct (6), le chant
    (7) et les accords (8) suivent. Chaque refonte a été essayée dans
    Chromium au téléphone (Studio, Papier clair et sombre, 320 à 390 px de
    large) et à l'ordinateur, sans erreur de console, puis sur la version
    assemblée, et un grand parcours de toute l'appli (35 étapes : site au
    téléphone et à l'ordinateur, sombre, sauvegarde et restauration, version
    claude.ai simulée). 98 tests en Node (43 avant la refonte). L'appli
    claude.ai est republiée (le 02/10, avec les dix refontes). Pas encore
    essayé : un vrai iPhone (Safari), une vraie voix au micro.
    Ensuite (02/10, même jour) : le bouton « précédent », puis le zoom de la
    grille en hauteur et le choix Grille | Partition dans la barre, essayés
    dans Chromium au téléphone (pincements simulés en largeur, en hauteur,
    en biais) et à l'ordinateur (molette) ; puis les infobulles de l'appui
    long (appuis simulés : la bulle, le bouton qui ne part pas, le défilement,
    le bouton rouge et le clavier qui gardent leur appui long ; inventaire :
    aucune icône sans description). 103 tests en Node.

## Brancher la reMarkable (une fois)

1. **Déployer le connecteur** dans le projet Supabase du site. GitHub Actions
   s'en charge (`.github/workflows/connecteur.yml`) à chaque changement du
   connecteur fusionné sur `main`. Il faut deux secrets, rangés dans
   l'environnement `supabase` du dépôt (Settings → Environments → supabase,
   avec `main` seule autorisée ; des secrets du dépôt marchent aussi, mais
   tout workflow de n'importe quelle branche peut les lire) :
   - `SUPABASE_ACCESS_TOKEN` : un jeton d'accès Supabase
     (supabase.com/dashboard/account/tokens) ;
   - `PORTEE_CLE` : la clé de l'adresse, au moins 24 caractères aléatoires.
     Elle n'apparaît jamais dans les journaux, publics.

   Le script pose aussi, la première fois, le secret `PORTEE_COFFRE` de la
   fonction (la clé qui chiffre le jeton de la tablette dans le stockage) :
   rien à faire, et ne le supprime pas, sinon la tablette sera à relier.

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

La sentinelle (« Sentinelle du connecteur », chaque lundi) appelle le
connecteur avec ce même secret : si elle échoue, GitHub t'écrit. Si
reMarkable change un jour l'adresse de sa synchro, pose le secret
facultatif `PORTEE_HOTE_SYNC` (Supabase → Edge Functions → Secrets) avec la
nouvelle adresse en `https://…`.

Pour couper l'accès : retirer l'appareil « desktop-linux » sur my.remarkable.com,
ou supprimer la fonction dans Supabase.

## Pièges connus

- **Mise en ligne du site et caches.** GitHub Pages sert tout avec
  `max-age=600` ; un rechargement reprend les modules en mémoire. Sans
  version dans les adresses, une page neuve tournait avec des modules
  anciens. `assembler-appli.mjs` versionne les imports `"./x.js"` du site :
  écrire les imports sous cette forme littérale (il refuse les autres).

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
- **localStorage dans la page claude.ai** : il peut être refusé (cadre
  isolé). Les préférences de l'éditeur (affichage, tempo par défaut, clavier
  MIDI) passent par `lirePref` / `ecrirePref`, qui font sans.
- **Essais Chromium derrière le proxy** : sans `ignoreHTTPSErrors`, abcjs
  (cdnjs) ne se charge pas et la partition reste vide ; le proxy laisse
  aussi parfois tomber les polices (`ERR_TOO_MANY_RETRIES`). Ce n'est pas
  l'appli. Un faux micro : `--use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=chant.wav` (un chanteur de synthèse).
- **Micro et clavier MIDI** : ni l'un ni l'autre dans la page claude.ai
  (cadre sans ces permissions) ; Safari (iPhone, iPad) ne lit pas les
  claviers MIDI. Le micro et le son ne marchent pas en même temps : on coupe
  l'un pour l'autre (sinon le piano repasse dans le micro). Sur l'iPhone,
  tout ce qui ouvre le micro passe la session audio en « play-and-record »
  et la rend à « playback » après, refus compris (`sessionAudio`,
  `eveil.js`) : l'oublier, c'est un piano qui obéit de nouveau au bouton
  silencieux.

## Questions ouvertes

1. Tes pages d'essai du 30/09 : ce que tu voulais écrire. La 3ᵉ mesure de la
   ligne 2 fait 11 croches au lieu de 12 : est-ce le petit trait au bout d'une
   hampe, un crochet oublié ?
2. Les modèles v1 conviennent-ils à la main (interlignes, nombre de portées) ?
