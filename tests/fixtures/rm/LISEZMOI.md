# Pages .rm de référence

Deux fichiers de test du projet [rmscene](https://github.com/ricklupton/rmscene)
(licence MIT, voir `LICENCE-rmscene.txt`), copiés tels quels :

- `Color_and_tool_v3.14.4.rm` : couleurs et outils variés, logiciel 3.14 ;
- `Lines_v2.rm` : points au format v2 (14 octets par point).

`tests/connecteur.test.mjs` vérifie que `supabase/functions/portee-remarkable/rm.js`
en tire les mêmes traits que rmscene (nombre de lignes, de points, coordonnées).
