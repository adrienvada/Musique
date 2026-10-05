/**
 * Tests de la mise en page de la partition de l'éditeur d'idée
 * (idee-partition.js, `mettreEnPage`), sans abcjs ni page : une fausse
 * gravure rend la hauteur qu'aurait la vraie. abcjs étire la gravure à la
 * largeur de la zone (`responsive: "resize"`) : une portée demandée plus
 * étroite se grave plus grand.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mettreEnPage } from "../app/idee-partition.js";

const LIGNE = 80; // la hauteur d'une ligne de portée gravée à sa taille

/** Une fausse gravure : elle note ce qu'on lui demande et rend sa hauteur. */
function fausseGravure(largeur, mesures) {
  const demandes = [];
  const graver = (parLigne, largeurPortee) => {
    demandes.push([parLigne, largeurPortee]);
    return Math.ceil(mesures / parLigne) * LIGNE * (largeur / largeurPortee);
  };
  return { graver, demandes };
}

test("au téléphone, une idée de quatre mesures garde deux mesures par ligne, gravées plus grand", () => {
  const { graver, demandes } = fausseGravure(390, 4);
  const page = mettreEnPage({ largeur: 390, hauteur: 600, mesures: 4, graver });
  // Une mesure par ligne déborderait (624 px pour 600) : on garde deux, et on agrandit.
  assert.deepEqual(page, { parLigne: 2, largeurPortee: 260 });
  assert.deepEqual(demandes, [[2, 400], [2, 260]]);
});

test("une idée d'une mesure en prend une par ligne, sans agrandir la portée plus de deux fois", () => {
  const { graver, demandes } = fausseGravure(390, 1);
  const page = mettreEnPage({ largeur: 390, hauteur: 600, mesures: 1, graver });
  assert.deepEqual(page, { parLigne: 1, largeurPortee: 200 });
  assert.ok(page.largeurPortee >= 390 / 2, "pas plus de deux fois plus grand au téléphone");
  assert.equal(demandes.length, 2);
});

test("une longue idée garde la première mise en page, d'une seule gravure", () => {
  const { graver, demandes } = fausseGravure(390, 32);
  assert.deepEqual(mettreEnPage({ largeur: 390, hauteur: 600, mesures: 32, graver }), { parLigne: 2, largeurPortee: 400 });
  assert.equal(demandes.length, 1);
});

test("sur un grand écran, on retire des mesures par ligne sans étaler les notes d'un bord à l'autre", () => {
  const { graver, demandes } = fausseGravure(1200, 8);
  const page = mettreEnPage({ largeur: 1200, hauteur: 700, mesures: 8, graver });
  assert.deepEqual(page, { parLigne: 2, largeurPortee: 750 });
  assert.ok(page.parLigne >= Math.floor(1200 / 420), "pas moins de deux mesures par ligne à 1 200 px");
  assert.ok(page.largeurPortee >= 1200 / 1.6, "pas plus de 1,6 fois plus grand sur un grand écran");
  assert.deepEqual(demandes.map(([n]) => n), [6, 5, 4, 3, 2]);
  assert.ok(graver(page.parLigne, page.largeurPortee) <= 700, "la gravure tient dans la hauteur");
});

test("jamais plus de six mesures par ligne, même très large", () => {
  const { graver } = fausseGravure(2400, 64);
  assert.equal(mettreEnPage({ largeur: 2400, hauteur: 900, mesures: 64, graver }).parLigne, 6);
});

test("pendant la lecture, la mise en page d'avant est reprise telle quelle, d'une seule gravure (M2)", () => {
  const { graver, demandes } = fausseGravure(390, 4);
  const reprise = { parLigne: 2, largeurPortee: 260 };
  assert.deepEqual(mettreEnPage({ largeur: 390, hauteur: 600, mesures: 6, graver, reprise }), reprise);
  assert.deepEqual(demandes, [[2, 260]]);
});
