/**
 * LES PETITS ÉCRANS, LE TÉLÉPHONE COUCHÉ, LE TEXTE AGRANDI (I10)
 *
 * À 320 px de large, aucun écran ne défile de côté (l'onglet Morceaux
 * débordait de 22 px, l'éditeur de 8). Couché (844 × 390), l'éditeur tient
 * dans la hauteur, la grille à côté du pupitre (il ne restait que 80 px de
 * grille), et « Corriger » garde la page à côté de son panneau. Le texte à
 * 200 % (la police du navigateur à 32 px) : rien ne déborde, et ce qui n'a
 * plus la place de son nom se réduit à son icône (les modes, les durées).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { servir } from "./serveur.mjs";
import { TELEPHONE, contexte, importerLesExemples, lancer, ouvrirPortee, siteAssemble, verifierPropre } from "./commun.mjs";

let serveur, navigateur;
before(async () => {
  serveur = await servir({ dossier: siteAssemble() });
  navigateur = await lancer();
});
after(async () => {
  await navigateur?.close();
  await serveur?.fermer();
});

/** La page défile-t-elle de côté ? (et, si oui, ce qui dépasse). */
const deCote = (page) => page.evaluate(() => {
  const L = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= L + 1) return null;
  return [...document.querySelectorAll("body *")].filter((e) => !e.closest("[hidden], dialog:not([open])") && e.getBoundingClientRect().right > L + 1)
    .slice(0, 4).map((e) => (e.id ? `#${e.id}` : `${e.tagName.toLowerCase()}.${e.className}`)).join(", ") || "?";
});

/**
 * Le tour des écrans : l'accueil et ses onglets, une idée (ses trois modes), une
 * page lue (Corriger, Écouter), un morceau. `voir(nom)` à chaque étape. Clics par
 * le code : à 320 px, une cible peut sortir de l'écran (c'est ce qu'on mesure).
 */
async function tour(page, voir) {
  const clic = (sel) => page.locator(sel).first().evaluate((el) => el.click());
  await importerLesExemples(page);
  await voir("Carnet");
  for (const o of ["partitions", "morceaux", "reglages"]) { await clic(`#tab-${o}`); await voir(`Onglet ${o}`); }
  await clic("#tab-carnet");
  await clic("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD", "KeyF"]) await page.keyboard.press(k);
  await voir("Idée · Clavier");
  await clic('#idee-modes [data-mode="accords"]');
  await voir("Idée · Accords");
  await clic('#idee-modes [data-mode="clavier"]');
  await clic("#vue-idee [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  await clic('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
  await voir("Corriger");
  await clic("#onglet-lecteur");
  await page.waitForSelector("#vue-lecteur:not([hidden]) #gravure-lecteur svg .abcjs-note", { state: "attached" });
  await voir("Écouter");
  await clic("#vue-lecteur [data-retour]");
  await clic("#tab-morceaux");
  await clic("#nouveau-morceau");
  await page.waitForSelector("#morceau-choix[open]");
  await clic("#morceau-idees .choix-idee");
  await page.waitForSelector("#morceau-blocs .bloc");
  await voir("Morceau");
}

test("à 320 px de large, aucun écran ne défile de côté", async () => {
  const ctx = await contexte(navigateur, { appareil: { ...TELEPHONE, viewport: { width: 320, height: 640 } } });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    const fautes = [];
    await tour(page, async (nom) => { const d = await deCote(page); if (d) fautes.push(`${nom} : ${d}`); });
    assert.deepEqual(fautes, []);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("le texte à 200 % : rien ne déborde, les modes et les durées se réduisent à leur icône, les onglets du bas gardent leur nom dans leur case", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ctx.newPage();
    page.erreurs = [];
    page.on("pageerror", (e) => page.erreurs.push(`[exception] ${e.message}`));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
    await page.goto(serveur.url);
    await page.waitForFunction(() => document.getElementById("mode") && !/Ouverture/.test(document.getElementById("mode").textContent));
    const fautes = [];
    await tour(page, async (nom) => {
      const d = await deCote(page);
      if (d) fautes.push(`${nom} : ${d}`);
      if (nom === "Idée · Clavier") {
        const r = await page.evaluate(() => ({
          // Le nom d'un mode a sa taille de texte à zéro (il reste le nom de l'onglet).
          modes: [...document.querySelectorAll("#idee-modes > button")].map((b) => getComputedStyle(b).fontSize),
          durees: [...document.querySelectorAll("#idee-durees .duree span")].map((s) => getComputedStyle(s).display),
          noms: [...document.querySelectorAll("#idee-modes > button")].map((b) => b.textContent.trim()),
        }));
        assert.deepEqual(r.modes, ["0px", "0px", "0px"]);
        assert.ok(r.durees.every((x) => x === "none"), String(r.durees));
        assert.deepEqual(r.noms, ["Clavier", "Chanter", "Accords"]);
      }
      if (nom === "Carnet") {
        const tient = await page.$$eval("#onglets-accueil [role=tab]", (t) => t.map((b) => b.querySelector(".libelle").getBoundingClientRect().width <= b.getBoundingClientRect().width + 0.5));
        assert.deepEqual(tient, [true, true, true, true]);
      }
    });
    assert.deepEqual(fautes, []);
    assert.deepEqual(page.erreurs, []);
  } finally { await ctx.close(); }
});

test("couché (844 × 390) : l'éditeur tient dans la hauteur, la grille à côté du pupitre ; « Corriger » garde la page à côté de son panneau", async () => {
  const ctx = await contexte(navigateur, { appareil: { ...TELEPHONE, viewport: { width: 844, height: 390 } } });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    await importerLesExemples(page);
    await page.click("#nouvelle-idee");
    await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
    const idee = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const s = r("idee-surface"), p = r("idee-pupitre");
      return { hauteur: document.documentElement.scrollHeight, fenetre: innerHeight, grille: Math.round(s.height), aCote: p.left >= s.right - 1, pupitreEnBas: Math.round(p.bottom) };
    });
    assert.ok(idee.hauteur <= idee.fenetre, `l'éditeur demande ${idee.hauteur} px pour ${idee.fenetre}`);
    assert.ok(idee.grille >= 300, `il reste ${idee.grille} px de grille`);
    assert.equal(idee.aCote, true, "le pupitre est à côté de la grille");
    assert.ok(idee.pupitreEnBas <= idee.fenetre, "le pupitre tient dans l'écran");
    await page.click("#vue-idee [data-retour]");
    await page.click('#liste .ligne-carnet button[aria-label^="Ouvrir « Essai melodie"]');
    await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
    const atelier = await page.evaluate(() => {
      const d = document.getElementById("dock-atelier").getBoundingClientRect(), z = document.getElementById("zone-page").getBoundingClientRect();
      return { dockAGauche: Math.round(d.left), dockHaut: Math.round(d.height), pageADroite: Math.round(z.right), titre: document.getElementById("titre").getBoundingClientRect().width };
    });
    assert.ok(atelier.pageADroite <= atelier.dockAGauche + 1, `la page (${atelier.pageADroite}) passe sous le panneau (${atelier.dockAGauche})`);
    assert.equal(atelier.dockHaut, 390, "le panneau prend la hauteur de l'écran, à droite");
    assert.ok(atelier.titre >= 120, `le titre de la page garde sa place (${atelier.titre} px)`);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});
