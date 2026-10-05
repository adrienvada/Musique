/**
 * La tablette vue de l'appli (lot atelier) : l'import par tranches sur
 * claude.ai (C3), avec le vrai connecteur sur le faux cloud ; les pages et
 * documents illisibles dits en clair ; et la liste des modèles (L9, L16),
 * qui doit suivre le dossier modeles/.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { documentParTranches } from "../app/connecteur.js";
import { bilanEtalonnage, MODELES, nomModele, pagesIllisibles } from "../app/tablette.js";
import { CloudRemarkable } from "../supabase/functions/portee-remarkable/remarkable.js";
import { coffreMemoire } from "../supabase/functions/portee-remarkable/coffre.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { demarrerFauxCloud } from "./faux-cloud.mjs";

const MODELE = fs.readFileSync("modeles/melodie-standard.pdf");
// Une page dense : environ 60 000 caractères une fois compactée (comme dans les essais du connecteur).
const dense = (n) => Array.from({ length: 120 }, (_, i) => Array.from({ length: 50 }, (_, k) => [100 + ((i * 7 + k * 13 + n) % 1200), 150 + ((i * 11 + k * 3) % 1700)]));

/** La capacité `mcp` de claude.ai, imitée : chaque appel passe par le vrai connecteur, et on garde la taille de la réponse. */
function capaciteMcp(cloud) {
  const appels = [];
  return {
    appels,
    async callTool(serveur, outil, args, options) {
      const r = await traiter({ jsonrpc: "2.0", id: appels.length + 1, method: "tools/call", params: { name: outil, arguments: args } }, cloud);
      appels.push({ serveur, outil, args, options, taille: JSON.stringify(r).length });
      if (r.result.isError) throw Object.assign(new Error(r.result.content[0].text), { code: "tool_error" });
      return { payload: r.result.structuredContent };
    },
  };
}

test("C3 · un document dense arrive par tranches, chaque réponse sous la coupure de claude.ai, ses pages dans l'ordre", async () => {
  // Six pages denses, une blanche (la 4ᵉ, sans .rm) et une abîmée (la 6ᵉ).
  const faux = await demarrerFauxCloud({ id: "doc", nom: "Essai", pdf: MODELE, pages: [dense(1), dense(2), dense(3), null, dense(5), dense(6), dense(7)] }, { pageCassee: 6 });
  try {
    const cloud = new CloudRemarkable(coffreMemoire("jeton-appareil-de-test"), { auth: faux.url, sync: faux.url }, { attendre: async () => {}, alea: () => 0 });
    const m = capaciteMcp(cloud);
    const d = await documentParTranches(m, "Portée reMarkable", "doc");
    assert.deepEqual(d.pages.map((p) => p.numero), [1, 2, 3, 5, 7]);
    assert.deepEqual(d.pagesIllisibles.map((p) => p.numero), [6]);
    assert.deepEqual(d.pagesRestantes, []);
    assert.equal(d.modele, "melodie-standard");
    assert.equal(d.versionModele, 1);
    assert.equal(d.nom, "Essai");
    // Plusieurs tours, chacun sous les 150 000 caractères où claude.ai coupe un résultat d'outil.
    assert.ok(m.appels.length > 1, `${m.appels.length} appel(s)`);
    for (const a of m.appels) {
      assert.ok(a.taille < 150000, `${a.taille} caractères`);
      assert.equal(a.serveur, "Portée reMarkable");
      assert.deepEqual(a.options, { cache: false });
    }
    assert.deepEqual(m.appels[0].args, { id: "doc", pages: { de: 1, a: 500 } });
    // Les mêmes traits que l'appel unique du site.
    const tout = (await m.callTool("Portée reMarkable", "document", { id: "doc" })).payload;
    assert.deepEqual(d.pages, tout.pages);
  } finally {
    await faux.fermer();
  }
});

test("C3 · un connecteur d'avant, qui ignore `pages` : un seul tour, tout le document", async () => {
  const appels = [];
  const ancien = {
    async callTool(_s, _o, args) {
      appels.push(args);
      return { payload: { id: "doc", nom: "Vieux", modele: "piano-standard", pages: [{ numero: 1, traits: [[1, 2, 3, 4]] }, { numero: 2, traits: [[5, 6, 7, 8]] }] } };
    },
  };
  const d = await documentParTranches(ancien, "Portée reMarkable", "doc");
  assert.equal(appels.length, 1);
  assert.deepEqual(d.pages.map((p) => p.numero), [1, 2]);
  assert.equal(d.versionModele, undefined); // l'appli prend alors la v1
});

test("C3 · un très long carnet : des plages de 500 pages au plus, jusqu'à la dernière", async () => {
  // Un connecteur imité : 1 203 pages, 120 rendues par réponse (son budget), le reste dans pagesRestantes.
  const N = 1203, PAR_REPONSE = 120;
  const demandes = [];
  const m = {
    async callTool(_s, _o, { pages }) {
      demandes.push(pages);
      const voulues = Array.isArray(pages) ? pages : Array.from({ length: pages.a - pages.de + 1 }, (_, i) => pages.de + i);
      assert.ok(voulues.length <= 500, "500 pages au plus par demande");
      const dans = voulues.filter((n) => n <= N);
      return { payload: { modele: "melodie-standard", versionModele: 1, nombrePages: N, pages: dans.slice(0, PAR_REPONSE).map((n) => ({ numero: n, traits: [] })), pagesIllisibles: [], pagesRestantes: dans.slice(PAR_REPONSE) } };
    },
  };
  const d = await documentParTranches(m, "Portée reMarkable", "carnet");
  assert.equal(d.pages.length, N);
  assert.deepEqual(d.pages.map((p) => p.numero), Array.from({ length: N }, (_, i) => i + 1));
  assert.deepEqual(demandes.filter((x) => !Array.isArray(x)), [{ de: 1, a: 500 }, { de: 501, a: 1000 }, { de: 1001, a: 1203 }]);
});

test("C3 · un connecteur qui ne progresse plus ne fait pas tourner l'appli sans fin", async () => {
  let appels = 0;
  const bloque = { async callTool() { appels++; return { payload: { pages: appels === 1 ? [{ numero: 1, traits: [] }] : [], pagesRestantes: [2, 3] } }; } };
  const d = await documentParTranches(bloque, "Portée reMarkable", "doc");
  assert.equal(appels, 2);
  assert.deepEqual(d.pages.map((p) => p.numero), [1]);
});

test("L16 · ce qu'une page d'étalonnage a appris se dit en clair, cases vides comprises", () => {
  const noms = JSON.parse(fs.readFileSync("modeles/etalonnage-v1.json", "utf8")).cases.map((c) => c.nom);
  assert.equal(bilanEtalonnage({ appris: 0, neufs: 0, vides: noms, cases: noms.length }), "Ta page d'étalonnage n'a rien appris à Portée : ses cases sont vides. Écris chaque signe trois fois dans sa case, à côté du signe gris, puis importe-la à nouveau.");
  assert.equal(bilanEtalonnage({ appris: 54, neufs: 54, vides: [], cases: 18 }), "Portée a appris 54 signes de ton écriture. Toutes les cases sont remplies.");
  assert.equal(bilanEtalonnage({ appris: 3, neufs: 3, vides: noms.filter((n) => n !== "Quart de soupir"), cases: 18 }).split(" : ")[0], "Portée a appris 3 signes de ton écriture. Cases restées vides");
  assert.equal(bilanEtalonnage({ appris: 48, neufs: 48, vides: ["Quart de soupir", "Chiffre 7", "C barré (2/2)"], cases: 18 }), "Portée a appris 48 signes de ton écriture. Cases restées vides : quart de soupir, chiffre 7, C barré (2/2). Tu peux les remplir et importer la page à nouveau.");
  assert.equal(bilanEtalonnage({ appris: 51, neufs: 0, vides: ["3 de triolet"], cases: 18 }), "Portée connaissait déjà ces 51 signes de ton écriture : rien de neuf. Case restée vide : 3 de triolet. Tu peux les remplir et importer la page à nouveau.");
  assert.equal(bilanEtalonnage({ appris: 10, neufs: 4, vides: [], cases: 18 }), "Portée a appris 4 signes de ton écriture (elle en connaissait déjà 6). Toutes les cases sont remplies.");
});

test("les pages illisibles se disent en clair", () => {
  assert.equal(pagesIllisibles([]), null);
  assert.equal(pagesIllisibles(undefined), null);
  assert.equal(pagesIllisibles([{ numero: 3, raison: "x" }]), "La page 3 n'a pas pu être lue : réessaie plus tard, ou exporte-la en PDF.");
  assert.equal(pagesIllisibles([{ numero: 5 }, { numero: 2 }, { numero: 9 }, { numero: 2 }]), "Les pages 2, 5 et 9 n'ont pas pu être lues : réessaie plus tard, ou exporte-les en PDF.");
});

test("L9 · L16 · la liste des modèles suit modeles/ : chacun a sa calibration, son PDF et son aperçu, et l'étalonnage en est", () => {
  const enCours = fs.readdirSync("modeles").filter((f) => /^[a-z0-9-]+\.json$/.test(f) && !/-v\d+\.json$/.test(f) && f !== "index.json").map((f) => f.replace(/\.json$/, "")).sort();
  assert.deepEqual(MODELES.map((m) => m.id).sort(), enCours);
  for (const m of MODELES) {
    for (const f of [`modeles/${m.id}.pdf`, `modeles/apercu/${m.id}.svg`]) assert.ok(fs.existsSync(f), f);
    assert.ok(m.nom && m.detail, m.id);
  }
  assert.equal(nomModele("piano-large"), "Piano, large");
  assert.equal(nomModele("etalonnage"), "Étalonnage");
  assert.equal(nomModele("modele-inconnu"), "modele-inconnu");
});
