/**
 * LES FEUILLES DU BAS, LES FENÊTRES, ET LES ÉCRANS QUI CHANGENT (I3)
 *
 * Une feuille se ferme d'un toucher sur le voile (feuilles.js), sans que ce
 * toucher atteigne ce qui est sous le voile : c'est ce que `closedby="any"`
 * ratait au doigt dans Chromium (la recherche s'ouvrait sous le voile), et
 * pourquoi feuilles.js ferme sur le clic. Elle monte, et redescend en se
 * fermant, sans plus prendre le doigt pendant qu'elle s'en va. Échap et « précédent » ne ferment que la fenêtre du dessus,
 * une seule fois. Moins de mouvement demandé : ni animation, ni transition. La
 * barre du navigateur prend la couleur de l'écran (Studio dans l'éditeur).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { servir } from "./serveur.mjs";
import { TELEPHONE, contexte, lancer, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";

let serveur, navigateur;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
});

/** Une idée de trois notes, puis retour au carnet : sa ligne a son « ••• ». */
async function uneIdee(page) {
  await page.click("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD"]) await page.keyboard.press(k);
  await page.waitForFunction(() => document.getElementById("idee-etat").textContent === "Enregistrée");
  await page.click("#vue-idee [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden]) #liste .ligne-carnet .plus");
}

/** La feuille d'actions d'une ligne, ouverte, et montée jusqu'en haut de sa course. */
async function ouvrirActions(page) {
  await page.click("#liste .ligne-carnet .plus");
  await page.waitForSelector("#feuille-actions[open]");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("feuille-actions")).translate.replace(/px/g, "").split(" ").every((v) => Number(v) === 0));
}

test("une feuille se ferme d'un toucher sur le voile, sans toucher ce qui est dessous ; elle redescend sans plus prendre le doigt", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await uneIdee(page);
    await ouvrirActions(page);
    // Pas de closedby="any" : au doigt, Chromium laisserait le toucher passer au travers (plus bas).
    assert.equal(await page.getAttribute("#feuille-actions", "closedby"), null);
    // Elle a monté : sa transition est là (0,26 s), et le voile est posé.
    assert.equal(await page.$eval("#feuille-actions", (d) => getComputedStyle(d).transitionDuration.split(",")[0].trim()), "0.26s");
    // Un toucher sur le voile, juste sur la loupe de la barre du haut : la feuille se ferme, la recherche ne s'ouvre pas.
    const loupe = await page.locator("#chercher").boundingBox();
    await page.touchscreen.tap(loupe.x + loupe.width / 2, loupe.y + loupe.height / 2);
    await page.waitForSelector("#feuille-actions:not([open])", { state: "attached" });
    assert.equal(await page.isHidden("#recherche-zone"), true, "le toucher qui ferme la feuille n'ouvre pas ce qui est dessous");
    // En se fermant, elle reste un instant à l'écran (elle redescend), mais le doigt passe au travers.
    await ouvrirActions(page);
    const sortie = await page.evaluate(() => {
      const d = document.getElementById("feuille-actions");
      const b = d.getBoundingClientRect();
      d.close();
      const dessous = document.elementFromPoint(b.left + b.width / 2, b.top + 20);
      return { encoreLa: getComputedStyle(d).display !== "none", prendLeDoigt: d.contains(dessous) };
    });
    assert.deepEqual(sortie, { encoreLa: true, prendLeDoigt: false });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("feuille-actions")).display === "none");
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("Échap et « précédent » ne ferment que la fenêtre du dessus, une fois chacun, même posée avant la feuille dans la page", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await uneIdee(page);
    // Une feuille posée à la fin de la page (comme celles de versions-ui.js), et une question par-dessus.
    const empiler = () => page.evaluate(() => {
      const f = document.getElementById("essai-feuille") || Object.assign(document.createElement("dialog"), { id: "essai-feuille", className: "feuille-bas", textContent: "Une feuille" });
      document.body.appendChild(f);
      f.showModal();
      document.getElementById("dialogue").showModal();
    });
    const ouvertes = () => page.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => d.id).sort());
    await empiler();
    assert.deepEqual(await ouvertes(), ["dialogue", "essai-feuille"]);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("dialogue").open, null, { timeout: 5000 });
    assert.deepEqual(await ouvertes(), ["essai-feuille"], "Échap ferme la question, la feuille reste");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    // « Précédent » (le bouton du navigateur, ou d'Android sans fermeture native) : la question d'abord.
    await empiler();
    await page.waitForFunction(() => history.state && history.state.portee === "garde");
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !document.getElementById("dialogue").open, null, { timeout: 5000 });
    assert.deepEqual(await ouvertes(), ["essai-feuille"], "précédent ferme la question, pas la feuille d'en dessous");
    await page.waitForFunction(() => history.state && history.state.portee === "garde");
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    // L'appli est à sa racine, rien ne s'est fermé de trop : le carnet est là, sa ligne aussi.
    assert.equal(await page.isVisible("#vue-biblio #liste .ligne-carnet"), true);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("moins de mouvement demandé : ni fondu, ni feuille qui glisse ; la barre du navigateur prend la couleur de l'écran", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE, reducedMotion: "reduce", colorScheme: "light" });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    const metas = () => page.$$eval('meta[name="theme-color"]', (m) => m.map((x) => x.getAttribute("content")));
    assert.deepEqual(await metas(), ["#EDEEEA", "#17181B"]);
    await uneIdee(page);
    assert.equal(await page.$eval("#vue-biblio", (v) => getComputedStyle(v).animationName), "none");
    await page.click("#liste .ligne-carnet .plus");
    await page.waitForSelector("#feuille-actions[open]");
    assert.equal(await page.$eval("#feuille-actions", (d) => getComputedStyle(d).transitionDuration.split(",")[0].trim()), "0s");
    await page.keyboard.press("Escape");
    // L'éditeur, en Studio : la barre du navigateur prend la couleur de sa barre du haut.
    await page.click("#liste .ligne-carnet .ligne-ouvrir");
    await page.waitForSelector("#vue-idee:not([hidden])");
    const barre = await page.$eval(".idee-barre-haut", (b) => getComputedStyle(b).backgroundColor);
    assert.deepEqual(await metas(), [barre, barre]);
    assert.equal(barre, "rgb(27, 29, 33)");
    // Revenue au carnet : le papier, clair ou sombre selon le téléphone.
    await page.click("#vue-idee [data-retour]");
    await page.waitForSelector("#vue-biblio:not([hidden])");
    assert.deepEqual(await metas(), ["#EDEEEA", "#17181B"]);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
