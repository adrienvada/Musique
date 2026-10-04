/**
 * Le connecteur côté HTTP : la porte (clé, origine, taille) avant le
 * protocole MCP (S4).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { memeCle, origineAdmise, repondreHttp, TAILLE_MAX } from "../supabase/functions/portee-remarkable/http.js";
import { CloudRemarkable } from "../supabase/functions/portee-remarkable/remarkable.js";
import { coffreMemoire } from "../supabase/functions/portee-remarkable/coffre.js";

const CLE = "k".repeat(32);
const ADRESSE = `https://x.supabase.co/functions/v1/portee-remarkable/${CLE}`;
const cloud = () => new CloudRemarkable(coffreMemoire(null));
const outil = (name) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });

function appeler({ adresse = ADRESSE, methode = "POST", entetes = {}, corps, options = {} } = {}) {
  const corpsTexte = corps === undefined ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps);
  return repondreHttp(new Request(adresse, {
    method: methode,
    headers: { "content-type": "application/json", ...entetes },
    body: corpsTexte,
  }), { cle: CLE, cloud, ...options });
}

test("la clé se compare en entier, à temps constant", async () => {
  assert.equal(await memeCle(CLE, CLE), true);
  assert.equal(await memeCle("k".repeat(31) + "x", CLE), false);
  assert.equal(await memeCle("k".repeat(33), CLE), false);
  assert.equal(await memeCle("", CLE), false);
  // Une clé presque juste n'ouvre pas plus qu'une clé fausse : 404.
  assert.equal((await appeler({ adresse: ADRESSE.slice(0, -1) + "x", corps: outil("arborescence") })).status, 404);
  assert.equal((await appeler({ adresse: ADRESSE + "k", corps: outil("arborescence") })).status, 404);
  // Une clé trop courte côté fonction verrouille tout.
  assert.equal((await repondreHttp(new Request("https://x.supabase.co/functions/v1/portee-remarkable/court", { method: "POST", body: "{}" }), { cle: "court", cloud })).status, 404);
});

test("Origin : le site et Claude passent, une autre origine reçoit 403", async () => {
  // Les appels de claude.ai partent de ses serveurs : sans Origin.
  assert.equal(origineAdmise(null), true);
  for (const o of ["https://adrienvada.fr", "https://claude.ai", "https://www.claude.ai", "https://a.b.claude.ai", "https://claude.com", "https://app.claude.com", "https://api.anthropic.com"]) {
    assert.equal(origineAdmise(o), true, o);
  }
  for (const o of ["https://ailleurs.example", "http://claude.ai", "https://claude.ai.ailleurs.example", "https://faux-claude.ai", "https://anthropic.com.example", "null"]) {
    assert.equal(origineAdmise(o), false, o);
  }
  // Une origine étrangère, même avec la bonne clé et un corps « simple »
  // (text/plain, sans préflight) : rien n'est fait.
  let appele = false;
  const espion = () => ({ arborescence: async () => { appele = true; return { noeuds: [], illisibles: [] }; } });
  const r = await appeler({ entetes: { origin: "https://ailleurs.example", "content-type": "text/plain" }, corps: outil("arborescence"), options: { cloud: espion } });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  const corps = await r.json();
  assert.equal(corps.error.code, -32600);
  assert.equal("id" in corps, false);
  assert.equal(appele, false);
  // Le site : réponse et CORS ; claude.ai avec une origine : réponse, sans CORS.
  const site = await appeler({ entetes: { origin: "https://adrienvada.fr" }, corps: outil("arborescence") });
  assert.equal(site.status, 200);
  assert.equal(site.headers.get("access-control-allow-origin"), "https://adrienvada.fr");
  const claude = await appeler({ entetes: { origin: "https://claude.ai" }, corps: outil("arborescence") });
  assert.equal(claude.status, 200);
  assert.equal(claude.headers.get("access-control-allow-origin"), null);
  // Une origine ajoutée par PORTEE_ORIGINES passe, avec CORS.
  const enPlus = await appeler({ entetes: { origin: "http://localhost:8000" }, corps: outil("arborescence"), options: { origines: ["https://adrienvada.fr", "http://localhost:8000"] } });
  assert.equal(enPlus.status, 200);
  assert.equal(enPlus.headers.get("access-control-allow-origin"), "http://localhost:8000");
});

test("un corps de plus de 6 Mo reçoit 413, annoncé ou non", async () => {
  const gros = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "bibliotheque_ecrire", arguments: { id: "x", modifieLe: "2026-10-04T00:00:00.000Z", donnees: { abc: "a".repeat(TAILLE_MAX) } } } });
  const annonce = await appeler({ corps: gros, entetes: { origin: "https://adrienvada.fr" } });
  assert.equal(annonce.status, 413);
  assert.equal(annonce.headers.get("access-control-allow-origin"), "https://adrienvada.fr"); // le site peut le dire
  // Sans longueur annoncée (envoi par morceaux) : compté en lisant.
  const morceau = new TextEncoder().encode("x".repeat(1024 * 1024));
  let envoyes = 0;
  const flux = new ReadableStream({
    pull(c) {
      if (envoyes++ < 8) c.enqueue(morceau);
      else c.close();
    },
  });
  const sansLongueur = await repondreHttp(new Request(ADRESSE, { method: "POST", headers: { "content-type": "application/json" }, body: flux, duplex: "half" }), { cle: CLE, cloud });
  assert.equal(sansLongueur.status, 413);
  assert.ok(envoyes <= 8, "la lecture s'arrête au-delà de la borne");
  // Juste sous la borne : lu normalement (ici, un JSON illisible).
  assert.equal((await appeler({ corps: "x".repeat(1024) })).status, 400);
});

test("préflight et méthodes : 204 quelle que soit la clé, GET et DELETE refusés", async () => {
  const pre = await appeler({ adresse: ADRESSE + "-faux", methode: "OPTIONS", entetes: { origin: "https://adrienvada.fr" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://adrienvada.fr");
  for (const methode of ["GET", "DELETE", "PUT"]) {
    const r = await appeler({ methode });
    assert.equal(r.status, 405, methode);
    assert.match(r.headers.get("allow"), /POST/);
  }
});
