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
 *   1. au premier déploiement (ou avec --nouvelle-cle), tire une clé au
 *      hasard, la range dans le secret PORTEE_CLE et, à la fin, affiche
 *      l'adresse du connecteur à coller dans claude.ai. Supabase ne rend
 *      jamais la valeur d'un secret : note l'adresse, ou redemande une clé ;
 *   2. envoie supabase/functions/portee-remarkable/ comme fonction
 *      « portee-remarkable », sans vérification de JWT (claude.ai n'envoie
 *      pas la clé anon) ;
 *   3. vérifie que la fonction répond au protocole MCP et qu'elle lit son
 *      coffre (le stockage Supabase) : l'arborescence doit répondre, même
 *      « pas encore reliée ».
 *
 * Il tourne aussi dans GitHub Actions (.github/workflows/connecteur.yml) :
 * l'adresse va alors dans le résumé du déploiement.
 *
 * La tablette se relie ensuite depuis l'appli (code à 8 lettres) : son
 * jeton ne passe jamais par ici.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.supabase.com/v1";
const NOM = "portee-remarkable";
const DOSSIER = path.join(import.meta.dirname, "..", "supabase", "functions", NOM);

const jeton = process.env.SUPABASE_ACCESS_TOKEN;
const [ref] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const nouvelleCle = process.argv.includes("--nouvelle-cle");

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

// 1. La clé de l'adresse, posée avant le déploiement : la fonction la lit
//    à son démarrage.
const secrets = await api(`/projects/${ref}/secrets`);
const existe = secrets.some((s) => s.name === "PORTEE_CLE");
let cle = null;
if (!existe || nouvelleCle) {
  cle = crypto.randomBytes(24).toString("base64url");
  await api(`/projects/${ref}/secrets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ name: "PORTEE_CLE", value: cle }]),
  });
  console.log(existe ? "Nouvelle clé posée : l'ancienne adresse ne répond plus." : "Clé posée.");
} else {
  console.log("La clé existait déjà : l'adresse du connecteur ne change pas (--nouvelle-cle pour en changer).");
}

// Si la première mise en place échoue, on retire la clé toute neuve : le
// prochain essai en tirera une autre et affichera l'adresse, au lieu de
// croire le connecteur déjà en place.
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
  if (cle) {
    const adresse = `https://${ref}.supabase.co/functions/v1/${NOM}/${cle}`;
    let reponse = null;
    for (let essai = 0; essai < 10 && !reponse; essai++) {
      await new Promise((r) => setTimeout(r, essai ? 3000 : 1000)); // le secret met quelques secondes à arriver
      const r = await fetch(adresse, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "deployer-connecteur", version: "1" } } }),
      });
      if (r.ok) reponse = await r.json();
      else await r.body?.cancel();
    }
    if (!reponse || !reponse.result) throw new Error("La fonction ne répond pas au protocole MCP : regarde ses journaux dans le tableau de bord Supabase.");
    console.log(`Le connecteur répond (${reponse.result.serverInfo.name}).`);

    // Le coffre : sans accès au stockage Supabase, la tablette ne pourrait pas être reliée.
    const r = await fetch(adresse, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "arborescence", arguments: {} } }),
    });
    const arbre = (await r.json()).result;
    if (!arbre || arbre.isError) throw new Error(`Le connecteur ne lit pas son coffre : ${arbre ? arbre.content[0].text : "pas de réponse"}`);
    console.log(arbre.structuredContent.connectee ? "La tablette est déjà reliée." : "Coffre lisible ; la tablette reste à relier depuis l'appli.");

    console.log("\nAdresse du connecteur, à coller dans claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé :");
    console.log(`  nom : Portée reMarkable`);
    console.log(`  URL : ${adresse}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        "## Connecteur « Portée reMarkable » déployé",
        "",
        "À ajouter dans claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé :",
        "",
        "- **Nom** : `Portée reMarkable`",
        `- **URL** : \`${adresse}\``,
        "",
      ].join("\n"));
    }
  }
} catch (e) {
  if (cle && !existe) {
    await api(`/projects/${ref}/secrets`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(["PORTEE_CLE"]) });
    console.error("Clé retirée : relance le déploiement une fois le problème réglé.");
  }
  throw e;
}
