// ============================================================
//  CONNECTEUR « PORTÉE REMARKABLE » — fonction Supabase (Deno)
// ============================================================
//  Un connecteur que l'appli Portée appelle au clic, depuis claude.ai
//  ou directement depuis le site GitHub Pages (CORS, voir http.js) :
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
import { ORIGINES, repondreHttp } from "./http.js";
import { CloudRemarkable } from "./remarkable.js";

const CLE = Deno.env.get("PORTEE_CLE") ?? "";
// Origines supplémentaires autorisées à appeler depuis un navigateur
// (séparées par des virgules), en plus du site GitHub Pages.
const EN_PLUS = (Deno.env.get("PORTEE_ORIGINES") ?? "").split(",").map((o) => o.trim()).filter(Boolean);

// Une instance chaude garde le jeton utilisateur et les métadonnées déjà lues.
let cloud: CloudRemarkable | null = null;

Deno.serve((req: Request) =>
  repondreHttp(req, {
    cle: CLE,
    origines: [...ORIGINES, ...EN_PLUS],
    cloud: () => (cloud ??= new CloudRemarkable(coffreSupabase(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")))),
  })
);
