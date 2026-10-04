/**
 * LE CONNECTEUR, CÔTÉ HTTP
 *
 * Deux sortes d'appelants :
 *   - claude.ai, depuis ses serveurs (connecteur « sans authentification ») :
 *     sans en-tête Origin, ou avec une origine de Claude ;
 *   - le site Portée sur GitHub Pages, directement depuis le navigateur. Il
 *     lui faut les en-têtes CORS, qu'on ne donne qu'aux origines connues.
 *
 * Dans les deux cas, c'est la clé au bout de l'adresse qui ouvre la porte :
 * sans elle, 404, comme si la fonction n'existait pas.
 *
 * En JavaScript standard (Request, Response, WebCrypto) : Deno sur
 * Supabase, Node dans les tests.
 */
import { traiter } from "./mcp.js";

// Le site est publié par GitHub Pages sous le domaine d'Adrien : adrienvada.github.io
// redirige vers adrienvada.fr, et c'est cette origine-là que le navigateur envoie.
export const ORIGINES = ["https://adrienvada.fr", "https://www.adrienvada.fr", "https://adrienvada.github.io"];

// Les origines de Claude. Ses appels partent de ses serveurs, d'ordinaire
// sans Origin ; s'il en met une, c'est l'une de celles-ci. Elles passent la
// garde, mais ne reçoivent pas d'en-têtes CORS : aucune page de claude.ai
// n'appelle le connecteur depuis le navigateur.
const ORIGINES_CLAUDE = [
  /^https:\/\/claude\.ai$/,
  /^https:\/\/([a-z0-9-]+\.)+claude\.ai$/,
  /^https:\/\/claude\.com$/,
  /^https:\/\/([a-z0-9-]+\.)+claude\.com$/,
  /^https:\/\/([a-z0-9-]+\.)+anthropic\.com$/,
];

// Une page dense pèse une soixantaine de kilo-octets : 6 Mo laissent passer
// une longue partition et son mémo, pas un envoi qui ferait tomber la fonction.
export const TAILLE_MAX = 6 * 1024 * 1024;

function entetesCors(req, origines) {
  const origine = req.headers.get("origin");
  if (!origine || !origines.includes(origine)) return {};
  return {
    "access-control-allow-origin": origine,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/** Sans Origin (un serveur), ou une origine connue : le site, ou Claude. */
export function origineAdmise(origine, origines = ORIGINES) {
  if (origine === null || origine === undefined) return true;
  return origines.includes(origine) || ORIGINES_CLAUDE.some((motif) => motif.test(origine));
}

/**
 * Compare la clé de l'adresse à la bonne sans laisser deviner, au temps de
 * réponse, combien de ses caractères sont justes : `!==` s'arrête au premier
 * écart. On compare les empreintes SHA-256, octet par octet et jusqu'au
 * bout : même la longueur de la clé ne transparaît pas.
 */
export async function memeCle(a, b) {
  const code = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((t) => crypto.subtle.digest("SHA-256", code.encode(String(t)))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let ecart = 0;
  for (let i = 0; i < u.length; i++) ecart |= u[i] ^ v[i];
  return ecart === 0;
}

/**
 * Le corps de la requête, lu sans jamais dépasser `max` octets : null s'il
 * est trop lourd. La longueur annoncée ne suffit pas (elle peut manquer, ou
 * mentir) : on compte en lisant.
 */
async function lireCorps(req, max) {
  const annoncee = Number(req.headers.get("content-length"));
  if (Number.isFinite(annoncee) && annoncee > max) return null;
  if (!req.body) return "";
  const lecteur = req.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lecteur.cancel().catch(() => {});
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) { tout.set(m, i); i += m.byteLength; }
  return new TextDecoder().decode(tout);
}

// Une erreur hors JSON-RPC (origine, taille) : le corps dit pourquoi, sans
// identifiant de requête (on ne l'a pas lue).
const erreurSansId = (code, message) => ({ jsonrpc: "2.0", error: { code, message } });

/**
 * @param {Request} req
 * @param {{ cle: string, cloud: () => object, bibliotheque?: () => object, origines?: string[] }} options
 *   `cloud` et `bibliotheque` ne sont appelés que quand il faut répondre
 *   (création paresseuse).
 */
export async function repondreHttp(req, { cle, cloud, bibliotheque = () => null, origines = ORIGINES }) {
  const cors = entetesCors(req, origines);
  // Le préflight du navigateur passe quelle que soit la clé (il ne dit rien) :
  // sinon, une clé fausse ressemblerait à un connecteur injoignable, et le
  // site ne pourrait pas dire « adresse incorrecte ».
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const donnee = segments[segments.length - 1] ?? "";
  if (!cle || cle.length < 24 || !(await memeCle(donnee, cle))) {
    return new Response("Introuvable", { status: 404, headers: cors });
  }
  // La spécification MCP l'exige : une page d'une autre origine (ou une
  // attaque par « DNS rebinding ») ne doit rien faire faire au connecteur,
  // même si le navigateur lui cache ensuite la réponse.
  if (!origineAdmise(req.headers.get("origin"), origines)) {
    return Response.json(erreurSansId(-32600, "Cette origine n'a pas accès au connecteur."), { status: 403 });
  }
  if (req.method !== "POST") {
    return new Response("Ce connecteur ne répond qu'en POST.", { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
  }
  const texte = await lireCorps(req, TAILLE_MAX);
  if (texte === null) {
    return Response.json(erreurSansId(-32600, `Requête trop lourde (plus de ${TAILLE_MAX / 1024 / 1024} Mo).`), { status: 413, headers: cors });
  }
  let message;
  try {
    message = JSON.parse(texte);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible" } }, { status: 400, headers: cors });
  }
  const reponse = await traiter(message, cloud(), bibliotheque());
  if (reponse === null) return new Response(null, { status: 202, headers: cors });
  return Response.json(reponse, { headers: cors });
}
