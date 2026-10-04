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
    caractère faux, et le temps de réponse disait combien étaient justes.
    On compare les empreintes SHA-256 jusqu'au bout ;
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
  - **Six requêtes à la fois** au lieu de douze, qui se faisaient refuser
    par paquets.
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

### Données et synchronisation (S6, D1 à D10)

<!-- lot données -->

### Son, temps, notation et exports (M1 à M12, N1 à N7)

<!-- lot musique -->

### Outillage, hors ligne et dépendances (S2, I5, T1, T2, T6)

<!-- lot outillage -->

### Architecture (T3 à T5)

<!-- lot architecture -->

### Atelier et pages manuscrites (intégration des L, H1)

<!-- lot atelier -->

### Écrans des données (D6, D7, D9, H3)

<!-- lot écrans des données -->

### Interface (I1 à I4)

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
  l'un pour l'autre (sinon le piano repasse dans le micro).

## Questions ouvertes

1. Tes pages d'essai du 30/09 : ce que tu voulais écrire. La 3ᵉ mesure de la
   ligne 2 fait 11 croches au lieu de 12 : est-ce le petit trait au bout d'une
   hampe, un crochet oublié ?
2. Les modèles v1 conviennent-ils à la main (interlignes, nombre de portées) ?
