// ============================================================
//  CONNECTEUR « PORTÉE REMARKABLE » — fonction Supabase (Deno)
// ============================================================
//  Un connecteur que l'appli Portée appelle au clic, depuis claude.ai
//  ou directement depuis le site GitHub Pages (CORS, voir http.js) :
//  « arborescence » puis « document ». Il lit le cloud reMarkable
//  d'Adrien et n'y écrit jamais. « relier » sert une seule fois,
//  quand Adrien tape dans l'appli le code à 8 lettres de
//  my.remarkable.com : le jeton obtenu va dans un compartiment
//  privé du stockage Supabase (coffre.js). Les outils
//  « bibliotheque_* » tiennent la bibliothèque de partitions,
//  synchronisée entre les appareils (bibliotheque.js), dans ce même
//  compartiment.
//
//  SECRETS (posés par outils/deployer-connecteur.mjs) :
//    PORTEE_CLE     longue chaîne aléatoire, dernier segment de
//                   l'adresse du connecteur
//    PORTEE_COFFRE  la clé qui chiffre le jeton de la tablette dans le
//                   stockage (coffre.js) ; créée une fois, jamais changée
//  FACULTATIF :
//    PORTEE_HOTE_SYNC  l'hôte de synchro de reMarkable, s'il change
//                      d'adresse (https://…) ; sinon l'habituel, avec
//                      repli sur eu.tectonic.remarkable.com
//  SUPABASE_URL et la clé de service sont fournis d'office : la nouvelle
//  (SUPABASE_SECRET_KEYS) d'abord, l'ancienne (SUPABASE_SERVICE_ROLE_KEY)
//  à défaut (supabase.js).
//
//  POURQUOI UNE CLÉ DANS L'ADRESSE. claude.ai appelle le connecteur
//  sans identifiant (connecteur « sans authentification ») : c'est
//  l'adresse secrète qui protège l'accès. Sans la bonne clé, la
//  fonction répond 404, comme si elle n'existait pas.
//
//  Déployée sans vérification de JWT : claude.ai n'envoie pas la
//  clé anon de Supabase.
// ============================================================
import { Bibliotheque } from "./bibliotheque.js";
import { coffreSupabase } from "./coffre.js";
import { ORIGINES, repondreHttp } from "./http.js";
import { objetsSupabase } from "./objets.js";
import { CloudRemarkable, hoteDeSynchro } from "./remarkable.js";
import { cleDeService } from "./supabase.js";

const CLE = Deno.env.get("PORTEE_CLE") ?? "";
// Origines supplémentaires autorisées à appeler depuis un navigateur
// (séparées par des virgules), en plus du site GitHub Pages.
const EN_PLUS = (Deno.env.get("PORTEE_ORIGINES") ?? "").split(",").map((o) => o.trim()).filter(Boolean);

const URL_SUPABASE = Deno.env.get("SUPABASE_URL");
const CLE_SERVICE = cleDeService((nom: string) => Deno.env.get(nom));
// Une valeur qui n'a pas la forme d'une adresse https est ignorée.
const HOTE_SYNC = hoteDeSynchro(Deno.env.get("PORTEE_HOTE_SYNC")) ?? undefined;
const SECRET_COFFRE = Deno.env.get("PORTEE_COFFRE") || null;

// Une instance chaude garde le jeton utilisateur et les métadonnées déjà lues.
let cloud: CloudRemarkable | null = null;
let bibliotheque: Bibliotheque | null = null;

Deno.serve((req: Request) =>
  repondreHttp(req, {
    cle: CLE,
    origines: [...ORIGINES, ...EN_PLUS],
    cloud: () => (cloud ??= new CloudRemarkable(coffreSupabase(URL_SUPABASE, CLE_SERVICE, { secret: SECRET_COFFRE }), { sync: HOTE_SYNC })),
    bibliotheque: () => (bibliotheque ??= new Bibliotheque(objetsSupabase(URL_SUPABASE, CLE_SERVICE))),
  })
);
