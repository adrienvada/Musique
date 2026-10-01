/**
 * Tests du connecteur « Portée reMarkable » : lecture des fichiers .rm, protocole
 * du cloud (sur un faux cloud local) et protocole MCP, jusqu'à l'ABC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireLignes, traitsDePage, versPage } from "../supabase/functions/portee-remarkable/rm.js";
import { CloudRemarkable } from "../supabase/functions/portee-remarkable/remarkable.js";
import { coffreMemoire, coffreSupabase } from "../supabase/functions/portee-remarkable/coffre.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { lirePartition } from "../lecteur/partition.js";
import { decompacter } from "../app/stockage.js";
import { lireFichier } from "../outils/lire.mjs";
import { demarrerFauxCloud, demarrerFauxStockage, ecrireRm } from "./faux-cloud.mjs";

const corps = (abc) => abc.split("\n").filter((l) => !/^[A-Za-z]:|^%%/.test(l)).join("\n");

test("les fichiers .rm de rmscene se lisent comme rmscene les lit", () => {
  // Valeurs relevées avec rmscene 0.8 (Python) sur ses propres fichiers de test.
  const couleurs = lireLignes(new Uint8Array(fs.readFileSync("tests/fixtures/rm/Color_and_tool_v3.14.4.rm")));
  assert.equal(couleurs.length, 25);
  assert.equal(couleurs.reduce((a, l) => a + l.points.length, 0), 1370);
  const v2 = lireLignes(new Uint8Array(fs.readFileSync("tests/fixtures/rm/Lines_v2.rm")));
  assert.equal(v2.length, 10);
  assert.deepEqual(v2[0].points[0].map((x) => Math.round(x * 100) / 100), [-529.5, 91.43]);
});

test("écrire puis relire une page .rm rend les mêmes traits", () => {
  const traits = [[[100, 200], [110.5, 210.25]], [[700, 900], [705, 950], [702, 1000]]];
  const relus = traitsDePage(new Uint8Array(ecrireRm(traits)));
  assert.deepEqual(relus.map((t) => t.map((p) => p.map((v) => Math.round(v * 100) / 100))), traits);
});

test("une vraie page de la tablette se lit comme son export PDF (227 unités par pouce)", async () => {
  // Coordonnées brutes envoyées par la reMarkable d'Adrien pour sa page d'essai.
  const { traits } = JSON.parse(fs.readFileSync("tests/fixtures/rm/melodie-standard-tablette.json", "utf8"));
  const tablette = traits.map((t) => {
    const pts = [];
    for (let i = 0; i < t.length; i += 2) pts.push(versPage([t[i] / 2, t[i + 1] / 2]));
    return pts;
  });
  const pdf = await lireFichier("tests/pages/2026-09-30-melodie-standard.pdf");
  // Trait pour trait, les points tombent au même endroit que dans le PDF.
  let ecart = 0;
  tablette.forEach((t, i) => t.forEach((p, k) => { ecart = Math.max(ecart, Math.hypot(p[0] - pdf.pages[0].traits[i][k][0], p[1] - pdf.pages[0].traits[i][k][1])); }));
  assert.ok(ecart < 0.5, `écart maximal ${ecart.toFixed(2)} px`);
  // Et la lecture est la même, mesure pour mesure.
  const res = lirePartition([tablette], pdf.cal, {});
  assert.equal(corps(res.abc), corps(pdf.abc));
});

test("du faux cloud à l'ABC : même lecture que le PDF exporté", async () => {
  const pdf = await lireFichier("tests/pages/2026-09-30-piano-standard.pdf");
  const cloud = await demarrerFauxCloud({
    id: "doc-piano", nom: "Essai piano", pdf: fs.readFileSync("modeles/piano-standard.pdf"), pages: [pdf.pages[0].traits],
  });
  try {
    const c = new CloudRemarkable(coffreMemoire("jeton-appareil-de-test"), { auth: cloud.url, sync: cloud.url });
    // Arborescence : le dossier, le document, pas la corbeille.
    const noeuds = await c.arborescence();
    assert.deepEqual(noeuds.map((n) => [n.nom, n.type]).sort(), [["Essai piano", "document"], ["Partitions", "dossier"]]);
    assert.equal(noeuds.find((n) => n.nom === "Essai piano").parent, "dossier-partitions");
    // Document, via le protocole MCP, comme l'appelle claude.ai.
    const init = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, c);
    assert.equal(init.result.serverInfo.name, "portee-remarkable");
    assert.equal(await traiter({ jsonrpc: "2.0", method: "notifications/initialized" }, c), null);
    const liste = await traiter({ jsonrpc: "2.0", id: 2, method: "tools/list" }, c);
    assert.deepEqual(liste.result.tools.map((t) => t.name), ["arborescence", "document", "relier", "bibliotheque_changements", "bibliotheque_pages", "bibliotheque_ecrire"]);
    const r = await traiter({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "document", arguments: { id: "doc-piano" } } }, c);
    const doc = r.result.structuredContent;
    assert.equal(doc.modele, "piano-standard");
    assert.equal(doc.nom, "Essai piano");
    // Les traits, compactés au demi-pixel pour le voyage, relus par le lecteur.
    const cal = JSON.parse(fs.readFileSync("modeles/piano-standard.json", "utf8"));
    const res = lirePartition(doc.pages.map((p) => decompacter(p.traits)), cal, { titre: "Essai piano" });
    assert.equal(corps(res.abc), corps(pdf.abc));
  } finally {
    await cloud.fermer();
  }
});

test("relier la tablette depuis l'appli : code, coffre, puis arborescence", async () => {
  const cloud = await demarrerFauxCloud({ id: "doc", nom: "Essai", pdf: fs.readFileSync("modeles/melodie-standard.pdf"), pages: [] });
  const stockage = await demarrerFauxStockage();
  const appel = (c, name, args = {}) => traiter({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, c).then((r) => r.result);
  const neuf = () => new CloudRemarkable(coffreSupabase(stockage.url, stockage.cle), { auth: cloud.url, sync: cloud.url });
  try {
    // Jamais reliée : l'arborescence le dit, sans erreur.
    const c = neuf();
    assert.deepEqual((await appel(c, "arborescence")).structuredContent, { connectee: false, raison: "jamais" });
    // Un code mal tapé ou expiré : erreur lisible, rien d'écrit.
    assert.match((await appel(c, "relier", { code: "abc" })).content[0].text, /8 lettres/);
    assert.match((await appel(c, "relier", { code: "zzzzzzzz" })).content[0].text, /refuse ce code/);
    assert.equal(stockage.compartiments.size, 0);
    // Le bon code : le jeton va au coffre (compartiment privé), l'arborescence revient.
    const r = await appel(c, "relier", { code: " ABCDEFGH " });
    assert.equal(r.structuredContent.connectee, true);
    assert.deepEqual(r.structuredContent.noeuds.map((n) => n.nom).sort(), ["Essai", "Partitions"]);
    const compartiment = stockage.compartiments.get("portee-remarkable");
    assert.equal(compartiment.publique, false);
    assert.equal(compartiment.objets.get("jeton-appareil").corps, "jeton-appareil-de-test");
    // Une instance neuve (fonction redémarrée) relit le jeton au coffre.
    assert.equal((await appel(neuf(), "arborescence")).structuredContent.connectee, true);
    // Relier une seconde fois remplace le jeton sans erreur.
    assert.equal((await appel(neuf(), "relier", { code: "abcdefgh" })).structuredContent.connectee, true);
    // Portée retirée des appareils sur my.remarkable.com : il faut un nouveau code.
    cloud.revoquer();
    assert.deepEqual((await appel(neuf(), "arborescence")).structuredContent, { connectee: false, raison: "revoquee" });
    const doc = await appel(neuf(), "document", { id: "doc" });
    assert.equal(doc.isError, true);
    assert.match(doc.content[0].text, /nouveau code/);
  } finally {
    await cloud.fermer();
    await stockage.fermer();
  }
});

test("un coffre refusé par Supabase donne une erreur d'outil, pas « non reliée »", async () => {
  const stockage = await demarrerFauxStockage();
  try {
    const c = new CloudRemarkable(coffreSupabase(stockage.url, "mauvaise-cle"));
    const r = await traiter({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "arborescence", arguments: {} } }, c);
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /HTTP 403/);
  } finally {
    await stockage.fermer();
  }
});

test("HTTP : clé, CORS pour le site GitHub Pages seulement, préflight", async () => {
  const { repondreHttp } = await import("../supabase/functions/portee-remarkable/http.js");
  const cle = "k".repeat(32);
  const cloud = () => new CloudRemarkable(coffreMemoire(null));
  const appel = (chemin, { methode = "POST", origine, corps } = {}) => repondreHttp(new Request(`https://x.supabase.co/functions/v1/portee-remarkable/${chemin}`, {
    method: methode,
    headers: { "content-type": "application/json", ...(origine ? { origin: origine } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  }), { cle, cloud });
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  // Mauvaise clé : 404, mais lisible par le site (pour dire « adresse incorrecte »).
  const mauvaise = await appel("nimporte", { corps: ping, origine: "https://adrienvada.github.io" });
  assert.equal(mauvaise.status, 404);
  assert.equal(mauvaise.headers.get("access-control-allow-origin"), "https://adrienvada.github.io");
  // Préflight du navigateur, même avec une clé fausse (la vraie requête dira 404).
  const pre = await appel(cle, { methode: "OPTIONS", origine: "https://adrienvada.github.io" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /content-type/);
  assert.equal((await appel("nimporte", { methode: "OPTIONS", origine: "https://adrienvada.github.io" })).status, 204);
  // Appel du site : réponse et CORS.
  const site = await appel(cle, { corps: ping, origine: "https://adrienvada.fr" });
  assert.equal(site.status, 200);
  assert.equal(site.headers.get("access-control-allow-origin"), "https://adrienvada.fr");
  assert.deepEqual((await site.json()).result, {});
  // Une autre origine n'a pas les en-têtes : le navigateur bloque la lecture.
  const autre = await appel(cle, { corps: ping, origine: "https://ailleurs.example" });
  assert.equal(autre.headers.get("access-control-allow-origin"), null);
  // claude.ai (sans origine) : réponse normale ; GET refusé.
  assert.equal((await appel(cle, { corps: ping })).status, 200);
  assert.equal((await appel(cle, { methode: "GET" })).status, 405);
});
