/**
 * LINT (npm run lint)
 *
 * Les règles recommandées d'ESLint, plus deux avertissements que l'audit du
 * 04/10 a trouvés utiles (T2) :
 *  - require-atomic-updates : une variable lue avant un `await` et écrite
 *    après peut avoir changé entre-temps (ce que l'audit a vu dans app.js :
 *    une correction écrite sur une autre partition après un changement
 *    rapide) ;
 *  - no-throw-literal : ce qui est lancé devrait être une Error (avec sa pile).
 * En avertissement, pas en erreur : ils signalent un endroit à relire, pas
 * forcément un bogue.
 *
 * Chaque dossier a les globales de l'endroit où il tourne : le navigateur
 * (app/), le service worker (app/sw.js), le navigateur et Node à la fois
 * (lecteur/, et le connecteur, que Deno et Node lisent tous deux : ni l'un
 * ni l'autre n'y est permis seul), Node (outils, tests). Le seul fichier
 * propre à Deno, index.ts, est vérifié par `deno check`.
 */
import js from "@eslint/js";
import globals from "globals";

// `const { id: _ancien, ...reste } = p` retire un champ : la variable écartée
// n'est pas un oubli ; un paramètre en `_x` non plus (il tient sa place).
const inutilisees = { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true, caughtErrors: "none" };

export default [
  { ignores: ["dist/**", "node_modules/**", "modeles/**", "**/*.ts"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-unused-vars": ["error", inutilisees],
      "require-atomic-updates": "warn",
      "no-throw-literal": "warn",
    },
  },
  // En attendant le lot du lecteur (L19, le code mort) : `cal` ne sert plus
  // dans assembler() (lecteur/lecteur.js:548). À retirer avec lui.
  { files: ["lecteur/lecteur.js"], rules: { "no-unused-vars": ["warn", inutilisees] } },
  { files: ["app/**/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["app/sw.js"], languageOptions: { sourceType: "script", globals: globals.serviceworker } },
  { files: ["lecteur/**/*.js", "supabase/functions/**/*.js"], languageOptions: { globals: globals["shared-node-browser"] } },
  { files: ["outils/**/*.{js,mjs}", "tests/**/*.mjs", "*.js"], languageOptions: { globals: globals.node } },
  // Les essais de bout en bout passent des fonctions à la page (page.evaluate) : elles y voient le navigateur.
  { files: ["tests/e2e/**/*.mjs"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
