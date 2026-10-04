/**
 * Le .zip du MIDI (claude.ai) : les fichiers ressortent intacts, sous leur
 * nom, et datés du jour où on les a exportés (pas du « 0 janvier 1980 »).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { zipper } from "../app/zip.js";

/** Les entrées du répertoire central : nom, taille, date. */
function lireZip(octets) {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const fin = octets.length - 22;
  assert.equal(v.getUint32(fin, true), 0x06054b50);
  const nb = v.getUint16(fin + 10, true);
  let o = v.getUint32(fin + 16, true);
  const entrees = [];
  for (let i = 0; i < nb; i++) {
    assert.equal(v.getUint32(o, true), 0x02014b50);
    const heure = v.getUint16(o + 12, true), jour = v.getUint16(o + 14, true);
    const taille = v.getUint32(o + 24, true), lNom = v.getUint16(o + 28, true), local = v.getUint32(o + 42, true);
    const nom = new TextDecoder().decode(octets.slice(o + 46, o + 46 + lNom));
    // L'en-tête local porte la même date.
    assert.equal(v.getUint16(local + 10, true), heure);
    assert.equal(v.getUint16(local + 12, true), jour);
    const debut = local + 30 + v.getUint16(local + 26, true);
    entrees.push({
      nom, donnees: octets.slice(debut, debut + taille),
      date: [1980 + (jour >> 9), (jour >> 5) & 15, jour & 31, heure >> 11, (heure >> 5) & 63, (heure & 31) * 2],
    });
    o += 46 + lNom;
  }
  return entrees;
}

test("le zip garde les fichiers, leurs noms accentués et la date de l'export", () => {
  const date = new Date(2026, 9, 4, 21, 37, 18); // 4 octobre 2026, 21 h 37 min 18 s (heure locale)
  const midi = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 1, 2, 3]);
  const [a, b] = lireZip(zipper([{ nom: "Idée du matin.mid", donnees: midi }, { nom: "Pluie.mid", donnees: new Uint8Array([9]) }], { date }));
  assert.equal(a.nom, "Idée du matin.mid");
  assert.deepEqual([...a.donnees], [...midi]);
  assert.deepEqual(a.date, [2026, 10, 4, 21, 37, 18]);
  assert.equal(b.nom, "Pluie.mid");
  // Sans date donnée : aujourd'hui.
  const [c] = lireZip(zipper([{ nom: "x.mid", donnees: midi }]));
  assert.equal(c.date[0], new Date().getFullYear());
});
