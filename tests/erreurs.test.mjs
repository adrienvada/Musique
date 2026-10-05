/**
 * Tests d'erreurs.js : les erreurs du navigateur, de pdf.js et du stockage
 * deviennent une phrase en français qui dit quoi faire (audit du 04/10,
 * I13) ; celles que Portée écrit déjà en français passent telles quelles.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { echec, erreur, explication, expliquer, genreErreur } from "../app/erreurs.js";

/** Une erreur comme le navigateur les lance (un nom, un message). */
const du = (name, message) => Object.assign(new Error(message), { name });

test("les erreurs courantes sont reconnues, quel que soit le navigateur", () => {
  assert.equal(genreErreur(new TypeError("Failed to fetch")), "reseau"); // Chrome
  assert.equal(genreErreur(new TypeError("NetworkError when attempting to fetch resource.")), "reseau"); // Firefox
  assert.equal(genreErreur(new TypeError("Load failed")), "reseau"); // Safari
  assert.equal(genreErreur(new TypeError("Failed to fetch dynamically imported module: https://x/pdf.min.mjs")), "module");
  assert.equal(genreErreur(new TypeError("error loading dynamically imported module: https://x/a.js")), "module");
  assert.equal(genreErreur(new TypeError("Importing a module script failed.")), "module");
  assert.equal(genreErreur(du("InvalidPDFException", "Invalid PDF structure.")), "pdf");
  assert.equal(genreErreur(du("PasswordException", "No password given")), "pdf-protege");
  assert.equal(genreErreur(du("QuotaExceededError", "The quota has been exceeded.")), "plein");
  assert.equal(genreErreur(new Error("écriture annulée (stockage plein ?)")), "plein");
  assert.equal(genreErreur({ code: "server_unavailable", message: "Le connecteur répond HTTP 503." }), "connecteur");
  assert.equal(genreErreur(new Error("Cette partition est illisible : rien n'a été enregistré.")), "francais");
  assert.equal(genreErreur(new Error("undefined is not a function")), "inconnue");
  assert.equal(genreErreur(null), "inconnue");
});

test("aucun message montré ne garde le jargon anglais", () => {
  for (const e of [new TypeError("Failed to fetch"), du("InvalidPDFException", "Invalid PDF structure."),
    new TypeError("Failed to fetch dynamically imported module: https://x/pdf.min.mjs"), du("QuotaExceededError", "quota"),
    new Error("Cannot read properties of undefined (reading 'x')")]) {
    const t = expliquer(e);
    assert.doesNotMatch(t, /failed|fetch|invalid|quota|undefined|cannot/i, t);
    assert.match(t, /^[A-ZÀ-Ý]/, "une phrase commence par une majuscule");
  }
});

test("un message de Portée passe tel quel ; une erreur inconnue peut avoir son texte de secours", () => {
  assert.equal(explication(new Error("Modèle inconnu : piano-xl")), "Modèle inconnu : piano-xl");
  assert.equal(expliquer(new Error("undefined is not a function"), "Le piano n'a pas pu se charger."), "Le piano n'a pas pu se charger.");
  assert.equal(echec("L'export MIDI", new TypeError("Failed to fetch")), "L'export MIDI n'a pas abouti : pas de connexion. Réessaie quand le réseau sera revenu.");
});

test("erreur() : une Error avec sa pile, son code et sa cause, plutôt qu'un objet brut", () => {
  const cause = new TypeError("Failed to fetch");
  const e = erreur("server_unavailable", "Le connecteur ne répond pas (connexion ?).", { cause, result: { a: 1 } });
  assert.ok(e instanceof Error);
  assert.equal(e.code, "server_unavailable");
  assert.equal(e.cause, cause);
  assert.deepEqual(e.result, { a: 1 });
  assert.match(e.stack, /Error/);
});
