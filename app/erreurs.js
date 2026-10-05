/**
 * LES ERREURS, DITES EN FRANÇAIS (audit du 04/10, I13)
 *
 * Le navigateur, pdf.js et le stockage disent leurs erreurs en anglais et
 * dans leur jargon : « Failed to fetch », « Invalid PDF structure »,
 * « Failed to fetch dynamically imported module… », « QuotaExceededError ».
 * Elles s'affichaient telles quelles. Toute erreur montrée à Adrien passe
 * par ici : ce qui s'est passé, puis quoi faire. Le détail technique reste
 * dans la console (console.error, là où l'erreur est attrapée).
 *
 * Les messages que Portée écrit elle-même (le stockage, le connecteur, le
 * piano) sont déjà en français : ils passent tels quels.
 *
 * Sans DOM : vérifié par `npm run types`, essayé sous Node
 * (tests/erreurs.test.mjs).
 */

/** Pour chaque genre d'erreur : ce qui s'est passé (court, sans majuscule), puis quoi faire. */
const GENRES = {
  reseau: ["pas de connexion", "Réessaie quand le réseau sera revenu."],
  module: ["une partie de Portée n'a pas pu se charger (connexion ?)", "Réessaie quand le réseau sera revenu, ou recharge la page."],
  pdf: ["ce fichier n'est pas un PDF lisible", "Exporte la page à nouveau depuis la tablette (Partager, puis PDF)."],
  "pdf-protege": ["ce PDF est protégé par un mot de passe", "Exporte-le à nouveau, sans mot de passe."],
  plein: ["la mémoire de ce navigateur est pleine", "Sauvegarde ta bibliothèque (Réglages), puis supprime ce qui ne sert plus."],
  connecteur: ["le connecteur ne répond pas", "Réessaie dans un moment : s'il se tait encore, le projet Supabase s'est peut-être endormi (tableau de bord Supabase, relancer le projet)."],
  inconnue: ["une erreur inattendue (le détail est dans la console)", "Réessaie ; si ça recommence, recharge la page."],
};

/** Un texte écrit en français (par Portée) plutôt qu'en anglais (par le navigateur ou une bibliothèque). */
const enFrancais = (t) => /[àâçéèêëîïôûùœ«»’]/i.test(t) || /\b(le|la|les|une?|des|du|pas|est|sont|ne|ce|cette)\b/i.test(t);

/**
 * Le genre d'une erreur, d'après son nom, son code ou son message.
 * @param {any} err
 * @returns {"reseau" | "module" | "pdf" | "pdf-protege" | "plein" | "connecteur" | "francais" | "inconnue"}
 */
export function genreErreur(err) {
  if (!err) return "inconnue";
  const nom = String(err.name || ""), message = String(err.message || (typeof err === "string" ? err : ""));
  const code = err.code;
  if (nom === "PasswordException") return "pdf-protege";
  if (/^(InvalidPDFException|FormatError|UnknownErrorException)$/.test(nom) || /Invalid PDF|PDF header|XRef/i.test(message)) return "pdf";
  if (nom === "QuotaExceededError" || /quota|stockage plein/i.test(message)) return "plein";
  if (/dynamically imported module|Importing a module script failed|module script/i.test(message)) return "module";
  if (code === "server_unavailable" || code === "upstream_error") return "connecteur";
  if (/^(TypeError|NetworkError)$/.test(nom) && /fetch|network|Load failed|connexion|hors ligne/i.test(message)) return "reseau";
  if (message && enFrancais(message)) return "francais";
  return "inconnue";
}

/** Le message de Portée, ou le genre reconnu. */
const lire = (err) => {
  const g = genreErreur(err);
  return g === "francais" ? { message: String(err.message || err) } : { genre: GENRES[g], inconnue: g === "inconnue" };
};

/**
 * Ce qui s'est passé, au plus court, pour une ligne d'état
 * (« Non enregistré : pas de connexion »).
 * @param {any} err
 */
export function cause(err) {
  const l = lire(err);
  return l.message ?? l.genre[0];
}

/**
 * Ce qui s'est passé et quoi faire, pour suivre « … : » (sans majuscule
 * d'office). Un message déjà en français passe tel quel.
 * @param {any} err
 * @param {string} [secours]  ce qu'on dit d'une erreur inconnue, à la place du texte général
 */
export function explication(err, secours = "") {
  const l = lire(err);
  if (l.message !== undefined) return l.message;
  if (l.inconnue && secours) return secours;
  return `${l.genre[0]}. ${l.genre[1]}`;
}

/** La même chose, en phrase qui commence (un message à elle seule). */
export function expliquer(err, secours = "") {
  const t = explication(err, secours);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * « L'export MIDI n'a pas abouti : pas de connexion. Réessaie… »
 * @param {string} quoi  ce qui n'a pas abouti, avec son article (« L'export MIDI »)
 * @param {any} err
 */
export const echec = (quoi, err) => `${quoi} n'a pas abouti : ${explication(err)}`;

/**
 * Le filet : une erreur qu'aucun geste n'a attrapée (une promesse rejetée
 * sans `catch`) se dit dans un message passager, en français, et son détail
 * reste dans la console. Avant, elle passait sans un mot (audit du 04/10,
 * T4) : supprimer, dupliquer ou ouvrir un morceau pouvait échouer en
 * silence.
 * @param {(texte: string) => void} montrer
 */
export function installerFilet(montrer) {
  globalThis.addEventListener("unhandledrejection", (ev) => {
    // On la dit nous-mêmes, une fois (sans quoi le navigateur la répète en anglais).
    ev.preventDefault();
    console.error("Erreur que rien n'a attrapée :", ev.reason);
    montrer(expliquer(ev.reason));
  });
}

/**
 * Une erreur de Portée, avec un code que l'appli lit (`adresse_invalide`…)
 * et sa cause d'origine (sa pile, pour la console). Remplace les objets
 * bruts qu'on lançait (`throw { code, message }`), sans pile (T4).
 * @param {string} code
 * @param {string} message
 * @param {{ cause?: any, [cle: string]: any }} [plus]
 */
export function erreur(code, message, { cause: origine, ...plus } = {}) {
  const e = /** @type {Error & { code: string }} */ (new Error(message, origine === undefined ? undefined : { cause: origine }));
  return Object.assign(e, plus, { code });
}
