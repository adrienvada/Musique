// ============================================================
//  CONNECTEUR « PORTÉE REMARKABLE » — fonction Supabase (Deno)
// ============================================================
//  Un connecteur claude.ai que l'appli Portée appelle au clic :
//  « arborescence » puis « document ». Il lit le cloud reMarkable
//  d'Adrien et n'y écrit jamais. « relier » sert une seule fois,
//  quand Adrien tape dans l'appli le code à 8 lettres de
//  my.remarkable.com : le jeton obtenu va dans un compartiment
//  privé du stockage Supabase (coffre.js).
//
//  SECRET (posé par outils/deployer-connecteur.mjs) :
//    PORTEE_CLE  longue chaîne aléatoire, dernier segment de
//                l'adresse du connecteur
//  SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis d'office.
//
//  POURQUOI UNE CLÉ DANS L'ADRESSE. claude.ai appelle le connecteur
//  sans identifiant (connecteur « sans authentification ») : c'est
//  l'adresse secrète qui protège l'accès. Sans la bonne clé, la
//  fonction répond 404, comme si elle n'existait pas.
//
//  Déployée sans vérification de JWT : claude.ai n'envoie pas la
//  clé anon de Supabase.
// ============================================================
import { coffreSupabase } from "./coffre.js";
import { traiter } from "./mcp.js";
import { CloudRemarkable } from "./remarkable.js";

const CLE = Deno.env.get("PORTEE_CLE") ?? "";

// Une instance chaude garde le jeton utilisateur et les métadonnées déjà lues.
let cloud: CloudRemarkable | null = null;

Deno.serve(async (req: Request) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  if (CLE.length < 24 || segments[segments.length - 1] !== CLE) {
    return new Response("Introuvable", { status: 404 });
  }
  if (req.method !== "POST") {
    return new Response("Ce connecteur ne répond qu'en POST.", { status: 405, headers: { allow: "POST" } });
  }
  let message: unknown;
  try {
    message = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible" } }, { status: 400 });
  }
  cloud ??= new CloudRemarkable(coffreSupabase(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")));
  const reponse = await traiter(message, cloud);
  if (reponse === null) return new Response(null, { status: 202 });
  return Response.json(reponse);
});
