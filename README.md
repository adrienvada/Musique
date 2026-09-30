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
3. **Importe** la page dans Portée : « Parcourir ma reMarkable », puis
   « Importer » à côté du document. À défaut, exporte-la en PDF (sur la
   tablette *Partager → PDF*) et dépose le fichier.
4. **Relis** : le lecteur transcrit la page, l'atelier te la montre à côté de
   ce qu'il a lu, avec les points à vérifier surlignés. Tu corriges le texte
   ABC si besoin.
5. **Écoute** au piano, change le tempo, transpose. Exporte l'ABC ou le MIDI
   (pour Ableton ou MuseScore).

« Parcourir ma reMarkable » passe par un connecteur claude.ai personnel, à
brancher une fois : voir [docs/PROPOSITIONS.md](docs/PROPOSITIONS.md),
section « Brancher la reMarkable ».

## Le dépôt

| Dossier | Contenu |
|---|---|
| `lecteur/` | Le lecteur de traits (JavaScript, sans dépendance) : PDF → traits → notes → ABC |
| `app/` | L'appli : bibliothèque, atelier, lecteur, piano échantillonné |
| `supabase/functions/portee-remarkable/` | Le connecteur « Portée reMarkable » : lit le cloud reMarkable au clic (fonction Supabase) |
| `modeles/` | Les modèles de papier calibré (PDF, calibration JSON, aperçus) |
| `outils/` | Générateur de modèles (Python), lecture en ligne de commande, assemblage de l'appli, déploiement du connecteur |
| `tests/` | Les pages d'essai d'Adrien et les tests qui figent leur lecture |
| `docs/PROPOSITIONS.md` | Le plan, les décisions, l'état de chaque étape, les pièges connus |

```bash
npm ci                      # pdf.js et abcjs, versions figées
npm test                    # le lecteur relit les pages d'essai
npm run lire -- page.pdf --svg   # lit une page, image de contrôle en prime
npm run appli               # assemble l'appli dans dist/ (pour claude.ai)
npm run appli -- --autonome # idem, page complète pour un hébergement ordinaire
SUPABASE_ACCESS_TOKEN=… npm run connecteur -- <ref>   # déploie le connecteur
```

Plan illustré des choix de départ : https://claude.ai/artifact/99p6MDcPHbxYz8z1yvEfAn
