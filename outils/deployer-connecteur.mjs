/**
 * DÉPLOYER LE CONNECTEUR « PORTÉE REMARKABLE » SUR SUPABASE
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run connecteur                → liste tes projets
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run connecteur -- <ref>       → déploie
 *   SUPABASE_ACCESS_TOKEN=sbp_… npm run connecteur -- <ref> --nouvelle-cle
 *
 * Le jeton d'accès se crée sur supabase.com/dashboard/account/tokens (et se
 * révoque au même endroit une fois le déploiement fait). Le script passe
 * par l'API de gestion de Supabase : ni Docker ni CLI à installer.
 *
 * Ce qu'il fait :
 *   1. pose les secrets de la fonction, avant le déploiement (elle les lit à
 *      son démarrage) :
 *      - PORTEE_CLE, la clé de l'adresse. Dans GitHub Actions, elle vient
 *        du secret GitHub PORTEE_CLE et n'est jamais affichée : le dépôt est
 *        public, ses journaux aussi. Sans ce secret, le connecteur est
 *        verrouillé par une clé tirée au hasard, que personne ne connaît.
 *        En local, au premier déploiement (ou avec --nouvelle-cle), il en
 *        tire une au hasard et affiche l'adresse du connecteur. Supabase ne
 *        rend jamais la valeur d'un secret : note l'adresse ;
 *      - PORTEE_COFFRE, la clé qui chiffre le jeton de la tablette dans le
 *        stockage (coffre.js). Créée au premier passage, jamais affichée ni
 *        écrite ailleurs, et **jamais remplacée** : un autre secret rendrait
 *        le jeton rangé illisible (il faudrait relier la tablette) ;
 *   2. envoie supabase/functions/portee-remarkable/ comme fonction
 *      « portee-remarkable », sans vérification de JWT (claude.ai n'envoie
 *      pas la clé anon) ;
 *   3. vérifie que la fonction répond au protocole MCP (les versions d'avant
 *      et 2026-07-28) et qu'elle lit son coffre (le stockage Supabase) :
 *      l'arborescence doit répondre, même « pas encore reliée ».
 *
 * Il tourne aussi dans GitHub Actions (.github/workflows/connecteur.yml).
 *
 * La tablette se relie ensuite depuis l'appli (code à 8 lettres) : son
 * jeton ne passe jamais par ici.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.supabase.com/v1";
const NOM = "portee-remarkable";
const DOSSIER = path.join(import.meta.dirname, "..", "supabase", "functions", NOM);

/**
 * Les secrets à poser, d'après les noms de ceux qui existent déjà (l'API
 * de gestion les liste sans leur valeur). Rien ici ne s'affiche.
 * @returns {{ aPoser: {name, value}[], cle: string|null, afficher: boolean, cleExistait: boolean, coffreNeuf: boolean }}
 */
export function planDesSecrets({ existants, cleFournie = "", enCI = false, nouvelleCle = false, tirer = (n) => crypto.randomBytes(n).toString("base64url") }) {
  const noms = new Set(existants);
  const aPoser = [];
  let cle = null;          // la clé posée par ce passage
  let afficher = false;    // l'adresse peut-elle s'afficher ? (jamais en CI)
  if (cleFournie) {
    if (cleFournie.length < 24) throw new Error("PORTEE_CLE doit faire au moins 24 caractères.");
    cle = cleFournie;
  } else if (enCI) {
    cle = tirer(24);
  } else if (!noms.has("PORTEE_CLE") || nouvelleCle) {
    cle = tirer(24);
    afficher = true;
  }
  if (cle) aPoser.push({ name: "PORTEE_CLE", value: cle });
  const coffreNeuf = !noms.has("PORTEE_COFFRE");
  if (coffreNeuf) aPoser.push({ name: "PORTEE_COFFRE", value: tirer(32) });
  return { aPoser, cle, afficher, cleExistait: noms.has("PORTEE_CLE"), coffreNeuf };
}

async function principal() {
  const jeton = process.env.SUPABASE_ACCESS_TOKEN;
  const [ref] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const nouvelleCle = process.argv.includes("--nouvelle-cle");
  const enCI = !!process.env.GITHUB_ACTIONS;
  const cleFournie = process.env.PORTEE_CLE || "";

  async function api(chemin, options = {}) {
    const r = await fetch(`${API}${chemin}`, { ...options, headers: { authorization: `Bearer ${jeton}`, ...options.headers } });
    const texte = await r.text();
    if (!r.ok) throw new Error(`API Supabase ${options.method || "GET"} ${chemin} → HTTP ${r.status} ${texte.slice(0, 300)}`);
    return texte ? JSON.parse(texte) : null;
  }

  if (!jeton) {
    console.error("Il faut SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens).");
    process.exit(1);
  }

  if (!ref) {
    const projets = await api("/projects");
    console.log("Tes projets Supabase (relance avec la référence de celui qui accueillera le connecteur) :");
    for (const p of projets) console.log(`  ${p.id}  ${p.name}  (${p.region}, ${p.status})`);
    process.exit(0);
  }

  // 1. Les secrets, posés avant le déploiement : la fonction les lit à son démarrage.
  const existants = (await api(`/projects/${ref}/secrets`)).map((s) => s.name);
  const plan = planDesSecrets({ existants, cleFournie, enCI, nouvelleCle });
  if (plan.aPoser.length) {
    await api(`/projects/${ref}/secrets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan.aPoser),
    });
  }
  if (plan.cle && enCI && !cleFournie) {
    console.log("::warning::Pas de secret GitHub PORTEE_CLE : connecteur verrouillé (clé inconnue de tous). Voir docs/PROPOSITIONS.md, « Brancher la reMarkable ».");
  }
  if (plan.cle) console.log(plan.cleExistait ? "Clé posée (elle remplace la précédente)." : "Clé posée.");
  else console.log("La clé existait déjà : l'adresse du connecteur ne change pas (--nouvelle-cle pour en changer).");
  if (plan.coffreNeuf) console.log("Clé du coffre posée (PORTEE_COFFRE) : le jeton de la tablette sera rangé chiffré.");

  // Si la première mise en place échoue, on retire la clé toute neuve : le
  // prochain essai en tirera une autre et affichera l'adresse, au lieu de
  // croire le connecteur déjà en place. La clé du coffre, elle, reste.
  try {
    // 2. Déploiement : les fichiers du dossier, index.ts en point d'entrée.
    const fichiers = fs.readdirSync(DOSSIER).filter((f) => /\.(ts|js)$/.test(f));
    const formulaire = new FormData();
    formulaire.append("metadata", JSON.stringify({ name: NOM, entrypoint_path: "index.ts", verify_jwt: false }));
    for (const f of fichiers) {
      formulaire.append("file", new Blob([fs.readFileSync(path.join(DOSSIER, f))], { type: f.endsWith(".ts") ? "application/typescript" : "application/javascript" }), f);
    }
    const fonction = await api(`/projects/${ref}/functions/deploy?slug=${NOM}`, { method: "POST", body: formulaire });
    console.log(`Fonction « ${fonction.slug} » déployée (version ${fonction.version}, JWT ${fonction.verify_jwt ? "vérifié : ANORMAL" : "non vérifié"}).`);

    // 3. Vérification : la fonction doit répondre au protocole MCP.
    if (plan.cle) {
      const adresse = `https://${ref}.supabase.co/functions/v1/${NOM}/${plan.cle}`;
      const appeler = (corps, entetes = {}) => fetch(adresse, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...entetes },
        body: JSON.stringify(corps),
      });
      let reponse = null;
      for (let essai = 0; essai < 10 && !reponse; essai++) {
        await new Promise((r) => setTimeout(r, essai ? 3000 : 1000)); // le secret met quelques secondes à arriver
        const r = await appeler({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "deployer-connecteur", version: "1" } } });
        if (r.ok) reponse = await r.json();
        else await r.body?.cancel();
      }
      if (!reponse || !reponse.result) throw new Error("La fonction ne répond pas au protocole MCP : regarde ses journaux dans le tableau de bord Supabase.");
      console.log(`Le connecteur répond (${reponse.result.serverInfo.name}, ${reponse.result.protocolVersion}).`);

      // La version 2026-07-28 : sans initialize, la version dans chaque requête.
      const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "deployer-connecteur", version: "1" } };
      const d = await appeler({ jsonrpc: "2.0", id: 2, method: "server/discover", params: { _meta: meta } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" });
      const decouverte = d.ok ? (await d.json()).result : (await d.body?.cancel(), null);
      if (!decouverte || !decouverte.supportedVersions.includes("2026-07-28")) throw new Error(`Le connecteur ne répond pas en 2026-07-28 (HTTP ${d.status}).`);
      console.log(`Versions servies : ${decouverte.supportedVersions.join(", ")}.`);

      // Le coffre : sans accès au stockage Supabase, la tablette ne pourrait pas être reliée.
      const r = await appeler({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "arborescence", arguments: {} } });
      const arbre = (await r.json()).result;
      if (!arbre || arbre.isError) throw new Error(`Le connecteur ne lit pas son coffre : ${arbre ? arbre.content[0].text : "pas de réponse"}`);
      console.log(arbre.structuredContent.connectee ? "La tablette est déjà reliée." : "Coffre lisible ; la tablette reste à relier depuis l'appli.");

      if (plan.afficher) {
        console.log("\nAdresse du connecteur, à coller dans claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé :");
        console.log(`  nom : Portée reMarkable`);
        console.log(`  URL : ${adresse}`);
      }
    }
  } catch (e) {
    if (plan.afficher && !plan.cleExistait) {
      await api(`/projects/${ref}/secrets`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(["PORTEE_CLE"]) });
      console.error("Clé retirée : relance le déploiement une fois le problème réglé.");
    }
    throw e;
  }
}

// Lancé comme script (npm run connecteur) ; importé, il ne fait rien (tests).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await principal();
