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

- **Une même page donne toujours la même lecture (L14).** Le lecteur
  ramène tous les traits au demi-pixel avant de lire (`lecteur/traits.js`),
  avec l'arrondi du stockage. Avant, une page importée en PDF était lue sur
  ses décimaux, puis relue sur ses traits rangés, arrondis : l'audit a trouvé
  42 relectures différentes sur 100. Il écarte aussi les points non finis ou
  très loin de la page, et garde un trait vide à sa place, vide : les numéros
  des traits suivent ceux de l'entrée.
- **Le PDF dit son modèle, sa version et ses lignes grises.** `lireDocument`
  rend la version du sujet (`portee:<modèle>:v<N>`), qu'il jetait (M1), et
  les lignes grises imprimées du modèle, exactes à la calibration à 0,001 px
  près sur tes deux pages : elles serviront à reconnaître le modèle (L9).
  L'origine de la page est son coin haut gauche tel que le PDF le décrit :
  une page dont la boîte ne part pas de (0, 0) était lue décalée, toutes ses
  notes fausses (M9).
- **Plus de plantage sur une entrée inattendue (L19).** Une calibration sans
  interligne ou sans portée, une page d'étalonnage passée au lecteur, une
  clé autre que sol ou fa, un modèle inconnu dans `npm run lire` : un
  message clair à la place d'une erreur JavaScript. La ligne du bas de
  chaque portée se lit d'après son nom (« fa3 ») plutôt que dans une table
  de deux clés : un modèle en clé d'ut se lirait sans toucher au lecteur.
- **Les traits de la tablette suivent les règles du PDF (C7).** Le PDF
  exporté ne garde que l'encre noire ; `traitsDePage` (`rm.js`) écarte
  désormais aussi le gris, le blanc, les couleurs, le surligneur et l'outil
  « ombrage » (23). Sinon une page lue par le connecteur et la même page
  lue par son PDF pouvaient différer. `lireLignes` rend toujours tout ce que
  rmscene rend, pour le diagnostic.
  - Un point non fini ou absurde est écarté ; une ligne dont les points
    débordent de leur bloc est sautée (elle lisait le bloc suivant comme des
    coordonnées) ; un bloc plus long que le fichier arrête la lecture. Les
    9 000 fichiers abîmés de l'audit se lisent sans un point invalide.
  - `lirePageRm` rend `{ traits, erreur }` sans jamais lever d'erreur : à
    `remarkable.js` (lot connecteur) de s'en servir pour qu'une page
    illisible ne fasse plus échouer tout le document.
- **Repasser un trait ne change plus rien (L3).** Un trait repassé à
  l'identique, ou à moins de 0,15 interligne d'un autre qu'il ne prolonge
  pas, est écarté avant toute lecture. Avant, une hampe repassée devenait une
  barre, un bémol d'armure repassé un dièse (la ligne passait en do), un
  point repassé n'était plus un point. Les têtes n'y passent pas : leurs
  coups de stylo se réunissent déjà, et en retirer un déplacerait leur boîte.
  Les retouches de hampe sont cherchées avant les barres de mesure. Vérifié
  sur tes deux pages : chaque trait repassé, tel quel ou décalé de
  0,08 interligne, laisse la lecture identique (28 lectures changeaient).
- **Le point d'une noire pointée à hampe montante (L4).** Il tombe juste à
  côté de la hampe : il était pris pour une retouche de hampe, ou avalé par
  la tête. Une retouche de hampe fait maintenant au moins une
  demi-interligne, et un trait de la taille d'un point n'appartient à une
  tête que s'il tombe dedans.
- **Une barre repassée est une barre simple (L19).** Deux traits à moins
  d'un quart d'interligne s'écrivaient « || ». Tes deux pages en ont une
  (main gauche du piano, milieu de la 3ᵉ ligne de la mélodie), et l'image
  montre un seul trait appuyé : elles se lisent maintenant « | ».
  `tests/lecteur.test.mjs` est mis à jour en ce sens. Une vraie double barre
  a ses deux traits nettement séparés (au moins un quart d'interligne).
- **Armure ou altération de la première note (L5).** Un dièse collé à la
  première note d'une ligne, à sa hauteur, devenait l'armure : toute la
  ligne passait en sol majeur. C'est maintenant une altération quand il colle
  à la note (moins de 1,2 interligne ; tes armures du 30/09 en sont à 1,6)
  ou quand il n'est pas là où l'armure le mettrait (le fa♯ d'armure s'écrit
  sur la ligne du haut en clé de sol). Dans les deux cas, un doute
  « Armure ou altération ? » propose l'autre lecture, en un seul geste.
  - La hauteur d'un bémol est celle de sa boucle, pas de sa boîte : mesuré
    sur tes armures, elle tombe à 0,4 demi-interligne de sa note.
- **Armure mêlée de bémols et de dièses (L3).** La ligne passait en do sans
  rien dire. Elle garde les plus nombreux, et le doute « Bémols ou dièses ? »
  propose les deux autres lectures (dont « Sans armure »).
- **Un geste pour réécrire l'armure d'une ligne** (`changerArmure`,
  `edition.js`). Il change les deux voix d'un système de piano, laisse les
  lignes suivantes dans leur tonalité, et passe par l'en-tête pour la
  première ligne. Il comble le « Non, sans armure » qui manquait au doute
  d'armure reprise (refonte 10). `suivre` accepte désormais une liste de
  modifications : une réponse qui touche l'armure et une note est un seul
  pas d'« Annuler ».
- **Bécarre et dièses collés (L10).** Un bécarre en deux « L » est reconnu
  (il devenait un soupir) ; une altération sans note derrière elle n'est
  jamais un silence, c'est un signe à relire. Deux dièses d'armure qui se
  touchent sont séparés par leurs barres verticales : la ligne était lue en
  do majeur au lieu de ré.
- **Du texte n'est plus de la musique (L6).** Quelques « o » d'un titre ou
  de paroles devenaient des rondes. Une « tête » sans hampe ni ligne
  supplémentaire, hors de la portée, est du texte si elle en est à plus de
  2,5 interlignes, ou si une autre boucle pareille est écrite à côté (les
  lettres d'un mot). Seule et plus proche, elle reste une note, mais le
  doute « Est-ce une ronde ? » le demande.
- **Une note entre deux portées va à la sienne (L7).** La plus proche se
  trompait : le do6 de la 2ᵉ portée, à deux lignes supplémentaires, était lu
  sur la 1ʳᵉ (sur tes modèles standard, il n'y a que 3,2 interlignes entre
  deux portées). Décident les lignes supplémentaires (combien il en faut
  pour rejoindre chaque portée, et celles qui sont entre la note et sa
  portée), puis la hampe (elle pointe vers sa portée), puis la ligature.
  Une note dans sa bande, ou juste au bord, ne change pas : tes deux pages se
  lisent comme avant (le do4 et le la5 de la mélodie ont leur ligne
  supplémentaire).
- **Un soupir doit zigzaguer (L8).** Une hampe dont la tête n'a pas été lue,
  un peu courbée et haute de plus de 2,3 interlignes, passait pour un soupir
  en silence (13 têtes sur 54 retirées une à une changeaient la lecture sans
  rien dire). Réglé sur tes cinq silences : un soupir a au moins trois
  allers-retours d'un dixième d'interligne et n'est pas droit. Un trait seul,
  droit et vertical, sans tête, lève le doute « Il manque une note ? », qui
  vise la note d'avant (« Je corrige moi-même » la choisit).
- **Plus d'erreur de rythme qui se cache (L1, critique).** Le chiffrage
  acceptait n'importe quelle durée de mesure : une mesure fausse sur deux
  donnait 5/4, un point oublié 7/8, un triolet 9/8, sans un doute ; une
  ligne aux mesures fausses changeait de chiffrage sans rien demander.
  - Il se choisit maintenant parmi les mesures usuelles (2/4, 3/4, 4/4,
    3/8, 6/8, 9/8, 12/8), celle qui explique le plus de mesures. 5/4 et 7/8
    ne sont retenus que si toutes les mesures (au moins deux) le disent ; 2/2
    a la durée de 4/4, il se lira (L16), il ne se devine pas.
  - Il ne change qu'à une ligne où un chiffrage est écrit (une « section »).
    Une mesure qui ne tombe pas juste est un doute ; si moins de la moitié
    des mesures tombent juste, le chiffrage lui-même en est un, et ses
    réponses proposent les autres (`changerChiffrage`).
  - Une levée n'est acceptée qu'en tête de pièce, de même durée dans toutes
    les voix, et suivie d'une mesure complète. Pourquoi aussi en tête d'une
    section dont le chiffrage est écrit : ta page de mélodie commence par
    une gamme sans mesure, puis la pièce en 12/8 avec sa levée. Avant, toute
    première mesure plus courte d'une ligne passait (un soupir retiré à la
    main gauche du piano ne levait rien : c'est maintenant un doute).
  - La levée n'est plus comptée comme une mesure (L19) : la mesure de
    11 croches de ta mélodie est la « 2ᵉ mesure » de sa ligne, plus la 3ᵉ.
    `tests/doutes.test.mjs` suit.
- **Accords à hampe courte (L10).** La hampe devait dépasser la note du haut
  de plus de 2 interlignes : il suffit maintenant d'un peu plus d'une tête.
  Une tête sans hampe juste au-dessus d'une note à hampe propose « Une note
  de l'accord », qui refait l'accord d'un geste (`joindreAccord`).
- **Liaisons de durée (L11).** Un arc qui part d'une tête et arrive à la
  note suivante, de même hauteur, s'écrit « - » ; il était détecté puis
  jeté. Entre deux hauteurs différentes (un legato), il reste ignoré : il
  ne change pas le rythme. Les gestes d'`edition.js` gardent la liaison à sa
  place (copier, supprimer, compléter la mesure).
- **Pauses, demi-pauses et triolets (L12).** Un pavé noirci pendu sous la
  4ᵉ ligne est une pause (toute la mesure, quel que soit le chiffrage), posé
  sur la 3ᵉ une demi-pause ; ils étaient lus comme des noires sans hampe. Tes
  têtes ne sont jamais plus larges qu'une fois et quart leur hauteur : le
  pavé, si. Un petit signe plus haut que large, à deux bosses, sur trois
  notes liées lève « Un triolet ? » ; la réponse écrit « (3 » (`faireTriolet`)
  et la mesure se recompte. En 6/8, 9/8 ou 12/8, trois croches liées sont la
  règle : pas de doute. Le chiffre lui-même se lira avec les gabarits (L16).
- **Petits défauts (L19).** Le deuxième fa d'une mesure « ^F2 F2 » se
  faisait entendre naturel quand on le touchait : `hauteursMidiA` tient
  compte des altérations de la mesure (à brancher dans l'atelier).
  Supprimer la première note d'une ligne laissait une espace en tête.
  `alterationsArmure`, jamais appelée, est retirée. `dureeABC` reste en
  double (le lecteur et `edition.js` n'importent rien l'un de l'autre :
  chacun doit tourner seul dans `dist/`) ; un test vérifie qu'ils écrivent
  la même chose.
- **Une décision au ras d'un seuil devient une question (L2).** Le lecteur
  garde sa lecture, mais la demande, avec l'autre lecture en réponse fermée
  (`alternative`, écrite comme un geste d'`edition.js`) :
  - « Croche liée ou noire ? » : une ligature qui s'arrête entre 0,3 et
    0,7 interligne d'une hampe (la tolérance est 0,55). Ta mélodie en a
    deux, à 0,47 : le 2ᵉ sol de « GG » et le do de « dedc », que l'audit
    lisait comme des noires. La réponse coupe aussi la ligature dans l'ABC
    (« G G2 », « ded c2 ») ;
  - « La ou sol ? » : une tête à plus de 0,4 demi-interligne de sa place (0,5
    la fait changer de note). Deux sur ta mélodie (la5 et sol5 de la
    3ᵉ ligne, à 0,43), aucune sur le piano ;
  - « Une note ou un trait ? » (un gribouillis tout juste assez long pour une
    tête) et « Pointée ou pas ? » (un point à la limite de sa distance).
  - Pourquoi ces bornes : réglées sur tes deux pages et sur 100 pages
    perturbées par niveau (bruit, rotation, pente, espacement). À 0,35, ta
    mélodie avait 9 doutes et le piano 1 ; à 0,46, des notes du piano
    basculaient de nouveau en silence. À 0,4, plus aucune lecture ne change
    en silence au niveau 1 (avant : 9 % sur la mélodie, 7 % sur le piano),
    1 % au niveau 2 (6 % et 13 %). Elles sont rangées dans `MARGES`
    (`lecteur.js`), avec ces raisons.
  - La largeur minimale d'une tête passe de 0,35 à 0,25 interligne (une de
    tes têtes en fait 0,353, et c'est elle qui faisait changer 42 relectures
    sur 100) ; pour qu'un point ne devienne jamais une tête, une tête mesure
    au moins 0,45 interligne dans un sens. Une barre de mesure doit aller
    près des deux lignes extérieures, et un silence est d'un seul trait : une
    hampe sans tête devenait une barre ou un demi-soupir.
  - Tes deux pages se lisent comme avant ; la mélodie a maintenant 6 doutes
    (2 avant), dans l'ordre de la page, chacun avec un numéro (`id`).
- **Trancher par la mesure (L15).** Quand une mesure ne tombe pas juste, le
  lecteur essaie les autres lectures de ses décisions limites, seules ou
  deux à deux (et, en mesure simple, un triolet sur trois croches liées), et
  propose en réponses fermées celles qui la complètent (« 4ᵉ note en
  croche »). Chaque proposition dit quelles notes changer (leur `cible`) et
  quels doutes elle règle (`regle`).
- **Les doutes de mesure se recalculent après chaque geste (L13).**
  `recalculerDoutes(doutes, abc)` (`doutes.js`, pure) relit les mesures de
  l'ABC d'aujourd'hui avec les règles du lecteur et ajoute un doute à chaque
  mesure fausse qu'aucun doute ne vise encore, avec ses propositions. Sur ta
  mélodie : répondre « Croche » au doute du crochet fait tomber la mesure à
  11 croches ; le nouveau doute le dit, et propose « 8ᵉ note en noire » (le
  2ᵉ sol de « GG ») ; les deux réponses donnent la lecture de l'audit
  (« c2 c edc g2 G G2 G »). L'atelier doit l'appeler après chaque geste
  (lot atelier).
- **Lecture reproductible (L14, L18).** Sur tes deux pages, la lecture ne
  change plus quelle que soit la phase de l'arrondi au demi-pixel, ni en
  déplaçant toute la page de ±0,1 px (des tests le vérifient). Les doutes de
  marge, eux, peuvent apparaître ou disparaître au ras de leur propre seuil :
  c'est leur nature.
- **Chaque version de modèle garde sa calibration (L9).** Une page écrite
  sur un modèle v2 aurait été lue avec la calibration v1, sans rien dire. Le
  générateur écrit maintenant `<modèle>-v<N>.json` à côté de `<modèle>.json`
  (la version en cours) et n'efface jamais une version passée ; une version
  inconnue est refusée (« mets l'appli à jour »). Les PDF et les aperçus
  sont identiques à l'octet près ; les JSON perdent la note « à vérifier »
  sur les `.rm`, vérifiée depuis le 30/09. `VERSION` reste 1 : la géométrie
  n'a pas changé.
  - **Le modèle se reconnaît à ses lignes grises** (`lecteur/modeles.js`) :
    quand le sujet du PDF manque ou se trompe, les lignes décident (et
    l'appli peut le dire). Une page qui a bougé (boîte agrandie, export
    redimensionné) se recale dessus. Les cinq PDF abîmés de l'audit (sans
    sujet, mauvais modèle, modèle inconnu, v2, boîte décalée) se lisent
    juste, ou sont refusés avec un message clair pour la v2.
  - `x_apres_cle`, jamais lu, sert maintenant : l'en-tête d'une ligne ne va
    pas plus de 9 interlignes au-delà. Une ligne dont aucune tête n'était lue
    devenait tout entière un « en-tête », sans un doute.
- **Ta page redessinée suit la taille de la calibration (L19).** `manuscrit.js`
  écrivait 1872, 1330, 1370 et 40 en dur (le seul format de la reMarkable 2) ;
  `cadrePage(cal)` les calcule. Le README des modèles ne promet plus qu'un
  point appuyé fait une tête pleine : le lecteur ne le lit pas, et c'est
  voulu (il se confondrait avec un point de durée).
- **Le lecteur passe le lint et la vérification des types (L19, T2).**
  `assembler` ne demande plus la calibration, dont il ne se servait plus :
  l'exception provisoire d'ESLint qui le tolérait est retirée. Les JSDoc
  disent vrai (`lireDocument` rend une promesse, la page de `preparerTraits`
  est facultative), et `extraction.js`, `modeles.js` et `traits.js`
  rejoignent les fichiers vérifiés, sans erreur.
- **Un reconnaisseur de signes appris sur ton écriture (L16).**
  `lecteur/gabarits.js` compare un signe à des exemples de ta main : c'est
  $Q (Vatavu, Anthony et Wobbrock, MobileHCI 2018), écrit d'après l'article
  en JavaScript pur. Un signe devient 32 points ; deux signes se comparent
  comme deux nuages, quels que soient l'ordre et le sens des traits ; des
  bornes inférieures évitent les comparaisons inutiles (une milliseconde par
  signe pour 18 exemples).
  - Mesuré en interlignes, pas ramené à sa propre taille comme dans
    l'article : la taille compte (un soupir est deux fois plus haut qu'un
    demi-soupir), et l'interligne la rend comparable d'un modèle à l'autre.
    Sur tes signes déformés, 288 reconnus sur 288, contre 276 à la taille du
    signe. Les soupirs du piano (interligne 28) sont reconnus d'après celui
    de la mélodie (32).
  - Les seuils, rapportés au rayon du signe : reconnu nettement en deçà de
    0,3, rejeté au-delà de 0,45, de justesse entre les deux ou quand une
    autre étiquette est presque aussi proche. Réglés sur tes six bémols, tes
    trois soupirs, tes deux demi-soupirs, les chiffres du « 12/8 » et vingt
    variantes déformées de chacun : un bémol est à 0,14 à 0,17 de tes autres
    bémols, à plus de 0,29 de tout autre signe ; une tête ou un accent, à
    plus de 0,7 de tout exemple.
  - HOMUS (le jeu de signes manuscrits de la recherche) n'est pas embarqué :
    sa licence n'est pas indiquée. Les essais utilisent tes signes, ou des
    signes tracés comme à la main (`tests/fabrique.mjs`).
- **La page d'étalonnage** (`modeles/etalonnage.pdf`, sujet
  `portee:etalonnage:v1`) : six portées de trois cases, une par signe
  (silences, altérations, chiffres 1 à 9, « C », « C » barré, « 3 » de
  triolet), le signe imprimé en gris à gauche, trois places pour l'écrire.
  `lireEtalonnage` en tire tes gabarits ; ses lignes grises la reconnaissent
  comme les autres modèles ; `npm run lire` dit ce qu'elle a appris, et
  `--gabarits-sortie` l'écrit (à repasser avec `--gabarits`). Les signes
  gris viennent de Bravura 1.392 ; ceux déjà imprimés sur tes modèles
  restent ceux d'avant (`extraire_glyphes.py` n'ajoute que ce qui manque) :
  tes modèles sont identiques à l'octet près.
- **Lire avec tes gabarits** (`lirePartition(pages, cal, { gabarits })`).
  Sans eux, rien ne change (vérifié sur tes deux pages). Avec eux, un signe
  reconnu nettement prend leur lecture : silences (le quart de soupir, que
  les règles ne connaissent pas), altérations, chiffres, « 3 » d'un triolet
  (écrit « (3 », sans question). Reconnu de justesse, la lecture des règles
  reste, et un signe qu'elles ne lisent pas devient « Est-ce un bécarre ? ».
  - Le chiffrage écrit est lu au lieu d'être deviné : 3/4 et 6/8 ont la
    même durée, seul l'écrit les distingue. Il faut que tous ses signes
    soient reconnus nettement (lire « 2/8 » pour « 12/8 » serait pire que
    deviner) ; deux chiffres qui se touchent se séparent à la ligne du
    milieu. Lu mais contredit par la plupart des mesures, c'est une question.
  - Sur ta mélodie, le « 12/8 » est lu, les six bémols et les trois silences
    reconnus : même ABC, mêmes doutes.
  - Un « 3 » de triolet écrit dans la portée (hampes descendantes, ligature
    dans la portée) : les règles en font un soupir au milieu du groupe, avec
    un doute de mesure. Tes gabarits le lisent comme un triolet. Sans eux,
    c'est encore le cas (à revoir si tes pages en montrent).
- **Apprendre d'une correction.** `ajouterExemple` rend de nouveaux
  gabarits (au plus 24 exemples par signe, les plus anciens partent ; le même
  exemple ne compte qu'une fois), `fusionnerGabarits` réunit ceux de deux
  appareils sans rien perdre. Les doutes de signe, de triolet et de
  chiffrage disent leurs traits, et leurs réponses ce qu'elles apprennent
  (`apprendre`, `doutes.js`). « Un signe que je ne reconnais pas » propose
  maintenant des réponses : une altération de la note qui suit, un silence
  après celle qui précède. Brancher tout cela dans l'appli (importer la page
  d'étalonnage, ranger les gabarits avec la bibliothèque, apprendre des
  réponses) revient au lot atelier.
- **Un banc d'essai sur tes pages validées (L17).** `node
  outils/banc-lecteur.mjs ta-sauvegarde.json` relit chaque page marquée
  « Prête » d'une sauvegarde avec le lecteur d'aujourd'hui, et la compare à
  l'ABC que tu as validé : erreurs de hauteur (la note qui sonne, armure et
  altérations de la mesure comprises), de durée, notes manquantes ou en
  trop, barres mal placées ; part des erreurs silencieuses (qu'aucun doute
  ne signalait) ; précision des doutes (combien désignent une vraie
  erreur). `--json` pour comparer deux versions, `--detail` pour voir chaque
  erreur, `--gabarits` pour lire avec tes gabarits.
  - Pourquoi : les seuils sont réglés sur deux pages, et un réglage qui les
    améliore peut en abîmer d'autres. À lancer avant et après chaque
    changement du lecteur.
  - Rien n'est écrit, tout s'affiche : tes pages ne doivent pas entrer dans
    le dépôt, qui est public.
  - Les barres se comparent par leur place dans la suite des notes, pas par
    l'instant : une seule durée fausse aurait décalé toutes les suivantes.
  - Une page lit la calibration de sa version (`versionModele`, que l'appli
    doit ranger avec la page : lot atelier) ; sans elle, la v1.

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

**Compléments (04/10, pour les écrans)**

- **Le compartiment a sa taille maximale (S4, `objets.js`).** 6 Mo par
  objet, posés à la création du compartiment, qu'elle vienne de la
  bibliothèque ou du coffre : le stockage refuse lui-même plus gros, même si
  une borne du code venait à manquer. Ton compartiment existe déjà : il la
  reçoit à la première écriture de chaque démarrage de la fonction (un
  `PUT`, sans effet s'il l'a déjà). Rien à faire de ton côté.
  - Un échec de cette mise à jour ne bloque ni lecture ni écriture : on
    réessaie au démarrage suivant.
  - 6 Mo, comme la porte (`http.js`) : rien de plus gros n'y entre, et les
    pages d'une partition en font 5 au plus. Pas de liste de types : le
    coffre range le jeton en `text/plain`.
  - La bibliothèque et les suggestions partagent un seul client du stockage
    (`index.ts`) : une mise à jour par démarrage, pas une par outil.
- **Les suggestions partent avec leur partition (D6, `bibliotheque.js`).**
  Quand une partition quitte la corbeille pour de bon (30 jours), les
  suggestions que Claude avait rangées pour elle (`suggestions/<id>/…`)
  partent aussi : personne ne pourrait plus les appliquer, et elles
  restaient dans le stockage pour rien. Une partition revenue entre-temps
  garde les siennes.
- **Une idée refusée dit pourquoi (C5, `conversation.js`).** Quand la
  bibliothèque refuse l'idée de Claude avec une raison (`refus`, une fiche
  trop lourde par exemple), il lit cette raison, et quoi faire : rien n'est
  enregistré, la même idée serait refusée encore, il corrige ou te le dit.
  Avant, il lisait « réessaie dans un instant », et pouvait tourner en rond.
  Ce message reste pour un conflit d'écriture, sans raison : là, réessayer
  suffit.
  - Les bornes d'`idee_ecrire` tiennent déjà une idée sous les 256 Ko de la
    bibliothèque (194 Ko au plus, calculé) : c'est une garde, pour le jour
    où l'une des deux bougerait.
- **La version du modèle d'une page (L9, `remarkable.js`).** Le sujet du
  PDF dit `portee:<modèle>:v<N>`, et le connecteur jetait la version.
  Chaque version d'un modèle a maintenant sa calibration
  (`modeles/<modèle>-v<N>.json`) : l'appli doit savoir sur laquelle la page
  a été écrite. `document` rend donc `versionModele` (un nombre, `null` si
  inconnue), à côté de `modele`.
  - `modele` garde le nom seul (ou `null`) : le connecteur est déployé dès
    la fusion, la version claude.ai de l'appli plus tard, et elle l'attend
    tel quel. Un champ de plus ne la gêne pas.
  - `arborescence` n'a pas de `modele` (il faudrait lire le PDF de chaque
    document) : rien n'y change.

### Données et synchronisation (S6, D1 à D10)

- **Chaque fiche est vérifiée et remise en forme (S6, `app/fiche.js`).**
  Une sauvegarde abîmée, ou une fiche venue d'un autre appareil, dont les
  étiquettes n'étaient pas une liste, vidait le carnet partout.
  `normaliserFiche` redonne à chaque champ son type et ses bornes : titre,
  étiquettes, favori, note, mémo, notes et accords d'une idée, mesure,
  tonalité, tempo, transposition, doutes, blocs d'un morceau, dates. Une
  idée écrite sans ABC (par Claude, avec `idee_ecrire`) le retrouve d'après
  ses notes, comme dans l'éditeur.
  - Un champ inconnu reste, s'il est du JSON raisonnable : une version plus
    récente de l'appli a pu l'ajouter, et l'effacer ici l'effacerait partout.
  - Les dates sortent toujours sur 24 caractères : l'appli les trie comme
    des textes, et « +275760-… » passait avant « 1970-… ».
  - Le coût : 26 ms pour 300 fiches lourdes, dix fois moins que leur
    lecture dans IndexedDB. Pas besoin de cache.
- **Fusionner deux versions au lieu d'écraser la plus ancienne (D4,
  `fusionnerFiches`).** Une étoile posée sur le téléphone effaçait les
  notes ajoutées sur l'ordinateur : la fiche entière la plus récente
  gagnait (« le plus récent gagne », décision du 30/09). Maintenant, à
  partir de la dernière version que les deux connaissaient (la « base »),
  chaque champ garde le côté qui l'a changé. Changé des deux côtés : les
  étiquettes se réunissent (ajouts et retraits des deux côtés), les notes se
  fusionnent une par une (un retrait d'un côté s'applique si l'autre n'a pas
  touché la note ; changée des deux côtés, la plus récente), les accords
  position par position, le reste au plus récent. Le texte d'une page lue
  (son ABC et ses doutes) ne se mélange pas : la fiche garde celui d'ici,
  et l'autre devient une copie « titre (version de l'autre appareil) ».
  - Pourquoi une base plutôt qu'une horloge par champ (HLC) : l'éditeur
    d'idée, le morceau et l'accueil enregistrent la fiche entière. Dater
    chaque champ et chaque note aurait demandé de toucher tous les écrans ;
    la base marche avec ce qui s'écrit déjà. Une fiche sans base (d'avant)
    fusionne comme avant : la plus récente, entière.
  - Deux appareils ont pu donner le même numéro à deux notes différentes :
    les deux restent, l'une renumérotée. La même note posée des deux côtés
    n'en fait qu'une, la plus longue, comme quand on la pose deux fois.
- **La bibliothèque commune vérifie ce qu'elle range (S4, S6,
  `bibliotheque.js`).** Elle acceptait 20 Mo de pages, une date « zzz », et
  une pierre tombale datée de l'an 9999, qu'aucune correction ne pouvait
  plus défaire. Maintenant : 256 Ko de fiche au plus (comme un document de
  claude.ai : une fiche passe partout ou nulle part), 5 Mo de pages (un
  mémo d'une minute, même quand Safari ignore le débit demandé ; avec la
  fiche, sous les 6 Mo que `http.js` laisse entrer), une date ISO à moins
  d'un jour dans le futur, et les types de base des champs (des étiquettes
  en liste de mots, une séquence avec ses pistes…).
  - Un refus n'est plus une erreur : `{ accepte: false, refus }` dit
    pourquoi, et l'appareil met la partition de côté sans bloquer les
    autres. Un appareil d'avant le prend pour un succès : il garde la fiche
    chez lui au lieu de tout bloquer.
- **Une écriture dit d'où elle part, et une seule passe à la fois (D4,
  S9).** L'appareil envoie la version d'où part sa modification (`base`,
  et son numéro `baseRev`) : si la bibliothèque a changé entre-temps, elle
  refuse et rend la sienne ; l'appareil fusionne et renvoie. Un verrou par
  partition (`verrous/<id>.json`, créé « seulement s'il n'existe pas » : le
  stockage n'en laisse réussir qu'un, `objets.creer`) empêche deux
  écritures de se croiser ; avant, la plus ancienne pouvait passer en
  dernier.
  - Pourquoi un numéro de révision (`rev`) en plus de la date : deux
    appareils dont l'horloge retarde datent tous deux « la version d'avant
    + 1 ms ». Trouvé en écrivant les tests : sans lui, un appareil prenait
    la version de l'autre pour la sienne.
  - Sans `base`, un appareil d'avant (et `idee_ecrire`) garde « le plus
    récent gagne ». `base: null` veut dire « elle ne doit pas exister ».
    Un verrou abandonné (une coupure en route) se lève au bout de 30 s.
- **Versions et corbeille (D6).** Un effacement par erreur partait partout
  en quelques secondes, sans retour. À chaque écriture acceptée, la version
  d'avant est gardée (`versions/<id>/<date>-r<rev>.json`) : 20 au plus par
  partition, 30 jours. Une partition supprimée garde 30 jours sa dernière
  version et ses traits (`corbeille/<id>.json`), puis part pour de bon ; sa
  pierre tombale reste, pour les appareils qui ne l'ont pas encore vue.
  Trois outils : `bibliotheque_versions`, `bibliotheque_version`,
  `bibliotheque_corbeille`.
  - On élague en écrivant (toutes les cinq versions, et à chaque
    suppression) : l'historique reste loin du quota gratuit (1 Go), sans
    tâche planifiée à part.
- **Le curseur relit dix secondes (D10, S10).** Une écriture datée juste
  avant le curseur mais visible juste après n'arrivait jamais sur un
  appareil. `bibliotheque_changements` relit les dix dernières secondes ;
  l'appareil reconnaît ce qu'il a déjà.
- **Recevoir avant d'envoyer, à partir d'une base (D1, D4, `synchro.js`).**
  Une synchro reçoit d'abord, puis envoie : une modification d'ici part de
  la dernière version au lieu de l'écraser. Chaque appareil garde, pour
  chaque partition, la dernière version convenue avec la bibliothèque
  commune (magasin `bases`, IndexedDB version 3) : la fusion part d'elle.
  La migration garde tout ; une fiche déjà synchronisée (rien en attente)
  devient sa propre base, et la première fusion se fait déjà champ par
  champ.
  - Une correction enregistrée pendant la synchro n'est plus écrasée (S7) :
    ce que la synchro range vérifie, dans la même transaction, que la
    partition n'a pas bougé depuis qu'elle l'a lue ; sinon, elle recommence.
    `modifier` lit et écrit aussi dans une seule transaction.
  - Son propre envoi, dont la réponse s'est perdue, est reconnu à sa date
    et à l'empreinte de son contenu : pas de fusion avec soi-même.
- **Un refus ne bloque plus rien (D2).** Un envoi refusé (l'identifiant
  d'une vieille sauvegarde, une date absente) levait une erreur : plus rien
  ne partait ni n'arrivait, pour toujours. Il est maintenant mis de côté (la
  « quarantaine », dans `meta`, avec la raison), compté dans l'état de la
  synchro, et repart quand la fiche change, à la session suivante, ou avec
  `synchro.reessayer()`. Une réception qu'on ne peut pas ranger (stockage
  plein) aussi : le curseur avance, elle réessaie à chaque passage, et une
  version plus récente la remplace.
  - Une panne passagère du connecteur (son stockage) laisse l'envoi en file ;
    à la cinquième dans la session, il est mis de côté. Le réseau coupé,
    lui, arrête le passage sans rien mettre de côté : tout attend.
  - Trop lourd pour le connecteur (plus de 6 Mo, HTTP 413) : mis de côté
    avant même l'envoi, sinon il aurait été refusé à chaque passage.
- **Suppressions et mémos (D3).** Une suppression refusée (la partition a
  changé ailleurs entre-temps) rend la version gagnante, au lieu d'une
  partition disparue ici et vivante ailleurs. La pierre tombale est datée
  après la version d'ici, même quand l'horloge retarde. Une modification pas
  encore partie l'emporte sur une suppression faite ailleurs : rien de ce
  que tu as écrit ne disparaît sans toi, et la corbeille rattrape l'inverse.
  Un mémo enregistré avance la date de sa fiche, et la synchro n'efface plus
  que l'envoi qu'elle a fait partir (un numéro par envoi, plus la date) :
  un mémo enregistré pendant une synchro, ou sans autre changement, ne
  restait jamais sur l'appareil (S6, S14).
- **Restaurer (D5).** La restauration disait « 1 partition restaurée »,
  puis la synchro la re-supprimait. Une partition absente revient
  maintenant datée d'aujourd'hui (dans l'ordre d'origine), même supprimée
  ailleurs depuis ; une partition déjà là reste telle quelle ; une erreur
  sur l'une n'arrête plus les autres. Le message dit combien sont revenues,
  combien étaient déjà là (dont modifiées depuis), et lesquelles n'ont pas
  pu revenir, avec la raison. Un identifiant que la bibliothèque refuserait
  (sauvegarde bricolée) est remplacé, et les morceaux qui le citent suivent.
- **Plusieurs onglets (D7).** Un seul synchronise à la fois
  (`navigator.locks`, « portee-synchro »). Une partition changée dans un
  onglet rafraîchit la liste des autres (`BroadcastChannel("portee")`). Une
  version plus récente de Portée, ouverte ailleurs, reçoit la base : cet
  onglet la lâche et dit de recharger. Un vieil onglet qui ne la lâche pas
  ne fait plus démarrer l'appli sur une bibliothèque vide (le repli sur
  localStorage) : un message dit « Ferme l'autre onglet de Portée », et la
  bibliothèque s'ouvre dès qu'il l'est.
  - La reprise d'une bibliothèque rangée dans localStorage garde les mémos
    et met tout à envoyer : ce qui avait été noté pendant un repli ne
    quittait jamais l'appareil (S16).
  - `stockage.modifier(id, donnees, { depuis })` fusionne au lieu d'écraser
    quand la partition a changé depuis que l'écran l'a ouverte. L'éditeur
    d'idée et le morceau, qui enregistrent la fiche entière, pourront s'en
    servir (voir la fin de cette section).
- **Le mémo en morceaux sur claude.ai (D8).** Un document de la base de
  claude.ai ne dépasse pas 256 Kio ; un mémo d'une minute en fait environ
  320 en base64 : sa restauration échouait. Le son se range par morceaux de
  180 000 caractères (`partitions/<id>/memo/audio-0…`, et un index là où
  était le document) ; l'ancien format se lit toujours, et les morceaux
  partent avec la partition. Essayé dans Chromium avec une fausse base qui
  a la même limite : un mémo de 700 Ko revient d'une sauvegarde.
- **L'état du stockage (D9).** `etatStockage()` dit si le navigateur a
  promis de garder la bibliothèque (`persisted()`), la place prise et le
  quota, si Portée est installée (écran d'accueil), et s'il y a un risque :
  Safari efface au bout de 7 jours sans visite tout ce qu'un site non
  installé garde. `demanderProtection()` redemande, et rend la réponse
  (avant, `persist()` était appelé sans la lire).
- **Les seize scénarios de perte de données de l'audit deviennent des
  tests** (`tests/synchro-scenarios.test.mjs`). L'audit les avait écrits
  pour montrer chaque défaut, avec les vrais modules ; ils vérifient
  maintenant le comportement corrigé, avec deux cas trouvés en chemin (une
  réception mise de côté puis dépassée, deux versions de même date). Les
  tests d'origine de l'audit, rejoués sur ce code, ne reproduisent plus
  aucun défaut ; S11, son contrôle positif, passe toujours. Essayé aussi
  dans Chromium sur le site assemblé : deux appareils synchronisés par le
  vrai code du connecteur, la sauvegarde empoisonnée de l'audit, deux
  onglets, une base tenue par un vieil onglet, la migration 2 → 3, et la
  version claude.ai simulée.
- **Ce qui reste à brancher** (lot « Écrans des données ») : les écrans de
  la quarantaine (`synchro.quarantaine()`, `reessayer`), des copies de
  conflit (champ `conflitDe`), de la corbeille et des versions
  (`synchro.corbeille()`, `versions`, `recupererSupprimee`,
  `recupererVersion`), de l'état du stockage ; et, dans l'éditeur d'idée et
  le morceau, `{ depuis }` à l'enregistrement et un rechargement quand un
  autre onglet change la partition (`stockage.surAutreOnglet`).

### Son, temps et micro (M1 à M13)

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
    service worker d'alors gardait le piano sans jamais le redemander, et
    les anciens noms auraient gardé les anciens sons. Depuis le lot
    outillage, son cache suit l'empreinte des fichiers du piano et les
    garde tous, PP et FF compris (1,7 Mo de plus, en tâche de fond, à la
    première visite) : sur le site, « à la demande » ne vaut plus que pour
    le décodage, et pour claude.ai, qui n'a pas de service worker.
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
- **Vers Live : la sortie MIDI et le dossier des .mid (M10).** Chrome et
  Edge sur ordinateur ; ailleurs (téléphone, Safari, Firefox, claude.ai), la
  section « Avec Live » des réglages reste cachée et rien n'est demandé au
  navigateur (`reglages-live.js`).
  - La sortie MIDI (`sortie-midi.js`) : le port choisi dans les réglages
    (le Gestionnaire IAC sur Mac, un port loopMIDI sur Windows) reçoit ce
    que joue le transport (idée, morceau, page lue), note à note, horodaté
    à l'instant où le piano de Portée la joue (`send(octets, instant)`) ;
    une piste MIDI de Live qui écoute ce port la joue avec son propre son.
    Un interrupteur rend le piano de Portée muet pendant ce temps. À
    l'arrêt, ce qui n'est pas parti ne part pas, ce qui sonne s'éteint
    (note par note, puis All Notes Off) ; une écoute qui finit d'elle-même
    laisse la dernière note finir. Une même hauteur tenue par deux voix
    (les accords et la mélodie) est relancée, et ne s'éteint qu'avec la
    dernière. Le port revient à la visite suivante (retrouvé par son nom
    s'il a changé d'identifiant) ; débranché, le piano de Portée reprend.
  - Pourquoi 100 ms d'avance seulement (le piano en prend 350) : un message
    parti ne se rattrape pas, Chrome n'a pas `MIDIOutput.clear()`. Au pire,
    une note qui devait partir dans les 100 ms suivant l'arrêt s'entend,
    brève ; les extinctions partent après le dernier message envoyé, sans
    quoi cette note tiendrait.
  - Un piège évité : IAC et loopMIDI sont aussi une entrée du même nom, qui
    renvoie à Portée ce qu'elle y joue. Le clavier MIDI de l'idée l'aurait
    écrit, note à note, à chaque écoute : `idee-clavier.js` ignore l'entrée
    qui porte le nom de la sortie choisie.
  - Le dossier (`dossier-midi.js`) : choisi dans les réglages
    (`showDirectoryPicker`), Portée y écrit le .mid de chaque idée et de
    chaque morceau (`midiDeLIdee`, `midiDuMorceau`, tels quels), dans deux
    sous-dossiers, Idées et Morceaux, une seconde après le dernier
    changement, et seulement ce qui a changé (une empreinte par fichier).
    Un titre changé renomme le fichier, une idée effacée efface le sien,
    aucun autre fichier du dossier n'est touché. « Tout réécrire » remet un
    fichier effacé à la main ; « Ne plus écrire dans ce dossier » l'oublie,
    les fichiers restent. Le navigateur redemande la permission d'écrire à
    chaque visite (sauf « Autoriser à chaque visite ») : « Autoriser Portée
    à y écrire » la rend d'un toucher, et un message le dit, une fois par
    visite, quand des changements attendent.
  - Où le dossier se garde : dans une petite base à part, `portee-appareil`
    (version 1, un magasin `reglages`), pas dans `meta` de la bibliothèque :
    elle se synchronise, et un dossier de cet ordinateur n'aurait pas de
    sens sur le téléphone. La base `portee` et ses magasins ne changent pas.
  - Ce que ça coûte : une grosse bibliothèque (300 idées de 16 mesures, 30
    morceaux) se refait en 230 ms. Seule la première passe d'une visite
    refait tout, par tranches (la page ne s'arrête jamais plus de 18 ms) ;
    ensuite, seules les partitions changées (leur date de modification, et
    celles des idées d'un morceau) : 10 ms après une note changée.
  - Essayé dans Chromium, avec un faux bus IAC qui renvoie ce qu'il reçoit
    et un dossier de l'OPFS derrière un faux sélecteur : les quatre noires
    d'une idée à 120 partent à 500 ms d'écart exactement, envoyées 115 à
    140 ms d'avance ; leur retour par l'entrée du bus n'écrit rien, un vrai
    clavier MIDI écrit toujours ; piano muet, aucune note du piano et toutes
    au bus ; arrêt, All Notes Off ; le .mid s'écrit dans Idées et se renomme
    avec le titre ; à la visite suivante, le port, l'interrupteur et le
    dossier reviennent. Avec le vrai Live, reste à essayer (IAC ou loopMIDI,
    le dossier dans les Emplacements).
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
- **Après la fusion des autres lots (lint, essais dans Chromium).**
  `npm run lint` ne trouve aucune erreur dans les fichiers du lot ; le
  démarrage du micro (`idee-chant.js`) relit la promesse en cours avant de
  l'effacer, et l'accès MIDI du clavier (`idee-clavier.js`) est une
  promesse demandée une fois (redemandable si elle est refusée) : leurs
  avertissements `require-atomic-updates` sont réglés sans rien changer
  d'autre. `npm run e2e` : les 21 essais restent verts, dont
  l'écoute, le chant au faux micro, le mémo et « hors ligne dès la première
  visite », qui garde les 82 fichiers du piano par la liste de
  l'assembleur.

<!-- lot musique -->

### Outillage, hors ligne et dépendances (S2, I5, T1, T2, T6)

- **pdf.js passe en 6.4.299 (T6),** la version du 03/10. Toujours sa
  version `legacy/` : la version moderne appelle
  `Map.prototype.getOrInsertComputed`, que Safari ne connaît que depuis
  iOS 26.2 ; sur un iPhone plus ancien, plus aucun PDF ne se lirait. La
  lecture des pages d'essai n'a pas bougé (`npm test`), et l'import marche
  dans Chromium avec le nouveau worker.
- **abcjs et les polices viennent du site (S2).** abcjs venait de cdnjs
  sans empreinte, et les polices de Google Fonts : chaque visite donnait
  l'adresse IP du visiteur à Google, une panne du CDN laissait la partition
  vide, et la gravure hors ligne dépendait d'une première visite réussie.
  L'assembleur les copie depuis `node_modules`, dans les deux assemblages
  (site et claude.ai), aux versions de `package.json` (abcjs 6.7.1,
  `@fontsource` 5.3.0).
  - Les mêmes polices qu'avant : Young Serif, IBM Plex Sans (400, 500, 600,
    400 italique), IBM Plex Mono (400, 500), en latin et latin étendu. Leur
    licence (SIL OFL 1.1) voyage avec elles dans `polices/`, celle d'abcjs
    (MIT) dans `vendor/abcjs/` : les deux le demandent.
  - `app/styles/polices.css` dit quels fichiers prendre ; l'assembleur
    copie exactement ceux-là et s'arrête si l'un manque, ou si la page
    appelle encore une ressource d'un autre domaine.
  - abcjs contient, comme pdf.js, des caractères de contrôle bruts que le
    publieur de claude.ai refuse : il passe par la même réécriture.
- **Le site a une politique de sécurité du contenu (CSP, S2).** Elle ne
  laisse passer que les fichiers du site, et le connecteur
  (`https://*.supabase.co`). Un texte entré dans la page sans être échappé
  ne peut plus rien exécuter, même si `echapper` (S1) était oublié quelque
  part : c'est la seconde porte.
  - Chaque permission a sa raison, écrite dans `outils/assembler-appli.mjs`
    (les styles en ligne de la grille et d'abcjs, le worker de pdf.js, le
    mémo vocal…).
  - Dans un `<meta>` au début de la page : GitHub Pages ne laisse pas
    choisir ses en-têtes. La version claude.ai n'en porte pas, claude.ai
    pose la sienne.
  - Essayée dans Chromium sur tous les parcours, sans une violation :
    import des pages d'essai (pdf.js et son worker), gravure, correction,
    écoute, MIDI, idée au clavier, chant au faux micro, mémo vocal,
    sauvegarde.
- **Hors ligne dès la première visite (I5).** Le service worker ne gardait
  que ce qu'on avait déjà ouvert, et chaque mise en ligne vidait tout : le
  nouveau effaçait l'ancien cache dès son arrivée, avant d'avoir rien
  copié. Rejoué dans Chromium (serveur qui cache comme Pages) : après une
  mise en ligne, l'appli ne s'ouvrait plus hors ligne (`net::ERR_FAILED`).
  - À l'installation, il copie la coquille (84 fichiers : la page, les
    modules et feuilles de style de la version, abcjs, les polices, les
    modèles, les pages d'essai, les icônes). Une fois l'appli ouverte,
    pdf.js et le piano suivent en tâche de fond, un fichier après l'autre :
    3,4 Mo qui ne servent pas au démarrage. L'assembleur lui écrit la liste
    exacte.
  - L'ancien cache ne part qu'une fois le nouveau complet : une copie ratée
    laisse l'ancienne version entière, qui retente à la visite suivante.
    Seules les réponses `ok` sont gardées : une erreur de cdnjs restait
    servie toute une version (abcjs absent).
  - Le piano a son propre cache, nommé d'après l'empreinte de ses
    fichiers : il ne se retélécharge que s'il change, et s'il change,
    l'ancien part (`portee-piano-1` n'était jamais remplacé).
  - La navigation garde la règle du 02/10 : la page est redemandée au
    serveur, la copie ne sert que s'il manque, s'il est en panne ou s'il
    tarde (plus bas). La copie de la page n'est jamais remplacée en
    route : une page plus récente, venue du réseau, n'irait pas avec les
    modules copiés ; elle entre dans la copie avec sa version.
  - Quand une nouvelle version prend la main, une page ouverte d'une autre
    version dit « Une nouvelle version de Portée est prête » et propose
    « Recharger » : rien ne se recharge tout seul, tu peux être au milieu
    d'une prise. En revenant sur l'appli (au plus toutes les dix minutes),
    Portée demande s'il y a du neuf : une appli installée reste ouverte des
    jours.
  - Il ne touche plus qu'aux caches de Portée : il effaçait tous ceux du
    domaine, qui sert aussi tes autres sites.
  - Prouvé avec les deux essais de l'audit, adaptés : hors ligne après une
    première visite ; après une mise en ligne ratée (la v1 reste entière) ;
    après une mise en ligne réussie (le message, « Recharger », puis la v2
    hors ligne : pages d'essai lues, gravées, jouées) ; un 503 sur abcjs
    n'est plus gardé. Le service worker s'inscrit aussi sur l'ordinateur
    lui-même (`isSecureContext` plutôt que `https:`), pour ces essais.
- **Un réseau qui traîne n'arrête plus l'appli (I5).** L'audit de
  l'interface l'a mesuré : un serveur qui répond en 8 s, tout dans la
  copie, et pourtant 16 s avant le premier affichage, 40 s avant l'appli,
  parce que le service worker attendait toujours le réseau.
  - La page n'attend plus le serveur que 2,5 s, puis prend la copie.
    Pourquoi pas la copie tout de suite : la page doit rester la dernière
    mise en ligne (décision du 02/10), et 2,5 s couvrent une réponse sur
    un réseau mobile ordinaire.
  - Ce dont l'adresse porte une version vient de la copie d'abord : les
    modules, les feuilles de style, et maintenant pdf.js, abcjs et les
    polices, qui portent la version de leur paquet (`?v=6.4.299`…). Leur
    adresse ne change que s'ils changent : ils passent d'une version de
    Portée à l'autre sans être retéléchargés.
  - L'inscription du service worker attend que la page soit chargée : la
    copie de l'appli ne lui dispute plus le réseau à la première visite.
  - Mesuré dans les mêmes conditions (8 s par réponse, téléphone simulé,
    médiane de trois) : premier affichage 24,1 s → 2,6 s, appli prête
    80,1 s → 2,6 s.
- **Un démarrage plus rapide au téléphone, une page bien rangée (B1).**
  Mesuré avec le script de l'audit de l'interface (téléphone simulé,
  processeur ×4, « Slow 4G », serveur qui imite GitHub Pages, médiane de
  cinq chargements à froid) : icônes visibles 5,34 s → 2,17 s, appli
  prête 5,40 s → 3,96 s.
  - Le jeu d'icônes est écrit dans la page à l'assemblage (`jeuDIcones()` ;
    `app/icones.js` reste la seule source, et `injecterIcones()` ne le
    double pas) : les icônes arrivent avec le premier affichage, au lieu
    d'attendre les modules.
  - abcjs se charge en `defer` : il ne retient plus la page, et passe
    toujours avant `app.js`.
  - Les modules partent tous d'un coup (`<link rel="modulepreload">`, la
    liste que l'assembleur calcule en suivant les imports), au lieu d'être
    découverts import après import, une demi-seconde d'aller-retour à
    chaque fois sur un réseau mobile.
  - Le prix, dans cette mesure : le premier affichage arrive 0,7 s plus
    tard (1,56 s → 2,23 s), parce que les modules partagent le débit avec
    les feuilles de style ; le serveur de mesure ne suit pas les priorités
    du navigateur, qui demande les feuilles de style d'abord. Sans les
    `modulepreload`, le premier affichage serait à 1,53 s mais l'appli
    prête à 4,73 s : on a préféré l'appli utilisable plus tôt.
  - Le titre et les feuilles de style sont dans `<head>` (ils étaient dans
    `<body>`). La description de la page et du manifeste parle du carnet
    d'idées, du MIDI vers Ableton et des pages de la reMarkable ; la barre
    du navigateur prend la couleur du papier, clair ou sombre.
- **Lint et types (T2).** `npm run lint` (ESLint, ses règles recommandées)
  et `npm run types` (TypeScript lit les JSDoc et vérifie, sans rien
  compiler : le code reste du JavaScript pur).
  - Chaque dossier a les globales de l'endroit où il tourne : navigateur,
    service worker, Node, et « navigateur et Node à la fois » pour le
    lecteur et le connecteur (Deno et Node les lisent tous deux : rien de
    propre à l'un des deux n'y est permis). Les deux faux positifs de
    l'audit disparaissent.
  - Deux avertissements de plus, `require-atomic-updates` (une valeur lue
    avant un `await` et écrite après) et `no-throw-literal`. Ils ne
    bloquent pas : ils montrent un endroit à relire. Il y en a 29, dont
    celui de l'audit (`app.js:1427`, la double lecture pendant le
    chargement du piano). L'argument `cal` inutilisé de `lecteur.js:548`
    n'est qu'un avertissement le temps que le lot du lecteur le retire.
    `conversation.js` nomme exprès des caractères de contrôle (il les
    refuse dans ce qu'il reçoit) : la règle qui s'en méfie s'y tait.
  - Les types ne couvrent d'abord que des modules sans DOM qui passent à
    zéro erreur : le lecteur (sauf l'extraction), l'édition de l'ABC, les
    doutes, le zip, `echapper` et le connecteur (sauf `conversation.js`, et
    `mcp.js` et `http.js` qui l'importent). Ils sont vérifiés avec la
    bibliothèque « WebWorker » : un de ces modules qui toucherait à la page
    le dirait. Attendent une JSDoc corrigée : `extraction`, `sequence` (et
    avec lui `harmonie` et `musicxml`), `midi`, `morceau`, `synchro` ; et
    `conversation.js`, une fiche dont TypeScript ne devine pas le genre. Les
    écrans attendraient un typage du DOM que le mode normal ne devine pas,
    pour aucun bogue trouvé : pas maintenant. Le mode strict n'en vaut pas
    la peine.
  - TypeScript 7, la version native : moins d'une seconde pour tout.
- **Des essais de bout en bout dans Chromium (T1).** `npm run e2e` assemble
  le site, le sert comme GitHub Pages (`max-age=600`, empreintes, sous
  `/Musique/`) et y joue vingt et un essais dans Chromium, réseau extérieur
  coupé, en une vingtaine de secondes. Aucun écran n'était testé, et trois
  des quatre bogues de l'audit avaient été trouvés par de courts essais au
  navigateur.
  - Les parcours de CLAUDE.md d'abord : la page s'ouvre sans erreur (ses
    polices et abcjs viennent du site), import des pages d'essai, un doute
    réglé et une note corrigée puis annulés, écoute puis arrêt, le MIDI
    (`MThd`), sauvegarde puis restauration dans un navigateur vierge,
    traits compris.
  - L'éditeur d'idée : A S D F au clavier, la grille puis la partition,
    l'idée retrouvée après rechargement ; une note chantée au faux micro
    (un chanteur de synthèse, la4 puis do5) ; un mémo vocal enregistré
    puis réécouté ; « précédent » ferme la feuille du bas, puis revient au
    carnet sans quitter Portée.
  - La sécurité : une sauvegarde piégée (du HTML dans le titre, les
    étiquettes, le nom de piste, la durée du mémo, un accord, un
    identifiant de note) ne fait rien exécuter et n'atteint même pas la
    CSP ; sur la version d'avant S1, l'essai échoue (quatorze violations).
    Et le connecteur appelé par le site, sous sa CSP : le vrai
    `repondreHttp`, sur le faux cloud et le faux stockage (relier,
    importer, synchroniser).
  - Hors ligne : après une première visite (import, gravure, piano) ;
    une mise en ligne ratée, puis réussie (le message, « Recharger ») ;
    une erreur jamais gardée ; un réseau qui traîne (la copie à 2,5 s).
  - La version claude.ai simulée : le vrai assemblage (`npm run appli`) et
    un faux `window.claude` (la base, les téléchargements, et `use("mcp")`
    qui appelle `traiter()` du connecteur sur le faux cloud) : relier la
    tablette, importer, le MIDI zippé, la base retrouvée après
    rechargement, la sauvegarde piégée sans CSP.
  - L'interface : chaque bouton à icône a un nom, sur chaque écran et
    chaque feuille. Les 44 px au doigt (à 390 et 320 px) sont mesurés mais
    notés « à faire » : l'essai liste les cibles trop petites sans arrêter
    la suite, en attendant le lot de l'interface (I1).
  - Les deux assemblages vérifiés sans navigateur : la page ne demande
    rien d'ailleurs, le service worker garde tout ce qu'elle demande sous
    la même adresse, la version claude.ai n'a ni caractère de contrôle ni
    fichier d'un type inconnu.
  - Pourquoi `node:test` plutôt que le lanceur de Playwright : comme les
    autres tests ; seule la bibliothèque est ajoutée, en 1.56.1, la version
    des navigateurs installés ici (en CI, `npx playwright install`).
  - Trouvé en route, pas corrigé ici : une idée rechargée moins de 0,7 s
    après sa dernière note est perdue (son premier enregistrement attend
    encore ; rien ne l'écrit quand la page se ferme).
- **La CI du site vérifie tout, à chaque PR (S3, côté site).** Un job
  `verifier`, sur chaque PR et avant chaque mise en ligne : `npm test`,
  `npm run lint`, `npm run types`, `npm run e2e` (Chromium installé par
  `npx playwright install`) et `deno check` pour le connecteur. CLAUDE.md
  demandait ces vérifications avant de pousser ; rien ne les faisait.
  - Les actions sont épinglées par empreinte, la version en commentaire :
    une étiquette comme `v4` peut être déplacée vers un autre code. Le
    jeton GitHub ne reste plus dans le dépôt cloné
    (`persist-credentials: false`), aucun script d'installation de
    dépendance ne s'exécute (`npm ci --ignore-scripts`), et seul le job qui
    publie peut écrire, sur Pages.
  - Dependabot passe le lundi : une PR pour les dépendances, une pour les
    actions, que les mêmes vérifications jugent. Sauf Playwright, qui va
    avec les navigateurs installés là où Claude travaille (Chromium 1194) :
    il se monte à la main, avec eux.
  - `engines` : Node 22 au moins, la version de la CI et des essais
    (ESLint 10 demande déjà au moins Node 20.19).

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

- **Les petits outils de l'interface sont à un seul endroit (`app/ui.js`,
  T3).** `$` était redéfini dans six fichiers, `pluriel` dans quatre, et une
  vingtaine de pluriels étaient écrits sur place (`note${n > 1 ? "s" : ""}`).
  `ui.js` a maintenant `$`, `el`, `pluriel` et `accorde` (« 3 notes
  jouées »), les dates dites court (`dateCourte`, `dateRelative`, `heure`)
  et le message passager (`toast`). Les textes n'ont pas changé.
  - Pourquoi `ui.js` touche la page par `globalThis` : il est vérifié par
    `npm run types` sans le DOM, et importé par les tests sous Node.
- **Une seule façon de demander « Supprimer ? » (`app/dialogue.js`).** Il y
  en avait trois : la fenêtre de l'appli depuis le carnet, un bandeau sous
  la barre dans « Corriger » et « Écouter », et `window.confirm` pour effacer
  le mémo vocal (celle du navigateur ne suit pas l'ambiance, et une page
  intégrée à claude.ai peut ne pas avoir le droit de l'ouvrir : la réponse
  y était « non », sans rien montrer). Toutes passent par la fenêtre de
  l'appli ; les bandeaux `#confirmer` et `#confirmer-lecteur` sont retirés.
  - **Le focus va sur « Annuler » (I6).** `showModal()` le donnait au
    premier bouton, « Supprimer » : un Entrée de trop supprimait.
  - Essai : `tests/e2e/ecrans.test.mjs` (« supprimer une page lue »).
- **Les exports vivent dans `app/exports.js` (T3).** MIDI, MusicXML, ABC,
  « Tout en MIDI » et le partage du téléphone, avec une seule gestion des
  erreurs : chaque export avait la sienne, et « Tout en MIDI » fabriquait
  ses fichiers hors de la sienne (une partition illisible y devenait une
  erreur sans message). Le MIDI d'une idée (`midiDeLIdee`) passe de
  l'éditeur d'idée à `midi.js`, à côté de celui d'une page lue : les
  exports et le dossier des .mid n'importent plus tout l'éditeur pour lui.
- **Les erreurs se disent en français, avec quoi faire (`app/erreurs.js`,
  I13).** « Failed to fetch », « Invalid PDF structure », « Failed to fetch
  dynamically imported module… » ou « QuotaExceededError » s'affichaient
  tels quels. `expliquer(err)` reconnaît le réseau coupé, le PDF illisible
  (ou protégé), le module qui ne se charge pas, la mémoire pleine et le
  connecteur qui se tait, et dit en une phrase ce qui s'est passé puis quoi
  faire ; le détail reste dans la console. Un message que Portée écrit
  déjà en français passe tel quel. Essais : `tests/erreurs.test.mjs`.
  - Toutes les erreurs montrées passent par lui : l'ouverture de la
    bibliothèque, son écoute, le piano (l'éditeur, les accords, le jeu en
    direct), le micro (`messageMicro`), le port MIDI et le dossier des
    .mid (un dossier plein, déplacé ou supprimé a sa phrase à lui), la
    restauration d'une sauvegarde (la mémoire pleine). Essais : « ce qui
    empêche d'ouvrir le micro… » (`tests/micro.test.mjs`) et « ce qui
    empêche d'écrire… » (`tests/dossier-midi.test.mjs`).
  - Piège : un message de Portée se reconnaît comme français à ses
    accents ou à ses petits mots (le, la, pas, est…). Un message sans l'un
    ni l'autre (« fiche illisible ») passerait pour une erreur inconnue :
    écris-les en phrases.
- **Les vignettes sont dans `app/apercus.js` (T3).** Celle d'une idée
  vivait dans l'éditeur, celle d'un morceau dans l'écran Morceau, celle
  d'une page dans l'accueil : l'accueil importait tout l'éditeur d'idée pour
  dessiner des petits traits. Ce que la vignette d'une page garde de ses
  traits à l'import (`apercuTraits`) les rejoint, avec son essai.
- **La tablette et l'import ont leurs modules (T3).** `app/tablette.js`
  tient le panneau « Ma reMarkable », ses lignes dans les Réglages,
  l'adresse du connecteur (que la synchronisation emprunte) et les modèles
  à télécharger ; `app/import-pdf.js` lit un PDF ou un .mid et range la
  partition, pour lui comme pour la tablette (`enregistrerLecture`). Une
  page lue range ses doutes par `preparerDoutes`, la fonction que les
  essais du lecteur vérifient : l'appli en avait sa propre variante.
  - **pdf.js revient sans recharger (T4).** Après un échec du réseau,
    l'appli gardait la promesse ratée, et Chromium garde de toute façon
    l'échec d'un `import()` attaché à son adresse jusqu'au rechargement
    (essayé) : l'import de PDF échouait jusque-là, même le réseau revenu.
    La promesse ratée s'oublie, et l'essai suivant demande pdf.js à une
    autre adresse (`?essai=1`).
  - Le connecteur appelé du site lance de vraies `Error`, avec leur pile
    et leur cause, et toujours le `code` que l'appli lit (T4) ; c'étaient
    des objets bruts.
  - Essai : `tests/e2e/ecrans.test.mjs` (« un PDF illisible, puis pdf.js
    qui ne vient pas ») : le message dit quoi faire, en français, et le
    même import marche une fois le réseau revenu.
- **La synchronisation vue de l'appli a son module
  (`app/synchronisation-ui.js`, T3),** et un seul endroit reprend la
  partition ouverte quand elle change ailleurs (`rafraichirOuverte`).
  - **Plus de faux « modifiée sur un autre appareil » (T4).** L'idée et le
    morceau se rechargeaient dès que la synchro recevait quoi que ce soit,
    même une autre partition, et le disaient. Chaque écran compare
    maintenant ce qu'il montre (le titre, les notes, les blocs…) avec la
    version reçue : rien n'a changé pour lui, rien ne bouge et rien ne se
    dit. Et il ne recharge jamais pendant qu'une écriture attend ou part
    (avant, seule la minuterie comptait : la version d'avant pouvait
    remplacer à l'écran la note qu'on venait d'écrire).
  - **Un autre onglet qui change la partition ouverte la fait reprendre
    ici (S8, seconde moitié),** par `surAutreOnglet`. L'éditeur d'idée et
    le morceau disent au stockage d'où ils partent (`depuis`, la dernière
    version qu'ils savent dans la base) : si elle a changé entre-temps, les
    deux se fusionnent au lieu que l'une écrase l'autre. Cette version de
    départ est rangée avec l'ouverture (`session.derniere`), pas avec
    l'écran : une écriture en retard pour l'idée d'avant part avec la
    sienne.
  - Essai : « une idée ouverte ne se dit modifiée que si elle l'a été »
    (`tests/e2e/ecrans.test.mjs`), avec le vrai connecteur sur le faux
    stockage des tests.
- **Un enregistrement différé commun (`app/enregistreur.js`, T3, T4).** Il
  y en avait trois (« Corriger », l'éditeur d'idée, le morceau). Celui-ci
  fixe ce qu'il écrira au moment où on le planifie : la cible (la partition
  de ce moment-là) et une copie de son contenu. Une autre cible fait
  d'abord partir ce qui attendait ; les écritures se suivent. L'éditeur
  d'idée, le morceau et « Corriger » (`page-ouverte.js`) s'en servent ;
  avant, une écriture en attente
  au moment d'ouvrir une autre idée (« Idée tirée d'une phrase ») lisait
  l'idée suivante, et pouvait en créer une seconde.
  - **Une idée rechargée tout de suite n'est plus perdue (T4).** Le premier
    enregistrement attend 0,7 s, et rien n'écrivait quand la page se
    fermait. Tous les enregistreurs se vident quand la page passe en
    arrière-plan (`visibilitychange`), se recharge ou se ferme
    (`beforeunload`, `pagehide`). Ni l'un ni l'autre ne demande quoi que ce
    soit à Adrien.
  - **Et une copie de secours, pour quand la page n'a pas le temps.**
    Vider ne suffit pas : à `pagehide`, Chromium abandonne la transaction
    IndexedDB avec la page (essayé : l'idée était perdue à chaque fois), et
    à `beforeunload` elle se perdait encore une fois sur six quand la
    machine était chargée. Ce qui attend ou s'écrit encore part donc aussi
    dans `localStorage` (`portee:secours`), qui s'écrit d'un coup, sans rien
    attendre ; au démarrage suivant, `reprendreSecours` le remet dans la
    bibliothèque si l'écriture n'a pas fini (une version aussi récente ou
    plus gagne ; une partition supprimée depuis ne revient pas), puis
    l'efface. Si la page vit encore une fois tout écrit (une fermeture
    annulée), la copie s'efface aussitôt.
  - Essais : `tests/enregistreur.test.mjs`, et « quatre notes, puis un
    rechargement tout de suite » dans `tests/e2e/ecrans.test.mjs`.
- **« Corriger » et « Écouter » sont des fabriques, comme l'éditeur d'idée
  (`app/ecran-atelier.js`, `app/ecran-lecteur.js`, T3).** Leur état vivait
  à trois endroits : `etat`, des variables de module, et la page (l'ABC en
  cours se lisait dans le champ du mode avancé, « enregistrement en
  attente » dans le texte « … »). Chaque écran a maintenant le sien ; la
  page lue ouverte (sa fiche, ses traits, ses enregistrements) est
  partagée par les deux (`app/page-ouverte.js`). Ce qu'ils ont en commun
  pour faire entendre la page (la gravure, le tempo, l'écoute) est dans
  `atelier.js`.
  - **Une correction n'est plus perdue, ni écrite sur une autre partition
    (T4).** La minuterie de « Corriger » (800 ms) lisait la partition
    ouverte et le champ ABC au moment où elle partait : revenir à la
    bibliothèque et ouvrir une autre page dans ce délai perdait la
    correction et réécrivait l'autre page (reproduit par l'audit). Le tempo
    d'« Écouter » (600 ms) faisait pareil. Un changement vaut tout de suite
    pour la fiche en mémoire et part un instant après, avec la copie prise
    au moment du geste ; quitter l'écran ou ouvrir une autre page fait
    partir ce qui attendait. La relecture des cibles des doutes (une page
    lue avant le 02/10) écrit aussi dans sa page, plus dans celle qui
    s'est ouverte entre-temps.
  - **Une seule écoute à la fois, avec le jeton de l'écran Morceau
    (`app/ecoute.js`, T4).** Il sert maintenant à « Corriger », à
    « Écouter », au morceau et aux cartes de la bibliothèque (qui notaient
    leur bouton sur le transport, `transport.carte`). Le transport tient le
    même jeton de son côté depuis le lot son : l'écoute lancée puis quittée
    pendant que le piano se charge ne partait déjà plus (l'essai de l'audit
    passe sur la base). L'essai de bout en bout le garde.
  - Deux ouvertures rapprochées n'affichent que la dernière (elles
    portaient chacune la fiche lue avant d'attendre ses traits).
  - Essais : « corriger une note puis ouvrir vite une autre partition »
    (la correction, puis le tempo) et « Écouter pendant que le piano se
    charge » (`tests/e2e/ecrans.test.mjs`), `tests/ecoute.test.mjs`.
- **Un registre des écrans pour « précédent » (T3).** `reculer()` cliquait
  les boutons des autres écrans (`#fermer-rm`, `#idee-enregistrer`, la
  croix du menu en cercle…) et `aLaRacine()` lisait leur page. Chaque écran
  dit maintenant lui-même comment on le quitte (`fermer`), s'il a encore un
  pas à défaire (`reculer` → vrai : une note choisie, le jeu en direct, le
  menu en cercle, la recherche, un panneau de la tablette, un autre onglet
  que le carnet) et, pour l'accueil, s'il est à sa racine.
  `navigation.js` ferme d'abord le `<dialog>` ouvert, puis interroge
  l'écran, puis revient à l'écran d'avant ; `historique.js` n'a pas changé (il demande toujours
  `racine()` et `reculer()` à l'appli).
  - **« Précédent » laisse d'abord la note choisie dans « Corriger »,**
    comme il le faisait déjà dans l'éditeur d'idée.
  - L'accueil garde son état à lui (l'onglet, les filtres) : il l'écrivait
    dans celui de l'appli. Il dit son onglet (`accueil.onglet`).
  - **Le bouton « Portée » n'a plus qu'un gestionnaire** : app.js et
    l'accueil en avaient chacun un, et le carnet se dessinait deux fois.
  - Essais : « précédent dans Corriger » et « Portée, en haut »
    (`tests/e2e/ecrans.test.mjs`).
- **`app.js` ne fait plus que composer (T3) : 2 125 lignes avant le lot,
  ≈380 après.** Il crée les écrans et les modules, les relie (ouvrir une
  partition dans son écran) et tient le registre des écrans. Ce qui
  restait part chez qui s'en sert :
  - `app/gestes.js` : les gestes sur une partition entière (supprimer la
    page ouverte, dupliquer, ajouter à un morceau, le menu « ••• » de
    l'éditeur), chacun avec son message d'échec ;
  - les raccourcis passent par le registre : chaque écran y déclare
    `toucheBas` (et l'éditeur `toucheHaut`), et `navigation.js` garde
    pour tous la règle des fenêtres et des champs de texte (I6) ;
  - `app/navigation.js` : montrer un écran, la pile des écrans d'où l'on
    vient, et le bouton « précédent » (il interroge le registre des
    écrans) ;
  - l'accueil reprend l'écoute depuis une carte, le résumé d'une idée, le
    nom d'un modèle, la pastille d'une carte et la liste des étiquettes
    (`toutesEtiquettes`, que l'éditeur d'idée emprunte) ;
  - `app/sauvegarde-ui.js` : la sauvegarde dans un fichier et la
    restauration (`bilanRestauration`, désormais essayée) ;
  - `app/mises-a-jour.js` : l'appli installable, le service worker et la
    proposition de recharger après une mise en ligne.
- **Les touches restent à la fenêtre ou à la feuille ouverte (I6).** Avec
  une note choisie et « ••• » ouvert, Suppr effaçait la note derrière et ↑
  la montait ; dans l'éditeur, avec « Supprimer l'idée ? » ou « Ajouter à
  un morceau » ouverte, ↑ montait la note et Retour arrière l'effaçait, et
  Échap ne fermait jamais la fenêtre (l'éditeur la prenait pour lui, il ne
  regardait que ses propres feuilles). Les raccourcis s'arrêtent dès qu'un
  `<dialog>` est ouvert, où qu'il soit, et Échap est laissé au navigateur,
  qui le ferme. Le focus va sur « Annuler » (voir plus haut).
- **AZERTY : les durées de « Corriger » marchent (I12).** Elles se lisaient
  par le caractère (`key`) : « 1 » sans Maj donne « & » sur le clavier
  d'Adrien, et rien ne se passait, alors que l'éditeur, qui lit la touche
  (`code`), réagissait. Les durées se lisent maintenant par la touche (sans
  Maj), ou par le chiffre tapé (avec Maj, ou au pavé numérique). Avec Maj,
  la place ne compte plus : sur un QWERTY, Maj et 3 donnent « # », le
  dièse. Les lettres restent celles de la touche (`key`) : b pour bémol, n,
  z pour le silence ; la touche marquée Z d'un AZERTY est à la place du W
  d'un QWERTY.
  - Essais : « une feuille ou une fenêtre ouverte garde les touches » et
    « AZERTY » (`tests/e2e/ecrans.test.mjs`).
- **Les erreurs asynchrones ont un filet (T4).** Rien n'écoutait
  `unhandledrejection`, et plusieurs gestes attendaient le stockage sans
  `try` : supprimer (depuis le carnet, l'éditeur, « Corriger » ou le
  morceau), dupliquer, ajouter à un morceau, et l'affichage de « Corriger »
  (sa page, ses doutes). Un échec y passait sans un mot. Chacun dit
  maintenant ce qui s'est passé (erreurs.js) ; ce qu'aucun geste n'attrape
  se dit dans un message passager (`installerFilet`), et son détail reste
  dans la console. Les erreurs qu'on lance sont de vraies `Error`, avec
  leur cause (`erreur(code, message, { cause })`).
  - Essai : « une erreur que rien n'attrapait se dit, en français »
    (`tests/e2e/ecrans.test.mjs`) : supprimer quand la mémoire est pleine,
    puis une promesse rejetée.
- **`idee.js` se découpe aussi (T3) : 1 094 lignes avant le lot.** Ses
  feuilles partent dans des modules qui reçoivent leur contexte, comme ceux
  du pupitre :
  - `app/idee-carnet.js` : la feuille Carnet (note, étiquettes, favori,
    mémo vocal). Le mémo s'arrête et se tait par `carnet.fermer()`, que
    l'éditeur appelle en se fermant.
  - `app/idee-tempo.js` : la feuille Tempo et mesure, avec les pistes et
    les réglages par défaut des idées suivantes (`defauts`). Le tempo qu'on
    règle encore (`tempo.enAttente`) empêche toujours de recharger l'idée
    sous les doigts.
  - `app/idee-partition.js` : la gravure, ses jetons et ses éléments (qui
    étaient dans l'état, `e.jetons` et `e.elements`, alors qu'elle seule
    les lit), la note jouée, le curseur. Ce que veut dire un toucher sur la
    partition, c'est le cœur qui le décide (`surClic`). La mise en page
    (combien de mesures par ligne, quelle largeur de portée) est une
    fonction sans DOM, `mettreEnPage`, à qui l'on passe la gravure : les
    essais lui en passent une fausse (`tests/idee-partition.test.mjs`).
  - `app/idee-enregistrement.js` : les enregistrements de l'idée (vide,
    elle ne laisse rien ; la première note la crée ; la suite la modifie
    depuis la dernière version connue, S8 ; la copie de secours). Sans
    DOM, essayé sous Node avec un faux stockage
    (`tests/idee-enregistrement.test.mjs`) : c'est là que se perdaient les
    idées (T4).
  - **Le clavier, le chant et la partition lisent l'état en lecture
    seule** (un `Proxy` qui lève une erreur à l'écriture) : ils ne
    l'écrivaient pas, mais rien ne les en empêchait. Les modules qui
    changent l'idée (accords, sélection, jeu en direct, carnet, tempo)
    gardent l'état entier.
  - **L'éditeur ne montre plus à l'appli que ce qu'elle emploie** :
    `ouvrir`, `fermer`, `recharger`, `occupe`, `reculer`, `toucheBas`,
    `toucheHaut` et `id`. L'état entier (`etat`), `modifier`, `choisir`,
    les touches du piano et les accesseurs en sortaient, et rien ne s'en
    servait. Le lot « Claude dans l'éditeur » (H2) ajoutera ce qu'il lui
    faut, en lecture seule si lire lui suffit.
  - `app/idee-ecoute.js` : écouter, la boucle, le métronome, la tête de
    lecture. Les modules du pupitre en empruntent la source (le jeu en
    direct) et la pause du micro (les accords) par le contexte.
  - `idee.js` : 1 094 lignes avant, ≈620 après. Le reste est le cœur :
    l'état, annuler et refaire, jouer une note, la barre du haut, le choix
    du mode, et le contexte des modules.
- **Les types couvrent la musique, la fiche, la synchro et tout le
  connecteur (T2).** `sequence`, `accords`, `harmonie`, `midi`,
  `musicxml`, `morceau`, `fiche`, `synchro`, `idee-enregistrement`,
  `conversation`, `mcp` et `http` sont vérifiés par `npm run types`. Ils
  attendaient des JSDoc écrites en prose (`@param options { tempo, … }`,
  que TypeScript lit comme un type : le type s'écrit d'abord, `{Object}`,
  la prose ensuite), une note dont la vélocité est facultative (`poser`),
  un `surEtat` sans argument, une union de fiches que la vérification ne
  savait pas trier (`in` le lui dit).
  - `compacter` et `decompacter` (les traits d'une page) vivent dans
    `fiche.js`, sans DOM : la synchro les prenait dans `stockage.js`, qui
    touche à la page, et ne pouvait pas être vérifiée. `stockage.js` les
    donne encore, pour ceux qui les y prennent.
  - `stockage.js` reste hors des types, comme les écrans : il touche à
    `localStorage` et à `matchMedia`.
- **Lint** : plus d'avertissement dans `app.js`, `connecteur.js` et
  `idee.js` (les écritures après un `await` venaient des bogues T4-a et
  T4-b ; les objets lancés sont devenus des `Error` avec leur cause).
  L'exception `no-control-regex` de `eslint.config.js` pour
  `conversation.js` devient une directive sur la seule ligne qui en a
  besoin, avec son pourquoi. Restent cinq avertissements hors du lot :
  `objets.js` (connecteur) et quatre dans les essais de la synchro.
- **La palette sombre n'est plus écrite qu'une fois (T5).** Chaque jeton
  de `systeme.css` dit sa couleur claire puis sa couleur sombre,
  `light-dark(clair, sombre)`, et la racine suit le réglage du téléphone
  (`color-scheme: light dark`). Le contrat de claude.ai ne change pas :
  `data-theme="light"` ou `"dark"` sur la racine l'emporte (il fixe
  `color-scheme`). La palette sombre était écrite deux fois mot pour mot
  (pour le réglage du téléphone, puis pour `data-theme`), et
  `morceau.css` refaisait les deux pour une couleur. Le Studio garde sa
  palette à lui.
  - Vérifié écran par écran (bibliothèque, Corriger, éditeur, menu,
    fenêtre, morceau ; téléphone et ordinateur ; clair, sombre, et
    `data-theme` forcé dans les deux sens) : chaque jeton calcule la même
    couleur qu'avant, et les images sont les mêmes au pixel près, sauf
    l'anticrénelage de quelques icônes en clair (moins de 50 sur 255).
  - `light-dark()` ne choisit que des couleurs : l'ombre (`--ombre`), plus
    grande en sombre, s'écrit en deux ombres dont celle de l'autre
    ambiance est transparente.
  - Piège : la valeur brute d'un jeton n'est plus une couleur
    (`getPropertyValue("--stylo")` rend `light-dark(…)`). Pour colorer
    soi-même (abcjs et la note choisie), `couleurDuJeton("--stylo")`
    (ui.js) la fait résoudre par le navigateur.
  - Il faut Safari 17.5, Chrome 123 ou Firefox 120 (2024) ; un navigateur
    plus ancien perdrait toutes les couleurs.
- **Les notes rangées par pas, à un seul endroit (T5).** Ce que lit le
  transport (`notesA(pas)` et la fin) se calculait cinq fois : l'éditeur,
  les cartes de la bibliothèque, la feuille des accords, le morceau et les
  pages lues. `indexerParPas(notes)` (sequence.js, avec son essai) le fait
  pour tous, avec `Map.groupBy`.
  - `findLast` remplace les `[...x].reverse().find(…)` (accords, sélection,
    MIDI, séquence). `sq.cloner` reste un aller-retour en JSON plutôt que
    `structuredClone` : une séquence doit rester du JSON, et la copie le
    garantit ; `structuredClone` sert là où l'on copiait des blocs ou un
    changement (le morceau, « Corriger »).
  - Les écouteurs : mesuré dans Chromium, ouvrir et fermer dix fois
    l'idée, sa feuille Tempo, « Corriger », « Écouter », la feuille d'une
    carte et les onglets ne laisse ni écouteur ni nœud de plus (avant le
    lot non plus). Les écrans sont des fabriques qui branchent leurs
    écouteurs une fois pour toutes ; le seul écouteur posé puis retiré à
    chaque geste, le glissé du menu en cercle, passe par un
    `AbortController` (un `abort()` le retire, quelle que soit la façon
    dont le menu se ferme). Un écran qu'on recréerait ferait de même.
- **Code mort retiré**, chaque cas vérifié (ni la page, ni le code, ni
  les essais ne s'en servaient) : la classe `.transport` de l'atelier
  (l'écoute a son dock, `.dock-transport`), la classe `.mode` (l'état de
  la bibliothèque est passé dans Réglages, `#mode`, hors de l'éditeur),
  l'élément `#etat-son` du lecteur, l'icône `info`, la constante
  `PAS_PAR_NOIRE` de sequence.js. Le double gestionnaire du bouton
  « Portée » est parti avec le registre des écrans, et l'import d'une page
  passe par `preparerDoutes` (voir plus haut).

### Atelier et pages manuscrites (intégration des L, H1)

<!-- lot atelier -->

### Écrans des données (D6, D7, D9, H3)

<!-- lot écrans des données -->

### Interface (I1 à I4, I6 à I15)

<!-- lot interface -->

### Claude dans l'éditeur d'idée (H2)

- **`claude-idee.js` lit sequence.js, et les outils sont à part
  (`app/claude-outils.js`).** Le module gardait une copie de la mesure en
  pas et du nom des notes, et recevait les gestes des outils en paramètre :
  sequence.js ne passait pas `npm run types`, et un module vérifié fait
  vérifier ce qu'il importe. Il passe depuis le lot architecture : l'import
  est direct, et les outils de « Ce que tu veux » vivent dans leur module
  (claude-idee.js faisait 1 110 lignes). Ce que suggestions.js et
  claude-doute.js y prennent n'a pas bougé.
- **« Transpose en ré » transpose aussi les accords et la tonalité**
  (l'outil `transposer_idee`). L'outil `transposer` ne montait que les notes
  d'une piste : les accords restaient en do. Le nouvel outil fait ce que fait
  la feuille Tempo (`transposerIdee`) ; la copie peut donc changer de
  tonalité, mais seulement pour une tonalité du menu (c'est vérifié). Les
  outils sont rangés du plus utile au moins utile : si claude.ai en permet
  moins, ce sont les derniers (à l'envers, miroir) qui restent dehors.
- **Ce que l'écran dit quand `sample` échoue est écrit une fois
  (`lireEchec`),** code par code (sample.d.ts) : rien après « Arrêter » ; la
  fonction cachée pour la visite quand claude.ai la refuse (`not_granted`
  propose en plus d'autoriser Claude) ; « Claude est très demandé :
  réessaie dans un moment » ; une phrase pour une session expirée et pour un
  refus ; le message de refus de Portée pour le reste. Un code inconnu vaut
  `upstream_error`, comme le dit sample.d.ts. Jamais de nouvel essai tout
  seul : chaque appel coûte sur ton compte. Le second avis sur un doute (H1)
  peut s'en servir.
  - Piège : une erreur de `sample` ne passe pas par `expliquer` (erreurs.js) :
    il lit `upstream_error` comme le code du connecteur, et dirait « le
    connecteur ne répond pas… Supabase ». Seules les erreurs de Portée et du
    navigateur y vont.
- Deux fonctions sans DOM pour l'écran, essayées sous Node : ce qu'on écoute
  d'une proposition (`etendueEcoute` : une suite part de la dernière mesure,
  pour l'entendre arriver) et ce qu'elle dit en une ligne (`resume` :
  « 8 notes sur les mesures 5 et 6 », « 7 notes changées, en si mineur »).
- **« Demander à Claude », une feuille de l'éditeur d'idée (`app/idee-claude.js`,
  `styles/idee-claude.css`), dans la version claude.ai.** Elle s'ouvre depuis
  le « ••• » de l'idée (sur toute l'idée) ou depuis la boîte à outils de la
  sélection (sur les notes choisies). Cinq demandes : des accords, une suite
  de deux mesures, une variation (plus calme, plus sautillante, en mineur,
  plus ornée), un titre et des étiquettes, ou ce que tu veux, en une phrase.
  Claude propose, Portée vérifie (claude-idee.js), tu écoutes, puis tu
  gardes ; ce que tu gardes s'écrit d'un coup, et un seul « Annuler » le
  défait.
  - Sur le site, la fonction n'existe pas : ni la feuille ni ses entrées ne
    se montrent (`claude.use("sample")` n'y rend rien). Un bouton grisé
    promettrait ce que le site ne sait pas faire.
  - Une demande sans objet ne part pas : sa ligne dit pourquoi (« Écris
    d'abord quelques notes… ») au lieu d'envoyer une idée vide à Claude.
  - « Claude réfléchit… » tant qu'il n'a rien dit (souvent 10 à 60 s), puis
    « Claude écrit sa proposition… » : ce qu'il écrit est du JSON, il ne se
    montre jamais. « Arrêter » coupe la demande (un AbortController par
    appel) et ne dit rien.
  - Des accords : la bande des mesures, comme dans la feuille des accords,
    avec « avant : … » quand Claude remplace un accord, et teinté quand
    Portée trouve aussi qu'il va avec ta mélodie (harmonie.js : la racine et
    la triade que la mélodie appelle). C'est une comparaison, pas un
    verdict. Tu choisis l'accompagnement pour écouter, et il se garde avec
    les accords.
  - Des notes (suite, variation, ce que tu veux) : un petit rouleau des
    mesures qui changent ; ce qui reste en gris, ce que Claude propose en
    bleu, ce qu'il remplace en pointillé. « Écouter » joue ces mesures,
    accompagnement compris, sans rien écrire.
  - Un titre et des étiquettes : deux champs, que tu retouches avant de
    garder. Ils s'écrivent comme si tu les avais tapés, hors d'« Annuler »,
    comme le titre et le carnet.
  - « Ce que tu veux » : si claude.ai permet les outils de page, Claude fait
    ses gestes sur une copie, et la feuille dit où il en est (« Sur la
    copie : toute l'idée montée de 2 demi-tons, en ré majeur ») ; sinon il
    rend toute la piste en notes. Après `tools_unavailable`, la demande
    suivante part sans outils.
  - Ce que tu gardes passe par le cœur de l'éditeur, par deux méthodes
    explicites : `remplacerIdee` (par son `modifier`, d'où le seul
    « Annuler ») et `changerTitre`. Le lot architecture a fermé l'état
    exprès : il reste fermé, la feuille le lit en lecture seule.
  - Rien ne s'applique si l'idée a changé pendant que Claude réfléchissait
    (la synchro, un autre onglet) : la feuille le dit, tu redemandes. On
    compare l'ouverture de l'idée et sa version, pas son identifiant : une
    idée neuve reçoit le sien à son premier enregistrement, peut-être
    pendant que Claude réfléchit.
  - Une variation des notes choisies laisse les nouvelles notes choisies :
    tu vois ce qui a changé. Après une suite, le curseur va au bout.
  - `not_granted` : la feuille dit d'autoriser Claude, et « Autoriser
    Claude » ouvre le panneau de claude.ai (`permissions.manage()`, intégré
    à la page, jamais déclaré) puis relit l'état ; sans panneau, la phrase
    dit où le trouver (le menu Autorisations de la page). D'ici là, la
    fonction se cache pour la visite. `rate_limited` : « Claude est très
    demandé : réessaie dans un moment ». Jamais de nouvel essai tout seul.
  - L'entrée du « ••• » passe par idee.js, comme le Carnet et le Tempo, pas
    par gestes.js : elle a besoin de l'idée telle qu'elle est à l'écran (sa
    sélection), et « Ce que tu veux » sert aussi sur une idée vide, que les
    gestes de gestes.js refusent.
  - Essais : `tests/e2e/claude-idee.test.mjs`, au téléphone, avec un faux
    `sample` (`tests/e2e/faux-sample.mjs`, posé par-dessus le faux
    claude.ai) qui répond ce que l'essai prévoit ; et rien n'apparaît sur
    le site ni dans une version claude.ai sans `sample`.
  - Piège : `.gardee` et `.neuve` servent déjà au mode Chanter
    (idee-chant.css), sans qualificatif : le rouleau prend des noms à lui
    (`claude-reste`, `claude-propose`, `claude-remplace`).
  - À la republication de la version claude.ai, déclarer `sample`
    (`{ sample: {} }`, avec db, downloads et mcp redonnés en entier).

### Claude dans Portée : ce qui part, ce qui est vérifié (H1, H2, H3)

Trois modules purs, sans DOM, pour les écrans qui viendront. Le principe de
l'audit : Claude propose, Portée vérifie, Adrien écoute puis choisit. Aucun
module n'appelle `sample` ni n'écrit quoi que ce soit : l'écran appelle
(avec `signal`, `onText` et les codes d'erreur), puis écrit ce qu'Adrien
garde.

- **Sur une idée (H2, `app/claude-idee.js`).** `demande`, `valider`,
  `appliquer`, `outilsSurCopie`, et `empechement` pour griser un bouton.
  - Ce qui part : un texte compact en français. Tempo, mesure en pas,
    tonalité, accords en « mesure.temps », notes mesure par mesure (début et
    durée en pas, hauteur MIDI et nom épelé dans la tonalité). Puis la
    tâche, ses bornes et la forme exacte du JSON, avec un exemple. Les
    bornes sont dites d'avance : Claude s'y tient, et chaque refus coûte un
    aller-retour à Adrien.
  - Genres : accords (l'idée ou la sélection), suite (deux mesures après la
    dernière), variation (quatre intentions glosées : un mot seul laisse
    trop de place), titre (au modèle rapide), libre (une phrase d'Adrien).
  - Taille : l'idée la plus dense de 64 mesures (1 024 notes) fait 18 000
    caractères, une idée ordinaire moins de 3 000. Au-delà de 2 000 notes,
    on ne demande pas : mieux vaut un passage.
  - `cache: false` : une réponse que Portée refuse a réussi pour `sample`,
    qui la rejouerait cinq minutes à chaque « réessaie ».
  - Ce qui revient est vérifié champ par champ : forme sûre (ni
    `__proto__`, ni tableau énorme, ni NaN), clés exactes, entiers, notes
    dans leur place, hauteurs de 21 à 108 et à une octave au plus de la
    piste (deux pour « libre », où Adrien a pu demander un autre registre),
    pas deux fois la même note en même temps, accords lisibles par
    `accords.js`, un ou deux par mesure, sur un temps. Rien n'est réparé :
    une réponse « presque juste » a souvent compris autre chose. Seul le
    `pourquoi` est coupé s'il est trop long : il n'est qu'à montrer.
  - Une variation identique à l'original n'est pas une proposition. Le
    refus garde le `pourquoi` de Claude, que l'écran peut montrer.
  - `appliquer` rend une nouvelle séquence, écrite d'un coup : un seul
    « Annuler ». Des accords posés sur une sélection redisent à sa fin
    celui qui sonnait, sinon la mesure d'après changerait d'harmonie. Le
    premier accord met les accords plaqués en route, comme à la main.
  - « libre » avec outils : ils ne touchent qu'une copie, et ce sont les
    gestes de `sequence.js` (Claude fait ce que ferait le doigt d'Adrien).
    Un geste qui ferait se chevaucher deux notes, ou déborderait, est
    défait, et Claude lit pourquoi. La copie est revérifiée à la fin.
  - Pourquoi les gestes passent en paramètre : `sequence.js` ne passe pas
    encore `npm run types` (deux JSDoc), et un module vérifié qui
    l'importerait l'y entraînerait. La mesure en pas et le nom des notes
    sont recopiés ; un test les compare à `sequence.js` sur les 24
    tonalités et les 88 touches.
- **Sur un doute (H1, `app/claude-doute.js`).** `messageDoute`,
  `validerAvis`, `avisPossible`, `OPTIONS_AVIS`.
  - Ce qui part : la mesure en ABC (avec son chiffrage et son armure), ce
    que le lecteur a compris (les têtes de gauche à droite et leur hauteur,
    ce qui est sûr, ce qu'il a mesuré en interlignes), puis la question de
    `poser` et ses réponses, exactement celles qu'Adrien voit, numérotées
    de 1, avec ce que chacune fait.
  - Le message dit que la hauteur vient de la position et qu'il ne faut pas
    la contester : les modèles situent et comptent mal dans une image, le
    lecteur, lui, mesure. Une phrase explique l'image quand l'écran en joint
    une (le passage recadré, têtes numérotées dans le même ordre).
  - L'exemple du JSON montre des emplacements, pas des valeurs : un « 1 »
    d'exemple tirerait l'avis vers la première réponse.
  - Ce qui revient : un numéro de la liste ou null (« je ne sais pas »,
    un avis qu'on montre comme tel), une confiance de 0 à 1, une phrase.
    Rien d'autre n'est accepté. `rang` est compté de 0, comme le rang d'un
    doute au connecteur.
  - Claude conseille, il ne corrige pas : c'est le toucher d'Adrien qui
    applique le geste de la réponse, comme toujours. Une question à moins
    de deux réponses fermées ne part pas : il n'y a rien à trancher.
- **Les suggestions d'une conversation (H3, `app/suggestions.js`).**
  `validerSuggestion`, `appliquerSuggestion`, `resumeSuggestion`.
  - Le connecteur vérifie à l'écriture ; l'appli revérifie à la lecture :
    une fiche peut venir d'un connecteur plus ancien, d'une main, d'un
    stockage abîmé, et la partition a pu changer depuis. Mêmes bornes que
    le connecteur (hauteurs de 21 à 108, durées positives, accords lisibles
    par `accords.js`), plus celles de la bibliothèque (16 384 pas, 20 000
    notes), au-delà desquelles `fiche.js` rabattrait en silence. Un test
    fait écrire de vraies suggestions par `suggestion_ecrire` et les relit.
  - La cible doit être celle de la fiche ; des notes et des accords ne
    vont qu'à une idée. La suite commence à la barre qui suit la dernière
    mesure ; une variation peut aller jusqu'au double de l'idée.
  - Une suggestion qui ne changerait rien (déjà appliquée sur un autre
    appareil, doute déjà réglé) est refusée avec `sansEffet` : l'écran peut
    l'écarter sans la montrer.
  - Une liste d'accords vide dans une variation n'efface pas ceux
    d'Adrien : dans le doute, on ne détruit rien.
  - Une réponse à un doute n'est qu'une phrase : elle ne peut pas réécrire
    l'ABC. Appliquée, elle devient l'avis de Claude sur ce doute (`avis`),
    que l'atelier montrera près de la question ; le doute reste ouvert.
  - L'ABC d'une idée modifiée est vidé : le stockage le refait d'après les
    notes (`normaliserFiche`), comme pour une idée écrite par le connecteur.
    `suggestions.js` n'importe donc pas `fiche.js`, qui ne passe pas encore
    `npm run types`.

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
  - **Gemini** (vision), *écarté le 30/09*. Un test public de septembre 2026
    conclut que les hauteurs se lisent, pas le rythme. La veille de l'audit
    (04/10) l'a retrouvé : il portait sur de l'imprimé de 1852, pas sur du
    manuscrit.
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
    ligatures). Silences et altérations passaient par la forme des traits ;
    un classifieur entraîné sur [HOMUS](https://grfia.dlsi.ua.es/homus/)
    était prévu. *Remplacé le 04/10 (L16)* : HOMUS n'indique pas ses
    conditions d'usage, et le reconnaisseur apprend plutôt sur ton écriture
    (une page d'étalonnage, puis tes corrections).
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
4. **Autres signes** : *fait dans le lecteur (04/10), à brancher dans l'appli*.
   - Reconnus par les règles : soupirs et demi-soupirs, pauses et
     demi-pauses (par leur place), bémols, dièses (même collés), bécarres,
     accents, liaisons de durée ; un triolet est un doute.
   - Avec tes gabarits (page d'étalonnage, puis tes corrections) : silences
     courts (dont le quart de soupir), altérations, chiffres du chiffrage
     (lu au lieu d'être deviné), « 3 » des triolets.
   - Pas encore : importer la page d'étalonnage et apprendre des réponses
     dans l'appli (lot atelier) ; nuances, ornements et paroles restent
     ignorés. HOMUS écarté (licence non indiquée) : les gabarits viennent de toi.
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
  Le service worker copie à l'installation tout ce que l'assembleur met
  dans `dist/` (sauf le piano, à part, et les licences) : un fichier que
  l'appli demande doit donc sortir de l'assembleur, sinon il manque hors
  ligne. Les fichiers tiers (pdf.js, abcjs, polices) portent la version de
  leur paquet, que l'assembleur met dans leur adresse (`import-pdf.js`, la
  page, `polices.css`) : il cherche pdf.js sous la forme
  `"./vendor/pdfjs/pdf.min.mjs"` dans `import-pdf.js` (dans `app.js`
  jusqu'au 05/10), et s'arrête s'il ne la trouve plus.

- **pdf.js 6** utilise `Map.prototype.getOrInsertComputed`, disponible
  partout seulement depuis le 14/02/2026 (Chrome 145, Firefox 144,
  Safari 26.2) : garder la version `legacy/` tant qu'un iPhone antérieur à
  iOS 26.2 doit pouvoir lire un PDF.
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
  fusionnés). L'ancien test « arrondir les traits » ne le vérifiait que pour
  un arrondi sans décalage : avec une autre phase, la mélodie se relisait
  autrement 42 fois sur 100 (audit du 04/10). Le lecteur arrondit maintenant
  lui-même (`lecteur/traits.js`), et un test vérifie la lecture pour 36
  phases sur tes deux pages. Un réglage qui rapproche une décision d'un seuil
  le fera échouer : c'est voulu.
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
- **IndexedDB `portee`, version 3** : magasins `partitions`, `pages`,
  `envois` (file à synchroniser, un numéro par envoi), `meta` (curseur,
  adresse, « rejoint », et la quarantaine : `quarantaine:<envoi|reception>:<id>`)
  et `bases` (depuis la version 3 : la dernière version de chaque partition
  convenue avec la bibliothèque commune, d'où part la fusion). La migration
  2 → 3 garde tout. Changer l'adresse du connecteur remet le curseur à zéro
  et vide les bases et la quarantaine : une autre adresse, c'est une autre
  bibliothèque commune. Une version plus récente de la base fait lâcher la
  base aux onglets ouverts (`onversionchange`) ; un vieil onglet qui ne la
  lâche pas bloque l'ouverture : l'appli le dit, et attend.
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
- **Essais Chromium derrière le proxy** : depuis le 04/10, abcjs et les
  polices viennent du site ; plus rien ne passe par le proxy, et les
  essais de bout en bout (`tests/e2e/`) coupent tout le réseau extérieur.
  Pour couper ou ralentir le réseau, c'est le serveur d'essai qu'on coupe
  (`serveur.reseau(false)`, `serveur.ralentir(ms)`) : ni
  `context.setOffline` ni le bridage de Chromium ne touchent les requêtes
  du service worker. `page.waitForFunction` n'attend pas une promesse :
  pour une condition asynchrone (les caches), `attendreQue`. Un faux
  micro : `--use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=chant.wav` (un chanteur de synthèse,
  `ecrireChant`).
- **Micro et clavier MIDI** : ni l'un ni l'autre dans la page claude.ai
  (cadre sans ces permissions) ; Safari (iPhone, iPad) ne lit pas les
  claviers MIDI. Le micro et le son ne marchent pas en même temps : on coupe
  l'un pour l'autre (sinon le piano repasse dans le micro). Sur l'iPhone,
  tout ce qui ouvre le micro passe la session audio en « play-and-record »
  et la rend à « playback » après, refus compris (`sessionAudio`,
  `eveil.js`) : l'oublier, c'est un piano qui obéit de nouveau au bouton
  silencieux. La sortie MIDI vers IAC ou loopMIDI revient par l'entrée du
  même nom : tout ce qui écoute les entrées MIDI doit l'ignorer
  (`enBoucle`, `sortie-midi.js`), sinon chaque écoute réécrit l'idée.

## Questions ouvertes

1. Tes pages d'essai du 30/09 : ce que tu voulais écrire. La 3ᵉ mesure de la
   ligne 2 fait 11 croches au lieu de 12 : est-ce le petit trait au bout d'une
   hampe, un crochet oublié ?
2. Les modèles v1 conviennent-ils à la main (interlignes, nombre de portées) ?
