/**
 * Le MIDI d'une idée : relu octet par octet, il doit redonner les pistes,
 * leurs noms, le tempo, la mesure, l'armure et chaque note au tic près.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fichierMidi } from "../app/midi.js";

/** Un petit lecteur de MIDI, juste ce qu'il faut pour vérifier. */
function lireMidi(octets) {
  let i = 0;
  const u32 = () => (octets[i++] << 24 | octets[i++] << 16 | octets[i++] << 8 | octets[i++]) >>> 0;
  const u16 = () => (octets[i++] << 8) | octets[i++];
  const vlq = () => { let v = 0, b; do { b = octets[i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  const texte = (n) => new TextDecoder().decode(octets.slice(i, (i += n)));
  assert.equal(texte(4), "MThd");
  assert.equal(u32(), 6);
  const format = u16(), nb = u16(), ppq = u16();
  const pistes = [];
  for (let p = 0; p < nb; p++) {
    assert.equal(texte(4), "MTrk");
    const fin = u32() + i;
    const piste = { nom: null, notes: [], meta: {}, programme: null };
    const ouvertes = new Map();
    let t = 0;
    while (i < fin) {
      t += vlq();
      const statut = octets[i++];
      if (statut === 0xff) {
        const type = octets[i++], n = vlq();
        const donnees = octets.slice(i, i + n);
        if (type === 0x03) piste.nom = texte(n); else i += n;
        if (type === 0x51) piste.meta.tempo = Math.round(60000000 / ((donnees[0] << 16) | (donnees[1] << 8) | donnees[2]));
        if (type === 0x58) piste.meta.mesure = [donnees[0], 2 ** donnees[1]];
        if (type === 0x59) piste.meta.armure = [(donnees[0] << 24) >> 24, donnees[1]];
        if (type === 0x2f) assert.equal(i, fin);
      } else if ((statut & 0xf0) === 0x90 && octets[i + 1] > 0) {
        ouvertes.set(octets[i], { t, h: octets[i], v: octets[i + 1], canal: statut & 15 });
        i += 2;
      } else if ((statut & 0xf0) === 0x80 || (statut & 0xf0) === 0x90) {
        const o = ouvertes.get(octets[i]);
        piste.notes.push([o.t, t - o.t, o.h, o.v, o.canal]);
        ouvertes.delete(octets[i]);
        i += 2;
      } else if ((statut & 0xf0) === 0xc0) {
        piste.programme = octets[i++];
      } else {
        throw new Error("événement inattendu " + statut.toString(16));
      }
    }
    pistes.push(piste);
  }
  return { format, ppq, pistes };
}

test("une piste de tempo, puis une piste nommée par voix", () => {
  const midi = lireMidi(fichierMidi([
    { nom: "Mélodie", notes: [{ d: 0, l: 4, h: 60 }, { d: 4, l: 2, h: 64, v: 110 }, { d: 6, l: 2, h: 64 }] },
    { nom: "Accords", notes: [{ d: 0, l: 16, h: 48 }, { d: 0, l: 16, h: 55 }] },
  ], { tempo: 132, mesure: [6, 8], quintes: -3, mineur: true, titre: "Idée du matin" }));
  assert.equal(midi.format, 1);
  assert.equal(midi.ppq, 480);
  assert.equal(midi.pistes.length, 3);
  const [conducteur, melodie, accords] = midi.pistes;
  assert.equal(conducteur.nom, "Idée du matin");
  assert.deepEqual(conducteur.meta, { tempo: 132, mesure: [6, 8], armure: [-3, 1] });
  assert.equal(melodie.nom, "Mélodie");
  assert.equal(melodie.programme, 0);
  // Une double croche = 120 tics ; la note répétée se rejoue (fin avant début).
  assert.deepEqual(melodie.notes, [[0, 480, 60, 90, 0], [480, 240, 64, 110, 0], [720, 240, 64, 90, 0]]);
  assert.deepEqual(accords.notes.map((n) => n.slice(0, 3)), [[0, 1920, 48], [0, 1920, 55]]);
  assert.ok(accords.notes.every((n) => n[4] === 1));
});

test("transposition, notes hors du clavier MIDI ignorées, canal 10 évité", () => {
  const voix = Array.from({ length: 11 }, (_, i) => ({ nom: `V${i}`, notes: [{ d: i, l: 1, h: 60 + i }] }));
  voix[0].notes.push({ d: 0, l: 1, h: 126 });
  const midi = lireMidi(fichierMidi(voix, { transposition: 2 }));
  assert.deepEqual(midi.pistes[1].notes.map((n) => n[2]), [62]);
  assert.deepEqual(midi.pistes.slice(1).map((p) => p.notes[0][4]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
});
