# Portée

Des partitions écrites à la main sur la reMarkable, lues, corrigées et
jouées au piano. Gratuitement.

**L'appli : https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj** (privée,
ouverte depuis ton compte claude.ai, sur l'ordinateur comme sur le téléphone).

## S'en servir

1. **Une fois** : importe les modèles de [modeles/](modeles/README.md) sur la
   tablette (appli reMarkable de l'ordinateur ou my.remarkable.com).
2. **Pour chaque pièce** : duplique un modèle, renomme la copie avec le titre
   de la pièce, écris.
3. **Exporte** la page en PDF : sur la tablette *Partager → PDF*, ou depuis
   l'appli reMarkable de l'ordinateur.
4. **Dépose** le PDF dans Portée. Le lecteur transcrit la page. L'atelier te
   montre ta page à côté de ce qu'il a lu, avec les points à vérifier
   surlignés. Tu corriges le texte ABC si besoin.
5. **Écoute** au piano, change le tempo, transpose. Exporte l'ABC ou le MIDI
   (pour Ableton ou MuseScore).

La récupération automatique depuis le cloud reMarkable n'est pas encore
branchée : voir [docs/PROPOSITIONS.md](docs/PROPOSITIONS.md), section « Suite ».

## Le dépôt

| Dossier | Contenu |
|---|---|
| `lecteur/` | Le lecteur de traits (JavaScript, sans dépendance) : PDF → traits → notes → ABC |
| `app/` | L'appli : bibliothèque, atelier, lecteur, piano échantillonné |
| `modeles/` | Les modèles de papier calibré (PDF, calibration JSON, aperçus) |
| `outils/` | Générateur de modèles (Python), lecture en ligne de commande, assemblage de l'appli |
| `tests/` | Les pages d'essai d'Adrien et les tests qui figent leur lecture |
| `docs/PROPOSITIONS.md` | Le plan, les décisions, l'état de chaque étape, les pièges connus |

```bash
npm ci                      # pdf.js et abcjs, versions figées
npm test                    # le lecteur relit les pages d'essai
npm run lire -- page.pdf --svg   # lit une page, image de contrôle en prime
npm run appli               # assemble l'appli dans dist/ (pour claude.ai)
npm run appli -- --autonome # idem, page complète pour un hébergement ordinaire
```

Plan illustré des choix de départ : https://claude.ai/artifact/99p6MDcPHbxYz8z1yvEfAn
