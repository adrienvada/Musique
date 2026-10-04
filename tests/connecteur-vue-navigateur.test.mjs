/**
 * La partition jouable (C6) dans un vrai navigateur : un faux hôte MCP Apps
 * met la page dans un cadre d'une autre origine, lui applique la CSP que la
 * spécification fait construire d'après `_meta.ui.csp`, et joue le
 * protocole (ui/initialize, tool-input, tool-result, ping, teardown,
 * tools/call). abcjs et les sons de piano viennent de node_modules et de
 * l'appli, servis par `route` : rien ne sort sur le réseau.
 *
 * Chromium (Playwright) n'est pas une dépendance du dépôt : sans lui, le
 * test se saute (en CI, par exemple).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HTML_VUE, META_VUE } from "../supabase/functions/portee-remarkable/vue-partition.js";
import { traiter } from "../supabase/functions/portee-remarkable/mcp.js";

async function chargerPlaywright() {
  for (const chemin of ["playwright", "/opt/node-tools/node_modules/playwright/index.mjs"]) {
    try {
      return await import(chemin);
    } catch {
      // le suivant
    }
  }
  return null;
}
const pw = await chargerPlaywright();
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** La CSP que l'hôte construit d'après _meta.ui.csp (spécification MCP Apps, « CSP Construction from Metadata »). */
function cspDeLHote({ resourceDomains = [], connectDomains = [] }) {
  const r = resourceDomains.join(" ");
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${r}`,
    `style-src 'self' 'unsafe-inline' ${r}`,
    `connect-src 'self' ${connectDomains.join(" ")}`,
    `img-src 'self' data: ${r}`,
    `font-src 'self' ${r}`,
    `media-src 'self' data: ${r}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/** Le faux hôte : il répond à la vue et note tout ce qu'elle dit. */
const HOTE = (contexte) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<iframe id="vue" src="https://vue.test/partition.html" style="width:640px;height:320px;border:0"></iframe>
<script>
  window.recus = []; window.appels = []; window.reponsesOutil = [];
  const vue = document.getElementById("vue");
  window.envoyer = (m) => vue.contentWindow.postMessage(m, "*");
  window.addEventListener("message", (ev) => {
    if (ev.source !== vue.contentWindow) return;
    const m = ev.data;
    window.recus.push(m);
    if (m.method === "ui/initialize") {
      window.envoyer({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "faux-hote", version: "1.0.0" }, hostCapabilities: { serverTools: {} }, hostContext: ${JSON.stringify(contexte)} } });
    } else if (m.method === "tools/call") {
      window.appels.push(m);
      window.envoyer({ jsonrpc: "2.0", id: m.id, result: window.reponsesOutil.shift() });
    } else if (m.method === "ui/notifications/size-changed") {
      window.taille = m.params;
    }
  });
</script></body></html>`;

/** Ce que partition_montrer rend, par le vrai connecteur, sur une fausse bibliothèque. */
async function resultatOutil(abc) {
  const bib = {
    async changements() { return { partitions: [{ id: "valse", supprime: false, modifieLe: "2026-10-01T10:00:00.000Z", donnees: { titre: "Valse d'essai", abc, doutes: [], statut: "prete" } }], curseur: null }; },
  };
  return (await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "partition_montrer", arguments: { id: "valse" } } }, null, bib)).result;
}

const ABC = "X:1\nT:Valse d'essai\nM:3/4\nL:1/8\nQ:1/4=120\nK:G\n\"G\"G2 B2 d2 | \"D7\"c2 A2 F2 | \"G\"G6 |]\n";

test("la partition dans un faux hôte MCP Apps : gravée, jouée, à l'écoute du protocole", { skip: !pw && "Playwright absent", timeout: 120000 }, async (t) => {
  let navigateur;
  try {
    navigateur = await pw.chromium.launch({ ...(fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}), args: ["--autoplay-policy=no-user-gesture-required"] });
  } catch (e) {
    t.skip(`Chromium ne démarre pas : ${e.message.split("\n")[0]}`);
    return;
  }
  const contexte = await navigateur.newContext({ ignoreHTTPSErrors: true });
  const sorties = [];
  await contexte.route("**/*", async (route) => {
    const url = route.request().url();
    sorties.push(url);
    if (url === "https://hote.test/") return route.fulfill({ contentType: "text/html", body: HOTE(contexteHote) });
    if (url === "https://vue.test/partition.html") return route.fulfill({ contentType: "text/html", headers: { "content-security-policy": cspDeLHote(META_VUE.ui.csp) }, body: HTML_VUE });
    if (url.startsWith("https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.7.1/abcjs-basic-min.js")) {
      return route.fulfill({ contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync("node_modules/abcjs/dist/abcjs-basic-min.js") });
    }
    if (url.startsWith("https://paulrosen.github.io/midi-js-soundfonts/")) {
      return route.fulfill({ contentType: "audio/mpeg", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync("app/piano/mf-065.mp3") });
    }
    return route.abort();
  });
  const contexteHote = { theme: "dark", displayMode: "inline", containerDimensions: { maxHeight: 900 }, styles: { variables: { "--color-text-primary": "rgb(10, 20, 30)" } } };
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  page.on("pageerror", (e) => erreurs.push(e.message));
  const vue = () => page.frames().find((f) => f.url() === "https://vue.test/partition.html");
  const recus = () => page.evaluate(() => window.recus);
  const attendreMessage = (predicat) => page.waitForFunction(predicat, null, { timeout: 15000 });
  try {
    const bon = await resultatOutil(ABC);
    await page.goto("https://hote.test/");
    // 1. La poignée de main, comme la spécification la décrit.
    await attendreMessage(() => window.recus.some((m) => m.method === "ui/notifications/initialized"));
    const init = (await recus()).find((m) => m.method === "ui/initialize");
    assert.equal(init.params.protocolVersion, "2026-01-26");
    assert.equal(init.params.appInfo.name, "Portée — partition");
    assert.deepEqual(init.params.appCapabilities, { availableDisplayModes: ["inline"] });
    // 2. Les arguments, puis le résultat de l'outil : la partition se grave.
    await page.evaluate((r) => {
      window.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { id: "valse" } } });
      window.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: r });
    }, bon);
    await vue().waitForSelector("#partition svg", { timeout: 15000 });
    assert.equal(await vue().textContent("#titre"), "Valse d'essai");
    assert.match(await vue().textContent("#infos"), /120 à la noire · 3\/4 · G/);
    assert.equal(await vue().locator("#partition .abcjs-note").count(), 7);
    assert.equal(await vue().getAttribute("#partition", "aria-label"), "Partition de « Valse d'essai »");
    // Les jetons de l'hôte s'appliquent ; la hauteur est annoncée.
    assert.equal(await vue().evaluate(() => getComputedStyle(document.getElementById("partition")).color), "rgb(10, 20, 30)");
    await attendreMessage(() => window.taille && window.taille.height > 80);
    // 3. Écouter : les sons viennent du domaine déclaré, les notes s'allument, on arrête.
    const lire = vue().locator("#lire");
    assert.equal(await lire.isEnabled(), true);
    const hauteurBouton = await lire.evaluate((b) => b.getBoundingClientRect().height);
    assert.ok(hauteurBouton >= 44, `bouton de ${hauteurBouton} px`);
    await lire.click();
    await vue().waitForSelector("#partition .joue", { timeout: 20000 });
    assert.equal(await lire.getAttribute("aria-label"), "Arrêter l'écoute");
    assert.ok(sorties.some((u) => u.startsWith("https://paulrosen.github.io/midi-js-soundfonts/")));
    await lire.click();
    assert.equal(await lire.getAttribute("aria-label"), "Écouter la partition");
    // 4. ping, une méthode inconnue, puis le démontage : chacune a sa réponse.
    await page.evaluate(() => {
      window.envoyer({ jsonrpc: "2.0", id: 91, method: "ping" });
      window.envoyer({ jsonrpc: "2.0", id: 92, method: "ui/inconnue" });
      window.envoyer({ jsonrpc: "2.0", id: 93, method: "ui/resource-teardown", params: { reason: "essai" } });
    });
    await attendreMessage(() => [91, 92, 93].every((id) => window.recus.some((m) => m.id === id && !m.method)));
    const reponses = (await recus()).filter((m) => [91, 92, 93].includes(m.id));
    assert.deepEqual(reponses.find((m) => m.id === 91).result, {});
    assert.equal(reponses.find((m) => m.id === 92).error.code, -32601);
    assert.deepEqual(reponses.find((m) => m.id === 93).result, {});

    // 5. Un résultat sans l'ABC (un hôte qui garde le résultat structuré pour lui) :
    //    la page le redemande à l'outil, par l'hôte.
    await page.goto("https://hote.test/");
    await attendreMessage(() => window.recus.some((m) => m.method === "ui/notifications/initialized"));
    await page.evaluate((r) => {
      window.reponsesOutil.push(r);
      window.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { id: "valse" } } });
      window.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: r.content } });
    }, bon);
    await vue().waitForSelector("#partition svg", { timeout: 15000 });
    const appels = await page.evaluate(() => window.appels);
    assert.deepEqual(appels.map((a) => [a.params.name, a.params.arguments]), [["partition_montrer", { id: "valse" }]]);

    // 6. Une erreur de l'outil : dite, en clair.
    await page.goto("https://hote.test/");
    await attendreMessage(() => window.recus.some((m) => m.method === "ui/notifications/initialized"));
    await page.evaluate(() => window.envoyer({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { isError: true, content: [{ type: "text", text: "Aucune partition « x » dans la bibliothèque." }] } }));
    await vue().waitForFunction(() => document.getElementById("etat").className === "erreur");
    assert.match(await vue().textContent("#etat"), /Aucune partition/);

    // Rien n'est sorti ailleurs que vers les domaines déclarés, et la page n'a rien laissé d'erreur.
    const domaines = ["https://hote.test/", "https://vue.test/", ...META_VUE.ui.csp.resourceDomains, ...META_VUE.ui.csp.connectDomains];
    for (const u of sorties) assert.ok(domaines.some((d) => u.startsWith(d)), u);
    assert.deepEqual(erreurs, []);
  } finally {
    await navigateur.close();
  }
});
