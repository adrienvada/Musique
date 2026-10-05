/**
 * Les clés du connecteur : la clé de service du projet Supabase (nouvelle
 * ou ancienne, C1), et le jeton de la tablette chiffré dans le coffre (S5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cleDeService, entetesSupabase, estJwt } from "../supabase/functions/portee-remarkable/supabase.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { chiffrer, coffreSupabase, dechiffrer, estChiffre, JetonIlisible } from "../supabase/functions/portee-remarkable/coffre.js";
import { CloudRemarkable } from "../supabase/functions/portee-remarkable/remarkable.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { planDesSecrets } from "../outils/deployer-connecteur.mjs";
import { demarrerFauxCloud, demarrerFauxStockage } from "./faux-cloud.mjs";

// Des clés de la forme des vraies, inventées pour les tests.
// Assemblées à l'exécution : écrites d'un seul tenant, elles ont la forme
// exacte d'une vraie clé, et la protection contre les fuites de GitHub
// refuse le dépôt (ou lève une alerte pour rien).
const SECRETE = ["sb", "secret", "cle", "inventee", "pour", "les", "tests"].join("_");
const b64url = (objet) => Buffer.from(JSON.stringify(objet)).toString("base64url");
/** Un faux JWT : en-tête et contenu encodés ici, signature inventée. */
const fauxJwt = (contenu, signature) => [b64url({ alg: "HS256", typ: "JWT" }), b64url(contenu), signature].join(".");
const ANCIENNE = fauxJwt({ role: "service_role", iss: "supabase" }, Buffer.from("signature-de-test").toString("base64url"));

const env = (valeurs) => (nom) => valeurs[nom];

test("la nouvelle clé (SUPABASE_SECRET_KEYS) d'abord, l'ancienne à défaut", () => {
  assert.equal(cleDeService(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRETE }), SUPABASE_SERVICE_ROLE_KEY: ANCIENNE })), SECRETE);
  // Une seule clé, renommée : on la prend quand même.
  assert.equal(cleDeService(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ portee: SECRETE }) })), SECRETE);
  // Dictionnaire illisible ou vide : l'ancienne clé fait l'affaire.
  assert.equal(cleDeService(env({ SUPABASE_SECRET_KEYS: "{pas du json", SUPABASE_SERVICE_ROLE_KEY: ANCIENNE })), ANCIENNE);
  assert.equal(cleDeService(env({ SUPABASE_SECRET_KEYS: "{}", SUPABASE_SERVICE_ROLE_KEY: ANCIENNE })), ANCIENNE);
  // Projet d'avant la migration : seulement l'ancienne.
  assert.equal(cleDeService(env({ SUPABASE_SERVICE_ROLE_KEY: ANCIENNE })), ANCIENNE);
  assert.equal(cleDeService(env({})), null);
});

test("une clé secrète voyage en apikey seulement, l'ancienne (un JWT) aussi en Bearer", () => {
  assert.equal(estJwt(SECRETE), false);
  assert.equal(estJwt(ANCIENNE), true);
  assert.deepEqual(entetesSupabase(SECRETE), { apikey: SECRETE });
  assert.deepEqual(entetesSupabase(ANCIENNE), { apikey: ANCIENNE, authorization: `Bearer ${ANCIENNE}` });
});

for (const [forme, cle] of [["nouvelle clé secrète", SECRETE], ["ancienne clé JWT", ANCIENNE]]) {
  test(`stockage et coffre marchent avec une ${forme}`, async () => {
    const stockage = await demarrerFauxStockage(cle);
    try {
      const objets = objetsSupabase(stockage.url, cle);
      await objets.ecrire("bibliotheque/essai.json", { titre: "Essai" });
      assert.deepEqual(await objets.lire("bibliotheque/essai.json"), { titre: "Essai" });
      assert.deepEqual((await objets.lister("bibliotheque")).map((o) => o.nom), ["essai.json"]);
      await objets.supprimer("bibliotheque/essai.json");
      assert.equal(await objets.lire("bibliotheque/essai.json"), null);
      const coffre = coffreSupabase(stockage.url, cle);
      assert.equal(await coffre.lire(), null);
      await coffre.ecrire("jeton-appareil-de-test");
      assert.equal(await coffre.lire(), "jeton-appareil-de-test");
    } finally {
      await stockage.fermer();
    }
  });
}

test("le faux stockage refuse une clé secrète en Bearer, comme la plateforme", async () => {
  // Sans cette garde, un retour au Bearer pour tout le monde passerait les tests.
  const stockage = await demarrerFauxStockage(SECRETE);
  try {
    const r = await fetch(`${stockage.url}/storage/v1/object/list/portee-remarkable`, {
      method: "POST",
      headers: { apikey: SECRETE, authorization: `Bearer ${SECRETE}`, "content-type": "application/json" },
      body: JSON.stringify({ prefix: "" }),
    });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { message: "Invalid JWT" });
  } finally {
    await stockage.fermer();
  }
});

test("sans clé de service, un message qui dit laquelle manque", () => {
  assert.throws(() => objetsSupabase("https://x.supabase.co", null), /SUPABASE_SECRET_KEYS/);
  assert.throws(() => coffreSupabase(undefined, SECRETE), /SUPABASE_URL/);
});

// --- S5 : le jeton de la tablette, chiffré au repos ---------------------------

const SECRET = "secret-du-coffre-de-test-0123456789abcdef";
const JETON = fauxJwt({ appareil: "portee" }, "jeton-appareil-de-test");
const brutDuCoffre = (stockage) => stockage.objet("portee-remarkable", "jeton-appareil");

test("le jeton se range chiffré, et se relit", async () => {
  const stockage = await demarrerFauxStockage();
  try {
    const coffre = coffreSupabase(stockage.url, stockage.cle, { secret: SECRET });
    await coffre.ecrire(JETON);
    const brut = brutDuCoffre(stockage);
    assert.ok(estChiffre(brut));
    assert.ok(!brut.includes(JETON) && !brut.includes("jeton-appareil-de-test"), "rien du jeton en clair");
    assert.equal(await coffre.lire(), JETON);
    // Deux chiffrements du même jeton ne se ressemblent pas (vecteur tiré au hasard).
    assert.notEqual(await chiffrer(JETON, SECRET), await chiffrer(JETON, SECRET));
  } finally {
    await stockage.fermer();
  }
});

test("un jeton encore en clair se lit, puis se range chiffré", async () => {
  const stockage = await demarrerFauxStockage();
  try {
    await coffreSupabase(stockage.url, stockage.cle).ecrire(JETON); // relié avant le chiffrement
    assert.equal(brutDuCoffre(stockage), JETON);
    const coffre = coffreSupabase(stockage.url, stockage.cle, { secret: SECRET });
    assert.equal(await coffre.lire(), JETON);
    assert.ok(estChiffre(brutDuCoffre(stockage)));
    assert.equal(await coffre.lire(), JETON);
    // Sans PORTEE_COFFRE (déploiement à la main) : en clair, comme avant.
    const sansSecret = coffreSupabase(stockage.url, stockage.cle);
    await sansSecret.ecrire("autre-jeton");
    assert.equal(brutDuCoffre(stockage), "autre-jeton");
    assert.equal(await sansSecret.lire(), "autre-jeton");
  } finally {
    await stockage.fermer();
  }
});

test("secret perdu ou changé : la tablette est « à relier », sans plantage", async () => {
  const stockage = await demarrerFauxStockage();
  const cloud = await demarrerFauxCloud({ id: "doc", nom: "Essai", pdf: fs.readFileSync("modeles/melodie-standard.pdf"), pages: [] });
  const outil = (c, name, args = {}) => traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c).then((r) => r.result);
  const tablette = (secret) => new CloudRemarkable(coffreSupabase(stockage.url, stockage.cle, { secret }), { auth: cloud.url, sync: cloud.url });
  const neuf = "un-autre-secret-tout-neuf-0123456789";
  try {
    // Reliée avec le premier secret : l'arborescence répond.
    assert.equal((await outil(tablette(SECRET), "relier", { code: "abcdefgh" })).structuredContent.connectee, true);
    assert.equal((await outil(tablette(SECRET), "arborescence")).structuredContent.connectee, true);
    // Le secret a changé : comme une révocation.
    assert.deepEqual((await outil(tablette(neuf), "arborescence")).structuredContent, { connectee: false, raison: "revoquee" });
    // Le secret a disparu : pareil.
    assert.deepEqual((await outil(tablette(null), "arborescence")).structuredContent, { connectee: false, raison: "revoquee" });
    // Relier à nouveau range le jeton avec le nouveau secret.
    assert.equal((await outil(tablette(neuf), "relier", { code: "abcdefgh" })).structuredContent.connectee, true);
    assert.equal((await outil(tablette(neuf), "arborescence")).structuredContent.connectee, true);
  } finally {
    await stockage.fermer();
    await cloud.fermer();
  }
});

test("un chiffré abîmé ne se déchiffre pas", async () => {
  const bon = await chiffrer(JETON, SECRET);
  const abime = bon.slice(0, -4) + (bon.endsWith("AAAA") ? "BBBB" : "AAAA");
  for (const t of [abime, "portee-coffre:v1:", "portee-coffre:v1:xx.yy", "portee-coffre:v1:" + "A".repeat(16)]) {
    await assert.rejects(dechiffrer(t, SECRET), JetonIlisible);
  }
  await assert.rejects(dechiffrer(bon, "pas-le-bon-secret-du-tout-0123456789"), JetonIlisible);
  assert.equal(await dechiffrer(bon, SECRET), JETON);
});

test("le déploiement crée la clé du coffre une fois, et ne la remplace jamais", () => {
  let n = 0;
  const tirer = (taille) => `tiree-${taille}-${++n}`.padEnd(taille, "x");
  // Premier déploiement en local : la clé de l'adresse (affichée) et celle du coffre.
  let p = planDesSecrets({ existants: [], tirer });
  assert.deepEqual(p.aPoser.map((s) => s.name), ["PORTEE_CLE", "PORTEE_COFFRE"]);
  assert.equal(p.afficher, true);
  assert.equal(p.coffreNeuf, true);
  // Déjà en place : rien à poser.
  p = planDesSecrets({ existants: ["PORTEE_CLE", "PORTEE_COFFRE", "AUTRE"], tirer });
  assert.deepEqual(p.aPoser, []);
  assert.equal(p.cle, null);
  // Nouvelle clé d'adresse : le coffre ne bouge pas.
  p = planDesSecrets({ existants: ["PORTEE_CLE", "PORTEE_COFFRE"], nouvelleCle: true, tirer });
  assert.deepEqual(p.aPoser.map((s) => s.name), ["PORTEE_CLE"]);
  // Dans GitHub Actions : la clé vient du secret GitHub, jamais affichée ; le coffre s'ajoute s'il manque.
  const cle = "c".repeat(32);
  p = planDesSecrets({ existants: ["PORTEE_CLE"], cleFournie: cle, enCI: true, tirer });
  assert.deepEqual(p.aPoser.map((s) => s.name), ["PORTEE_CLE", "PORTEE_COFFRE"]);
  assert.equal(p.aPoser[0].value, cle);
  assert.equal(p.afficher, false);
  assert.ok(p.aPoser[1].value.length >= 32);
  // Sans secret GitHub : verrouillé par une clé que personne ne connaît, sans rien afficher.
  p = planDesSecrets({ existants: ["PORTEE_CLE", "PORTEE_COFFRE"], enCI: true, tirer });
  assert.deepEqual(p.aPoser.map((s) => s.name), ["PORTEE_CLE"]);
  assert.equal(p.afficher, false);
  assert.throws(() => planDesSecrets({ existants: [], cleFournie: "trop-courte" }), /24 caractères/);
  // Par défaut, des valeurs vraiment aléatoires et assez longues.
  const a = planDesSecrets({ existants: [] }), b = planDesSecrets({ existants: [] });
  assert.notEqual(a.aPoser[1].value, b.aPoser[1].value);
  assert.ok(a.aPoser[1].value.length >= 43); // 32 octets en base64url
});
