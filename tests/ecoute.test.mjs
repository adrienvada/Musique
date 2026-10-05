/**
 * Tests d'ecoute.js : une écoute à la fois par écran, avec un faux
 * transport qui fait attendre le piano comme le vrai (transport.js) : une
 * écoute arrêtée ou remplacée pendant ce temps ne part pas, et l'écran se
 * remet en place (audit du 04/10, T4).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { creerEcoute } from "../app/ecoute.js";

/** Un transport dont le piano arrive quand on appelle `arrivee()`. */
function fauxTransport() {
  let arrivee, pret = new Promise((ok) => { arrivee = ok; });
  const t = {
    joue: [], attente: null, options: null,
    async jouer(source, options) {
      const moi = { surFin: options.surFin };
      t.attente = moi;
      await pret;
      if (t.attente !== moi) return false;
      t.attente = null;
      t.arreter();
      t.options = options;
      t.joue.push(source);
      return true;
    },
    arreter() {
      if (t.attente) { const a = t.attente; t.attente = null; a.surFin(); }
      if (t.options) { const o = t.options; t.options = null; o.surFin(); }
    },
    finir() { const o = t.options; t.options = null; o.surFin(); },
    arrivee: () => arrivee(),
  };
  return t;
}

test("arrêtée pendant que le piano se charge, l'écoute ne part pas à son arrivée", async () => {
  const t = fauxTransport();
  const e = creerEcoute(t);
  const arrets = [];
  const partie = e.jouer("lire", "page", { surArret: () => arrets.push("arret") });
  assert.equal(e.cle, "lire");
  e.arreter();
  t.arrivee();
  assert.equal(await partie, false);
  assert.deepEqual(t.joue, []);
  assert.deepEqual(arrets, ["arret"]);
  assert.equal(e.cle, null);
});

test("deux touchers sur le même bouton : le second arrête le premier, rien ne joue", async () => {
  const t = fauxTransport();
  const e = creerEcoute(t);
  const premiere = e.jouer("bouton", "page");
  const seconde = e.jouer("bouton", "page");
  t.arrivee();
  assert.equal(await premiere, false);
  assert.equal(await seconde, false);
  assert.deepEqual(t.joue, []);
});

test("une autre clé remplace l'écoute en cours ; la fin naturelle remet l'écran en place", async () => {
  const t = fauxTransport();
  const e = creerEcoute(t);
  const etats = [];
  t.arrivee();
  assert.equal(await e.jouer("a", "A", { surDepart: () => etats.push("a part"), surArret: () => etats.push("a s'arrête") }), true);
  assert.equal(await e.jouer("b", "B", { surDepart: () => etats.push("b part"), surArret: () => etats.push("b s'arrête") }), true);
  assert.deepEqual(t.joue, ["A", "B"]);
  assert.equal(e.cle, "b");
  t.finir();
  assert.deepEqual(etats, ["a part", "a s'arrête", "b part", "b s'arrête"]);
  assert.equal(e.cle, null);
});

test("le piano qui ne vient pas : l'écran se remet en place, l'erreur remonte", async () => {
  const t = { attente: null, jouer: async () => { throw new Error("Le piano n'a pas pu se télécharger."); }, arreter() {} };
  const e = creerEcoute(t);
  let arrete = false;
  await assert.rejects(e.jouer("x", "X", { surArret: () => { arrete = true; } }), /piano/);
  assert.equal(arrete, true);
  assert.equal(e.cle, null);
});
