/**
 * Le protocole MCP du connecteur (C2) : la version 2026-07-28 (sans
 * `initialize`, version et en-têtes à chaque requête) et les versions
 * d'avant, sur la même adresse. Chaque écart relevé par l'audit
 * (mcp-conformite.mjs) a son test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { repondreHttp } from "../supabase/functions/portee-remarkable/http.js";
import { traiter, VERSIONS } from "../supabase/functions/portee-remarkable/mcp.js";
import { CloudRemarkable } from "../supabase/functions/portee-remarkable/remarkable.js";
import { coffreMemoire } from "../supabase/functions/portee-remarkable/coffre.js";

const CLE = "k".repeat(32);
const ADRESSE = `https://x.supabase.co/functions/v1/portee-remarkable/${CLE}`;
const MODERNE = "2026-07-28";
const cloudVide = () => new CloudRemarkable(coffreMemoire(null));

/** Une fausse bibliothèque qui note ce qu'on lui fait faire. */
function fausseBibliotheque(partitions = []) {
  const ecrits = [];
  return {
    ecrits,
    async changements() { return { partitions, curseur: "2026-10-04T10:00:00.000Z" }; },
    async pages() { return []; },
    async ecrire(f) { ecrits.push(f); return { accepte: true, fiche: f }; },
  };
}

async function http(corps, { entetes = {}, bibliotheque = fausseBibliotheque(), methode = "POST" } = {}) {
  const r = await repondreHttp(new Request(ADRESSE, {
    method: methode,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  }), { cle: CLE, cloud: cloudVide, bibliotheque: () => bibliotheque });
  const texte = await r.text();
  return { statut: r.status, entetes: r.headers, corps: texte ? JSON.parse(texte) : null };
}

/** Une requête 2026-07-28 bien formée (corps et en-têtes), qu'un test peut abîmer. */
function moderne(method, params = {}, { version = MODERNE, entetes = {}, sans = [] } = {}) {
  const corps = {
    jsonrpc: "2.0", id: 7, method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "essai", version: "1.0.0" },
      },
    },
  };
  const h = { "mcp-protocol-version": version, "mcp-method": method };
  if (method === "tools/call" || method === "prompts/get") h["mcp-name"] = params.name;
  if (method === "resources/read") h["mcp-name"] = params.uri;
  for (const s of sans) delete h[s];
  return { corps, entetes: { ...h, ...entetes } };
}
const envoyer = ({ corps, entetes }, options = {}) => http(corps, { ...options, entetes: { ...entetes, ...(options.entetes || {}) } });

test("versions d'avant : la version demandée si on la connaît, sinon 2025-11-25", async () => {
  for (const v of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {} } }, cloudVide());
    assert.equal(r.result.protocolVersion, v);
    assert.equal(r.result.serverInfo.name, "portee-remarkable");
    assert.equal("resultType" in r.result, false); // rien de 2026-07-28 dans une réponse d'avant
  }
  // L'audit : « 1999-01-01 » était renvoyée telle quelle.
  for (const v of ["1999-01-01", "2024-11-05", MODERNE, undefined]) {
    const r = await traiter({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } }, cloudVide());
    assert.equal(r.result.protocolVersion, "2025-11-25", String(v));
  }
  assert.equal(await traiter({ jsonrpc: "2.0", method: "notifications/initialized" }, cloudVide()), null);
  assert.deepEqual((await traiter({ jsonrpc: "2.0", id: 2, method: "ping" }, cloudVide())).result, {});
});

test("outil inconnu : erreur JSON-RPC -32602, dans les deux époques", async () => {
  const ancien = await http({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "effacer_tout" } });
  assert.equal(ancien.statut, 200);
  assert.equal(ancien.corps.error.code, -32602);
  assert.match(ancien.corps.error.message, /effacer_tout/);
  const neuf = await envoyer(moderne("tools/call", { name: "effacer_tout", arguments: {} }));
  assert.equal(neuf.corps.error.code, -32602);
  // Sans params du tout, ni nom : même erreur.
  assert.equal((await http({ jsonrpc: "2.0", id: 9, method: "tools/call" })).corps.error.code, -32602);
});

test("une notification n'exécute rien et reçoit 202, sans corps", async () => {
  const bib = fausseBibliotheque();
  // L'audit : un tools/call sans id écrivait dans la bibliothèque, et répondait.
  const r = await http({ jsonrpc: "2.0", method: "tools/call", params: { name: "bibliotheque_ecrire", arguments: { id: "x", modifieLe: "2026-10-04T00:00:00.000Z", donnees: {} } } }, { bibliotheque: bib });
  assert.equal(r.statut, 202);
  assert.equal(r.corps, null);
  assert.deepEqual(bib.ecrits, []);
  const m = moderne("tools/call", { name: "bibliotheque_ecrire", arguments: { id: "x", modifieLe: "2026-10-04T00:00:00.000Z", donnees: {} } });
  delete m.corps.id;
  assert.equal((await envoyer(m, { bibliotheque: bib })).statut, 202);
  assert.deepEqual(bib.ecrits, []);
});

test("une réponse JSON-RPC envoyée par le client reçoit 202", async () => {
  for (const corps of [{ jsonrpc: "2.0", id: 7, result: {} }, { jsonrpc: "2.0", id: 8, error: { code: -1, message: "non" } }]) {
    const r = await http(corps);
    assert.equal(r.statut, 202);
    assert.equal(r.corps, null);
  }
});

test("requêtes mal formées : -32600 ou -32602, en 400", async () => {
  const cas = [
    [{ id: 8 }, -32600],                                            // ni jsonrpc ni méthode
    [{ jsonrpc: "2.0", id: 8 }, -32600],                            // pas de méthode
    [[], -32600],                                                    // lot vide
    [{ jsonrpc: "2.0", id: null, method: "tools/list" }, -32600],    // id null (interdit par MCP)
    [{ jsonrpc: "2.0", id: 3, method: "tools/list", params: [1] }, -32602],
    ["ping", -32600],
  ];
  for (const [corps, code] of cas) {
    const r = await http(corps);
    assert.equal(r.statut, 400, JSON.stringify(corps));
    assert.equal(r.corps.error.code, code, JSON.stringify(corps));
  }
  // JSON illisible : -32700.
  const r = await repondreHttp(new Request(ADRESSE, { method: "POST", headers: { "content-type": "application/json" }, body: "{pas du json" }), { cle: CLE, cloud: cloudVide });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, -32700);
});

test("le site continue tel quel : tools/call direct, sans initialize ni en-tête de version", async () => {
  const r = await http({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "arborescence", arguments: {} } }, { entetes: { origin: "https://adrienvada.fr", accept: "application/json" } });
  assert.equal(r.statut, 200);
  assert.equal(r.entetes.get("access-control-allow-origin"), "https://adrienvada.fr");
  assert.deepEqual(r.corps.result.structuredContent, { connectee: false, raison: "jamais" });
  assert.equal("resultType" in r.corps.result, false);
});

test("en-tête MCP-Protocol-Version d'avant : connu, il passe ; inconnu, 400", async () => {
  const liste = { jsonrpc: "2.0", id: 4, method: "tools/list" };
  for (const v of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
    assert.equal((await http(liste, { entetes: { "mcp-protocol-version": v } })).statut, 200, v);
  }
  // L'audit : « 2099-01-01 » passait.
  const inconnu = await http(liste, { entetes: { "mcp-protocol-version": "2099-01-01" } });
  assert.equal(inconnu.statut, 400);
  assert.equal(inconnu.corps.error.code, -32022);
  assert.deepEqual(inconnu.corps.error.data, { supported: VERSIONS, requested: "2099-01-01" });
  // 2026-07-28 annoncé, mais rien dans _meta : requête incomplète.
  const sansMeta = await http(liste, { entetes: { "mcp-protocol-version": MODERNE } });
  assert.equal(sansMeta.statut, 400);
  assert.equal(sansMeta.corps.error.code, -32602);
});

test("2026-07-28 : server/discover dit les versions, les capacités et le serveur", async () => {
  const r = await envoyer(moderne("server/discover"));
  assert.equal(r.statut, 200);
  const d = r.corps.result;
  assert.equal(d.resultType, "complete");
  assert.deepEqual(d.supportedVersions, ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]);
  assert.deepEqual(d.capabilities.tools, { listChanged: false });
  assert.deepEqual(d._meta["io.modelcontextprotocol/serverInfo"], { name: "portee-remarkable", version: "2.0.0" });
  assert.match(d.instructions, /reMarkable/);
  assert.ok(Number.isInteger(d.ttlMs) && d.ttlMs >= 0);
  assert.equal(d.cacheScope, "private");
});

test("2026-07-28 : tools/list, dans le même ordre à chaque fois, avec sa durée de garde", async () => {
  const a = await envoyer(moderne("tools/list"));
  const b = await envoyer(moderne("tools/list"));
  assert.equal(a.statut, 200);
  assert.deepEqual(a.corps.result, b.corps.result);
  assert.equal(a.corps.result.resultType, "complete");
  assert.equal(a.corps.result.cacheScope, "private");
  assert.ok(a.corps.result.ttlMs > 0);
  assert.deepEqual(a.corps.result.tools.slice(0, 3).map((t) => t.name), ["arborescence", "document", "relier"]);
  assert.equal(a.corps.result._meta["io.modelcontextprotocol/serverInfo"].name, "portee-remarkable");
});

test("2026-07-28 : tools/call rend un résultat complet, signé du serveur", async () => {
  const r = await envoyer(moderne("tools/call", { name: "arborescence", arguments: {} }));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.id, 7);
  assert.equal(r.corps.result.resultType, "complete");
  assert.deepEqual(r.corps.result.structuredContent, { connectee: false, raison: "jamais" });
  assert.equal(r.corps.result._meta["io.modelcontextprotocol/serverInfo"].name, "portee-remarkable");
  assert.equal("ttlMs" in r.corps.result, false); // un appel d'outil ne se garde pas
});

test("2026-07-28 : version inconnue → 400 et -32022, avec la liste des versions", async () => {
  const r = await envoyer(moderne("tools/list", {}, { version: "1999-01-01" }));
  assert.equal(r.statut, 400);
  assert.deepEqual(r.corps.error, { code: -32022, message: "Unsupported protocol version", data: { supported: VERSIONS, requested: "1999-01-01" } });
});

test("2026-07-28 : en-têtes absents ou contraires au corps → 400 et -32020", async () => {
  const appel = { name: "arborescence", arguments: {} };
  const cas = [
    moderne("tools/call", appel, { sans: ["mcp-protocol-version"] }),
    moderne("tools/call", appel, { entetes: { "mcp-protocol-version": "2025-11-25" } }),
    moderne("tools/call", appel, { sans: ["mcp-method"] }),
    moderne("tools/call", appel, { entetes: { "mcp-method": "tools/list" } }),
    moderne("tools/call", appel, { sans: ["mcp-name"] }),
    moderne("tools/call", appel, { entetes: { "mcp-name": "document" } }),
    moderne("tools/call", appel, { entetes: { "mcp-name": "=?base64?pas-du-base64!?=" } }),
  ];
  for (const c of cas) {
    const r = await envoyer(c);
    assert.equal(r.statut, 400, JSON.stringify(c.entetes));
    assert.equal(r.corps.error.code, -32020, JSON.stringify(c.entetes));
    assert.equal(r.corps.id, 7);
  }
  // Mcp-Name encodé en base64 (pour un nom hors ASCII) : décodé avant de comparer.
  const encode = moderne("tools/call", appel, { entetes: { "mcp-name": `=?base64?${btoa("arborescence")}?=` } });
  assert.equal((await envoyer(encode)).statut, 200);
});

test("2026-07-28 : ping n'existe plus, une méthode inconnue → 404 et -32601", async () => {
  for (const methode of ["ping", "initialize-pas", "sampling/createMessage"]) {
    const r = await envoyer(moderne(methode));
    assert.equal(r.statut, 404, methode);
    assert.equal(r.corps.error.code, -32601, methode);
  }
  // Dans l'époque d'avant, une méthode inconnue reste une erreur JSON-RPC ordinaire.
  const ancien = await http({ jsonrpc: "2.0", id: 1, method: "sampling/createMessage" });
  assert.equal(ancien.statut, 200);
  assert.equal(ancien.corps.error.code, -32601);
});

test("préflight : les en-têtes de 2026-07-28 sont autorisés au site", async () => {
  const r = await repondreHttp(new Request(ADRESSE, { method: "OPTIONS", headers: { origin: "https://adrienvada.fr" } }), { cle: CLE, cloud: cloudVide });
  const permis = r.headers.get("access-control-allow-headers").split(/,\s*/);
  for (const h of ["content-type", "mcp-protocol-version", "mcp-method", "mcp-name"]) assert.ok(permis.includes(h), h);
});

test("la synchro ne fait plus voyager ses données deux fois", async () => {
  const fiche = { id: "valse", donnees: { titre: "Valse", abc: "X:1\nK:C\n" + "C2 D2 E2 F2 | ".repeat(300) }, modifieLe: "2026-10-04T09:00:00.000Z", supprime: false, pagesLe: null };
  const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "bibliotheque_changements", arguments: {} } }, null, fausseBibliotheque([fiche]));
  assert.deepEqual(r.result.structuredContent.partitions, [fiche]);
  // L'audit : le texte redisait tout le JSON (moins de 20 000 caractères).
  assert.ok(r.result.content[0].text.length < 200, r.result.content[0].text);
  assert.match(r.result.content[0].text, /1 partition écrite/);
});

test("un lot (2025-03-26) se traite dans l'ordre ; refusé en 2026-07-28", async () => {
  const bib = fausseBibliotheque();
  const ecrire = (id, n) => ({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: "bibliotheque_ecrire", arguments: { id, modifieLe: "2026-10-04T00:00:00.000Z", donnees: { titre: id } } } });
  const r = await http([ecrire("a", 1), { jsonrpc: "2.0", method: "notifications/initialized" }, ecrire("b", 2)], { bibliotheque: bib });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.map((x) => x.id), [1, 2]);
  assert.deepEqual(bib.ecrits.map((f) => f.id), ["a", "b"]);
  const lotModerne = await http([moderne("tools/list").corps]);
  assert.equal(lotModerne.statut, 400);
  assert.equal(lotModerne.corps.error.code, -32600);
});
