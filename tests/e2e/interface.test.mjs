/**
 * L'INTERFACE, ÉCRAN PAR ÉCRAN
 *
 * Un tour de Portée au téléphone (chaque écran, chaque feuille du bas) pour
 * deux règles de CLAUDE.md : tout bouton à icône a un nom (aria-label ou
 * title : le lecteur d'écran le dit, l'appui long l'affiche), et rien ne
 * fait moins de 44 px au doigt. La seconde est notée « à faire » (todo) :
 * l'audit a relevé des cibles trop petites, qu'un lot suivant corrige (I1) ;
 * l'essai dit lesquelles, sans arrêter la suite.
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

/** Les boutons à icône sans nom (ni aria-label, ni title, ni texte visible). */
const iconesSansNom = (page) => page.evaluate(() => [...document.querySelectorAll("button, [role=button], a[href]")]
  .filter((el) => el.querySelector("svg.ico, .ico"))
  .filter((el) => {
    const copie = el.cloneNode(true);
    copie.querySelectorAll("[aria-hidden=true], svg").forEach((x) => x.remove());
    return !copie.textContent.trim() && !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.getAttribute("aria-labelledby");
  })
  .map((el) => el.outerHTML.slice(0, 140)));

/** Les cibles visibles de moins de `min` px de large ou de haut. */
const petitesCibles = (page, min = 44) => page.evaluate((min) => {
  const sortie = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, label[for], [role=button], [role=tab], [role=switch]")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest("[hidden], dialog:not([open])")) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.pointerEvents === "none") continue;
    if (r.width < min - 0.5 || r.height < min - 0.5) {
      const nom = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
      sortie.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : ""} « ${nom} » ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return sortie;
}, min);

/**
 * Le tour : l'accueil et ses quatre onglets, une idée (ses trois modes, une
 * note choisie, ses feuilles), un morceau, une page lue (Corriger et
 * Écouter). `releve(nom)` est appelé à chaque étape.
 */
async function parcourir(page, releve, { cliquer = (sel) => page.click(sel) } = {}) {
  const feuille = async (bouton, id, nom) => {
    await cliquer(bouton);
    await page.waitForSelector(`#${id}[open]`);
    await releve(nom);
    await page.keyboard.press("Escape");
    await page.waitForSelector(`#${id}:not([open])`, { state: "attached" });
  };
  await importerLesExemples(page);
  await releve("Carnet");
  await cliquer("#nouvelle-idee");
  await page.waitForSelector("#vue-idee:not([hidden]) #idee-clavier .touche");
  for (const k of ["KeyA", "KeyS", "KeyD", "KeyF"]) await page.keyboard.press(k);
  await page.waitForFunction(() => document.querySelectorAll("#idee-grille .g-note:not(.autre)").length === 4);
  await releve("Idée · Clavier");
  await cliquer('#idee-modes [data-mode="accords"]');
  await releve("Idée · Accords");
  await feuille("#accords-plus", "feuille-accords", "Feuille · les accords");
  await cliquer('#idee-modes [data-mode="clavier"]');
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector("#idee-pilule:not([hidden])");
  await releve("Idée · une note choisie");
  await feuille('#idee-pilule [data-action="plus"]', "idee-boite", "Feuille · la boîte à outils");
  await cliquer('#idee-selection [data-action="deselectionner"]');
  await feuille("#idee-reglages-bouton", "idee-reglages", "Feuille · Tempo et mesure");
  await feuille("#idee-plus", "idee-menu", "Feuille · ••• de l'idée");
  await cliquer("#idee-plus");
  await feuille('#idee-menu [data-menu="infos"]', "idee-infos", "Feuille · le carnet de l'idée");
  await cliquer('#idee-affichage [data-affichage="partition"]');
  await page.waitForSelector("#idee-gravure svg .abcjs-note", { state: "attached" });
  await releve("Idée · Partition");
  await cliquer('#idee-affichage [data-affichage="grille"]');
  await cliquer("#vue-idee [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  await feuille("#liste .ligne-carnet .plus", "feuille-actions", "Feuille · ••• d'une ligne du carnet");
  await cliquer("#tab-partitions");
  await releve("Partitions");
  await cliquer("#tab-morceaux");
  await releve("Morceaux");
  await cliquer("#nouveau-morceau");
  await page.waitForSelector("#morceau-choix[open]");
  await releve("Feuille · quelle idée ?");
  await cliquer("#morceau-idees .choix-idee");
  await page.waitForSelector("#morceau-blocs .bloc");
  await releve("Morceau · un bloc");
  await feuille("#morceau-plus", "morceau-menu", "Feuille · ••• du morceau");
  await cliquer("#vue-morceau [data-retour]");
  await page.waitForSelector("#vue-biblio:not([hidden])");
  await cliquer("#tab-reglages");
  await releve("Réglages");
  await cliquer("#tab-partitions");
  await cliquer('#liste-partitions .carte-ouvrir[aria-label^="Ouvrir « Essai melodie"]');
  await page.waitForSelector("#vue-atelier:not([hidden]) #gravure-atelier svg .abcjs-note", { state: "attached" });
  await releve("Corriger · un doute");
  await feuille("#plus-atelier", "feuille-atelier", "Feuille · ••• de Corriger");
  await cliquer("#onglet-lecteur");
  await page.waitForSelector("#vue-lecteur:not([hidden]) #gravure-lecteur svg .abcjs-note", { state: "attached" });
  await releve("Écouter et exporter");
  await feuille("#plus-lecteur", "feuille-lecteur", "Feuille · autres formats");
}

test("tout bouton à icône a un nom (aria-label ou title)", async () => {
  const ctx = await contexte(navigateur, { appareil: TELEPHONE });
  try {
    const page = await ouvrirPortee(ctx, serveur.url);
    const sansNom = [];
    await parcourir(page, async (ecran) => { for (const b of await iconesSansNom(page)) sansNom.push(`${ecran} : ${b}`); });
    assert.deepEqual(sansNom, []);
    await verifierPropre(page);
  } finally { await ctx.close(); }
});

test("rien ne fait moins de 44 px au doigt, à 390 et à 320 px de large", { todo: "I1 : les cibles trop petites relevées par l'audit, qu'un lot suivant corrige" }, async () => {
  // Une cible trop petite, et les écrans où on la trouve (elle revient souvent d'un écran à l'autre).
  const petites = new Map();
  for (const largeur of [390, 320]) {
    const ctx = await contexte(navigateur, { appareil: { ...TELEPHONE, viewport: { width: largeur, height: 844 } } });
    try {
      const page = await ouvrirPortee(ctx, serveur.url);
      // Un clic par le code : à 320 px, une cible peut déborder de l'écran (c'est ce qu'on mesure).
      const cliquer = (sel) => page.locator(sel).first().evaluate((el) => el.click());
      await parcourir(page, async (ecran) => {
        for (const c of await petitesCibles(page)) petites.set(`${largeur} px : ${c}`, [...(petites.get(`${largeur} px : ${c}`) || []), ecran]);
      }, { cliquer });
    } finally { await ctx.close(); }
  }
  const liste = [...petites].map(([c, ecrans]) => `${c} (${ecrans[0]}${ecrans.length > 1 ? ` et ${ecrans.length - 1} autres écrans` : ""})`);
  assert.deepEqual(liste, [], `${liste.length} cibles de moins de 44 px`);
});
