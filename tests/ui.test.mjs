/**
 * Tests de `echapper` (app/ui.js) : tout texte venu d'Adrien, d'une
 * sauvegarde ou de la synchro qui entre dans du HTML écrit en chaîne passe
 * par elle (audit du 04/10, S1).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { echapper } from "../app/ui.js";

test("echapper neutralise balises, attributs et entités", () => {
  assert.equal(echapper('<img src=x onerror="vol()">'), "&lt;img src=x onerror=&quot;vol()&quot;&gt;");
  assert.equal(echapper("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(echapper("&lt;"), "&amp;lt;"); // une entité déjà écrite reste du texte
});

test("echapper accepte autre chose qu'une chaîne (fiche mal formée)", () => {
  assert.equal(echapper(42), "42");
  assert.equal(echapper(null), "");
  assert.equal(echapper(undefined), "");
  assert.equal(echapper(["a", "<b>"]), "a,&lt;b&gt;");
});

test("le texte échappé, relu comme du HTML, redonne le texte d'origine", () => {
  const relire = (h) => h.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  for (const s of ["Fa♯ m7", 'dit "bonjour"', "<script>", "a & b", "l'été"]) assert.equal(relire(echapper(s)), s);
});
