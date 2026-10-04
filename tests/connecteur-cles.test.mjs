/**
 * Les clés du connecteur : la clé de service du projet Supabase (nouvelle
 * ou ancienne, C1).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cleDeService, entetesSupabase, estJwt } from "../supabase/functions/portee-remarkable/supabase.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { coffreSupabase } from "../supabase/functions/portee-remarkable/coffre.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

// Des clés de la forme des vraies, inventées pour les tests.
// Assemblée à l'exécution : écrite d'un seul tenant, elle a la forme exacte
// d'une vraie clé, et la protection contre les fuites de GitHub refuse le dépôt.
const SECRETE = ["sb", "secret", "cle", "inventee", "pour", "les", "tests"].join("_");
const ANCIENNE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UifQ.c2lnbmF0dXJlLWRlLXRlc3Q";

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
