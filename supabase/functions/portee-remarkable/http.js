/**
 * LE CONNECTEUR, CÔTÉ HTTP
 *
 * Deux sortes d'appelants :
 *   - claude.ai, depuis ses serveurs (connecteur « sans authentification ») ;
 *   - le site Portée sur GitHub Pages, directement depuis le navigateur. Il
 *     lui faut les en-têtes CORS, qu'on ne donne qu'aux origines connues.
 *
 * Dans les deux cas, c'est la clé au bout de l'adresse qui ouvre la porte :
 * sans elle, 404, comme si la fonction n'existait pas.
 *
 * En JavaScript standard (Request, Response) : Deno sur Supabase, Node
 * dans les tests.
 */
import { traiter } from "./mcp.js";

export const ORIGINES = ["https://adrienvada.github.io"];

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
  if (!cle || cle.length < 24 || segments[segments.length - 1] !== cle) {
    return new Response("Introuvable", { status: 404, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Ce connecteur ne répond qu'en POST.", { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
  }
  let message;
  try {
    message = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible" } }, { status: 400, headers: cors });
  }
  const reponse = await traiter(message, cloud(), bibliotheque());
  if (reponse === null) return new Response(null, { status: 202, headers: cors });
  return Response.json(reponse, { headers: cors });
}
