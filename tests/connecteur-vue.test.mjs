/**
 * Une partition jouable dans la conversation (C6, extension MCP Apps) :
 * la ressource ui://portee/partition, l'outil partition_montrer, et la
 * partition de secours d'une idée sans ABC. La page elle-même est essayée
 * dans Chromium à part (connecteur-vue-navigateur.test.mjs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import abcjs from "abcjs";
import { Bibliotheque } from "../supabase/functions/portee-remarkable/bibliotheque.js";
import { objetsSupabase } from "../supabase/functions/portee-remarkable/objets.js";
import { repondreHttp } from "../supabase/functions/portee-remarkable/http.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";
import { abcDeSecours } from "../supabase/functions/portee-remarkable/abc.js";
import { ABCJS, HTML_VUE, META_VUE, URI_VUE } from "../supabase/functions/portee-remarkable/vue-partition.js";
import { ICONES } from "../app/icones.js";
import { demarrerFauxStockage } from "./faux-cloud.mjs";

const rpc = (method, params) => traiter({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }, null);

/** Ce qu'abcjs entend : [[début, durée, hauteur]] en pas, liaisons fondues. */
function entendu(abc) {
  const [tune] = abcjs.parseOnly(abc);
  assert.deepEqual(tune.warnings || [], [], abc);
  return tune.setUpAudio({ chordsOff: true }).tracks.flatMap((t) => t.filter((e) => e.cmd === "note" && e.pitch >= 0)
    .map((e) => [Math.round(e.start * 16), Math.round(e.duration * 16), e.pitch])).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

test("la ressource ui://portee/partition : une page MCP Apps, ses domaines déclarés", async () => {
  const liste = (await rpc("resources/list")).result.resources;
  assert.equal(liste.length, 1);
  assert.equal(liste[0].uri, URI_VUE);
  assert.equal(liste[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(liste[0]._meta, META_VUE);
  const lu = (await rpc("resources/read", { uri: URI_VUE })).result.contents;
  assert.equal(lu.length, 1);
  assert.equal(lu[0].uri, URI_VUE);
  assert.equal(lu[0].mimeType, "text/html;profile=mcp-app");
  assert.match(lu[0].text, /^<!doctype html>/i);
  assert.deepEqual(lu[0]._meta.ui.csp, { resourceDomains: ["https://cdnjs.cloudflare.com"], connectDomains: ["https://paulrosen.github.io"] });
  assert.deepEqual((await rpc("resources/templates/list")).result, { resourceTemplates: [] });
  // Une autre adresse : introuvable (-32002 avant 2026-07-28).
  assert.equal((await rpc("resources/read", { uri: "ui://portee/autre" })).error.code, -32002);
  const init = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }, null);
  assert.deepEqual(init.result.capabilities.resources, { listChanged: false });
});

test("en 2026-07-28 : resources/read se garde, l'introuvable est -32602, l'extension est annoncée", async () => {
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } };
  const appel = (method, params, nom) => repondreHttp(new Request("https://x.supabase.co/functions/v1/portee-remarkable/" + "k".repeat(32), {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(nom ? { "mcp-name": nom } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method, params: { ...params, _meta: meta } }),
  }), { cle: "k".repeat(32), cloud: () => null }).then((r) => r.json());
  const lu = (await appel("resources/read", { uri: URI_VUE }, URI_VUE)).result;
  assert.equal(lu.resultType, "complete");
  assert.equal(lu.cacheScope, "private");
  assert.ok(lu.ttlMs > 0);
  assert.equal(lu.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.equal((await appel("resources/read", { uri: "ui://ailleurs" }, "ui://ailleurs")).error.code, -32602);
  const d = (await appel("server/discover", {})).result;
  assert.deepEqual(d.capabilities.extensions, { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } });
  assert.deepEqual(d.capabilities.resources, { listChanged: false });
});

test("l'outil partition_montrer porte l'adresse de son interface", async () => {
  const outil = (await rpc("tools/list")).result.tools.find((t) => t.name === "partition_montrer");
  assert.ok(outil);
  assert.equal(outil._meta.ui.resourceUri, URI_VUE);
  assert.equal(outil._meta["ui/resourceUri"], URI_VUE); // l'ancienne forme, pour les hôtes d'avant
  assert.equal(outil.annotations.readOnlyHint, true);
  assert.deepEqual(outil.inputSchema.required, ["id"]);
});

test("la page : abcjs vérifié par son empreinte, rien d'autre chargé d'ailleurs, les icônes de l'appli", () => {
  const fichier = fs.readFileSync("node_modules/abcjs/dist/abcjs-basic-min.js");
  const empreinte = "sha512-" + crypto.createHash("sha512").update(fichier).digest("base64");
  assert.equal(ABCJS.integrite, empreinte, "abcjs a changé : recalcule l'empreinte de vue-partition.js");
  const version = JSON.parse(fs.readFileSync("node_modules/abcjs/package.json", "utf8")).version;
  assert.ok(ABCJS.adresse.includes(`/abcjs/${version}/`), `abcjs ${version} dans node_modules, pas celui de la page`);
  assert.ok(HTML_VUE.includes(`integrity="${empreinte}"`) && HTML_VUE.includes('crossorigin="anonymous"'));
  // Toute adresse de la page est dans un domaine déclaré à l'hôte (csp).
  const adresses = [...HTML_VUE.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  const permis = [...META_VUE.ui.csp.resourceDomains, ...META_VUE.ui.csp.connectDomains, "http://www.w3.org"];
  for (const a of adresses) assert.ok(permis.some((p) => a.startsWith(p)), a);
  assert.doesNotMatch(HTML_VUE, /fetch\(|XMLHttpRequest|localStorage|document\.cookie|eval\(/);
  // Les mêmes icônes que l'appli, jamais un caractère.
  assert.ok(HTML_VUE.includes(ICONES.lire) && HTML_VUE.includes(ICONES.stop));
  assert.doesNotMatch(HTML_VUE, /[▶■⏹⏵✕★]/);
});

test("partition_montrer : l'ABC d'une page ou d'une idée, une partition de secours pour une idée de Claude", async () => {
  const stockage = await demarrerFauxStockage();
  const bib = new Bibliotheque(objetsSupabase(stockage.url, stockage.cle));
  const quand = "2026-10-01T10:00:00.000Z";
  const montrer = async (id) => (await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "partition_montrer", arguments: { id } } }, null, bib)).result;
  try {
    const abcPage = "X:1\nT:Valse\nM:3/4\nL:1/8\nK:F\nF2 A2 c2 |]\n";
    await bib.ecrire({ id: "valse", donnees: { titre: "Valse", abc: abcPage, doutes: [], statut: "prete", modifieLe: quand }, pages: [], modifieLe: quand });
    await bib.ecrire({ id: "chanson", donnees: { type: "morceau", titre: "Chanson", blocs: [], modifieLe: quand }, pages: [], modifieLe: quand });
    const page = await montrer("valse");
    assert.equal(page.structuredContent.abc, abcPage);
    assert.equal(page.structuredContent.source, "partition");
    assert.match(page.content[0].text, /Valse/);
    assert.ok(page.content[0].text.includes(abcPage.trim())); // un hôte sans interface a l'ABC
    // Une idée notée par Claude, sans ABC : écrite d'après ses notes.
    const creee = (await traiter({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "idee_ecrire", arguments: {
      titre: "Averse", tempo: 100, mesure: "6/8", tonalite: "Dm",
      notes: [{ debut: 0, duree: 6, hauteur: 62 }, { debut: 6, duree: 2, hauteur: 65 }, { debut: 8, duree: 10, hauteur: 69 }, { debut: 20, duree: 4, hauteur: 61 }],
      accords: [{ debut: 0, nom: "Dm" }, { debut: 12, nom: "A7" }],
    } } }, null, bib)).result.structuredContent;
    const idee = await montrer(creee.id);
    assert.equal(idee.isError, undefined, idee.content[0].text);
    assert.equal(idee.structuredContent.source, "notes");
    assert.equal(idee.structuredContent.mesure, "6/8");
    assert.deepEqual(entendu(idee.structuredContent.abc), [[0, 6, 62], [6, 2, 65], [8, 10, 69], [20, 4, 61]]);
    assert.match(idee.structuredContent.abc, /"Dm"/);
    assert.match(idee.structuredContent.abc, /"A7"/);
    // Un morceau, une partition inconnue : une erreur qui le dit.
    assert.match((await montrer("chanson")).content[0].text, /morceau/);
    assert.equal((await montrer("inconnue")).isError, true);
  } finally {
    await stockage.fermer();
  }
});

test("la partition de secours : abcjs y relit les notes, sur deux cents idées au hasard", () => {
  let graine = 11;
  const r = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  const mesures = [[4, 4], [3, 4], [2, 4], [6, 8], [12, 8], [5, 4], [2, 2], [7, 8], [9, 8]];
  const tonalites = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm"];
  for (let essai = 0; essai < 200; essai++) {
    const notes = [];
    let d = 0;
    for (let i = 0, nb = 2 + Math.floor(r() * 12); i < nb; i++) {
      if (r() < 0.25) d += 1 + Math.floor(r() * 6); // un silence
      const l = 1 + Math.floor(r() * 20);
      const h = 36 + Math.floor(r() * 48);
      notes.push({ d, l, h });
      if (r() < 0.15) notes.push({ d, l, h: h + 4 }); // un accord
      d += l;
    }
    const seq = { mesure: mesures[essai % mesures.length], tonalite: tonalites[essai % tonalites.length], tempo: 96, pistes: [{ nom: "Mélodie", notes }], accords: r() < 0.5 ? [{ d: 0, nom: "C" }, { d: 1 + Math.floor(r() * 30), nom: "G7" }] : [] };
    const abc = abcDeSecours(seq, `Essai ${essai}`);
    const attendu = notes.map((n) => [n.d, n.l, n.h]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    assert.deepEqual(entendu(abc), attendu, abc);
  }
  // Une note encore tenue quand la suivante part s'arrête là ; des notes ensemble, de durées différentes, font un accord.
  const chevauche = abcDeSecours({ mesure: [4, 4], tonalite: "C", pistes: [{ notes: [{ d: 0, l: 8, h: 60 }, { d: 4, l: 4, h: 64 }, { d: 8, l: 2, h: 67 }, { d: 8, l: 4, h: 71 }] }] });
  assert.deepEqual(entendu(chevauche), [[0, 4, 60], [4, 4, 64], [8, 4, 67], [8, 4, 71]]);
  // Rien d'étrange ne passe : pas de note, une idée vide, une mesure absurde.
  assert.match(abcDeSecours({ pistes: [{ notes: [] }] }), /z16 \|\]/);
  assert.match(abcDeSecours({ mesure: [0, 4], pistes: [{ notes: [{ d: 0, l: 4, h: 60 }, { d: -1, l: 2, h: 61 }, { d: 4, l: 1e9, h: 62 }] }] }), /M:4\/4/);
  assert.doesNotMatch(abcDeSecours({ pistes: [{ notes: [{ d: 0, l: 4, h: 60 }] }] }, "Titre\nK:A"), /\nK:A/);
});
