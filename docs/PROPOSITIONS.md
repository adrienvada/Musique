# Propositions — de la tablette au piano

*État au 30 septembre 2026. Rien n'est encore décidé : ce document décrit les
options, la recommandation, et les questions qui attendent Adrien.*

Version illustrée (schémas, maquettes jouables de l'interface) :
https://claude.ai/artifact/99p6MDcPHbxYz8z1yvEfAn

## Le besoin

Des partitions écrites à la main sur la reMarkable, synchronisées avec le
cloud reMarkable, doivent devenir des partitions lisibles sur le portable et
jouables avec un son de piano correct. Contrainte : **0 €**.

## Le trajet d'une page

| # | Étape | Qui | Ce qui en sort |
|---|---|---|---|
| 1 | Écrire | Adrien, sur la tablette | traits vectoriels `.rm` (format v6) |
| 2 | Récupérer | automatique | une image par page |
| 3 | **Lire** | automatique | ABC + mesures douteuses |
| 4 | Relire | Adrien, 1 à 2 min | ABC validé |
| 5 | Écouter | le portable | SVG, MIDI, MusicXML |

**Format pivot : l'ABC.** C'est du texte : une IA l'écrit, on le corrige à la
main, il se convertit en partition gravée, MIDI et MusicXML (MuseScore).

**Seule l'étape 3 est incertaine.** Les autres sont de la plomberie connue.

## Les briques retenues ou à tester

- **Récupérer** : [`rmapi`](https://github.com/ddvk/rmapi) (fork maintenu par
  ddvk, v0.0.35 en août 2026) dans une tâche GitHub planifiée, puis
  [`rmscene`](https://github.com/ricklupton/rmscene) /
  [`rmc`](https://github.com/ricklupton/rmc) pour le rendu.
  - API non officielle, qui a déjà cassé une fois lors d'un changement de protocole.
  - Pas confirmé sans l'abonnement Connect : à vérifier dès l'étape 1.
  - `rmc` 0.3 exige `rmscene < 0.7`, ce qui le met en conflit avec rmscene 0.8.
  - Secours : l'export manuel depuis la tablette (e-mail en PDF, PNG ou **SVG**,
    ou Google Drive).
- **Lire** : trois moteurs, à départager au banc d'essai.
  - **Gemini** (vision). Un test public de septembre 2026 sur du manuscrit
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
  - Pari : le papier calibré pour les hauteurs, plus un second moteur pour le
    rythme. Leurs désaccords deviennent les mesures à relire.
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
  le projet du site, dans un schéma à part. Un projet s'endort après une semaine
  sans requête ; la synchro toutes les 2 h suffit à le garder éveillé.
- **GitHub Pages** n'est pas gratuit pour un dépôt privé. L'appli serait donc
  servie par Cloudflare, comme les aperçus de branche du site.
- **GitHub Actions** donne 2 000 min/mois gratuites en privé. Une synchro toutes
  les 2 h en consomme quelques centaines.

## Plan (formule B)

Les étapes 0 à 3 sont communes aux trois formules. Le choix A/B/C peut donc
attendre l'étape 3.

0. **Banc d'essai de la lecture.** Cinq pages réelles, dont deux sur papier
   calibré, passent dans les trois moteurs. On compte séparément les hauteurs
   justes et les rythmes justes.
1. **Récupération** : rmapi + rmscene dans une tâche GitHub, jeton d'appareil
   en secret, seules les pages modifiées sont retraitées.
2. **Lecture automatique** par le moteur retenu, avec contrôle de l'ABC et des
   temps par mesure.
3. **Lecteur** : appli web avec bibliothèque, gravure, piano, tempo,
   transposition et export MIDI.
4. **Atelier + Supabase** : connexion par lien magique et historique des versions.
5. **Bouton « Synchroniser maintenant »** : une Edge Function lance le workflow.
6. *(option)* **Papier calibré et lecture hybride.** Passe en deuxième si le
   banc d'essai le désigne.
7. *(option)* **Exports MusicXML et PDF.**
8. *(option)* **Passerelle Ableton** : dossier de `.mid` synchronisé et
   version enregistrée suivie par le curseur. L'export MIDI simple arrive dès
   l'étape 3.

## Questions ouvertes

1. Que contiennent les pages : mélodie seule, piano à deux mains, accords, paroles ?
2. Quelle tablette (reMarkable 2, Paper Pro) ? Abonnement Connect ou non ?
3. Gemini : l'offre gratuite est une zone grise (voir plus haut). Faut-il s'en
   passer, ou payer moins d'un centime par page ?
4. Formule A, B ou C ? B par défaut.
