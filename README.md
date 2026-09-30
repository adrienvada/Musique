# Portée

Des partitions écrites à la main sur la reMarkable, lues, corrigées et
jouées au piano. Gratuitement.

**L'appli : https://adrienvada.github.io/Musique/**, sur l'ordinateur comme
sur le téléphone. Elle s'installe comme une appli (bouton « Installer
l'appli » du navigateur) et marche hors ligne. Une version privée existe aussi
sur claude.ai : https://claude.ai/artifact/NwXEpHs69MYngQMiiay1rj (bibliothèque
enregistrée sur ton compte claude.ai).

## S'en servir

1. **Une fois** : « Modèles pour la tablette » → télécharge un modèle et mets-le
   sur ta reMarkable (my.remarkable.com ou l'appli de l'ordinateur).
2. **Pour chaque pièce** : duplique le modèle, renomme la copie avec le titre,
   écris.
3. **Importe** la page : « Importer de ma reMarkable », puis « Importer » à
   côté du document. À défaut, dépose son PDF (sur la tablette *Partager → PDF*).
4. **Corrige en touchant les notes** : touche une note de la partition (ou
   glisse-la), puis plus haut, plus bas, noire, croche, ♯, silence… Les points
   douteux sont surlignés sur ta page. Rien à écrire, tout s'annule.
5. **Écoute et exporte** : piano, tempo, transposition, puis « Télécharger le
   MIDI » (une piste par main, prête pour Ableton, MuseScore ou GarageBand).
   Aussi : imprimer ou PDF, tout exporter en MIDI d'un coup.

Sur le site, ta bibliothèque reste dans le navigateur : « Sauvegarder ma
bibliothèque » en fait un fichier, que « Restaurer une sauvegarde » remet
ailleurs. Le bouton reMarkable passe par un connecteur personnel, à brancher
une fois : voir [docs/PROPOSITIONS.md](docs/PROPOSITIONS.md), « Brancher la
reMarkable ».

## Le dépôt

| Dossier | Contenu |
|---|---|
| `lecteur/` | Le lecteur de traits (JavaScript, sans dépendance) : PDF → traits → notes → ABC |
| `app/` | L'appli : bibliothèque, correction au toucher (`edition.js`), écoute et exports, piano échantillonné, site installable |
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
npm run appli -- --autonome # le site GitHub Pages (publié par .github/workflows/site.yml)
SUPABASE_ACCESS_TOKEN=… npm run connecteur -- <ref>   # déploie le connecteur
```

Plan illustré des choix de départ : https://claude.ai/artifact/99p6MDcPHbxYz8z1yvEfAn
