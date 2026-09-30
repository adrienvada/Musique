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
  est d'un quart d'interligne.
- Pour les têtes pleines, un petit gribouillis rempli ou un point appuyé.
  Pour les têtes vides, une boucle fermée.
- Accroche les hampes aux têtes. Trace les ligatures en traits droits.
- Fais traverser toute la portée à tes barres de mesure (au piano, les deux
  portées ou chacune).
- Un outil fin (Fineliner ou Ballpoint) plutôt que le Marker, et pas de
  surligneur sur les notes.

## Pour le développement

- `outils/generer_modeles.py` refait les PDF, les JSON et les aperçus
  (`apercu/*.svg`). Il suffit de lancer `pip install -r outils/requirements.txt`
  puis `python outils/generer_modeles.py`. Le résultat est identique au
  pixel près, et le sujet du PDF (`portee:<modèle>:v1`) identifie le modèle.
- Dans le JSON, les coordonnées sont en pixels de l'écran (1404 × 1872,
  226 ppp), avec l'origine en haut à gauche. Pour chaque portée, `lignes`
  donne les 5 ordonnées de haut en bas et `ligne_du_bas` la note posée
  dessus (mi4 en clé de sol, sol2 en clé de fa).
- **À vérifier** sur la première page écrite : dans les fichiers `.rm` v6,
  l'abscisse des traits semble centrée sur la page (`x_page = x_rm + 702`).
- Clés et accolade viennent de la police Bravura (SIL OFL 1.1, voir
  `outils/LICENCE-Bravura-OFL.txt`), extraites une fois pour toutes par
  `outils/extraire_glyphes.py`.
