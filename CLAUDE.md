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

## Vérifier

```bash
npm ci && npm test
npm run lire -- tests/pages/2026-09-30-melodie-standard.pdf --svg   # image de contrôle
```

L'image de contrôle colore chaque trait selon ce que le lecteur en a compris.
C'est le premier réflexe quand une lecture est fausse.

## Republier l'appli

L'appli est un artefact claude.ai : https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj

1. `npm run appli` assemble `dist/` et écrit `dist.fichiers.json`.
2. Republier avec l'outil `Artifact` en passant **cette URL** en `url` :
   - `file_path` : `dist/index.html` ;
   - `files` : le contenu de `dist.fichiers.json`, avec un `contentType`
     explicite pour `.mjs` (`text/javascript`), `.mp3` (`audio/mpeg`) et
     `.pdf` (`application/pdf`) ;
   - ne pas repasser `capabilities`, pour garder `db` et `downloads`.

   Sans l'URL, on crée une seconde appli vide, et Adrien perd sa bibliothèque.
3. La base de l'appli (`partitions/<id>`, `partitions/<id>/pages/<n>`) contient
   les vraies partitions d'Adrien : la lire avec `ArtifactData` si besoin, ne
   jamais y écrire sans qu'il l'ait demandé.

Avant de publier, tester la version autonome dans Chromium : servir `dist/`
après `npm run appli -- --autonome`, importer les pages d'essai, écouter,
exporter.
