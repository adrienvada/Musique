# Modèles de papier à musique calibré

Quatre PDF à importer sur la reMarkable 2. L'outil connaît la position exacte
de chaque ligne de chaque portée (fichiers `.json`). Il déduira donc la
hauteur de tes notes des coordonnées de tes traits, sans rien deviner.

| Modèle | Contenu d'une page | Interligne |
|---|---|---|
| `melodie-large.pdf` | 5 portées en clé de sol | 4,5 mm |
| `melodie-standard.pdf` | 7 portées en clé de sol | 3,6 mm |
| `piano-large.pdf` | 3 systèmes piano (sol + fa, accolade) | 4,0 mm |
| `piano-standard.pdf` | 4 systèmes piano | 3,1 mm |

Chaque PDF a 12 pages identiques, au format exact de l'écran (157,2 ×
209,6 mm) : la tablette l'affiche sans marge ni mise à l'échelle.

Et une page à remplir une fois, `etalonnage.pdf` (4 pages identiques) : voir
plus bas.

## Installer les modèles sur la tablette

1. Glisse les quatre PDF dans l'appli reMarkable de l'ordinateur ou sur
   [my.remarkable.com](https://my.remarkable.com).
2. Sur la tablette, range-les dans un dossier `Partitions/Modèles`.

## Écrire une nouvelle pièce

1. Appui long sur le modèle voulu → **Dupliquer**.
2. Renomme la copie avec le titre de la pièce : ce nom deviendra le titre de
   la partition. Tu n'as pas besoin d'écrire le titre sur la page.
3. Range la copie dans `Partitions`, puis écris.

**Pour les premiers essais, garde l'affichage par défaut du document** : ne
le recadre pas et n'enregistre pas de zoom personnalisé. La correspondance
entre tes traits et les lignes de la portée repose sur cet affichage. Tes
pages d'essai montreront ce que la tablette tolère.

## Ce qui aidera la lecture

Ces conseils seront affinés quand le lecteur aura vu tes premières pages.

- Écris l'armure et le chiffrage juste après la clé imprimée, sur la première
  portée (ou le premier système).
- Centre les têtes de notes sur leur ligne ou leur interligne. La tolérance
  est d'un quart d'interligne ; au-delà de 0,2 interligne, Portée te demande
  quelle note c'était.
- Pour les têtes pleines, un petit gribouillis rempli, d'au moins un
  demi-interligne de haut ou de large. Pas un simple point appuyé : il se
  confondrait avec un point de durée, et Portée ne le lit pas comme une tête.
  Pour les têtes vides, une boucle fermée.
- Accroche les hampes aux têtes. Trace les ligatures en traits droits.
- Fais traverser toute la portée à tes barres de mesure (au piano, les deux
  portées ou chacune).
- Un outil fin (Fineliner ou Ballpoint) plutôt que le Marker, et pas de
  surligneur sur les notes.

## La page d'étalonnage

Elle apprend au lecteur ta façon d'écrire les signes qu'il reconnaît mal
tout seul : silences (dont le quart de soupir), dièse, bémol, bécarre,
chiffres du chiffrage (1 à 9, « C », « C » barré) et « 3 » de triolet.
Chaque case montre le signe en gris, à sa place sur la portée : écris-le
trois fois à côté, un par case pointillée, comme tu l'écris d'habitude
(pas plus soigné). Une page suffit ; une deuxième affine.

Le lecteur en tire tes gabarits (`lecteur/gabarits.js`). Avec eux, il lit
le chiffrage écrit au lieu de le deviner, et reconnaît ces signes chez toi ;
sans eux, il lit comme avant. Chaque signe que tu corriges peut aussi
devenir un exemple.

## Pour le développement

- `outils/generer_modeles.py` refait les PDF, les JSON et les aperçus
  (`apercu/*.svg`). Il suffit de lancer `pip install -r outils/requirements.txt`
  puis `python outils/generer_modeles.py`. Le résultat est identique au
  pixel près, et le sujet du PDF (`portee:<modèle>:v<N>`) identifie le modèle
  et sa version.
- **Chaque version garde sa calibration** : le générateur écrit
  `<modèle>-v<N>.json` à côté de `<modèle>.json` (la version en cours), et
  n'efface jamais une version passée. Une page se lit avec la calibration de
  sa version ; une version que Portée ne connaît pas est refusée avec un
  message clair. Changer la géométrie d'un modèle (ses lignes, sa taille),
  c'est incrémenter `VERSION` : les pages déjà écrites gardent la leur.
- Les lignes grises du modèle restent dans le PDF exporté par la tablette :
  Portée s'en sert pour reconnaître le modèle quand le sujet manque ou se
  trompe, et pour recaler une page qui aurait bougé (`lecteur/modeles.js`).
- Dans le JSON, les coordonnées sont en pixels de l'écran (1404 × 1872,
  226 ppp), avec l'origine en haut à gauche. Pour chaque portée, `lignes`
  donne les 5 ordonnées de haut en bas et `ligne_du_bas` la note posée
  dessus (mi4 en clé de sol, sol2 en clé de fa). `x_apres_cle` dit où
  commence ce que tu écris : l'en-tête d'une ligne (armure, chiffrage) ne
  va pas plus de 9 interlignes au-delà.
- Dans les fichiers `.rm` v6 (le connecteur), l'abscisse des traits est
  centrée sur la page et compte 227 unités par pouce : vérifié le 30/09 sur
  les pages d'essai (`supabase/functions/portee-remarkable/rm.js`).
- Clés et accolade viennent de la police Bravura (SIL OFL 1.1, voir
  `outils/LICENCE-Bravura-OFL.txt`), extraites une fois pour toutes par
  `outils/extraire_glyphes.py` ; les signes de la page d'étalonnage, de
  Bravura 1.392. Le script n'ajoute que les signes qui manquent : réextraire
  la clé de sol d'une autre version de la police changerait tes modèles.
- La calibration de la page d'étalonnage (`etalonnage.json`, `genre:
  "etalonnage"`) a ses portées, comme les autres (ses lignes grises la
  reconnaissent), et ses `cases` : l'étiquette de chaque signe et la zone où
  tu l'écris.
